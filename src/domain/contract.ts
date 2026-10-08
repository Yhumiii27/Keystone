// Contract and Billing & payments: pure business logic (docs/spec/04 §3 Contract, §4 Billing; prototype logic
// 4869–4903 and the `amendment` / `bond` / `milestone` / `billing` buckets of afSubmit 5121–5127).
// - Figures: contract value (base + signed amendments), milestone amounts round(value × share / 100), late
//   milestones (planned, contractual date before PG_NOW), invoices (due = issued + payment delay in CALENDAR days —
//   not the prototype's DST-sensitive ms arithmetic, 04 Q12 / 00 §7.16), receivables, retention, schedule total.
// - The KPI sub-lines the prototype builds with explicit FR branches (4883, 4899), returned in the render language
//   but still to be passed through t() like the prototype's deepTr.
// - Parsing of the four add-forms and of the contract-sheet fields (codes, amounts with a French comma, dates typed
//   "14 Dec 2026" / "14 déc. 2026" / ISO).
// No I/O, no translation. Golden values: src/domain/contract.test.ts (prototype renderVals, EN and FR).
import type { Lang } from '@/i18n/translate';
import {
  NOW_ISO, addDaysIso, amendmentStatus, beforePgNow, bondType, contractType,
  type AmendmentStatus, type BondType, type ContractType, type CustomerInvoiceStatus, type PaymentMilestoneStatus,
} from '@/server/db/codes';
import { termsDays } from './evm';

// ── Input (structural: the Contract DAL rows satisfy it) ───────────────────────────────────────────────

export interface ContractSheetInput {
  reference: string;
  /** Base amount, k€. */
  baseAmountKeur: number;
  /** "Net 45 days" — payment delay = first integer (default 45). */
  paymentTerms: string;
  retentionPct: number;
  retentionNote: string;
  /** "0.5 % per week · cap 10 %" (rate · cap). */
  liquidatedDamages: string;
  warranty: string;
}

export interface AmendmentInput {
  /** "Amendment 1 — anti-collision lidar (CR-004)". */
  label: string;
  amountKeur: number;
  status: AmendmentStatus;
  signedOn: string | null;
  documentRef: string | null;
}

export interface BondInput {
  type: BondType;
  issuer: string | null;
  amountKeur: number;
  validUntil: string | null;
  releasedOn: string | null;
}

export interface InvoiceInput {
  number: string;
  /** ISO. */
  issuedOn: string;
  paidOn: string | null;
  note: string | null;
}

export interface MilestoneInput {
  number: string;
  label: string;
  sharePct: number;
  /** ISO contractual date. */
  contractualDue: string | null;
  condition: string | null;
  status: PaymentMilestoneStatus;
  /** Invoice of an invoiced / paid milestone. */
  invoice: InvoiceInput | null;
}

export interface ContractInput {
  sheet: ContractSheetInput;
  amendments: readonly AmendmentInput[];
  bonds: readonly BondInput[];
  /** Contractual order. */
  milestones: readonly MilestoneInput[];
}

// ── Figures ────────────────────────────────────────────────────────────────────────────────────────────

export interface MilestoneFigure extends MilestoneInput {
  /** round(contract value × share / 100), k€ — live: a signed amendment re-prices every milestone (as the prototype). */
  amountKeur: number;
  /** Planned and contractual date before the status "now" (PG_NOW ≈ 30 Sep 2026). */
  late: boolean;
}

export interface InvoiceFigure {
  number: string;
  milestone: string;
  label: string;
  issuedOn: string;
  /** Amount of the milestone (live, as `m.amt`). */
  amountKeur: number;
  /** issuedOn + payment delay, calendar days. */
  dueOn: string;
  paidOn: string | null;
  note: string | null;
  status: CustomerInvoiceStatus;
  /** Awaiting payment and due before NOWD (30 Sep 2026). */
  overdue: boolean;
  /** "Mark paid" applies (milestone invoiced). */
  canPay: boolean;
}

export interface ContractFigures {
  termsDays: number;
  /** Base + signed amendments (`ctrTotal`). */
  valueKeur: number;
  signed: { count: number; amountKeur: number };
  pending: { count: number; amountKeur: number };
  /** Bonds not released / all bonds / Σ amount in force. */
  bonds: { live: number; total: number; liveAmountKeur: number };
  milestones: MilestoneFigure[];
  /** Σ share, raw (%). */
  sharePct: number;
  /** |Σ share − 100| < 0.01. */
  shareOk: boolean;
  /** Σ milestone amounts. */
  scheduleAmountKeur: number;
  /** Invoices in milestone order. */
  invoices: InvoiceFigure[];
  /** Σ milestones not planned / paid (`ctrInvoiced`, `ctrPaid`). */
  invoicedKeur: number;
  paidKeur: number;
  outstandingKeur: number;
  /** Invoices not paid (`ctrAwait`). */
  awaitingCount: number;
  overdueCount: number;
  overdueKeur: number;
  /** round(paid × retention % / 100) — on collected amounts (C-8). */
  retentionKeur: number;
  /** Planned milestones, contractual order (`ctrToInvoice`). */
  toInvoice: MilestoneFigure[];
  /** First planned milestone (`ctrNext`). */
  next: MilestoneFigure | null;
  /** Late planned milestones (Billing nav badge `ctrBadge`). */
  lateCount: number;
}

export function contractFigures(c: ContractInput): ContractFigures {
  const delay = termsDays(c.sheet.paymentTerms);
  const signed = c.amendments.filter((a) => a.status === 'signed');
  const pending = c.amendments.filter((a) => a.status !== 'signed');
  const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  const valueKeur = c.sheet.baseAmountKeur + sum(signed, (a) => a.amountKeur);
  const live = c.bonds.filter((b) => !b.releasedOn);
  const milestones: MilestoneFigure[] = c.milestones.map((m) => ({
    ...m,
    amountKeur: Math.round((valueKeur * m.sharePct) / 100),
    late: m.status === 'planned' && beforePgNow(m.contractualDue),
  }));
  const invoices: InvoiceFigure[] = milestones.flatMap((m) => {
    if (m.status === 'planned' || !m.invoice) return [];
    const i = m.invoice;
    const dueOn = addDaysIso(i.issuedOn, delay);
    const paid = m.status === 'paid';
    const overdue = !paid && dueOn < NOW_ISO;
    return [{
      number: i.number, milestone: m.number, label: m.label, issuedOn: i.issuedOn, amountKeur: m.amountKeur, dueOn, paidOn: i.paidOn, note: i.note,
      status: paid ? 'paid' : overdue ? 'overdue' : 'awaiting_payment', overdue, canPay: m.status === 'invoiced',
    }];
  });
  const invoicedKeur = sum(milestones.filter((m) => m.status !== 'planned'), (m) => m.amountKeur);
  const paidKeur = sum(milestones.filter((m) => m.status === 'paid'), (m) => m.amountKeur);
  const overdue = invoices.filter((i) => i.overdue);
  const sharePct = sum(milestones, (m) => m.sharePct);
  const toInvoice = milestones.filter((m) => m.status === 'planned');
  return {
    termsDays: delay,
    valueKeur,
    signed: { count: signed.length, amountKeur: sum(signed, (a) => a.amountKeur) },
    pending: { count: pending.length, amountKeur: sum(pending, (a) => a.amountKeur) },
    bonds: { live: live.length, total: c.bonds.length, liveAmountKeur: sum(live, (b) => b.amountKeur) },
    milestones,
    sharePct,
    shareOk: Math.abs(sharePct - 100) < 0.01,
    scheduleAmountKeur: sum(milestones, (m) => m.amountKeur),
    invoices,
    invoicedKeur,
    paidKeur,
    outstandingKeur: invoicedKeur - paidKeur,
    awaitingCount: invoices.filter((i) => i.status !== 'paid').length,
    overdueCount: overdue.length,
    overdueKeur: sum(overdue, (i) => i.amountKeur),
    retentionKeur: Math.round((paidKeur * c.sheet.retentionPct) / 100),
    toInvoice,
    next: toInvoice[0] ?? null,
    lateCount: milestones.filter((m) => m.late).length,
  };
}

// ── Texts built by the prototype logic (pass them through t(), like deepTr) ───────────────────────────────

/** Share / percentage figure: "2.5" EN, "2,5" FR (the prototype kept the point in French). */
export const decimalText = (v: number, lang: Lang) => (lang === 'fr' ? String(v).replace('.', ',') : String(v));

/** Share cell "25 %" / Σ "102.5 %" (rounded to 0.1 for the total, `ctrSchedTotal`). */
export const shareText = (pct: number, lang: Lang) => `${decimalText(pct, lang)} %`;
export const shareTotalText = (pct: number, lang: Lang) => shareText(Math.round(pct * 10) / 10, lang);

/** Width of a share of the contract value, clamped 0–100 (`pctCss` "30.0%" / `pctW` "30.0 %"). */
export function progressShare(v: number, total: number): number {
  return total ? Math.max(0, Math.min(100, (v / total) * 100)) : 0;
}
export const progressCss = (v: number, total: number) => (total ? progressShare(v, total).toFixed(1) + '%' : '0%');
/** Legend share "30.0 %" (EN) / "30,0 %" (FR); "0 %" without a contract value. */
export function progressText(v: number, total: number, lang: Lang): string {
  if (!total) return '0 %';
  const s = progressShare(v, total).toFixed(1);
  return (lang === 'fr' ? s.replace('.', ',') : s) + ' %';
}

/**
 * "€5.40M base · 1 signed amendment" (EN) / "5,40 M€ de base · 1 avenant signé" (FR) — `ctrKpis[0].sub`. The
 * prototype writes "0 signed amendment" in English; the rebuild uses the plural for 0 in English, as for the
 * invoices awaiting payment (French keeps the singular, as French grammar wants).
 */
export function contractValueSub(base: string, signedCount: number, lang: Lang): string {
  if (lang === 'fr') return `${base} de base · ${signedCount}${signedCount > 1 ? ' avenants signés' : ' avenant signé'}`;
  return `${base} base · ${signedCount}${signedCount === 1 ? ' signed amendment' : ' signed amendments'}`;
}

/** `ctrKpis[1].sub`: "€260k awaiting signature" / "all amendments signed". */
export function pendingSub(count: number, amount: string, lang: Lang): string {
  if (count) return amount + (lang === 'fr' ? ' en attente de signature' : ' awaiting signature');
  return lang === 'fr' ? 'tous les avenants sont signés' : 'all amendments signed';
}

/** `ctrKpis[2].sub`: "€540k outstanding" / "540 k€ en vigueur". */
export const guaranteesSub = (amount: string, lang: Lang) => amount + (lang === 'fr' ? ' en vigueur' : ' outstanding');

/** `ctrKpis[3]`: "0.5 % per week · cap 10 %" → value "0.5 % per week", sub "cap 10 % · 24 months from SAT". */
export function liquidatedDamagesKpi(ld: string, warranty: string): { value: string; sub: string } {
  const [rate, cap] = String(ld).split(' · ');
  return { value: rate ?? '', sub: `${cap ?? ''} · ${warranty}` };
}

/** `ctrSchedTotal.hint`: '' when Σ shares = 100 %. */
export const scheduleHint = (ok: boolean, lang: Lang) => (ok ? '' : lang === 'fr' ? 'Les parts doivent totaliser 100 %' : 'Shares must total 100 %');

/** `billKpis[0].sub` "55 % of contract" (the FR rules give "55 % du contrat"). */
export const invoicedSub = (invoiced: number, total: number) => `${total ? Math.round((invoiced / total) * 100) : 0} % of contract`;

/** `billKpis[1].sub` "55 % of invoiced" / "55 % du facturé". */
export const collectedSub = (paid: number, invoiced: number, lang: Lang) =>
  `${invoiced ? Math.round((paid / invoiced) * 100) : 0}${lang === 'fr' ? ' % du facturé' : ' % of invoiced'}`;

/**
 * `billKpis[2].sub` "1 invoice awaiting payment · Net 45 days". The prototype writes "0 invoice …" in English;
 * the rebuild uses the plural for 0 in English (French keeps the singular, as French grammar wants).
 */
export function outstandingSub(n: number, terms: string, lang: Lang): string {
  if (lang === 'fr') return `${n}${n > 1 ? ' factures en attente · ' : ' facture en attente · '}${terms}`;
  return `${n}${n === 1 ? ' invoice awaiting payment · ' : ' invoices awaiting payment · '}${terms}`;
}

/** `billKpis[3].sub` "1 invoice(s) past due date" / "no late payment". */
export function overdueSub(n: number, lang: Lang): string {
  if (n) return n + (lang === 'fr' ? ' facture(s) au-delà de l’échéance' : ' invoice(s) past due date');
  return lang === 'fr' ? 'aucun retard de paiement' : 'no late payment';
}

/** `billKpis[4].sub` when every milestone is invoiced. */
export const allInvoicedSub = (lang: Lang) => (lang === 'fr' ? 'tous les jalons sont facturés' : 'all milestones invoiced');

/** Next invoice number of the prototype (`ctrNextInvNo`: "INV-2026-" + (invoices + 1), 3 digits). */
export const nextInvoiceNo = (invoiceCount: number) => 'INV-2026-' + String(invoiceCount + 1).padStart(3, '0');

// ── Dates typed in the forms ───────────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {};
['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].forEach((m, i) => (MONTHS[m] = i));
['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].forEach((m, i) => (MONTHS[m] = i));
// French abbreviations of the FR rules ("janv.", "févr.", "sept."…) and full names.
['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'].forEach((m, i) => (MONTHS[m] = i));
['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'].forEach((m, i) => (MONTHS[m] = i));
Object.assign(MONTHS, { fevr: 1, fev: 1, fevrier: 1, aout: 7, dec: 11, decembre: 11, sept: 8 });

const pad2 = (n: number) => String(n).padStart(2, '0');
function isoOf(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || m < 0 || m > 11 || d < 1) return null;
  const t = new Date(Date.UTC(y, m, d));
  if (t.getUTCMonth() !== m || t.getUTCDate() !== d) return null;
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/**
 * A date as typed in the forms → ISO, or null. Accepts the prototype's display forms in both languages
 * ("14 Dec 2026", "14 déc. 2026", "14 décembre 2026", "1er oct. 2026"), "14/12/2026" and ISO "2026-12-14".
 * The year defaults to 2026 (the data set's year, as the prototype's `parseD`); "’27" means 2027.
 */
export function parseDateInput(raw: string | null | undefined, defaultYear = 2026): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoOf(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(s);
  if (m) return isoOf(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : defaultYear, +m[2] - 1, +m[1]);
  m = /^(\d{1,2})(?:er)?\s+([a-zéû]+)\.?(?:\s+(?:’|')?(\d{2}|\d{4}))?$/.exec(s);
  if (!m) return null;
  const mo = MONTHS[m[2]];
  if (mo === undefined) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : defaultYear;
  return isoOf(y, mo, +m[1]);
}

// ── Form parsing (server-side validation of the add-forms and the sheet) ─────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Error shown for an unparsable date (English source, translated by the caller). */
export const DATE_ERROR = 'Enter a date such as 14 Dec 2026';
export const MAX_TEXT = 200;
export const MAX_LONG_TEXT = 2000;
/** Bound of a single amount (k€): guards typing slips such as an amount in euros. */
export const MAX_AMOUNT = 1_000_000;

/** Number as typed ("12", "12.5", "12,5", " 7 "); NaN when not a number. */
export function parseNumber(raw: string | null | undefined): number {
  const s = String(raw ?? '').trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^[+−-]?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s.replace('−', '-'));
}

const text = (v: string | undefined) => (v ?? '').trim();

export interface AmendmentForm {
  subject: string;
  changeRequestRef: string | null;
  amountKeur: number;
  status: AmendmentStatus;
  signedOn: string | null;
  documentRef: string | null;
}

/** AF.amendment: subject* · linked CR · amount* (k€, may be negative for a reduction) · status · signature date · document. */
export function parseAmendmentForm(v: Record<string, string | undefined>): ParseResult<AmendmentForm> {
  const subject = text(v.label);
  if (!subject) return { ok: false, error: 'Subject is required' };
  if (subject.length > MAX_TEXT) return { ok: false, error: 'Subject is too long' };
  const amount = parseNumber(v.amt);
  if (!Number.isFinite(amount) || Math.abs(amount) > MAX_AMOUNT) return { ok: false, error: 'Enter an amount in k€' };
  const status = text(v.status) || 'draft';
  if (!amendmentStatus.isCode(status)) return { ok: false, error: 'Unknown status' };
  const date = text(v.date);
  const signedOn = date ? parseDateInput(date) : null;
  if (date && !signedOn) return { ok: false, error: DATE_ERROR };
  const cr = text(v.cr);
  const doc = text(v.doc);
  if (cr.length > 40 || doc.length > 60) return { ok: false, error: 'Reference is too long' };
  return { ok: true, value: { subject, changeRequestRef: cr || null, amountKeur: amount, status, signedOn, documentRef: doc || null } };
}

export interface BondForm {
  type: BondType;
  amountKeur: number;
  issuer: string;
  validUntil: string;
}

/** AF.bond: type · amount* (k€ ≥ 0) · issuer* · valid until* (date). */
export function parseBondForm(v: Record<string, string | undefined>): ParseResult<BondForm> {
  const type = text(v.label) || 'performance';
  if (!bondType.isCode(type)) return { ok: false, error: 'Unknown guarantee type' };
  const amount = parseNumber(v.amt);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) return { ok: false, error: 'Enter an amount in k€' };
  const issuer = text(v.issuer);
  if (!issuer) return { ok: false, error: 'Issuer is required' };
  if (issuer.length > MAX_TEXT) return { ok: false, error: 'Issuer is too long' };
  const validUntil = parseDateInput(v.valid);
  if (!validUntil) return { ok: false, error: DATE_ERROR };
  return { ok: true, value: { type, amountKeur: amount, issuer, validUntil } };
}

export interface MilestoneForm {
  label: string;
  sharePct: number;
  contractualDue: string;
  condition: string | null;
}

/** AF.milestone: milestone* · share of contract* (0 < % ≤ 100) · contractual date* · condition. Σ > 100 % only warns (C-7). */
export function parseMilestoneForm(v: Record<string, string | undefined>): ParseResult<MilestoneForm> {
  const label = text(v.label);
  if (!label) return { ok: false, error: 'Milestone is required' };
  if (label.length > MAX_TEXT) return { ok: false, error: 'Milestone is too long' };
  const pct = parseNumber(v.pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { ok: false, error: 'Enter a share between 0 and 100 %' };
  const due = parseDateInput(v.due);
  if (!due) return { ok: false, error: DATE_ERROR };
  const cond = text(v.cond);
  if (cond.length > MAX_LONG_TEXT) return { ok: false, error: 'Condition is too long' };
  return { ok: true, value: { label, sharePct: Math.round(pct * 100) / 100, contractualDue: due, condition: cond || null } };
}

export interface InvoiceForm {
  milestone: string;
  invoiceNumber: string;
  issuedOn: string;
  note: string | null;
}

/**
 * AF.billing: milestone (a planned one — select, first option when empty) · invoice number* · invoice date* ·
 * note. `planned` = the planned milestone numbers in contractual order.
 */
export function parseInvoiceForm(v: Record<string, string | undefined>, planned: readonly string[]): ParseResult<InvoiceForm> {
  const ms = text(v.ms).split(' · ')[0] || planned[0] || '';
  if (!planned.includes(ms)) return { ok: false, error: 'Choose a milestone still to invoice' };
  const no = text(v.no);
  if (!no) return { ok: false, error: 'Invoice number is required' };
  if (no.length > 40) return { ok: false, error: 'Invoice number is too long' };
  const issuedOn = parseDateInput(v.date);
  if (!issuedOn) return { ok: false, error: DATE_ERROR };
  const note = text(v.note);
  if (note.length > MAX_LONG_TEXT) return { ok: false, error: 'Note is too long' };
  return { ok: true, value: { milestone: ms, invoiceNumber: no, issuedOn, note: note || null } };
}

/** Contract-sheet fields in screen order (CTR_FIELDS 4873). */
export const SHEET_FIELDS = [
  { key: 'ref', label: 'Reference', type: 'text' },
  { key: 'client', label: 'Client', type: 'text' },
  { key: 'type', label: 'Contract type', type: 'select' },
  { key: 'signed', label: 'Signed on', type: 'text' },
  { key: 'amount', label: 'Base amount (k€)', type: 'number' },
  { key: 'terms', label: 'Payment terms', type: 'text' },
  { key: 'retention', label: 'Retention (%)', type: 'number' },
  { key: 'retentionNote', label: 'Retention release', type: 'text' },
  { key: 'ld', label: 'Liquidated damages', type: 'text' },
  { key: 'warranty', label: 'Warranty', type: 'text' },
  { key: 'law', label: 'Governing law', type: 'text' },
  { key: 'scope', label: 'Scope summary', type: 'textarea' },
] as const;

export type SheetFieldKey = (typeof SHEET_FIELDS)[number]['key'];
export const isSheetField = (k: unknown): k is SheetFieldKey => typeof k === 'string' && SHEET_FIELDS.some((f) => f.key === k);

/** One sheet edit, in the DAL's patch vocabulary. */
export type SheetPatch =
  | { reference: string } | { client: string } | { type: ContractType } | { signedOn: string | null } | { baseAmountKeur: number }
  | { paymentTerms: string } | { retentionPct: number } | { retentionNote: string } | { liquidatedDamages: string } | { warranty: string }
  | { governingLaw: string } | { scope: string };

/**
 * A contract-sheet field as typed (`setCtr`, saved per field): amounts ≥ 0, retention 0–100, the contract type
 * code, a parsable signature date (or empty), a non-empty reference; other texts as typed (trimmed).
 */
export function parseSheetField(key: unknown, raw: unknown): ParseResult<SheetPatch> {
  if (!isSheetField(key) || typeof raw !== 'string') return { ok: false, error: 'Invalid request' };
  const v = raw.trim();
  const long = key === 'scope' ? MAX_LONG_TEXT : MAX_TEXT;
  if (v.length > long) return { ok: false, error: 'Text is too long' };
  switch (key) {
    case 'ref':
      return v ? { ok: true, value: { reference: v } } : { ok: false, error: 'Reference is required' };
    case 'client':
      return v ? { ok: true, value: { client: v } } : { ok: false, error: 'Client is required' };
    case 'type':
      return contractType.isCode(v) ? { ok: true, value: { type: v } } : { ok: false, error: 'Unknown contract type' };
    case 'signed': {
      if (!v) return { ok: true, value: { signedOn: null } };
      const iso = parseDateInput(v);
      return iso ? { ok: true, value: { signedOn: iso } } : { ok: false, error: DATE_ERROR };
    }
    case 'amount': {
      const n = parseNumber(v);
      return Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT ? { ok: true, value: { baseAmountKeur: n } } : { ok: false, error: 'Enter an amount in k€' };
    }
    case 'retention': {
      const n = parseNumber(v);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? { ok: true, value: { retentionPct: n } } : { ok: false, error: 'Enter a percentage between 0 and 100' };
    }
    case 'terms':
      return { ok: true, value: { paymentTerms: v } };
    case 'retentionNote':
      return { ok: true, value: { retentionNote: v } };
    case 'ld':
      return { ok: true, value: { liquidatedDamages: v } };
    case 'warranty':
      return { ok: true, value: { warranty: v } };
    case 'law':
      return { ok: true, value: { governingLaw: v } };
    case 'scope':
      return { ok: true, value: { scope: v } };
  }
}
