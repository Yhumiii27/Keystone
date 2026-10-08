// View models of the Contract screen (docs/spec/04 §3, template 814–840) and the Billing & payments screen (§4,
// template 841–869): the domain figures (src/domain/contract.ts) turned into the translated strings, tones and
// form definitions the components render. Pure (no I/O): `t` and `lang` come from the page. Every displayed string
// goes through t() as the prototype's deepTr does, except text typed by people (`dataText`).
import type { FormDef } from '@/components/app/form-def';
import { LO, OK, statusTagClass } from '@/components/app/tones';
import {
  allInvoicedSub, collectedSub, contractFigures, contractValueSub, guaranteesSub, invoicedSub, liquidatedDamagesKpi, outstandingSub, overdueSub,
  pendingSub, progressCss, progressText, scheduleHint, shareText, shareTotalText, SHEET_FIELDS,
  type ContractFigures, type ContractInput, type ContractSheetInput, type SheetFieldKey,
} from '@/domain/contract';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import {
  NOW_ISO, amendmentStatus, bondType, contractType, customerInvoiceStatus, displayOfIso, shortDateYearOfIso,
  type ContractType,
} from '@/server/db/codes';
import { dataText } from './i18n';

/** What the screens need from the Contract DAL (`ProjectContract` satisfies it). */
export interface ContractData extends ContractInput {
  sheet: ContractSheetInput & { client: string; type: ContractType; signedOn: string | null; governingLaw: string; scope: string };
  /** Next free invoice number ("INV-2026-004"). */
  nextInvoiceNumber: string;
}

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

const dash = (s: string | null | undefined) => (s ? s : '—');

// ── Contract ───────────────────────────────────────────────────────────────────────────────────────────

export interface SheetFieldView {
  key: SheetFieldKey;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  /** Value as displayed (translated like the prototype's deepTr; codes for the select). Saving compares to it. */
  value: string;
  options?: { value: string; label: string }[];
}

export interface AmendmentView {
  label: string;
  amount: string;
  status: string;
  /** `tag tag-neutral` (signed) / `tag tag-accent`. */
  tagClass: string;
  date: string;
  /** Codex document reference ("CTR-HLT-002"), null when none. */
  doc: string | null;
}

export interface BondView {
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
}

export interface ContractView {
  reference: string;
  kpis: KpiView[];
  fields: SheetFieldView[];
  amendments: AmendmentView[];
  bonds: BondView[];
  milestones: MilestoneRowView[];
  total: { share: string; amount: string; ok: boolean; hint: string };
  figures: ContractFigures;
}

export function contractView(c: ContractData, t: T, lang: Lang): ContractView {
  const fig = contractFigures(c);
  const f = (k: number) => money(k, lang);
  const ld = liquidatedDamagesKpi(c.sheet.liquidatedDamages, c.sheet.warranty);
  const kpis: KpiView[] = [
    { label: t('Contract value'), value: f(fig.valueKeur), sub: t(contractValueSub(f(c.sheet.baseAmountKeur), fig.signed.count, lang)), color: OK },
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
  const value: Record<SheetFieldKey, string> = {
    ref: t(s.reference),
    client: t(s.client),
    type: s.type,
    signed: s.signedOn ? t(displayOfIso(s.signedOn)) : '',
    amount: String(s.baseAmountKeur),
    terms: t(s.paymentTerms),
    retention: String(s.retentionPct),
    retentionNote: t(s.retentionNote),
    ld: t(s.liquidatedDamages),
    warranty: t(s.warranty),
    law: t(s.governingLaw),
    scope: t(s.scope),
  };
  const fields: SheetFieldView[] = SHEET_FIELDS.map((d) => ({
    key: d.key,
    label: t(d.label),
    type: d.type,
    value: value[d.key],
    ...(d.type === 'select' ? { options: contractType.codes.map((code) => ({ value: code, label: t(contractType.label(code)) })) } : {}),
  }));
  return {
    reference: s.reference,
    kpis,
    fields,
    amendments: c.amendments.map((a) => ({
      label: dataText(a.label, lang),
      amount: f(a.amountKeur),
      status: t(amendmentStatus.label(a.status)),
      tagClass: statusTagClass('amendment', a.status),
      date: a.signedOn ? t(displayOfIso(a.signedOn)) : '—',
      doc: a.documentRef || null,
    })),
    bonds: c.bonds.map((b) => ({
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
    })),
    total: { share: shareTotalText(fig.sharePct, lang), amount: f(fig.scheduleAmountKeur), ok: fig.shareOk, hint: t(scheduleHint(fig.shareOk, lang)) },
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
  const f = (k: number) => money(k, lang);
  const total = fig.valueKeur;
  const next = fig.next;
  const terms = c.sheet.paymentTerms;
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
} as const;

/** Date example shown as a placeholder of the free date fields (the rebuild validates dates). */
const DATE_EXAMPLE = '14 Dec 2026';

/** AF.amendment — "Add amendment" → "Register amendment". */
export function amendmentFormDef(t: T): FormDef {
  return {
    title: t('Add amendment'),
    kind: 'create',
    submit: t('Register amendment'),
    fields: [
      { id: 'label', label: t('Subject'), type: 'text', required: true },
      { id: 'cr', label: t('Linked change request'), type: 'text' },
      { id: 'amt', label: t('Amount (k€)'), type: 'number', required: true, defaultValue: '0' },
      { id: 'status', label: t('Status'), type: 'select', options: amendmentStatus.codes.map((c) => ({ value: c, label: t(amendmentStatus.label(c)) })) },
      { id: 'date', label: t('Signature date'), type: 'text', placeholder: t(DATE_EXAMPLE) },
      { id: 'doc', label: t('Document reference'), type: 'text' },
    ],
  };
}

/** AF.bond — "Add guarantee" → "Register guarantee". */
export function bondFormDef(t: T): FormDef {
  return {
    title: t('Add guarantee'),
    kind: 'create',
    submit: t('Register guarantee'),
    fields: [
      { id: 'label', label: t('Type'), type: 'select', options: bondType.codes.map((c) => ({ value: c, label: t(bondType.label(c)) })) },
      { id: 'amt', label: t('Amount (k€)'), type: 'number', required: true, defaultValue: '0' },
      { id: 'issuer', label: t('Issuer'), type: 'text', required: true },
      { id: 'valid', label: t('Valid until'), type: 'text', required: true, placeholder: t(DATE_EXAMPLE) },
    ],
  };
}

/** AF.milestone — "Add payment milestone" → "Add milestone". */
export function milestoneFormDef(t: T): FormDef {
  return {
    title: t('Add payment milestone'),
    kind: 'create',
    submit: t('Add milestone'),
    fields: [
      { id: 'label', label: t('Milestone'), type: 'text', required: true },
      { id: 'pct', label: t('Share of contract (%)'), type: 'number', required: true, defaultValue: '10' },
      { id: 'due', label: t('Contractual date'), type: 'text', required: true, placeholder: t(DATE_EXAMPLE) },
      { id: 'cond', label: t('Condition'), type: 'textarea' },
    ],
  };
}

/**
 * AF.billing — "Issue invoice" (run): milestone (`MSPLAN`, the planned milestones "M4 · Cranes operational", value =
 * the number) · invoice number (pre-filled `ctrNextInvNo`) · invoice date ("30 Sep 2026") · note.
 */
export function invoiceFormDef(c: Pick<ContractData, 'milestones' | 'nextInvoiceNumber'>, t: T, lang: Lang): FormDef {
  return {
    title: t('Issue invoice'),
    kind: 'run',
    submit: t('Issue invoice'),
    fields: [
      {
        id: 'ms',
        label: t('Milestone'),
        type: 'select',
        options: c.milestones.filter((m) => m.status === 'planned').map((m) => ({ value: m.number, label: `${m.number} · ${dataText(m.label, lang)}` })),
      },
      { id: 'no', label: t('Invoice number'), type: 'text', required: true, defaultValue: c.nextInvoiceNumber },
      { id: 'date', label: t('Invoice date'), type: 'text', required: true, defaultValue: t(displayOfIso(NOW_ISO)) },
      { id: 'note', label: t('Note on the invoice'), type: 'textarea' },
    ],
  };
}
