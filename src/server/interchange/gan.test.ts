// D9-08 (owner, 10 Nov 2026): GanttProject reader on the synthetic fixture tests/fixtures/ch4/sample.gan (values computed by
// hand from the file), then the import path with the app's real settings — MS Project and GanttProject only: a preview that
// writes nothing, the confirmation that writes the project and audits it, the formats left off refused, and the rights.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, activityLinks, auditEntries, baselines, importJobs, projects } from '@/server/db/schema';
import { setFilesRoot } from '@/server/storage/files';
import { looksLikeGan, parseGan } from './gan';
import { applyImport, startImport, type ImportViewer } from './jobs';
import { fmt } from './messages';

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/ch4', name));

describe('GanttProject reader', () => {
  const s = parseGan(fixture('sample.gan').toString('utf8'));

  it('reads the project, the WBS (summary tasks, outline numbers) and the tasks with their finish counted on the calendar', () => {
    expect(s).toMatchObject({ format: 'gan', name: 'Sample conveyor retrofit', company: 'Port authority', start: '2026-01-05', finish: '2026-02-16', statusDate: null, calendarUid: 'gan' });
    expect(s.wbs.map((w) => [w.uid, w.code, w.name, w.parentUid])).toEqual([['0', '1', 'Engineering', null], ['4', '2', 'Site works', null]]);
    // Detailed design: 10 working days from Mon 12 Jan, the 19 Jan site closure skipped → Mon 26 Jan.
    expect(s.activities.map((a) => [a.uid, a.wbsUid, a.durationDays, a.start, a.finish, a.percentComplete, a.milestone])).toEqual([
      ['1', '0', 5, '2026-01-05', '2026-01-09', 100, false],
      ['2', '0', 10, '2026-01-12', '2026-01-26', 40, false],
      ['3', '0', 8, '2026-01-07', '2026-01-16', 0, false],
      ['5', '4', 10, '2026-02-02', '2026-02-13', 0, false],
      ['6', null, 0, '2026-02-16', '2026-02-16', 0, true],
    ]);
    const [basic, detailed, orders] = s.activities;
    expect(basic).toMatchObject({ actualStart: '2026-01-05', actualFinish: '2026-01-09', notes: 'Frozen with the client', activityId: null });
    expect(detailed).toMatchObject({ actualStart: '2026-01-12', actualFinish: null });
    expect(orders).toMatchObject({ constraint: { type: 'SNET', date: '2026-01-08' }, actualStart: null });
  });

  it('reads the links (1 SS · 2 FS · 3 FF · 4 SF, lag in days), skipping those of summary tasks', () => {
    expect(s.links).toEqual([
      { predUid: '1', succUid: '2', type: 'FS', lagDays: 0 },
      { predUid: '1', succUid: '3', type: 'SS', lagDays: 2 },
      { predUid: '2', succUid: '5', type: 'FF', lagDays: -1 },
      { predUid: '5', succUid: '6', type: 'FS', lagDays: 0 },
    ]);
    expect(s.unmapped).toEqual([
      fmt('Custom columns are not imported'), fmt('Links to or from summary tasks are not imported ({0})', 1), fmt('Resource holidays are not imported'),
      'Resource rates and cost accrual are not imported',
    ]);
  });

  it('reads the calendar (default week, dated and yearly exceptions), the baseline and the allocations', () => {
    expect(s.calendars).toEqual([{
      uid: 'gan', name: 'default', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8,
      exceptions: [
        { date: '2026-01-19', working: false, name: 'Site closed' }, { date: '2026-01-31', working: true, name: '' },
        { date: '2026-05-01', working: false, name: 'Fête du travail' }, { date: '2027-05-01', working: false, name: 'Fête du travail' },
        { date: '2028-05-01', working: false, name: 'Fête du travail' },
      ],
    }]);
    expect(s.warnings).toEqual([fmt('Yearly holidays are repeated over the years of the schedule ({0})', 1)]);
    // Baseline 0: Detailed design planned for 8 days from 12 Jan (19 Jan closed) → 22 Jan; the handover milestone on 13 Feb.
    expect(s.activities.map((a) => a.baselines)).toEqual([
      [{ number: 0, start: '2026-01-05', finish: '2026-01-09', durationDays: 5, costKeur: null }],
      [{ number: 0, start: '2026-01-12', finish: '2026-01-22', durationDays: 8, costKeur: null }],
      [], [],
      [{ number: 0, start: '2026-02-13', finish: '2026-02-13', durationDays: 0, costKeur: null }],
    ]);
    expect(s.resources).toEqual([{ uid: '0', name: 'Design office', type: 'work' }, { uid: '1', name: 'Site crew', type: 'work' }]);
    expect(s.assignments).toEqual([
      { activityUid: '2', resourceUid: '0', units: 0.5, plannedHours: null, actualHours: null },
      { activityUid: '5', resourceUid: '1', units: 2, plannedHours: null, actualHours: null },
    ]);
  });

  it('recognises a GanttProject file and refuses other XML and DOCTYPEs', () => {
    expect([looksLikeGan('plan.gan', ''), looksLikeGan('plan.xml', '<project name="x"><tasks/></project>'), looksLikeGan('plan.xml', '<Project xmlns="x"><Tasks/>')]).toEqual([true, true, false]);
    expect(() => parseGan('<Project><Tasks/></Project>')).toThrow('The file is not a GanttProject file');
    expect(() => parseGan('<?xml version="1.0"?><!DOCTYPE project [<!ENTITY x "y">]><project><tasks/></project>')).toThrow('DOCTYPE');
  });
});

describe('GanttProject import with the app settings (D9-08)', () => {
  const viewer = (role: keyof typeof PERSONA_BY_ROLE): ImportViewer => ({ name: PERSONA_BY_ROLE[role].name, short: PERSONA_BY_ROLE[role].short, role });
  const bytes = (name: string) => new Uint8Array(fixture(name));
  let filesDir = '';
  beforeAll(async () => {
    filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-gan-'));
    setFilesRoot(filesDir);
    setDb(await openDatabase());
  }, 60_000);
  afterAll(() => {
    setFilesRoot(null);
    fs.rmSync(filesDir, { recursive: true, force: true });
  });

  it('previews without writing, then writes a new project on confirmation (audited); XER and tables stay off', async () => {
    const db = await getDb();
    const n = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(activities))[0].n;
    const before = await n();
    const step = await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'retrofit.gan', data: bytes('sample.gan'), importBaselines: true, matchOn: 'uid' }, viewer('pm'));
    if (!step.ok || step.step !== 'preview') throw new Error(JSON.stringify(step));
    expect(step.preview).toMatchObject({ kind: 'gan', mode: 'new', blocking: [], canImport: true });
    expect(step.preview.summary).toMatchObject({ format: 'gan', fileProject: 'Sample conveyor retrofit', activities: { create: 5, error: 0 }, links: 4, baselines: ['BL1'] });
    expect(await n()).toBe(before);

    const done = await applyImport(step.preview.jobId, viewer('pm'));
    if (!done.ok || done.step !== 'done') throw new Error(JSON.stringify(done));
    expect(done).toMatchObject({ kind: 'gan', created: 5 });
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, done.projectCode!));
    expect((await db.select().from(activities).where(eq(activities.projectId, p.id))).length).toBe(5);
    expect((await db.select().from(activityLinks).where(eq(activityLinks.projectId, p.id))).length).toBe(4);
    expect((await db.select({ code: baselines.code, state: baselines.state, comment: baselines.comment }).from(baselines).where(eq(baselines.projectId, p.id))))
      .toEqual([{ code: 'BL1', state: 'current', comment: 'GanttProject · Baseline 0' }]);
    const [job] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, step.preview.jobId));
    expect(job.status).toBe('applied');
    expect((await db.select().from(auditEntries).where(eq(auditEntries.entityId, step.preview.jobId))).map((a) => a.change)).toContain('gan imported (new)');

    // P6 XER and the Excel / CSV tables are refused (D9-08: MS Project and GanttProject only).
    expect(await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'sample.xer', data: bytes('sample.xer') }, viewer('director'))).toEqual({ ok: false, error: 'This import format is not available' });
    expect(await startImport({ kind: 'budget_lines', mode: 'update', projectCode: 'HLT-026', fileName: 'b.csv', data: bytes('budget-lines.fr.csv') }, viewer('director'))).toEqual({ ok: false, error: 'This import format is not available' });
  });

  it('rights: into an existing project only its leads and the director; a new project the director and the PMs', async () => {
    const refused = { ok: false, error: 'You may not import this file into this project' };
    // The finance persona leads no project; the engineering lead is not a lead of HLT-026.
    expect(await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'r.gan', data: bytes('sample.gan') }, viewer('finance'))).toEqual(refused);
    expect(await startImport({ kind: 'schedule', mode: 'update', projectCode: 'HLT-026', fileName: 'r.gan', data: bytes('sample.gan') }, viewer('englead'))).toEqual(refused);
    const director = await startImport({ kind: 'schedule', mode: 'update', projectCode: 'HLT-026', fileName: 'r.gan', data: bytes('sample.gan') }, viewer('director'));
    expect(director.ok).toBe(true);
  });
});
