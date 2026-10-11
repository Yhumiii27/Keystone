// Export providers — Contract and Billing & payments (/projects/[code]/contract, /billing).
// Excel: the contract sheet, amendments, guarantees and the payment schedule; billing: milestones, issued invoices and the
// KPI tiles. PDF: the client account statement (billing report, and the client view's "Download statement" document —
// `statementDocument` is shared with the client provider). Delivery 7: amounts in the contract's currency (C-9), the payment
// rule in words (R-076), the amendments' own milestones and the signature cycle (R-079).
import { moneyIn, thousandsUnit } from '@/domain/currency';
import { paymentTermsText } from '@/domain/payment-terms';
import { billingView, contractView } from '@/features/contract/model';
import { getContract, type ProjectContract } from '@/server/dal/contract';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook, PdfDocument } from '../types';
import { col, kpiSheet, projectRef, sheet, sum, tableBlock, todayIso } from './common';
import { moneyCol } from './currency-columns';
import { dataText } from '@/i18n/data-text';

const contractOf = async (ctx: ExportContext) => (ctx.project ? getContract(ctx.project.code) : null);

/** Label of the basis of a milestone: "Base contract" or the amendment's (NEW-D3-3). */
const basisOf = (ctx: ExportContext, c: ProjectContract, amendment: number | null) =>
  amendment == null ? ctx.t('Base contract') : ctx.t(c.amendments.find((a) => a.position === amendment)?.label ?? '');

function milestoneSheet(ctx: ExportContext, c: ProjectContract): ExportSheet {
  const { t } = ctx;
  return sheet(t('Payment schedule'), [
    col('number', t('Milestone'), 'text', 8), col('label', t('Description'), 'text', 40), col('basis', t('Applies to'), 'text', 30), col('share', t('Share'), 'percent', 8, { decimals: 1 }),
    moneyCol('amount', t('Amount'), c.sheet.currency, 'k'), col('due', t('Contractual date'), 'date'), col('condition', t('Condition'), 'text', 36), col('status', t('Status'), 'text', 14),
    col('late', t('Late'), 'boolean'), col('billable', t('Billable'), 'boolean'), col('invoice', t('Invoice'), 'text', 14),
  ], c.milestones.map((m) => ({
    number: m.number, label: t(m.label), basis: basisOf(ctx, c, m.amendment), share: m.sharePct / 100, amount: m.amountKeur, due: m.contractualDue,
    condition: m.condition ? t(m.condition) : '', status: t(m.statusLabel), late: m.late, billable: m.billable, invoice: m.invoice?.number ?? '',
  })));
}

function invoiceSheet(ctx: ExportContext, c: ProjectContract): ExportSheet {
  const { t } = ctx;
  return sheet(t('Invoices'), [
    col('number', t('Invoice'), 'text', 14), col('milestone', t('Milestone'), 'text', 36), col('issued', t('Issued on'), 'date'), col('due', t('Due date'), 'date'),
    moneyCol('amount', t('Amount'), c.sheet.currency, 'k'), col('paid', t('Paid on'), 'date'), col('status', t('Status'), 'text', 16), col('note', t('Note'), 'text', 30),
  ], c.invoices.map((i) => ({
    number: i.number, milestone: `${i.milestoneNumber} · ${t(i.milestoneLabel)}`, issued: i.issuedOn, due: i.dueOn, amount: i.amountKeur, paid: i.paidOn,
    status: t(i.statusLabel), note: i.note ? dataText(i.note, ctx.lang) : '',
  })));
}

async function contractWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const c = await contractOf(ctx);
  if (!c) return null;
  const { t, lang } = ctx;
  const view = contractView(c, t, lang);
  const s = c.sheet;
  return {
    title: `${t('Contract')} ${s.reference}`,
    sheets: [
      sheet(t('Contract'), [col('field', t('Field'), 'text', 24), col('value', t('Value'), 'text', 80)], [
        [t('Reference'), s.reference], [t('Client'), dataText(s.client, ctx.lang)], [t('Contract type'), t(s.typeLabel)], [t('Signed on'), t(s.signedText)],
        [t(s.currency === 'EUR' ? 'Base amount (k€)' : `Base amount (${thousandsUnit(s.currency)})`), String(s.baseAmountKeur)], [t('Currency'), s.currency],
        [t('Contract value'), moneyIn(c.valueKeur, s.currency, lang)], [t('Payment terms'), paymentTermsText({ rule: s.paymentRule, days: s.paymentDays }, lang)],
        [t('Retention (%)'), String(s.retentionPct)], [t('Retention release'), dataText(s.retentionNote, ctx.lang)], [t('Liquidated damages'), dataText(s.liquidatedDamages, ctx.lang)],
        [t('Warranty'), dataText(s.warranty, ctx.lang)], [t('Governing law'), dataText(s.governingLaw, ctx.lang)], [t('Scope summary'), dataText(s.scope, ctx.lang)],
      ].map(([field, value]) => ({ field, value }))),
      sheet(t('Amendments'), [
        col('label', t('Amendment'), 'text', 50), col('cr', t('Change request'), 'text', 12), moneyCol('amount', t('Amount'), s.currency, 'k'), col('status', t('Status'), 'text', 14),
        col('sent', t('Sent for signature'), 'date'), col('signed', t('Signed on'), 'date'), col('document', t('Document'), 'text', 16),
      ], c.amendments.map((a) => ({
        label: t(a.label), cr: a.changeRequestRef ?? '', amount: a.amountKeur, status: t(a.statusLabel), sent: a.sentOn, signed: a.signedOn, document: a.documentRef ?? '',
      }))),
      sheet(t('Guarantees'), [
        col('label', t('Guarantee'), 'text', 40), col('issuer', t('Issuer'), 'text', 20), moneyCol('amount', t('Amount'), s.currency, 'k'), col('validUntil', t('Valid until'), 'date'),
        col('released', t('Released on'), 'date'), col('inForce', t('In force'), 'boolean'),
      ], c.bonds.map((b) => ({ label: t(b.label), issuer: b.issuer ?? '', amount: b.amountKeur, validUntil: b.validUntil, released: b.releasedOn, inForce: b.inForce }))),
      milestoneSheet(ctx, c),
      kpiSheet(ctx, view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub }))),
    ],
  };
}

async function billingWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const c = await contractOf(ctx);
  if (!c) return null;
  const view = billingView(c, ctx.t, ctx.lang);
  return {
    title: ctx.t('Billing & payments'),
    sheets: [invoiceSheet(ctx, c), milestoneSheet(ctx, c), kpiSheet(ctx, view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub })))],
  };
}

/** Client account statement (PDF): contract figures, every invoice with its due date and payment, what remains to invoice. */
export async function statementDocument(ctx: ExportContext): Promise<PdfDocument | null> {
  const c = await contractOf(ctx);
  if (!c || !ctx.project) return null;
  const { t, lang } = ctx;
  const view = billingView(c, t, lang);
  const invoices = invoiceSheet(ctx, c);
  // Still to invoice: the planned milestones of the base contract and of the signed amendments (NEW-D3-3).
  const open = { ...milestoneSheet(ctx, c), rows: milestoneSheet(ctx, c).rows.filter((_, i) => c.milestones[i].status === 'planned' && c.milestones[i].billable) };
  return {
    title: t('Account statement'),
    subtitle: `${dataText(c.sheet.client, ctx.lang)} · ${t('Contract')} ${c.sheet.reference}`,
    project: projectRef(ctx),
    reference: c.sheet.reference,
    date: todayIso(ctx),
    blocks: [
      { kind: 'fields', items: [[t('Client'), dataText(c.sheet.client, ctx.lang)], [t('Contract'), c.sheet.reference], [t('Payment terms'), view.terms], [t('Retention held'), view.progress.retention]], columns: 2 },
      { kind: 'kpis', items: view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub })) },
      { kind: 'heading', text: t('Invoices') },
      invoices.rows.length
        ? tableBlock(invoices, ['number', 'milestone', 'issued', 'due', 'amount', 'paid', 'status'], { milestone: t('Total'), amount: sum(invoices.rows, 'amount') })
        : { kind: 'paragraph', text: t('No invoice issued yet'), muted: true },
      { kind: 'heading', text: t('Still to invoice') },
      open.rows.length
        ? tableBlock(open, ['number', 'label', 'share', 'amount', 'due', 'status'], { label: t('Total'), amount: sum(open.rows, 'amount') })
        : { kind: 'paragraph', text: t('Every milestone is invoiced'), muted: true },
    ],
    footnote: c.sheet.currency === 'EUR'
      ? t('Amounts in thousands of euros (k€), excluding VAT. Statement at the export date; payments recorded in Keystone.')
      : `${t('Amounts in thousands of the contract currency, excluding VAT')} (${c.sheet.currency}). ${t('Statement at the export date; payments recorded in Keystone.')}`,
  };
}

registerExportProvider({ screen: 'contract', table: contractWorkbook });
registerExportProvider({ screen: 'billing', table: billingWorkbook, pdf: statementDocument, documents: { statement: statementDocument } });
