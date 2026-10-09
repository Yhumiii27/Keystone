// Plan trash (chapter 4, S-5 "confirmation and keep the possibility to undo") on a seeded in-memory database: a work package
// or an activity leaves every table with its links, assignments, Plan to-dos and Schedule bar in one transaction; other modules
// lose only their reference; the CPM network and the Plan no longer see it; restoring puts every row back exactly (ids, types,
// lags, positions, driving flags, assignments, to-dos, references). Also: code conflicts, a removed parent, links to an activity
// removed later, and the purge rule (retention days, maximum entries).
import { beforeAll, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import {
  activities, activityAssignments, activityLinks, baselineActivities, changeRequestWbs, milestones, planTrash, projects, requestActivityChoices, resourceRequests,
  risks, scheduleBars, taskChecklistItems, tasks, wbsNodes, whatIfScenarioActions, wpBudgets,
} from '@/server/db/schema';
import { addActivityTodo, listActivityTodos } from './activity-todos';
import { getPlanData, insertActivity } from './plan';
import { PLAN_TRASH_MAX_ENTRIES, PLAN_TRASH_RETENTION_DAYS, listPlanTrash, restorePlanTrash, trashPlanRow } from './plan-trash';
import { loadScheduleNetwork } from './schedule-network';

const PM = 'Romain Aubert';
const DAY = 86_400_000;

/** Every row of the tables a removal touches, in a stable order (JSON for exact comparison, dates included). */
async function dump() {
  const db = await getDb();
  const tables: PgTable[] = [
    wbsNodes, activities, activityLinks, activityAssignments, tasks, taskChecklistItems, scheduleBars, milestones, wpBudgets, changeRequestWbs, baselineActivities,
    resourceRequests, requestActivityChoices, whatIfScenarioActions, risks,
  ];
  const out: Record<string, string[]> = {};
  for (const t of tables) out[getTableConfig(t).name] = ((await db.select().from(t)) as unknown[]).map((r) => JSON.stringify(r)).sort();
  return out;
}

const plan = async () => (await getPlanData('HLT-026'))!;

describe('Plan trash', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('removes work package 1.4 with everything that belongs to it, and restores it exactly', async () => {
    const db = await getDb();
    // A Plan to-do on one of its activities (goes with it) next to the seed tasks (managed in My work: unlinked, then re-linked).
    const todo = await addActivityTodo('HLT-026', 'A1250', { title: 'Check bolt torque — bay 4' }, PM);
    await db.insert(taskChecklistItems).values({ taskId: (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.number, todo)))[0].id, position: 0, text: 'Torque wrench calibrated', done: false });
    const before = await dump();
    const p0 = await plan();
    const acts14 = p0.activities.filter((a) => a.wbs === '1.4').map((a) => a.id);
    expect(acts14.length).toBeGreaterThan(1);
    const linksBefore = p0.activities.flatMap((a) => a.preds.map((l) => [l[0], a.id, l[1], l[2]] as const)).filter(([pr, su]) => acts14.includes(pr) || acts14.includes(su));
    expect(linksBefore.length).toBeGreaterThan(0);
    const seedTodos = (await listActivityTodos('HLT-026', 'A1250')).filter((t) => t.number !== todo).map((t) => t.number);
    expect(seedTodos.length).toBeGreaterThan(0);

    const id = await trashPlanRow('HLT-026', 'wp', '1.4', PM);
    expect(id).toEqual(expect.any(String));

    // Gone from the Plan, the CPM network and the tables; the links of the remaining activities to them are gone too.
    const p1 = await plan();
    expect(p1.packages.some((p) => p.code === '1.4')).toBe(false);
    expect(p1.activities.some((a) => acts14.includes(a.id))).toBe(false);
    expect(p1.activities.flatMap((a) => a.preds.map((l) => l[0])).some((c) => acts14.includes(c))).toBe(false);
    const net = (await loadScheduleNetwork('HLT-026'))!;
    expect(net.activities.some((a) => acts14.includes(a.code))).toBe(false);
    const [{ n: assignmentsLeft }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(activityAssignments)
      .innerJoin(activities, eq(activities.id, activityAssignments.activityId))
      .where(sql`${activities.code} in ${acts14}`);
    expect(assignmentsLeft).toBe(0);
    expect(await db.select().from(tasks).where(eq(tasks.number, todo))).toEqual([]);
    const seedRows = await db.select({ number: tasks.number, activityId: tasks.activityId }).from(tasks).where(sql`${tasks.number} in ${seedTodos}`);
    expect(seedRows.every((t) => t.activityId === null)).toBe(true);
    expect((await db.select().from(wbsNodes).innerJoin(projects, eq(projects.id, wbsNodes.projectId)).where(sql`${projects.code} = 'HLT-026' and ${wbsNodes.code} = '1.4'`)).length).toBe(0);
    expect(before.schedule_bars.length - (await db.select().from(scheduleBars)).length).toBe(1);

    // Recently deleted.
    expect(await listPlanTrash('HLT-026')).toEqual([expect.objectContaining({ id, kind: 'wp', code: '1.4', name: 'Steel structure', activityCount: acts14.length, deletedByName: PM })]);

    // Restore: every row back, byte for byte (ids, link types / lags / positions / driving flags, assignments, to-dos, references).
    const r = await restorePlanTrash('HLT-026', id!, PM);
    expect(r).toEqual({ ok: true, kind: 'wp', code: '1.4', name: 'Steel structure', activityCount: acts14.length, links: linksBefore.length });
    expect(await dump()).toEqual(before);
    expect((await plan()).activities.flatMap((a) => a.preds.map((l) => [l[0], a.id, l[1], l[2]] as const)).filter(([pr, su]) => acts14.includes(pr) || acts14.includes(su))).toEqual(linksBefore);
    expect((await listActivityTodos('HLT-026', 'A1250')).some((t) => t.number === todo)).toBe(true);
    expect(await listPlanTrash('HLT-026')).toEqual([]);
    expect(await restorePlanTrash('HLT-026', id!, PM)).toEqual({ error: 'unknown' });
  });

  it('removes and restores one activity with its links in both directions (types and lags)', async () => {
    const before = await dump();
    const preds = (await plan()).activities.find((a) => a.id === 'A1250')!.preds;
    const succs = (await plan()).activities.filter((a) => a.preds.some((l) => l[0] === 'A1250')).map((a) => [a.id, a.preds.find((l) => l[0] === 'A1250')]);
    expect(preds.length + succs.length).toBeGreaterThan(0);
    const id = (await trashPlanRow('HLT-026', 'act', 'A1250', PM))!;
    expect((await plan()).activities.some((a) => a.preds.some((l) => l[0] === 'A1250'))).toBe(false);
    expect(await restorePlanTrash('HLT-026', id, PM)).toMatchObject({ ok: true, kind: 'act', code: 'A1250', activityCount: 1, links: preds.length + succs.length });
    expect(await dump()).toEqual(before);
    expect((await plan()).activities.find((a) => a.id === 'A1250')!.preds).toEqual(preds);
  });

  it('a Plan to-do whose number was given to a new task since takes the next free number', async () => {
    const db = await getDb();
    const todo = await addActivityTodo('HLT-026', 'A1250', { title: 'Weld inspection' }, PM);
    const id = (await trashPlanRow('HLT-026', 'act', 'A1250', PM))!;
    expect(await db.select().from(tasks).where(eq(tasks.number, todo))).toEqual([]);
    const other = await addActivityTodo('HLT-026', 'A1260', { title: 'Roof check' }, PM);
    // The new task takes the removed to-do's number (as the global sequence may do once the to-do left the table).
    await db.update(tasks).set({ number: todo }).where(eq(tasks.number, other));
    expect(await restorePlanTrash('HLT-026', id, PM)).toMatchObject({ ok: true });
    const mine = (await listActivityTodos('HLT-026', 'A1250')).find((t) => t.title === 'Weld inspection')!;
    expect(mine.number).not.toBe(todo);
    expect(mine.number).toMatch(/^T-\d{4}$/);
    expect((await db.select().from(tasks).where(eq(tasks.number, mine.number))).length).toBe(1);
    await db.delete(tasks).where(sql`${tasks.number} in ${[mine.number, todo]}`);
  });

  it('a link to an activity removed later waits for that activity; restoring both brings every link back', async () => {
    const before = await dump();
    const succ = (await plan()).activities.find((a) => a.preds.some((l) => l[0] === 'A1250'))!;
    const a = (await trashPlanRow('HLT-026', 'act', 'A1250', PM))!;
    const b = (await trashPlanRow('HLT-026', 'act', succ.id, PM))!;
    expect(await restorePlanTrash('HLT-026', a, PM)).toMatchObject({ ok: true });
    expect((await plan()).activities.find((x) => x.id === succ.id)).toBeUndefined();
    expect(await restorePlanTrash('HLT-026', b, PM)).toMatchObject({ ok: true });
    expect(await dump()).toEqual(before);
  });

  it('refuses a restore when the code was reused, or when the work package of an activity is gone', async () => {
    const db = await getDb();
    const a = (await trashPlanRow('HLT-026', 'act', 'A1260', PM))!;
    expect(await insertActivity('HLT-026', { id: 'A1260', wbs: '1.4', name: 'Reused code', durationDays: 5, ownerCode: 'RA', start: '', startDate: null, finish: '', finishDate: null, budget: 0, totalFloat: 0, critical: false, description: '' })).toBe(true);
    expect(await restorePlanTrash('HLT-026', a, PM)).toEqual({ error: 'conflict', code: 'A1260' });
    await db.delete(activities).where(eq(activities.code, 'A1260'));
    expect(await restorePlanTrash('HLT-026', a, PM)).toMatchObject({ ok: true, code: 'A1260' });

    const before = await dump();
    const act = (await trashPlanRow('HLT-026', 'act', 'A1310', PM))!;
    const wp = (await trashPlanRow('HLT-026', 'wp', '1.5', PM))!;
    expect(await restorePlanTrash('HLT-026', act, PM)).toEqual({ error: 'parent', code: 'A1310' });
    expect(await restorePlanTrash('HLT-026', wp, PM)).toMatchObject({ ok: true, kind: 'wp' });
    expect(await restorePlanTrash('HLT-026', act, PM)).toMatchObject({ ok: true, kind: 'act' });
    expect(await dump()).toEqual(before);
    // Wrong project, unknown node, the WBS root.
    expect(await restorePlanTrash('NDC-031', act, PM)).toEqual({ error: 'unknown' });
    expect(await trashPlanRow('HLT-026', 'wp', '1', PM)).toBeNull();
    expect(await trashPlanRow('HLT-026', 'act', 'A0000', PM)).toBeNull();
  });

  it(`purge: rows older than ${PLAN_TRASH_RETENTION_DAYS} days go at the next removal and can no longer be restored; at most ${PLAN_TRASH_MAX_ENTRIES} kept`, async () => {
    const db = await getDb();
    const now = new Date('2026-10-09T10:00:00Z');
    const old = (await trashPlanRow('HLT-026', 'act', 'A1610', PM, new Date(now.getTime() - (PLAN_TRASH_RETENTION_DAYS + 1) * DAY)))!;
    // Expired but not purged yet: not listed, not restorable.
    expect((await listPlanTrash('HLT-026', { now })).some((e) => e.id === old)).toBe(false);
    expect(await restorePlanTrash('HLT-026', old, PM, now)).toEqual({ error: 'unknown' });
    const recent = (await trashPlanRow('HLT-026', 'act', 'A1620', PM, now))!;
    const ids = (await db.select({ id: planTrash.id }).from(planTrash)).map((r) => r.id);
    expect(ids).toContain(recent);
    expect(ids).not.toContain(old);
    expect(await restorePlanTrash('HLT-026', recent, PM, now)).toMatchObject({ ok: true });

    // Maximum entries per project: the oldest beyond the cap are purged.
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    await db.insert(planTrash).values(
      Array.from({ length: PLAN_TRASH_MAX_ENTRIES + 3 }, (_, i) => ({
        projectId: p.id, kind: 'act' as const, code: `A9${String(i).padStart(3, '0')}`, name: 'Old', activityCount: 1, payload: { v: 1, tables: [], refs: [] },
        deletedAt: new Date(now.getTime() - (i + 1) * 60_000), deletedByName: PM,
      })),
    );
    const last = (await trashPlanRow('HLT-026', 'act', 'A1020', PM, now))!;
    const left = await db.select({ id: planTrash.id, code: planTrash.code }).from(planTrash).where(eq(planTrash.projectId, p.id)).orderBy(asc(planTrash.deletedAt));
    expect(left.length).toBe(PLAN_TRASH_MAX_ENTRIES);
    expect(left.at(-1)!.id).toBe(last);
    expect(left.some((r) => r.code === 'A9000')).toBe(true);
    expect(left.some((r) => r.code === `A9${String(PLAN_TRASH_MAX_ENTRIES + 2).padStart(3, '0')}`)).toBe(false);
    expect((await listPlanTrash('HLT-026', { now })).length).toBe(5);
    expect(await restorePlanTrash('HLT-026', last, PM, now)).toMatchObject({ ok: true });
  });
});
