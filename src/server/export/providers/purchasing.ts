// Export providers — Purchasing & stock: Sourcing (RFQs, supplier invoices, scorecard), Purchase orders, Deliveries &
// goods receipt, Stock & storages.
// Excel follows each screen's filters (`?tab=`, `?status=`, `?loc=&q=`); a client exports only its own projects' rows.
// PDF documents: `po` = the purchase order (header, lines, totals, signatures — "Export PO") and `receipt` = the goods
// receipt (lines with the QC result, put-away, signatures — "Print receipt").
import { DEFAULT_PROJECT } from '@/config/screens';
import { isPoStatus } from '@/domain/orders';
import { filterReceipts, receiptFilterOf } from '@/domain/deliveries';
import { filterStockLines } from '@/domain/stock';
import { isSourcingTab } from '@/domain/procurement';
import { procT } from '@/features/procurement/i18n';
import { parseInvoiceFilter } from '@/features/procurement/model';
import { getDeliveriesScreen, getReceipt } from '@/server/dal/deliveries';
import { getOrdersScreen } from '@/server/dal/orders';
import { getPurchaseOrder, listRfqs, listSupplierInvoices } from '@/server/dal/purchasing';
import { listStock, listStockMovements } from '@/server/dal/stock';
import { getSupplierScorecard } from '@/server/dal/suppliers';
import { poStatus, receiptStatus, supplierInvoiceStatus } from '@/server/db/codes';
import { formatDate } from '../format';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook, PdfDocument } from '../types';
import { col, compact, filterLine, kpiSheet, param, pricedPdf, pricedWorkbook, projectRef, sheet, sum, tableBlock, todayIso } from './common';
import { commonCurrency, moneyCol } from './currency-columns';
import { currentProjectCode, projectFilter } from './scope';

// ── Sourcing, invoices & suppliers ───────────────────────────────────────────────────────────────────────────────────
async function procurementWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const t = procT(ctx.t, ctx.lang);
  const raw = param(ctx, 'tab');
  const tab = isSourcingTab(raw) ? raw : 'rfq';
  // A client's `?code=` falls back to one of their own projects (never another organisation's NCR counts).
  const current = await currentProjectCode(ctx, DEFAULT_PROJECT);
  const [rfqs, invoices, card, visible] = await Promise.all([listRfqs(), listSupplierInvoices(), getSupplierScorecard(current), projectFilter(ctx)]);
  const filter = parseInvoiceFilter(param(ctx, 'status') ?? undefined, invoices);
  const rfq = sheet(t('Requests for quotation'), [
    col('number', t('RFQ'), 'text', 10), col('title', t('Title'), 'text', 36), col('project', t('Project'), 'text', 10), col('part', t('Part'), 'text', 16), col('qty', t('Quantity'), 'number', 8),
    col('due', t('Reply due'), 'date'), col('status', t('Status'), 'text', 14), col('rule', t('Award rule'), 'text', 18), col('owner', t('Owner'), 'text', 16),
    col('suppliers', t('Invited suppliers'), 'text', 36), col('best', t('Best unit price'), 'money_eur'), col('awarded', t('Awarded to'), 'text', 18), col('po', t('Purchase order'), 'text', 10),
  ], rfqs.filter((r) => visible(r.projectCode)).map((r) => ({
    number: r.number, title: t(r.title), project: r.projectCode ?? '', part: r.partRef ?? '', qty: r.quantity, due: r.replyDueOn, status: t(r.statusLabel), rule: t(r.awardRuleLabel), owner: r.owner,
    suppliers: r.invitedSuppliers.join(' · '), best: r.bestUnitPriceEur, awarded: r.awardedTo ?? '', po: r.purchaseOrderNumber ?? '',
  })));
  const quotes = sheet(t('Quotes'), [
    col('rfq', t('RFQ'), 'text', 10), col('supplier', t('Supplier'), 'text', 20), col('unit', t('Unit price'), 'money_eur'), col('total', t('Total'), 'money_eur'), col('lead', t('Lead time (weeks)'), 'integer'),
    col('terms', t('Payment terms'), 'text', 14), col('grade', t('Grade'), 'text', 6), col('score', t('Score'), 'number', 8, { decimals: 1 }), col('awarded', t('Awarded'), 'boolean'),
  ], rfqs.filter((r) => visible(r.projectCode)).flatMap((r) => r.quotes.map((q) => ({
    rfq: r.number, supplier: q.supplier, unit: q.unitPriceEur, total: q.totalEur, lead: q.leadWeeks, terms: t(q.paymentTerms), grade: q.grade, score: q.score, awarded: q.awarded,
  }))));
  // C-9: amounts in each invoice's currency — € columns when they are all in euros, else plain numbers and a Currency column.
  const icur = commonCurrency(invoices.map((i) => i.currency));
  const amt = (key: string, header: string) => (icur ? moneyCol(key, header, icur, 'units') : col(key, header, 'number', undefined, { decimals: 2 }));
  const inv = sheet(t('Supplier invoices'), [
    col('number', t('Invoice'), 'text', 16), col('supplier', t('Supplier'), 'text', 20), col('po', t('Purchase order'), 'text', 10), col('receipt', t('Goods receipt'), 'text', 10),
    col('project', t('Project'), 'text', 10), ...(icur ? [] : [col('currency', t('Currency'), 'text', 8)]), amt('amount', t('Amount')), amt('invoiced', t('Invoiced amount')), amt('poAmount', t('PO amount')),
    amt('grAmount', t('Receipt amount')), amt('gap', t('Gap')), col('matchPo', t('PO match'), 'text', 14), col('matchGr', t('Receipt match'), 'text', 14),
    col('date', t('Invoice date'), 'date'), col('due', t('Due date'), 'date'), col('status', t('Status'), 'text', 16), col('blocking', t('Blocking reason'), 'text', 30), col('x3', 'X3', 'text', 12),
  ], invoices.filter((i) => (filter === 'all' || i.status === filter) && visible(i.projectCode)).map((i) => ({
    number: i.number, supplier: i.supplier, po: i.poNumber ?? '', receipt: i.receiptNumber ?? '', project: i.projectCode ?? '', currency: i.currency, amount: i.amountEur, invoiced: i.invoicedAmountEur,
    poAmount: i.poAmountEur, grAmount: i.receiptAmountEur, gap: i.gapEur, matchPo: t(i.matchLabels.po), matchGr: t(i.matchLabels.gr), date: i.invoiceDate, due: i.dueDate,
    status: t(i.statusLabel), blocking: i.blockingReason ? t(i.blockingReason) : '', x3: i.x3ApRef ?? '',
  })));
  const sup = sheet(t('Supplier scorecard'), [
    col('name', t('Supplier'), 'text', 24), col('otd', t('On-time delivery'), 'percent'), col('quality', t('Quality acceptance'), 'percent'), col('ncr', t('NCR rate'), 'percent', 10, { decimals: 1 }),
    col('grade', t('Grade'), 'text', 6), col('openPo', t('Open POs'), 'integer'), col('ncrs', `${t('NCRs this quarter')} (${current})`, 'integer'),
  ], card.rows.map((r) => ({ name: r.name, otd: r.onTimeDeliveryPct / 100, quality: r.qualityAcceptancePct / 100, ncr: r.ncrRatePct / 100, grade: r.grade, openPo: r.openPoCount, ncrs: r.ncrsThisQuarter })));
  const order = tab === 'inv' ? [inv, rfq, quotes, sup] : tab === 'sup' ? [sup, rfq, quotes, inv] : [rfq, quotes, inv, sup];
  return {
    title: t('Sourcing, invoices & suppliers'),
    filters: compact([filter !== 'all' ? `${t('Status')}: ${t(supplierInvoiceStatus.label(filter))}` : null]),
    sheets: order,
  };
}

// ── Purchase orders ──────────────────────────────────────────────────────────────────────────────────────────────────
async function ordersWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const { t } = ctx;
  const data = await getOrdersScreen(ctx.project.code, ctx.viewer.name);
  const s = param(ctx, 'status');
  const status = isPoStatus(s) ? s : null;
  const orders = data.orders.filter((o) => !status || o.status === status);
  // C-9: amounts in the orders' currency — € columns when every order is in euros, else plain numbers with a Currency column.
  const cur = commonCurrency(orders.map((o) => o.currency));
  return {
    title: t('Purchase orders'),
    filters: compact([status ? `${t('Status')}: ${t(poStatus.label(status))}` : null]),
    sheets: [
      sheet(t('Purchase orders'), [
        col('number', t('Order'), 'text', 10), col('supplier', t('Supplier'), 'text', 22), col('status', t('Status'), 'text', 18), col('ordered', t('Order date'), 'date'),
        col('expected', t('Expected'), 'date'), ...(cur ? [] : [col('currency', t('Currency'), 'text', 8)]),
        cur ? moneyCol('value', t('Value'), cur, 'units') : col('value', t('Value'), 'number', undefined, { decimals: 2 }),
        cur ? moneyCol('received', t('Received value'), cur, 'units') : col('received', t('Received value'), 'number', undefined, { decimals: 2 }), col('units', t('Units ordered'), 'number', 8),
        col('receivedUnits', t('Units received'), 'number', 8), col('needed', t('Needed for'), 'text', 30), col('late', t('Late'), 'boolean'), col('terms', t('Delivery terms'), 'text', 24),
        col('x3', 'X3', 'text', 12), col('receipts', t('Goods receipts'), 'text', 18), col('invoices', t('Supplier invoices'), 'text', 18),
      ], orders.map((o) => ({
        number: o.number, supplier: o.supplier, status: t(o.statusLabel), ordered: o.orderedOn, expected: o.expectedOn, currency: o.currency, value: o.valueEur, received: o.receivedValueEur,
        units: o.orderedUnits, receivedUnits: o.receivedUnits, needed: o.neededFor ? `${o.neededFor.code} · ${t(o.neededFor.name)}` : '', late: o.late, terms: t(o.deliveryTerms),
        x3: o.x3Ref ?? '', receipts: (data.receipts[o.number] ?? []).map((r) => r.number).join(' · '), invoices: (data.invoices[o.number] ?? []).map((r) => r.number).join(' · '),
      }))),
      sheet(t('Order lines'), [
        col('number', t('Order'), 'text', 10), col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 34), col('qty', t('Ordered'), 'number', 8), col('received', t('Received'), 'number', 8),
        ...(cur ? [] : [col('currency', t('Currency'), 'text', 8)]),
        cur ? moneyCol('unit', t('Unit price'), cur, 'units') : col('unit', t('Unit price'), 'number', undefined, { decimals: 2 }),
        cur ? moneyCol('total', t('Total'), cur, 'units') : col('total', t('Total'), 'number', undefined, { decimals: 2 }), col('status', t('Part status'), 'text', 14),
      ], orders.flatMap((o) => o.lines.map((l) => ({
        number: o.number, ref: l.ref, name: t(l.name), qty: l.orderedQty, received: l.receivedQty, currency: o.currency, unit: l.unitPriceEur, total: l.totalEur, status: t(l.partStatusLabel),
      })))),
      sheet(t('BOM shortfall'), [col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 34), col('supplier', t('Supplier'), 'text', 20), col('bom', t('BOM quantity'), 'number', 8),
        col('ordered', t('Ordered'), 'number', 8), col('qty', t('Missing'), 'number', 8), col('price', t('List price'), 'money_eur'), col('value', t('Value'), 'money_eur')],
        data.shortfall.lines.map((l) => ({ ref: l.ref, name: t(l.name), supplier: l.supplier ?? '', bom: l.bomQty, ordered: l.orderedQty, qty: l.need, price: l.listPriceEur, value: l.valueEur }))),
    ],
  };
}

/** Purchase order (PDF): supplier, project, dates and terms, the lines with their total, approval and signatures. */
async function poDocument(ctx: ExportContext): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const id = (param(ctx, 'id') ?? '').toUpperCase();
  const o = id ? await getPurchaseOrder(id) : null;
  if (!o || o.projectCode !== ctx.project.code) return null;
  const { t, lang } = ctx;
  const fd = (iso: string | null) => (iso ? formatDate(iso, lang) : t('To confirm'));
  const lines = sheet(t('Lines'), [
    col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 40), col('qty', t('Quantity'), 'number', 9),
    moneyCol('unit', t('Unit price'), o.currency, 'units', 12), moneyCol('total', t('Total'), o.currency, 'units', 13),
  ], o.lines.map((l) => ({ ref: l.ref, name: t(l.name), qty: l.orderedQty, unit: l.unitPriceEur, total: l.totalEur })));
  const draft = o.status === 'draft' || o.status === 'awaiting_approval';
  return {
    title: `${t('Purchase order')} ${o.number}`,
    subtitle: draft ? `${o.supplier} · ${t(o.statusLabel)} — ${t('not yet an order')}` : o.supplier,
    project: projectRef(ctx),
    reference: o.x3Ref ? `${o.number} · X3 ${o.x3Ref}` : o.number,
    date: o.orderedOn ?? todayIso(ctx),
    blocks: [
      { kind: 'fields', columns: 2, items: [
        [t('Supplier'), o.supplier], [t('Status'), t(o.statusLabel)], [t('Order date'), fd(o.orderedOn)], [t('Expected delivery'), fd(o.expectedOn)],
        [t('Delivery terms'), t(o.deliveryTerms)], [t('Needed for'), o.neededFor ? `${o.neededFor.code} · ${t(o.neededFor.name)}` : '—'],
        [t('Requested by'), o.createdBy ?? '—'], [t('Approved by'), o.decidedBy && !draft ? o.decidedBy : '—'],
      ] },
      { kind: 'heading', text: t('Lines') },
      tableBlock(lines, undefined, { name: t('Total excl. VAT'), total: sum(lines.rows, 'total') }),
      { kind: 'spacer', height: 16 },
      { kind: 'signatures', parties: [{ role: t('For Keystone — buyer'), name: (draft ? null : o.decidedBy) ?? undefined }, { role: t('Supplier acknowledgement') }] },
    ],
    // R-046: no price footnote when prices are masked; C-9: an order in another currency states it.
    footnote: ctx.pricesMasked
      ? t('Delivery to the address and terms above; please quote the order number on the delivery note and the invoice.')
      : o.currency === 'EUR'
        ? t('Prices in euros excluding VAT. Delivery to the address and terms above; please quote the order number on the delivery note and the invoice.')
        : `${t('Prices in the order currency excluding VAT')} (${o.currency}). ${t('Delivery to the address and terms above; please quote the order number on the delivery note and the invoice.')}`,
  };
}

// ── Deliveries & goods receipt ───────────────────────────────────────────────────────────────────────────────────────
async function deliveriesWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const { t } = ctx;
  const data = await getDeliveriesScreen(ctx.project.code);
  const status = receiptFilterOf(param(ctx, 'status'));
  const rs = filterReceipts(data.receipts, status);
  return {
    title: t('Deliveries & goods receipt'),
    filters: compact([status ? `${t('Status')}: ${t(receiptStatus.label(status))}` : null]),
    sheets: [
      sheet(t('Goods receipts'), [
        col('number', t('Receipt'), 'text', 10), col('po', t('Purchase order'), 'text', 10), col('supplier', t('Supplier'), 'text', 20), col('status', t('Status'), 'text', 14),
        col('expected', t('Expected'), 'date'), col('received', t('Received on'), 'date'), col('carrier', t('Carrier'), 'text', 16), col('note', t('Delivery note'), 'text', 14),
        col('ordered', t('Ordered'), 'number', 8), col('delivered', t('Delivered'), 'number', 8), col('accepted', t('Accepted'), 'number', 8), col('rejected', t('Rejected'), 'number', 8),
        col('putAway', t('Put-away'), 'text', 26), col('qcBy', t('QC by'), 'text', 16), col('qc', t('QC result'), 'text', 16), col('remarks', t('QC remarks'), 'text', 30),
      ], rs.map((r) => ({
        number: r.number, po: r.poNumber, supplier: r.supplier, status: t(r.statusLabel), expected: r.expectedOn, received: r.receivedOn, carrier: r.carrier ?? '', note: r.supplierDeliveryNote ?? '',
        ordered: r.totals.ordered, delivered: r.totals.delivered, accepted: r.totals.accepted, rejected: r.totals.rejected, putAway: r.putAway ? t(r.putAway) : '', qcBy: r.qc.by ?? '',
        qc: r.qc.result ? t(r.qc.result) : '', remarks: r.qc.remarks ?? '',
      }))),
      sheet(t('Receipt lines'), [
        col('number', t('Receipt'), 'text', 10), col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 34), col('ordered', t('Ordered'), 'number', 8),
        col('delivered', t('Delivered'), 'number', 8), col('accepted', t('Accepted'), 'number', 8), col('rejected', t('Rejected'), 'number', 8), col('location', t('Location'), 'text', 26),
      ], rs.flatMap((r) => r.lines.map((l) => ({ number: r.number, ref: l.ref, name: t(l.name), ordered: l.ordered, delivered: l.delivered, accepted: l.accepted, rejected: l.rejected, location: t(l.location) })))),
      kpiSheet(ctx, [
        { label: t('Open orders to receive'), value: String(data.openOrdersToReceive) },
        { label: t('On-time deliveries'), value: data.onTimePct != null ? `${data.onTimePct}%` : '—' },
      ]),
    ],
  };
}

/** Goods receipt (PDF): the delivery, its lines with ordered / delivered / accepted / rejected, QC and put-away. */
async function receiptDocument(ctx: ExportContext): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const id = (param(ctx, 'id') ?? '').toUpperCase();
  const r = id ? await getReceipt(id) : null;
  if (!r || r.projectCode !== ctx.project.code) return null;
  const { t, lang } = ctx;
  const fd = (iso: string | null) => (iso ? formatDate(iso, lang) : '—');
  const lines = sheet(t('Lines'), [
    col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 34), col('ordered', t('Ordered'), 'number', 9), col('delivered', t('Delivered'), 'number', 9),
    col('accepted', t('Accepted'), 'number', 9), col('rejected', t('Rejected'), 'number', 9), col('location', t('Put-away'), 'text', 24),
  ], r.lines.map((l) => ({ ref: l.ref, name: t(l.name), ordered: l.ordered, delivered: l.delivered, accepted: l.accepted, rejected: l.rejected, location: t(l.location) })));
  return {
    title: `${t('Goods receipt')} ${r.number}`,
    subtitle: `${r.supplier} · ${t('Purchase order')} ${r.poNumber}`,
    project: projectRef(ctx),
    reference: r.number,
    date: r.receivedOn ?? r.expectedOn ?? todayIso(ctx),
    blocks: [
      { kind: 'fields', columns: 2, items: [
        [t('Purchase order'), r.poNumber], [t('Supplier'), r.supplier], [t('Status'), t(r.statusLabel)], [t('Received on'), fd(r.receivedOn)], [t('Expected'), fd(r.expectedOn)],
        [t('Carrier'), r.carrier ?? '—'], [t('Delivery note'), r.supplierDeliveryNote ?? '—'], [t('Received by'), r.receivedBy ?? '—'],
      ] },
      { kind: 'heading', text: t('Lines') },
      tableBlock(lines, undefined, { name: t('Total'), ordered: r.totals.ordered, delivered: r.totals.delivered, accepted: r.totals.accepted, rejected: r.totals.rejected }),
      { kind: 'heading', text: t('Quality check') },
      { kind: 'fields', columns: 3, items: [[t('QC by'), r.qc.by ?? '—'], [t('QC result'), r.qc.result ? t(r.qc.result) : '—'], [t('QC remarks'), r.qc.remarks ?? '—']] },
      ...(r.documents.length ? [{ kind: 'paragraph' as const, text: `${t('Attached documents')}: ${r.documents.join(', ')}`, muted: true }] : []),
      { kind: 'spacer', height: 16 },
      { kind: 'signatures', parties: [{ role: t('Received by'), name: r.receivedBy ?? undefined }, { role: t('Quality control'), name: r.qc.by ?? undefined }, { role: t('Carrier') }] },
    ],
    footnote: t('Quantities in units of the order lines. Rejected quantities are returned to the supplier or held in quarantine.'),
  };
}

// ── Stock & storages ─────────────────────────────────────────────────────────────────────────────────────────────────
async function stockWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const [rows, moves, visible] = await Promise.all([listStock(), listStockMovements({ limit: 1000 }), projectFilter(ctx)]);
  const loc = param(ctx, 'loc');
  const location = loc && rows.some((r) => r.location === loc) ? loc : null;
  const q = (param(ctx, 'q') ?? '').slice(0, 120);
  const shown = filterStockLines(rows, { location, q }).filter((r) => visible(r.reservedForProject));
  const positions: ExportSheet = sheet(t('Stock positions'), [
    col('ref', t('Reference'), 'text', 16), col('name', t('Article'), 'text', 34), col('location', t('Location'), 'text', 28), col('type', t('Location type'), 'text', 18),
    col('onHand', t('On hand'), 'number', 9), col('reserved', t('Reserved'), 'number', 9), col('project', t('Reserved for'), 'text', 10), col('available', t('Available'), 'number', 9),
    col('min', t('Minimum'), 'number', 9), col('belowMin', t('Below minimum'), 'boolean'), col('unit', t('Unit cost'), 'money_eur'), col('value', t('Value'), 'money_eur'),
    col('source', t('Source'), 'text', 8), col('last', t('Last movement'), 'date'),
  ], shown.map((r) => ({
    ref: r.ref, name: t(r.name), location: t(r.location), type: t(r.locationTypeLabel), onHand: r.onHand, reserved: r.reserved, project: r.reservedForProject ?? '', available: r.available,
    min: r.minQty || null, belowMin: r.belowMin, unit: r.unitCostEur, value: r.valueEur, source: r.sourceLabel, last: r.lastMovementOn,
  })));
  return {
    title: t('Stock & storages'),
    filters: compact([filterLine(t('Location'), location ? t(location) : null), filterLine(t('Search'), q)]),
    sheets: [
      positions,
      sheet(t('Movements'), [
        col('when', t('Date'), 'datetime'), col('type', t('Movement'), 'text', 14), col('ref', t('Reference'), 'text', 16), col('qty', t('Quantity'), 'number', 9), col('where', t('Where'), 'text', 50),
        col('who', t('By'), 'text', 16), col('pending', t('Not yet pushed to X3'), 'boolean'),
      ], moves.filter((m) => !q || m.ref.toLowerCase().includes(q.toLowerCase())).map((m) => ({ when: m.occurredAt, type: t(m.typeLabel), ref: m.ref, qty: m.qty, where: t(m.where), who: m.who, pending: m.pendingPush }))),
      kpiSheet(ctx, [
        { label: t('Stock positions'), value: String(shown.length) }, { label: t('Stock value'), value: `${Math.round(sum(positions.rows, 'value'))} €` },
        { label: t('Below minimum'), value: String(shown.filter((r) => r.belowMin).length) },
      ]),
    ],
  };
}

// R-046 (NEW-D2-1): quotes, invoices, order, stock values and prices only for the director, the PMs and procurement — the other
// viewers export the same tables without the euro columns (and the purchase order without its prices).
registerExportProvider({ screen: 'procurement', table: pricedWorkbook(procurementWorkbook), fileBase: () => 'sourcing' });
registerExportProvider({ screen: 'orders', table: pricedWorkbook(ordersWorkbook), fileBase: () => 'purchase-orders', documents: { po: pricedPdf(poDocument) } });
registerExportProvider({ screen: 'deliveries', table: deliveriesWorkbook, documents: { receipt: receiptDocument } });
registerExportProvider({ screen: 'stock', table: pricedWorkbook(stockWorkbook) });
