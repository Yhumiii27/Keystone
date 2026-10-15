// E-2a = a / A-11 = a (Delivery 7, R-103) on the seeded database: the BOM line, the assembly roll-up and the revision
// comparison take the project's ordered price (orders Ordered / Partially received / Received; quantity-weighted), else
// the last purchase price, else the catalogue price, and say which; accepting goods updates the last purchase price.
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { partLastPrices, parts, poLines, projects, purchaseOrders, suppliers } from '@/server/db/schema';
import { getProjectAssembly, getProjectBom, getRevisionComparison, projectPartValuation } from './bom';
import { acceptReceipt } from './deliveries';
import { getPartsByRef } from './parts';
import { getStockPosition, listStock } from './stock';

const line = async (ref: string) => (await getProjectBom('HLT-026'))!.lines.find((l) => l.ref === ref)!;

/** An order of HLT-026 for `ref` at `price` (raw insert: the purchasing writers price orders at list or the RFQ quote). */
async function order(number: string, ref: string, qty: number, price: number, status: 'draft' | 'ordered' | 'cancelled' | 'received') {
  const db = await getDb();
  const [[p], [part], [s]] = await Promise.all([
    db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026')),
    db.select({ id: parts.id }).from(parts).where(eq(parts.ref, ref)),
    db.select({ id: suppliers.id }).from(suppliers).limit(1),
  ]);
  const [po] = await db.insert(purchaseOrders).values({
    number, projectId: p.id, supplierId: s.id, status, origin: 'rfq', orderedOn: '2026-09-20', expectedOn: '2026-10-20', deliveryTerms: 'DAP', position: 900 + Number(number.slice(-2)),
  }).returning({ id: purchaseOrders.id });
  await db.insert(poLines).values({ poId: po.id, partId: part.id, orderedQty: qty, receivedQty: 0, unitPriceEur: price, position: 0 });
  return po.id;
}

describe('BOM valuation on the seed (E-2a, R-103)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('each line says its price basis: ordered (seed orders at list), last purchase, catalogue', async () => {
    const bom = (await getProjectBom('HLT-026'))!;
    const of = (ref: string) => bom.lines.find((l) => l.ref === ref)!;
    // CR-RAIL-A100 is on PO-1052 (Partially received): its order price, the catalogue price in the seed.
    expect([of('CR-RAIL-A100').priceSource, of('CR-RAIL-A100').unitPriceEur]).toEqual(['ordered', of('CR-RAIL-A100').listPriceEur]);
    // HST-ROP-28 is not ordered for HLT-026 and has a last purchase price (€9,200 vs €9,600 list).
    expect([of('HST-ROP-28').priceSource, of('HST-ROP-28').unitPriceEur, of('HST-ROP-28').listPriceEur]).toEqual(['last_purchase', 9200, 9600]);
    // FD-DET-OPT is only on PO-1082, awaiting approval: not ordered yet, no last price → catalogue.
    expect([of('FD-DET-OPT').priceSource, of('FD-DET-OPT').unitPriceEur]).toEqual(['catalogue', of('FD-DET-OPT').listPriceEur]);
    for (const l of bom.lines) expect(l.totalEur).toBe(l.unitPriceEur * l.quantity);
    expect(bom.summary.valueEur).toBe(bom.lines.filter((l) => !l.valuedByComponents).reduce((a, l) => a + l.totalEur, 0));
  });

  it('only approved orders count; several ordered lines give the quantity-weighted price; cancelling falls back', async () => {
    const db = await getDb();
    const before = await line('HST-ROP-28');
    const draft = await order('PO-9001', 'HST-ROP-28', 4, 8800, 'draft');
    expect((await line('HST-ROP-28')).priceSource).toBe('last_purchase');
    await db.update(purchaseOrders).set({ status: 'ordered' }).where(eq(purchaseOrders.id, draft));
    expect(await line('HST-ROP-28')).toMatchObject({ priceSource: 'ordered', unitPriceEur: 8800, totalEur: 8800 * before.quantity });
    await order('PO-9002', 'HST-ROP-28', 12, 9200, 'received');
    expect((await line('HST-ROP-28')).unitPriceEur).toBe((4 * 8800 + 12 * 9200) / 16);
    await db.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.number, 'PO-9002'));
    await db.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.id, draft));
    expect(await line('HST-ROP-28')).toMatchObject({ priceSource: 'last_purchase', unitPriceEur: 9200 });
    // Another project's orders never value HLT-026's BOM.
    const [ndc] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'NDC-031'));
    expect((await projectPartValuation(ndc.id, ['HST-ROP-28'])).get('HST-ROP-28')).toEqual({ unitEur: 9200, source: 'last_purchase' });
  });

  it('the tree and the comparison use the same rule; an assembly reads "rollup"', async () => {
    const asm = (await getProjectAssembly('HLT-026'))!;
    expect(asm.rows[0]).toMatchObject({ ref: 'ASM-RMG-250', priceSource: 'rollup', unitCostEur: 720_396 });
    const rope = asm.rows.find((r) => r.ref === 'HST-ROP-28')!;
    expect([rope.priceSource, rope.unitCostEur]).toEqual(['last_purchase', 9200]);
    const cmp = (await getRevisionComparison('HLT-026'))!;
    for (const l of cmp.lines) {
      if (l.unitPriceEur == null) continue;
      // E-2b (R-104): new qty × new price − old qty × old price, both by the same E-2a rule (the same part except on a substitution).
      expect(l.deltaEur).toBe((l.qtyTo ?? 0) * l.unitPriceEur - (l.qtyFrom ?? 0) * l.oldUnitPriceEur!);
      expect(['ordered', 'last_purchase', 'catalogue']).toContain(l.priceSource);
      expect(['ordered', 'last_purchase', 'catalogue']).toContain(l.oldPriceSource);
    }
    const subs = cmp.lines.filter((l) => l.kind === 'substitution').map((l) => [l.oldRef, l.newRef, l.deltaEur]);
    expect(subs).toEqual([['EL-HMI-10', 'EL-HMI-15', 750], ['FD-DET-OPT', 'FD-DET-OPT2', 12]]);
    expect(cmp.totalDeltaEur).toBe(19_942);
  });

  it('accepting goods updates the last purchase price (A-11) — the stock and the BOM read it', async () => {
    const db = await getDb();
    const [part] = await db.select({ id: parts.id }).from(parts).where(eq(parts.ref, 'EL-TRF-2MVA'));
    expect((await getPartsByRef(['EL-TRF-2MVA']))[0].lastPriceEur).toBe(121_500);
    // BL-2026-0521 (PO-1063, the transformer line at the order price €124,000) waits for its quality check.
    expect(await acceptReceipt('BL-2026-0521', { remarks: '' }, 'Gabriel Comte')).toBe('accepted');
    const [stored] = await db.select().from(partLastPrices).where(eq(partLastPrices.partId, part.id));
    expect(stored).toMatchObject({ unitPriceEur: 124_000 });
    expect(stored.purchasedOn).toMatch(/^2026-\d\d-\d\d$/);
    expect(stored.supplierId).toBeTruthy();
    expect((await getPartsByRef(['EL-TRF-2MVA']))[0].lastPriceEur).toBe(124_000);
    const pos = (await listStock()).find((s) => s.ref === 'EL-TRF-2MVA')!;
    expect((await getStockPosition(pos.id))!.unitCostEur).toBe(124_000);
    // A later purchase already recorded is kept.
    await db.update(partLastPrices).set({ unitPriceEur: 119_000, purchasedOn: '2027-01-15' }).where(and(eq(partLastPrices.partId, part.id)));
    expect((await getPartsByRef(['EL-TRF-2MVA']))[0].lastPriceEur).toBe(119_000);
  });
});
