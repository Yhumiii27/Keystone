import 'server-only';
// Deliveries & goods receipt DAL (docs/spec/08 §3; 11 §3.8 GoodsReceipt, ReceiptLine, ReceiptAttachment). Receipts of a
// project with their lines, incoming quality control, put-away and documents. The writers close the gaps the prototype
// left open (00 §7.16, SC-3, SC-4):
// - "Announce a delivery" creates a receipt that is listed (BL-2026-0600…), for what is still to come on an ordered
//   (or partially received) PO — `remainingToAnnounce` in src/domain/deliveries.ts;
// - "Register receipt" records the delivered quantities (`registerPlan`), the carrier and the supplier's delivery note;
// - the QC decision (accept, reject, or per line: `qcPlan`) moves the goods: accepted units go to stock at the put-away location
//   (from quarantine to the central warehouse when they were held there), rejected units to quarantine; the order's
//   received quantities and status follow the accepted quantities, and the invoices of the receipt see its value
//   (3-way match);
// - the inspector, the receiving clerk and the decision maker are the viewer.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { putAwayAfterQc, qcPlan, registerPlan, remainingToAnnounce, type QcDecision, type ReceiptForAnnounce } from '@/domain/deliveries';
import { getDb } from '@/server/db/client';
import { STATUS_ISO, locationType, receiptStatus, type LocationType, type ReceiptStatus } from '@/server/db/codes';
import { demoFloor, findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  goodsReceipts, parts, persons, poLines, projectSites, projects, purchaseOrders, receiptAttachments, receiptLines, stockPositions, storageLocations, supplierInvoices, suppliers,
} from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { onTimeDeliveriesOf } from './kpis';
import { countOrdersToReceive } from './purchasing';
import { ensurePosition, insertMovement } from './stock';

type Q = DB | Tx;

// ── Read model ─────────────────────────────────────────────────────────────────────────────────────────

export interface ReceiptLineRow {
  ref: string;
  name: string;
  ordered: number;
  delivered: number;
  accepted: number;
  rejected: number;
  /** Put-away location ("Magasin chantier — Le Havre"). */
  location: string;
  locationType: LocationType;
}

export interface ReceiptRow {
  number: string;
  projectCode: string;
  poNumber: string;
  supplier: string;
  status: ReceiptStatus;
  /** "QC pending". */
  statusLabel: string;
  /** Date shown: delivered on, or the announced date (`date`). */
  date: string | null;
  expectedOn: string | null;
  receivedOn: string | null;
  /** Null = "—". */
  carrier: string | null;
  supplierDeliveryNote: string | null;
  lines: ReceiptLineRow[];
  totals: { ordered: number; delivered: number; accepted: number; rejected: number };
  /** Location of the first line (table "Put-away"). */
  putAway: string | null;
  qc: { by: string | null; result: string | null; remarks: string | null };
  receivedBy: string | null;
  documents: string[];
  photoCount: number;
  position: number;
}

async function loadReceipts(q: Q, where: ReturnType<typeof eq>): Promise<ReceiptRow[]> {
  const rows = await q
    .select({ r: goodsReceipts, code: projects.code, po: purchaseOrders.number, supplier: suppliers.name, by: persons.fullName })
    .from(goodsReceipts)
    .innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
    .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .leftJoin(persons, eq(persons.id, goodsReceipts.receivedByPersonId))
    .where(where)
    .orderBy(asc(projects.sortOrder), asc(goodsReceipts.position));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.r.id);
  const [lines, att] = await Promise.all([
    q.select({ l: receiptLines, ref: parts.ref, name: parts.name, loc: storageLocations.name, type: storageLocations.type })
      .from(receiptLines).innerJoin(parts, eq(parts.id, receiptLines.partId)).innerJoin(storageLocations, eq(storageLocations.id, receiptLines.putAwayLocationId))
      .where(inArray(receiptLines.receiptId, ids)).orderBy(asc(receiptLines.position)),
    q.select().from(receiptAttachments).where(inArray(receiptAttachments.receiptId, ids)).orderBy(asc(receiptAttachments.position)),
  ]);
  return rows.map(({ r, code, po, supplier, by }) => {
    const ls = lines.filter((l) => l.l.receiptId === r.id).map(({ l, ref, name, loc, type }) => ({
      ref, name, ordered: l.orderedQty, delivered: l.deliveredQty, accepted: l.acceptedQty, rejected: l.rejectedQty, location: loc, locationType: type,
    }));
    const a = att.filter((x) => x.receiptId === r.id);
    const sum = (k: 'ordered' | 'delivered' | 'accepted' | 'rejected') => ls.reduce((s, l) => s + l[k], 0);
    return {
      number: r.number, projectCode: code, poNumber: po, supplier, status: r.status, statusLabel: receiptStatus.label(r.status), date: r.receivedOn ?? r.expectedOn,
      expectedOn: r.expectedOn, receivedOn: r.receivedOn, carrier: r.carrier, supplierDeliveryNote: r.supplierDeliveryNote, lines: ls,
      totals: { ordered: sum('ordered'), delivered: sum('delivered'), accepted: sum('accepted'), rejected: sum('rejected') }, putAway: ls[0]?.location ?? null,
      qc: { by: r.qcByName, result: r.qcResult, remarks: r.qcRemarks }, receivedBy: by ?? null,
      documents: a.filter((x) => x.kind === 'document').map((x) => x.fileName ?? ''), photoCount: a.filter((x) => x.kind === 'photo').length, position: r.position,
    };
  });
}

/** Goods receipts of a project (genDeliv order, then the deliveries announced in Keystone). */
export async function listReceipts(projectCode: string): Promise<ReceiptRow[]> {
  return loadReceipts(await getDb(), eq(projects.code, projectCode));
}

export async function getReceipt(number: string): Promise<ReceiptRow | null> {
  return (await loadReceipts(await getDb(), eq(goodsReceipts.number, number)))[0] ?? null;
}

export interface DeliveriesScreenData {
  receipts: ReceiptRow[];
  /** Orders Ordered or Partially received ("Open orders to receive"). */
  openOrdersToReceive: number;
  /** A-12 "On-time deliveries" at the project's data date (`onTimeDeliveriesOf`), null when nothing was received in 90 days. */
  onTimePct: number | null;
  /** Orders a delivery can be announced for ("Announce a delivery" form). */
  announceable: AnnounceableOrder[];
  /** Put-away locations offered by the form, and the project's default. */
  putAway: { locations: string[]; defaultLocation: string };
}

/** Everything the Deliveries & goods receipt screen of a project reads. */
export async function getDeliveriesScreen(projectCode: string): Promise<DeliveriesScreenData> {
  const [receipts, openOrdersToReceive, announceable, putAway, onTimePct] = await Promise.all([
    listReceipts(projectCode), countOrdersToReceive(projectCode), listAnnounceableOrders(projectCode), getPutAwayOptions(projectCode), onTimeDeliveriesOf(projectCode),
  ]);
  return { receipts, openOrdersToReceive, announceable, putAway, onTimePct };
}

/** Receipts waiting for their quality check, per project code (sidebar badge of Deliveries). */
export async function receiptsQcPendingByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code, n: sql<number>`count(*)::int` }).from(goodsReceipts).innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
    .where(eq(goodsReceipts.status, 'qc_pending')).groupBy(projects.code);
  return Object.fromEntries(rows.map((r) => [r.code, r.n]));
}

/** Receipts of a project waiting for their quality check (My approvals "Delivery — quality check", quality and procurement). */
export async function qcQueue(projectCode: string): Promise<ReceiptRow[]> {
  return (await listReceipts(projectCode)).filter((r) => r.status === 'qc_pending');
}

/** QC decisions recorded by a person on the project's receipts ("Decided this week"). */
export async function qcDecidedCount(projectCode: string, actorName: string): Promise<number> {
  const db = await getDb();
  const p = await findPerson(db, actorName);
  if (!p) return 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(goodsReceipts).innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
    .where(and(eq(projects.code, projectCode), eq(goodsReceipts.qcByPersonId, p.id), sql`${goodsReceipts.qcDecidedAt} is not null`));
  return n;
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

async function loadReceipt(tx: Tx, number: string) {
  const [r] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.number, number));
  if (!r) throw new Error(`Unknown goods receipt ${number}`);
  return r;
}

async function locationOfType(tx: Tx, type: LocationType) {
  const [l] = await tx.select().from(storageLocations).where(and(eq(storageLocations.type, type), eq(storageLocations.active, true))).orderBy(asc(storageLocations.position)).limit(1);
  if (!l) throw new Error(`No ${locationType.label(type)} configured`);
  return l;
}

/** Default put-away of a project: its site store (the store named after the site's city), else the central warehouse. */
async function defaultPutAway(tx: Tx, projectId: string) {
  return (await siteStoreOf(tx, projectId)) ?? locationOfType(tx, 'central_warehouse');
}

/** The project's site store (the store named after the site's city), or undefined. */
async function siteStoreOf(tx: Tx, projectId: string) {
  const [site] = await tx.select({ city: projectSites.city }).from(projectSites).where(eq(projectSites.projectId, projectId));
  if (!site) return undefined;
  const stores = await tx.select().from(storageLocations).where(and(eq(storageLocations.type, 'site_store'), eq(storageLocations.active, true)));
  return stores.find((s) => s.name.endsWith(`— ${site.city}`));
}

const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/** What a new delivery of an order may still bring, per article (`remainingToAnnounce`). */
async function remainingOf(q: Q, poId: string) {
  const [pl, rs] = await Promise.all([
    q.select({ l: poLines, ref: parts.ref, name: parts.name }).from(poLines).innerJoin(parts, eq(parts.id, poLines.partId)).where(eq(poLines.poId, poId)).orderBy(asc(poLines.position)),
    q.select({ id: goodsReceipts.id, status: goodsReceipts.status }).from(goodsReceipts).where(eq(goodsReceipts.poId, poId)),
  ]);
  const rl = rs.length
    ? await q.select({ l: receiptLines, ref: parts.ref }).from(receiptLines).innerJoin(parts, eq(parts.id, receiptLines.partId)).where(inArray(receiptLines.receiptId, rs.map((r) => r.id)))
    : [];
  const receipts: ReceiptForAnnounce[] = rs.map((r) => ({
    status: r.status,
    lines: rl.filter((x) => x.l.receiptId === r.id).map(({ l, ref }) => ({ ref, ordered: l.orderedQty, delivered: l.deliveredQty, accepted: l.acceptedQty })),
  }));
  const remaining = remainingToAnnounce(pl.map(({ l, ref, name }) => ({ ref, name, ordered: l.orderedQty, received: l.receivedQty })), receipts);
  return remaining.map((r) => ({ ...r, partId: pl.find((x) => x.ref === r.ref)!.l.partId }));
}

export interface AnnounceableOrder {
  number: string;
  supplier: string;
  /** ISO; null = "To confirm". */
  expectedOn: string | null;
  /** Articles still to come on the order. */
  lines: { ref: string; name: string; qty: number }[];
}

/** Orders of a project a delivery can be announced for: Ordered or Partially received, with goods still to come. */
export async function listAnnounceableOrders(projectCode: string): Promise<AnnounceableOrder[]> {
  const db = await getDb();
  const pos = await db
    .select({ o: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(projects.code, projectCode), inArray(purchaseOrders.status, ['ordered', 'partially_received'])))
    .orderBy(asc(purchaseOrders.position));
  const out: AnnounceableOrder[] = [];
  for (const { o, supplier } of pos) {
    const lines = await remainingOf(db, o.id);
    if (lines.length) out.push({ number: o.number, supplier, expectedOn: o.expectedOn, lines: lines.map(({ ref, name, qty }) => ({ ref, name, qty })) });
  }
  return out;
}

/**
 * Put-away offered by "Announce a delivery": active locations except the quarantine, and the project's default ('' while no
 * central warehouse is configured — a new production database has no storage location until Settings defines them, R-011;
 * announcing then refuses with "No Central warehouse configured").
 */
export async function getPutAwayOptions(projectCode: string): Promise<{ locations: string[]; defaultLocation: string }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const locs = await tx.select().from(storageLocations).where(eq(storageLocations.active, true)).orderBy(asc(storageLocations.position));
    const fallback = (await siteStoreOf(tx, p.id)) ?? locs.find((l) => l.type === 'central_warehouse');
    return { locations: locs.filter((l) => l.type !== 'quarantine').map((l) => l.name), defaultLocation: fallback?.name ?? '' };
  });
}

export interface AnnounceInput {
  /** Order delivered; default the first Ordered order of the project without a receipt (`announce` 4466). */
  poNumber?: string | null;
  /** ISO date; default the order's expected date. */
  expectedOn?: string | null;
  carrier?: string | null;
  /** Put-away location; default the project's site store, else the central warehouse. */
  location?: string | null;
}

/**
 * "Announce a delivery": an Announced receipt (BL-2026-0600…) for what is still to come on the order — listed with
 * the project's receipts (the prototype stored it where nothing listed it, 00 §7.16). Returns its number.
 */
export async function announceDelivery(projectCode: string, input: AnnounceInput, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    let po: typeof purchaseOrders.$inferSelect | undefined;
    if (input.poNumber) {
      [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.number, input.poNumber), eq(purchaseOrders.projectId, p.id)));
      if (!po) throw new Error(`Unknown purchase order ${input.poNumber} on ${projectCode}`);
      if (po.status !== 'ordered' && po.status !== 'partially_received') throw new Error(`${po.number} is not ordered`);
    } else {
      const ordered = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.projectId, p.id), eq(purchaseOrders.status, 'ordered'))).orderBy(asc(purchaseOrders.position));
      const withReceipt = new Set((await tx.select({ po: goodsReceipts.poId }).from(goodsReceipts).where(eq(goodsReceipts.projectId, p.id))).map((r) => r.po));
      po = ordered.find((o) => !withReceipt.has(o.id));
      if (!po) throw new Error('No ordered purchase order is waiting for a delivery');
    }
    const lines = await remainingOf(tx, po.id);
    if (!lines.length) throw new Error(`${po.number} has nothing left to receive`);
    const expected = input.expectedOn ?? po.expectedOn;
    if (expected != null && !isIso(expected)) throw new Error('Invalid delivery date');
    let loc: typeof storageLocations.$inferSelect | undefined;
    if (input.location) {
      [loc] = await tx.select().from(storageLocations).where(and(eq(storageLocations.name, input.location), eq(storageLocations.active, true)));
      if (!loc) throw new Error(`Unknown location ${input.location}`);
    } else loc = await defaultPutAway(tx, p.id);
    const all = (await tx.select({ n: goodsReceipts.number }).from(goodsReceipts)).map((r) => r.n);
    const number = nextReceiptNumber(all, await demoFloor(tx, RECEIPT_NUMBER_FLOOR));
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${goodsReceipts.position}), -1)::int` }).from(goodsReceipts).where(eq(goodsReceipts.projectId, p.id));
    const [r] = await tx
      .insert(goodsReceipts)
      .values({
        number, poId: po.id, projectId: p.id, supplierId: po.supplierId, status: 'announced', expectedOn: expected ?? null, carrier: input.carrier?.trim() || null,
        qcRemarks: 'Announced by supplier', position: pos + 1,
      })
      .returning({ id: goodsReceipts.id });
    await tx.insert(receiptLines).values(lines.map((l, position) => ({
      receiptId: r.id, partId: l.partId, orderedQty: l.qty, deliveredQty: 0, acceptedQty: 0, rejectedQty: 0, putAwayLocationId: loc!.id, position,
    })));
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: number, change: `delivery announced · ${po.number}${expected ? ` · expected ${expected}` : ''}`, area: 'Deliveries', entityType: 'goods_receipt', entityId: r.id, projectId: p.id });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Delivery ${number} announced for ${po.number}`, kind: 'delivery', projectId: p.id });
    return number;
  });
}

/** The prototype numbered the receipts it announced from BL-2026-0600 (`announce`); a demo database keeps that floor (R-011). */
export const RECEIPT_NUMBER_FLOOR = 599;

/** Next BL-2026-nnnn of the receipts announced in Keystone (after `floor`: the demo floor, 0 on a production database). */
export function nextReceiptNumber(existing: string[], floor = RECEIPT_NUMBER_FLOOR): string {
  let max = floor;
  for (const n of existing) {
    const m = /^BL-2026-(\d{4})$/.exec(n);
    if (m && +m[1] > max) max = +m[1];
  }
  return `BL-2026-${String(max + 1).padStart(4, '0')}`;
}

export interface RegisterInput {
  /** ISO; default the status date. */
  receivedOn?: string | null;
  carrier?: string | null;
  supplierDeliveryNote?: string | null;
  /** Delivered quantity per reference; default the announced quantity. */
  delivered?: Record<string, number>;
}

/**
 * "Register receipt": Announced → QC pending, delivered quantities recorded (`registerPlan`: 0 to the quantity
 * announced, at least one unit), the viewer as receiving clerk, inspection to do ("Received complete" or "Received
 * incomplete"). Carrier and delivery note: as typed, else as announced.
 */
export async function registerReceipt(number: string, input: RegisterInput, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadReceipt(tx, number);
    if (r.status !== 'announced') throw new Error(`${number} is not announced`);
    const on = input.receivedOn ?? STATUS_ISO;
    if (!isIso(on)) throw new Error('Invalid receipt date');
    const lines = await tx.select({ l: receiptLines, ref: parts.ref }).from(receiptLines).innerJoin(parts, eq(parts.id, receiptLines.partId)).where(eq(receiptLines.receiptId, r.id));
    const plan = registerPlan(lines.map(({ l, ref }) => ({ ref, ordered: l.orderedQty })), input.delivered ?? {});
    if (!plan.ok) throw new Error(plan.error);
    for (const { l, ref } of lines) await tx.update(receiptLines).set({ deliveredQty: plan.value.delivered[ref], acceptedQty: 0, rejectedQty: 0 }).where(eq(receiptLines.id, l.id));
    const actor = await findPerson(tx, actorName);
    const at = new Date();
    await tx.update(goodsReceipts).set({
      status: 'qc_pending', receivedOn: on, carrier: input.carrier?.trim() || r.carrier, supplierDeliveryNote: input.supplierDeliveryNote?.trim() || r.supplierDeliveryNote,
      receivedByPersonId: actor?.id ?? null, qcByName: null, qcByPersonId: null, qcResult: 'Pending', qcRemarks: plan.value.remarks, updatedAt: at,
    }).where(eq(goodsReceipts.id, r.id));
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number,
      change: `status: Announced → QC pending${plan.value.complete ? '' : ' · received incomplete'}`, area: 'Deliveries', entityType: 'goods_receipt', entityId: r.id, projectId: r.projectId, occurredAt: at,
    });
  });
}

export interface QcLineInput {
  ref: string;
  accepted: number;
  rejected: number;
}

export interface QcInput {
  /** Per-line decision (accepted + rejected = delivered); default all accepted (accept) or all rejected (reject). */
  lines?: QcLineInput[];
  /** Inspection remarks (default per decision). */
  remarks?: string | null;
}

/** "Accept → stock": every delivered unit accepted. */
export async function acceptReceipt(number: string, input: Omit<QcInput, 'lines'>, actorName: string): Promise<ReceiptStatus> {
  return decideReceipt(number, 'accept', input, actorName);
}

/** "Reject → quarantine": every delivered unit rejected. */
export async function rejectReceipt(number: string, input: Omit<QcInput, 'lines'>, actorName: string): Promise<ReceiptStatus> {
  return decideReceipt(number, 'reject', input, actorName);
}

/** Per-line QC (partial acceptance, SC-3 / 08 OQ9): Accepted, Partially rejected or Rejected. */
export async function recordReceiptQc(number: string, input: QcInput & { lines: QcLineInput[] }, actorName: string): Promise<ReceiptStatus> {
  return decideReceipt(number, 'lines', input, actorName);
}

async function decideReceipt(number: string, mode: 'accept' | 'reject' | 'lines', input: QcInput, actorName: string): Promise<ReceiptStatus> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const r = await loadReceipt(tx, number);
    if (r.status !== 'qc_pending') throw new Error(`${number} is not waiting for a quality check`);
    const lines = await tx.select({ l: receiptLines, ref: parts.ref, loc: storageLocations }).from(receiptLines)
      .innerJoin(parts, eq(parts.id, receiptLines.partId)).innerJoin(storageLocations, eq(storageLocations.id, receiptLines.putAwayLocationId))
      .where(eq(receiptLines.receiptId, r.id)).orderBy(asc(receiptLines.position));
    if (mode === 'lines') {
      // Per-line API: accepted + rejected must add up to the delivered quantity of every line.
      if (input.lines?.some((x) => !lines.some((l) => l.ref === x.ref))) throw new Error(`${number}: unknown line in the decision`);
      for (const { l, ref } of lines) {
        const d = input.lines?.find((x) => x.ref === ref);
        if (!d) throw new Error(`Missing decision for ${ref}`);
        if (![d.accepted, d.rejected].every((x) => Number.isFinite(x) && x >= 0) || d.accepted + d.rejected !== l.deliveredQty)
          throw new Error(`${ref}: accepted + rejected must equal the ${l.deliveredQty} delivered`);
      }
    }
    const decision: QcDecision = mode === 'lines' ? { mode, rejected: Object.fromEntries((input.lines ?? []).map((x) => [x.ref, x.rejected])) } : { mode };
    const plan = qcPlan(lines.map(({ l, ref }) => ({ ref, delivered: l.deliveredQty })), decision, input.remarks);
    if (!plan.ok) throw new Error(plan.error);
    const decisions = plan.value.lines;
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const central = await locationOfType(tx, 'central_warehouse');
    const quarantine = await locationOfType(tx, 'quarantine');
    const totalAcc = plan.value.accepted;
    const totalRej = plan.value.rejected;
    const status: ReceiptStatus = plan.value.status;
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, r.poId));
    const poLineRows = await tx.select().from(poLines).where(eq(poLines.poId, po.id));
    let value = 0;
    for (const [i, { l, loc }] of lines.entries()) {
      const { accepted, rejected } = decisions[i];
      const heldInQuarantine = loc.type === 'quarantine';
      // Accepted goods held in quarantine are released to the central warehouse (`accept` 4456), as are goods put away
      // at a location Settings does not list (the generated receipts' "Magasin chantier — Lyon"); rejected ones go to quarantine.
      const putAway = putAwayAfterQc(loc, 1, central, quarantine);
      const dest = putAwayAfterQc(loc, accepted, central, quarantine);
      await tx.update(receiptLines).set({ acceptedQty: accepted, rejectedQty: rejected, putAwayLocationId: dest.id }).where(eq(receiptLines.id, l.id));
      const base = { partId: l.partId, personName: who, personId: actor?.id ?? null, receiptId: r.id, projectId: r.projectId };
      if (accepted > 0) {
        if (heldInQuarantine) {
          const held = await ensurePosition(tx, l.partId, loc.id);
          const moved = Math.min(accepted, held.onHand);
          if (moved > 0) await tx.update(stockPositions).set({ onHand: held.onHand - moved, reserved: Math.min(held.reserved, held.onHand - moved), source: 'local', lastMovementOn: STATUS_ISO, updatedAt: new Date() }).where(eq(stockPositions.id, held.id));
          const into = await ensurePosition(tx, l.partId, central.id);
          await tx.update(stockPositions).set({
            onHand: into.onHand + accepted, reserved: into.reserved + Math.min(held.reserved, moved), reservedForProjectId: held.reserved > 0 ? held.reservedForProjectId : into.reservedForProjectId,
            source: 'local', lastMovementOn: STATUS_ISO, updatedAt: new Date(),
          }).where(eq(stockPositions.id, into.id));
          await insertMovement(tx, { ...base, type: 'transfer', qty: accepted, fromLocationId: loc.id, toLocationId: central.id, whereText: `${loc.name} → ${central.name} · ${number} accepted` });
        } else {
          const into = await ensurePosition(tx, l.partId, putAway.id);
          await tx.update(stockPositions).set({ onHand: into.onHand + accepted, source: 'local', lastMovementOn: STATUS_ISO, updatedAt: new Date() }).where(eq(stockPositions.id, into.id));
          await insertMovement(tx, { ...base, type: 'receipt', qty: accepted, toLocationId: putAway.id, whereText: `${number} → ${putAway.name}` });
        }
      }
      if (rejected > 0 && !heldInQuarantine) {
        const into = await ensurePosition(tx, l.partId, quarantine.id);
        await tx.update(stockPositions).set({ onHand: into.onHand + rejected, source: 'local', lastMovementOn: STATUS_ISO, updatedAt: new Date() }).where(eq(stockPositions.id, into.id));
        await insertMovement(tx, { ...base, type: 'receipt', qty: rejected, toLocationId: quarantine.id, whereText: `${number} → ${quarantine.name} · QC failed` });
      }
      const pl = poLineRows.find((x) => x.partId === l.partId);
      if (pl) value += accepted * pl.unitPriceEur;
    }
    // The order's received quantities follow the accepted quantities of all its receipts.
    const accByPart = await tx.select({ partId: receiptLines.partId, acc: sql<number>`sum(${receiptLines.acceptedQty})::float8` }).from(receiptLines)
      .innerJoin(goodsReceipts, eq(goodsReceipts.id, receiptLines.receiptId)).where(eq(goodsReceipts.poId, po.id)).groupBy(receiptLines.partId);
    let full = true;
    let any = false;
    for (const pl of poLineRows) {
      const acc = accByPart.find((a) => a.partId === pl.partId)?.acc ?? 0;
      const received = Math.min(pl.orderedQty, Math.max(pl.receivedQty, acc));
      if (received !== pl.receivedQty) await tx.update(poLines).set({ receivedQty: received }).where(eq(poLines.id, pl.id));
      if (received < pl.orderedQty) full = false;
      if (received > 0) any = true;
    }
    const poStatusNext = po.status === 'ordered' || po.status === 'partially_received' ? (full ? 'received' : any ? 'partially_received' : po.status) : po.status;
    if (poStatusNext !== po.status) await tx.update(purchaseOrders).set({ status: poStatusNext, updatedAt: new Date() }).where(eq(purchaseOrders.id, po.id));
    // Invoices of the receipt — and invoices of the order still without one — see the accepted value.
    await tx.update(supplierInvoices).set({ receiptAmountEur: value, updatedAt: new Date() }).where(eq(supplierInvoices.receiptId, r.id));
    await tx.update(supplierInvoices).set({ receiptId: r.id, receiptAmountEur: value, updatedAt: new Date() })
      .where(and(eq(supplierInvoices.poId, po.id), sql`${supplierInvoices.receiptId} is null`, inArray(supplierInvoices.status, ['awaiting_receipt', 'blocked'])));
    const { result, remarks } = plan.value;
    const at = new Date();
    await tx.update(goodsReceipts).set({ status, qcByName: who, qcByPersonId: actor?.id ?? null, qcResult: result, qcRemarks: remarks, qcDecidedAt: at, updatedAt: at }).where(eq(goodsReceipts.id, r.id));
    await writeAudit(tx, {
      actorName: who, actorPersonId: actor?.id, objectRef: number,
      change: `QC ${result} · accepted ${totalAcc} · rejected ${totalRej} · status: QC pending → ${receiptStatus.label(status)}${poStatusNext !== po.status ? ` · ${po.number} → ${poStatusNext === 'received' ? 'Received' : 'Partially received'}` : ''}`,
      area: 'Deliveries', entityType: 'goods_receipt', entityId: r.id, projectId: r.projectId, occurredAt: at,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `${number} ${receiptStatus.label(status).toLowerCase()} · ${totalAcc} to stock${totalRej ? ` · ${totalRej} to quarantine` : ''}`, kind: 'delivery', projectId: r.projectId, occurredAt: at });
    return status;
  });
}

/** "Attach delivery note": a document on the receipt (file name; storage comes with the Codex hand-off, D-1). */
export async function attachReceiptDocument(number: string, fileName: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadReceipt(tx, number);
    const name = fileName.trim();
    if (!name) throw new Error('The file name is required');
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${receiptAttachments.position}), -1)::int` }).from(receiptAttachments).where(eq(receiptAttachments.receiptId, r.id));
    const actor = await findPerson(tx, actorName);
    await tx.insert(receiptAttachments).values({ receiptId: r.id, kind: 'document', fileName: name, addedByPersonId: actor?.id ?? null, position: pos + 1 });
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `document attached · ${name}`, area: 'Deliveries', entityType: 'goods_receipt', entityId: r.id, projectId: r.projectId });
  });
}
