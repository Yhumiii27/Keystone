// R-064 (S-5, technical part): positions after a restore — "ghost slots". Work packages and activities share one position
// sequence per project; a removed row keeps its slot while it waits in the Plan trash (inserts below it shift it with the live
// rows, a new work package goes after it), so a restore lands between the same neighbours with unique positions; a stored slot
// taken anyway is freed by shifting the block; a restored link whose place among its successor's predecessors was taken goes
// last. Own seeded in-memory database (HLT-026).
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, activityLinks, projects, wbsNodes } from '@/server/db/schema';
import { PLAN_TRASH_MAX_ENTRIES as CH4_MAX, PLAN_TRASH_RETENTION_DAYS as CH4_DAYS } from '@/domain/ch4-defaults';
import { getPackageOrder, getPlanData, insertActivity, insertWorkPackage, reorderActivities, updateActivity, type NewActivity } from './plan';
import { PLAN_TRASH_MAX_ENTRIES, PLAN_TRASH_RETENTION_DAYS, restorePlanTrash, trashPlanRow } from './plan-trash';

const PM = 'Romain Aubert';
const CODE = 'HLT-026';

const newAct = (id: string, wbs: string): NewActivity => ({
  id, wbs, name: `Inserted ${id}`, durationDays: 5, ownerCode: 'RA', start: '', startDate: null, finish: '', finishDate: null, budget: 0, totalFloat: 0, critical: false,
  description: '',
});

/** Positions of the project's work packages and activities: every one must be unique. */
async function positions() {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, CODE));
  const nodes = await db.select({ code: wbsNodes.code, position: wbsNodes.position }).from(wbsNodes).where(eq(wbsNodes.projectId, p.id));
  const acts = await db.select({ code: activities.code, position: activities.position }).from(activities).where(eq(activities.projectId, p.id));
  return [...nodes, ...acts];
}
const unique = async () => {
  const all = (await positions()).map((r) => r.position);
  return new Set(all).size === all.length;
};
/** Display order of a work package's activities (the Plan reads them by position). */
const order = async (wbs: string) => (await getPlanData(CODE))!.activities.filter((a) => a.wbs === wbs).map((a) => a.id);
const packagesOrder = async () => (await getPlanData(CODE))!.packages.map((p) => p.code);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-064 — plan trash positions (ghost slots)', () => {
  it('the S-5 limits live in ch4-defaults (30 days, 20 entries), re-exported by the trash', () => {
    expect([PLAN_TRASH_RETENTION_DAYS, PLAN_TRASH_MAX_ENTRIES]).toEqual([CH4_DAYS, CH4_MAX]);
    expect([CH4_DAYS, CH4_MAX]).toEqual([30, 20]);
  });

  it('remove A1250, insert in an earlier package and in its own package, restore: A1250 back between A1240 and A1260, unique positions', async () => {
    const before = await order('1.4');
    const i = before.indexOf('A1250');
    expect(before.slice(i - 1, i + 2)).toEqual(['A1240', 'A1250', 'A1260']);
    const earlier = (await packagesOrder()).find((w) => w !== '1.4')!;
    expect(await unique()).toBe(true);

    const id = (await trashPlanRow(CODE, 'act', 'A1250', PM))!;
    expect(await insertActivity(CODE, newAct('A1981', earlier))).toBe(true);
    expect(await insertActivity(CODE, newAct('A1982', '1.4'))).toBe(true);
    expect(await restorePlanTrash(CODE, id, PM)).toMatchObject({ ok: true, code: 'A1250' });

    expect(await unique()).toBe(true);
    const after = await order('1.4');
    expect(after).toEqual([...before, 'A1982']);
    expect((await order(earlier)).at(-1)).toBe('A1981');
    // "Move up" swaps it with A1240 (positions reused inside the package).
    const pkg = (await getPackageOrder(CODE, 'A1250'))!;
    const j = pkg.ids.indexOf('A1250');
    const swapped = [...pkg.ids];
    [swapped[j - 1], swapped[j]] = [swapped[j], swapped[j - 1]];
    expect(await reorderActivities(CODE, '1.4', swapped)).toBe(true);
    expect((await order('1.4')).slice(j - 1, j + 1)).toEqual(['A1250', 'A1240']);
    expect(await unique()).toBe(true);
    expect(await reorderActivities(CODE, '1.4', pkg.ids)).toBe(true);
  });

  it('the last work package removed, then a new package added: the restored one comes back before it, unique positions', async () => {
    const pkgs = await packagesOrder();
    const last = pkgs.at(-1)!;
    const lastActs = await order(last);
    const id = (await trashPlanRow(CODE, 'wp', last, PM))!;
    expect(await insertWorkPackage(CODE, { code: '1.98', name: 'Commissioning support', ownerName: 'Romain Aubert', scope: '' })).toBe(true);
    expect(await restorePlanTrash(CODE, id, PM)).toMatchObject({ ok: true, kind: 'wp', code: last });
    expect(await unique()).toBe(true);
    expect(await packagesOrder()).toEqual([...pkgs, '1.98']);
    expect(await order(last)).toEqual(lastActs);
  });

  it('a restored link whose place among its successor’s predecessors was taken goes last; positions per successor stay unique', async () => {
    const data = (await getPlanData(CODE))!;
    const succ = data.activities.find((a) => a.preds.some((l) => l[0] === 'A1250'))!;
    const others = data.activities.filter((a) => a.id !== 'A1250' && a.id !== succ.id && !succ.preds.some((l) => l[0] === a.id)).slice(0, 3);
    const id = (await trashPlanRow(CODE, 'act', 'A1250', PM))!;
    // The successor's logic is rewritten meanwhile: its predecessors now take positions 0, 1, 2…
    const kept = (await getPlanData(CODE))!.activities.find((a) => a.id === succ.id)!.preds;
    expect(await updateActivity(CODE, succ.id, { preds: [...kept, ...others.map((o) => [o.id, 'FS', 0] as [string, 'FS', number])] })).toBe(true);
    expect(await restorePlanTrash(CODE, id, PM)).toMatchObject({ ok: true });
    const db = await getDb();
    const [s] = await db.select({ id: activities.id }).from(activities).where(eq(activities.code, succ.id));
    const links = await db.select({ position: activityLinks.position, pred: activityLinks.predecessorId }).from(activityLinks).where(eq(activityLinks.successorId, s.id));
    const ps = links.map((l) => l.position);
    expect(new Set(ps).size).toBe(ps.length);
    const [a1250] = await db.select({ id: activities.id }).from(activities).where(eq(activities.code, 'A1250'));
    expect(links.find((l) => l.pred === a1250.id)!.position).toBe(Math.max(...ps));
    expect((await getPlanData(CODE))!.activities.find((a) => a.id === succ.id)!.preds.at(-1)![0]).toBe('A1250');
  });

  it('defensive fallback: a stored slot taken anyway (a writer that did not shift the trash) — the block is freed first', async () => {
    const before = await order('1.4');
    const id = (await trashPlanRow(CODE, 'act', 'A1250', PM))!;
    const db = await getDb();
    // Simulate an importer that renumbered without the trash: A1260 takes A1250's stored slot.
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, CODE));
    const slot = (await positions()).find((r) => r.code === 'A1240')!.position + 1;
    await db.update(activities).set({ position: slot }).where(and(eq(activities.projectId, p.id), eq(activities.code, 'A1260')));
    expect(await unique()).toBe(true);
    expect(await restorePlanTrash(CODE, id, PM)).toMatchObject({ ok: true });
    expect(await unique()).toBe(true);
    expect(await order('1.4')).toEqual(before);
  });
});
