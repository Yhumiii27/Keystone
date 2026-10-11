// R-046 (NEW-D2-1) × C-9 (R-075): supplier prices stay masked in the exports once a document is in another currency than
// the euro. The director sets HLT-026 to USD with a budget rate, a Draft order moves to USD (the orders then mix currencies, so
// the amounts are plain numbers with a Currency column) and a supplier invoice is in USD: the quality manager (Excel, PDF) and
// a team member (CSV) get no amount — order values, line prices and totals, invoice amounts, of the EUR documents too — while
// procurement still does. Pure masking helpers first (amounts in any currency, price columns of any type). In-memory database.
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { canSeeSupplierPrices } from '@/domain/rights';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { supplierInvoices } from '@/server/db/schema';
import { setProjectBudgetRate } from '@/server/dal/currency';
import { setPurchaseOrderCurrency } from '@/server/dal/order-currency';
import { getOrdersScreen } from '@/server/dal/orders';
import { createDraftPurchaseOrders, getPurchaseOrder, listSupplierInvoices } from '@/server/dal/purchasing';
import { csvCell, displayCell } from '../format';
import { buildExportContext, runExport } from '../run';
import { pdfTextLines } from '../test/pdf-text';
import type { ExportContext, ExportSheet, PdfDocument } from '../types';
import { readXlsx } from '../xlsx';
import { col, pricedPdf, pricedWorkbook, sheet, showsAmount, stripPriceColumns } from './common';
import { amountsCol, moneyCol } from './currency-columns';
import '.';

const NOW = new Date('2026-10-09T08:00:00Z');
const ctxOf = (screen: string, role: RoleKey, query: string, lang: 'fr' | 'en' = 'en') =>
  buildExportContext({ screen, viewer: PERSONA_BY_ROLE[role], lang, params: new URLSearchParams(query), now: NOW });
const sheetsOf = async (screen: string, role: RoleKey, query: string) => readXlsx((await runExport(await ctxOf(screen, role, query), 'xlsx')).body);
const csvOf = async (screen: string, role: RoleKey, query: string) =>
  new TextDecoder().decode((await runExport(await ctxOf(screen, role, query), 'csv')).body).replace(/^﻿/, '').split('\r\n').filter(Boolean);
const pdfOf = async (role: RoleKey, query: string) => pdfTextLines((await runExport(await ctxOf('orders', role, query), 'pdf', { compressPdf: false })).body).join('\n');

/** Headers of amount columns in the orders / sourcing exports (with or without a currency suffix). */
const AMOUNT_HEADER = /^(Value|Received value|Unit price|Total|List price|Best unit price|Amount|Invoiced amount|PO amount|Receipt amount|Gap)\b/;
const amountHeaders = (sheets: { rows: (string | number | boolean | null)[][] }[]) => sheets.flatMap((s) => (s.rows[0] ?? []).map(String).filter((h) => AMOUNT_HEADER.test(h)));

describe('R-046 masking helpers (amounts in any currency)', () => {
  it('a text shows an amount with a currency symbol or an ISO code next to a number', () => {
    for (const v of ['€4,700', '4 700 €', '$1.20M', '4 700 $', '£950', 'CHF 4,700', '450 k CHF', '12 000 USD', '≈ €5.08M', 'AED 1,200'])
      expect(showsAmount(v), v).toBe(true);
    for (const v of ['HLT-026', 'PO-1100', 'USD', 'EUR/USD exposure', 'CAD drawings', 'Net 30', '12', 4700, null])
      expect(showsAmount(v), String(v)).toBe(false);
  });

  it('price columns are dropped whatever their type; text amounts in another currency are masked', () => {
    const s: ExportSheet = sheet('Orders', [
      col('number', 'Order'), col('currency', 'Currency'), amountsCol('value', 'Value', null, 'units'), moneyCol('usd', 'Unit price', 'USD', 'units'),
      moneyCol('eur', 'List price', 'EUR', 'units'), col('qty', 'Quantity', 'number'), col('note', 'Note'),
    ], [{ number: 'PO-1100', currency: 'USD', value: 5108.7, usd: 510.87, eur: 470, qty: 10, note: '$5,109 to commit' }]);
    const out = stripPriceColumns(s);
    expect(out.columns.map((c) => c.key)).toEqual(['number', 'currency', 'qty', 'note']);
    expect(out.rows).toEqual([{ number: 'PO-1100', currency: 'USD', qty: 10, note: '•••' }]);
  });

  it('pricedPdf / pricedWorkbook mask amounts in any currency for a masked viewer only', async () => {
    const lines = sheet('Lines', [col('ref', 'Ref'), moneyCol('unit', 'Unit price', 'USD', 'units')], [{ ref: 'A', unit: 510.87 }]);
    const doc: PdfDocument = {
      title: 'PO', blocks: [
        { kind: 'fields', items: [['Order value', '$5.11k · ≈ €4.70k'], ['Value', 'CHF 4,700'], ['Supplier', 'Halvors']] },
        { kind: 'kpis', items: [{ label: 'Committed', value: '450 k CHF', sub: 'of $1.20M' }, { label: 'Lines', value: '3' }] },
        { kind: 'table', sheet: lines, totals: { ref: 'Total', unit: 510.87 } },
      ],
    };
    const masked = (await pricedPdf(async () => doc)({ pricesMasked: true } as ExportContext))!;
    expect(masked.blocks[0]).toEqual({ kind: 'fields', items: [['Order value', '•••'], ['Value', '•••'], ['Supplier', 'Halvors']] });
    expect(masked.blocks[1]).toEqual({ kind: 'kpis', items: [{ label: 'Committed', value: '•••', sub: '•••' }, { label: 'Lines', value: '3' }] });
    expect(masked.blocks[2]).toEqual({ kind: 'table', sheet: { name: 'Lines', columns: [{ key: 'ref', header: 'Ref' }], rows: [{ ref: 'A' }] } });
    expect(await pricedPdf(async () => doc)({ pricesMasked: false } as ExportContext)).toBe(doc);
    const wb = { title: 'Orders', sheets: [lines] };
    expect((await pricedWorkbook(async () => wb)({ pricesMasked: true } as ExportContext))!.sheets[0].columns.map((c) => c.key)).toEqual(['ref']);
    expect(await pricedWorkbook(async () => wb)({ pricesMasked: false } as ExportContext)).toBe(wb);
  });
});

describe('R-046: supplier prices masked in the exports once HLT-026 has a USD order (C-9)', () => {
  let usd = '';
  beforeAll(async () => {
    setDb(await openDatabase());
    // Drafts from the BOM shortfall (PM), the project in USD at a budget rate (director), one draft moved to USD (PM).
    const drafts = await createDraftPurchaseOrders('HLT-026', 'Romain Aubert');
    expect(drafts.length).toBeGreaterThan(0);
    usd = drafts[0];
    await setProjectBudgetRate('HLT-026', { currency: 'USD', rate: '0.92' }, { name: 'Marie Lefebvre', role: 'director' });
    expect(await setPurchaseOrderCurrency(usd, 'USD', { name: 'Romain Aubert', role: 'pm' })).toBe(true);
    // A supplier invoice received in USD (Sage X3): the sourcing invoices then mix currencies too.
    const inv = (await listSupplierInvoices()).find((i) => i.projectCode === 'HLT-026')!;
    await (await getDb()).update(supplierInvoices).set({ currency: 'USD' }).where(eq(supplierInvoices.number, inv.number));
  }, 60_000);

  it('the roles of the scenario: quality and member masked, procurement not', () => {
    expect([canSeeSupplierPrices('quality'), canSeeSupplierPrices('member'), canSeeSupplierPrices('procurement')]).toEqual([false, false, true]);
  });

  it('Orders Excel: procurement gets the mixed-currency amounts; the quality manager gets the orders without any amount', async () => {
    const po = (await getPurchaseOrder(usd))!;
    expect(po.currency).toBe('USD');
    const full = await sheetsOf('orders', 'procurement', 'code=HLT-026');
    const [orders, lines] = full;
    // Mixed currencies: plain numbers with a Currency column (C-9).
    expect(orders.rows[0]).toEqual(expect.arrayContaining(['Currency', 'Value', 'Received value']));
    expect(lines.rows[0]).toEqual(expect.arrayContaining(['Currency', 'Unit price', 'Total']));
    const row = orders.rows.find((r) => r[0] === usd)!;
    expect(row[orders.rows[0].indexOf('Currency')]).toBe('USD');
    expect(row[orders.rows[0].indexOf('Value')]).toBeCloseTo(po.valueEur, 2);
    // Gabriel Comte (quality): the same orders and lines, no amount column, no amount anywhere (EUR orders included).
    const masked = await sheetsOf('orders', 'quality', 'code=HLT-026');
    expect(amountHeaders(masked)).toEqual([]);
    expect(masked[0].rows.map((r) => r[0])).toEqual(orders.rows.map((r) => r[0]));
    expect(masked[1].rows.length).toBe(lines.rows.length);
    const cells = masked.flatMap((s) => s.rows.slice(1).flat());
    expect(cells.filter((v) => typeof v === 'string' && showsAmount(v))).toEqual([]);
    const prices = new Set([po.valueEur, ...po.lines.flatMap((l) => [l.unitPriceEur, l.totalEur])]);
    expect(cells.filter((v) => typeof v === 'number' && prices.has(v))).toEqual([]);
    const all = (await getOrdersScreen('HLT-026', 'Fabien Bertrand')).orders;
    expect(new Set(all.map((o) => o.currency))).toEqual(new Set(['EUR', 'USD']));
  });

  it('Orders CSV: a team member gets no amount', async () => {
    const po = (await getPurchaseOrder(usd))!;
    const [head, ...rows] = await csvOf('orders', 'member', 'code=HLT-026');
    const [phead] = await csvOf('orders', 'procurement', 'code=HLT-026');
    expect(phead).toMatch(/Value/);
    expect(head).not.toMatch(/Value|Unit price|Total/);
    expect(head).toMatch(/Currency/);
    const text = rows.join('\n');
    expect(text).toContain(usd);
    for (const v of [po.valueEur, po.lines[0].unitPriceEur]) expect(text).not.toContain(csvCell(v, { type: 'number', decimals: 2 }, 'en'));
  });

  it('PO summary PDF of the USD order: procurement sees the prices; the quality manager does not', async () => {
    const po = (await getPurchaseOrder(usd))!;
    const amount = (v: number) => displayCell(v, { type: 'number', decimals: 2 }, 'en');
    const shown = [...po.lines.flatMap((l) => [amount(l.unitPriceEur), amount(l.totalEur)]), amount(po.lines.reduce((a, l) => a + l.totalEur, 0))];
    const p = await pdfOf('procurement', `code=HLT-026&variant=po&id=${usd}`);
    expect(p).toContain('Unit price (USD)');
    for (const s of shown) expect(p).toContain(s);
    const q = await pdfOf('quality', `code=HLT-026&variant=po&id=${usd}`);
    expect(q).toContain(`Purchase order summary ${usd}`);
    expect(q).not.toContain('Unit price');
    expect(q).not.toContain('Total excl. VAT');
    expect(q).not.toContain('(USD)');
    for (const s of shown) expect(q).not.toContain(s);
  });

  it('Sourcing Excel: supplier invoices in mixed currencies keep no amount for a masked viewer', async () => {
    const full = await sheetsOf('procurement', 'procurement', 'tab=inv');
    expect(full[0].rows[0]).toEqual(expect.arrayContaining(['Currency', 'Amount', 'Invoiced amount', 'PO amount']));
    const masked = await sheetsOf('procurement', 'quality', 'tab=inv');
    expect(amountHeaders(masked)).toEqual([]);
    expect(masked[0].rows.length).toBe(full[0].rows.length);
    expect(masked.flatMap((s) => s.rows.slice(1).flat()).filter((v) => typeof v === 'string' && showsAmount(v))).toEqual([]);
  });
});
