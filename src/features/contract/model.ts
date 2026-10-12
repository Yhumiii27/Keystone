// View models of the Contract screen (docs/spec/04 §3, template 814–840) and the Billing & payments screen (§4,
// template 841–869): the domain figures (src/domain/contract.ts) turned into the translated strings, tones and
// form definitions the components render. Pure (no I/O): `t` and `lang` come from the page. Every displayed string
// goes through t() as the prototype's deepTr does, except text typed by people (`dataText`).
// Delivery 7: amounts in the contract's currency (C-9, R-075, "≈ €…" at the budget rate beside the value); the payment rule
// and its days in the sheet (C-6, R-076); amendments with their signature cycle and their own payment milestones, bonds with
// "Release" (NEW-D3-3, R-079).
import type { FormDef } from '@/components/app/form-def';
import { LO, OK, statusTagClass } from '@/components/app/tones';
import {
  BASE_CONTRACT_OPTION, INVOICE_BLOCKED_MESSAGE, allInvoicedSub, collectedSub, invoiceBlocked, contractFigures, contractValueSub, guaranteesSub, invoicedSub, liquidatedDamagesKpi, outstandingSub,
  overdueSub, pendingSub, progressCss, progressText, scheduleGroupHint, shareText, shareTotalText, SHEET_FIELDS, termsOfSheet,
  type ContractFigures, type ContractInput, type ContractSheetInput, type SheetFieldKey,
} from '@/domain/contract';
import {
  BASE_CURRENCY, CURRENCIES, budgetRateText, documentCurrencies, eurEquivalentText, moneyIn, thousandsUnit, type CurrencyCode, type ProjectFx,
} from '@/domain/currency';
import { PAYMENT_RULES, paymentTermsText } from '@/domain/payment-terms';
import type { Lang, T } from '@/i18n/translate';
import {
  NOW_ISO, amendmentStatus, bondType, contractType, customerInvoiceStatus, displayOfIso, paymentRule, shortDateYearOfIso,
  type ContractType,
} from '@/server/db/codes';
import { dataText } from './i18n';

/** What the screens need from the Contract DAL (`ProjectContract` satisfies it). */
export interface ContractData extends ContractInput {
  sheet: ContractSheetInput & { client: string; type: ContractType; signedOn: string | null; governingLaw: string; scope: string };
  /** Next free invoice number ("INV-2026-004"). */
  nextInvoiceNumber: string;
  /** C-9: project currency and budget rate (EUR without rate when absent). */
  fx?: ProjectFx;
  /** A customer invoice exists: the currency is locked. */
  hasInvoices?: boolean;
  /** R-079 transitions per amendment position (absent = none offered). */
  amendments: readonly (ContractInput['amendments'][number] & { canSend?: boolean; canSign?: boolean; sentOn?: string | null })[];
}

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

const dash = (s: string | null | undefined) => (s ? s : '—');
const EUR_FX: ProjectFx = { currency: BASE_CURRENCY, budgetRate: null };

// ── Contract ───────────────────────────────────────────────────────────────────────────────────────────

export interface SheetFieldView {
  key: SheetFieldKey;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  /** Value as displayed (translated like the prototype's deepTr; codes for the select). Saving compares to it. */
  value: string;
  options?: { value: string; label: string }[];
  /** The field cannot change (the currency once an invoice is issued). */
  locked?: boolean;
  /** Helper line under the field (translated). */
  hint?: string;
}

export interface AmendmentView {
  /** Position in the contract (row actions). */
  position: number;
  label: string;
  amount: string;
  status: string;
  /** `tag tag-neutral` (signed) / `tag tag-accent`. */
  tagClass: string;
  date: string;
  /** Codex document reference ("CTR-HLT-002"), null when none. */
  doc: string | null;
  /** R-079: "Send for signature" (draft) / "Mark signed" (sent). */
  canSend: boolean;
  canSign: boolean;
}

export interface BondView {
  position: number;
  label: string;
  amount: string;
  state: string;
  released: boolean;
}

export interface MilestoneRowView {
  id: string;
  label: string;
  share: string;
  amount: string;
  due: string;
  condition: string;
  /** Position of the amendment it belongs to; null = base contract. */
  group: number | null;
  /** Not billable until the amendment is signed (muted row). */
  billable: boolean;
  /**
   * Delivery 8 (R-077, C-7a): a planned milestone can be edited or removed (row actions); `edit` = the dialog's opening values
   * (label as typed, share, contractual date, condition).
   */
  planned: boolean;
  edit: { label: string; pct: string; due: string; cond: string };
}

/** An amendment's own milestones (NEW-D3-3): header and subtotal rows of the schedule. */
export interface ScheduleGroupView {
  key: number;
  label: string;
  status: string;
  tagClass: string;
  billable: boolean;
  /** "Not billable until signed" while the amendment is not signed (translated), else ''. */
  note: string;
  share: string;
  amount: string;
  ok: boolean;
  hint: string;
}

export interface CurrencyView {
  /** Project currency and budget rate ("1 USD = 0.92 €"). */
  currency: CurrencyCode;
  rate: string;
  rateText: string;
  /** Currency choices of the editor (portfolio director). */
  options: { value: string; label: string }[];
}

export interface ContractView {
  reference: string;
  currency: CurrencyCode;
  kpis: KpiView[];
  fields: SheetFieldView[];
  amendments: AmendmentView[];
  bonds: BondView[];
  /** Every milestone in contractual order (base contract first, then each amendment's). */
  milestones: MilestoneRowView[];
  groups: ScheduleGroupView[];
  /** The base contract's subtotal (shown when amendments have milestones). */
  baseTotal: { share: string; amount: string; ok: boolean; hint: string };
  /** "Total" row: the base contract's share (the prototype's), Σ billable amounts. */
  total: { share: string; amount: string; ok: boolean; hint: string };
  fx: CurrencyView;
  figures: ContractFigures;
}

/** "Sent for signature 30 Sep 2026" / "Envoyé pour signature le 30 sept. 2026" (R-079); `date` already translated. */
export const sentText = (date: string, lang: Lang) => (lang === 'fr' ? `Envoyé pour signature le ${date}` : `Sent for signature ${date}`);

/** "Base amount (k€)" → "(k$)", "(k CHF)" for a contract in another currency (C-9). */
const unitLabel = (english: string, currency: CurrencyCode) => (currency === BASE_CURRENCY ? english : english.replace('(k€)', `(${thousandsUnit(currency)})`));

export function currencyView(fx: ProjectFx, lang: Lang): CurrencyView {
  return {
    currency: fx.currency,
    rate: fx.budgetRate != null ? String(fx.budgetRate) : '',
    rateText: budgetRateText(fx, lang),
    options: CURRENCIES.map((c) => ({ value: c, label: c })),
  };
}

export function contractView(c: ContractData, t: T, lang: Lang): ContractView {
  const fig = contractFigures(c);
  const cur = fig.currency;
  const fx = c.fx ?? EUR_FX;
  const f = (k: number) => moneyIn(k, cur, lang);
  const ld = liquidatedDamagesKpi(c.sheet.liquidatedDamages, c.sheet.warranty);
  const eq = eurEquivalentText(fig.valueKeur, cur, fx, lang);
  const kpis: KpiView[] = [
    {
      label: t('Contract value'), value: f(fig.valueKeur),
      sub: t(contractValueSub(f(c.sheet.baseAmountKeur), fig.signed.count, lang)) + (eq ? ` · ${eq}` : ''), color: OK,
    },
    {
      label: t('Amendments pending'),
      value: String(fig.pending.count),
      sub: t(pendingSub(fig.pending.count, f(fig.pending.amountKeur), lang)),
      color: fig.pending.count ? LO : OK,
    },
    { label: t('Guarantees in force'), value: `${fig.bonds.live} / ${fig.bonds.total}`, sub: t(guaranteesSub(f(fig.bonds.liveAmountKeur), lang)), color: OK },
    { label: t('Liquidated damages'), value: t(ld.value), sub: t(ld.sub), color: OK },
  ];
  const s = c.sheet;
  const terms = termsOfSheet(s);
  const value: Record<SheetFieldKey, string> = {
    // R-148: the contract sheet is typed text (shown as typed, or its seeded demo entry).
    ref: dataText(s.reference, lang),
    client: dataText(s.client, lang),
    type: s.type,
    signed: s.signedOn ? t(displayOfIso(s.signedOn)) : '',
    amount: String(s.baseAmountKeur),
    currency: cur,
    rule: terms.rule,
    days: String(terms.days),
    retention: String(s.retentionPct),
    retentionNote: dataText(s.retentionNote, lang),
    ld: dataText(s.liquidatedDamages, lang),
    warranty: dataText(s.warranty, lang),
    law: dataText(s.governingLaw, lang),
    scope: dataText(s.scope, lang),
  };
  const currencyChoices = [...new Set([...documentCurrencies(fx), cur])];
  const extra: Partial<Record<SheetFieldKey, Partial<SheetFieldView>>> = {
    type: { options: contractType.codes.map((code) => ({ value: code, label: t(contractType.label(code)) })) },
    currency: {
      options: currencyChoices.map((code) => ({ value: code, label: code })),
      locked: !!c.hasInvoices,
      hint: c.hasInvoices ? t('Invoices issued · the currency is fixed') : fx.currency !== BASE_CURRENCY && fx.budgetRate == null ? t('Budget rate not set') : undefined,
    },
    rule: { options: PAYMENT_RULES.map((r) => ({ value: r, label: t(paymentRule.label(r)) })), hint: paymentTermsText(terms, lang) },
  };
  const fields: SheetFieldView[] = SHEET_FIELDS.map((d) => ({
    key: d.key,
    label: t(d.key === 'amount' ? unitLabel(d.label, cur) : d.label),
    type: d.type,
    value: value[d.key],
    ...(extra[d.key] ?? {}),
  }));
  const groupAt = new Map(fig.groups.filter((g) => g.amendment != null).map((g) => [g.amendment!, g]));
  return {
    reference: s.reference,
    currency: cur,
    kpis,
    fields,
    amendments: c.amendments.map((a) => ({
      position: a.position,
      label: dataText(a.label, lang),
      amount: f(a.amountKeur),
      status: t(amendmentStatus.label(a.status)),
      tagClass: statusTagClass('amendment', a.status),
      // R-079: the signature date, else the day it was sent for signature.
      date: a.signedOn ? t(displayOfIso(a.signedOn)) : a.sentOn ? sentText(t(displayOfIso(a.sentOn)), lang) : '—',
      doc: a.documentRef || null,
      canSend: !!a.canSend,
      canSign: !!a.canSign,
    })),
    bonds: c.bonds.map((b, i) => ({
      position: b.position ?? i,
      label: t(bondType.label(b.type)) + (b.issuer ? ` · ${b.issuer}` : ''),
      amount: f(b.amountKeur),
      state: t(b.releasedOn ? `Released ${displayOfIso(b.releasedOn)}` : `Valid → ${b.validUntil ? displayOfIso(b.validUntil) : '—'}`),
      released: !!b.releasedOn,
    })),
    milestones: fig.milestones.map((m) => ({
      id: m.number,
      label: dataText(m.label, lang),
      share: shareText(m.sharePct, lang),
      amount: f(m.amountKeur),
      due: m.contractualDue ? t(displayOfIso(m.contractualDue)) : '—',
      condition: m.condition ? dataText(m.condition, lang) : '—',
      group: m.amendment ?? null,
      billable: m.billable,
      planned: m.status === 'planned',
      edit: editMilestoneValues(m, t),
    })),
    groups: [...groupAt.values()].map((g) => ({
      key: g.amendment!,
      label: dataText(g.label, lang),
      status: g.status ? t(amendmentStatus.label(g.status)) : '',
      tagClass: statusTagClass('amendment', g.status),
      billable: g.billable,
      note: g.billable ? '' : t('Not billable until signed'),
      share: shareTotalText(g.sharePct, lang),
      amount: f(g.amountKeur),
      ok: g.shareOk,
      // R-077 (C-7): over 100 % the group's invoicing is blocked — said in the hint ("Shares total 105 % · invoicing blocked").
      hint: g.shareOk ? '' : g.milestones.length ? scheduleGroupHint(g, lang, t) : t('No payment milestone for this amendment'),
    })),
    baseTotal: { share: shareTotalText(fig.sharePct, lang), amount: f(fig.groups[0].amountKeur), ok: fig.groups[0].shareOk, hint: scheduleGroupHint(fig.groups[0], lang, t) },
    total: { share: shareTotalText(fig.sharePct, lang), amount: f(fig.scheduleAmountKeur), ok: fig.groups[0].shareOk, hint: scheduleGroupHint(fig.groups[0], lang, t) },
    fx: currencyView(fx, lang),
    figures: fig,
  };
}

// ── Billing ────────────────────────────────────────────────────────────────────────────────────────────

export interface ToInvoiceView {
  id: string;
  label: string;
  /** "14 Dec 2026 · 20 %" (+ " · Late"). */
  line: string;
  late: boolean;
  amount: string;
  /** Delivery 8 (R-077, C-7): the reason "Issue invoice" is disabled (its group exceeds 100 %), translated; null when invoiceable. */
  blocked: string | null;
}

export interface InvoiceView {
  number: string;
  milestone: string;
  label: string;
  note: string | null;
  issued: string;
  amount: string;
  due: string;
  overdue: boolean;
  paid: string;
  status: string;
  tagClass: string;
  /** "Mark paid" applies (awaiting payment). */
  canPay: boolean;
}

export interface BillingView {
  kpis: KpiView[];
  /** The contract's terms in words ("Net 45 days" / "45 jours fin de mois"), the breadcrumb extra. */
  terms: string;
  progress: {
    total: string;
    paidW: string;
    invW: string;
    rows: { key: 'collected' | 'awaiting' | 'remaining'; label: string; amount: string; share: string; dot: string }[];
    retention: string;
    retentionNote: string;
  };
  toInvoice: ToInvoiceView[];
  invoices: InvoiceView[];
  figures: ContractFigures;
}

const INVOICE_TAG = { paid: 'tag tag-neutral', overdue: 'tag tag-accent', awaiting_payment: 'tag tag-outline' } as const;

export function billingView(c: ContractData, t: T, lang: Lang): BillingView {
  const fig = contractFigures(c);
  const f = (k: number) => moneyIn(k, fig.currency, lang);
  const total = fig.valueKeur;
  const next = fig.next;
  const terms = paymentTermsText(termsOfSheet(c.sheet), lang);
  const kpis: KpiView[] = [
    { label: t('Invoiced'), value: f(fig.invoicedKeur), sub: t(invoicedSub(fig.invoicedKeur, total)), color: OK },
    { label: t('Collected'), value: f(fig.paidKeur), sub: t(collectedSub(fig.paidKeur, fig.invoicedKeur, lang)), color: OK },
    {
      label: t('Outstanding receivables'),
      value: f(fig.outstandingKeur),
      sub: t(outstandingSub(fig.awaitingCount, terms, lang)),
      color: fig.outstandingKeur > 0 ? LO : OK,
    },
    { label: t('Overdue receivables'), value: f(fig.overdueKeur), sub: t(overdueSub(fig.overdueCount, lang)), color: fig.overdueCount ? LO : OK },
    {
      label: t('Next to invoice'),
      value: next ? next.number : '—',
      sub: next
        ? `${dataText(next.label, lang)} · ${next.contractualDue ? t(displayOfIso(next.contractualDue)) : '—'} · ${f(next.amountKeur)}`
        : t(allInvoicedSub(lang)),
      color: next?.late ? LO : OK,
    },
  ];
  const awaiting = fig.invoicedKeur - fig.paidKeur;
  const remaining = total - fig.invoicedKeur;
  return {
    kpis,
    terms,
    progress: {
      total: f(total),
      paidW: progressCss(fig.paidKeur, total),
      invW: progressCss(awaiting, total),
      rows: [
        { key: 'collected', label: t('Collected'), amount: f(fig.paidKeur), share: progressText(fig.paidKeur, total, lang), dot: 'var(--color-accent)' },
        { key: 'awaiting', label: t('Invoiced, awaiting payment'), amount: f(awaiting), share: progressText(awaiting, total, lang), dot: 'var(--color-accent-700)' },
        { key: 'remaining', label: t('Not yet invoiced'), amount: f(remaining), share: progressText(remaining, total, lang), dot: 'var(--color-neutral-700)' },
      ],
      retention: f(fig.retentionKeur),
      retentionNote: t(`${shareText(c.sheet.retentionPct, lang)} · ${c.sheet.retentionNote}`),
    },
    toInvoice: fig.toInvoice.map((m) => ({
      id: m.number,
      label: dataText(m.label, lang),
      line: `${m.contractualDue ? t(displayOfIso(m.contractualDue)) : '—'} · ${shareText(m.sharePct, lang)}${m.late ? ` · ${t('Late')}` : ''}`,
      late: m.late,
      amount: f(m.amountKeur),
      blocked: m.blocked ? t(INVOICE_BLOCKED_MESSAGE) : null,
    })),
    invoices: fig.invoices.map((i) => ({
      number: i.number,
      milestone: i.milestone,
      label: dataText(i.label, lang),
      note: i.note ? dataText(i.note, lang) : null,
      issued: t(shortDateYearOfIso(i.issuedOn)),
      amount: f(i.amountKeur),
      due: t(shortDateYearOfIso(i.dueOn)),
      overdue: i.overdue,
      paid: t(dash(i.paidOn && shortDateYearOfIso(i.paidOn))),
      status: t(customerInvoiceStatus.label(i.status)),
      tagClass: INVOICE_TAG[i.status],
      canPay: i.canPay,
    })),
    figures: fig,
  };
}

// ── Add-forms (AF catalogue 3674, translated here: option labels mix codes and typed text) ───────────────

/** Toast suffixes (AF_RESULT 3701). */
export const RESULT = {
  amendment: 'Amendment registered',
  bond: 'Guarantee registered',
  milestone: 'Payment milestone added',
  billing: ['Invoice issued', 'sent to the client'],
  sent: 'Sent for signature',
  signed: 'Amendment signed',
  released: 'Guarantee released',
  // Delivery 8 (R-077): schedule corrections.
  milestoneUpdated: 'Payment milestone updated',
  milestoneRemoved: 'Payment milestone removed',
} as const;

/** Date example shown as a placeholder of the free date fields (the rebuild validates dates). */
const DATE_EXAMPLE = '14 Dec 2026';

/** AF.amendment — "Add amendment" → "Register amendment". Amount in thousands of the contract currency (C-9). */
export function amendmentFormDef(t: T, currency: CurrencyCode = BASE_CURRENCY): FormDef {
  return {
    title: t('Add amendment'),
    kind: 'create',
    submit: t('Register amendment'),
    fields: [
      { id: 'label', label: t('Subject'), type: 'text', required: true },
      { id: 'cr', label: t('Linked change request'), type: 'text' },
      { id: 'amt', label: t(unitLabel('Amount (k€)', currency)), type: 'number', required: true, defaultValue: '0' },
      { id: 'status', label: t('Status'), type: 'select', options: amendmentStatus.codes.map((c) => ({ value: c, label: t(amendmentStatus.label(c)) })) },
      { id: 'date', label: t('Signature date'), type: 'text', placeholder: t(DATE_EXAMPLE) },
      { id: 'doc', label: t('Document reference'), type: 'text' },
    ],
  };
}

/** AF.bond — "Add guarantee" → "Register guarantee". */
export function bondFormDef(t: T, currency: CurrencyCode = BASE_CURRENCY): FormDef {
  return {
    title: t('Add guarantee'),
    kind: 'create',
    submit: t('Register guarantee'),
    fields: [
      { id: 'label', label: t('Type'), type: 'select', options: bondType.codes.map((c) => ({ value: c, label: t(bondType.label(c)) })) },
      { id: 'amt', label: t(unitLabel('Amount (k€)', currency)), type: 'number', required: true, defaultValue: '0' },
      { id: 'issuer', label: t('Issuer'), type: 'text', required: true },
      { id: 'valid', label: t('Valid until'), type: 'text', required: true, placeholder: t(DATE_EXAMPLE) },
    ],
  };
}

/**
 * AF.milestone — "Add payment milestone" → "Add milestone". "Applies to": the base contract or one of its amendments
 * (NEW-D3-3, R-079) — the share is a share of the base amount or of the amendment's amount.
 */
export function milestoneFormDef(t: T, amendments: readonly { position: number; label: string }[] = [], lang: Lang = 'en'): FormDef {
  return {
    title: t('Add payment milestone'),
    kind: 'create',
    submit: t('Add milestone'),
    fields: [
      ...(amendments.length
        ? [{
            id: 'basis', label: t('Applies to'), type: 'select' as const, span: 'full' as const,
            options: [{ value: BASE_CONTRACT_OPTION, label: t('Base contract') }, ...amendments.map((a) => ({ value: String(a.position), label: dataText(a.label, lang) }))],
          }]
        : []),
      { id: 'label', label: t('Milestone'), type: 'text', required: true },
      { id: 'pct', label: t(amendments.length ? 'Share (%)' : 'Share of contract (%)'), type: 'number', required: true, defaultValue: '10' },
      { id: 'due', label: t('Contractual date'), type: 'text', required: true, placeholder: t(DATE_EXAMPLE) },
      { id: 'cond', label: t('Condition'), type: 'textarea' },
    ],
  };
}

/**
 * Delivery 8 (R-077, C-7a): "Edit milestone" — AF.milestone without "Applies to" (the basis does not change), opened with the
 * milestone's values (`editMilestoneValues`).
 */
export function editMilestoneFormDef(t: T, onAmendment: boolean): FormDef {
  const base = milestoneFormDef(t, [], 'en');
  return {
    ...base,
    title: t('Edit payment milestone'),
    submit: t('Save'),
    fields: base.fields.map((f) => (f.id === 'pct' ? { ...f, label: t(onAmendment ? 'Share (%)' : 'Share of contract (%)'), defaultValue: undefined } : f)),
  };
}

/** Values the edit dialog opens with: label as typed, share, contractual date in the form's format, condition. */
export const editMilestoneValues = (m: { label: string; sharePct: number; contractualDue: string | null; condition: string | null }, t: T) => ({
  label: m.label, pct: String(m.sharePct), due: m.contractualDue ? t(displayOfIso(m.contractualDue)) : '', cond: m.condition ?? '',
});

/** "Mark signed" (R-079): signature date (default NOWD) · document reference. */
export function signFormDef(t: T, documentRef: string | null = null): FormDef {
  return {
    title: t('Mark signed'),
    kind: 'run',
    submit: t('Mark signed'),
    fields: [
      { id: 'date', label: t('Signature date'), type: 'text', required: true, defaultValue: t(displayOfIso(NOW_ISO)), placeholder: t(DATE_EXAMPLE) },
      { id: 'doc', label: t('Document reference'), type: 'text', defaultValue: documentRef ?? '' },
    ],
  };
}

/** "Release" of a guarantee (R-079): release date (default NOWD). */
export function releaseFormDef(t: T): FormDef {
  return {
    title: t('Release guarantee'),
    kind: 'run',
    submit: t('Release'),
    fields: [{ id: 'date', label: t('Release date'), type: 'text', required: true, defaultValue: t(displayOfIso(NOW_ISO)), placeholder: t(DATE_EXAMPLE) }],
  };
}

/**
 * AF.billing — "Issue invoice" (run): milestone (`MSPLAN`, the planned billable milestones "M4 · Cranes operational", value =
 * the number) · invoice number (pre-filled `ctrNextInvNo`) · invoice date ("30 Sep 2026") · note.
 */
export function invoiceFormDef(c: Pick<ContractData, 'milestones' | 'nextInvoiceNumber'> & Partial<Pick<ContractData, 'amendments'>>, t: T, lang: Lang): FormDef {
  const signed = new Set((c.amendments ?? []).filter((a) => a.status === 'signed').map((a) => a.position));
  // R-077 (C-7): a milestone whose group exceeds 100 % is not offered (invoicing blocked until the schedule is corrected).
  const billable = c.milestones.filter((m) => m.status === 'planned' && (m.amendment == null || signed.has(m.amendment)) && !invoiceBlocked(c.milestones, m.number));
  return {
    title: t('Issue invoice'),
    kind: 'run',
    submit: t('Issue invoice'),
    fields: [
      {
        id: 'ms',
        label: t('Milestone'),
        type: 'select',
        options: billable.map((m) => ({ value: m.number, label: `${m.number} · ${dataText(m.label, lang)}` })),
      },
      { id: 'no', label: t('Invoice number'), type: 'text', required: true, defaultValue: c.nextInvoiceNumber },
      { id: 'date', label: t('Invoice date'), type: 'text', required: true, defaultValue: t(displayOfIso(NOW_ISO)) },
      { id: 'note', label: t('Note on the invoice'), type: 'textarea' },
    ],
  };
}
