// E-2a = a / A-11 = a (Delivery 7, R-103): one valuation rule for the project BOM — the project's ordered price, else the
// last purchase price, else the catalogue price — and the last purchase price kept up to date by the goods received.
import { describe, expect, it } from 'vitest';
import { BOM_PRICE_SOURCE_LABEL, ORDERED_PO_STATUSES, bomLineTotal, bomSummary, bomUnitPrice, isOrderedPoStatus, orderedUnitPrice, replacesLastPrice } from './bom';

describe('BOM valuation (E-2a)', () => {
  it('ordered price first, then the last purchase price, then the catalogue price — with the source', () => {
    expect(bomUnitPrice({ orderedEur: 41.5, lastPurchaseEur: 45, listPriceEur: 48 })).toEqual({ unitEur: 41.5, source: 'ordered' });
    expect(bomUnitPrice({ orderedEur: null, lastPurchaseEur: 45, listPriceEur: 48 })).toEqual({ unitEur: 45, source: 'last_purchase' });
    expect(bomUnitPrice({ orderedEur: null, lastPurchaseEur: null, listPriceEur: 48 })).toEqual({ unitEur: 48, source: 'catalogue' });
    // A zero ordered price (free sample) is still the ordered price.
    expect(bomUnitPrice({ orderedEur: 0, lastPurchaseEur: 45, listPriceEur: 48 })).toEqual({ unitEur: 0, source: 'ordered' });
    expect(Object.values(BOM_PRICE_SOURCE_LABEL)).toEqual(['Ordered price', 'Last purchase price', 'Catalogue price']);
  });

  it('the ordered price is the quantity-weighted mean of the project’s ordered lines', () => {
    expect(orderedUnitPrice([])).toBeNull();
    expect(orderedUnitPrice([{ qty: 100, unitPriceEur: 48 }])).toBe(48);
    expect(orderedUnitPrice([{ qty: 100, unitPriceEur: 48 }, { qty: 50, unitPriceEur: 42 }])).toBe(46);
    expect(orderedUnitPrice([{ qty: 0, unitPriceEur: 99 }])).toBeNull();
    expect(orderedUnitPrice([{ qty: -5, unitPriceEur: 99 }, { qty: 10, unitPriceEur: 40 }])).toBe(40);
  });

  it('only approved orders count: Ordered, Partially received, Received', () => {
    expect(ORDERED_PO_STATUSES).toEqual(['ordered', 'partially_received', 'received']);
    expect(['draft', 'awaiting_approval', 'ordered', 'partially_received', 'received', 'cancelled'].filter((s) => isOrderedPoStatus(s as never))).toEqual(['ordered', 'partially_received', 'received']);
  });

  it('line totals and the BOM value use the valuation price; the prototype figure stays at list price', () => {
    expect(bomLineTotal({ listPriceEur: 48, unitPriceEur: 45, quantity: 10 })).toBe(450);
    expect(bomLineTotal({ listPriceEur: 48, quantity: 10 })).toBe(480);
    const s = bomSummary([
      { quantity: 10, listPriceEur: 48, unitPriceEur: 45, status: 'validated', exportRestriction: null, valuedByComponents: false },
      { quantity: 1, listPriceEur: 1000, unitPriceEur: 900, status: 'validated', exportRestriction: null, valuedByComponents: true },
    ]);
    expect([s.valueEur, s.listValueEur]).toEqual([450, 1480]);
  });

  it('a receipt replaces the last purchase price unless a later purchase is recorded (A-11)', () => {
    expect(replacesLastPrice(null, '2026-09-25')).toBe(true);
    expect(replacesLastPrice({ purchasedOn: null }, '2026-09-25')).toBe(true); // seed price: date unknown
    expect(replacesLastPrice({ purchasedOn: '2026-09-20' }, '2026-09-25')).toBe(true);
    expect(replacesLastPrice({ purchasedOn: '2026-09-25' }, '2026-09-25')).toBe(true);
    expect(replacesLastPrice({ purchasedOn: '2026-10-02' }, '2026-09-25')).toBe(false);
  });
});
