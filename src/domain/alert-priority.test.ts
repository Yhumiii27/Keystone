// S-33 — the ordering rule of the portfolio alerts: class of importance first, then the magnitude, then fixed tie-breaks.
import { describe, expect, it } from 'vitest';
import { ALERT_KIND_ORDER, ALERT_MAGNITUDE_SCALES, alertClass, alertScore, compareAlerts, magnitude, type RankedAlert } from './alert-priority';

describe('S-33 alert priority', () => {
  it('classes: the end date or the contract hit first, the indicators next, the organisation last', () => {
    expect(['off_track', 'critical_slip'].map((k) => alertClass(k as never))).toEqual([1, 1]);
    expect(['cost_overrun', 'billing_late', 'milestone_late', 'risk_forecast', 'supplier_slip'].map((k) => alertClass(k as never))).toEqual([2, 2, 2, 2, 2]);
    expect(alertClass('supplier_slip', { finishImpact: true })).toBe(1);
    expect(alertClass('cost_overrun', { finishImpact: true })).toBe(2);
    expect(['over_allocation', 'approvals_waiting'].map((k) => alertClass(k as never))).toEqual([3, 3]);
  });

  it('magnitude: share of the reference size, 0 to 1', () => {
    expect(magnitude(30, 60)).toBe(0.5);
    expect(magnitude(90, 60)).toBe(1);
    expect(magnitude(0, 60)).toBe(0);
    expect(magnitude(-5, 60)).toBe(0);
    expect(magnitude(null, 60)).toBe(0);
    expect(magnitude(Number.NaN, 60)).toBe(0);
    expect(magnitude(5, 0)).toBe(0);
    expect(ALERT_MAGNITUDE_SCALES).toMatchObject({ criticalSlipDays: 60, offTrackIndexGap: 0.2, costOverrunShare: 0.2, billingLateDays: 60, approvalDays: 30 });
  });

  it('score: the class dominates, the magnitude in thousandths', () => {
    expect(alertScore(1, 0)).toBe(3000);
    expect(alertScore(1, 0.483)).toBe(3483);
    expect(alertScore(2, 1)).toBe(3000);
    expect(alertScore(2, 0.999)).toBeLessThan(alertScore(1, 0.001));
    expect(alertScore(3, 2)).toBe(2000);
    expect(alertScore(3, Number.NaN)).toBe(1000);
  });

  it('order: score, then the former kind order, then the register order, then the key — deterministic', () => {
    const a = (key: string, kind: RankedAlert['kind'], score: number, order = 0): RankedAlert => ({ key, kind, score, order });
    const list = [
      a('people', 'over_allocation', 1600), a('ms-B', 'milestone_late', 2333, 1), a('supplier-A', 'supplier_slip', 2333, 0), a('slip-B', 'critical_slip', 3100, 1),
      a('off-A', 'off_track', 3100, 0), a('slip-A', 'critical_slip', 3100, 0), a('z', 'cost_overrun', 2200, 2), a('y', 'cost_overrun', 2200, 2),
    ];
    const keys = (xs: RankedAlert[]) => [...xs].sort(compareAlerts).map((x) => x.key);
    expect(keys(list)).toEqual(['off-A', 'slip-A', 'slip-B', 'ms-B', 'supplier-A', 'y', 'z', 'people']);
    expect(keys([...list].reverse())).toEqual(keys(list));
    expect(Object.keys(ALERT_KIND_ORDER)).toHaveLength(9);
  });
});
