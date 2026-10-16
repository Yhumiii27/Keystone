// Deliveries & goods receipt (docs/spec/08 §3; prototype genDeliv / delivRow / delivKpis / delivVals / announce,
// logic 4447–4467, template 1598–1657; My approvals "Delivery — quality check", apprItems 4725).
// Pure part: status flow and tags, KPI tiles, status chips, the goods-receipt rows and the delivery drawer of the
// screen (English source text, rendered through t() by the feature), the QC routing rules, and the plans the
// data-layer writers apply — what an announced delivery covers, what "Register receipt" records and what a quality
// decision does to each line (Accept → stock, Reject → quarantine, or per line).
//
// Deviations from the prototype (docs/spec/00 §7.16, 08 OQ7–9, OQ11, OQ28):
// - "Announce a delivery" covers the quantities still to come on the order (ordered − received − already announced
//   or under inspection), so a second delivery of a partially received order can be announced; the entry is listed;
// - a quality decision may be partial (per line): Accepted, Partially rejected ("Failed on n units") or Rejected;
// - the inspector, the receiving clerk and the decision maker are the viewer (the prototype wrote Hélène Sauvage,
//   "Geodis" and 25 Sep into every receipt it registered);
// - quality decisions belong to the quality manager, procurement (the inbox routing) and the portfolio director;
// - quantities and percentages follow the language ("1 234", "0,5 %"); dates are not zero-padded ("2 Sep").
import type { RoleKey } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { RECEIPT_STATUS_TAG, fmtDOfIso, receiptStatus, type ReceiptStatus } from '@/server/db/codes';

// ── Status flow ────────────────────────────────────────────────────────────────────────────────────────

/** DELIV_FLOW (3474): Announced → (Received) → QC pending → Accepted | Partially rejected | Rejected. */
export const RECEIPT_FLOW: readonly ReceiptStatus[] = receiptStatus.codes;
export const isReceiptStatus = (v: unknown): v is ReceiptStatus => typeof v === 'string' && (RECEIPT_FLOW as readonly string[]).includes(v);
/** English status label ("QC pending"). */
export const receiptStatusLabel = (s: ReceiptStatus) => receiptStatus.label(s);
export type ReceiptTone = 'neutral' | 'accent' | 'outline';
/** Status tag tone (`dTag` 4451): Accepted / Announced neutral, (Partially) rejected accent, QC pending / Received outline. */
export const receiptTone = (s: ReceiptStatus): ReceiptTone => RECEIPT_STATUS_TAG[s].slice(4) as ReceiptTone;

// ── Inputs (the shape the DAL returns, `ReceiptRow`) ───────────────────────────────────────────────────

export interface ReceiptLineLike {
  ref: string;
  name: string;
  /** Quantity expected on this receipt (announced). */
  ordered: number;
  delivered: number;
  accepted: number;
  rejected: number;
  /** Put-away location name. */
  location: string;
}

export interface ReceiptLike {
  number: string;
  poNumber: string;
  supplier: string;
  status: ReceiptStatus;
  /** ISO: delivered on, or the announced date; null when unknown. */
  date: string | null;
  carrier: string | null;
  supplierDeliveryNote: string | null;
  lines: ReceiptLineLike[];
  qc: { by: string | null; result: string | null; remarks: string | null };
  documents: string[];
  photoCount: number;
  /** Receiving clerk (submitter of the quality check in My approvals). */
  receivedBy?: string | null;
}

// ── Formatting ─────────────────────────────────────────────────────────────────────────────────────────

/** Quantity ("1,234" EN, "1 234" FR — the prototype used the browser's locale, 08 §0.7). */
export const qtyText = (n: number, lang: Lang) => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
/** "18 Sep" / "13 Feb ’27" (English; months translated by t()); "—" when unknown. */
export const receiptDateText = (iso: string | null | undefined) => (iso ? fmtDOfIso(iso) : '—');
/** One decimal, the language's separator ("0.5" / "0,5"). */
const dec1 = (v: number, lang: Lang) => {
  const s = String(Math.round(v * 10) / 10);
  return lang === 'fr' ? s.replace('.', ',') : s;
};

export interface ReceiptTotals {
  ordered: number;
  delivered: number;
  accepted: number;
  rejected: number;
}
export const receiptTotals = (r: Pick<ReceiptLike, 'lines'>): ReceiptTotals => ({
  ordered: r.lines.reduce((a, l) => a + l.ordered, 0),
  delivered: r.lines.reduce((a, l) => a + l.delivered, 0),
  accepted: r.lines.reduce((a, l) => a + l.accepted, 0),
  rejected: r.lines.reduce((a, l) => a + l.rejected, 0),
});

// ── KPI tiles (delivKpis 4461) ─────────────────────────────────────────────────────────────────────────

// "On-time deliveries" is computed since chapter 4 (A-12, 08 OQ23): `onTimeDeliveryPct`, src/domain/kpis.ts — the
// prototype printed a constant 83 %.

export interface DeliveryKpi {
  /** English labels and sub-lines (parameterised ones are rendered by the FR rule engine). */
  label: string;
  value: string;
  sub: string;
  /** Value in LO (attention). */
  lo: boolean;
}

/**
 * Deliveries (count · "{n} announced"), Awaiting quality check (QC pending · "Held in quarantine"), Rejected quantity
 * (Σ rejected · "{x}% of units received" or "—"), On-time deliveries (`onTimePct`, A-12: received by the PO expected
 * date over the last 90 days, "—" when nothing was received), Open orders to receive (orders Ordered or Partially
 * received, from the purchasing DAL).
 */
export function deliveryKpis(rs: readonly ReceiptLike[], openOrdersToReceive: number, lang: Lang, onTimePct: number | null = null): DeliveryKpi[] {
  const qc = rs.filter((r) => r.status === 'qc_pending').length;
  const rej = rs.reduce((a, r) => a + receiptTotals(r).rejected, 0);
  const rec = rs.reduce((a, r) => a + receiptTotals(r).delivered, 0);
  return [
    { label: 'Deliveries', value: String(rs.length), sub: `${rs.filter((r) => r.status === 'announced').length} announced`, lo: false },
    { label: 'Awaiting quality check', value: String(qc), sub: 'Held in quarantine', lo: qc > 0 },
    { label: 'Rejected quantity', value: String(rej), sub: rec ? `${dec1((rej / rec) * 100, lang)}% of units received` : '—', lo: rej > 0 },
    { label: 'On-time deliveries', value: onTimePct == null ? '—' : `${onTimePct}%`, sub: 'Last 90 days · vs PO expected date', lo: false },
    { label: 'Open orders to receive', value: String(openOrdersToReceive), sub: 'Ordered or partially received', lo: false },
  ];
}

// ── Status chips (delivChips) and filter ───────────────────────────────────────────────────────────────

export interface DeliveryChip {
  /** null = All. */
  value: ReceiptStatus | null;
  label: string;
  count: number;
}

/** "All" + every DELIV_FLOW status, with counts (0 included, as the prototype). */
export const deliveryChips = (rs: readonly ReceiptLike[]): DeliveryChip[] => [
  { value: null, label: 'All', count: rs.length },
  ...RECEIPT_FLOW.map((s) => ({ value: s, label: receiptStatusLabel(s), count: rs.filter((r) => r.status === s).length })),
];

/** `?status=` value → filter (unknown values fall back to All). */
export const receiptFilterOf = (v: unknown): ReceiptStatus | null => (isReceiptStatus(v) ? v : null);
export const filterReceipts = <R extends ReceiptLike>(rs: readonly R[], filter: ReceiptStatus | null): R[] => (filter ? rs.filter((r) => r.status === filter) : [...rs]);

// ── Goods-receipt rows (delivRow 4453) ─────────────────────────────────────────────────────────────────

export interface ReceiptRowView {
  id: string;
  po: string;
  supplier: string;
  /** English date ("18 Sep"). */
  date: string;
  /** Supplier delivery note or "—". */
  note: string;
  /** Article refs joined with ", ". */
  lines: string;
  /** "Σ delivered / Σ ordered". */
  qty: string;
  acc: string;
  /** Σ rejected or "—". */
  rej: string;
  rejLo: boolean;
  status: ReceiptStatus;
  statusLabel: string;
  tone: ReceiptTone;
  /** Location of the first line (Put-away). */
  loc: string;
  /** QC result (data text) or "—". */
  qc: string;
  /** "Register receipt" (Announced). */
  canReceive: boolean;
  /** "Accept" / "Reject" (QC pending). */
  canQc: boolean;
}

export function receiptRowView(r: ReceiptLike, lang: Lang): ReceiptRowView {
  const t = receiptTotals(r);
  return {
    id: r.number,
    po: r.poNumber,
    supplier: r.supplier,
    date: receiptDateText(r.date),
    note: r.supplierDeliveryNote || '—',
    lines: r.lines.map((l) => l.ref).join(', '),
    qty: `${qtyText(t.delivered, lang)} / ${qtyText(t.ordered, lang)}`,
    acc: qtyText(t.accepted, lang),
    rej: t.rejected ? qtyText(t.rejected, lang) : '—',
    rejLo: t.rejected > 0,
    status: r.status,
    statusLabel: receiptStatusLabel(r.status),
    tone: receiptTone(r.status),
    loc: r.lines[0]?.location ?? '—',
    qc: r.qc.result || '—',
    canReceive: r.status === 'announced',
    canQc: r.status === 'qc_pending',
  };
}

// ── Delivery drawer (delivVals 4462–4465) ──────────────────────────────────────────────────────────────

export interface DrawerKv {
  /** English key. */
  k: string;
  /** Value; `kind` says how to render it. */
  v: string;
  /** `id` as is · `data` exact-match translation · `ui` / `date` through t(). */
  kind: 'id' | 'data' | 'ui' | 'date';
  lo: boolean;
}

export interface DrawerLineView {
  ref: string;
  name: string;
  o: string;
  d: string;
  a: string;
  /** Rejected or "—". */
  r: string;
  rLo: boolean;
  loc: string;
}

export interface ReceiptDrawerView {
  id: string;
  po: string;
  supplier: string;
  status: ReceiptStatus;
  statusLabel: string;
  tone: ReceiptTone;
  lines: DrawerLineView[];
  /** Purchase order · Supplier delivery note · Delivered on · Carrier · Photos. */
  meta: DrawerKv[];
  /** Inspector · Result (LO when it failed) · Remarks. */
  qc: DrawerKv[];
  docs: string[];
  photoCount: number;
  canReceive: boolean;
  canQc: boolean;
}

export function receiptDrawerView(r: ReceiptLike, lang: Lang): ReceiptDrawerView {
  const result = r.qc.result || '—';
  return {
    id: r.number,
    po: r.poNumber,
    supplier: r.supplier,
    status: r.status,
    statusLabel: receiptStatusLabel(r.status),
    tone: receiptTone(r.status),
    lines: r.lines.map((l) => ({
      ref: l.ref, name: l.name, o: qtyText(l.ordered, lang), d: qtyText(l.delivered, lang), a: qtyText(l.accepted, lang),
      r: l.rejected ? qtyText(l.rejected, lang) : '—', rLo: l.rejected > 0, loc: l.location,
    })),
    meta: [
      { k: 'Purchase order', v: r.poNumber, kind: 'id', lo: false },
      { k: 'Supplier delivery note', v: r.supplierDeliveryNote || '—', kind: 'data', lo: false },
      { k: 'Delivered on', v: receiptDateText(r.date), kind: 'date', lo: false },
      { k: 'Carrier', v: r.carrier || '—', kind: 'data', lo: false },
      { k: 'Photos', v: r.photoCount ? `${r.photoCount} attached` : 'None', kind: 'ui', lo: false },
    ],
    qc: [
      { k: 'Inspector', v: r.qc.by || '—', kind: 'id', lo: false },
      { k: 'Result', v: result, kind: 'data', lo: /Fail/.test(result) },
      { k: 'Remarks', v: r.qc.remarks || '—', kind: 'data', lo: false },
    ],
    docs: [...r.documents],
    photoCount: r.photoCount,
    canReceive: r.status === 'announced',
    canQc: r.status === 'qc_pending',
  };
}

// ── Who decides ────────────────────────────────────────────────────────────────────────────────────────

/** Roles whose My approvals inbox gets "Delivery — quality check" items (apprItems 4725). */
export const QC_INBOX_ROLES: readonly RoleKey[] = ['quality', 'procurement'];
/**
 * Roles allowed to record the incoming quality check (08 OQ11): the inbox's QC roles and the portfolio director.
 * The project manager registers receipts but does not accept his own goods.
 */
export const QC_DECIDERS: readonly RoleKey[] = ['quality', 'procurement', 'director'];
export const canDecideQc = (role: RoleKey) => QC_DECIDERS.includes(role);

// ── "Announce a delivery" (announce 4466): quantities still to come on an order ────────────────────────

export interface PoLineForAnnounce {
  ref: string;
  name: string;
  ordered: number;
  /** Received on the order (accepted at goods receipt, or the ERP's figure on the seed). */
  received: number;
}

export interface ReceiptForAnnounce {
  status: ReceiptStatus;
  lines: Pick<ReceiptLineLike, 'ref' | 'ordered' | 'delivered' | 'accepted'>[];
}

export interface AnnounceLine {
  ref: string;
  name: string;
  qty: number;
}

/**
 * Per line of an order, what a new delivery may still bring: ordered − max(received, accepted on decided receipts +
 * delivered on receipts under inspection) − announced on receipts not yet registered. Rejected units count as still
 * to come (the supplier replaces them). Lines with nothing left are dropped.
 */
export function remainingToAnnounce(poLines: readonly PoLineForAnnounce[], receipts: readonly ReceiptForAnnounce[]): AnnounceLine[] {
  return poLines
    .map((pl) => {
      let landed = 0;
      let announced = 0;
      for (const r of receipts)
        for (const l of r.lines) {
          if (l.ref !== pl.ref) continue;
          if (r.status === 'announced') announced += l.ordered;
          else if (r.status === 'qc_pending' || r.status === 'received') landed += l.delivered;
          else landed += l.accepted;
        }
      return { ref: pl.ref, name: pl.name, qty: Math.max(0, pl.ordered - Math.max(pl.received, landed) - announced) };
    })
    .filter((l) => l.qty > 0);
}

// ── Form parsing (server-side validation; English error text, translated by the caller) ────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Whole quantity as typed ("12", " 12 "); NaN otherwise. */
export function parseQty(raw: unknown): number {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : NaN;
  const s = String(raw ?? '').trim().replace(/[\s  ]/g, '');
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

export const MAX_REMARKS = 500;
export const MAX_FIELD = 120;

const clean = (v: unknown, max = MAX_FIELD) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ── "Register receipt" (receive 4455) ──────────────────────────────────────────────────────────────────

export const RECEIVED_COMPLETE = 'Received complete · inspection to do';
export const RECEIVED_INCOMPLETE = 'Received incomplete · inspection to do';

export interface RegisterPlan {
  /** Delivered quantity per reference. */
  delivered: Record<string, number>;
  complete: boolean;
  /** QC remarks while the inspection is pending. */
  remarks: string;
}

/**
 * Delivered quantities of a registered receipt: whole numbers between 0 and the quantity announced (a line left out:
 * the quantity announced), at least one unit delivered. "Received complete" when every line came in full.
 */
export function registerPlan(lines: readonly Pick<ReceiptLineLike, 'ref' | 'ordered'>[], delivered: Record<string, unknown> = {}): Parsed<RegisterPlan> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const raw = delivered[l.ref];
    const q = raw === undefined ? l.ordered : parseQty(raw);
    if (!Number.isFinite(q) || q < 0 || q > l.ordered) return { ok: false, error: 'Delivered quantities must be whole numbers between 0 and the quantity announced' };
    out[l.ref] = q;
  }
  if (!lines.length || Object.values(out).every((q) => q === 0)) return { ok: false, error: 'Nothing was delivered' };
  const complete = lines.every((l) => out[l.ref] === l.ordered);
  return { ok: true, value: { delivered: out, complete, remarks: complete ? RECEIVED_COMPLETE : RECEIVED_INCOMPLETE } };
}

// ── Quality decision (accept / reject 4456, per line) ──────────────────────────────────────────────────

export type QcDecision = { mode: 'accept' } | { mode: 'reject' } | { mode: 'lines'; rejected: Record<string, unknown> };
export type QcOutcome = 'accepted' | 'partially_rejected' | 'rejected';

/** Remarks recorded when the inspector types none (accept / reject 4456; per-line decision added). */
export const DEFAULT_QC_REMARKS: Record<QcOutcome, string> = {
  accepted: 'Conforming — released to stock',
  partially_rejected: 'Partially conforming — rejected units to quarantine',
  rejected: 'Non-conforming — supplier notified',
};

/** QC result of a partial decision ("Failed on 2 units"; the seed's "Failed on 2 drums" names its unit). */
export const failedOnText = (n: number) => `Failed on ${n} unit${n === 1 ? '' : 's'}`;

export interface LocationLike {
  name: string;
  /** Storage location type code ("quarantine", "site_store"…). */
  type: string;
  /** Listed in Settings (the generated receipts' "Magasin chantier — Lyon" is not). */
  active: boolean;
}

/**
 * Where a decided line is stocked (accept / reject 4456): accepted units at the put-away location — goods held in
 * quarantine are released to the central warehouse, as are goods put away at a location Settings does not list —
 * and a line with nothing accepted in quarantine. The line shows that location afterwards.
 */
export function putAwayAfterQc<L extends LocationLike>(loc: L, accepted: number, central: L, quarantine: L): L {
  if (accepted <= 0) return quarantine;
  return loc.type === 'quarantine' || !loc.active ? central : loc;
}

export interface QcPlan {
  lines: { ref: string; accepted: number; rejected: number }[];
  status: QcOutcome;
  /** "Passed" · "Failed" · "Failed on n units". */
  result: string;
  remarks: string;
  accepted: number;
  rejected: number;
}

/**
 * What a quality decision records on each line: Accept → every delivered unit accepted, Reject → every delivered unit
 * rejected, per line → the rejected quantity typed (0 to delivered), the rest accepted. Status Accepted when nothing
 * is rejected, Rejected when nothing is accepted, else Partially rejected.
 */
export function qcPlan(lines: readonly Pick<ReceiptLineLike, 'ref' | 'delivered'>[], decision: QcDecision, remarks?: string | null): Parsed<QcPlan> {
  const out: QcPlan['lines'] = [];
  for (const l of lines) {
    if (decision.mode === 'accept') out.push({ ref: l.ref, accepted: l.delivered, rejected: 0 });
    else if (decision.mode === 'reject') out.push({ ref: l.ref, accepted: 0, rejected: l.delivered });
    else {
      const raw = decision.rejected[l.ref];
      const rej = raw === undefined || raw === '' ? 0 : parseQty(raw);
      if (!Number.isFinite(rej) || rej < 0 || rej > l.delivered) return { ok: false, error: 'Rejected quantities must be whole numbers between 0 and the quantity delivered' };
      out.push({ ref: l.ref, accepted: l.delivered - rej, rejected: rej });
    }
  }
  if (decision.mode === 'lines' && Object.keys(decision.rejected).some((ref) => !lines.some((l) => l.ref === ref))) return { ok: false, error: 'Unknown article in the decision' };
  const accepted = out.reduce((a, l) => a + l.accepted, 0);
  const rejected = out.reduce((a, l) => a + l.rejected, 0);
  const status: QcOutcome = rejected === 0 ? 'accepted' : accepted === 0 ? 'rejected' : 'partially_rejected';
  const result = status === 'accepted' ? 'Passed' : status === 'rejected' ? 'Failed' : failedOnText(rejected);
  return { ok: true, value: { lines: out, status, result, remarks: clean(remarks, MAX_REMARKS) || DEFAULT_QC_REMARKS[status], accepted, rejected } };
}

// ── Forms ──────────────────────────────────────────────────────────────────────────────────────────────

export interface AnnounceForm {
  poNumber: string;
  /** ISO, or null = the order's expected date. */
  expectedOn: string | null;
  carrier: string | null;
  /** Put-away location name, or null = the project's default. */
  location: string | null;
}

/**
 * "Announce a delivery" form: purchase order (one of the orders still expecting goods), expected date (optional,
 * parsed with `parseDate`), carrier (optional), put-away (one of the offered locations, optional).
 */
export function parseAnnounceForm(
  v: Record<string, unknown>,
  opts: { orders: readonly string[]; locations: readonly string[]; parseDate: (s: string) => string | null },
): Parsed<AnnounceForm> {
  const po = clean(v.po);
  if (!opts.orders.includes(po)) return { ok: false, error: 'Choose a purchase order that is waiting for goods' };
  const dateText = clean(v.expected);
  const expectedOn = dateText ? opts.parseDate(dateText) : null;
  if (dateText && !expectedOn) return { ok: false, error: 'Enter a date such as 14 Dec 2026' };
  const location = clean(v.location);
  if (location && !opts.locations.includes(location)) return { ok: false, error: 'Unknown location' };
  return { ok: true, value: { poNumber: po, expectedOn, carrier: clean(v.carrier) || null, location: location || null } };
}

export interface RegisterForm {
  receivedOn: string;
  carrier: string | null;
  supplierDeliveryNote: string | null;
  plan: RegisterPlan;
}

/** Field id of a line's delivered quantity in the "Register receipt" form. */
export const qtyFieldId = (ref: string) => `qty:${ref}`;

/** "Register receipt" form: delivered on (default the business date `opts.today`, R-013), carrier, delivery note, delivered per line. */
export function parseRegisterForm(
  v: Record<string, unknown>,
  lines: readonly Pick<ReceiptLineLike, 'ref' | 'ordered'>[],
  opts: { today: string; parseDate: (s: string) => string | null },
): Parsed<RegisterForm> {
  const dateText = clean(v.date);
  const receivedOn = dateText ? opts.parseDate(dateText) : opts.today;
  if (!receivedOn) return { ok: false, error: 'Enter a date such as 14 Dec 2026' };
  const delivered: Record<string, unknown> = {};
  for (const l of lines) if (qtyFieldId(l.ref) in v) delivered[l.ref] = v[qtyFieldId(l.ref)];
  const plan = registerPlan(lines, delivered);
  if (!plan.ok) return plan;
  return { ok: true, value: { receivedOn, carrier: clean(v.carrier) || null, supplierDeliveryNote: clean(v.note) || null, plan: plan.value } };
}

// ── My approvals "Delivery — quality check" items ──────────────────────────────────────────────────────

export interface QcInboxItem {
  id: string;
  /** "{supplier} · {refs}". */
  title: string;
  /** QC remarks (data text). */
  sub: string;
  /** Receiving clerk. */
  who: string;
  /** "18 Sep". */
  when: string;
  whenIso: string | null;
}

/** Receipts of the current project waiting for their quality check, in list order (apprItems 4725). */
export const qcInboxItems = (rs: readonly ReceiptLike[]): QcInboxItem[] =>
  rs
    .filter((r) => r.status === 'qc_pending')
    .map((r) => ({
      id: r.number, title: `${r.supplier} · ${r.lines.map((l) => l.ref).join(', ')}`, sub: r.qc.remarks ?? '', who: r.receivedBy || '—',
      when: r.date ? receiptDateText(r.date) : '', whenIso: r.date,
    }));
