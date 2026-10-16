// Sourcing, invoices & suppliers — pure domain logic (docs/spec/08 §1; prototype logic 4646–4676, `match3` 4663,
// `rfqKpis` 4652, `invKpis` 4668, `supKpis` 4675, `apprItems` 4728–4729). Used by the Sourcing screen
// (src/features/procurement), its Server Functions and the My approvals providers of the RFQ-award and invoice kinds.
// Strings are the prototype's English source text; money is formatted per language like the prototype's `money$`.
//
// Rules kept from the prototype: the 3-way match states and dots, the invoice decision flags, the quote comparison
// (best unit price, shortest lead time, delta to best × quantity), the RFQ hint, the supplier thresholds (OTD < 85 %,
// NCR rate > 2 %) and the KPI formulas.
// Deviations (docs/spec/08 OQ5, OQ11, OQ22; 00 §7.16):
// - "Due within 30 days" uses the due date (≤ status date + 30 days); the prototype counted every unpaid invoice, which
//   gives the same 5 on the seed;
// - a Rejected invoice is closed: it leaves "Invoices to process" and "Due within 30 days" and gets its own chip once
//   one exists (the prototype kept counting it and had no chip);
// - invoice decisions (approve, approve received part, reject) belong to procurement and the portfolio director, the
//   roles My approvals routes invoices to (P-5); the prototype screen had no check;
// - the inbox sub-line of a Blocked invoice says why ("Amount differs from PO" when the order amount differs); the
//   prototype always said "Receipt does not cover invoice" (same text on the seed);
// - "1 quote" in the singular;
// - receipts accepted in Deliveries update the invoices' receipt amount (the prototype never did): an "Awaiting receipt"
//   invoice whose receipt now covers part of it is Blocked by the match (purchasing DAL `matchedInvoiceStatus`), one
//   received in full can be approved, and its blocking reason follows the match (SC-2).
import { screenHref, type RoleKey } from '@/config/screens';
import type { Lang, T } from '@/i18n/translate';
import { moneyEur } from '@/lib/format';
import { BASE_CURRENCY, moneyUnitsIn, type CurrencyCode } from './currency';
import {
  RFQ_AWARD_ROLES, addDaysIso, incoterm, shortDateYearOfIso,
  type Incoterm, type MatchState, type PoStatus, type RfqStatus, type SupplierGrade, type SupplierInvoiceStatus,
} from '@/server/db/codes';
import type { ApprovalItem } from './approvals';
import { parseNeedDate } from './team';

// ── Rights ─────────────────────────────────────────────────────────────────────────────────────────────

/** Roles that award an RFQ (`rfqVals.canAward` 4655: pm, procurement, director). */
export const canAwardRole = (role: RoleKey) => RFQ_AWARD_ROLES.includes(role);

/** Roles that decide supplier invoices: those My approvals routes invoices to (apprItems 4729; P-5 / 08 OQ11). */
export const INVOICE_DECIDER_ROLES: readonly RoleKey[] = ['procurement', 'director'];
export const canDecideInvoiceRole = (role: RoleKey) => INVOICE_DECIDER_ROLES.includes(role);

/** Roles whose My approvals lists the RFQs ready to award (apprItems 4728). */
export const RFQ_INBOX_ROLES: readonly RoleKey[] = ['pm', 'procurement'];

// ── 3-way match (`match3` 4663) ────────────────────────────────────────────────────────────────────────

export interface MatchInput {
  hasPo: boolean;
  hasReceipt: boolean;
  /** Invoice amount as shown (the approved amount once "Approve received part" was used), €. */
  amountEur: number;
  poAmountEur: number;
  receiptAmountEur: number;
}

export interface Match3 {
  /** Order leg: ok (amounts equal) · diff · none (no order referenced). */
  po: MatchState;
  /** Receipt leg: ok (receipt ≥ invoice) · partial (0 < receipt < invoice) · pending (nothing accepted) · none. */
  gr: MatchState;
}

export function match3(i: MatchInput): Match3 {
  return {
    po: i.hasPo ? (i.amountEur === i.poAmountEur ? 'ok' : 'diff') : 'none',
    gr: i.hasReceipt ? (i.receiptAmountEur >= i.amountEur ? 'ok' : i.receiptAmountEur > 0 ? 'partial' : 'pending') : 'none',
  };
}

/** Dot colour of a match state (`mDot`): ok accent · none neutral-100 · partial / diff accent-700 · pending neutral-700. */
export const MATCH_DOT: Record<MatchState, string> = {
  ok: 'var(--color-accent)',
  none: 'var(--color-neutral-100)',
  partial: 'var(--color-accent-700)',
  diff: 'var(--color-accent-700)',
  pending: 'var(--color-neutral-700)',
};

/** Amount not covered by the receipt (`gap`): invoice − receipt when a receipt is referenced and short, else null. */
export const receiptGap = (i: Pick<MatchInput, 'hasReceipt' | 'amountEur' | 'receiptAmountEur'>): number | null =>
  i.hasReceipt && i.amountEur - i.receiptAmountEur > 0 ? i.amountEur - i.receiptAmountEur : null;

export interface InvoiceDecisions {
  /** "Approve payment": Blocked / Awaiting receipt with both legs matched. */
  canApprove: boolean;
  /** "Approve received part": Blocked with a partial receipt (credit note requested for the rest). */
  canApprovePart: boolean;
  /** "Reject invoice": any open status (not Paid, Approved for payment or already Rejected). */
  canReject: boolean;
}

export function invoiceDecisions(status: SupplierInvoiceStatus, m: Match3): InvoiceDecisions {
  return {
    canApprove: (status === 'blocked' || status === 'awaiting_receipt') && m.po === 'ok' && m.gr === 'ok',
    canApprovePart: status === 'blocked' && m.gr === 'partial',
    canReject: status !== 'paid' && status !== 'approved_for_payment' && status !== 'rejected',
  };
}

/**
 * "Blocking reason" of the invoice drawer (EN source); null = "—". Prototype rules (invVals 4671); an "Awaiting receipt"
 * invoice whose receipt has since been accepted (Deliveries QC updates the receipt amount) gives the match's reason
 * instead of "Goods not yet received": none when order and receipt match ("Approve payment"), the order difference,
 * or the partial receipt (the purchasing DAL then shows the invoice as Blocked).
 */
export function blockingReason(status: SupplierInvoiceStatus, m: Match3): string | null {
  if (status === 'blocked') return m.gr === 'partial' ? 'Invoiced quantity exceeds accepted receipt (rejected units)' : 'Amount differs from PO';
  if (status === 'no_po') return 'No purchase order referenced — create PO or reject';
  if (status === 'awaiting_receipt') {
    if (m.gr === 'partial') return 'Invoiced quantity exceeds accepted receipt (rejected units)';
    if (m.gr === 'ok') return m.po === 'diff' ? 'Amount differs from PO' : null;
    return 'Goods not yet received';
  }
  return null;
}

/** Closed invoices: paid in X3 or rejected in Keystone. */
export const isInvoiceClosed = (status: SupplierInvoiceStatus) => status === 'paid' || status === 'rejected';
/** Blocked by the 3-way match or without order (sidebar badge, My approvals, KPI "Blocked by 3-way match"). */
export const isInvoiceToResolve = (status: SupplierInvoiceStatus) => status === 'blocked' || status === 'no_po';

// ── Invoice tab: chips and KPIs (`invChips` 4666, `invKpis` 4668) ──────────────────────────────────────

/** Status chips after "All", in the prototype order; "Rejected" is appended once an invoice has been rejected. */
export const INVOICE_CHIP_STATUSES: readonly SupplierInvoiceStatus[] = ['blocked', 'awaiting_receipt', 'no_po', 'approved_for_payment', 'paid'];

export function invoiceChipStatuses(invoices: readonly { status: SupplierInvoiceStatus }[]): SupplierInvoiceStatus[] {
  return invoices.some((i) => i.status === 'rejected') ? [...INVOICE_CHIP_STATUSES, 'rejected'] : [...INVOICE_CHIP_STATUSES];
}

export interface InvoiceForKpi {
  status: SupplierInvoiceStatus;
  /** Amount in the invoice's currency (C-9). */
  amountEur: number;
  /** Euros per unit of the invoice's currency at its project's budget rate (1 when absent): the KPI is consolidated in €. */
  eurRate?: number;
  /** ISO due date. */
  dueDate: string;
}

export interface InvoiceKpis {
  /** Not paid nor rejected, and their amount. */
  toProcess: number;
  toProcessEur: number;
  /** Blocked or No PO. */
  blocked: number;
  awaitingReceipt: number;
  approved: number;
  /** Open invoices (not paid nor rejected) due on or before the business date + 30 days (R-013; the prototype's status date). */
  dueWithin30: number;
}

export function invoiceKpis(invoices: readonly InvoiceForKpi[], todayIso: string): InvoiceKpis {
  const open = invoices.filter((i) => !isInvoiceClosed(i.status));
  const horizon = addDaysIso(todayIso, 30);
  return {
    toProcess: open.length,
    toProcessEur: open.reduce((a, i) => a + i.amountEur * (i.eurRate ?? 1), 0),
    blocked: invoices.filter((i) => isInvoiceToResolve(i.status)).length,
    awaitingReceipt: invoices.filter((i) => i.status === 'awaiting_receipt').length,
    approved: invoices.filter((i) => i.status === 'approved_for_payment').length,
    dueWithin30: open.filter((i) => i.dueDate <= horizon).length,
  };
}

// ── RFQs (`rfqRows` 4650, `rfqKpis` 4652, `rfqVals` 4653–4657) ─────────────────────────────────────────

// "Savings vs list" and "Average cycle" are computed since chapter 4 (A-12, 08 OQ23): `rfqSavingsKeur` and
// `rfqAverageCycleDays`, src/domain/kpis.ts (the prototype printed €12.4k and 9 d).

export interface RfqForKpi {
  status: RfqStatus;
  quoteCount: number;
}

export function rfqKpis(rfqs: readonly RfqForKpi[]) {
  return {
    /** Status ≠ Awarded. */
    open: rfqs.filter((r) => r.status !== 'awarded').length,
    /** Comparing ("{n} ready to award"). */
    readyToAward: rfqs.filter((r) => r.status === 'comparing').length,
    /** Every quote of every RFQ (the sub-line says "across open requests"; the prototype sums them all). */
    quotes: rfqs.reduce((a, r) => a + r.quoteCount, 0),
  };
}

export interface QuoteInput {
  supplier: string;
  unitPriceEur: number;
  leadWeeks: number;
}

export interface QuoteComparison {
  supplier: string;
  isBest: boolean;
  isFastest: boolean;
  /** unit × quantity, € (null without a quantity). */
  totalEur: number | null;
  /** (unit − best) × quantity, € — 0 for the best price ("—"). */
  deltaEur: number;
}

/** Quote comparison of an RFQ: best (lowest) unit price, shortest lead time, delta to the best × quantity. */
export function compareQuotes(quotes: readonly QuoteInput[], quantity: number | null): QuoteComparison[] {
  if (!quotes.length) return [];
  const best = Math.min(...quotes.map((q) => q.unitPriceEur));
  const fastest = Math.min(...quotes.map((q) => q.leadWeeks));
  return quotes.map((q) => ({
    supplier: q.supplier,
    isBest: q.unitPriceEur === best,
    isFastest: q.leadWeeks === fastest,
    totalEur: quantity != null ? q.unitPriceEur * quantity : null,
    deltaEur: (q.unitPriceEur - best) * (quantity ?? 1),
  }));
}

/** Best (lowest) unit price, € (null without quotes). */
export const bestUnitPrice = (quotes: readonly Pick<QuoteInput, 'unitPriceEur'>[]) => (quotes.length ? Math.min(...quotes.map((q) => q.unitPriceEur)) : null);

/** "3 quotes · from €1,195" / "No quote yet" (EN source; FR through the screen's translator). */
export function quotesText(quotes: readonly Pick<QuoteInput, 'unitPriceEur'>[], lang: Lang): string {
  const best = bestUnitPrice(quotes);
  if (best == null) return 'No quote yet';
  return `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'} · from ${moneyEur(best, lang)}`;
}

export interface RfqStateInput {
  status: RfqStatus;
  quoteCount: number;
  awardedTo: string | null;
}

/** Row / drawer actions: "Send to suppliers" (Draft) and "Compare quotes" (Open with at least two quotes). */
export const rfqActions = (r: RfqStateInput) => ({ canSend: r.status === 'draft', canCompare: r.status === 'open' && r.quoteCount > 1 });

/** "Award" a quote: Comparing, no winner yet, and a role that awards. */
export const canAwardRfq = (r: RfqStateInput, role: RoleKey) => r.status === 'comparing' && !r.awardedTo && canAwardRole(role);

/**
 * Footnote of the quote comparison (`rfqVals.hint`, EN source): who awards while Comparing, the award once Awarded.
 * An award made in Keystone without an order to draft (no project or quantity) says so instead of promising one.
 * R-095: once the drafted order moved on, the footnote says where it stands (sent for approval, placed, or cancelled before
 * it was placed — the RFQ itself stays awarded); a Draft keeps the prototype's sentence.
 */
export function rfqHint(
  r: RfqStateInput & { purchaseOrderNumber: string | null; awardedInKeystone: boolean; purchaseOrderStatus?: PoStatus | null },
  role: RoleKey,
): string {
  if (r.status === 'comparing' && !canAwardRole(role)) return 'Switch to Project manager or Procurement to award.';
  if (r.status === 'awarded' && r.awardedTo) {
    if (r.awardedInKeystone && !r.purchaseOrderNumber) return `Awarded to ${r.awardedTo} — no purchase order drafted (no project or quantity on the RFQ).`;
    const po = r.purchaseOrderNumber;
    const st = r.purchaseOrderStatus;
    if (po && st === 'cancelled') return `Awarded to ${r.awardedTo} — purchase order ${po} cancelled before it was placed.`;
    if (po && st === 'awaiting_approval') return `Awarded to ${r.awardedTo} — purchase order ${po} awaiting approval.`;
    if (po && (st === 'ordered' || st === 'partially_received' || st === 'received')) return `Awarded to ${r.awardedTo} — purchase order ${po} placed.`;
    return `Awarded to ${r.awardedTo} — purchase order created as draft.`;
  }
  return '';
}

// ── Suppliers (`supRows` 4674, `supKpis` 4675) ─────────────────────────────────────────────────────────

/** On-time delivery below this % is shown in the attention colour. */
export const OTD_ATTENTION_BELOW = 85;
/** NCR rate above this % is shown in the attention colour. */
export const NCR_RATE_ATTENTION_ABOVE = 2;

export interface SupplierForKpi {
  onTimeDeliveryPct: number;
  qualityAcceptancePct: number;
  ncrRatePct: number;
  grade: SupplierGrade;
}

export function supplierKpis(rows: readonly SupplierForKpi[]) {
  const n = rows.length;
  return {
    active: n,
    ratedA: rows.filter((s) => s.grade === 'A').length,
    /** Plain mean, rounded (the sub-line says "weighted"; the prototype averages). */
    onTimePct: n ? Math.round(rows.reduce((a, s) => a + s.onTimeDeliveryPct, 0) / n) : 0,
    qualityPct: n ? Math.round(rows.reduce((a, s) => a + s.qualityAcceptancePct, 0) / n) : 0,
    ratedC: rows.filter((s) => s.grade === 'C').length,
  };
}

export const supplierAttention = (s: Pick<SupplierForKpi, 'onTimeDeliveryPct' | 'ncrRatePct'>) => ({
  onTime: s.onTimeDeliveryPct < OTD_ATTENTION_BELOW,
  ncrRate: s.ncrRatePct > NCR_RATE_ATTENTION_ABOVE,
});

// ── URLs ───────────────────────────────────────────────────────────────────────────────────────────────

export type SourcingTab = 'rfq' | 'inv' | 'sup';
export const SOURCING_TABS: readonly SourcingTab[] = ['rfq', 'inv', 'sup'];
export const isSourcingTab = (v: unknown): v is SourcingTab => typeof v === 'string' && (SOURCING_TABS as readonly string[]).includes(v);

/** `/purchasing/sourcing?tab=…&rfq=…|inv=…&status=…` (the default tab rfq and empty values are left out). */
export function sourcingHref(p: { tab?: SourcingTab; rfq?: string | null; inv?: string | null; status?: string | null } = {}): string {
  const qs = new URLSearchParams();
  if (p.tab && p.tab !== 'rfq') qs.set('tab', p.tab);
  if (p.status) qs.set('status', p.status);
  if (p.rfq) qs.set('rfq', p.rfq);
  if (p.inv) qs.set('inv', p.inv);
  const s = qs.toString();
  return screenHref('procurement') + (s ? '?' + s : '');
}

// ── My approvals items (apprItems 4728–4729) ───────────────────────────────────────────────────────────

export interface RfqForInbox {
  number: string;
  title: string;
  status: RfqStatus;
  awardedTo: string | null;
  quoteCount: number;
  /** Award rule label (EN source, "Lowest total cost of ownership"). */
  awardRuleLabel: string;
  /** ISO reply date ("Quotes due"). */
  replyDueOn: string;
  owner: string;
}

/**
 * RFQs ready to award (Comparing, no winner), for the project manager and procurement; decided on Sourcing (no inline
 * decision). The sub-line "{n} quotes · {rule}" carries the rule already in the viewer's language: the shared French
 * rule `^(\d+) quotes · (.+)$` translates the count but leaves the rule in English (the prototype showed
 * "3 devis · Lowest total cost of ownership").
 */
export function rfqAwardItems(rfqs: readonly RfqForInbox[], t: T): ApprovalItem[] {
  return rfqs
    .filter((r) => r.status === 'comparing' && !r.awardedTo)
    .map((r) => {
      const when = shortDateYearOfIso(r.replyDueOn);
      return {
        kind: 'rfq',
        id: r.number,
        title: r.title,
        sub: `${r.quoteCount} ${r.quoteCount === 1 ? 'quote' : 'quotes'} · ${t(r.awardRuleLabel)}`,
        who: r.owner,
        when,
        whenIso: r.replyDueOn,
        href: sourcingHref({ tab: 'rfq', rfq: r.number }),
        decision: null,
      };
    });
}

export interface InvoiceForInbox {
  number: string;
  supplier: string;
  status: SupplierInvoiceStatus;
  /** Amount in `currency` (C-9; € when absent). */
  amountEur: number;
  currency?: CurrencyCode;
  match: Match3;
  /** ISO invoice date. */
  invoiceDate: string;
}

/** Inbox sub-line of an invoice to resolve (EN source). */
export const invoiceInboxSub = (i: Pick<InvoiceForInbox, 'status' | 'match'>) =>
  i.status === 'no_po' ? 'No purchase order referenced' : i.match.po === 'diff' ? 'Amount differs from PO' : 'Receipt does not cover invoice';

/** Invoices blocked by the 3-way match or without PO, for procurement and the director; decided on Sourcing. */
export function invoiceApprovalItems(invoices: readonly InvoiceForInbox[], lang: Lang): ApprovalItem[] {
  return invoices
    .filter((i) => isInvoiceToResolve(i.status))
    .map((i) => ({
      kind: 'invoice',
      id: i.number,
      title: `${i.supplier} · ${moneyUnitsIn(i.amountEur, i.currency ?? BASE_CURRENCY, lang)}`,
      sub: invoiceInboxSub(i),
      who: 'Accounts payable',
      when: shortDateYearOfIso(i.invoiceDate),
      whenIso: i.invoiceDate,
      href: sourcingHref({ tab: 'inv', inv: i.number }),
      decision: null,
    }));
}

// ── "New RFQ" form (AF.procurement) ────────────────────────────────────────────────────────────────────

export const NEW_RFQ_INCOTERMS: readonly Incoterm[] = incoterm.codes;

export interface NewRfqValues {
  title: string;
  suppliers: string[];
  articles: string;
  replyDueOn: string;
  incoterm: Incoterm;
}

export type ParseResult<V> = { ok: true; value: V } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const MAX_TEXT = 300;

/**
 * Validates the New RFQ form: title, suppliers (comma, semicolon or line separated) and articles are required; the
 * reply date is a date (EN or FR; by default the business date `todayIso` + 20 days, R-169, R-013) not before the business date;
 * the incoterm is a code.
 */
export function parseNewRfq(values: Record<string, unknown>, todayIso: string): ParseResult<NewRfqValues> {
  const title = text(values.title);
  const articles = text(values.articles);
  const suppliers = text(values.suppliers).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!title) return { ok: false, error: 'The title is required' };
  if (!suppliers.length) return { ok: false, error: 'Name at least one supplier' };
  if (!articles) return { ok: false, error: 'The articles are required' };
  if (title.length > MAX_TEXT || articles.length > MAX_TEXT || suppliers.length > 20 || suppliers.some((s) => s.length > 120)) return { ok: false, error: 'The text is too long' };
  const dueText = text(values.due);
  const replyDueOn = dueText ? parseNeedDate(dueText) : newRfqDefaultDueIso(todayIso);
  if (!replyDueOn) return { ok: false, error: 'Enter the reply date as a date (e.g. 15 Oct 2026)' };
  if (replyDueOn < todayIso) return { ok: false, error: 'The reply date is before the status date' };
  const inc = text(values.incoterm) || 'DAP';
  if (!incoterm.isCode(inc)) return { ok: false, error: 'Unknown incoterm' };
  return { ok: true, value: { title, suppliers: [...new Set(suppliers)], articles, replyDueOn, incoterm: inc } };
}

// ── Delivery 7 (R-169): computed tiles and form defaults instead of the prototype's constants ─────────────────────────

/**
 * "Award rule" tile (R-169, A-12; the prototype printed the constant "PM"): of the RFQs still to award (not Awarded),
 * how many the project manager decides ("PM decides") — the others follow their own rule (lowest TCO, technical first,
 * lowest price). "—" when nothing is left to award.
 */
export function awardRuleTile(rfqs: readonly { status: RfqStatus; awardRule: string }[]): { value: string; sub: string } {
  const open = rfqs.filter((r) => r.status !== 'awarded');
  if (!open.length) return { value: '—', sub: 'No RFQ to award' };
  return { value: `${open.filter((r) => r.awardRule === 'pm_decides').length} / ${open.length}`, sub: 'RFQs to award decided by the project manager' };
}

/** Days from the business date to the default reply date of a new RFQ (25 Sep → 15 Oct on the seed, as the prototype). */
export const NEW_RFQ_REPLY_DAYS = 20;

/** Default "Reply due" of a new RFQ (R-169: the business date + 20 days, R-013 — no longer the literal "15 Oct 2026"). */
export const newRfqDefaultDueIso = (asOf: string) => addDaysIso(asOf, NEW_RFQ_REPLY_DAYS);
