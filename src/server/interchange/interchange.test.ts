// Schedule and table imports / MSPDI export on a seeded in-memory database (chapter 4, S-9): new-project and update imports
// of the synthetic fixtures (tests/fixtures/ch4), round trips export → import, dry runs that write nothing, the stale-preview
// guard, circular logic, rights per role, and the Excel / CSV imports of budget lines, BOM, parts and resource assignments.
// D-7b: imports are off in the app (IMPORTS_ENABLED, src/domain/ch4-defaults.ts); these tests turn the flag on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/domain/ch4-defaults', async (orig) => ({ ...(await orig<typeof import('@/domain/ch4-defaults')>()), IMPORTS_ENABLED: true }));
import { PERSONA_BY_ROLE } from '@/config/personas';
import { CATEGORY_FROZEN_MESSAGE } from '@/domain/baseline-policy';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import {
  activities, activityAssignments, activityLinks, auditEntries, baselineActivities, baselines, calendars, connectors, costCategories, importJobs, milestones, parts, projectBomLines,
  projectControls, projects, scheduleBars, stageDeliverableChecks, stageDeliverableDefs, wbsNodes,
} from '@/server/db/schema';
import { getPlanData } from '@/server/dal/plan';
import { setFilesRoot } from '@/server/storage/files';
import { fmt } from './messages';
import { parseMspdi } from './mspdi';
import { applyImport, cancelImport, previewTable, startImport, tableMapping, type ImportStep, type ImportViewer, type PreviewView } from './jobs';
import { exportScheduleXml } from './schedule-export';
import { CATEGORY_CREATED_AT_ZERO } from './table-import';

const viewer = (role: keyof typeof PERSONA_BY_ROLE): ImportViewer => ({ name: PERSONA_BY_ROLE[role].name, short: PERSONA_BY_ROLE[role].short, role });
const DIRECTOR = viewer('director');
const PM = viewer('pm');
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/ch4', name)));
let filesDir = '';

beforeAll(async () => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-interchange-'));
  setFilesRoot(filesDir);
  setDb(await openDatabase());
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(filesDir, { recursive: true, force: true });
});

function preview(step: ImportStep): PreviewView {
  if (!step.ok) throw new Error(`expected a preview, got ${step.error}`);
  if (step.step !== 'preview') throw new Error(`expected a preview, got ${step.step}`);
  return step.preview;
}
async function counts() {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = async (t: any) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0].n as number;
  return {
    projects: await n(projects), activities: await n(activities), links: await n(activityLinks), wbs: await n(wbsNodes), baselines: await n(baselines), calendars: await n(calendars),
    cats: await n(costCategories), bom: await n(projectBomLines), parts: await n(parts), assignments: await n(activityAssignments),
  };
}
const projectId = async (code: string) => (await (await getDb()).select({ id: projects.id }).from(projects).where(eq(projects.code, code)))[0].id;
async function actsOf(code: string) {
  const db = await getDb();
  return db.select().from(activities).where(eq(activities.projectId, await projectId(code))).orderBy(asc(activities.position));
}

describe('MS Project XML into a new project', () => {
  let code = '';

  it('preview is a dry run: rows, summary, nothing written but the staging', async () => {
    const before = await counts();
    const p = preview(await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'sample.mspdi.xml', data: fixture('sample.mspdi.xml'), importBaselines: true, matchOn: 'uid' }, DIRECTOR));
    expect(await counts()).toEqual(before);
    expect(p).toMatchObject({ kind: 'mspdi', mode: 'new', projectCode: null, blocking: [], canImport: true });
    expect(p.summary).toMatchObject({
      fileProject: 'Sample plant upgrade', projectName: 'Sample plant upgrade', start: '2026-01-05', finish: '2026-03-16',
      activities: { create: 5, update: 0, error: 0 }, packages: { create: 2, update: 0 }, links: 5, baselines: ['BL1', 'BL2'],
      calendars: [{ name: 'Standard', mappedTo: 'standard_5x8' }, { name: 'Workshop 4x10', mappedTo: null }],
    });
    const acts = p.rows.filter((r) => r.data.kind === 'activity');
    expect(acts.map((r) => [r.key, r.data.wbs, r.action])).toEqual([['D100', '1.1', 'create'], ['D110', '1.1', 'create'], ['A1000', '1.1', 'create'], ['S200', '1.2', 'create'], ['S900', '1.2', 'create']]);
    expect(acts.find((r) => r.key === 'S200')!.data.preds).toEqual(['D110 FS', 'A1000 FF-1']);
    expect(p.summary.unmapped).toContain(fmt('Work packages below level 2 are flattened into their top work package ({0})', 1));
    expect(p.summary.unmapped).toContain(fmt('Baselines 1 to 10 of the file are imported as superseded baselines ({0})', 1));
  });

  it('confirmation writes the project, WBS, activities, logic, calendars, baselines and header', async () => {
    const start = preview(await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'sample.mspdi.xml', data: fixture('sample.mspdi.xml'), importBaselines: true, matchOn: 'uid', projectName: 'Plant upgrade (imported)' }, PM));
    const done = await applyImport(start.jobId, PM);
    if (!done.ok || done.step !== 'done') throw new Error(JSON.stringify(done));
    code = done.projectCode!;
    expect(done).toMatchObject({ created: 5, updated: 0, kind: 'mspdi' });
    const db = await getDb();
    const [p] = await db.select().from(projects).where(eq(projects.code, code));
    expect(p).toMatchObject({ name: 'Plant upgrade (imported)', stage: 'initiative', calendar: 'standard_5x8', dataDate: '2026-02-02', plannedStartDate: '2026-01-05', plannedFinishDate: '2026-03-16', isNew: true });
    expect(code).toMatch(/^[A-Z]{3}-\d{3}$/);
    const nodes = await db.select().from(wbsNodes).where(eq(wbsNodes.projectId, p.id)).orderBy(asc(wbsNodes.position));
    expect(nodes.map((n) => [n.code, n.name, n.level, n.position])).toEqual([['1', 'Plant upgrade (imported)', 0, 0], ['1.1', 'Design', 1, 1], ['1.2', 'Site works', 1, 5]]);
    const acts = await actsOf(code);
    expect(acts.map((a) => [a.code, a.position, a.durationDays, a.startText, a.startActual, a.finishText, a.finishActual, a.percentComplete])).toEqual([
      ['D100', 2, 10, '05 Jan', true, '16 Jan', true, 100],
      ['D110', 3, 15, '19 Jan', true, '12 Feb', false, 40],
      ['A1000', 4, 20, '07 Jan', false, '03 Feb', false, 0],
      ['S200', 6, 20, '16 Feb', false, '13 Mar', false, 0],
      ['S900', 7, 0, '16 Mar', false, '16 Mar', false, 0],
    ]);
    const d110 = acts.find((a) => a.code === 'D110')!;
    expect(d110).toMatchObject({ calendarCode: `${code}.CAL2`, externalUid: '4', remainingDays: 9, baselineFinishDate: '2026-02-09' });
    expect(acts.find((a) => a.code === 'A1000')).toMatchObject({ constraintType: 'FNLT', constraintDate: '2026-02-13', constraintDateText: '13 Feb', totalFloatDays: 0, critical: true });
    expect(acts.find((a) => a.code === 'S200')).toMatchObject({ baselineFinishDate: '2026-03-06', varianceDays: -5, budgetKeur: 110, eacKeur: 120, totalFloatDays: 5 });
    const [cal] = await db.select().from(calendars).where(eq(calendars.code, `${code}.CAL2`));
    expect(cal).toMatchObject({ name: 'Workshop 4x10', workDays: [1, 2, 3, 4], hoursPerDay: 10, projectId: p.id, externalUid: '2' });
    const links = await db.select().from(activityLinks).where(eq(activityLinks.projectId, p.id));
    expect(links).toHaveLength(5);
    const bls = await db.select().from(baselines).where(eq(baselines.projectId, p.id)).orderBy(asc(baselines.position));
    expect(bls.map((b) => [b.code, b.state, b.source, b.finishDate])).toEqual([['BL1', 'current', 'import', '2026-03-06'], ['BL2', 'superseded', 'import', '2026-02-02']]);
    const [{ n: bl1Rows }] = await db.select({ n: sql<number>`count(*)::int` }).from(baselineActivities).where(eq(baselineActivities.baselineId, bls[0].id));
    expect(bl1Rows).toBe(3);
    // Delivery 8 (R-054, L-2 "a"): the imported BL1 (current) ticks « Planning BL1 posé »; the project stays at Initiative.
    const [apd1] = await db.select({ done: stageDeliverableChecks.done }).from(stageDeliverableChecks)
      .innerJoin(stageDeliverableDefs, eq(stageDeliverableDefs.id, stageDeliverableChecks.deliverableId))
      .where(and(eq(stageDeliverableChecks.projectId, p.id), eq(stageDeliverableDefs.stage, 'apd'), eq(stageDeliverableDefs.position, 1)));
    expect(apd1?.done).toBe(true);
    const [ctrl] = await db.select().from(projectControls).where(eq(projectControls.projectId, p.id));
    expect(ctrl).toMatchObject({ startMonth: 0, floatDays: 0, finishText: '16 Mar 2026', baselineText: '16 Mar 2026', milesText: '0 of 1', critText: '1 of 2 packages critical' });
    expect(await db.select({ name: milestones.name, status: milestones.status }).from(milestones).where(eq(milestones.projectId, p.id))).toEqual([{ name: 'Handover', status: 'on_track' }]);
    expect((await db.select().from(scheduleBars).where(eq(scheduleBars.projectId, p.id))).map((b) => [b.name, b.critical])).toEqual([['Design', true], ['Site works', false]]);
    expect(await db.select({ r: activityAssignments.resource, h: activityAssignments.plannedHours, a: activityAssignments.actualHours }).from(activityAssignments).where(eq(activityAssignments.activityId, d110.id))).toEqual([{ r: 'Julien Wagner', h: 120, a: 48 }]);
    // The PM who imported it manages it; the Plan screen reads it.
    const plan = await getPlanData(code);
    expect(plan?.activities.map((a) => a.id)).toEqual(['D100', 'D110', 'A1000', 'S200', 'S900']);
    expect(plan?.packages.map((x) => x.code)).toEqual(['1.1', '1.2']);
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, start.jobId));
    expect(job).toMatchObject({ status: 'applied', appliedByName: 'Romain Aubert' });
    const audit = await db.select().from(auditEntries).where(and(eq(auditEntries.entityType, 'import_job'), eq(auditEntries.entityId, start.jobId)));
    expect(audit.map((a) => a.change)).toEqual(['mspdi imported (new)']);
    const [ms] = await db.select().from(connectors).where(eq(connectors.name, 'MS Project'));
    expect(ms.lastVolume).toBe(`${code} imported · 5 activities`);
  });

  it('a second confirmation is refused; the job is owned by its author', async () => {
    const db = await getDb();
    const [job] = await db.select({ id: importJobs.id }).from(importJobs).where(eq(importJobs.status, 'applied'));
    expect(await applyImport(job.id, PM)).toEqual({ ok: false, error: 'This import is already imported' });
    expect(await applyImport(job.id, DIRECTOR)).toEqual({ ok: false, error: 'Unknown import' });
  });

  it('round trip: export the imported project, read it back — same schedule', async () => {
    const out = await exportScheduleXml(code, new Date('2026-10-09T08:00:00Z'));
    expect(out).toMatchObject({ fileName: `${code}-schedule-2026-10-09.xml`, baselineCode: 'BL1', activities: 5 });
    const back = parseMspdi(out!.xml);
    const source = parseMspdi(Buffer.from(fixture('sample.mspdi.xml')).toString('utf8'));
    const key = (s: typeof back) =>
      s.activities.map((a) => ({
        name: a.name, d: a.durationDays, start: a.start, finish: a.finish, as: a.actualStart, af: a.actualFinish, pct: a.percentComplete, c: a.constraint, tf: a.totalFloatDays,
        bl: a.baselines.filter((b) => b.number === 0).map((b) => [b.start, b.finish]),
      }));
    expect(key(back)).toEqual(key(source).map((a) => ({ ...a, c: a.c && { ...a.c } })));
    expect(back.activities.map((a) => a.activityId)).toEqual(['D100', 'D110', 'A1000', 'S200', 'S900']);
    expect(back.links.map((l) => [l.type, l.lagDays])).toEqual(source.links.map((l) => [l.type, l.lagDays]));
    expect(back.calendars.map((c) => [c.name, c.workDays, c.hoursPerDay])).toEqual([['Standard 5d · 8h', [1, 2, 3, 4, 5], 8], ['Workshop 4x10', [1, 2, 3, 4], 10]]);
    expect(back.calendars[0].exceptions.map((e) => e.date)).toContain('2026-05-01');
  });

  it('update by Activity ID: same file → only updates; a changed name is applied; kept activities reported', async () => {
    const out = await exportScheduleXml(code);
    const xml = out!.xml.replace('<Name>Foundations</Name>', '<Name>Foundations and slab</Name>');
    const before = await actsOf(code);
    const p = preview(await startImport({ kind: 'schedule', mode: 'update', projectCode: code, fileName: 'u.xml', data: new TextEncoder().encode(xml), matchOn: 'activity_id', importBaselines: false }, PM));
    expect(p.summary).toMatchObject({ activities: { create: 0, update: 5, error: 0 }, packages: { create: 0, update: 2 }, kept: 0 });
    const done = await applyImport(p.jobId, PM);
    expect(done).toMatchObject({ ok: true, step: 'done', created: 0, updated: 5 });
    const after = await actsOf(code);
    expect(after.map((a) => [a.code, a.name, a.startDate, a.finishDate, a.durationDays, a.percentComplete])).toEqual(
      before.map((a) => [a.code, a.code === 'S200' ? 'Foundations and slab' : a.name, a.startDate, a.finishDate, a.durationDays, a.percentComplete]),
    );
    expect(await (await getDb()).select().from(baselines).where(eq(baselines.projectId, await projectId(code)))).toHaveLength(2);
  });

  it('circular logic blocks the import', async () => {
    const p = preview(await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'cycle.mspdi.xml', data: fixture('cycle.mspdi.xml') }, DIRECTOR));
    expect(p.canImport).toBe(false);
    expect(p.blocking[0]).toMatch(/^The logic has a cycle: /);
    expect(await applyImport(p.jobId, DIRECTOR)).toMatchObject({ ok: false });
    expect((await cancelImport(p.jobId, DIRECTOR)).ok).toBe(true);
  });
});

describe('round trip of a seeded project', () => {
  it('HLT-026 exported then imported as a new project keeps activities, dates, logic and the displayed baseline', async () => {
    const out = await exportScheduleXml('HLT-026', new Date('2026-10-09T08:00:00Z'));
    expect(out).toMatchObject({ baselineCode: 'BL1' });
    const p = preview(await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'hlt.xml', data: new TextEncoder().encode(out!.xml) }, DIRECTOR));
    expect(p.blocking).toEqual([]);
    const done = await applyImport(p.jobId, DIRECTOR);
    if (!done.ok || done.step !== 'done') throw new Error(JSON.stringify(done));
    const [src, dst] = await Promise.all([actsOf('HLT-026'), actsOf(done.projectCode!)]);
    const pick = (a: (typeof src)[number]) => [a.code, a.name, a.durationDays, a.startDate, a.finishDate, a.startActual, a.finishActual, a.percentComplete, a.constraintType, a.constraintDate, a.baselineFinishDate];
    expect(dst.map(pick)).toEqual(src.map(pick));
    const db = await getDb();
    const linkKey = async (code: string) =>
      (await db.select({ p: activities.code, t: activityLinks.type, l: activityLinks.lagDays, s: activityLinks.successorId }).from(activityLinks).innerJoin(activities, eq(activities.id, activityLinks.predecessorId)).where(eq(activityLinks.projectId, await projectId(code)))).length;
    expect(await linkKey(done.projectCode!)).toBe(await linkKey('HLT-026'));
    const nodes = await db.select({ code: wbsNodes.code, name: wbsNodes.name }).from(wbsNodes).where(eq(wbsNodes.projectId, await projectId(done.projectCode!))).orderBy(asc(wbsNodes.position));
    const srcNodes = await db.select({ code: wbsNodes.code, name: wbsNodes.name }).from(wbsNodes).where(eq(wbsNodes.projectId, await projectId('HLT-026'))).orderBy(asc(wbsNodes.position));
    expect(nodes.slice(1)).toEqual(srcNodes.slice(1));
  });

  it('re-importing the export into HLT-026 by UID falls back on the Activity ID and changes no date', async () => {
    const before = await actsOf('HLT-026');
    const out = await exportScheduleXml('HLT-026');
    const p = preview(await startImport({ kind: 'schedule', mode: 'update', projectCode: 'HLT-026', fileName: 'hlt.xml', data: new TextEncoder().encode(out!.xml), importBaselines: false }, PM));
    expect(p.summary).toMatchObject({ activities: { create: 0, update: before.length }, kept: 0 });
    expect(p.rows.find((r) => r.key === 'A1250')!.messages).toEqual([fmt('Matched on Activity ID {0}', 'A1250')]);
  });
});

describe('Primavera P6 XER', () => {
  it('imports activities, maps calendars to the built-in ones, keeps activity codes and resources', async () => {
    const p = preview(await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'sample.xer', data: fixture('sample.xer') }, DIRECTOR));
    expect(p).toMatchObject({ kind: 'xer', canImport: true });
    expect(p.summary).toMatchObject({ activities: { create: 5 }, calendars: [{ name: 'Chantier 6x10', mappedTo: 'site_6x10' }, { name: 'Office 5x8', mappedTo: 'standard_5x8' }] });
    const done = await applyImport(p.jobId, DIRECTOR);
    if (!done.ok || done.step !== 'done') throw new Error(JSON.stringify(done));
    const acts = await actsOf(done.projectCode!);
    expect(acts.map((a) => [a.code, a.durationDays, a.calendarCode])).toEqual([['A1000', 5, null], ['A1010', 10, 'standard_5x8'], ['A1020', 20, null], ['A1030', 30, null], ['A1900', 0, null]]);
    expect(acts.find((a) => a.code === 'A1020')!.description).toBe('Codes · Discipline: CIV');
    const db = await getDb();
    expect((await db.select({ c: projects.calendar }).from(projects).where(eq(projects.code, done.projectCode!)))[0].c).toBe('site_6x10');
    const steel = acts.find((a) => a.code === 'A1030')!;
    expect(await db.select({ r: activityAssignments.resource, n: activityAssignments.resourceCount, h: activityAssignments.plannedHours }).from(activityAssignments).where(eq(activityAssignments.activityId, steel.id)).orderBy(asc(activityAssignments.position))).toEqual([
      { r: 'Steel erection crew', n: 6, h: 1800 }, { r: 'Crane 100t', n: null, h: 300 },
    ]);
    // No ms project connector stamp for P6.
    expect((await db.select().from(connectors).where(eq(connectors.name, 'MS Project')))[0].lastVolume).not.toContain(done.projectCode!);
  });
});

describe('rights', () => {
  it('per role and project ownership', async () => {
    const xml = fixture('sample.mspdi.xml');
    expect(await startImport({ kind: 'schedule', mode: 'update', projectCode: 'NDC-031', fileName: 'x.xml', data: xml }, PM)).toEqual({ ok: false, error: 'You may not import this file into this project' });
    for (const role of ['member', 'client', 'englead', 'quality'] as const)
      expect((await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'x.xml', data: xml }, viewer(role))).ok, role).toBe(false);
    expect((await startImport({ kind: 'bom', mode: 'update', projectCode: 'HLT-026', fileName: 'bom.csv', data: fixture('bom.en.csv') }, viewer('englead'))).ok).toBe(true);
    expect((await startImport({ kind: 'bom', mode: 'update', projectCode: 'HLT-026', fileName: 'bom.csv', data: fixture('bom.en.csv') }, PM)).ok).toBe(false);
    // R-041 (P-2): the engineering lead imports into the projects whose named team they are on only (a referent of HLT-026).
    expect(await startImport({ kind: 'bom', mode: 'update', projectCode: 'NDC-031', fileName: 'bom.csv', data: fixture('bom.en.csv') }, viewer('englead'))).toEqual({ ok: false, error: 'You may not import this file into this project' });
    expect((await startImport({ kind: 'assignments', mode: 'update', projectCode: 'NDC-031', fileName: 'a.csv', data: fixture('assignments.fr.csv') }, viewer('depthead'))).ok).toBe(true);
    expect((await startImport({ kind: 'budget_lines', mode: 'update', projectCode: 'HLT-026', fileName: 'b.csv', data: fixture('budget-lines.fr.csv') }, viewer('depthead'))).ok).toBe(false);
    expect(await startImport({ kind: 'budget_lines', mode: 'update', projectCode: null, fileName: 'b.csv', data: fixture('budget-lines.fr.csv') }, DIRECTOR)).toEqual({ ok: false, error: 'Choose the project to update' });
  });

  it('refuses files of the wrong type or content', async () => {
    const r = await startImport({ kind: 'bom', mode: 'update', projectCode: 'HLT-026', fileName: 'bom.exe', data: new Uint8Array([1, 2, 3]) }, DIRECTOR);
    expect(r).toEqual({ ok: false, error: 'File type not accepted' });
    const x = await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'x.xml', data: new TextEncoder().encode('<html/>') }, DIRECTOR);
    expect(x).toEqual({ ok: false, error: 'The file is not an MS Project XML file (MSPDI)' });
    // Either schedule card accepts both formats: an unrecognised file names both (it said "MS Project XML" on the P6 card).
    const y = await startImport({ kind: 'schedule', mode: 'new', projectCode: null, fileName: 'plan.txt', data: new TextEncoder().encode('hello') }, DIRECTOR);
    expect(y).toEqual({ ok: false, error: 'The file is neither an MS Project XML file (MSPDI) nor a Primavera P6 XER file' });
  });
});

describe('Excel / CSV tables', () => {
  async function mapping(step: ImportStep) {
    if (!step.ok || step.step !== 'mapping') throw new Error(JSON.stringify(step));
    return step.mapping;
  }

  it('budget lines: French CSV, mapping proposed, update + create, errors skipped, stale preview refused', async () => {
    const m = await mapping(await startImport({ kind: 'budget_lines', mode: 'update', projectCode: 'HLT-026', fileName: 'budget.csv', data: fixture('budget-lines.fr.csv') }, PM));
    expect(m).toMatchObject({ kind: 'budget_lines', columns: ['Code', 'Catégorie', 'Type', 'Budget (k€)', 'Réalisé (k€)'], headerLine: 1, sheets: [] });
    expect(m.sample[0]).toEqual(['C01', 'Main-d’œuvre chantier', 'Main-d’œuvre', '1 250,5', '300']);
    const before = await counts();
    const p = preview(await previewTable(m.jobId, m.mapping, null, PM));
    expect(await counts()).toEqual(before);
    // Delivery 8 (R-081, C-3a): HLT-026 has BL1 — a line changing C01's amount is refused (was: updated to 1 250,5 k€) and a new
    // category is created at 0 k€ with a warning (was: at 85 k€).
    expect(p.summary).toMatchObject({ create: 1, update: 0, error: 3, skip: 0, warning: 1 });
    expect(p.rows.map((r) => [r.key, r.status, r.action])).toEqual([['C01', 'error', 'skip'], ['Location grue', 'warning', 'create'], ['C99', 'error', 'skip'], ['Honoraires bureau de contrôle', 'error', 'skip']]);
    expect(p.rows[0].messages).toEqual([CATEGORY_FROZEN_MESSAGE]);
    expect(p.rows[1].messages).toEqual([CATEGORY_CREATED_AT_ZERO]);
    // Someone adds "Location grue" meanwhile (at the file's 85 k€): the confirmation re-plans and refuses.
    const db = await getDb();
    const pid = await projectId('HLT-026');
    const c01 = (await db.select().from(costCategories).where(and(eq(costCategories.projectId, pid), eq(costCategories.code, 'C01'))))[0];
    await db.insert(costCategories).values({ projectId: pid, code: 'C50', name: 'Location grue', costType: 'equipment', budgetKeur: 85, actualKeur: 0, committedKeur: 0, forecastKeur: 85, position: 50 });
    const stale = await applyImport(p.jobId, PM);
    expect(stale).toMatchObject({ ok: false, error: 'The data changed since the preview — check the new preview' });
    if (stale.ok || !stale.stale) throw new Error('stale preview expected');
    expect(stale.stale.summary).toMatchObject({ create: 0, update: 1 });
    const done = await applyImport(p.jobId, PM);
    expect(done).toMatchObject({ ok: true, created: 0, updated: 1 });
    const cats = await db.select().from(costCategories).where(eq(costCategories.projectId, pid)).orderBy(asc(costCategories.position));
    expect(cats.find((c) => c.code === 'C01')).toMatchObject({ name: c01.name, costType: c01.costType, budgetKeur: c01.budgetKeur, actualKeur: c01.actualKeur });
    expect(cats.find((c) => c.code === 'C50')).toMatchObject({ budgetKeur: 85, costType: 'equipment' });
  });

  it('BOM: catalogue parts only, activity checked, add only skips existing lines', async () => {
    const m = await mapping(await startImport({ kind: 'bom', mode: 'new', projectCode: 'HLT-026', fileName: 'bom.csv', data: fixture('bom.en.csv') }, viewer('procurement')));
    expect(m.mapping).toMatchObject({ ref: 'Reference', quantity: 'Qty', activity: 'Activity ID', scope: 'Scope', note: 'Note' });
    const p = preview(await previewTable(m.jobId, m.mapping, null, viewer('procurement')));
    expect(p.rows.map((r) => [r.key, r.status, r.action, r.messages])).toEqual([
      ['EL-UPS-500', 'ok', 'create', []],
      ['KS-STL-0450', 'warning', 'skip', [fmt('Already there — skipped (Add only)')]],
      ['NOPE-123', 'error', 'skip', [fmt('{0} is not in the catalogue', 'NOPE-123')]],
      ['EL-BAT-LI-200', 'error', 'skip', [fmt('Unknown activity {0}', 'A9999')]],
      ['LT-HB-200W-ALT', 'error', 'skip', [fmt('Quantity must be greater than 0')]],
    ]);
    expect(await applyImport(p.jobId, viewer('procurement'))).toMatchObject({ ok: true, created: 1, updated: 0 });
    const db = await getDb();
    const [line] = await db.select({ q: projectBomLines.quantity, note: projectBomLines.note, scope: projectBomLines.scope }).from(projectBomLines).innerJoin(parts, eq(parts.id, projectBomLines.partId)).where(and(eq(parts.ref, 'EL-UPS-500'), eq(projectBomLines.projectId, await projectId('HLT-026'))));
    expect(line).toEqual({ q: 4, note: 'UPS for the control room', scope: 'keystone' });
  });

  it('parts catalogue from an Excel workbook (second sheet chosen), new supplier registered', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Notes').addRow(['Catalogue export']);
    const ws = book.addWorksheet('Parts');
    ws.addRow(['Supplier catalogue — October']);
    ws.addRow(['Référence', 'Désignation', 'Famille', 'Unité', 'Prix unitaire', 'Fournisseur', 'Délai (semaines)', 'Code douanier']);
    ws.addRow(['ks-bolt-m24', 'HV bolt M24 × 120', 'Structure', 'pcs', 3.2, 'Boltworks SA', 2, '7318.15']);
    ws.addRow(['EL-UPS-500', 'UPS 500 kVA (rev. B)', 'Electrical', '', 98000, '', 18, '']);
    ws.addRow(['BAD REF!', 'x', 'Electrical', '', 1, '', '', '']);
    const data = new Uint8Array(await book.xlsx.writeBuffer());
    const first = await mapping(await startImport({ kind: 'parts', mode: 'update', projectCode: 'HLT-026', fileName: 'parts.xlsx', data }, viewer('englead')));
    expect(first).toMatchObject({ sheets: ['Notes', 'Parts'], sheet: 'Notes' });
    const m = await mapping(await tableMapping(first.jobId, 'Parts', viewer('englead')));
    expect(m).toMatchObject({ sheet: 'Parts', headerLine: 2 });
    expect(m.mapping).toMatchObject({ ref: 'Référence', name: 'Désignation', type: 'Famille', unit: 'Unité', price: 'Prix unitaire', supplier: 'Fournisseur', leadWeeks: 'Délai (semaines)', hsCode: 'Code douanier' });
    const p = preview(await previewTable(m.jobId, m.mapping, 'Parts', viewer('englead')));
    expect(p.projectCode).toBeNull();
    expect(p.rows.map((r) => [r.key, r.status, r.action])).toEqual([['KS-BOLT-M24', 'warning', 'create'], ['EL-UPS-500', 'ok', 'update'], ['BAD REF!', 'error', 'skip']]);
    expect(p.summary.newSuppliers).toEqual(['Boltworks SA']);
    expect(await applyImport(p.jobId, viewer('englead'))).toMatchObject({ ok: true, created: 1, updated: 1 });
    const db = await getDb();
    const rows = await db.select().from(parts).where(sql`${parts.ref} in ('KS-BOLT-M24', 'EL-UPS-500')`).orderBy(asc(parts.ref));
    expect(rows.map((r) => [r.ref, r.name, r.type, r.unit, r.listPriceEur, r.status, r.leadWeeks, r.hsCode])).toEqual([
      ['EL-UPS-500', 'UPS 500 kVA (rev. B)', 'electrical', 'pc', 98000, expect.any(String), 18, expect.anything()],
      ['KS-BOLT-M24', 'HV bolt M24 × 120', 'structural', 'pc', 3.2, 'not_validated', 2, '7318.15'],
    ]);
  });

  it('resource assignments: person matched, crew kept as text, unknown activity refused', async () => {
    const m = await mapping(await startImport({ kind: 'assignments', mode: 'update', projectCode: 'HLT-026', fileName: 'a.csv', data: fixture('assignments.fr.csv') }, PM));
    const p = preview(await previewTable(m.jobId, m.mapping, null, PM));
    expect(p.rows.map((r) => [r.key, r.status, r.action])).toEqual([['A1250 · Steel erection crew', 'ok', 'update'], ['A1250 · Antoine Girard', 'ok', 'create'], ['A9999 · Julien Wagner', 'error', 'skip']]);
    expect(await applyImport(p.jobId, PM)).toMatchObject({ ok: true, created: 1, updated: 1 });
    const db = await getDb();
    const [a1250] = await db.select({ id: activities.id }).from(activities).where(and(eq(activities.projectId, await projectId('HLT-026')), eq(activities.code, 'A1250')));
    const rows = await db.select().from(activityAssignments).where(eq(activityAssignments.activityId, a1250.id)).orderBy(asc(activityAssignments.position));
    expect(rows.find((r) => r.resource === 'Steel erection crew')).toMatchObject({ resourceCount: 6, hoursPerDay: 10, plannedHours: 2600, actualHours: 1900, units: '6 × 10 h/d', progressText: '1,900 / 2,600 h' });
    expect(rows.find((r) => r.resource === 'Antoine Girard')).toMatchObject({ personId: expect.any(String), plannedHours: 120, units: '1 × 8 h/d', progressText: '0 / 120 h' });
  });
});
