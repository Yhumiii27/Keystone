// Delivery 7 seams between lots, on the seeded in-memory database:
//  - C-9 (R-075) × A-11 / E-2a (R-103): an order in the project currency values the BOM, the last purchase price and the
//    stock in euros (its line prices converted at the project's budget rate);
//  - R-098 (SC-5a) × R-073: stock issued to an activity in Keystone (less the returns) reaches AC, CPI and the projects
//    register, and the work package's EAC as well as its actual cost.
import { and, eq, isNotNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { partLastPrices, parts, persons, poLines, projects, purchaseOrders, stockMovements } from '@/server/db/schema';
import { getProjectBom } from './bom';
import { getCostControl } from './cost';
import { setProjectBudgetRate } from './currency';
import { acceptReceipt, announceDelivery, registerReceipt } from './deliveries';
import { getProjectEvm, stockCostEvent } from './evm';
import { setPurchaseOrderCurrency } from './order-currency';
import { getPartsByRef } from './parts';
import { listProjects } from './projects';
import { approvePurchaseOrder, createDraftPurchaseOrders, getPurchaseOrder, submitPurchaseOrder } from './purchasing';
import { applyStockMovement, getStockPosition, listStock } from './stock';

// Writers that re-check the rights take the actor (name and role, R-041).
const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };
const BUYER = { name: 'Fabien Bertrand', role: 'procurement' };

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('C-9 × R-103 — an order in the project currency values the BOM, the last price and the stock in euros', () => {
  it('USD at 0.5 €: KS-PLT-S355 ordered at $2,480 is €1,240 in the BOM, the last purchase price and the stock unit cost', async () => {
    const db = await getDb();
    const ref = 'KS-PLT-S355';
    const bomBefore = (await getProjectBom('HLT-026'))!.lines.find((l) => l.ref === ref)!;
    // The director sets HLT-026 to USD at 1 USD = 0.5 €; the buyer drafts the shortfall orders and moves the plate's to USD.
    await setProjectBudgetRate('HLT-026', { currency: 'USD', rate: '0.5' }, DIRECTOR);
    const drafts = await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand');
    let number = '';
    for (const n of drafts) if ((await getPurchaseOrder(n))!.lines.some((l) => l.ref === ref)) number = n;
    expect(number).toMatch(/^PO-1\d{3}$/);
    const eurLines = (await getPurchaseOrder(number))!.lines;
    expect(eurLines.find((l) => l.ref === ref)!.unitPriceEur).toBe(1240);
    expect(await setPurchaseOrderCurrency(number, 'USD', BUYER)).toBe(true);
    const order = (await getPurchaseOrder(number))!;
    expect([order.currency, order.lines.find((l) => l.ref === ref)!.unitPriceEur]).toEqual(['USD', 2480]);
    // The project manager approves: the BOM's ordered price is in euros (was the raw "€2,480").
    await submitPurchaseOrder(number, 'Fabien Bertrand');
    await approvePurchaseOrder(number, 'Romain Aubert');
    const bom = (await getProjectBom('HLT-026'))!.lines.find((l) => l.ref === ref)!;
    expect([bom.priceSource, bom.unitPriceEur, bom.totalEur]).toEqual(['ordered', 1240, 1240 * bomBefore.quantity]);
    // Goods received and accepted: the catalogue-wide last purchase price and the stock unit cost are in euros (was €2,480).
    const receipt = await announceDelivery('HLT-026', { poNumber: number }, 'Fabien Bertrand');
    await registerReceipt(receipt, {}, 'Fabien Bertrand');
    expect(await acceptReceipt(receipt, { remarks: '' }, 'Gabriel Comte')).toBe('accepted');
    const [part] = await db.select({ id: parts.id }).from(parts).where(eq(parts.ref, ref));
    const [stored] = await db.select().from(partLastPrices).where(eq(partLastPrices.partId, part.id));
    expect(stored.unitPriceEur).toBe(1240);
    expect((await getPartsByRef([ref]))[0].lastPriceEur).toBe(1240);
    for (const s of (await listStock()).filter((x) => x.ref === ref)) {
      expect(s.unitCostEur).toBe(1240);
      expect((await getStockPosition(s.id))!.unitCostEur).toBe(1240);
    }
    // Every accepted line of the order: its dollar price × 0.5, to the cent.
    for (const l of order.lines) {
      const [p] = await db.select({ id: parts.id }).from(parts).where(eq(parts.ref, l.ref));
      const [last] = await db.select({ v: partLastPrices.unitPriceEur }).from(partLastPrices).where(eq(partLastPrices.partId, p.id));
      expect(last.v).toBeCloseTo(Math.round(l.unitPriceEur * 0.5 * 100) / 100, 2);
    }
    // The order's own lines stay in dollars (the receipt value the invoices are matched with is in the order's currency).
    const [po] = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.number, number));
    const [line] = await db.select({ v: poLines.unitPriceEur }).from(poLines).where(and(eq(poLines.poId, po.id), eq(poLines.partId, part.id)));
    expect(line.v).toBe(2480);
  });
});

describe('R-098 × R-073 — stock issues reach AC, CPI and the work package EAC', () => {
  it('a stock movement is a dated cost on its Paris day, in k€; a return is negative', () => {
    expect(stockCostEvent('issue', new Date('2026-09-24T22:30:00Z'), 11_000)).toEqual({ date: '2026-09-25', amount: 11 });
    expect(stockCostEvent('return', new Date('2026-09-25T14:10:00Z'), 2_200)).toEqual({ date: '2026-09-25', amount: -2.2 });
  });

  it('the seed has no valued issue or return (the seeded figures do not move)', async () => {
    const db = await getDb();
    const valued = await db.select({ id: stockMovements.id }).from(stockMovements).where(isNotNull(stockMovements.valueEur));
    expect(valued).toEqual([]);
  });

  it('HLT-026: 500 × FD-SPR-HD issued to A1250 raise AC and lower CPI at the data date, and WP 1.4’s actual and EAC', async () => {
    const before = (await getProjectEvm('HLT-026'))!;
    const wpBefore = (await getCostControl('HLT-026'))!.workPackages.find((w) => w.wbs === '1.4')!;
    expect([before.ac, before.ev, wpBefore.actual, wpBefore.eac]).toEqual([3360, 3006, 816, 1189]);
    // Central warehouse: 900 on hand, 420 of them reserved for HLT-026.
    const line = (await listStock()).find((s) => s.ref === 'FD-SPR-HD' && s.onHand >= 500)!;
    expect(line.unitCostEur).toBe(22);
    await applyStockMovement(line.id, { op: 'issue', qty: 500, projectCode: 'HLT-026', activityCode: 'A1250' }, BUYER);
    // 500 × €22 = 11 k€ on the data date (25 Sep 2026).
    const after = (await getProjectEvm('HLT-026'))!;
    expect([after.ac, after.ev, after.series.ac.at(-1)]).toEqual([3371, 3006, 3371]);
    expect(after.cpi!).toBeCloseTo(3006 / 3371, 6);
    expect(after.cpi!).toBeLessThan(before.cpi!);
    expect(after.series.ac.slice(0, -1)).toEqual(before.series.ac.slice(0, -1));
    const c = (await getCostControl('HLT-026'))!;
    expect(c.ac).toEqual(after.series.ac);
    const wp = c.workPackages.find((w) => w.wbs === '1.4')!;
    expect([wp.actual, wp.eac]).toEqual([827, 1200]);
    // The projects register (actual cost, CPI-driven health) reads the same AC.
    expect((await listProjects()).find((p) => p.code === 'HLT-026')!.actual).toBe(3371);
    // A return naming the activity credits it back: 100 × €22 = 2.2 k€.
    await applyStockMovement(line.id, { op: 'return', qty: 100, projectCode: 'HLT-026', activityCode: 'A1250' }, BUYER);
    expect((await getProjectEvm('HLT-026'))!.ac).toBe(Math.round(3360 + 11 - 2.2));
    const wpBack = (await getCostControl('HLT-026'))!.workPackages.find((w) => w.wbs === '1.4')!;
    expect(wpBack.actual).toBeCloseTo(827 - 2.2, 6);
    expect(wpBack.eac).toBeCloseTo(1200 - 2.2, 6);
  });

  it('a valued movement dated after the data date is not in AC yet', async () => {
    const db = await getDb();
    const [[p], [part], [who]] = await Promise.all([
      db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026')),
      db.select({ id: parts.id }).from(parts).where(eq(parts.ref, 'FD-SPR-HD')),
      db.select({ id: persons.id }).from(persons).limit(1),
    ]);
    const ac = (await getProjectEvm('HLT-026'))!.ac;
    await db.insert(stockMovements).values({
      occurredAt: new Date('2026-10-20T08:00:00Z'), type: 'issue', partId: part.id, qty: 1000, projectId: p.id, whereText: 'test', personName: 'Fabien Bertrand',
      personId: who.id, unitCostEur: 22, valueEur: 22_000, wbsCode: '1.4',
    });
    expect((await getProjectEvm('HLT-026'))!.ac).toBe(ac);
  });
});
