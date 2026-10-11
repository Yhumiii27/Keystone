// View model of the Purchase orders screen (docs/spec/08 §2, template 2615–2688, logic 4306–4337): the data layer's
// orders and BOM shortfall turned into the translated strings, tag classes, colours and links the server components
// render — KPI tiles, shortfall banner, status chips, table rows and the order drawer. Pure (no I/O): `t` and `lang`
// come from the page; rules come from src/domain/orders.ts.
import { LO, OK } from '@/components/app/tones';
import { deliveryTermsText } from '@/domain/order-terms';
import {
  PO_FLOW, canApprovePo, canPushPoToX3, canSubmitPo, filterPos, hasPartStatusIssue, isLatePo, lineSummary, needText, partWarnings, poKpis, poRisk,
  poRiskText, poStatusCounts, poSteps, poUnits, poValueEur, poX3State,
} from '@/domain/orders';
import { PRICES_HIDDEN, PRICE_MASK } from '@/domain/rights';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { BASE_CURRENCY, moneyIn, moneyUnitsIn } from '@/domain/currency';
import { PART_STATUS_TAG, PO_STATUS_TAG, fmtDOfIso, poStatus, type PoStatus } from '@/server/db/codes';
import type { OrdersScreenData, PoDocRef } from '@/server/dal/orders';
import type { PurchaseOrderRow } from '@/server/dal/purchasing';
import { dataT, lineCountText, ordersInTotalText, partWarningText, qtyText, shortfallTitleText, toOrderText } from './i18n';
import { bomPartHref, invoiceHref, ordersHref, planActivityHref, receiptHref } from './links';

const NEUTRAL_300 = 'var(--color-neutral-300)';
const NEUTRAL_400 = 'var(--color-neutral-400)';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ChipView {
  value: PoStatus | 'all';
  label: string;
  count: number;
  href: string;
}

export interface ShortfallView {
  /** "15 BOM articles are not fully ordered". */
  title: string;
  /** "€884k still to commit at list price". */
  sub: string;
  /** "KS-PLT-S355 · 192 to order". */
  chips: string[];
}

export interface OrderRowView {
  number: string;
  /** The open (drawer) row: id in accent-300. */
  selected: boolean;
  /** Row click toggles the drawer (`select()`: the same order again closes it). */
  href: string;
  supplier: string;
  lineSummary: string;
  lineCount: string;
  value: string;
  status: string;
  statusClass: string;
  ordered: string;
  expected: string;
  expColor: string;
  need: string;
  risk: string;
  riskColor: string;
  canSubmit: boolean;
  canApprove: boolean;
}

export interface OrderLineView {
  ref: string;
  name: string;
  qty: string;
  price: string;
  total: string;
  status: string;
  statusClass: string;
  /** Project BOM with the part selected. */
  href: string;
}

export interface MetaLink {
  label: string;
  href: string;
  /** Status of the linked record (title attribute). */
  title: string;
}

export interface MetaRowView {
  k: string;
  /** Text value, or links (receipts, invoices). */
  v: string;
  links?: MetaLink[];
  color: string;
}

export interface OrderDrawerView {
  number: string;
  /** "PO-1052 · Halvorsen Cranes". */
  head: string;
  status: string;
  statusClass: string;
  steps: { label: string; reached: boolean; current: boolean }[];
  /** Part-status warning; null when every part is Validated. */
  warn: string | null;
  lines: OrderLineView[];
  meta: MetaRowView[];
  /** "Open activity". */
  activityHref: string;
  /** "Push to X3" offered (order drafted in Keystone, approved, not pushed yet). */
  canPush: boolean;
  closeHref: string;
  /** C-9 (R-075): the order's currency; a Draft may switch between EUR and the project currency (`options`, ≥ 2). */
  currency: { value: string; options: string[]; canSet: boolean };
}

export interface OrdersView {
  code: string;
  kpis: KpiView[];
  shortfall: ShortfallView | null;
  chips: ChipView[];
  filter: PoStatus | null;
  title: string;
  rows: OrderRowView[];
  /** "No purchase orders in this status" when the filtered list is empty. */
  empty: string | null;
  drawer: OrderDrawerView | null;
  /** The viewer approves this project's orders ("Approve & order" shown). */
  canApprove: boolean;
  /** URL after the shortfall assistant ran: chip filter reset to All (`createDrafts` sets poFilter null), drawer kept. */
  afterDraftsHref: string;
}

export interface OrdersViewInput {
  code: string;
  data: OrdersScreenData;
  /** `?status=` (null = All). */
  filter: PoStatus | null;
  /** `?po=` (null = no drawer; an unknown number opens nothing). */
  selected: string | null;
  /** Supplier prices and order values shown (R-046, NEW-D2-1: director, PMs, procurement); masked otherwise. Default true. */
  prices?: boolean;
}

const dateText = (iso: string, t: T) => t(fmtDOfIso(iso));

function rowView(o: PurchaseOrderRow, code: string, filter: PoStatus | null, selected: string | null, t: T, lang: Lang, prices = true): OrderRowView {
  const risk = poRisk(o);
  const late = risk?.kind === 'late';
  return {
    number: o.number,
    selected: o.number === selected,
    href: ordersHref(code, { status: filter, po: o.number === selected ? null : o.number }),
    supplier: dataT(o.supplier, lang),
    lineSummary: lineSummary(o.lines.map((l) => l.ref)),
    lineCount: lineCountText(o.lines.length, poUnits(o), hasPartStatusIssue(o), lang),
    value: prices ? moneyIn(poValueEur(o) / 1000, o.currency, lang) : PRICE_MASK,
    status: t(poStatus.label(o.status)),
    statusClass: `tag ${PO_STATUS_TAG[o.status]}`,
    ordered: o.status === 'draft' || !o.orderedOn ? '—' : dateText(o.orderedOn, t),
    expected: o.status === 'received' ? t('Delivered') : o.expectedOn ? dateText(o.expectedOn, t) : t('To confirm'),
    expColor: late ? LO : NEUTRAL_300,
    need: o.neededFor ? t(needText(o)) : '—',
    risk: risk ? t(poRiskText(risk)) : '',
    riskColor: late ? LO : NEUTRAL_400,
    canSubmit: canSubmitPo(o.status),
    canApprove: canApprovePo(o.status),
  };
}

const docLinks = (refs: PoDocRef[] | undefined, href: (n: string) => string, t: T): MetaLink[] =>
  (refs ?? []).map((r) => ({ label: r.number, href: href(r.number), title: t(r.statusLabel) }));

function drawerView(o: PurchaseOrderRow, input: OrdersViewInput, t: T, lang: Lang): OrderDrawerView {
  const { code, data, filter } = input;
  const prices = input.prices !== false;
  const late = isLatePo(o);
  const meta: MetaRowView[] = [
    // C-9: in the order's currency, with its euro equivalent at the project's budget rate.
    { k: t('Order value'), v: prices ? moneyIn(poValueEur(o) / 1000, o.currency, lang) + (o.currency === BASE_CURRENCY ? '' : ` · ≈ ${money((poValueEur(o) * o.eurRate) / 1000, lang)}`) : PRICE_MASK, color: OK },
    { k: t('Ordered on'), v: o.status === 'draft' || !o.orderedOn ? t('Not yet') : dateText(o.orderedOn, t), color: OK },
    { k: t('Expected delivery'), v: o.expectedOn ? dateText(o.expectedOn, t) : t('To confirm'), color: late ? LO : OK },
    { k: t('Needed by'), v: o.neededFor ? t(needText(o)) : '—', color: OK },
    // R-169: an order drafted in Keystone without an RFQ has no terms yet (the prototype wrote "Site gate 2 · DAP · Net 30").
    { k: t('Delivery / terms'), v: deliveryTermsText(o.deliveryTerms, lang, t), color: OK },
  ];
  // Additions to the prototype drawer (08 §2.7): the receipts and invoices of the order, and its Sage X3 state when
  // it was drafted in Keystone.
  const receipts = docLinks(data.receipts[o.number], (n) => receiptHref(code, n), t);
  if (receipts.length) meta.push({ k: t('Goods receipts'), v: '', links: receipts, color: OK });
  const invoices = docLinks(data.invoices[o.number], invoiceHref, t);
  if (invoices.length) meta.push({ k: t('Supplier invoices'), v: '', links: invoices, color: OK });
  const x3 = poX3State(o);
  if (x3 !== 'x3') meta.push({ k: 'Sage X3', v: x3 === 'pushed' ? `${t('Pushed to X3')} · ${o.x3Ref}` : t('Local change · not yet pushed to X3'), color: x3 === 'local' ? LO : OK });
  const warn = partWarningText(partWarnings(o), lang);
  return {
    number: o.number,
    head: `${o.number} · ${dataT(o.supplier, lang)}`,
    status: t(poStatus.label(o.status)),
    statusClass: `tag ${PO_STATUS_TAG[o.status]}`,
    steps: poSteps(o.status).map((s) => ({ label: t(s.label), reached: s.reached, current: s.current })),
    warn: warn || null,
    lines: o.lines.map((l) => ({
      ref: l.ref,
      name: dataT(l.name, lang),
      qty: qtyText(l.orderedQty, lang),
      price: prices ? moneyUnitsIn(l.unitPriceEur, o.currency, lang) : PRICE_MASK,
      total: prices ? moneyUnitsIn(l.unitPriceEur * l.orderedQty, o.currency, lang) : PRICE_MASK,
      status: t(l.partStatusLabel),
      statusClass: `tag ${PART_STATUS_TAG[l.partStatus]}`,
      href: bomPartHref(code, l.ref),
    })),
    meta,
    activityHref: planActivityHref(code, o.neededFor?.code ?? null),
    canPush: canPushPoToX3(o),
    closeHref: ordersHref(code, { status: filter }),
    currency: currencyChoice(o),
  };
}

/** EUR first, then the project currency; an order in a currency no longer offered keeps it listed. */
function currencyChoice(o: PurchaseOrderRow): OrderDrawerView['currency'] {
  const options = [...new Set([...o.currencyOptions, o.currency])];
  return { value: o.currency, options, canSet: o.status === 'draft' && options.length > 1 };
}

/** The whole screen. */
export function ordersView(input: OrdersViewInput, t: T, lang: Lang): OrdersView {
  const { code, data, filter, selected } = input;
  const prices = input.prices !== false;
  const orders = data.orders;
  const k = poKpis(orders);
  const counts = poStatusCounts(orders);
  const rows = filterPos(orders, filter).map((o) => rowView(o, code, filter, selected, t, lang, prices));
  const sel = selected ? orders.find((o) => o.number === selected) : undefined;
  const sf = data.shortfall;
  return {
    code,
    kpis: [
      { label: t('Open orders'), value: String(k.open), sub: ordersInTotalText(k.total, lang), color: OK },
      { label: t('Committed'), value: prices ? money(k.committedEur / 1000, lang) : PRICE_MASK, sub: t('Ordered, not cancelled'), color: OK },
      { label: t('Late deliveries'), value: String(k.late), sub: t('See Deliveries for goods receipt'), color: k.late ? LO : OK },
      { label: t('Awaiting approval'), value: String(k.awaitingApproval), sub: t('Blocks ordering'), color: k.awaitingApproval ? LO : OK },
    ],
    shortfall: sf.lines.length
      ? {
          title: shortfallTitleText(sf.lines.length, lang),
          sub: prices ? t(`${money(sf.valueEur / 1000, lang)} still to commit at list price`) : t(PRICES_HIDDEN),
          chips: sf.lines.map((l) => toOrderText(l.ref, l.need, t, lang)),
        }
      : null,
    chips: [
      { value: 'all', label: t('All'), count: orders.length, href: ordersHref(code, { po: selected }) },
      ...PO_FLOW.map((s) => ({ value: s, label: t(poStatus.label(s)), count: counts[s], href: ordersHref(code, { status: s, po: selected }) })),
    ],
    filter,
    title: t(`Purchase orders · ${rows.length}`),
    rows,
    empty: rows.length ? null : t('No purchase orders in this status'),
    drawer: sel ? drawerView(sel, input, t, lang) : null,
    canApprove: data.canApprove,
    afterDraftsHref: ordersHref(code, { po: selected }),
  };
}
