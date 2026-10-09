// Chapter 4 foundation on a seeded in-memory database: seed (calendars, BL1 snapshots, assignment quantities) and its
// backfill, and the DAL writers of the new tables. The files of the attachment test go to a temporary folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { schedule } from '@/domain/cpm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { seedIfEmpty } from '@/server/db/seed';
import {
  activityAssignments, auditEntries, baselineActivities, baselines, calendars, connectors, projects, resourceRequests, scheduleRuns, storedFiles,
} from '@/server/db/schema';
import { setFilesRoot } from '@/server/storage/files';
import { addActivityTodo, listActivityTodos, removeActivityTodo, setActivityTodoDone } from './activity-todos';
import { createBaselineSnapshot, getBaselineActivities, getDisplayedBaselineCode, listProjectBaselines, setDisplayedBaseline, snapshotIntoBaseline } from './baselines';
import { getProjectCalendarCode, listCalendars, loadWorkCalendars, setActivityCalendar, setProjectCalendar, upsertCalendar } from './calendars';
import { getBaselineRegister } from './changes-baselines';
import { addClientCommunication, listClientCommunications, openClientFollowUps, setClientCommunicationFollowUpDone } from './client-comms';
import { getConnectorConfig, updateConnectorConfig } from './connector-config';
import { cancelImportJob, createImportJob, getImportJob, getImportJobRows, listImportJobs, markImportJobApplied, saveImportPreview, setImportJobMapping } from './import-jobs';
import { createResourceRequest, discardDraftRequest, getDepartmentApprovals, sendDraftRequest } from './requests';
import { listScheduleRuns, loadScheduleNetwork, recordScheduleRun } from './schedule-network';
import { attachTaskFile, getTaskFile, listTaskFiles, removeTaskFile } from './task-files';
import { listScenarioActions, markScenarioApplied, replaceScenarioActions, saveScenarioResult } from './whatif-store';

const DIRECTOR = 'Marie Lefebvre';
const PM = 'Romain Aubert';
let filesDir = '';

beforeAll(async () => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-ch4-'));
  setFilesRoot(filesDir);
  setDb(await openDatabase());
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(filesDir, { recursive: true, force: true });
});

describe('chapter 4 seed', () => {
  it('built-in calendars, BL1 rows and snapshots, assignment quantities', async () => {
    const db = await getDb();
    expect((await db.select({ code: calendars.code }).from(calendars)).map((c) => c.code)).toEqual(['standard_5x8', 'standard_5x8_workshop', 'site_6x10', 'continuous_24h']);
    const bl = await db.select({ code: baselines.code, source: baselines.source }).from(baselines);
    expect(bl).toHaveLength(8);
    expect(bl.every((b) => b.source === 'seed')).toBe(true);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(baselineActivities);
    expect(n).toBe(145); // ALL_BYID: every activity of the 6 projects with data, in their BL1
    const crew = await db.select().from(activityAssignments).where(eq(activityAssignments.resource, 'Steel erection crew'));
    expect(crew[0]).toMatchObject({ resourceCount: 6, hoursPerDay: 10, plannedHours: 2400, actualHours: 1840 });
  });

  it('keeps the Change control register unchanged (BL1 of a generated project = the former fallback)', async () => {
    expect(await getBaselineRegister('NDC-031')).toEqual([
      { code: 'BL1', name: 'Approved baseline', setOn: '9 Apr 2026', setOnDate: '2026-04-09', bac: 2100, finish: '1 Apr 2027', finishDate: '2027-04-01', state: 'current', stateLabel: 'Current', changeRequest: null },
    ]);
    expect((await getBaselineRegister('HLT-026')).map((b) => [b.code, b.setOn, b.stateLabel, b.changeRequest])).toEqual([
      ['BL0', '18 Jan 2026', 'Superseded', null], ['BL1', '12 Mar 2026', 'Current', null], ['BL2', 'Pending CR-009', 'Proposed', 'CR-009'],
    ]);
  });

  it('BL1 snapshot of HLT-026 carries the prototype BL1 finishes and derived starts', async () => {
    const rows = await getBaselineActivities('HLT-026', 'BL1');
    expect(rows).toHaveLength(21);
    expect(rows.find((r) => r.activityCode === 'A1250')).toMatchObject({ finishDate: '2026-08-31', finishText: '31 Aug', durationDays: 40, startDate: '2026-07-06', budgetKeur: 280 });
    expect(rows.find((r) => r.activityCode === 'A1620')).toMatchObject({ finishDate: '2026-12-18', finishText: '18 Dec' });
  });

  it('backfills a database seeded before migration 0005 once', async () => {
    const db = await getDb();
    await db.delete(baselineActivities);
    await db.delete(baselines).where(sql`${baselines.projectId} <> (select id from ${projects} where code = 'HLT-026')`);
    await db.update(activityAssignments).set({ plannedHours: null, actualHours: null, resourceCount: null, hoursPerDay: null });
    await db.delete(calendars);
    expect(await seedIfEmpty(db)).toBe(false);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(baselineActivities);
    expect(n).toBe(145);
    expect(await db.select({ c: calendars.code }).from(calendars)).toHaveLength(4);
    expect((await db.select().from(activityAssignments).where(eq(activityAssignments.resource, 'Julien Wagner')))[0]).toMatchObject({ hoursPerDay: 8, plannedHours: 400 });
  });
});

describe('calendars', () => {
  it('lists, loads with Settings holidays, sets the project and activity calendars', async () => {
    expect((await listCalendars()).map((c) => c.name)).toEqual(['Standard 5d · 8h', 'Atelier 5d · 8h', 'Chantier 6d · 10h', 'Continu 24h / 7d']);
    const cals = await loadWorkCalendars('HLT-026');
    expect(cals.standard_5x8.isWorkDay('2026-11-11')).toBe(false);
    expect(await getProjectCalendarCode('HLT-026')).toBe('standard_5x8');
    await setProjectCalendar('NDC-031', 'site_6x10', PM);
    expect(await getProjectCalendarCode('NDC-031')).toBe('site_6x10');
    await expect(setProjectCalendar('NDC-031', 'nope', PM)).rejects.toThrow('Unknown calendar');
    await setActivityCalendar('NDC-031', 'A3510', 'standard_5x8', PM);
    expect((await loadScheduleNetwork('NDC-031'))!.activities.find((a) => a.code === 'A3510')!.calendarCode).toBe('standard_5x8');
    await setActivityCalendar('NDC-031', 'A3510', null, PM);
    await setProjectCalendar('NDC-031', 'standard_5x8', PM);
  });
  it('imports a project calendar with exceptions', async () => {
    const code = await upsertCalendar({ code: 'HLT-026:7', name: 'Night shift', workDays: [1, 2, 3, 4], hoursPerDay: 10, projectCode: 'HLT-026', exceptions: [{ date: '2026-10-01', working: false, name: 'Audit' }] }, DIRECTOR);
    const cals = await loadWorkCalendars('HLT-026');
    expect(cals[code].isWorkDay('2026-10-01')).toBe(false);
    expect(cals[code].isWorkDay('2026-10-02')).toBe(false); // Friday off
    expect(Object.keys(await loadWorkCalendars('NDC-031'))).not.toContain(code);
    await expect(upsertCalendar({ code: 'standard_5x8', name: 'x', workDays: [1], hoursPerDay: 8 }, DIRECTOR)).rejects.toThrow('built in');
  });
});

describe('schedule network', () => {
  it('feeds the CPM engine (manual Reschedule; nothing is written by loading)', async () => {
    const n = (await loadScheduleNetwork('HLT-026'))!;
    expect([n.dataDate, n.projectCalendar, n.activities.length, n.links.length]).toEqual(['2026-09-25', 'standard_5x8', 21, 30]);
    const r = schedule(n.input);
    expect([r.activities.A1250.finish, r.activities.A1260.start, r.activities.A1260.finish]).toEqual(['2026-10-09', '2026-10-05', '2026-11-06']);
    expect(r.activities.A1620.violation).toMatchObject({ type: 'FNLT', date: '2026-12-18' });
    expect(r.criticalPath).toEqual(['A1250', 'A1260', 'A1420', 'A1430', 'A1610', 'A1620']);
    expect(n.activities.find((a) => a.code === 'A1620')).toMatchObject({ finishText: '14 Jan ’27', totalFloatDays: -27 });
    expect(await loadScheduleNetwork('XXX-999')).toBeNull();
    await recordScheduleRun('HLT-026', { outcome: 'ok', dataDate: n.dataDate, previousFinishDate: '2027-01-14', finishDate: r.projectFinish, changedActivities: 9, criticalActivities: 6 }, PM);
    expect((await listScheduleRuns('HLT-026'))[0]).toMatchObject({ outcome: 'ok', ranByName: PM, finishDate: r.projectFinish, changedActivities: 9 });
    expect((await (await getDb()).select().from(scheduleRuns)).length).toBe(1);
  });
});

describe('baselines', () => {
  it('lists with the displayed flag; the chip stores the choice', async () => {
    expect((await listProjectBaselines('HLT-026')).map((b) => [b.code, b.activityCount, b.displayed, b.state])).toEqual([
      ['BL0', 0, false, 'superseded'], ['BL1', 21, true, 'current'], ['BL2', 0, false, 'proposed'],
    ]);
    expect(await getDisplayedBaselineCode('HLT-026')).toBe('BL1');
    await setDisplayedBaseline('HLT-026', 'BL0', PM);
    expect(await getDisplayedBaselineCode('HLT-026')).toBe('BL0');
    await expect(setDisplayedBaseline('HLT-026', 'BL9', PM)).rejects.toThrow('Unknown baseline');
    await setDisplayedBaseline('HLT-026', 'BL1', PM);
  });
  it('"Set baseline" snapshots BL3; the CR re-baseline fills BL2 and makes it current', async () => {
    const r = await createBaselineSnapshot('HLT-026', { actorName: PM, comment: 'Before recovery' }, undefined);
    expect(r).toEqual({ code: 'BL3', activityCount: 21 });
    const bl3 = (await listProjectBaselines('HLT-026')).find((b) => b.code === 'BL3')!;
    expect(bl3).toMatchObject({ name: 'BL3', state: 'proposed', source: 'snapshot', comment: 'Before recovery', setOn: '2026-09-25', finishDate: '2027-01-14', createdByName: PM });
    expect((await getBaselineActivities('HLT-026', 'BL3')).find((a) => a.activityCode === 'A1250')).toMatchObject({ finishDate: '2026-10-09', finishText: '09 Oct', totalFloatDays: -27 });
    expect(await snapshotIntoBaseline('HLT-026', 'BL2', { actorName: DIRECTOR, makeCurrent: true })).toBe(21);
    expect((await listProjectBaselines('HLT-026')).map((b) => [b.code, b.state])).toEqual([['BL0', 'superseded'], ['BL1', 'superseded'], ['BL2', 'current'], ['BL3', 'proposed']]);
  });
});

describe('activity to-dos (tasks of the activity)', () => {
  it('lists, adds, ticks and removes', async () => {
    expect((await listActivityTodos('HLT-026', 'A1250')).map((t) => t.number)).toEqual(['T-2314', 'T-2318', 'T-2305', 'T-2320', 'T-2325']);
    const n = await addActivityTodo('HLT-026', 'A1250', { title: 'Check bolt torque — bay 4' }, PM);
    const todo = (await listActivityTodos('HLT-026', 'A1250')).find((t) => t.number === n)!;
    expect(todo).toMatchObject({ title: 'Check bolt torque — bay 4', assignee: 'Julien Wagner', status: 'todo', dueDate: '2026-10-09', removable: true });
    await setActivityTodoDone('HLT-026', n, true, PM);
    expect((await listActivityTodos('HLT-026', 'A1250')).find((t) => t.number === n)!.done).toBe(true);
    await expect(removeActivityTodo('HLT-026', 'T-2314', PM)).rejects.toThrow('cannot be removed');
    await removeActivityTodo('HLT-026', n, PM);
    expect((await listActivityTodos('HLT-026', 'A1250')).some((t) => t.number === n)).toBe(false);
    await expect(addActivityTodo('HLT-026', 'A1250', { title: '  ' }, PM)).rejects.toThrow('title');
  });
});

describe('import jobs', () => {
  it('upload → mapping → preview → applied (in the importer transaction)', async () => {
    const id = await createImportJob({ kind: 'budget_lines', mode: 'update', projectCode: 'HLT-026', fileName: 'budget.xlsx', actorName: PM });
    await setImportJobMapping(id, { code: 'Code', name: 'Category', budget: 'Budget' }, { sheet: 'Lines' });
    await saveImportPreview(id, [
      { status: 'ok', action: 'update', key: 'C01', data: { code: 'C01', budget: 900 } },
      { status: 'warning', action: 'create', key: 'C09', data: { code: 'C09' }, messages: ['New category'] },
      { status: 'error', action: 'skip', key: null, data: {}, messages: ['Budget not a number'] },
    ], { rows: 3 });
    const j = (await getImportJob(id))!;
    expect([j.status, j.projectCode, j.counts, j.mapping.code, j.options.sheet]).toEqual(['previewed', 'HLT-026', { ok: 1, warning: 1, error: 1 }, 'Code', 'Lines']);
    expect((await getImportJobRows(id, { status: 'warning' }))[0]).toMatchObject({ key: 'C09', messages: ['New category'] });
    await (await getDb()).transaction((tx) => markImportJobApplied(id, { summary: { updated: 1 }, actorName: PM }, tx));
    expect((await getImportJob(id))!).toMatchObject({ status: 'applied', appliedByName: PM, summary: { rows: 3, updated: 1 } });
    await expect(cancelImportJob(id, PM)).rejects.toThrow('already imported');
    expect((await listImportJobs({ projectCode: 'HLT-026' })).map((x) => x.id)).toContain(id);
  });
});

describe('client communication log', () => {
  it('logs exchanges per project with follow-ups', async () => {
    const n1 = await addClientCommunication('HLT-026', { occurredOn: '2026-09-24', channel: 'phone', contactName: 'N. Bensaïd', subject: 'Crane delivery date', followUpOwner: 'R. Aubert', followUpDueOn: '2026-09-30' }, PM);
    const n2 = await addClientCommunication('HLT-026', { occurredOn: '2026-09-25', channel: 'email', direction: 'inbound', contactName: 'N. Bensaïd', subject: 'Paving access' }, PM);
    expect([n1, n2]).toEqual(['COM-001', 'COM-002']);
    const list = await listClientCommunications('HLT-026');
    expect(list.map((c) => [c.number, c.channelLabel, c.directionLabel, c.followUpOwner])).toEqual([['COM-002', 'E-mail', 'From the client', null], ['COM-001', 'Phone', 'To the client', 'Romain Aubert']]);
    expect((await openClientFollowUps('HLT-026')).map((c) => c.number)).toEqual(['COM-001']);
    await setClientCommunicationFollowUpDone('HLT-026', 'COM-001', true, PM);
    expect(await openClientFollowUps('HLT-026')).toEqual([]);
    await expect(addClientCommunication('HLT-026', { occurredOn: '2026-09-25', channel: 'pigeon' as never, contactName: 'x', subject: 'y' }, PM)).rejects.toThrow('Unknown channel');
    await expect(addClientCommunication('HLT-026', { occurredOn: '', channel: 'email', contactName: 'x', subject: 'y' }, PM)).rejects.toThrow('date');
    expect(await listClientCommunications('NDC-031')).toEqual([]);
  });
});

describe('what-if persistence and draft requests', () => {
  it('scenario actions, result, apply → draft requests outside the department queue until sent', async () => {
    await replaceScenarioActions('HLT-026', 'A', [
      { kind: 'overtime', activityCode: 'A1250', params: { hoursPerDay: 10 }, label: 'Overtime 10 h/d on A1250' },
      { kind: 'extra_resource', activityCode: 'A1260', department: 'Engineering', params: { extraUnits: 1 } },
    ], PM);
    expect((await listScenarioActions('HLT-026', 'A')).map((a) => [a.kind, a.activityCode, a.department, a.params])).toEqual([
      ['overtime', 'A1250', null, { hoursPerDay: 10 }], ['extra_resource', 'A1260', 'Engineering', { extraUnits: 1 }],
    ]);
    await expect(replaceScenarioActions('HLT-026', 'A', [{ kind: 'overtime', activityCode: 'A9999', params: {} }], PM)).rejects.toThrow('Unknown activity');
    await saveScenarioResult('HLT-026', 'A', { finish: '2027-01-08', costDeltaKeur: 42 });
    const db = await getDb();
    const number = await db.transaction(async (tx) => {
      const scenarioId = await markScenarioApplied('HLT-026', 'A', PM, tx);
      return scenarioId;
    }).then((scenarioId) => createResourceRequest({ projectCode: 'HLT-026', title: 'Overtime crew', activityCode: 'A1250', person: 'J. Wagner', hours: 40, priority: 'high', draft: true, scenarioId }, 'R. Aubert'));
    const [r] = await db.select().from(resourceRequests).where(eq(resourceRequests.number, number));
    expect([r.status, !!r.scenarioId]).toEqual(['draft', true]);
    const dept = (await getDepartmentApprovals('Engineering'))!;
    expect([...dept.pending, ...dept.decided].some((x) => x.id === number)).toBe(false);
    await sendDraftRequest(number, 'R. Aubert');
    expect((await getDepartmentApprovals('Engineering'))!.pending.some((x) => x.id === number)).toBe(true);
    await expect(discardDraftRequest(number, 'R. Aubert')).rejects.toThrow('not a draft');
  });
});

describe('connector configuration', () => {
  it('saves Keystone-side settings and audits each change', async () => {
    await updateConnectorConfig('Lucca', { frequency: 'Daily 07:00', enabled: false, direction: 'import' }, DIRECTOR);
    expect(await getConnectorConfig('Lucca')).toMatchObject({ frequency: 'Daily 07:00', enabled: false, direction: 'import', configuredByName: DIRECTOR });
    const db = await getDb();
    const [a] = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'Connector Lucca'));
    expect(a.change).toBe('frequency: Daily 06:30 → Daily 07:00 · direction: — → import · disabled');
    await expect(updateConnectorConfig('Lucca', { frequency: '' }, DIRECTOR)).rejects.toThrow('frequency');
    await expect(updateConnectorConfig('Nope', { enabled: true }, DIRECTOR)).rejects.toThrow('Unknown connector');
    expect((await db.select({ e: connectors.enabled }).from(connectors).where(eq(connectors.name, 'Vigie')))[0].e).toBe(true);
  });
});

describe('task attachments', () => {
  it('attaches, downloads and removes a stored file', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 test');
    const id = await attachTaskFile('T-2314', { name: 'Torque report.pdf', data: pdf }, 'Julien Wagner');
    const files = await listTaskFiles('T-2314');
    expect(files.at(-1)).toMatchObject({ id, name: 'Torque report.pdf', sizeText: '13 B', kind: 'pdf', uploadedBy: 'J. Wagner', uploadedOn: '2026-09-25', hasFile: true });
    expect(files.filter((f) => !f.hasFile).length).toBeGreaterThan(0); // the seed's FILES rows
    const got = await getTaskFile('T-2314', id);
    expect(got!.meta.ownerType).toBe('task_attachment');
    expect(Buffer.from(got!.data).toString()).toBe('%PDF-1.4 test');
    expect(await getTaskFile('T-2318', id)).toBeNull();
    await removeTaskFile('T-2314', id, 'Julien Wagner');
    expect((await listTaskFiles('T-2314')).some((f) => f.id === id)).toBe(false);
    expect(await (await getDb()).select().from(storedFiles)).toHaveLength(0);
    await expect(attachTaskFile('T-2314', { name: 'virus.exe', data: pdf }, 'Julien Wagner')).rejects.toThrow('File type not accepted');
  });
});
