import 'server-only';
// Purchasing DAL (docs/spec/08 §1 Sourcing — RFQs and supplier invoices, §2 Purchase orders; 11 §3.8). Orders carry
// their own line prices (A-11: the list price for the seed and the shortfall drafts, the quoted price for an RFQ award),
// so values match the prototype. Rules settled here, server-side:
// - PO approval (Approve & order, My approvals) belongs to the portfolio director and the project's manager (the
//   prototype's inbox routing; the Orders screen had no check, 08 OQ11); Reject cancels the order;
// - the BOM shortfall drafts one order per manufacturer (PO-1100…), lines at list price;
// - an RFQ is awarded by the project manager, procurement or the director; the award drafts the purchase order its
//   hint announces (SC-1) on the RFQ's project, else the only project whose BOM uses the part;
// - supplier invoices follow the 3-way match (`match3` 4663); "Approve received part" approves the receipt amount
//   and requests a credit note for the rest; an "Awaiting receipt" invoice whose receipt (accepted in Deliveries) covers
//   only part of it reads as Blocked (`matchedInvoiceStatus`); a rejected invoice cannot be rejected again.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { currencyOf, documentCurrencies, documentCurrencyError, eurRate, projectFxOf, type CurrencyCode } from '@/domain/currency';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import {
  RFQ_AWARD_ROLES, awardRule, incoterm, matchState, nextBusinessNumber, partStatus, poStatus, rfqStatus, splitActual, supplierInvoiceStatus,
  type AwardRule, type Incoterm, type MatchState, type PartStatus, type PoOrigin, type PoStatus, type RfqStatus, type SupplierGrade, type SupplierInvoiceStatus,
} from '@/server/db/codes';
import { actorOf, findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  activities, goodsReceipts, parts, partLastPrices, persons, poLines, projectBomLines, projects, purchaseOrders, rfqQuotes, rfqs, supplierInvoices, suppliers,
} from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { bomShortfall, type ShortfallLine } from '@/domain/bom';
import { isCancellablePo, poCancelReason, poCancelRight, poX3State, type PoCancelActor, type PoCancelKind } from '@/domain/orders';
import { leadsProject } from './project-team';
import { orderDeliveryTerms } from '@/domain/order-terms';

type Q = DB | Tx;
export type { ShortfallLine };

/** First number of the purchase orders drafted in Keystone (`createDrafts`: 'PO-' + (1100 + n)). */
export const DRAFT_PO_FLOOR = 1100;

// ── Purchase orders: read model ────────────────────────────────────────────────────────────────────────

export interface PoLineRow {
  ref: string;
  name: string;
  orderedQty: number;
  receivedQty: number;
  unitPriceEur: number;
  totalEur: number;
  partStatus: PartStatus;
  partStatusLabel: string;
}

export interface PoNeed {
  /** "A1320". */
  code: string;
  name: string;
  /** Start as shown, without the actual-date marker ("17 Aug"). */
  startText: string;
  startDate: string | null;
  percentComplete: number;
}

export interface PurchaseOrderRow {
  number: string;
  projectCode: string;
  supplier: string;
  status: PoStatus;
  /** "Awaiting approval". */
  statusLabel: string;
  origin: PoOrigin;
  /** Order date (the table shows "—" while Draft); null when unknown. */
  orderedOn: string | null;
  /** Null = "To confirm". */
  expectedOn: string | null;
  lines: PoLineRow[];
  /** C-9 (R-075): currency of the order — its line prices and value are in it (EUR or the project currency). */
  currency: CurrencyCode;
  /** Euros per unit of `currency` at the project's budget rate (1 for EUR): the Committed KPI consolidates with it. */
  eurRate: number;
  /** Currencies the order may use while Draft: EUR and the project currency (with its budget rate). */
  currencyOptions: CurrencyCode[];
  /** Σ qty × unit price, in `currency` (the name predates C-9). */
  valueEur: number;
  /** Σ received × unit price, €. */
  receivedValueEur: number;
  orderedUnits: number;
  receivedUnits: number;
  /** A line's part is Not validated / Outdated / Obsolete (" · part status issue"). */
  partStatusIssue: boolean;
  /** Activity that needs the material; null = "—". */
  neededFor: PoNeed | null;
  /** The activity has started and the order is still open (not Received / Cancelled): "delivery is late". */
  late: boolean;
  deliveryTerms: string;
  createdBy: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** R-095: why, by whom and when the order was cancelled before it was placed (cancelled, withdrawn or rejected); null otherwise. */
  cancellation: { at: string; by: string | null; reason: string } | null;
  x3Ref: string | null;
  position: number;
}

const OPEN_LINE_STATUSES: PoStatus[] = ['received', 'cancelled'];

async function loadOrders(q: Q, where: ReturnType<typeof eq> | undefined): Promise<PurchaseOrderRow[]> {
  const creator = sql<string | null>`(select coalesce(${persons.fullName}, ${persons.shortName}) from ${persons} where ${persons.id} = ${purchaseOrders.createdByPersonId})`;
  const submitter = sql<string | null>`(select coalesce(${persons.fullName}, ${persons.shortName}) from ${persons} where ${persons.id} = ${purchaseOrders.submittedByPersonId})`;
  const decider = sql<string | null>`(select coalesce(${persons.fullName}, ${persons.shortName}) from ${persons} where ${persons.id} = ${purchaseOrders.decidedByPersonId})`;
  const canceller = sql<string | null>`(select coalesce(${persons.fullName}, ${persons.shortName}) from ${persons} where ${persons.id} = ${purchaseOrders.cancelledByPersonId})`;
  const rows = await q
    .select({ o: purchaseOrders, code: projects.code, supplier: suppliers.name, creator, submitter, decider, canceller, act: activities, pCurrency: projects.currency, pRate: projects.budgetRate })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(activities, eq(activities.id, purchaseOrders.neededForActivityId))
    .where(where)
    .orderBy(asc(projects.sortOrder), asc(purchaseOrders.position));
  if (!rows.length) return [];
  const lines = await q
    .select({ l: poLines, ref: parts.ref, name: parts.name, status: parts.status })
    .from(poLines)
    .innerJoin(parts, eq(parts.id, poLines.partId))
    .where(inArray(poLines.poId, rows.map((r) => r.o.id)))
    .orderBy(asc(poLines.position));
  return rows.map(({ o, code, supplier, creator: c, submitter: s, decider: d, canceller, act, pCurrency, pRate }) => {
    const fx = projectFxOf({ currency: pCurrency, budgetRate: pRate });
    // A Received order shows every line fully received (`allPOs` 4308).
    const ls = lines.filter((l) => l.l.poId === o.id).map(({ l, ref, name, status }) => {
      const received = o.status === 'received' ? l.orderedQty : l.receivedQty;
      return { ref, name, orderedQty: l.orderedQty, receivedQty: received, unitPriceEur: l.unitPriceEur, totalEur: l.unitPriceEur * l.orderedQty, partStatus: status, partStatusLabel: partStatus.label(status) };
    });
    const need: PoNeed | null = act ? { code: act.code, name: act.name, startText: splitActual(act.startText).text, startDate: act.startDate, percentComplete: act.percentComplete } : null;
    return {
      number: o.number, projectCode: code, supplier, status: o.status, statusLabel: poStatus.label(o.status), origin: o.origin, orderedOn: o.orderedOn, expectedOn: o.expectedOn,
      lines: ls, currency: currencyOf(o.currency), eurRate: eurRate(o.currency, fx),
      currencyOptions: documentCurrencies(fx).filter((cur) => !documentCurrencyError(cur, fx)),
      valueEur: ls.reduce((a, l) => a + l.totalEur, 0), receivedValueEur: ls.reduce((a, l) => a + l.unitPriceEur * l.receivedQty, 0),
      orderedUnits: ls.reduce((a, l) => a + l.orderedQty, 0), receivedUnits: ls.reduce((a, l) => a + l.receivedQty, 0),
      partStatusIssue: ls.some((l) => l.partStatus !== 'validated'), neededFor: need,
      late: !!need && need.percentComplete > 0 && !OPEN_LINE_STATUSES.includes(o.status), deliveryTerms: o.deliveryTerms,
      createdBy: c, submittedBy: s, submittedAt: o.submittedAt?.toISOString() ?? null, decidedBy: d, decidedAt: o.decidedAt?.toISOString() ?? null, x3Ref: o.x3Ref,
      cancellation: o.status === 'cancelled' && o.cancelledAt && o.cancelReason ? { at: o.cancelledAt.toISOString(), by: canceller, reason: o.cancelReason } : null,
      position: o.position,
    };
  });
}

/** Purchase orders of a project (genPOs order, then the drafts made in Keystone). Empty for projects without orders. */
export async function listPurchaseOrders(projectCode: string): Promise<PurchaseOrderRow[]> {
  return loadOrders(await getDb(), eq(projects.code, projectCode));
}

export async function getPurchaseOrder(number: string): Promise<PurchaseOrderRow | null> {
  return (await loadOrders(await getDb(), eq(purchaseOrders.number, number)))[0] ?? null;
}

/** Every order, all projects (project register order) — Where-used, ECO impact ("Open purchase orders"). */
export async function listAllPurchaseOrders(): Promise<PurchaseOrderRow[]> {
  return loadOrders(await getDb(), undefined);
}

/** Orders of any project with a line on one of these parts (Where-used "Purchase orders", ECO impact). */
export async function listPurchaseOrdersWithParts(refs: string[]): Promise<PurchaseOrderRow[]> {
  const set = new Set(refs);
  return (await listAllPurchaseOrders()).filter((o) => o.lines.some((l) => set.has(l.ref)));
}

/** Orders awaiting approval per project code (sidebar badge of Purchase orders). */
export async function posAwaitingApprovalByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code, n: sql<number>`count(*)::int` })
    .from(purchaseOrders).innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(eq(purchaseOrders.status, 'awaiting_approval')).groupBy(projects.code);
  return Object.fromEntries(rows.map((r) => [r.code, r.n]));
}

/** Orders still to receive (Ordered or Partially received) of a project (Deliveries KPI "Open orders to receive"). */
export async function countOrdersToReceive(projectCode: string): Promise<number> {
  return (await listPurchaseOrders(projectCode)).filter((o) => o.status === 'ordered' || o.status === 'partially_received').length;
}

/**
 * BOM shortfall (`shortfall` 4327–4329): purchased parts of the project BOM ordered less than their BOM quantity on the
 * project's non-cancelled orders (stock is not considered), BOM order. Value at list price.
 */
export async function getBomShortfall(projectCode: string, q?: Q): Promise<{ lines: ShortfallLine[]; valueEur: number }> {
  const db = q ?? (await getDb());
  const p = await requireProject(db, projectCode);
  const [bom, ordered] = await Promise.all([
    db.select({ ref: parts.ref, name: parts.name, mb: parts.makeBuy, price: parts.listPriceEur, qty: projectBomLines.quantity, supplier: suppliers.name })
      .from(projectBomLines).innerJoin(parts, eq(parts.id, projectBomLines.partId)).leftJoin(suppliers, eq(suppliers.id, parts.manufacturerId))
      .where(eq(projectBomLines.projectId, p.id)).orderBy(asc(parts.position)),
    db.select({ ref: parts.ref, qty: sql<number>`sum(${poLines.orderedQty})::float8` })
      .from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId)).innerJoin(parts, eq(parts.id, poLines.partId))
      // Chapter 4 (E-3): spares orders (origin 'spares', BOM PU/PR list) never count against the BOM shortfall.
      .where(and(eq(purchaseOrders.projectId, p.id), ne(purchaseOrders.status, 'cancelled'), ne(purchaseOrders.origin, 'spares'))).groupBy(parts.ref),
  ]);
  // The rule is the BOM screen's (src/domain/bom.ts `bomShortfall`, golden-tested).
  return bomShortfall(
    bom.map((b) => ({ ref: b.ref, name: b.name, makeBuy: b.mb, quantity: b.qty, listPriceEur: b.price, supplier: b.supplier })),
    Object.fromEntries(ordered.map((o) => [o.ref, o.qty])),
  );
}

// ── Purchase orders: writers ───────────────────────────────────────────────────────────────────────────

async function nextDraftNumber(tx: Tx): Promise<string> {
  const all = (await tx.select({ n: purchaseOrders.number }).from(purchaseOrders)).map((r) => r.n);
  // Keystone drafts continue PO-1100…; past PO-1999 they follow the highest number in use.
  const inRange = all.filter((n) => /^PO-1\d{3}$/.test(n) && +n.slice(3) >= DRAFT_PO_FLOOR);
  const next = nextBusinessNumber(inRange, 'PO-', 4, DRAFT_PO_FLOOR - 1);
  return +next.slice(3) <= 1999 && !all.includes(next) ? next : nextBusinessNumber(all, 'PO-', 4);
}

/**
 * Inserts a Draft order (next PO-1100… number) with its lines, ordered on the business date (R-013; the prototype's status
 * date); returns the number. Also used by the spares orders (chapter 4).
 */
export async function insertOrder(
  tx: Tx,
  o: {
    projectId: string; supplierId: string; origin: PoOrigin; lines: { partId: string; qty: number; unitPriceEur: number }[]; createdBy: string | null; expectedOn?: string | null;
    /** R-169: what the data says (`orderDeliveryTerms`); empty ("To be agreed") by default. */
    deliveryTerms?: string;
  },
): Promise<string> {
  const number = await nextDraftNumber(tx);
  const orderedOn = await businessToday(tx);
  const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${purchaseOrders.position}), -1)::int` }).from(purchaseOrders).where(eq(purchaseOrders.projectId, o.projectId));
  const [po] = await tx
    .insert(purchaseOrders)
    .values({
      number, projectId: o.projectId, supplierId: o.supplierId, status: 'draft', origin: o.origin, orderedOn, expectedOn: o.expectedOn ?? null,
      deliveryTerms: o.deliveryTerms ?? orderDeliveryTerms(), createdByPersonId: o.createdBy, position: pos + 1,
    })
    .returning({ id: purchaseOrders.id });
  await tx.insert(poLines).values(o.lines.map((l, position) => ({ poId: po.id, partId: l.partId, orderedQty: l.qty, receivedQty: 0, unitPriceEur: l.unitPriceEur, position })));
  return number;
}

/**
 * "Create draft POs by supplier" / header "New purchase order" (`createDrafts` 4330): one Draft per manufacturer of the
 * shortfall lines, lines at list price, dated today, expected "To confirm". Returns the numbers (none when nothing is
 * short).
 */
export async function createDraftPurchaseOrders(projectCode: string, actorName: string): Promise<string[]> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const { lines } = await getBomShortfall(projectCode, tx);
    if (!lines.length) return [];
    const actor = await findPerson(tx, actorName);
    const bySupplier = new Map<string, ShortfallLine[]>();
    for (const l of lines) {
      if (!l.supplier) throw new Error(`${l.ref} has no manufacturer to order from`);
      bySupplier.set(l.supplier, [...(bySupplier.get(l.supplier) ?? []), l]);
    }
    const partIds = new Map((await tx.select({ id: parts.id, ref: parts.ref }).from(parts).where(inArray(parts.ref, lines.map((l) => l.ref)))).map((x) => [x.ref, x.id]));
    const numbers: string[] = [];
    for (const [supplier, ls] of bySupplier) {
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, supplier));
      const number = await insertOrder(tx, {
        projectId: p.id, supplierId: s.id, origin: 'shortfall', createdBy: actor?.id ?? null,
        lines: ls.map((l) => ({ partId: partIds.get(l.ref)!, qty: l.need, unitPriceEur: l.listPriceEur })),
      });
      numbers.push(number);
      await writeAudit(tx, {
        actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number,
        change: `draft created from the BOM shortfall · ${supplier} · ${ls.map((l) => `${l.ref} × ${l.need}`).join(', ')}`, area: 'Purchase orders', entityType: 'purchase_order', projectId: p.id,
      });
    }
    await recordActivity(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, text: `Drafted ${numbers.length} purchase orders from the BOM shortfall · ${numbers.join(', ')}`, kind: 'change', projectId: p.id });
    return numbers;
  });
}

async function loadPo(tx: Tx, number: string) {
  // Locked for the transaction (R-095): a withdrawal and an approval of the same order are serialised, the second one
  // re-reads the status and is refused.
  const [o] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.number, number)).for('update');
  if (!o) throw new Error(`Unknown purchase order ${number}`);
  return o;
}

/** Director or the project's PMs — PM of record, co-PMs, deputies (`apprItems` PO routing, R-041) — else throws. */
async function requirePoApprover(tx: Tx, projectId: string, actorName: string) {
  const a = await actorOf(tx, actorName);
  if (a.roles.includes('director') || (await leadsProject(tx, projectId, a.personId))) return a;
  throw new Error('Only the project manager or the portfolio director approves purchase orders');
}

/** "Send for approval": Draft → Awaiting approval. */
export async function submitPurchaseOrder(number: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const o = await loadPo(tx, number);
    if (o.status !== 'draft') throw new Error(`${number} is not a draft`);
    const actor = await findPerson(tx, actorName);
    const at = new Date();
    await tx.update(purchaseOrders).set({ status: 'awaiting_approval', submittedByPersonId: actor?.id ?? null, submittedAt: at, updatedAt: at }).where(eq(purchaseOrders.id, o.id));
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: 'status: Draft → Awaiting approval', area: 'Purchase orders', entityType: 'purchase_order', entityId: o.id, projectId: o.projectId, occurredAt: at });
  });
}

/** "Approve & order" (Orders, My approvals): Awaiting approval → Ordered, by the director or the project's manager. */
export async function approvePurchaseOrder(number: string, actorName: string): Promise<void> {
  await decidePurchaseOrder(number, 'ordered', actorName);
}

/**
 * My approvals "Reject": Awaiting approval → Cancelled, by the director or the project's manager. R-095: the reason is
 * required (trimmed, ≤ 1000 characters) and stored on the order with the rejecter and the time. Returns the persons to
 * tell (author and submitter, the rejecter left out) for a best-effort notice after the commit.
 */
export async function rejectPurchaseOrder(number: string, actorName: string, reason: string): Promise<PoCancelOutcome> {
  return decidePurchaseOrder(number, 'cancelled', actorName, checkedReason(reason));
}

async function decidePurchaseOrder(number: string, to: 'ordered' | 'cancelled', actorName: string, reason: string | null = null): Promise<PoCancelOutcome> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const o = await loadPo(tx, number);
    if (o.status !== 'awaiting_approval') throw new PurchaseOrderError('stale', `${number} is not awaiting approval`);
    const a = await requirePoApprover(tx, o.projectId, actorName);
    const at = new Date();
    const cancel = to === 'cancelled' ? { cancelReason: reason, cancelledByPersonId: a.personId, cancelledAt: at } : {};
    await tx.update(purchaseOrders).set({ status: to, decidedByPersonId: a.personId, decidedAt: at, updatedAt: at, ...cancel }).where(eq(purchaseOrders.id, o.id));
    await writeAudit(tx, {
      actorName: a.name, actorPersonId: a.personId, objectRef: number, change: `status: Awaiting approval → ${poStatus.label(to)}${reason ? ` · ${reason}` : ''}`, area: 'Purchase orders',
      entityType: 'purchase_order', entityId: o.id, projectId: o.projectId, occurredAt: at,
    });
    if (to === 'ordered') await recordActivity(tx, { actorName: a.name, actorPersonId: a.personId, text: `Approved and ordered ${number}`, kind: 'change', projectId: o.projectId, occurredAt: at });
    else await recordActivity(tx, { actorName: a.name, actorPersonId: a.personId, text: `Rejected ${number}`, kind: 'change', projectId: o.projectId, occurredAt: at });
    return { notify: othersThan([o.createdByPersonId, o.submittedByPersonId], a.personId) };
  });
}

// ── R-095: cancel an order before it is placed (SC-3a = a, P-5c = a) ───────────────────────────────────

/** Refusal of a cancellation / rejection: `stale` = the order moved on since the page was rendered. */
export type PurchaseOrderErrorCode = 'stale' | 'not_allowed' | 'not_local' | 'reason_required' | 'reason_too_long';
export class PurchaseOrderError extends Error {
  constructor(readonly code: PurchaseOrderErrorCode, message: string) {
    super(message);
    this.name = 'PurchaseOrderError';
  }
}

/** Who to tell after a cancellation or a rejection (persons, the actor left out). */
export interface PoCancelOutcome {
  notify: string[];
}

const othersThan = (ids: (string | null)[], actorId: string | null) => [...new Set(ids.filter((x): x is string => !!x && x !== actorId))];

/** The reason of a cancellation / rejection, checked again by the writer (trimmed, required, ≤ 1000 characters). */
function checkedReason(reason: unknown): string {
  const r = poCancelReason(reason);
  if (!r.ok) throw new PurchaseOrderError(r.error === 'The reason is too long' ? 'reason_too_long' : 'reason_required', r.error);
  return r.value;
}

/** PM rights on the project (PM of record, co-PM, deputy) or the portfolio director among the actor's roles (as `requirePoApprover`). */
async function poActor(q: Q, projectId: string, actorName: string): Promise<PoCancelActor & { name: string }> {
  const a = await actorOf(q, actorName);
  return { personId: a.personId, name: a.name, lead: a.roles.includes('director') || (await leadsProject(q, projectId, a.personId)) };
}

/** What the viewer may do to each order of the project before it is placed (`cancel` a Draft, `withdraw` from approval); absent = nothing. */
export async function poCancelRights(projectCode: string, actorName: string): Promise<Record<string, PoCancelKind>> {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return {};
  const rows = await db
    .select({
      number: purchaseOrders.number, status: purchaseOrders.status, origin: purchaseOrders.origin, x3Ref: purchaseOrders.x3Ref, createdByPersonId: purchaseOrders.createdByPersonId,
      submittedByPersonId: purchaseOrders.submittedByPersonId,
    })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.projectId, p.id), inArray(purchaseOrders.status, ['draft', 'awaiting_approval'])));
  if (!rows.some(isCancellablePo)) return {};
  const actor = await poActor(db, p.id, actorName);
  const out: Record<string, PoCancelKind> = {};
  for (const r of rows) {
    const k = poCancelRight(r, actor);
    if (k) out[r.number] = k;
  }
  return out;
}

/**
 * "Cancel order" (Orders drawer): a Draft cancelled by its author, the project's leads or the director; an order awaiting
 * approval withdrawn by whoever sent it (`poCancelRight`). Only orders drafted in Keystone and not in Sage X3; never once
 * placed. The status, the origin and the actor's right are re-read inside the transaction (a withdrawal racing an approval
 * loses cleanly); the reason (required, ≤ 1000 characters) is stored with the actor and the time, audited as
 * "status: Draft → Cancelled · <reason>". The RFQ that drafted the order stays awarded. Returns who to tell after the commit.
 */
export async function cancelPurchaseOrder(number: string, reason: string, actorName: string, at: Date = new Date()): Promise<PoCancelOutcome & { kind: PoCancelKind }> {
  const why = checkedReason(reason);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.number, number)).for('update');
    if (!o) throw new Error(`Unknown purchase order ${number}`);
    if (poX3State(o) !== 'local') throw new PurchaseOrderError('not_local', `${number} is in Sage X3: cancel it there`);
    if (!isCancellablePo(o)) throw new PurchaseOrderError('stale', `${number} can no longer be cancelled`);
    const actor = await poActor(tx, o.projectId, actorName);
    const kind = poCancelRight(o, actor);
    if (!kind) throw new PurchaseOrderError('not_allowed', `${actor.name} may not cancel ${number}`);
    await tx.update(purchaseOrders)
      .set({ status: 'cancelled', cancelReason: why, cancelledByPersonId: actor.personId, cancelledAt: at, updatedAt: at })
      .where(eq(purchaseOrders.id, o.id));
    await writeAudit(tx, {
      actorName: actor.name, actorPersonId: actor.personId, objectRef: number, change: `status: ${poStatus.label(o.status)} → Cancelled · ${why}`, area: 'Purchase orders',
      entityType: 'purchase_order', entityId: o.id, projectId: o.projectId, occurredAt: at,
    });
    await recordActivity(tx, {
      actorName: actor.name, actorPersonId: actor.personId, text: kind === 'withdraw' ? `Withdrew ${number} from approval` : `Cancelled ${number}`, kind: 'change',
      projectId: o.projectId, occurredAt: at,
    });
    return { kind, notify: othersThan([o.createdByPersonId, o.submittedByPersonId], actor.personId) };
  });
}

/** Can this person approve the project's purchase orders (director or the project's PMs and deputies)? For the screens' buttons. */
export async function canApprovePurchaseOrders(projectCode: string, actorName: string): Promise<boolean> {
  const db = await getDb();
  const a = await actorOf(db, actorName);
  if (a.roles.includes('director')) return true;
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  return !!p && leadsProject(db, p.id, a.personId);
}

// ── RFQs ───────────────────────────────────────────────────────────────────────────────────────────────

export interface RfqQuoteRow {
  supplier: string;
  unitPriceEur: number;
  /** unit × RFQ quantity (null without a quantity). */
  totalEur: number | null;
  leadWeeks: number;
  paymentTerms: string;
  grade: SupplierGrade;
  score: number;
  isBest: boolean;
  isFastest: boolean;
  /** (price − best) × quantity, € (0 for the best). */
  deltaEur: number;
  awarded: boolean;
}

export interface RfqRow {
  number: string;
  title: string;
  projectCode: string | null;
  partRef: string | null;
  partName: string | null;
  quantity: number | null;
  replyDueOn: string;
  status: RfqStatus;
  statusLabel: string;
  awardRule: AwardRule;
  awardRuleLabel: string;
  owner: string;
  incoterm: Incoterm | null;
  invitedSuppliers: string[];
  articlesText: string | null;
  quotes: RfqQuoteRow[];
  bestUnitPriceEur: number | null;
  awardedTo: string | null;
  awardedBy: string | null;
  /** Last purchase price of the part (LAST_PRICE ?? list). */
  lastPriceEur: number | null;
  /** Draft order created by the award. */
  purchaseOrderNumber: string | null;
  /** R-095: where that order stands now (Draft, Cancelled, Ordered…); null without an order. */
  purchaseOrderStatus: PoStatus | null;
  position: number;
}

async function loadRfqs(q: Q, number?: string): Promise<RfqRow[]> {
  const rows = await q
    .select({ r: rfqs, code: projects.code, ref: parts.ref, name: parts.name, list: parts.listPriceEur, last: partLastPrices.unitPriceEur, po: purchaseOrders.number, poSt: purchaseOrders.status, by: persons.fullName })
    .from(rfqs)
    .leftJoin(projects, eq(projects.id, rfqs.projectId))
    .leftJoin(parts, eq(parts.id, rfqs.partId))
    .leftJoin(partLastPrices, eq(partLastPrices.partId, rfqs.partId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, rfqs.purchaseOrderId))
    .leftJoin(persons, eq(persons.id, rfqs.awardedByPersonId))
    .where(number ? eq(rfqs.number, number) : undefined)
    .orderBy(asc(rfqs.position));
  if (!rows.length) return [];
  const quotes = await q
    .select({ qt: rfqQuotes, supplier: suppliers.name })
    .from(rfqQuotes).innerJoin(suppliers, eq(suppliers.id, rfqQuotes.supplierId))
    .where(inArray(rfqQuotes.rfqId, rows.map((r) => r.r.id))).orderBy(asc(rfqQuotes.position));
  return rows.map(({ r, code, ref, name, list, last, po, poSt, by }) => {
    const qs = quotes.filter((x) => x.qt.rfqId === r.id);
    const best = qs.length ? Math.min(...qs.map((x) => x.qt.unitPriceEur)) : null;
    const fastest = qs.length ? Math.min(...qs.map((x) => x.qt.leadWeeks)) : null;
    const awarded = qs.find((x) => x.qt.id === r.awardedQuoteId) ?? null;
    return {
      number: r.number, title: r.title, projectCode: code ?? null, partRef: ref ?? null, partName: name ?? null, quantity: r.quantity, replyDueOn: r.replyDueOn, status: r.status,
      statusLabel: rfqStatus.label(r.status), awardRule: r.awardRule, awardRuleLabel: awardRule.label(r.awardRule), owner: r.ownerName, incoterm: r.incoterm ?? null,
      invitedSuppliers: r.invitedSuppliers, articlesText: r.articlesText,
      quotes: qs.map(({ qt, supplier }) => ({
        supplier, unitPriceEur: qt.unitPriceEur, totalEur: r.quantity != null ? qt.unitPriceEur * r.quantity : null, leadWeeks: qt.leadWeeks, paymentTerms: qt.paymentTerms,
        grade: qt.grade, score: qt.score, isBest: qt.unitPriceEur === best, isFastest: qt.leadWeeks === fastest,
        deltaEur: best == null ? 0 : (qt.unitPriceEur - best) * (r.quantity ?? 1), awarded: qt.id === r.awardedQuoteId,
      })),
      bestUnitPriceEur: best, awardedTo: awarded?.supplier ?? null, awardedBy: by ?? null, lastPriceEur: ref ? (last ?? list) : null, purchaseOrderNumber: po ?? null, purchaseOrderStatus: poSt ?? null, position: r.position,
    };
  });
}

/** RFQs, Keystone-created first then RFQS order. */
export async function listRfqs(): Promise<RfqRow[]> {
  return loadRfqs(await getDb());
}

export async function getRfq(number: string): Promise<RfqRow | null> {
  return (await loadRfqs(await getDb(), number))[0] ?? null;
}

/** Can this person award RFQs (project manager, procurement, director — `rfqVals.canAward`)? */
export async function canAwardRfqs(actorName: string): Promise<boolean> {
  const a = await actorOf(await getDb(), actorName);
  return a.roles.some((r) => RFQ_AWARD_ROLES.includes(r));
}

export interface NewRfqInput {
  title: string;
  /** Suppliers consulted (form text "A, B, C" or a list). */
  suppliers: string | string[];
  /** Articles (form text); a catalogue reference found in it becomes the RFQ's part. */
  articles: string;
  /** Explicit part and quantity (when the screen offers them). */
  partRef?: string | null;
  quantity?: number | null;
  /** ISO reply date (form default 15 Oct 2026). */
  replyDueOn: string;
  incoterm?: Incoterm;
  projectCode?: string | null;
  awardRule?: AwardRule;
}

const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/**
 * "Send RFQ" (New RFQ form, AF.procurement): RFQ-<business year>-nnn (R-013), sent to the suppliers (status Open), the viewer as buyer.
 * The prototype only toasted; the RFQ is now recorded (SC-4, SC-7: suppliers stay free text until a picker exists).
 */
export async function createRfq(input: NewRfqInput, actorName: string): Promise<string> {
  const db = await getDb();
  const today = await businessToday();
  return db.transaction(async (tx) => {
    const title = input.title.trim();
    const articles = input.articles.trim();
    const invited = (Array.isArray(input.suppliers) ? input.suppliers : input.suppliers.split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean);
    if (!title) throw new Error('The title is required');
    if (!invited.length) throw new Error('At least one supplier is required');
    if (!articles && !input.partRef) throw new Error('The articles are required');
    if (!isIso(input.replyDueOn)) throw new Error('Invalid reply date');
    const inc = input.incoterm ?? 'DAP';
    if (!incoterm.isCode(inc)) throw new Error('Invalid incoterm');
    const rule = input.awardRule ?? 'pm_decides';
    if (!awardRule.isCode(rule)) throw new Error('Invalid award rule');
    if (input.quantity != null && (!Number.isFinite(input.quantity) || input.quantity <= 0)) throw new Error('Invalid quantity');
    let partId: string | null = null;
    const refs = input.partRef ? [input.partRef] : articles.toUpperCase().match(/[A-Z0-9]+(?:-[A-Z0-9]+)+/g) ?? [];
    if (refs.length) {
      const found = await tx.select({ id: parts.id, ref: parts.ref }).from(parts).where(inArray(parts.ref, refs));
      if (input.partRef && !found.length) throw new Error(`Unknown part ${input.partRef}`);
      partId = found.find((f) => f.ref === refs[0])?.id ?? found[0]?.id ?? null;
    }
    const project = input.projectCode ? await requireProject(tx, input.projectCode) : null;
    const all = (await tx.select({ n: rfqs.number }).from(rfqs)).map((r) => r.n);
    const number = nextBusinessNumber(all, `RFQ-${today.slice(0, 4)}-`, 3);
    const actor = await findPerson(tx, actorName);
    const [{ minPos }] = await tx.select({ minPos: sql<number>`coalesce(min(${rfqs.position}), 1)::int` }).from(rfqs);
    const [r] = await tx
      .insert(rfqs)
      .values({
        number, projectId: project?.id ?? null, title, partId, quantity: input.quantity ?? null, replyDueOn: input.replyDueOn, status: 'open', awardRule: rule,
        ownerName: actor ? nameOf(actor) : actorName, ownerPersonId: actor?.id ?? null, incoterm: inc, invitedSuppliers: invited, articlesText: articles || null,
        position: minPos - 1,
      })
      .returning({ id: rfqs.id });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `RFQ sent to ${invited.join(', ')} · reply ${input.replyDueOn} · ${incoterm.label(inc)}`,
      area: 'Sourcing', entityType: 'rfq', entityId: r.id, projectId: project?.id ?? null,
    });
    return number;
  });
}

async function loadRfq(tx: Tx, number: string) {
  const [r] = await tx.select().from(rfqs).where(eq(rfqs.number, number));
  if (!r) throw new Error(`Unknown RFQ ${number}`);
  return r;
}

async function rfqTransition(number: string, from: RfqStatus, to: RfqStatus, actorName: string, check?: (tx: Tx, id: string) => Promise<void>) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const r = await loadRfq(tx, number);
    if (r.status !== from) throw new Error(`${number} is not ${rfqStatus.label(from)}`);
    if (check) await check(tx, r.id);
    await tx.update(rfqs).set({ status: to, updatedAt: new Date() }).where(eq(rfqs.id, r.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `status: ${rfqStatus.label(from)} → ${rfqStatus.label(to)}`, area: 'Sourcing', entityType: 'rfq', entityId: r.id, projectId: r.projectId });
  });
}

/** "Send to suppliers": Draft → Open. */
export async function sendRfq(number: string, actorName: string): Promise<void> {
  await rfqTransition(number, 'draft', 'open', actorName);
}

/** "Compare quotes": Open → Comparing (2 quotes or more). */
export async function compareRfqQuotes(number: string, actorName: string): Promise<void> {
  await rfqTransition(number, 'open', 'comparing', actorName, async (tx, id) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(rfqQuotes).where(eq(rfqQuotes.rfqId, id));
    if (n < 2) throw new Error(`${number} needs at least two quotes to compare`);
  });
}

/**
 * "Award" a quote (pm, procurement, director): Comparing → Awarded, the quote chosen, and the draft purchase order the
 * hint announces — winner × part × quantity at the quoted price — on the RFQ's project, else the only project whose BOM
 * lists the part (none otherwise). Returns the order number or null.
 */
export async function awardRfq(number: string, supplierName: string, actorName: string): Promise<{ purchaseOrderNumber: string | null }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const r = await loadRfq(tx, number);
    if (r.status !== 'comparing' || r.awardedQuoteId) throw new Error(`${number} is not ready to award`);
    const a = await actorOf(tx, actorName);
    if (!a.roles.some((x) => RFQ_AWARD_ROLES.includes(x))) throw new Error('Only the project manager, procurement or the director awards an RFQ');
    const [quote] = await tx.select({ q: rfqQuotes, supplierId: suppliers.id }).from(rfqQuotes).innerJoin(suppliers, eq(suppliers.id, rfqQuotes.supplierId))
      .where(and(eq(rfqQuotes.rfqId, r.id), eq(suppliers.name, supplierName)));
    if (!quote) throw new Error(`${supplierName} has not quoted on ${number}`);
    let projectId = r.projectId;
    if (!projectId && r.partId) {
      const users_ = await tx.select({ projectId: projectBomLines.projectId }).from(projectBomLines).where(and(eq(projectBomLines.partId, r.partId), sql`${projectBomLines.quantity} > 0`));
      if (users_.length === 1) projectId = users_[0].projectId;
    }
    let poNumber: string | null = null;
    const at = new Date();
    if (projectId && r.partId && r.quantity) {
      poNumber = await insertOrder(tx, {
        projectId, supplierId: quote.supplierId, origin: 'rfq', createdBy: a.personId, lines: [{ partId: r.partId, qty: r.quantity, unitPriceEur: quote.q.unitPriceEur }],
        // R-169: the RFQ's Incoterm and the winning quote's payment terms (no longer "Site gate 2 · DAP · Net 30").
        deliveryTerms: orderDeliveryTerms({ incoterm: r.incoterm, paymentTerms: quote.q.paymentTerms }),
      });
    }
    const [po] = poNumber ? await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.number, poNumber)) : [];
    await tx.update(rfqs).set({ status: 'awarded', awardedQuoteId: quote.q.id, awardedByPersonId: a.personId, awardedAt: at, purchaseOrderId: po?.id ?? null, updatedAt: at }).where(eq(rfqs.id, r.id));
    await writeAudit(tx, {
      actorName: a.name, actorPersonId: a.personId, objectRef: number, change: `awarded to ${supplierName} · ${quote.q.unitPriceEur} € / unit${poNumber ? ` · draft ${poNumber}` : ''} · status: Comparing → Awarded`,
      area: 'Sourcing', entityType: 'rfq', entityId: r.id, projectId, occurredAt: at,
    });
    await recordActivity(tx, { actorName: a.name, actorPersonId: a.personId, text: `Awarded ${number} to ${supplierName}${poNumber ? ` · draft ${poNumber}` : ''}`, kind: 'change', projectId, occurredAt: at });
    return { purchaseOrderNumber: poNumber };
  });
}

// ── Supplier invoices (3-way match) ────────────────────────────────────────────────────────────────────

/**
 * 3-way match of an invoice (`match3` 4663): the order line (ok / diff / none) and the goods receipt (ok / partial /
 * pending / none). Same rule as `match3` in src/domain/procurement.ts (its tests compare both on the seed invoices),
 * kept here so the DAL does not load the screen registry (scripts/db-check.ts runs outside Next).
 */
export function threeWayMatch(i: { hasPo: boolean; hasReceipt: boolean; amountEur: number; poAmountEur: number; receiptAmountEur: number }): { po: MatchState; gr: MatchState } {
  return {
    po: i.hasPo ? (i.amountEur === i.poAmountEur ? 'ok' : 'diff') : 'none',
    gr: i.hasReceipt ? (i.receiptAmountEur >= i.amountEur ? 'ok' : i.receiptAmountEur > 0 ? 'partial' : 'pending') : 'none',
  };
}

export interface SupplierInvoiceRow {
  number: string;
  supplier: string;
  poNumber: string | null;
  receiptNumber: string | null;
  /** Project of the order (null without PO). */
  projectCode: string | null;
  /** C-9 (R-075): currency of the invoice as received from Sage X3 — its amounts below are in it. */
  currency: CurrencyCode;
  /** Euros per unit of `currency` at the order's project budget rate (1 for EUR or without project). */
  eurRate: number;
  /** Amount as the screens show it: the approved amount once approved, else the invoiced amount (`amount` after `invOv`). */
  amountEur: number;
  invoicedAmountEur: number;
  approvedAmountEur: number | null;
  /** Credit note requested by "Approve received part" (invoiced − approved). */
  creditNoteEur: number;
  poAmountEur: number;
  receiptAmountEur: number;
  /** amount − receipt amount when a receipt is referenced and it is short; null otherwise ("Not covered by receipt"). */
  gapEur: number | null;
  match: { po: MatchState; gr: MatchState };
  /** "Matched", "Partial receipt"… per leg. */
  matchLabels: { po: string; gr: string };
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  status: SupplierInvoiceStatus;
  statusLabel: string;
  /** EN source text of the drawer's "Blocking reason"; null = "—". */
  blockingReason: string | null;
  canApprove: boolean;
  canApprovePart: boolean;
  canReject: boolean;
  decidedBy: string | null;
  x3ApRef: string | null;
  position: number;
}

/**
 * Status as the 3-way match sees it (SC-2): an invoice still "Awaiting receipt" whose goods receipt now covers only part
 * of it — Deliveries QC accepted part of the goods (per-line QC), which updates the invoice's receipt amount — is blocked
 * by the match, like the seed's partial receipts (INV-HC-7781, INV-BX-55120). It can then be approved for the received
 * part and counts in the badge, the KPIs and My approvals instead of being left with "Reject invoice" only. The stored
 * status is not rewritten (the decisions write their own); every other status is the stored one.
 */
export function matchedInvoiceStatus(status: SupplierInvoiceStatus, gr: MatchState): SupplierInvoiceStatus {
  return status === 'awaiting_receipt' && gr === 'partial' ? 'blocked' : status;
}

/** Same rule as `blockingReason` in src/domain/procurement.ts (EN source; null = "—"). */
function blockingReasonOf(status: SupplierInvoiceStatus, m: { po: MatchState; gr: MatchState }): string | null {
  if (status === 'blocked') return m.gr === 'partial' ? 'Invoiced quantity exceeds accepted receipt (rejected units)' : 'Amount differs from PO';
  if (status === 'no_po') return 'No purchase order referenced — create PO or reject';
  if (status === 'awaiting_receipt') {
    if (m.gr === 'partial') return 'Invoiced quantity exceeds accepted receipt (rejected units)';
    if (m.gr === 'ok') return m.po === 'diff' ? 'Amount differs from PO' : null;
    return 'Goods not yet received';
  }
  return null;
}

async function loadInvoices(q: Q, number?: string): Promise<SupplierInvoiceRow[]> {
  const rows = await q
    .select({
      i: supplierInvoices, supplier: suppliers.name, po: purchaseOrders.number, poCurrency: purchaseOrders.currency, gr: goodsReceipts.number, code: projects.code,
      pCurrency: projects.currency, pRate: projects.budgetRate, by: persons.fullName,
    })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, supplierInvoices.poId))
    .leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .leftJoin(goodsReceipts, eq(goodsReceipts.id, supplierInvoices.receiptId))
    .leftJoin(persons, eq(persons.id, supplierInvoices.decidedByPersonId))
    .where(number ? eq(supplierInvoices.number, number) : undefined)
    .orderBy(asc(supplierInvoices.position));
  return rows.map(({ i, supplier, po, poCurrency, gr, code, pCurrency, pRate, by }) => {
    const amount = i.approvedAmountEur ?? i.amountEur;
    const matched = threeWayMatch({ hasPo: !!po, hasReceipt: !!gr, amountEur: amount, poAmountEur: i.poAmountEur, receiptAmountEur: i.receiptAmountEur });
    // C-9: an invoice in another currency than its order does not match the order (amounts are not comparable).
    const m = po && poCurrency && currencyOf(poCurrency) !== currencyOf(i.currency) ? { ...matched, po: 'diff' as const } : matched;
    const gap = amount - i.receiptAmountEur;
    const status = matchedInvoiceStatus(i.status, m.gr);
    return {
      number: i.number, supplier, poNumber: po ?? null, receiptNumber: gr ?? null, projectCode: code ?? null, currency: currencyOf(i.currency),
      eurRate: eurRate(i.currency, projectFxOf({ currency: pCurrency, budgetRate: pRate })), amountEur: amount, invoicedAmountEur: i.amountEur,
      approvedAmountEur: i.approvedAmountEur, creditNoteEur: i.approvedAmountEur != null ? i.amountEur - i.approvedAmountEur : 0, poAmountEur: i.poAmountEur,
      receiptAmountEur: i.receiptAmountEur, gapEur: gr && gap > 0 ? gap : null, match: m, matchLabels: { po: matchState.label(m.po), gr: matchState.label(m.gr) },
      invoiceDate: i.invoiceDate, dueDate: i.dueDate, paymentTerms: i.paymentTerms, status, statusLabel: supplierInvoiceStatus.label(status),
      blockingReason: blockingReasonOf(status, m),
      canApprove: (status === 'blocked' || status === 'awaiting_receipt') && m.po === 'ok' && m.gr === 'ok',
      // A rejected invoice is closed: no second rejection (same rule as `invoiceDecisions` in src/domain/procurement.ts).
      canApprovePart: status === 'blocked' && m.gr === 'partial', canReject: status !== 'paid' && status !== 'approved_for_payment' && status !== 'rejected',
      decidedBy: by ?? null, x3ApRef: i.x3ApRef, position: i.position,
    };
  });
}

/** Supplier invoices, INVOICES order. */
export async function listSupplierInvoices(): Promise<SupplierInvoiceRow[]> {
  return loadInvoices(await getDb());
}

export async function getSupplierInvoice(number: string): Promise<SupplierInvoiceRow | null> {
  return (await loadInvoices(await getDb(), number))[0] ?? null;
}

/** Invoices blocked by the 3-way match or without PO (sidebar badge of Sourcing & invoices), statuses as the match sees them. */
export async function countInvoicesToResolve(): Promise<number> {
  return (await invoiceQueue()).length;
}

async function decideInvoice(number: string, actorName: string, decide: (row: SupplierInvoiceRow) => { status: SupplierInvoiceStatus; approvedAmountEur?: number; change: string }) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await loadInvoices(tx, number);
    if (!row) throw new Error(`Unknown invoice ${number}`);
    const d = decide(row);
    const actor = await findPerson(tx, actorName);
    const at = new Date();
    const [inv] = await tx.select({ id: supplierInvoices.id }).from(supplierInvoices).where(eq(supplierInvoices.number, number));
    await tx.update(supplierInvoices).set({ status: d.status, approvedAmountEur: d.approvedAmountEur ?? null, decidedByPersonId: actor?.id ?? null, decidedAt: at, updatedAt: at })
      .where(eq(supplierInvoices.id, inv.id));
    const projectId = row.projectCode ? (await requireProject(tx, row.projectCode)).id : null;
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: number, change: `${d.change} · status: ${row.statusLabel} → ${supplierInvoiceStatus.label(d.status)}`, area: 'Sourcing', entityType: 'supplier_invoice', entityId: inv.id, projectId, occurredAt: at });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `${number} · ${row.supplier} · ${d.change}`, kind: 'invoice', projectId, occurredAt: at });
  });
}

/** "Approve payment" (Blocked / Awaiting receipt with order and receipt matched) → Approved for payment. */
export async function approveInvoicePayment(number: string, actorName: string): Promise<void> {
  await decideInvoice(number, actorName, (r) => {
    if (!r.canApprove) throw new Error(`${number} is not matched: it cannot be approved for payment`);
    return { status: 'approved_for_payment', approvedAmountEur: r.invoicedAmountEur, change: `approved for payment · ${r.invoicedAmountEur} €` };
  });
}

/** "Approve received part" (Blocked, receipt partial) → Approved for payment at the receipt amount; a credit note is requested for the rest. */
export async function approveInvoiceReceivedPart(number: string, actorName: string): Promise<void> {
  await decideInvoice(number, actorName, (r) => {
    if (!r.canApprovePart) throw new Error(`${number} has no partial receipt to approve`);
    return { status: 'approved_for_payment', approvedAmountEur: r.receiptAmountEur, change: `received part approved · ${r.receiptAmountEur} € · credit note requested ${r.invoicedAmountEur - r.receiptAmountEur} €` };
  });
}

/** "Reject invoice" (any open status: not Paid, Approved for payment or already Rejected) → Rejected. */
export async function rejectSupplierInvoice(number: string, actorName: string): Promise<void> {
  await decideInvoice(number, actorName, (r) => {
    if (!r.canReject) throw new Error(`${number} can no longer be rejected`);
    return { status: 'rejected', change: 'rejected' };
  });
}

// ── My approvals (database-backed kinds) ───────────────────────────────────────────────────────────────

export interface PoApprovalItem {
  number: string;
  supplier: string;
  /** Value in `currency` (C-9). */
  valueEur: number;
  currency: CurrencyCode;
  refs: string[];
  orderedOn: string | null;
  /** Who sent it for approval (the seed's buyer for the prototype orders). */
  submittedBy: string | null;
}

/** Orders of a project awaiting approval, for its approvers (apprItems 4723). Empty for anyone else. */
export async function poApprovalQueue(projectCode: string, actorName: string): Promise<PoApprovalItem[]> {
  if (!(await canApprovePurchaseOrders(projectCode, actorName))) return [];
  return (await listPurchaseOrders(projectCode))
    .filter((o) => o.status === 'awaiting_approval')
    .map((o) => ({ number: o.number, supplier: o.supplier, valueEur: o.valueEur, currency: o.currency, refs: o.lines.map((l) => l.ref), orderedOn: o.orderedOn, submittedBy: o.submittedBy }));
}

/** Orders of the project the person approved and ordered ("Decided this week": the prototype counted every Ordered PO). */
export async function poDecidedCount(projectCode: string, actorName: string): Promise<number> {
  if (!(await canApprovePurchaseOrders(projectCode, actorName))) return 0;
  return (await listPurchaseOrders(projectCode)).filter((o) => o.status === 'ordered').length;
}

/** RFQs ready to award (Comparing, no winner yet), RFQ order (apprItems 4728). */
export async function rfqAwardQueue(): Promise<RfqRow[]> {
  return (await listRfqs()).filter((r) => r.status === 'comparing' && !r.awardedTo);
}

/** Invoices blocked by the 3-way match or without PO (apprItems 4729). */
export async function invoiceQueue(): Promise<SupplierInvoiceRow[]> {
  return (await listSupplierInvoices()).filter((i) => i.status === 'blocked' || i.status === 'no_po');
}
