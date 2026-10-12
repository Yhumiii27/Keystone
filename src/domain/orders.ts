// Purchase orders (docs/spec/08 §2, template 2615–2688, logic 4306–4337; PO_FLOW 3414) — the pure rules of the
// Orders screen and of the "Purchase order" kind of My approvals: order value and units, open / committed / late
// orders, KPI figures, status counts, the row texts (articles summary, "needed by", late-delivery risk), the drawer
// stepper and the part-status warning, which buttons a status offers, and the Sage X3 local-change flag.
// Strings are the prototype's English source text (render them through t(); the French sentences that the
// prototype's rules get wrong are built in src/features/orders/i18n.ts).
//
// Rules settled here (docs/spec/00 §7.16, 08 OQ10–OQ12):
// - an order is late when the activity that needs it has started and it is still open (neither Received nor
//   Cancelled) — table, KPI and drawer agree (the prototype's drawer also flagged a cancelled order);
// - Sage X3 is the accounting reference (11 §3.8): an order drafted in Keystone (BOM shortfall, RFQ award) is a local
//   change until it is pushed to X3, which is offered once it is approved (Ordered or later);
// - the received quantity is driven by goods receipts (Deliveries): no "Receive" action here (08 OQ10).
import { screenHref } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { BASE_CURRENCY, moneyIn, type CurrencyCode } from './currency';
import type { PartStatus, PoOrigin, PoStatus } from '@/server/db/codes';
import { isoOfWhen, type ApprovalItem } from './approvals';

// ── Status machine (PO_FLOW 3414) ──────────────────────────────────────────────────────────────────────

/** Chip order: Draft → Awaiting approval → Ordered → Partially received → Received, plus Cancelled. */
export const PO_FLOW: readonly PoStatus[] = ['draft', 'awaiting_approval', 'ordered', 'partially_received', 'received', 'cancelled'];

export const isPoStatus = (v: unknown): v is PoStatus => typeof v === 'string' && (PO_FLOW as readonly string[]).includes(v);

/** "Send for approval" (row button): Draft only. */
export const canSubmitPo = (s: PoStatus) => s === 'draft';
/** "Approve & order" (row button, My approvals Approve / Reject): Awaiting approval only. */
export const canApprovePo = (s: PoStatus) => s === 'awaiting_approval';
/** Still to deliver or to decide (KPI "Open orders"; the late-delivery risk only concerns open orders). */
export const isOpenPo = (s: PoStatus) => s !== 'received' && s !== 'cancelled';
/** Counted in "Committed" (Ordered, not cancelled — Awaiting approval included, as in the prototype). */
export const isCommittedPo = (s: PoStatus) => s !== 'cancelled' && s !== 'draft';

// ── Cancellation before the order is placed (R-095: SC-3a = a, P-5c = a) ──────────────────────────────

/** Longest cancellation / rejection reason (characters, after trimming). */
export const PO_CANCEL_REASON_MAX = 1000;

/** `cancel` = a Draft cancelled; `withdraw` = an order awaiting approval withdrawn by whoever sent it. */
export type PoCancelKind = 'cancel' | 'withdraw';

export interface PoCancelInput {
  status: PoStatus;
  origin: PoOrigin;
  x3Ref: string | null;
  createdByPersonId: string | null;
  submittedByPersonId: string | null;
}

export interface PoCancelActor {
  personId: string | null;
  /** PM rights on the order's project (PM of record, co-PM, deputy) or the portfolio director. */
  lead: boolean;
}

/**
 * Who may cancel an order before it is placed (R-095) — the one place of the rule, so the owner's purchasing procedure
 * (P-5a, pending) changes it here only:
 * - only an order drafted in Keystone and not in Sage X3 (`poX3State` local: BOM shortfall, RFQ award, spares list); an
 *   order imported from X3 is cancelled in X3 (I-3b, A-1a);
 * - Draft: its author (SC-3a), and — a default beyond SC-3a, for the owner to confirm — the project's leads and the director;
 * - Awaiting approval: withdrawn by whoever sent it for approval (P-5c); the approvers keep Reject;
 * - never once Ordered (placed): SC-3a and P-5c disagree there, nothing is built.
 */
export function poCancelRight(o: PoCancelInput, actor: PoCancelActor): PoCancelKind | null {
  if (poX3State(o) !== 'local') return null;
  const me = (id: string | null) => !!actor.personId && id === actor.personId;
  if (o.status === 'draft') return me(o.createdByPersonId) || actor.lead ? 'cancel' : null;
  if (o.status === 'awaiting_approval') return me(o.submittedByPersonId) ? 'withdraw' : null;
  return null;
}

/** The order is still before placement and drafted in Keystone — the statuses `poCancelRight` may allow (role aside). */
export const isCancellablePo = (o: Pick<PoCancelInput, 'status' | 'origin' | 'x3Ref'>) =>
  poX3State(o) === 'local' && (o.status === 'draft' || o.status === 'awaiting_approval');

/** A cancellation or rejection reason: trimmed, required, at most PO_CANCEL_REASON_MAX characters. */
export function poCancelReason(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return { ok: false, error: 'Give the reason for the cancellation' };
  if (s.length > PO_CANCEL_REASON_MAX) return { ok: false, error: 'The reason is too long' };
  return { ok: true, value: s };
}

// ── Order shape read by the rules (the DAL's PurchaseOrderRow fits) ───────────────────────────────────

export interface PoLineInput {
  ref: string;
  name: string;
  orderedQty: number;
  receivedQty: number;
  unitPriceEur: number;
  partStatus: PartStatus;
}

export interface PoNeedInput {
  /** "A1320". */
  code: string;
  name: string;
  /** Start without the actual-date marker ("12 Oct"). */
  startText: string;
  percentComplete: number;
}

export interface PoInput {
  number: string;
  supplier: string;
  status: PoStatus;
  origin: PoOrigin;
  lines: PoLineInput[];
  neededFor: PoNeedInput | null;
  /** Sage X3 order reference once pushed. */
  x3Ref: string | null;
  /** C-9 (R-075): currency of the line prices (EUR when absent). */
  currency?: CurrencyCode;
  /** Euros per unit of `currency` at the project's budget rate (1 when absent). */
  eurRate?: number;
}

/** Order value in the order's currency (poValue 4309: Σ ordered qty × unit price of the line) — € unless stated (C-9). */
export const poValueEur = (o: Pick<PoInput, 'lines'>) => o.lines.reduce((a, l) => a + l.unitPriceEur * l.orderedQty, 0);
/** Units ordered (poQty). */
export const poUnits = (o: Pick<PoInput, 'lines'>) => o.lines.reduce((a, l) => a + l.orderedQty, 0);

/** The activity that needs the material has started and the order is still open (needOf / poRow risk, 4314–4315). */
export const isLatePo = (o: Pick<PoInput, 'status' | 'neededFor'>) => !!o.neededFor && o.neededFor.percentComplete > 0 && isOpenPo(o.status);

/** A line's part is Not validated, Outdated or Obsolete (" · part status issue"). */
export const hasPartStatusIssue = (o: Pick<PoInput, 'lines'>) => o.lines.some((l) => l.partStatus !== 'validated');

// ── List ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PoKpis {
  /** Not Received / Cancelled. */
  open: number;
  total: number;
  /** Σ value of the orders neither Cancelled nor Draft, € — consolidated at the project's budget rate (C-9). */
  committedEur: number;
  /** Open orders whose activity has started. */
  late: number;
  awaitingApproval: number;
}

/** KPI figures (poKpis 4326). */
export function poKpis(orders: readonly PoInput[]): PoKpis {
  return {
    open: orders.filter((o) => isOpenPo(o.status)).length,
    total: orders.length,
    committedEur: orders.filter((o) => isCommittedPo(o.status)).reduce((a, o) => a + poValueEur(o) * (o.eurRate ?? 1), 0),
    late: orders.filter(isLatePo).length,
    awaitingApproval: orders.filter((o) => o.status === 'awaiting_approval').length,
  };
}

/** Count per status, PO_FLOW order (poChips). */
export function poStatusCounts(orders: readonly Pick<PoInput, 'status'>[]): Record<PoStatus, number> {
  return Object.fromEntries(PO_FLOW.map((s) => [s, orders.filter((o) => o.status === s).length])) as Record<PoStatus, number>;
}

/** Orders shown for a status chip (null = All). */
export const filterPos = <O extends Pick<PoInput, 'status'>>(orders: readonly O[], status: PoStatus | null): O[] =>
  status ? orders.filter((o) => o.status === status) : [...orders];

/** "Articles" line 1: the first two references, then "+N" (lineSummary). */
export const lineSummary = (refs: readonly string[]) => refs.slice(0, 2).join(', ') + (refs.length > 2 ? ` +${refs.length - 2}` : '');

/** "Needed by" line 1: "A1320 · Crane delivery & rigging", "—" when no activity is linked. */
export const needText = (o: Pick<PoInput, 'neededFor'>) => (o.neededFor ? `${o.neededFor.code} · ${o.neededFor.name}` : '—');

/** "Needed by" line 2 (LO when late). */
export type PoRisk = { kind: 'late' } | { kind: 'from'; start: string } | null;
export const PO_LATE_TEXT = 'Activity already started — delivery is late';

export function poRisk(o: Pick<PoInput, 'status' | 'neededFor'>): PoRisk {
  if (isLatePo(o)) return { kind: 'late' };
  return o.neededFor?.startText ? { kind: 'from', start: o.neededFor.startText } : null;
}

/** EN source of the risk line ('' when none). */
export const poRiskText = (r: PoRisk) => (r?.kind === 'late' ? PO_LATE_TEXT : r?.kind === 'from' ? `Needed from ${r.start}` : '');

// ── Drawer ─────────────────────────────────────────────────────────────────────────────────────────────

export interface PoStep {
  label: 'Draft' | 'Approved' | 'Ordered';
  reached: boolean;
  /** Glow on "Ordered" while the order is Ordered or Partially received. */
  current: boolean;
}

/**
 * Drawer stepper (poVals.steps 4333): Draft is reached unless the order is cancelled; Approved and Ordered from
 * Ordered on (approving orders at once). A cancelled order reaches nothing. There is no "Received" step.
 */
export function poSteps(status: PoStatus): PoStep[] {
  const idx = PO_FLOW.indexOf(status);
  const cancelled = status === 'cancelled';
  return (['Draft', 'Approved', 'Ordered'] as const).map((label, i) => {
    const reached = !cancelled && (i === 0 || idx >= 2);
    return { label, reached, current: reached && i === 2 && idx >= 2 && idx < 4 };
  });
}

/** Lines whose part is not Validated, in line order (drawer warning "… is outdated — resolve in PLM …"). */
export const partWarnings = (o: Pick<PoInput, 'lines'>) => o.lines.filter((l) => l.partStatus !== 'validated').map((l) => ({ ref: l.ref, status: l.partStatus }));

// ── Sage X3 (local-change flag) ────────────────────────────────────────────────────────────────────────

/**
 * Where the order stands against Sage X3: `x3` = imported from X3 (seed / generated orders), `local` = drafted in
 * Keystone and not pushed yet (flagged until pushed back, like the stock lines), `pushed` = sent to X3 (x3Ref).
 */
export type PoX3State = 'x3' | 'local' | 'pushed';
export const poX3State = (o: Pick<PoInput, 'origin' | 'x3Ref'>): PoX3State => (o.origin === 'x3' ? 'x3' : o.x3Ref ? 'pushed' : 'local');

/** Statuses an order can be pushed to X3 in: approved (Ordered) or later, never cancelled. */
export const PO_PUSHABLE: readonly PoStatus[] = ['ordered', 'partially_received', 'received'];
export const canPushPoToX3 = (o: Pick<PoInput, 'origin' | 'x3Ref' | 'status'>) => poX3State(o) === 'local' && PO_PUSHABLE.includes(o.status);

/** X3 order reference given by the mock connector (TODO(X3): the real reference comes back from Sage X3). */
export const mockX3OrderRef = (number: string) => `X3-${number}`;

// ── My approvals ───────────────────────────────────────────────────────────────────────────────────────

export interface PoQueueEntry {
  number: string;
  supplier: string;
  /** Value in `currency` (€ unless stated, C-9). */
  valueEur: number;
  currency?: CurrencyCode;
  refs: string[];
  /** ISO order date. */
  orderedOn: string | null;
  submittedBy: string | null;
}

/** URL of the Orders screen with an order's drawer open. */
export const orderHref = (code: string, number: string) => `${screenHref('orders', { code })}?po=${encodeURIComponent(number)}`;

/**
 * "Purchase order" items of My approvals (apprItems 4724): orders of the current project awaiting approval, for
 * their approvers (the queue is already filtered by the data layer). Title "{supplier} · {value}", sub = references,
 * when = order date, who = whoever sent it for approval; decided inline (Approve → Ordered, Reject → Cancelled).
 * `when` is the English short date ("24 Sep"), translated by the inbox.
 */
export function poApprovalItems(queue: readonly PoQueueEntry[], code: string, lang: Lang, dateText: (iso: string) => string): ApprovalItem[] {
  return queue.map((o) => {
    const when = o.orderedOn ? dateText(o.orderedOn) : '';
    return {
      kind: 'po',
      id: o.number,
      title: `${o.supplier} · ${moneyIn(o.valueEur / 1000, o.currency ?? BASE_CURRENCY, lang)}`,
      sub: o.refs.join(', '),
      who: o.submittedBy ?? '',
      when,
      whenIso: o.orderedOn ?? isoOfWhen(when),
      href: orderHref(code, o.number),
      decision: { mode: 'purchase-order', projectCode: code, number: o.number },
    };
  });
}
