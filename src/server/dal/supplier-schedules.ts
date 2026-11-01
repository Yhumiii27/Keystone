import 'server-only';
// R-204 — supplier schedules (src/domain/supplier-schedule.ts): one per purchase order (the purchasing package), its milestones /
// activities with the supplier's committed dates and the progress the buyer enters, its internal logic, and the ties that
// consolidate it into the project CPM (src/server/dal/schedule-network.ts). The Server Functions check the rights
// (`canEditSupplierSchedule`, `canTieSupplierSchedule`); every writer validates with the pure rules inside its transaction
// (logic loops through the whole network refused) and writes an audit row.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { IsoDate } from '@/domain/calendar';
import {
  checkSupplierLink, checkSupplierTie, parseSupplierActivity, parseSupplierProgress, type SupplierError, type SupplierScheduleInput,
} from '@/domain/supplier-schedule';
import { getDb, type DB, type Tx } from '@/server/db/client';
import type { LinkType, PoStatus } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  activities, activityLinks, purchaseOrders, suppliers, supplierScheduleActivities, supplierScheduleLinks, supplierScheduleTies, supplierSchedules,
  type SupplierTieDirection,
} from '@/server/db/schema';
import type { Actor } from './ops-common';

type Q = DB | Tx;

export interface SupplierActivityRow {
  id: string;
  code: string;
  name: string;
  durationDays: number;
  committedStart: string | null;
  committedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number;
  position: number;
}

export interface SupplierScheduleRow {
  id: string;
  poId: string;
  poNumber: string;
  poStatus: PoStatus;
  supplierName: string;
  /** Expected delivery of the order (purchase_orders.expected_on). */
  expectedOn: string | null;
  activities: SupplierActivityRow[];
  links: { id: string; pred: string; succ: string; type: LinkType; lag: number }[];
  ties: { id: string; supplier: string; activity: string; activityName: string; direction: SupplierTieDirection; lag: number }[];
  /** Ready for the pure rules. */
  input: SupplierScheduleInput;
}

const toInput = (s: Omit<SupplierScheduleRow, 'input'>): SupplierScheduleInput => ({
  po: s.poNumber,
  activities: s.activities.map((a) => ({
    code: a.code, name: a.name, duration: a.durationDays, committedStart: a.committedStart, committedFinish: a.committedFinish, actualStart: a.actualStart,
    actualFinish: a.actualFinish, pct: a.percentComplete,
  })),
  links: s.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })),
  ties: s.ties.map((t) => ({ supplier: t.supplier, activity: t.activity, direction: t.direction, lag: t.lag })),
});

/** The supplier schedules of a project (by project id), in purchase order order. */
export async function supplierSchedulesOf(q: Q, projectId: string): Promise<SupplierScheduleRow[]> {
  const heads = await q
    .select({ id: supplierSchedules.id, poId: purchaseOrders.id, poNumber: purchaseOrders.number, poStatus: purchaseOrders.status, supplierName: suppliers.name, expectedOn: purchaseOrders.expectedOn })
    .from(supplierSchedules)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, supplierSchedules.poId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(supplierSchedules.projectId, projectId))
    .orderBy(asc(purchaseOrders.position), asc(purchaseOrders.number));
  if (!heads.length) return [];
  const ids = heads.map((h) => h.id);
  const [acts, links, ties] = await Promise.all([
    q.select().from(supplierScheduleActivities).where(inArray(supplierScheduleActivities.scheduleId, ids)).orderBy(asc(supplierScheduleActivities.position), asc(supplierScheduleActivities.code)),
    q.select().from(supplierScheduleLinks).where(inArray(supplierScheduleLinks.scheduleId, ids)),
    q
      .select({ t: supplierScheduleTies, code: activities.code, name: activities.name })
      .from(supplierScheduleTies)
      .innerJoin(activities, eq(activities.id, supplierScheduleTies.activityId))
      .where(inArray(supplierScheduleTies.scheduleId, ids))
      .orderBy(asc(activities.position)),
  ]);
  const codeOf = new Map(acts.map((a) => [a.id, a.code]));
  return heads.map((h) => {
    const base = {
      ...h,
      activities: acts.filter((a) => a.scheduleId === h.id).map((a) => ({
        id: a.id, code: a.code, name: a.name, durationDays: a.durationDays, committedStart: a.committedStart, committedFinish: a.committedFinish, actualStart: a.actualStart,
        actualFinish: a.actualFinish, percentComplete: a.percentComplete, position: a.position,
      })),
      links: links.filter((l) => l.scheduleId === h.id).map((l) => ({ id: l.id, pred: codeOf.get(l.predecessorId)!, succ: codeOf.get(l.successorId)!, type: l.type, lag: l.lagDays })),
      ties: ties.filter((x) => x.t.scheduleId === h.id).map((x) => ({ id: x.t.id, supplier: codeOf.get(x.t.supplierActivityId)!, activity: x.code, activityName: x.name, direction: x.t.direction, lag: x.t.lagDays })),
    };
    return { ...base, input: toInput(base) };
  });
}

/** The supplier schedules of a project (by code); [] for an unknown project. */
export async function listSupplierSchedules(projectCode: string, q?: Q): Promise<SupplierScheduleRow[]> {
  const db = q ?? (await getDb());
  const p = await requireProject(db, projectCode).catch(() => null);
  return p ? supplierSchedulesOf(db, p.id) : [];
}

// ── Writers ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class SupplierScheduleError extends Error {
  constructor(
    readonly code: SupplierError | 'unknownOrder' | 'exists' | 'noSchedule' | 'cancelled',
    readonly cycle?: string[],
  ) {
    super(code);
  }
}

/** The standard steps of a new schedule (English source names; durations in working days, the delivery a milestone). */
export const SUPPLIER_TEMPLATE: readonly { code: string; name: string; duration: number }[] = [
  { code: 'F10', name: 'Drawings approval', duration: 10 },
  { code: 'F20', name: 'Manufacturing', duration: 40 },
  { code: 'F30', name: 'Factory acceptance test (FAT)', duration: 3 },
  { code: 'F40', name: 'Shipment', duration: 5 },
  { code: 'F50', name: 'Delivery', duration: 0 },
];

interface Ctx {
  tx: Tx;
  project: { id: string; code: string };
  po: { id: string; number: string; status: PoStatus; expectedOn: string | null };
  who: { name: string; personId: string | null };
}

async function context(tx: Tx, projectCode: string, poNumber: string, actor: Actor): Promise<Ctx> {
  const project = await requireProject(tx, projectCode);
  const [po] = await tx
    .select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, expectedOn: purchaseOrders.expectedOn })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.projectId, project.id), eq(purchaseOrders.number, poNumber)))
    .for('update');
  if (!po) throw new SupplierScheduleError('unknownOrder');
  const person = await findPerson(tx, actor.name);
  return { tx, project, po, who: { name: person ? nameOf(person) : actor.name, personId: person?.id ?? null } };
}

async function scheduleOf(c: Ctx) {
  const [s] = await c.tx.select({ id: supplierSchedules.id }).from(supplierSchedules).where(eq(supplierSchedules.poId, c.po.id));
  if (!s) throw new SupplierScheduleError('noSchedule');
  return s.id;
}

const audit = (c: Ctx, change: string, extra: { before?: Record<string, unknown>; after?: Record<string, unknown>; entityId?: string } = {}) =>
  writeAudit(c.tx, {
    actorName: c.who.name, actorPersonId: c.who.personId, objectRef: `${c.project.code} · ${c.po.number}`, change, area: 'Purchase orders', entityType: 'supplier_schedule',
    entityId: extra.entityId, projectId: c.project.id, before: extra.before, after: extra.after,
  });

const touch = (c: Ctx, scheduleId: string) => c.tx.update(supplierSchedules).set({ updatedAt: new Date() }).where(eq(supplierSchedules.id, scheduleId));

/** The project's activities and links and the other supplier schedules (loop checks). */
async function networkOf(c: Ctx) {
  const [acts, links, all] = await Promise.all([
    c.tx.select({ id: activities.id, code: activities.code }).from(activities).where(eq(activities.projectId, c.project.id)),
    c.tx.select({ pred: activityLinks.predecessorId, succ: activityLinks.successorId }).from(activityLinks).where(eq(activityLinks.projectId, c.project.id)),
    supplierSchedulesOf(c.tx, c.project.id),
  ]);
  const codeOf = new Map(acts.map((a) => [a.id, a.code]));
  const project = { ids: acts.map((a) => a.code), links: links.map((l) => ({ pred: codeOf.get(l.pred)!, succ: codeOf.get(l.succ)! })), idOf: new Map(acts.map((a) => [a.code, a.id])) };
  const mine = all.find((s) => s.poNumber === c.po.number);
  if (!mine) throw new SupplierScheduleError('noSchedule');
  return { project, mine, others: all.filter((s) => s !== mine).map((s) => s.input) };
}

/**
 * Creates the supplier schedule of an order: empty, or with the standard steps (chained finish-to-start; the delivery's
 * committed date is the order's expected delivery when known). A cancelled order gets none.
 */
export async function createSupplierSchedule(projectCode: string, poNumber: string, opts: { template: boolean }, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    if (c.po.status === 'cancelled') throw new SupplierScheduleError('cancelled');
    const [had] = await tx.select({ id: supplierSchedules.id }).from(supplierSchedules).where(eq(supplierSchedules.poId, c.po.id));
    if (had) throw new SupplierScheduleError('exists');
    const [s] = await tx.insert(supplierSchedules).values({ projectId: c.project.id, poId: c.po.id, createdByPersonId: c.who.personId }).returning({ id: supplierSchedules.id });
    if (opts.template) {
      const rows = await tx
        .insert(supplierScheduleActivities)
        .values(SUPPLIER_TEMPLATE.map((a, i) => ({
          scheduleId: s.id, code: a.code, name: a.name, durationDays: a.duration, position: i,
          ...(a.duration === 0 && c.po.expectedOn ? { committedStart: c.po.expectedOn, committedFinish: c.po.expectedOn } : {}),
        })))
        .returning({ id: supplierScheduleActivities.id, position: supplierScheduleActivities.position });
      rows.sort((x, y) => x.position - y.position);
      await tx.insert(supplierScheduleLinks).values(rows.slice(1).map((r, i) => ({ scheduleId: s.id, predecessorId: rows[i].id, successorId: r.id, type: 'FS' as const, lagDays: 0 })));
    }
    await audit(c, `supplier schedule created${opts.template ? ' (standard steps)' : ''}`, { entityId: s.id });
    await recordActivity(tx, { actorName: c.who.name, actorPersonId: c.who.personId, text: `Supplier schedule created · ${c.po.number}`, kind: 'change', projectId: c.project.id });
  });
}

/** Removes the supplier schedule of an order (its activities, links and ties). */
export async function removeSupplierSchedule(projectCode: string, poNumber: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const id = await scheduleOf(c);
    const acts = await tx.select({ code: supplierScheduleActivities.code }).from(supplierScheduleActivities).where(eq(supplierScheduleActivities.scheduleId, id));
    await tx.delete(supplierSchedules).where(eq(supplierSchedules.id, id));
    await audit(c, 'supplier schedule removed', { entityId: id, before: { activities: acts.map((a) => a.code) } });
    await recordActivity(tx, { actorName: c.who.name, actorPersonId: c.who.personId, text: `Supplier schedule removed · ${c.po.number}`, kind: 'change', projectId: c.project.id });
  });
}

/**
 * Adds a supplier activity (at the end; finish-to-start after the current last one when `chain`) or updates the plan of an
 * existing one (`code` = its current code): code, name, duration, committed dates.
 */
export async function saveSupplierActivity(projectCode: string, poNumber: string, existing: string | null, input: Record<string, unknown>, opts: { chain: boolean }, actor: Actor): Promise<string> {
  const parsed = parseSupplierActivity(input);
  if (!parsed.ok) throw new SupplierScheduleError(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const id = await scheduleOf(c);
    const rows = await tx.select().from(supplierScheduleActivities).where(eq(supplierScheduleActivities.scheduleId, id)).orderBy(asc(supplierScheduleActivities.position)).for('update');
    const row = existing ? rows.find((r) => r.code === existing) : undefined;
    if (existing && !row) throw new SupplierScheduleError('unknown');
    if (rows.some((r) => r.code === v.code && r !== row)) throw new SupplierScheduleError('duplicate');
    const values = { code: v.code, name: v.name, durationDays: v.duration, committedStart: v.committedStart ?? null, committedFinish: v.committedFinish ?? null };
    if (row) {
      const before = { code: row.code, name: row.name, durationDays: row.durationDays, committedStart: row.committedStart, committedFinish: row.committedFinish };
      if (JSON.stringify(before) === JSON.stringify(values)) return row.code;
      await tx.update(supplierScheduleActivities).set({ ...values, updatedAt: new Date() }).where(eq(supplierScheduleActivities.id, row.id));
      await audit(c, `supplier activity ${row.code} updated`, { entityId: row.id, before, after: values });
    } else {
      const last = rows.at(-1);
      const [created] = await tx.insert(supplierScheduleActivities).values({ scheduleId: id, ...values, position: (last?.position ?? -1) + 1 }).returning({ id: supplierScheduleActivities.id });
      if (opts.chain && last) await tx.insert(supplierScheduleLinks).values({ scheduleId: id, predecessorId: last.id, successorId: created.id, type: 'FS', lagDays: 0 });
      await audit(c, `supplier activity ${v.code} added`, { entityId: created.id, after: values });
    }
    await touch(c, id);
    return v.code;
  });
}

/** Removes a supplier activity (its links and ties go with it). */
export async function removeSupplierActivity(projectCode: string, poNumber: string, code: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const id = await scheduleOf(c);
    const [row] = await tx.select().from(supplierScheduleActivities).where(and(eq(supplierScheduleActivities.scheduleId, id), eq(supplierScheduleActivities.code, code)));
    if (!row) throw new SupplierScheduleError('unknown');
    await tx.delete(supplierScheduleActivities).where(eq(supplierScheduleActivities.id, row.id));
    await audit(c, `supplier activity ${row.code} removed`, { entityId: row.id, before: { code: row.code, name: row.name, durationDays: row.durationDays } });
    await touch(c, id);
  });
}

/** Progress reported by the supplier (actual dates, % complete), entered by the buyer; actual dates never after `today`. */
export async function recordSupplierProgress(projectCode: string, poNumber: string, code: string, input: Record<string, unknown>, today: IsoDate, actor: Actor): Promise<void> {
  const parsed = parseSupplierProgress(input, today);
  if (!parsed.ok) throw new SupplierScheduleError(parsed.error);
  const v = parsed.value;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const id = await scheduleOf(c);
    const [row] = await tx.select().from(supplierScheduleActivities).where(and(eq(supplierScheduleActivities.scheduleId, id), eq(supplierScheduleActivities.code, code))).for('update');
    if (!row) throw new SupplierScheduleError('unknown');
    const before = { actualStart: row.actualStart, actualFinish: row.actualFinish, percentComplete: row.percentComplete };
    const after = { actualStart: v.actualStart ?? null, actualFinish: v.actualFinish ?? null, percentComplete: v.pct };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await tx.update(supplierScheduleActivities).set({ ...after, updatedAt: new Date() }).where(eq(supplierScheduleActivities.id, row.id));
    await audit(c, `supplier activity ${row.code} progress: ${before.percentComplete} % → ${after.percentComplete} %`, { entityId: row.id, before, after });
    await recordActivity(tx, { actorName: c.who.name, actorPersonId: c.who.personId, text: `${c.po.number} · ${row.code} ${row.name} · ${after.percentComplete} %`, kind: 'change', projectId: c.project.id });
    await touch(c, id);
  });
}

/** Adds a relationship inside the schedule (loops refused through the whole network). */
export async function addSupplierLink(projectCode: string, poNumber: string, link: { pred: string; succ: string; type: unknown; lag: unknown }, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const n = await networkOf(c);
    const r = checkSupplierLink(n.mine.input, link, n.project, n.others);
    if (!r.ok) throw new SupplierScheduleError(r.error, 'cycle' in r ? r.cycle : undefined);
    const idOf = new Map(n.mine.activities.map((a) => [a.code, a.id]));
    await tx.insert(supplierScheduleLinks).values({ scheduleId: n.mine.id, predecessorId: idOf.get(r.value.pred)!, successorId: idOf.get(r.value.succ)!, type: r.value.type, lagDays: r.value.lag });
    await audit(c, `supplier link added: ${r.value.pred} ${r.value.type}${r.value.lag ? `${r.value.lag > 0 ? '+' : ''}${r.value.lag}` : ''} → ${r.value.succ}`, { entityId: n.mine.id, after: { ...r.value } });
    await touch(c, n.mine.id);
  });
}

export async function removeSupplierLink(projectCode: string, poNumber: string, pred: string, succ: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const n = await networkOf(c);
    const l = n.mine.links.find((x) => x.pred === pred && x.succ === succ);
    if (!l) throw new SupplierScheduleError('unknown');
    await tx.delete(supplierScheduleLinks).where(eq(supplierScheduleLinks.id, l.id));
    await audit(c, `supplier link removed: ${pred} → ${succ}`, { entityId: n.mine.id, before: { pred, succ, type: l.type, lag: l.lag } });
    await touch(c, n.mine.id);
  });
}

/** Ties a supplier activity to a project activity (finish-to-start; loops refused through the whole network). */
export async function addSupplierTie(projectCode: string, poNumber: string, tie: { supplier: string; activity: string; direction: unknown; lag: unknown }, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const n = await networkOf(c);
    const r = checkSupplierTie(n.mine.input, tie, n.project, n.others);
    if (!r.ok) throw new SupplierScheduleError(r.error, 'cycle' in r ? r.cycle : undefined);
    const sid = n.mine.activities.find((a) => a.code === r.value.supplier)!.id;
    await tx.insert(supplierScheduleTies).values({ scheduleId: n.mine.id, supplierActivityId: sid, activityId: n.project.idOf.get(r.value.activity)!, direction: r.value.direction, lagDays: r.value.lag });
    const text = r.value.direction === 'to_project' ? `${c.po.number}/${r.value.supplier} → ${r.value.activity}` : `${r.value.activity} → ${c.po.number}/${r.value.supplier}`;
    await audit(c, `supplier schedule tied: ${text}${r.value.lag ? ` (lag ${r.value.lag})` : ''}`, { entityId: n.mine.id, after: { ...r.value } });
    await recordActivity(tx, { actorName: c.who.name, actorPersonId: c.who.personId, text: `Supplier schedule tied · ${text}`, kind: 'change', projectId: c.project.id });
    await touch(c, n.mine.id);
  });
}

export async function removeSupplierTie(projectCode: string, poNumber: string, supplier: string, activity: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const c = await context(tx, projectCode, poNumber, actor);
    const n = await networkOf(c);
    const t = n.mine.ties.find((x) => x.supplier === supplier && x.activity === activity);
    if (!t) throw new SupplierScheduleError('unknown');
    await tx.delete(supplierScheduleTies).where(eq(supplierScheduleTies.id, t.id));
    await audit(c, `supplier schedule untied: ${c.po.number}/${supplier} · ${activity}`, { entityId: n.mine.id, before: { supplier, activity, direction: t.direction, lag: t.lag } });
    await touch(c, n.mine.id);
  });
}
