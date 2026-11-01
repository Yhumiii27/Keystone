// R-208 (K-208 alt1): rule-based drift forecast — value tests.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from './clock';
import { driftAlert, evmFinish, forecastDrift, monteCarloCurrent, tcpiOf, type DriftActivity, type DriftInput } from './drift-forecast';

const today = DEMO_TODAY_ISO; // Fri 25 Sep 2026
const act = (code: string, extra: Partial<DriftActivity> = {}): DriftActivity => ({
  code, name: code, complete: false, inProgress: false, critical: false, totalFloat: 10, start: '2026-10-01', finish: '2026-10-20', budget: 100, eac: 100, ...extra,
});
const base: DriftInput = {
  dataDate: today,
  currentFinish: '2026-12-18',
  targetFinish: '2026-12-18',
  evm: { bac: 1000, ev: 500, ac: 500, pv: 500, cpi: 1, spi: 1, progress: 0.5 },
  activities: [act('A1'), act('A2', { critical: true, totalFloat: 0 })],
  milestones: [],
  currentFloat: 0,
  previousFloat: 0,
  openCommitmentKeur: 120,
  contingencyLeftKeur: 50,
  monteCarlo: null,
};

describe('helpers', () => {
  it('earned-value finish: the time left stretched by 1 / SPI (never shortened)', () => {
    // 84 days to 18 Dec; SPI 0.8 → 105 days → 8 Jan 2027.
    expect(evmFinish(today, '2026-12-18', 0.8)).toBe('2027-01-08');
    expect(evmFinish(today, '2026-12-18', 1.2)).toBe('2026-12-18');
    expect(evmFinish(today, null, 0.8)).toBeNull();
    expect(evmFinish(today, '2026-12-18', null)).toBeNull();
  });
  it('TCPI', () => {
    expect(tcpiOf({ bac: 1000, ev: 500, ac: 600 })).toBe(1.25);
    expect(tcpiOf({ bac: 1000, ev: 500, ac: 1000 })).toBeNull();
  });
  it('a Monte-Carlo run is current when unchanged and at most 30 days old', () => {
    const mc = { dataDate: today, stale: false, p80Finish: '2027-01-15', p80Cost: 1100, probOnTarget: 0.3, probWithinBudget: 0.4, drivers: [] };
    expect(monteCarloCurrent(mc, today)).toBe(true);
    expect(monteCarloCurrent({ ...mc, stale: true }, today)).toBe(false);
    expect(monteCarloCurrent({ ...mc, dataDate: '2026-08-14' }, today)).toBe(false);
    expect(monteCarloCurrent(null, today)).toBe(false);
  });
});

describe('forecastDrift (R-208)', () => {
  it('on plan: no slip, no overrun; medium confidence without Monte-Carlo; suggests running it', () => {
    const f = forecastDrift(base);
    expect(f.finish).toMatchObject({ date: '2026-12-18', slipDays: 0, method: 'schedule' });
    expect(f.cost).toMatchObject({ eac: 1000, overrunKeur: 0, method: 'cpi', tcpi: 1 });
    expect(f.confidence).toBe('medium');
    expect(f.reasons.map((r) => r.code)).toEqual(['mc_missing']);
    expect(f.suggestions).toEqual([{ rule: 'mc_run', severity: 'low', targets: [] }]);
    expect(driftAlert(f)).toBe(false);
  });

  it('SPI < 0.9 on the critical path: composite EAC, EVM finish, resequencing on the critical activities', () => {
    const f = forecastDrift({
      ...base,
      evm: { bac: 1000, ev: 400, ac: 500, pv: 500, cpi: 0.8, spi: 0.8, progress: 0.4 },
      activities: [act('A1'), act('A2', { critical: true, totalFloat: 0, inProgress: true }), act('A3', { critical: true, totalFloat: -2 }), act('A4', { eac: 160 })],
    });
    expect(f.finish).toMatchObject({ date: '2027-01-08', slipDays: 21, method: 'evm' });
    // AC + (BAC − EV) / (CPI × SPI) = 500 + 600 / 0.64 ≈ 1437.5 (0.8 × 0.8 is just above 0.64 in floating point → 1437).
    expect(f.cost).toMatchObject({ eac: 1437, overrunKeur: 437, overrunShare: 0.437, method: 'composite', tcpi: 1.2 });
    expect(f.confidence).toBe('low');
    const rules = Object.fromEntries(f.suggestions.map((s) => [s.rule, s]));
    expect(rules.spi_critical).toEqual({ rule: 'spi_critical', severity: 'high', targets: ['A2', 'A3'], value: 0.8 });
    expect(rules.cpi_review).toEqual({ rule: 'cpi_review', severity: 'high', targets: ['A4'], value: 120 });
    expect(rules.tcpi_reestimate).toMatchObject({ severity: 'medium', value: 1.2 });
    expect(rules.contingency_short).toEqual({ rule: 'contingency_short', severity: 'high', targets: [], value: 387 });
    expect(f.suggestions.at(-1)!.severity).toBe('low');
    expect(f.reasons.map((r) => r.code)).toEqual(['spi_low', 'cpi_low', 'tcpi_high', 'eac_over_bac', 'mc_missing']);
    expect(driftAlert(f)).toBe(true);
  });

  it('CPI between 0.9 and 0.95: medium review', () => {
    const f = forecastDrift({ ...base, evm: { ...base.evm!, cpi: 0.93 } });
    expect(f.suggestions.find((s) => s.rule === 'cpi_review')).toMatchObject({ severity: 'medium', targets: [] });
    expect(f.cost).toMatchObject({ eac: 1075, method: 'cpi' });
  });

  it('float exhausted on milestones, negative float, float eroding', () => {
    const f = forecastDrift({
      ...base,
      currentFinish: '2027-01-11',
      currentFloat: -6,
      previousFloat: 2,
      activities: [act('A1', { critical: true, totalFloat: -6 }), act('A2', { critical: true, totalFloat: -1 }), act('A9', { complete: true, critical: true, totalFloat: null })],
      milestones: [
        { name: 'FAT', status: 'at_risk', floatDays: 0 },
        { name: 'Handover', status: 'late', floatDays: -6 },
        { name: 'Kick-off', status: 'done', floatDays: null },
        { name: 'SAT', status: 'on_track', floatDays: 12 },
      ],
    });
    expect(f.finish).toMatchObject({ date: '2027-01-11', slipDays: 24, method: 'schedule' });
    const rules = Object.fromEntries(f.suggestions.map((s) => [s.rule, s]));
    expect(rules.milestone_float).toEqual({ rule: 'milestone_float', severity: 'high', targets: ['FAT', 'Handover'] });
    expect(rules.negative_float).toEqual({ rule: 'negative_float', severity: 'high', targets: ['A1', 'A2'], value: -6 });
    expect(rules.float_eroding).toEqual({ rule: 'float_eroding', severity: 'medium', targets: [], value: 8 });
    expect(f.reasons.map((r) => r.code)).toEqual(['schedule_late', 'float_negative', 'float_eroding', 'milestones_late', 'mc_missing']);
    expect(f.reasons.find((r) => r.code === 'milestones_late')!.names).toEqual(['Handover']);
  });

  it('a current Monte-Carlo run: P80 counts, its drivers are named, confidence high', () => {
    const mc = { dataDate: today, stale: false, p80Finish: '2027-02-05', p80Cost: 1180, probOnTarget: 0.12, probWithinBudget: 0.35, drivers: ['R-03', 'A1250', 'A1320', 'A1410'] };
    const f = forecastDrift({ ...base, evm: { ...base.evm!, progress: 0.62 }, monteCarlo: mc });
    expect(f.finish).toMatchObject({ date: '2027-02-05', slipDays: 49, method: 'monte_carlo', estimates: { schedule: '2026-12-18', evm: '2026-12-18', monte_carlo: '2027-02-05' } });
    expect(f.cost).toMatchObject({ eac: 1180, overrunKeur: 180, method: 'monte_carlo', estimates: { cpi: 1000, monte_carlo: 1180 } });
    // Progress 62 % and a current run → high; the estimates disagree by 49 days → medium.
    expect(f.confidence).toBe('medium');
    const rules = Object.fromEntries(f.suggestions.map((s) => [s.rule, s]));
    expect(rules.mc_drivers).toEqual({ rule: 'mc_drivers', severity: 'high', targets: ['R-03', 'A1250', 'A1320'], value: 0.12 });
    expect(rules.mc_budget).toEqual({ rule: 'mc_budget', severity: 'medium', targets: [], value: 0.35 });
    expect(rules.mc_run).toBeUndefined();
    // Agreeing estimates → high.
    const agree = forecastDrift({ ...base, evm: { ...base.evm!, progress: 0.62 }, monteCarlo: { ...mc, p80Finish: '2026-12-24', p80Cost: 1020, probOnTarget: 0.7, probWithinBudget: 0.6 } });
    expect(agree.confidence).toBe('high');
    // A stale run is ignored and asked again.
    const stale = forecastDrift({ ...base, monteCarlo: { ...mc, stale: true } });
    expect(stale.finish.method).toBe('schedule');
    expect(stale.suggestions.map((s) => s.rule)).toContain('mc_rerun');
    expect(stale.reasons.map((r) => r.code)).toContain('mc_stale');
  });

  it('no earned value: schedule only, low confidence', () => {
    const f = forecastDrift({ ...base, evm: null, targetFinish: null });
    expect(f.finish).toMatchObject({ date: '2026-12-18', slipDays: null });
    expect(f.cost).toMatchObject({ eac: null, overrunKeur: null, bac: null });
    expect(f.confidence).toBe('low');
    expect(f.reasons[0]).toEqual({ code: 'no_evm' });
  });

  it('early progress is flagged', () => {
    const f = forecastDrift({ ...base, evm: { ...base.evm!, progress: 0.08 } });
    expect(f.reasons[0]).toEqual({ code: 'early_progress', value: 8 });
    expect(f.confidence).toBe('low');
  });
});
