// R-188 (DIG-PRODI ±50 % → ±30 % → +10/−5 %, Arche K-03): estimate classes, ranges, the uncertainty gap, the stage defaults,
// a budget's class and the firm-offer rule.
import { describe, expect, it } from 'vitest';
import { STAGES } from '@/server/db/codes';
import {
  ESTIMATE_CLASSES, ESTIMATE_CLASS_RANGE, FIRM_OFFER_CLASS_MESSAGE, budgetEstimate, estimateRange, isEstimateClass, legacyBaselineClass, meetsEstimateClass, offerClassError,
  stageEstimateClass, uncertaintyGap, uncertaintyTotals, workingEstimateClass,
} from './estimate-class';

describe('classes and ranges', () => {
  it('has the DIG-PRODI bounds: E50 ±50 %, E30 ±30 %, E10 +10 / −5 %', () => {
    expect(ESTIMATE_CLASSES).toEqual(['E50', 'E30', 'E10']);
    expect(ESTIMATE_CLASS_RANGE).toEqual({ E50: { lowPct: -50, highPct: 50 }, E30: { lowPct: -30, highPct: 30 }, E10: { lowPct: -5, highPct: 10 } });
  });

  it('computes low / central / high', () => {
    expect(estimateRange(4800, 'E10')).toEqual({ low: 4560, central: 4800, high: 5280 });
    expect(estimateRange(2200, 'E50')).toEqual({ low: 1100, central: 2200, high: 3300 });
    expect(estimateRange(5100, 'E30')).toEqual({ low: 3570, central: 5100, high: 6630 });
    expect(estimateRange(123.4, 'E10')).toEqual({ low: 117.2, central: 123.4, high: 135.7 });
  });

  it('gives the uncertainty gap as high − low', () => {
    expect(uncertaintyGap(1000, 'E50')).toBe(1000);
    expect(uncertaintyGap(1000, 'E30')).toBe(600);
    expect(uncertaintyGap(1000, 'E10')).toBe(150);
  });

  it('ranks the classes by precision', () => {
    expect(meetsEstimateClass('E10', 'E30')).toBe(true);
    expect(meetsEstimateClass('E30', 'E30')).toBe(true);
    expect(meetsEstimateClass('E50', 'E30')).toBe(false);
    expect(meetsEstimateClass(null, 'E50')).toBe(false);
    expect(isEstimateClass('E10')).toBe(true);
    expect(isEstimateClass('E20')).toBe(false);
    expect(isEstimateClass(10)).toBe(false);
  });
});

describe('default class by stage', () => {
  it('proposes E50 at Initiative, E30 at APS, E10 from APD on when a version is frozen', () => {
    expect(stageEstimateClass('initiative')).toBe('E50');
    expect(stageEstimateClass('aps')).toBe('E30');
    expect(stageEstimateClass('apd')).toBe('E10');
    for (const s of STAGES.filter((x) => (x.seq ?? 99) >= 3)) expect(stageEstimateClass(s.code)).toBe('E10');
  });

  it('classes a working budget E50 / E30 in the pipeline and leaves it unclassified from Études on', () => {
    expect(workingEstimateClass('initiative')).toBe('E50');
    expect(workingEstimateClass('aps')).toBe('E30');
    expect(workingEstimateClass('apd')).toBe('E30');
    expect(workingEstimateClass('etudes')).toBeNull();
    expect(workingEstimateClass('approvisionnements')).toBeNull();
  });

  it('classes the baselines recorded before R-188 (0048 backfill)', () => {
    expect(legacyBaselineClass('BL1', 'fabrication_assemblage')).toBe('E10');
    expect(legacyBaselineClass('BL2', 'apd')).toBe('E10');
    expect(legacyBaselineClass('BL0', 'fabrication_assemblage')).toBe('E30');
    expect(legacyBaselineClass('BL0', 'initiative')).toBe('E50');
    expect(legacyBaselineClass('Import 3', 'etudes')).toBeNull();
  });

  it('takes the current baseline class first, else the working class', () => {
    expect(budgetEstimate('fabrication_assemblage', { code: 'BL1', estimateClass: 'E10' })).toEqual({ estimateClass: 'E10', source: 'baseline', baselineCode: 'BL1' });
    expect(budgetEstimate('initiative', null)).toEqual({ estimateClass: 'E50', source: 'stage', baselineCode: null });
    expect(budgetEstimate('approvisionnements', null)).toEqual({ estimateClass: null, source: 'none', baselineCode: null });
    // An unclassified current baseline is not replaced by the stage default.
    expect(budgetEstimate('aps', { code: 'BL0', estimateClass: null })).toEqual({ estimateClass: null, source: 'none', baselineCode: 'BL0' });
  });
});

describe('firm offer', () => {
  it('requires E10 for a firm offer (K-03)', () => {
    expect(offerClassError('offre_ferme', 'E10')).toBeNull();
    expect(offerClassError('offre_ferme', 'E30')).toBe(FIRM_OFFER_CLASS_MESSAGE);
    expect(offerClassError('offre_ferme', null)).toBe(FIRM_OFFER_CLASS_MESSAGE);
  });

  it('accepts any class for an indicative answer or a quote, and needs one when priced', () => {
    expect(offerClassError('indicatif', 'E50')).toBeNull();
    expect(offerClassError('devis', 'E30')).toBeNull();
    expect(offerClassError('devis', null)).toBe('A priced answer needs an estimate class');
    expect(offerClassError('qualification', null, false)).toBeNull();
  });
});

describe('portfolio uncertainty', () => {
  it('sums high − low of the classified budgets and counts those not at E10', () => {
    expect(uncertaintyTotals([
      { amount: 4800, estimateClass: 'E10' },
      { amount: 2100, estimateClass: 'E10' },
      { amount: 3800, estimateClass: null },
      { amount: 1000, estimateClass: 'E30' },
    ])).toEqual({ gap: 720 + 315 + 600, classified: 7900, notFirm: 2, unclassified: 1 });
    expect(uncertaintyTotals([])).toEqual({ gap: 0, classified: 0, notFirm: 0, unclassified: 0 });
  });
});
