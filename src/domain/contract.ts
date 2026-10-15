// Contract and Billing & payments: pure business logic (docs/spec/04 §3 Contract, §4 Billing; prototype logic
// 4869–4903 and the `amendment` / `bond` / `milestone` / `billing` buckets of afSubmit 5121–5127).
// - Figures: contract value (base + signed amendments); payment milestones of the base contract priced on the base amount
//   and an amendment's own milestones priced on the amendment's amount, billable once it is signed (NEW-D3-3, R-079: an
//   amendment no longer re-prices the existing milestones, the invoiced ones included); an invoiced milestone keeps the
//   amount of its invoice; late milestones (planned, billable, contractual date before PG_NOW); invoices due by the
//   contract's payment rule (C-6, R-076 — calendar days, not the prototype's DST-sensitive ms arithmetic, 04 Q12);
//   receivables, retention, schedule totals per basis. Every amount is in the contract's currency (C-9, R-075).
// - The KPI sub-lines the prototype builds with explicit FR branches (4883, 4899), returned in the render language
//   but still to be passed through t() like the prototype's deepTr.
// - Parsing of the add-forms and of the contract-sheet fields (codes, amounts with a French comma, dates typed
//   "14 Dec 2026" / "14 déc. 2026" / ISO).
// No I/O, no translation. Golden values: src/domain/contract.test.ts (prototype renderVals, EN and FR).
import type { Lang } from '@/i18n/translate';
import {
  AMENDMENT_AWAITING, NOW_ISO, amendmentStatus, beforePgNow, bondType, contractType,
  type AmendmentStatus, type BondType, type ContractType, type CustomerInvoiceStatus, type PaymentMilestoneStatus,
} from '@/server/db/codes';
import { BASE_CURRENCY, isCurrency, type CurrencyCode } from './currency';
import { DEFAULT_PAYMENT_DAYS, DEFAULT_PAYMENT_RULE, isPaymentRule, parsePaymentDays, paymentDueOn, type PaymentRule } from './payment-terms';

// ── Input (structural: the Contract DAL rows satisfy it) ───────────────────────────────────────────────

export interface ContractSheetInput {
  reference: string;
  /** Base amount, thousands of the contract currency. */
  baseAmountKeur: number;
  /** C-9: currency of every amount of the contract (EUR when absent). */
  currency?: CurrencyCode;
  /** "Net 45 days" — the terms in words (rebuilt from the rule). */
  paymentTerms: string;
  /** C-6: payment rule and N (calendar days); 'net' 45 when absent. */
  paymentRule?: PaymentRule;
  paymentDays?: number;
  retentionPct: number;
  retentionNote: string;
  /** "0.5 % per week · cap 10 %" (rate · cap). */
  liquidatedDamages: string;
  warranty: string;
}

export interface AmendmentInput {
  /** Position in the contract's list — the key of its milestones (`MilestoneInput.amendment`). */
  position: number;
  /** "Amendment 1 — anti-collision lidar (CR-004)". */
  label: string;
  amountKeur: number;
  status: AmendmentStatus;
  signedOn: string | null;
  documentRef: string | null;
}

export interface BondInput {
  /** Position in the contract's list (row actions); index order when absent. */
  position?: number;
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
  /** Amount invoiced at issue (frozen). */
  amountKeur: number;
}

export interface MilestoneInput {
  number: string;
  label: string;
  /** Share, %, of the base amount or of the amendment's amount (`amendment`). */
  sharePct: number;
  /** ISO contractual date. */
  contractualDue: string | null;
  condition: string | null;
  status: PaymentMilestoneStatus;
  /** Invoice of an invoiced / paid milestone. */
  invoice: InvoiceInput | null;
  /** Position of the amendment the milestone belongs to (NEW-D3-3); null or absent = the base contract. */
  amendment?: number | null;
}

export interface ContractInput {
  sheet: ContractSheetInput;
  amendments: readonly AmendmentInput[];
  bonds: readonly BondInput[];
  /** Contractual order. */
  milestones: readonly MilestoneInput[];
}

// ── Figures ────────────────────────────────────────────────────────────────────────────────────────────

/** Payment rule of a contract sheet ('net' 45 when the sheet predates C-6). */
export const termsOfSheet = (s: Pick<ContractSheetInput, 'paymentRule' | 'paymentDays'>) => ({
  rule: s.paymentRule ?? DEFAULT_PAYMENT_RULE,
  days: s.paymentDays ?? DEFAULT_PAYMENT_DAYS,
});

/** An amendment counts in the contract value, and its milestones may be invoiced, once signed. */
export const isSignedAmendment = (a: Pick<AmendmentInput, 'status'>) => a.status === 'signed';
/** "Send for signature" applies to a draft (R-079). */
export const canSendAmendment = (s: AmendmentStatus) => s === 'draft';
/** "Mark signed" applies to an amendment sent for signature (or awaiting it, the seed's wording) — R-079. */
export const canSignAmendment = (s: AmendmentStatus) => AMENDMENT_AWAITING.includes(s);

/** The current amount of a planned milestone (what "Issue invoice" records): round(basis × share / 100) — NEW-D3-3. */
export const plannedMilestoneAmount = (basisKeur: number, sharePct: number) => Math.round((basisKeur * sharePct) / 100);

export interface MilestoneFigure extends MilestoneInput {
  /**
   * Thousands of the contract currency: the invoice's amount once invoiced (frozen), else round(basis × share / 100) — basis =
   * the base amount, or the amendment's amount for an amendment milestone (NEW-D3-3: signing an amendment re-prices nothing).
   */
  amountKeur: number;
  /** A base-contract milestone, or one of a signed amendment: it may be invoiced and counts in the billing plan. */
  billable: boolean;
  /** Planned, billable and contractual date before the status "now" (PG_NOW ≈ 30 Sep 2026). */
  late: boolean;
  /** Delivery 8 (R-077, C-7): its schedule group (base contract or its amendment) exceeds 100 % — invoicing is blocked. */
  blocked: boolean;
}

export interface InvoiceFigure {
  number: string;
  milestone: string;
  label: string;
  issuedOn: string;
  /** Amount invoiced (frozen at issue). */
  amountKeur: number;
  /** Due by the contract's payment rule (R-076). */
  dueOn: string;
  paidOn: string | null;
  note: string | null;
  status: CustomerInvoiceStatus;
  /** Awaiting payment and due before NOWD (30 Sep 2026). */
  overdue: boolean;
  /** "Mark paid" applies (milestone invoiced). */
  canPay: boolean;
}

/** The milestones of one basis: the base contract (`amendment` null) or one amendment (NEW-D3-3). */
export interface ScheduleGroup {
  amendment: number | null;
  /** Amendment label ("Amendment 1 — anti-collision lidar (CR-004)"); '' for the base contract. */
  label: string;
  status: AmendmentStatus | null;
  /** Base amount or amendment amount. */
  basisKeur: number;
  billable: boolean;
  milestones: MilestoneFigure[];
  /** Σ shares (%), raw. */
  sharePct: number;
  /** Shares total 100 % (an amendment without milestones is complete only while unsigned or worth 0). */
  shareOk: boolean;
  /** Delivery 8 (R-077, C-7): Σ shares above 100 % (+ 0.01 tolerance) — no milestone of the group may be invoiced. */
  over: boolean;
  /** Σ milestone amounts. */
  amountKeur: number;
}

// ── Delivery 8 (R-077, C-7): invoicing blocked while a schedule group exceeds 100 % ──────────────────────────────────

/** Rounding tolerance of a share total (the prototype's "100 %" test, 0.01 %). */
export const SHARE_TOLERANCE_PCT = 0.01;
/** Σ shares of a group above 100 % (C-7 "aucune facture ne doit partir tant que le total dépasse 100 %"). */
export const sharesOver = (sharePct: number) => sharePct > 100 + SHARE_TOLERANCE_PCT;
/** Refusal of "Issue invoice" on a blocked group (Billing, the DAL re-checks it inside its transaction). */
export const INVOICE_BLOCKED_MESSAGE = 'Payment milestones exceed 100 % — invoicing is blocked until the schedule is corrected';

/**
 * C-7 (default per group, owner to confirm vs the whole contract): the milestone's basis group — the base contract, or the
 * amendment it belongs to — has Σ shares > 100 % (+ 0.01). Under 100 % stays a hint (C-7a "on peut toujours retoucher").
 */
export function invoiceBlocked(milestones: readonly { number: string; sharePct: number; amendment?: number | string | null }[], number: string): boolean {
  const m = milestones.find((x) => x.number === number);
  if (!m) return false;
  const group = milestones.filter((x) => (x.amendment ?? null) === (m.amendment ?? null));
  return sharesOver(group.reduce((a, x) => a + (x.sharePct || 0), 0));
}

export interface ContractFigures {
  currency: CurrencyCode;
  termsDays: number;
  /** Base + signed amendments (`ctrTotal`). */
  valueKeur: number;
  signed: { count: number; amountKeur: number };
  pending: { count: number; amountKeur: number };
  /** Bonds not released / all bonds / Σ amount in force. */
  bonds: { live: number; total: number; liveAmountKeur: number };
  /** Every milestone in contractual order (amendment milestones included, billable or not). */
  milestones: MilestoneFigure[];
  /** Base contract first, then each amendment that has milestones or is signed (amendment order). */
  groups: ScheduleGroup[];
  /** Σ share of the base contract's milestones, raw (%) — the prototype's "Total" share. */
  sharePct: number;
  /** Every group's shares total 100 % (a signed amendment without milestones is not complete). */
  shareOk: boolean;
  /** Σ billable milestone amounts. */
  scheduleAmountKeur: number;
  /** Invoices in milestone order. */
  invoices: InvoiceFigure[];
  /** Σ invoiced / paid milestones (`ctrInvoiced`, `ctrPaid`) at their invoiced amounts. */
  invoicedKeur: number;
  paidKeur: number;
  outstandingKeur: number;
  /** Invoices not paid (`ctrAwait`). */
  awaitingCount: number;
  overdueCount: number;
  overdueKeur: number;
  /** round(paid × retention % / 100) — on collected amounts (C-8). */
  retentionKeur: number;
  /** Planned billable milestones, contractual order (`ctrToInvoice`). */
  toInvoice: MilestoneFigure[];
  /** First planned billable milestone (`ctrNext`). */
  next: MilestoneFigure | null;
  /** Late planned milestones (Billing nav badge `ctrBadge`). */
  lateCount: number;
}

const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export function contractFigures(c: ContractInput): ContractFigures {
  const terms = termsOfSheet(c.sheet);
  const signed = c.amendments.filter(isSignedAmendment);
  const pending = c.amendments.filter((a) => !isSignedAmendment(a));
  const valueKeur = c.sheet.baseAmountKeur + sum(signed, (a) => a.amountKeur);
  const live = c.bonds.filter((b) => !b.releasedOn);
  const amendmentAt = new Map(c.amendments.map((a) => [a.position, a]));
  const milestones: MilestoneFigure[] = c.milestones.map((m) => {
    const a = m.amendment != null ? amendmentAt.get(m.amendment) ?? null : null;
    const basis = m.amendment != null ? a?.amountKeur ?? 0 : c.sheet.baseAmountKeur;
    const billable = m.amendment == null || (!!a && isSignedAmendment(a));
    return {
      ...m,
      amountKeur: m.status !== 'planned' && m.invoice ? m.invoice.amountKeur : plannedMilestoneAmount(basis, m.sharePct),
      billable,
      late: billable && m.status === 'planned' && beforePgNow(m.contractualDue),
      blocked: invoiceBlocked(c.milestones, m.number),
    };
  });
  const invoices: InvoiceFigure[] = milestones.flatMap((m) => {
    if (m.status === 'planned' || !m.invoice) return [];
    const i = m.invoice;
    const dueOn = paymentDueOn(i.issuedOn, terms);
    const paid = m.status === 'paid';
    const overdue = !paid && dueOn < NOW_ISO;
    return [{
      number: i.number, milestone: m.number, label: m.label, issuedOn: i.issuedOn, amountKeur: m.amountKeur, dueOn, paidOn: i.paidOn, note: i.note,
      status: paid ? 'paid' : overdue ? 'overdue' : 'awaiting_payment', overdue, canPay: m.status === 'invoiced',
    }];
  });
  const groupOf = (amendment: number | null, label: string, status: AmendmentStatus | null, basisKeur: number, billable: boolean): ScheduleGroup => {
    const ms = milestones.filter((m) => (m.amendment ?? null) === amendment);
    const sharePct = sum(ms, (m) => m.sharePct);
    return {
      amendment, label, status, basisKeur, billable, milestones: ms, sharePct,
      shareOk: Math.abs(sharePct - 100) < 0.01 || (amendment != null && !ms.length && (!billable || !basisKeur)),
      over: sharesOver(sharePct),
      amountKeur: sum(ms, (m) => m.amountKeur),
    };
  };
  const groups = [
    groupOf(null, '', null, c.sheet.baseAmountKeur, true),
    ...c.amendments
      .map((a) => groupOf(a.position, a.label, a.status, a.amountKeur, isSignedAmendment(a)))
      .filter((g) => g.milestones.length || (g.billable && g.basisKeur)),
  ];
  const billable = milestones.filter((m) => m.billable);
  const invoicedKeur = sum(billable.filter((m) => m.status !== 'planned'), (m) => m.amountKeur);
  const paidKeur = sum(billable.filter((m) => m.status === 'paid'), (m) => m.amountKeur);
  const overdue = invoices.filter((i) => i.overdue);
  const toInvoice = billable.filter((m) => m.status === 'planned');
  return {
    currency: c.sheet.currency ?? BASE_CURRENCY,
    termsDays: terms.days,
    valueKeur,
    signed: { count: signed.length, amountKeur: sum(signed, (a) => a.amountKeur) },
    pending: { count: pending.length, amountKeur: sum(pending, (a) => a.amountKeur) },
    bonds: { live: live.length, total: c.bonds.length, liveAmountKeur: sum(live, (b) => b.amountKeur) },
    milestones,
    groups,
    sharePct: groups[0].sharePct,
    shareOk: groups.every((g) => g.shareOk),
    scheduleAmountKeur: sum(billable, (m) => m.amountKeur),
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

/**
 * Delivery 8 (R-077, C-7): the hint of one schedule group, in the viewer's language — over 100 % "Shares total 105 % · invoicing
 * blocked" (the words through `t`, the total formatted for `lang`), under 100 % the prototype's "Shares must total 100 %" (a hint
 * only, C-7a), '' when complete.
 */
export function scheduleGroupHint(g: Pick<ScheduleGroup, 'sharePct' | 'shareOk'>, lang: Lang, t: (english: string) => string = (x) => x): string {
  if (sharesOver(g.sharePct)) return `${t('Shares total')} ${shareTotalText(g.sharePct, lang)} · ${t('invoicing blocked')}`;
  return scheduleHint(g.shareOk, lang);
}

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
  // R-079: an amendment registered as already signed carries its signature date (the value it adds starts that day).
  if (status === 'signed' && !signedOn) return { ok: false, error: 'Enter the signature date of a signed amendment' };
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
  /** Position of the amendment the milestone belongs to (NEW-D3-3); null = the base contract. */
  amendment: number | null;
}

/** Value of the "Applies to" option of the base contract. */
export const BASE_CONTRACT_OPTION = 'base';

/**
 * AF.milestone: applies to (the base contract, or an amendment — R-079) · milestone* · share* (0 < % ≤ 100, of the base amount or
 * of the amendment's amount) · contractual date* · condition. Σ > 100 % is accepted (C-7a: the schedule can always be retouched)
 * but blocks invoicing of its group until corrected (delivery 8, R-077). "Edit milestone" uses the same form without "Applies to".
 */
export function parseMilestoneForm(v: Record<string, string | undefined>): ParseResult<MilestoneForm> {
  const basis = text(v.basis) || BASE_CONTRACT_OPTION;
  if (basis !== BASE_CONTRACT_OPTION && !/^\d{1,4}$/.test(basis)) return { ok: false, error: 'Choose the base contract or an amendment' };
  const amendment = basis === BASE_CONTRACT_OPTION ? null : Number(basis);
  const label = text(v.label);
  if (!label) return { ok: false, error: 'Milestone is required' };
  if (label.length > MAX_TEXT) return { ok: false, error: 'Milestone is too long' };
  const pct = parseNumber(v.pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { ok: false, error: 'Enter a share between 0 and 100 %' };
  const due = parseDateInput(v.due);
  if (!due) return { ok: false, error: DATE_ERROR };
  const cond = text(v.cond);
  if (cond.length > MAX_LONG_TEXT) return { ok: false, error: 'Condition is too long' };
  return { ok: true, value: { label, sharePct: Math.round(pct * 100) / 100, contractualDue: due, condition: cond || null, amendment } };
}

export interface SignAmendmentForm {
  signedOn: string;
  documentRef: string | null;
}

/** "Mark signed" (R-079): signature date* · document reference (Codex number of the signed amendment). */
export function parseSignAmendmentForm(v: Record<string, string | undefined>): ParseResult<SignAmendmentForm> {
  const signedOn = parseDateInput(v.date);
  if (!signedOn) return { ok: false, error: DATE_ERROR };
  const doc = text(v.doc);
  if (doc.length > 60) return { ok: false, error: 'Reference is too long' };
  return { ok: true, value: { signedOn, documentRef: doc || null } };
}

/** "Release" of a bond (R-079): release date*. */
export function parseReleaseBondForm(v: Record<string, string | undefined>): ParseResult<{ releasedOn: string }> {
  const releasedOn = parseDateInput(v.date);
  return releasedOn ? { ok: true, value: { releasedOn } } : { ok: false, error: DATE_ERROR };
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
  // C-9 (R-075): EUR or the project currency, while no invoice is issued.
  { key: 'currency', label: 'Currency', type: 'select' },
  // C-6 (R-076): the payment rule and its N replace the free "Payment terms" text (rebuilt from them).
  { key: 'rule', label: 'Payment rule', type: 'select' },
  { key: 'days', label: 'Payment days', type: 'number' },
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
  | { currency: CurrencyCode } | { paymentRule: PaymentRule } | { paymentDays: number }
  | { retentionPct: number } | { retentionNote: string } | { liquidatedDamages: string } | { warranty: string }
  | { governingLaw: string } | { scope: string };

/**
 * A contract-sheet field as typed (`setCtr`, saved per field): amounts ≥ 0, retention 0–100, the contract type
 * code, a parsable signature date (or empty), a non-empty reference, a currency code (the DAL checks it against the project),
 * a payment rule code and its days (0–180); other texts as typed (trimmed).
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
    case 'currency':
      return isCurrency(v) ? { ok: true, value: { currency: v } } : { ok: false, error: 'Unknown currency' };
    case 'rule':
      return isPaymentRule(v) ? { ok: true, value: { paymentRule: v } } : { ok: false, error: 'Unknown payment rule' };
    case 'days': {
      const n = parsePaymentDays(v);
      return n != null ? { ok: true, value: { paymentDays: n } } : { ok: false, error: 'Enter a number of days between 0 and 180' };
    }
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
