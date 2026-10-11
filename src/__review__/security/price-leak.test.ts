import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { buildExportContext, runExport } from '@/server/export/run';
import { readXlsx } from '@/server/export/xlsx';
import { setProjectBudgetRate } from '@/server/dal/currency';
import { setPurchaseOrderCurrency } from '@/server/dal/order-currency';
import { getOrdersScreen } from '@/server/dal/orders';
import { createDraftPurchaseOrders } from '@/server/dal/purchasing';
import { pdfTextLines } from '@/server/export/test/pdf-text';
import '@/server/export/providers';

const NOW = new Date('2026-10-09T08:00:00Z');
const ctxOf = (screen: string, role: RoleKey, query: string) =>
  buildExportContext({ screen, viewer: PERSONA_BY_ROLE[role], lang: 'en', params: new URLSearchParams(query), now: NOW });

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-046 price masking with a non-EUR order', () => {
  it('quality exports orders after one draft PO moved to USD', async () => {
    const before = await readXlsx((await runExport(await ctxOf('orders', 'quality', 'code=HLT-026'), 'xlsx')).body);
    console.log('BEFORE header', JSON.stringify(before[0].rows[0]));
    await setProjectBudgetRate('HLT-026', { currency: 'USD', rate: '0.9' }, 'Romain Aubert');
    console.log('created', await createDraftPurchaseOrders('HLT-026', 'Romain Aubert'));
    const data = await getOrdersScreen('HLT-026', 'Romain Aubert');
    const draft = data.orders.find((o) => o.status === 'draft');
    console.log('draft', draft?.number, data.orders.map((o) => `${o.number}:${o.status}:${o.currency}`).join(' '));
    expect(draft).toBeTruthy();
    await setPurchaseOrderCurrency(draft!.number, 'USD', 'Romain Aubert');
    const after = await readXlsx((await runExport(await ctxOf('orders', 'quality', 'code=HLT-026'), 'xlsx')).body);
    console.log('AFTER header', JSON.stringify(after[0].rows[0]));
    console.log('AFTER row1', JSON.stringify(after[0].rows[1]));
    console.log('AFTER lines header', JSON.stringify(after[1].rows[0]), JSON.stringify(after[1].rows[1]));
    const csv = new TextDecoder().decode((await runExport(await ctxOf('orders', 'member', 'code=HLT-026'), 'csv')).body);
    console.log('member CSV', csv.split('\r\n').slice(0, 3).join('\n'));
    const f = await runExport(await ctxOf('orders', 'quality', `code=HLT-026&variant=po&id=${draft!.number}`), 'pdf', { compressPdf: false });
    console.log('PDF', pdfTextLines(f.body).filter((l) => /\d/.test(l)).slice(0, 40).join(' | '));
  }, 60_000);
});
