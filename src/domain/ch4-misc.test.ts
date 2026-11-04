// Chapter 4 "misc" rules (pure): forced stage change validation (L-1), the
// spares purchase order proposal (E-3).
import { describe, expect, it } from 'vitest';
import { DEFAULT_REVERT_REASON, isForcedStageDecider, revertBlocker, revertReason } from './forced-stage';
import { groupBySupplier, isPreselected, sparesOrderValue, suggestedSpareQty, validateSparesOrder, type SpareOrderCandidate } from './spares-order';

describe('forced stage changes (L-1 default)', () => {
  it('the portfolio director decides; nobody else', () => {
    expect((['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const).filter(isForcedStageDecider)).toEqual(['director']);
  });

  it('Reject reverts only while the forced move is the last one and the project stands in that stage', () => {
    const forced = { fromStage: 'approvisionnements', toStage: 'fabrication_assemblage', seq: 7 };
    expect(revertBlocker(forced, { stage: 'fabrication_assemblage', lastSeq: 7 })).toBeNull();
    expect(revertBlocker(forced, { stage: 'expedition', lastSeq: 8 })).toBe('moved_on');
    expect(revertBlocker(forced, { stage: 'fabrication_assemblage', lastSeq: 9 })).toBe('moved_on');
    expect(revertBlocker({ ...forced, fromStage: null }, { stage: 'fabrication_assemblage', lastSeq: 7 })).toBe('no_previous');
  });

  it('the revert row carries the comment, else the default reason', () => {
    expect(revertReason('  Client has not paid M3  ')).toBe('Client has not paid M3');
    expect(revertReason('')).toBe(DEFAULT_REVERT_REASON);
    expect(revertReason(null)).toBe('Forced stage change rejected by the portfolio director');
    expect(revertReason('x'.repeat(600))).toHaveLength(500);
  });
});

describe('spares purchase order (E-3 default)', () => {
  const c = (x: Partial<SpareOrderCandidate>): SpareOrderCandidate => ({
    ref: 'CR-WHL-630', name: 'Crane wheel', kind: 'PU', supplier: 'Halvorsen Cranes', recommendedQty: 8, inStock: 0, onOrder: 0, unitPriceEur: 2090, leadWeeks: 10,
    status: 'validated', underChange: false, ...x,
  });

  it('suggests the quantity that tops the stock up to the recommended quantity, net of open spares orders', () => {
    expect(suggestedSpareQty(c({}))).toBe(8);
    expect(suggestedSpareQty(c({ recommendedQty: 4, inStock: 2 }))).toBe(2);
    expect(suggestedSpareQty(c({ recommendedQty: 4, inStock: 2, onOrder: 1 }))).toBe(1);
    expect(suggestedSpareQty(c({ recommendedQty: 8, inStock: 60 }))).toBe(0);
    expect(suggestedSpareQty(c({ recommendedQty: 2.5, inStock: 0 }))).toBe(3);
  });

  it('pre-selects missing lines with a supplier and no open ECO', () => {
    expect(isPreselected(c({}))).toBe(true);
    expect(isPreselected(c({ inStock: 8 }))).toBe(false);
    expect(isPreselected(c({ supplier: null }))).toBe(false);
    expect(isPreselected(c({ underChange: true }))).toBe(false);
  });

  it('validates the lines kept and groups them per supplier', () => {
    const cands = [c({}), c({ ref: 'HST-MOT-160', supplier: 'ABB', unitPriceEur: 27900 }), c({ ref: 'EL-VFD-200', supplier: 'ABB', unitPriceEur: 13600 }), c({ ref: 'X-NOSUP', supplier: null })];
    const v = validateSparesOrder([{ ref: 'HST-MOT-160', qty: 2 }, { ref: 'CR-WHL-630', qty: 8 }, { ref: 'EL-VFD-200', qty: 1 }], cands);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(groupBySupplier(v.lines).map((g) => [g.supplier, g.lines.map((l) => `${l.ref}×${l.qty}@${l.unitPriceEur}`)])).toEqual([
      ['ABB', ['HST-MOT-160×2@27900', 'EL-VFD-200×1@13600']],
      ['Halvorsen Cranes', ['CR-WHL-630×8@2090']],
    ]);
    expect(sparesOrderValue(v.lines)).toBe(2 * 27900 + 13600 + 8 * 2090);
    const err = (raw: unknown) => {
      const r = validateSparesOrder(raw, cands);
      return r.ok ? null : r.error;
    };
    expect(err([])).toBe('Select at least one line to order');
    expect(err('x')).toBe('Select at least one line to order');
    expect(err([{ ref: 'NOPE', qty: 1 }])).toBe('This line is not in the list any more');
    expect(err([{ ref: 'CR-WHL-630', qty: 1 }, { ref: 'CR-WHL-630', qty: 2 }])).toBe('This line is not in the list any more');
    expect(err([{ ref: 'X-NOSUP', qty: 1 }])).toBe('This part has no preferred supplier');
    expect(err([{ ref: 'CR-WHL-630', qty: 0 }])).toBe('Enter a whole quantity of at least 1');
    expect(err([{ ref: 'CR-WHL-630', qty: 1.5 }])).toBe('Enter a whole quantity of at least 1');
    expect(err([{ ref: 'CR-WHL-630', qty: '3' }])).toBe('Enter a whole quantity of at least 1');
    expect(err([{ ref: 'CR-WHL-630', qty: 10_000 }])).toBe('Enter a whole quantity of at least 1');
  });
});
