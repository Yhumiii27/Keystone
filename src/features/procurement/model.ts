// View models of Sourcing, invoices & suppliers (docs/spec/08 §1; template 1972–2078, logic 4646–4676): the three
// tabs, the RFQ and invoice drawers, built from the purchasing DAL rows with the domain rules (src/domain/procurement)
// and translated for the viewer (`procT`). Every string is final; components only lay them out.
// Rights arrive resolved: `canEdit` (screen in the viewer's workspace), the viewer's role (award, invoice decisions).
import { LO, OK } from '@/components/app/tones';
import { screenHref, type RoleKey } from '@/config/screens';
import {
  MATCH_DOT, awardRuleTile, blockingReason, canAwardRfq, canDecideInvoiceRole, compareQuotes, invoiceChipStatuses,
  invoiceDecisions, invoiceKpis, match3, quotesText, receiptGap, rfqActions, rfqHint, rfqKpis, sourcingHref, supplierAttention, supplierKpis,
  type SourcingTab,
} from '@/domain/procurement';
import type { Lang, T } from '@/i18n/translate';
import { money, moneyEur } from '@/lib/format';
import { yearOfIso } from '@/domain/clock';
import { moneyUnitsIn } from '@/domain/currency';
import {
  RFQ_STATUS_TAG, SUPPLIER_GRADE_TAG, SUPPLIER_INVOICE_STATUS_TAG, incoterm, matchState, shortDateYearOfIso, supplierInvoiceStatus,
  type MatchState, type SupplierInvoiceStatus,
} from '@/server/db/codes';
import type { RfqRow, SupplierInvoiceRow } from '@/server/dal/purchasing';
import type { SupplierScorecard } from '@/server/dal/suppliers';
import { rfqAverageCycleDays, rfqSavingsKeur, type RfqKpiFacts } from '@/domain/kpis';
import { wholeDaysText } from '@/features/kpis/i18n';
import { dataText } from './i18n';
import { PRICE_MASK } from '@/domain/rights';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

const kpi = (t: T, label: string, value: string | number, sub: string, lo = false): KpiView => ({ label: t(label), value: t(String(value)), sub, color: lo ? LO : OK });
const qtyText = (n: number, lang: Lang) => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
/** "12 Mar" / "14 Jan 2027": the year outside the business year (R-013). */
const dateText = (iso: string, t: T, today: string) => t(shortDateYearOfIso(iso, yearOfIso(today)));

/** Shared context of the builders. */
export interface SourcingCtx {
  t: T;
  lang: Lang;
  role: RoleKey;
  /** Screen in the viewer's workspace (send, compare, New RFQ…). */
  canEdit: boolean;
  /** Supplier prices and invoice amounts shown (R-046, NEW-D2-1: director, PMs, procurement); masked otherwise. */
  prices: boolean;
  /** R-013: business date — "Savings vs list" (its quarter), invoices due within 30 days. */
  today: string;
}

/** A price text, or the mask for a viewer who may not see supplier prices (R-046). */
const priced = (c: Pick<SourcingCtx, 'prices'>) => (text: () => string) => (c.prices ? text() : PRICE_MASK);

// ── Display switch (`pSeg`) ────────────────────────────────────────────────────────────────────────────

export const SEG: { value: SourcingTab; label: string }[] = [
  { value: 'rfq', label: 'RFQ & quotes' },
  { value: 'inv', label: 'Invoices — 3-way match' },
  { value: 'sup', label: 'Supplier performance' },
];

export const segView = (t: T) => SEG.map((o) => ({ value: o.value, label: t(o.label), href: sourcingHref({ tab: o.value }) }));

// ── RFQ tab ────────────────────────────────────────────────────────────────────────────────────────────

export interface RfqRowView {
  number: string;
  title: string;
  part: string;
  qty: string;
  due: string;
  owner: string;
  quotes: string;
  rule: string;
  awardedTo: string;
  status: string;
  tagClass: string;
  selected: boolean;
  /** Row click: opens the drawer, or closes it when it is the open one (prototype toggle). */
  href: string;
  canSend: boolean;
  canCompare: boolean;
}

export interface RfqTabView {
  kpis: KpiView[];
  rows: RfqRowView[];
}

/**
 * `facts` = the RFQ facts of the computed tiles (src/server/dal/kpis.ts `rfqKpiFacts`): "Savings vs list" (awarded in the
 * business date's quarter, `c.today` — R-013) and "Average cycle" (sent → award) — A-12.
 */
export function rfqTabView(rfqs: readonly RfqRow[], selected: string | null, c: SourcingCtx, facts: readonly RfqKpiFacts[] = []): RfqTabView {
  const { t, lang } = c;
  const pr = priced(c);
  const k = rfqKpis(rfqs.map((r) => ({ status: r.status, quoteCount: r.quotes.length })));
  // R-169 (A-12): computed from the RFQs still to award (the prototype printed the constant "PM").
  const award = awardRuleTile(rfqs);
  return {
    kpis: [
      kpi(t, 'Open RFQs', k.open, t(`${k.readyToAward} ready to award`)),
      kpi(t, 'Quotes received', k.quotes, t('Across open requests')),
      kpi(t, 'Savings vs list', pr(() => money(rfqSavingsKeur(facts, c.today), lang)), t('Awarded this quarter')),
      kpi(t, 'Average cycle', wholeDaysText(rfqAverageCycleDays(facts), lang), t('RFQ sent → award')),
      kpi(t, 'Award rule', award.value, t(award.sub)),
    ],
    rows: rfqs.map((r) => {
      const actions = rfqActions({ status: r.status, quoteCount: r.quotes.length, awardedTo: r.awardedTo });
      const on = r.number === selected;
      return {
        number: r.number,
        title: dataText(r.title, lang),
        part: r.partRef ?? '—',
        qty: r.quantity != null ? qtyText(r.quantity, lang) : '—',
        due: dateText(r.replyDueOn, t, c.today),
        owner: r.owner,
        quotes: t(quotesText(r.quotes, lang)),
        rule: t(r.awardRuleLabel),
        awardedTo: r.awardedTo ?? '—',
        status: t(r.statusLabel),
        tagClass: `tag ${RFQ_STATUS_TAG[r.status]}`,
        selected: on,
        href: sourcingHref({ tab: 'rfq', rfq: on ? null : r.number }),
        canSend: c.canEdit && actions.canSend,
        canCompare: c.canEdit && actions.canCompare,
      };
    }),
  };
}

export interface QuoteRowView {
  supplier: string;
  awarded: boolean;
  price: string;
  best: boolean;
  total: string;
  delta: string;
  lead: string;
  fastest: boolean;
  terms: string;
  rating: string;
  canAward: boolean;
}

export interface RfqDrawerView {
  number: string;
  title: string;
  status: string;
  tagClass: string;
  closeHref: string;
  quotes: QuoteRowView[];
  noQuotes: boolean;
  /** Footnote: the prototype's fixed sentence followed by the hint ('' when none). */
  footnote: string;
  meta: { k: string; v: string }[];
  canSend: boolean;
  /** PLM part record; null without a catalogue part. */
  partHref: string | null;
  /** Purchase orders of the RFQ's project (the drafted order when the award created one). */
  ordersHref: string;
}

/**
 * RFQ drawer (`rfqVals`). `orderProject` = project of the order the award drafted (null when none), `currentProject` =
 * the viewer's last project (the prototype's `goTo('orders')` stays on it).
 */
export function rfqDrawerView(r: RfqRow, c: SourcingCtx & { orderProject: string | null; currentProject: string }): RfqDrawerView {
  const { t, lang } = c;
  const pr = priced(c);
  const state = { status: r.status, quoteCount: r.quotes.length, awardedTo: r.awardedTo };
  const cmp = compareQuotes(r.quotes, r.quantity);
  const canAward = c.canEdit && canAwardRfq(state, c.role);
  const hint = rfqHint({ ...state, purchaseOrderNumber: r.purchaseOrderNumber, purchaseOrderStatus: r.purchaseOrderStatus, awardedInKeystone: !!r.awardedBy }, c.role);
  const meta: { k: string; v: string }[] = [
    { k: t('Part'), v: r.partRef ? r.partRef + (r.partName ? ' · ' + dataText(r.partName, lang) : '') : '—' },
    { k: t('Quantity'), v: r.quantity != null ? qtyText(r.quantity, lang) : '—' },
    { k: t('Quotes due'), v: dateText(r.replyDueOn, t, c.today) },
    { k: t('Buyer'), v: r.owner },
    { k: t('Award rule'), v: t(r.awardRuleLabel) },
    { k: t('Last purchase price'), v: r.lastPriceEur != null ? pr(() => moneyEur(r.lastPriceEur!, lang)) : '—' },
  ];
  // RFQs sent from Keystone also show what was asked (the prototype's form fields).
  if (r.articlesText != null) {
    meta.push({ k: t('Articles'), v: dataText(r.articlesText, lang) });
    meta.push({ k: t('Suppliers'), v: r.invitedSuppliers.join(', ') || '—' });
    if (r.incoterm) meta.push({ k: t('Incoterm'), v: t(incoterm.label(r.incoterm)) });
  }
  const orderCode = c.orderProject ?? r.projectCode ?? c.currentProject;
  return {
    number: r.number,
    title: dataText(r.title, lang),
    status: t(r.statusLabel),
    tagClass: `tag ${RFQ_STATUS_TAG[r.status]}`,
    closeHref: sourcingHref({ tab: 'rfq' }),
    quotes: r.quotes.map((q, i) => ({
      supplier: q.supplier,
      awarded: q.awarded,
      price: pr(() => moneyEur(q.unitPriceEur, lang)),
      // Masked prices: the best-price highlight would still rank the suppliers by price.
      best: !!c.prices && cmp[i].isBest,
      total: cmp[i].totalEur != null ? pr(() => moneyEur(cmp[i].totalEur!, lang)) : '—',
      delta: cmp[i].deltaEur ? pr(() => '+' + moneyEur(cmp[i].deltaEur, lang)) : '—',
      lead: t(`${q.leadWeeks} ${q.leadWeeks === 1 ? 'wk' : 'wks'}`),
      fastest: cmp[i].isFastest,
      terms: dataText(q.paymentTerms, lang),
      rating: `${q.grade} · ${q.score}/100`,
      canAward,
    })),
    noQuotes: !r.quotes.length,
    footnote: [t('Best unit price and shortest lead time highlighted · rating from supplier performance ·'), hint ? t(hint) : ''].filter(Boolean).join(' '),
    meta,
    canSend: c.canEdit && rfqActions(state).canSend,
    partHref: r.partRef ? `${screenHref('plm')}?part=${encodeURIComponent(r.partRef)}` : null,
    ordersHref: screenHref('orders', { code: orderCode }) + (r.purchaseOrderNumber && c.orderProject ? `?po=${encodeURIComponent(r.purchaseOrderNumber)}` : ''),
  };
}

// ── Invoice tab ────────────────────────────────────────────────────────────────────────────────────────

export interface MatchDotView {
  label: string;
  color: string;
  /** State of the leg ("Matched", "Partial receipt"…, translated): tooltip and screen-reader text, the dot alone is colour only. */
  state: string;
}

export interface InvoiceRowView {
  number: string;
  date: string;
  supplier: string;
  po: string;
  gr: string;
  amount: string;
  gap: string;
  gapColor: string;
  dots: MatchDotView[];
  due: string;
  status: string;
  tagClass: string;
  selected: boolean;
  href: string;
  canApprove: boolean;
  canApprovePart: boolean;
}

export interface InvoiceChipView {
  value: SupplierInvoiceStatus | 'all';
  label: string;
  count: number;
  href: string;
}

export interface InvoiceTabView {
  kpis: KpiView[];
  chips: InvoiceChipView[];
  filter: SupplierInvoiceStatus | 'all';
  rows: InvoiceRowView[];
}

/** EN source label of a match state ("Matched", "Partial receipt"…). */
const legState = (s: MatchState) => matchState.label(s);

const matchOf = (i: SupplierInvoiceRow) =>
  match3({ hasPo: !!i.poNumber, hasReceipt: !!i.receiptNumber, amountEur: i.amountEur, poAmountEur: i.poAmountEur, receiptAmountEur: i.receiptAmountEur });

/** Invoice decisions the viewer may take: screen in the workspace and a deciding role (procurement, director). */
const decisionsFor = (i: SupplierInvoiceRow, c: SourcingCtx) => {
  const d = invoiceDecisions(i.status, matchOf(i));
  const may = c.canEdit && canDecideInvoiceRole(c.role);
  return { canApprove: may && d.canApprove, canApprovePart: may && d.canApprovePart, canReject: may && d.canReject };
};

/** `?status=` value: a status code with a chip, else All. */
export function parseInvoiceFilter(v: string | undefined, invoices: readonly { status: SupplierInvoiceStatus }[]): SupplierInvoiceStatus | 'all' {
  return v && (invoiceChipStatuses(invoices) as string[]).includes(v) ? (v as SupplierInvoiceStatus) : 'all';
}

export function invoiceTabView(invoices: readonly SupplierInvoiceRow[], filter: SupplierInvoiceStatus | 'all', selected: string | null, c: SourcingCtx): InvoiceTabView {
  const { t, lang } = c;
  const pr = priced(c);
  const k = invoiceKpis(invoices.map((i) => ({ status: i.status, amountEur: i.amountEur, dueDate: i.dueDate })), c.today);
  const statuses = invoiceChipStatuses(invoices);
  const status = filter === 'all' ? null : filter;
  return {
    kpis: [
      kpi(t, 'Invoices to process', k.toProcess, pr(() => moneyEur(k.toProcessEur, lang))),
      kpi(t, 'Blocked by 3-way match', k.blocked, t('Quantity or PO mismatch'), k.blocked > 0),
      kpi(t, 'Awaiting goods receipt', k.awaitingReceipt, t('Invoice before delivery')),
      kpi(t, 'Approved for payment', k.approved, t('Pushed to X3 accounts payable')),
      kpi(t, 'Due within 30 days', k.dueWithin30, t('Net 30 default terms')),
    ],
    chips: [
      { value: 'all', label: t('All'), count: invoices.length, href: sourcingHref({ tab: 'inv' }) },
      ...statuses.map((s) => ({ value: s, label: t(supplierInvoiceStatus.label(s)), count: invoices.filter((i) => i.status === s).length, href: sourcingHref({ tab: 'inv', status: s }) })),
    ],
    filter,
    rows: invoices
      .filter((i) => !status || i.status === status)
      .map((i) => {
        const m = matchOf(i);
        const gap = receiptGap({ hasReceipt: !!i.receiptNumber, amountEur: i.amountEur, receiptAmountEur: i.receiptAmountEur });
        const d = decisionsFor(i, c);
        const on = i.number === selected;
        return {
          number: i.number,
          date: dateText(i.invoiceDate, t, c.today),
          supplier: i.supplier,
          po: i.poNumber ?? '—',
          gr: i.receiptNumber ?? '—',
          amount: pr(() => moneyUnitsIn(i.amountEur, i.currency, lang)),
          gap: gap != null ? pr(() => moneyUnitsIn(gap, i.currency, lang)) : '—',
          gapColor: gap != null ? LO : 'var(--color-neutral-500)',
          dots: [
            { label: 'PO', color: MATCH_DOT[m.po], state: t(legState(m.po)) },
            { label: 'GR', color: MATCH_DOT[m.gr], state: t(legState(m.gr)) },
            { label: 'INV', color: MATCH_DOT.ok, state: t(legState('ok')) },
          ],
          due: dateText(i.dueDate, t, c.today),
          status: t(i.statusLabel),
          tagClass: `tag ${SUPPLIER_INVOICE_STATUS_TAG[i.status]}`,
          selected: on,
          href: sourcingHref({ tab: 'inv', status, inv: on ? null : i.number }),
          canApprove: d.canApprove,
          canApprovePart: d.canApprovePart,
        };
      }),
  };
}

export interface MatchLegView {
  label: string;
  ref: string;
  amount: string;
  dot: string;
  state: string;
  color: string;
}

export interface InvoiceDrawerView {
  number: string;
  supplier: string;
  status: string;
  tagClass: string;
  closeHref: string;
  legs: MatchLegView[];
  meta: { k: string; v: string; color: string }[];
  canApprove: boolean;
  canApprovePart: boolean;
  /** "Approve €1,259,600 · request credit note". */
  partialLabel: string;
  canReject: boolean;
  poHref: string | null;
  grHref: string | null;
}


export function invoiceDrawerView(i: SupplierInvoiceRow, filter: SupplierInvoiceStatus | 'all', c: SourcingCtx & { currentProject: string }): InvoiceDrawerView {
  const { t, lang } = c;
  const pr = priced(c);
  const m = matchOf(i);
  const gap = receiptGap({ hasReceipt: !!i.receiptNumber, amountEur: i.amountEur, receiptAmountEur: i.receiptAmountEur });
  const reason = blockingReason(i.status, m);
  const d = decisionsFor(i, c);
  const leg = (label: string, ref: string | null, amount: number, s: MatchState): MatchLegView => ({
    label: t(label), ref: ref ?? '—', amount: pr(() => moneyUnitsIn(amount, i.currency, lang)), dot: MATCH_DOT[s], state: t(legState(s)), color: s === 'ok' ? OK : LO,
  });
  const code = i.projectCode ?? c.currentProject;
  return {
    number: i.number,
    supplier: i.supplier,
    status: t(i.statusLabel),
    tagClass: `tag ${SUPPLIER_INVOICE_STATUS_TAG[i.status]}`,
    closeHref: sourcingHref({ tab: 'inv', status: filter === 'all' ? null : filter }),
    legs: [leg('Purchase order', i.poNumber, i.poAmountEur, m.po), leg('Goods receipt', i.receiptNumber, i.receiptAmountEur, m.gr), leg('Invoice', i.number, i.amountEur, 'ok')],
    meta: [
      { k: t('Invoice date'), v: dateText(i.invoiceDate, t, c.today), color: OK },
      { k: t('Due date'), v: dateText(i.dueDate, t, c.today), color: OK },
      { k: t('Terms'), v: dataText(i.paymentTerms, lang), color: OK },
      { k: t('Variance invoice − receipt'), v: gap != null ? pr(() => moneyUnitsIn(gap, i.currency, lang)) : '—', color: OK },
      { k: t('Blocking reason'), v: reason ? t(reason) : '—', color: reason ? LO : OK },
    ],
    canApprove: d.canApprove,
    canApprovePart: d.canApprovePart,
    partialLabel: c.prices ? t(`Approve ${moneyUnitsIn(i.receiptAmountEur, i.currency, lang)} · request credit note`) : t('Approve the received amount · request credit note'),
    canReject: d.canReject,
    poHref: i.poNumber ? `${screenHref('orders', { code })}?po=${encodeURIComponent(i.poNumber)}` : null,
    grHref: i.receiptNumber ? `${screenHref('deliveries', { code })}?receipt=${encodeURIComponent(i.receiptNumber)}` : null,
  };
}

// ── Supplier tab ───────────────────────────────────────────────────────────────────────────────────────

export interface SupplierRowView {
  name: string;
  onTime: string;
  onTimeWidth: string;
  onTimeColor: string;
  quality: string;
  qualityWidth: string;
  ncrRate: string;
  ncrRateColor: string;
  openPos: string;
  ncrs: string;
  grade: string;
  gradeClass: string;
}

export interface SupplierTabView {
  kpis: KpiView[];
  rows: SupplierRowView[];
}

const pctText = (n: number) => `${n}%`;

export function supplierTabView(card: SupplierScorecard, c: Pick<SourcingCtx, 't'>): SupplierTabView {
  const { t } = c;
  const k = supplierKpis(card.rows);
  return {
    kpis: [
      kpi(t, 'Active suppliers', k.active, t(`${k.ratedA} rated A`)),
      kpi(t, 'On-time delivery', pctText(k.onTimePct), t('Weighted last 12 months')),
      kpi(t, 'Quality acceptance', pctText(k.qualityPct), t('Units accepted at receipt')),
      kpi(t, 'Rated C', k.ratedC, t('Improvement plan required'), k.ratedC > 0),
      kpi(t, 'NCRs from suppliers', card.supplierNcrs, t('This quarter')),
    ],
    rows: card.rows.map((s) => {
      const a = supplierAttention(s);
      return {
        name: s.name,
        onTime: pctText(s.onTimeDeliveryPct),
        onTimeWidth: pctText(Math.max(0, Math.min(100, s.onTimeDeliveryPct))),
        onTimeColor: a.onTime ? LO : OK,
        quality: pctText(s.qualityAcceptancePct),
        qualityWidth: pctText(Math.max(0, Math.min(100, s.qualityAcceptancePct))),
        ncrRate: pctText(s.ncrRatePct),
        ncrRateColor: a.ncrRate ? LO : OK,
        openPos: String(s.openPoCount),
        ncrs: String(s.ncrsThisQuarter),
        grade: s.grade,
        gradeClass: `tag ${SUPPLIER_GRADE_TAG[s.grade]}`,
      };
    }),
  };
}
