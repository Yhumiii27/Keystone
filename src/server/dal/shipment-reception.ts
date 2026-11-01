import 'server-only';
// R-158 lot B — site reception of a shipment and what follows it (owner's decisions 5 and 6; rules src/domain/shipment-reception.ts;
// notes docs/delivery-9/notes-r158-shipments.md § Lot B):
// - `pointLoad` / `pointItem`: once arrived, each load (received, missing, damaged) and each content line (quantities received,
//   missing, damaged) is pointed by the shipment editors or the site team (`editsReception`); every gap raises a punch item on the
//   project's punch list (R-117, origin Site, source "Shipment reception", on the shipment's equipment line, R-185) linked back to
//   the shipment (`shipment_punch_items`); a corrected pointing updates, closes or reopens that item;
// - `completeReception`: every load and line pointed → "received" (reception date = the business date);
// - `closeShipment`: closed by hand, with a reason while punch items are still open; `afterPunchItemChange` (called by the punch
//   list's writer, src/server/dal/itp.ts) closes a received shipment with its last punch item and moves its `updated_at` (the
//   `maj_le` of pub_expeditions);
// - `raiseFreightRisk`: "Create a risk" from the freight-delay warning (a lead of the project; never automatic).
// Every writer re-checks the right and the state in its transaction and records the audit row and the activity event.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  FREIGHT_RISK_LEADS_ONLY, FREIGHT_RISK_NOT_LATE, FREIGHT_RISK_RAISED, RECEPTION_GAP_LABEL, RECEPTION_LOAD_STATE_LABEL, closesWithPunch, freightDelayDays,
  receptionBlocker, receptionProgress, type ItemReceptionInput, type LoadReceptionInput, type ReceptionGap,
} from '@/domain/shipment-reception';
import { SHIPMENT_STATUS_LABEL } from '@/domain/shipments';
import { systemMessage } from '@/domain/system-messages';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { nextBusinessNumber, punchOrigin, type PunchCategory } from '@/server/db/codes';
import { demoFloor } from '@/server/db/helpers';
import {
  projects, punchItems, risks, shipmentEquipments, shipmentItems, shipmentLoads, shipmentPunchItems, shipmentReceptionLines, shipments, parts,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { managesProject, trace, whoIs, type Actor } from './ops-common';
import { createRisk, type NewRiskInput } from './risks';
import { siteNeedOf } from './shipments';
import { editsProjectScreen, editsShipments } from './team-guard';

const READ_ONLY = 'The reception is read-only for you';
const NOT_ARRIVED = 'The reception is pointed once the shipment has arrived';
const LOAD_MISSING = 'This load is pointed missing: point the load again first';
const QTY_SUM = 'Received, missing and damaged must add up to the quantity shipped';
const NOT_RECEIVED = 'Only a shipment received on site is closed';
const CLOSE_REASON = 'Give the reason for closing with open punch items';

/** EN source messages the Server Functions pass on (translated) — anything else is "The change could not be saved". */
export const RECEPTION_ERRORS = [
  READ_ONLY, NOT_ARRIVED, LOAD_MISSING, QTY_SUM, NOT_RECEIVED, CLOSE_REASON, 'Unknown shipment', 'Unknown load', 'Unknown item', 'Point every load first',
  'Point every content line first', 'The status has changed meanwhile', FREIGHT_RISK_LEADS_ONLY, FREIGHT_RISK_NOT_LATE, FREIGHT_RISK_RAISED,
] as const;

type T = (english: string) => string;

interface Ctx {
  project: { id: string; code: string };
  who: { personId: string | null; who: string };
}

/**
 * Who points a reception (`canRecordReception`, src/domain/rights.ts), re-checked here: the shipment editors (director, Logistics,
 * the project's leads) or a member of the project's team who edits its Site screen.
 */
export async function editsReception(tx: Tx, actor: Actor, projectId: string): Promise<boolean> {
  return (await editsShipments(tx, actor, projectId)) || (await editsProjectScreen(tx, actor, projectId, 'site'));
}

async function writer(tx: Tx, projectCode: string, actor: Actor): Promise<Ctx> {
  const [p] = await tx.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.code, projectCode));
  if (!p) throw new Error('Unknown shipment');
  if (!(await editsReception(tx, actor, p.id))) throw new Error(READ_ONLY);
  return { project: p, who: await whoIs(tx, actor) };
}

async function shipmentOf(tx: Tx, projectId: string, ref: string) {
  const [s] = await tx.select().from(shipments).where(and(eq(shipments.projectId, projectId), eq(shipments.ref, ref)));
  if (!s) throw new Error('Unknown shipment');
  return s;
}

const touch = (tx: Tx, shipmentId: string) => tx.update(shipments).set({ updatedAt: new Date() }).where(eq(shipments.id, shipmentId));

const clip = (s: string, max = 300) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The equipment line a reception punch item is raised on: the shipment's line when it carries one only, else common (null). */
async function punchEquipmentOf(tx: Tx, shipmentId: string): Promise<string | null> {
  const eqs = await tx.select({ id: shipmentEquipments.equipmentId }).from(shipmentEquipments).where(eq(shipmentEquipments.shipmentId, shipmentId));
  return eqs.length === 1 ? eqs[0].id : null;
}

interface PunchWish {
  loadId: string;
  itemId: string | null;
  gap: ReceptionGap;
  want: boolean;
  quantity: number | null;
  category: PunchCategory;
  description: string;
  location: string;
}

/**
 * The punch item of one gap: raised when the gap appears, updated when it changes, closed when the pointing withdraws it, reopened
 * when it comes back (while the reception is open). Numbered over the project like "Add punch item" (P-10…).
 */
async function syncPunch(tx: Tx, c: Ctx, s: { id: string; ref: string }, w: PunchWish, today: string): Promise<void> {
  const [link] = await tx.select({ l: shipmentPunchItems, p: punchItems }).from(shipmentPunchItems).innerJoin(punchItems, eq(punchItems.id, shipmentPunchItems.punchItemId))
    .where(and(eq(shipmentPunchItems.loadId, w.loadId), w.itemId ? eq(shipmentPunchItems.itemId, w.itemId) : sql`${shipmentPunchItems.itemId} is null`, eq(shipmentPunchItems.gap, w.gap)));
  const description = clip(w.description);
  if (!link) {
    if (!w.want) return;
    const existing = await tx.select({ n: punchItems.number, pos: punchItems.position }).from(punchItems).where(eq(punchItems.projectId, c.project.id));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'P-', 2, await demoFloor(tx, 9));
    const equipmentId = await punchEquipmentOf(tx, s.id);
    const [row] = await tx.insert(punchItems).values({
      projectId: c.project.id, register: 'site', number, description, location: clip(w.location, 200), category: w.category, source: 'reception', ownerParty: 'keystone',
      status: 'open', position: existing.reduce((m, e) => Math.max(m, e.pos + 1), 0), equipmentId,
    }).returning({ id: punchItems.id });
    await tx.insert(shipmentPunchItems).values({ shipmentId: s.id, punchItemId: row.id, loadId: w.loadId, itemId: w.itemId, gap: w.gap, quantity: w.quantity });
    await trace(tx, c.who, {
      objectRef: number, change: `punch item added · ${punchOrigin.label('site')} · ${w.category} · ${description} · reception ${s.ref}`, area: 'Punch list', entityType: 'punch_item',
      entityId: row.id, projectId: c.project.id, after: { origin: 'site', source: 'reception', shipment: s.ref, gap: w.gap, quantity: w.quantity, category: w.category, ownerParty: 'keystone' },
      activity: { text: `Added punch item ${number} (${w.category}) ${description}`, kind: 'quality' },
    });
    return;
  }
  const p = link.p;
  if (w.want) {
    const reopened = p.status === 'closed';
    const changed = reopened || p.description !== description || p.category !== w.category || Number(link.l.quantity ?? 0) !== Number(w.quantity ?? 0);
    if (!changed) return;
    await tx.update(punchItems).set({ description, category: w.category, ...(reopened ? { status: 'open', closedOn: null } : {}), updatedAt: new Date() }).where(eq(punchItems.id, p.id));
    await tx.update(shipmentPunchItems).set({ quantity: w.quantity }).where(eq(shipmentPunchItems.id, link.l.id));
    await trace(tx, c.who, {
      objectRef: p.number, change: reopened ? `reopened · reception ${s.ref} · ${description}` : `edited · reception ${s.ref} · ${description}`, area: 'Punch list', entityType: 'punch_item',
      entityId: p.id, projectId: c.project.id, before: { status: p.status, category: p.category, description: p.description, quantity: link.l.quantity },
      after: { status: reopened ? 'open' : p.status, category: w.category, description, quantity: w.quantity },
    });
    return;
  }
  if (p.status === 'closed') return;
  await tx.update(punchItems).set({ status: 'closed', closedOn: today, updatedAt: new Date() }).where(eq(punchItems.id, p.id));
  await trace(tx, c.who, {
    objectRef: p.number, change: `status: ${p.status === 'open' ? 'Open' : 'In progress'} → Closed · gap withdrawn at the reception of ${s.ref}`, area: 'Punch list',
    entityType: 'punch_item', entityId: p.id, projectId: c.project.id, before: { status: p.status }, after: { status: 'closed' },
  });
}

const receptionTrace = (tx: Tx, c: Ctx, s: { id: string; ref: string }, what: string, item: string, after: Record<string, unknown>) => {
  const message = systemMessage('shipment.reception', { project: c.project.code, ref: s.ref, what, item });
  return trace(tx, c.who, { objectRef: `Shipment ${s.ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, after, activity: { kind: 'change', message } });
};

async function loadOf(tx: Tx, shipmentId: string, number: number) {
  const [l] = await tx.select().from(shipmentLoads).where(and(eq(shipmentLoads.shipmentId, shipmentId), eq(shipmentLoads.number, number)));
  if (!l) throw new Error('Unknown load');
  return l;
}

const loadText = (l: { number: number; identifier: string | null }) => `#${l.number}${l.identifier ? ` ${l.identifier}` : ''}`;

async function upsertLine(tx: Tx, v: typeof shipmentReceptionLines.$inferInsert) {
  await tx.insert(shipmentReceptionLines).values(v).onConflictDoUpdate({
    target: [shipmentReceptionLines.loadId, shipmentReceptionLines.itemId],
    set: { loadState: v.loadState ?? null, receivedQty: v.receivedQty ?? null, missingQty: v.missingQty ?? null, damagedQty: v.damagedQty ?? null, note: v.note ?? null, byPersonId: v.byPersonId ?? null, pointedOn: v.pointedOn, updatedAt: new Date() },
  });
}

/**
 * "Point the load": received (its content lines not pointed yet are received in full), missing (its content lines are missing in
 * full, covered by the load's punch item — their own items are withdrawn) or damaged (the container or truck; its lines are
 * pointed on their own). A missing or damaged load raises a punch item.
 */
export async function pointLoad(projectCode: string, ref: string, number: number, input: LoadReceptionInput, actor: Actor, t: T): Promise<void> {
  const db = await getDb();
  const today = await businessToday();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status !== 'arrived') throw new Error(NOT_ARRIVED);
    const l = await loadOf(tx, s.id, number);
    await upsertLine(tx, { shipmentId: s.id, loadId: l.id, itemId: null, loadState: input.state, note: input.note, byPersonId: c.who.personId, pointedOn: today });
    const where = `${t('Shipment')} ${s.ref} · ${t('Truck / container')} ${loadText(l)}`;
    for (const gap of ['missing', 'damaged'] as const) {
      await syncPunch(tx, c, s, {
        loadId: l.id, itemId: null, gap, want: input.state === gap, quantity: null, category: input.category ?? 'B',
        description: `${s.ref} · ${t('Reception')} · ${t('Truck / container')} ${loadText(l)} ${t(RECEPTION_GAP_LABEL[gap]).toLowerCase()}${input.note ? ` — ${input.note}` : ''}`, location: where,
      }, today);
    }
    const items = await tx.select().from(shipmentItems).where(eq(shipmentItems.loadId, l.id));
    const lines = items.length ? await tx.select().from(shipmentReceptionLines).where(and(eq(shipmentReceptionLines.loadId, l.id), inArray(shipmentReceptionLines.itemId, items.map((i) => i.id)))) : [];
    for (const it of items) {
      const q = Number(it.quantity);
      if (input.state === 'missing') {
        await upsertLine(tx, { shipmentId: s.id, loadId: l.id, itemId: it.id, receivedQty: 0, missingQty: q, damagedQty: 0, note: input.note, byPersonId: c.who.personId, pointedOn: today });
        // The load's punch item covers its content: the lines' own gaps are withdrawn.
        for (const gap of ['missing', 'damaged'] as const)
          await syncPunch(tx, c, s, { loadId: l.id, itemId: it.id, gap, want: false, quantity: null, category: 'B', description: '', location: '' }, today);
      } else if (input.state === 'received' && !lines.some((x) => x.itemId === it.id)) {
        await upsertLine(tx, { shipmentId: s.id, loadId: l.id, itemId: it.id, receivedQty: q, missingQty: 0, damagedQty: 0, note: null, byPersonId: c.who.personId, pointedOn: today });
      }
    }
    await touch(tx, s.id);
    await receptionTrace(tx, c, s, `Load ${RECEPTION_LOAD_STATE_LABEL[input.state].toLowerCase()}`, `#${l.number}${input.note ? ` · ${input.note}` : ''}`, {
      load: l.number, state: input.state, note: input.note, category: input.category,
    });
  });
}

/** "Point the content line": received, missing and damaged quantities (their sum = shipped); each gap raises its punch item. */
export async function pointItem(projectCode: string, ref: string, itemId: string, input: ItemReceptionInput, actor: Actor, t: T): Promise<void> {
  const db = await getDb();
  const today = await businessToday();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status !== 'arrived') throw new Error(NOT_ARRIVED);
    const [row] = await tx.select({ i: shipmentItems, l: shipmentLoads, partRef: parts.ref }).from(shipmentItems).innerJoin(shipmentLoads, eq(shipmentLoads.id, shipmentItems.loadId))
      .leftJoin(parts, eq(parts.id, shipmentItems.partId)).where(and(eq(shipmentItems.id, itemId), eq(shipmentLoads.shipmentId, s.id)));
    if (!row) throw new Error('Unknown item');
    const shipped = Number(row.i.quantity);
    if (Math.abs(input.received + input.missing + input.damaged - shipped) > 1e-9) throw new Error(QTY_SUM);
    const [loadLine] = await tx.select().from(shipmentReceptionLines).where(and(eq(shipmentReceptionLines.loadId, row.l.id), sql`${shipmentReceptionLines.itemId} is null`));
    if (loadLine?.loadState === 'missing') throw new Error(LOAD_MISSING);
    await upsertLine(tx, {
      shipmentId: s.id, loadId: row.l.id, itemId, receivedQty: input.received, missingQty: input.missing, damagedQty: input.damaged, note: input.note, byPersonId: c.who.personId, pointedOn: today,
    });
    const article = row.partRef ?? row.i.description ?? '';
    const name = row.partRef ? (await tx.select({ name: parts.name }).from(parts).where(eq(parts.ref, row.partRef)))[0]?.name ?? '' : '';
    const where = `${t('Shipment')} ${s.ref} · ${t('Truck / container')} ${loadText(row.l)}`;
    for (const gap of ['missing', 'damaged'] as const) {
      const qty = gap === 'missing' ? input.missing : input.damaged;
      await syncPunch(tx, c, s, {
        loadId: row.l.id, itemId, gap, want: qty > 0, quantity: qty, category: gap === 'missing' ? input.missingCategory : input.damagedCategory,
        description: `${s.ref} · ${t('Reception')} · ${t(RECEPTION_GAP_LABEL[gap])} ${qty} × ${article}${name ? ` ${name}` : ''}${input.note ? ` — ${input.note}` : ''}`, location: where,
      }, today);
    }
    await touch(tx, s.id);
    await receptionTrace(tx, c, s, 'Content pointed', `${article} · ${input.received} / ${input.missing} / ${input.damaged}${input.note ? ` · ${input.note}` : ''}`, {
      item: article, load: row.l.number, received: input.received, missing: input.missing, damaged: input.damaged, note: input.note,
    });
  });
}

/** Open punch items raised by the reception of a shipment. */
async function openPunchOf(tx: Tx, shipmentId: string): Promise<number> {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipmentPunchItems).innerJoin(punchItems, eq(punchItems.id, shipmentPunchItems.punchItemId))
    .where(and(eq(shipmentPunchItems.shipmentId, shipmentId), ne(punchItems.status, 'closed')));
  return n;
}

/** "Complete the reception": every load and content line pointed → received on site (business date). */
export async function completeReception(projectCode: string, ref: string, actor: Actor): Promise<void> {
  const db = await getDb();
  const today = await businessToday();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    const s = await shipmentOf(tx, c.project.id, ref);
    const loads = await tx.select({ id: shipmentLoads.id }).from(shipmentLoads).where(eq(shipmentLoads.shipmentId, s.id)).orderBy(asc(shipmentLoads.number));
    const items = loads.length ? await tx.select({ id: shipmentItems.id, loadId: shipmentItems.loadId }).from(shipmentItems).where(inArray(shipmentItems.loadId, loads.map((l) => l.id))) : [];
    const lines = await tx.select({ loadId: shipmentReceptionLines.loadId, itemId: shipmentReceptionLines.itemId }).from(shipmentReceptionLines).where(eq(shipmentReceptionLines.shipmentId, s.id));
    const progress = receptionProgress({
      loads: loads.map((l) => ({ id: l.id, items: items.filter((i) => i.loadId === l.id) })),
      pointedLoads: new Set(lines.filter((x) => !x.itemId).map((x) => x.loadId)), pointedItems: new Set(lines.filter((x) => x.itemId).map((x) => x.itemId!)),
    });
    const blocker = receptionBlocker(s.status, progress);
    if (blocker) throw new Error(blocker);
    await tx.update(shipments).set({ status: 'received', receivedOn: today, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    const open = await openPunchOf(tx, s.id);
    const message = systemMessage('shipment.status', { project: c.project.code, ref, from: SHIPMENT_STATUS_LABEL.arrived, to: SHIPMENT_STATUS_LABEL.received });
    await trace(tx, c.who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message,
      before: { status: s.status }, after: { status: 'received', receivedOn: today, openPunchItems: open }, activity: { kind: 'change', message },
    });
  });
}

/** "Close shipment" by hand (received on site): a reason is required while punch items raised by the reception are still open. */
export async function closeShipment(projectCode: string, ref: string, reason: string | null, actor: Actor): Promise<void> {
  const db = await getDb();
  const today = await businessToday();
  await db.transaction(async (tx) => {
    const c = await writer(tx, projectCode, actor);
    // Closing is the shipment editors' (the site team points the reception only).
    if (!(await editsShipments(tx, actor, c.project.id))) throw new Error(READ_ONLY);
    const s = await shipmentOf(tx, c.project.id, ref);
    if (s.status !== 'received') throw new Error(NOT_RECEIVED);
    const open = await openPunchOf(tx, s.id);
    if (open > 0 && !reason) throw new Error(CLOSE_REASON);
    await tx.update(shipments).set({ status: 'closed', closedOn: today, closeReason: reason, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    const message = systemMessage('shipment.status', { project: c.project.code, ref, from: SHIPMENT_STATUS_LABEL.received, to: SHIPMENT_STATUS_LABEL.closed });
    await trace(tx, c.who, {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: c.project.id, message, reason,
      before: { status: 'received' }, after: { status: 'closed', closedOn: today, openPunchItems: open }, activity: { kind: 'change', message },
    });
  });
}

/**
 * Called by the punch list's writer (src/server/dal/itp.ts `advancePunchItem`) inside its transaction: a punch item raised by a
 * reception moves its shipment's `updated_at` (pub_expeditions `nb_reserves_ouvertes` / `maj_le`); its last one closed closes a
 * received shipment (audit and activity by the same actor).
 */
export async function afterPunchItemChange(tx: Tx, punchItemId: string, actor: Actor, today: string): Promise<void> {
  const [link] = await tx.select({ shipmentId: shipmentPunchItems.shipmentId }).from(shipmentPunchItems).where(eq(shipmentPunchItems.punchItemId, punchItemId));
  if (!link) return;
  const [s] = await tx.select({ id: shipments.id, ref: shipments.ref, status: shipments.status, projectId: shipments.projectId, code: projects.code }).from(shipments)
    .innerJoin(projects, eq(projects.id, shipments.projectId)).where(eq(shipments.id, link.shipmentId));
  if (!s) return;
  if (!closesWithPunch(s.status, await openPunchOf(tx, s.id))) {
    await touch(tx, s.id);
    return;
  }
  await tx.update(shipments).set({ status: 'closed', closedOn: today, closeReason: null, updatedAt: new Date() }).where(eq(shipments.id, s.id));
  const message = systemMessage('shipment.status', { project: s.code, ref: s.ref, from: SHIPMENT_STATUS_LABEL.received, to: SHIPMENT_STATUS_LABEL.closed });
  await trace(tx, await whoIs(tx, actor), {
    objectRef: `Shipment ${s.ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: s.projectId, message,
    before: { status: 'received' }, after: { status: 'closed', closedOn: today, by: 'last punch item closed' }, activity: { kind: 'change', message },
  });
}

/**
 * "Create a risk" from the freight-delay warning (never automatic): a lead of the project, the shipment still late against the
 * site need date at the business date, no risk raised from it yet; the "New risk" values confirmed by the lead, the cause as the
 * trigger; the risk linked to the shipment. Returns the risk number.
 */
export async function raiseFreightRisk(projectCode: string, ref: string, input: Omit<NewRiskInput, 'trigger' | 'activityCode'>, trigger: string, actor: Actor): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.code, projectCode));
    if (!p) throw new Error('Unknown shipment');
    if (!(await managesProject(tx, actor, p))) throw new Error(FREIGHT_RISK_LEADS_ONLY);
    const s = await shipmentOf(tx, p.id, ref);
    if (s.riskId) throw new Error(FREIGHT_RISK_RAISED);
    if (freightDelayDays(s, await siteNeedOf(tx, p.id)) == null) throw new Error(FREIGHT_RISK_NOT_LATE);
    const number = await createRisk(projectCode, { ...input, trigger }, actor.name, tx);
    const [r] = await tx.select({ id: risks.id }).from(risks).where(and(eq(risks.projectId, p.id), eq(risks.number, number)));
    await tx.update(shipments).set({ riskId: r.id, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    const message = systemMessage('shipment.riskRaised', { project: p.code, ref, risk: number });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Shipment ${ref}`, area: 'Shipments', entityType: 'shipment', entityId: s.id, projectId: p.id, message, after: { risk: number, trigger },
      activity: { kind: 'change', message },
    });
    return number;
  });
}

