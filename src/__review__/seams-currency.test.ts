// Throwaway review test (seams): C-9 currencies × R-103 BOM valuation / A-11 last purchase price / R-098 stock issue value.
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { partLastPrices, parts, projects } from '@/server/db/schema';
import { setProjectBudgetRate } from '@/server/dal/currency';
import { setPurchaseOrderCurrency } from '@/server/dal/order-currency';
import { approvePurchaseOrder, createDraftPurchaseOrders, getPurchaseOrder, submitPurchaseOrder } from '@/server/dal/purchasing';
import { projectPartValuation } from '@/server/dal/bom';
import { acceptReceipt, announceDelivery, registerReceipt } from '@/server/dal/deliveries';
import { listStock } from '@/server/dal/stock';

beforeAll(async () => {
  setDb(await openDatabase());
}, 120_000);

describe('currency seams', () => {
  it('a USD order values the BOM and the last purchase price in USD labelled €', async () => {
    const db = await getDb();
    const [hlt] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const [n] = await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand');
    const eurPo = (await getPurchaseOrder(n))!;
    const ref = eurPo.lines[0].ref;
    const eurUnit = eurPo.lines[0].unitPriceEur;
    const before = (await projectPartValuation(hlt.id, [ref])).get(ref)!;
    // Director: 1 USD = 0.5 €; buyer switches the draft to USD (lines × 2), PM approves.
    await setProjectBudgetRate('HLT-026', { currency: 'USD', rate: '0.5' }, 'Marie Lefebvre');
    await setPurchaseOrderCurrency(n, 'USD', 'Fabien Bertrand');
    const usdPo = (await getPurchaseOrder(n))!;
    await submitPurchaseOrder(n, 'Fabien Bertrand');
    await approvePurchaseOrder(n, 'Romain Aubert');
    const after = (await projectPartValuation(hlt.id, [ref])).get(ref)!;
    const out: Record<string, unknown> = { n, ref, eurUnit, usdUnit: usdPo.lines[0].unitPriceEur, currency: usdPo.currency, before, after };
    // Receipt accepted → the part's last purchase price.
    const bl = await announceDelivery('HLT-026', { poNumber: n }, 'Fabien Bertrand');
    await registerReceipt(bl, { carrier: 'Geodis' }, 'Hélène Sauvage');
    await acceptReceipt(bl, { remarks: '' }, 'Gabriel Comte');
    const [pid] = await db.select({ id: parts.id }).from(parts).where(eq(parts.ref, ref));
    const [lp] = await db.select().from(partLastPrices).where(eq(partLastPrices.partId, pid.id));
    out.lastPurchase = lp?.unitPriceEur;
    out.stockUnit = (await listStock()).filter((s) => s.ref === ref).map((s) => [s.location, s.unitCostEur]);
    (await import('node:fs')).writeFileSync('/tmp/claude-0/-home-user-Keystone/daa84d35-0be7-57a3-895a-75069f5e62a4/scratchpad/rv/currency.json', JSON.stringify(out, null, 1));
    expect(usdPo.currency).toBe('USD');
  }, 300_000);
});
