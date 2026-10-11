// C-9 (R-075): currency of a Draft purchase order — the Server Function's gate (read-only, malformed, unknown project or order,
// order of another project, no longer a draft), the currency rule (EUR or the project currency with its budget rate), the line
// prices converted at the budget rate, the euro consolidation (Committed) and the project currency then fixed. In-memory
// database; session and project context mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Fabien Bertrand', canEdit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name }, canEdit: () => viewer.canEdit }),
  getScreenAccess: async () => ({ viewer: { name: viewer.name }, canEdit: viewer.canEdit, outside: false }),
}));

import { revalidatePath } from 'next/cache';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { setProjectBudgetRate } from '@/server/dal/currency';
import { listAudit } from '@/server/dal/notifications';
import { convertUnitPrice } from '@/server/dal/order-currency';
import { getOrdersScreen } from '@/server/dal/orders';
import { getPurchaseOrder } from '@/server/dal/purchasing';
import { createDraftOrdersAction } from './actions';
import { setOrderCurrencyAction } from './currency-actions';
import { ordersView } from './model';

const drawer = async (selected: string, lang: 'en' | 'fr' = 'en') =>
  ordersView({ code: 'HLT-026', data: await getOrdersScreen('HLT-026', viewer.name), filter: null, selected }, makeT(lang), lang).drawer!;

describe('purchase order currency (C-9)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
    expect(await createDraftOrdersAction('HLT-026')).toEqual({ ok: true }); // drafts PO-1100…
  }, 60_000);
  beforeEach(() => {
    viewer.name = 'Fabien Bertrand';
    viewer.canEdit = true;
    vi.mocked(revalidatePath).mockClear();
  });

  it('unit prices convert at the budget rate, to the cent', () => {
    expect([convertUnitPrice(100, 1, 0.92), convertUnitPrice(108.7, 0.92, 1), convertUnitPrice(4700, 1, 1)]).toEqual([108.7, 100, 4700]);
  });

  it('refuses read-only viewers, malformed requests, unknown projects and orders, another project’s order', async () => {
    viewer.canEdit = false;
    expect(await setOrderCurrencyAction('HLT-026', 'PO-1100', 'EUR')).toEqual({ ok: false, error: 'Purchase orders are read-only for you' });
    viewer.canEdit = true;
    for (const [code, po, cur] of [['hlt-026', 'PO-1100', 'EUR'], ['HLT-026', 'X-1', 'EUR'], ['HLT-026', 'PO-1100', 'usd'], ['HLT-026', 'PO-1100', '']])
      expect(await setOrderCurrencyAction(code, po, cur)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await setOrderCurrencyAction('ZZZ-999', 'PO-1100', 'EUR')).toEqual({ ok: false, error: 'Unknown project' });
    expect(await setOrderCurrencyAction('HLT-026', 'PO-9999', 'EUR')).toEqual({ ok: false, error: 'Unknown purchase order' });
    expect(await setOrderCurrencyAction('NDC-031', 'PO-1100', 'EUR')).toEqual({ ok: false, error: 'Unknown purchase order' });
    // PO-1082 is awaiting approval: its currency is fixed.
    expect(await setOrderCurrencyAction('HLT-026', 'PO-1082', 'EUR')).toEqual({ ok: false, error: 'This order is no longer a draft' });
    // A EUR project: no other currency, and the drawer offers none.
    expect(await setOrderCurrencyAction('HLT-026', 'PO-1100', 'USD')).toEqual({ ok: false, error: 'A document is in euros or in the project currency' });
    expect((await drawer('PO-1100')).currency).toEqual({ value: 'EUR', options: ['EUR'], canSet: false });
    // Only the stale "no longer a draft" answer refreshes the screen.
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('a draft moves to the project currency: prices converted, value consolidated in euros; the project currency is then fixed', async () => {
    const before = (await getPurchaseOrder('PO-1100'))!;
    await setProjectBudgetRate('HLT-026', { currency: 'USD', rate: '0.92' }, 'Marie Lefebvre');
    expect((await drawer('PO-1100')).currency).toEqual({ value: 'EUR', options: ['EUR', 'USD'], canSet: true });
    expect(await setOrderCurrencyAction('HLT-026', 'PO-1100', 'GBP')).toEqual({ ok: false, error: 'A document is in euros or in the project currency' });
    expect(await setOrderCurrencyAction('HLT-026', 'PO-1100', 'USD')).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const after = (await getPurchaseOrder('PO-1100'))!;
    expect([after.currency, after.eurRate, after.currencyOptions]).toEqual(['USD', 0.92, ['EUR', 'USD']]);
    expect(after.lines.map((l) => l.unitPriceEur)).toEqual(before.lines.map((l) => convertUnitPrice(l.unitPriceEur, 1, 0.92)));
    // Same value in euros (to the cent per line).
    expect(Math.abs(after.valueEur * 0.92 - before.valueEur)).toBeLessThan(after.lines.reduce((s, l) => s + l.orderedQty, 0) * 0.01);
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Fabien Bertrand', object: 'PO-1100', change: 'currency: EUR → USD · line prices converted at the budget rate' });
    // The drawer: dollars, with the euro equivalent.
    const d = await drawer('PO-1100');
    expect(d.currency).toEqual({ value: 'USD', options: ['EUR', 'USD'], canSet: true });
    expect(d.meta.find((m) => m.k === 'Order value')!.v).toMatch(/^\$[\d.]+k · ≈ €[\d.]+k$|^\$[\d.]+M · ≈ €[\d.]+[kM]$/);
    // Asking for the same currency changes nothing.
    const audits = (await listAudit()).length;
    expect(await setOrderCurrencyAction('HLT-026', 'PO-1100', 'USD')).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(audits);
    // An order in USD: the project currency cannot change any more (its budget rate can).
    await expect(setProjectBudgetRate('HLT-026', { currency: 'GBP', rate: '1.15' }, 'Marie Lefebvre')).rejects.toThrow('Documents of this project are in its currency: it cannot change');
    await expect(setProjectBudgetRate('HLT-026', { currency: 'USD', rate: '0.95' }, 'Marie Lefebvre')).resolves.toEqual({ currency: 'USD', budgetRate: 0.95 });
    expect((await getPurchaseOrder('PO-1100'))!.eurRate).toBe(0.95);
    // Back to EUR (still a draft): converted back at the current rate.
    expect(await setOrderCurrencyAction('HLT-026', 'PO-1100', 'EUR')).toEqual({ ok: true });
    expect((await getPurchaseOrder('PO-1100'))!.currency).toBe('EUR');
  });
});
