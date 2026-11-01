// R-205 (K-205, K-205b): Monte-Carlo risk analysis — value tests of the pure, seeded simulation.
import { describe, expect, it } from 'vitest';
import { WorkCalendar, type CalendarDef } from './calendar';
import type { CpmActivityInput, CpmInput, CpmLinkInput } from './cpm';
import {
  DEFAULT_RANGE_HIGH, DEFAULT_RANGE_LOW, MC_ITERATIONS_DEFAULT, canEditRiskAnalysis, correlation, defaultRange, defaultRiskDelay, histogram,
  parseActivityRanges, parseIterations, percentile, rangeError, riskOccurrence, sCurve, seedOf, seededRandom, shareAtOrBelow, simulate, triangular,
  type McActivity, type McRisk,
} from './monte-carlo';

// Mon–Fri without public holidays (5 Jan 2026 is a Monday).
const MF: CalendarDef = { code: 'mf', name: 'Mon–Fri', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidaySet: null, useSettingsHolidays: false };
const A = (id: string, duration: number, extra: Partial<CpmActivityInput> = {}): CpmActivityInput => ({ id, duration, ...extra });
const L = (pred: string, succ: string): CpmLinkInput => ({ pred, succ, type: 'FS', lag: 0 });
const net = (activities: CpmActivityInput[], links: CpmLinkInput[]): CpmInput => ({
  dataDate: '2026-01-05', projectCalendar: 'mf', calendars: { mf: new WorkCalendar(MF) }, activities, links,
});
// A → (B ‖ C) → D: C (10 d) drives, B (4 d) has 6 days of float.
const NET = net([A('A', 5), A('B', 4), A('C', 10), A('D', 5)], [L('A', 'B'), L('A', 'C'), L('B', 'D'), L('C', 'D')]);
const COSTS: McActivity[] = [
  { id: 'A', duration: null, cost: null, refCost: 100, actualCost: 0 },
  { id: 'B', duration: null, cost: null, refCost: 50, actualCost: 0 },
  { id: 'C', duration: null, cost: null, refCost: 200, actualCost: 0 },
  { id: 'D', duration: null, cost: null, refCost: 50, actualCost: 0 },
];

describe('ranges and parsing (K-205b)', () => {
  it('default range: −10 % / +25 %', () => {
    expect([DEFAULT_RANGE_LOW, DEFAULT_RANGE_HIGH]).toEqual([0.9, 1.25]);
    expect(defaultRange(20)).toEqual({ min: 18, likely: 20, max: 25 });
    expect(defaultRange(3)).toEqual({ min: 2.7, likely: 3, max: 3.75 });
    expect(defaultRange(-4)).toEqual({ min: 0, likely: 0, max: 0 });
  });
  it('validates a range', () => {
    expect(rangeError({ min: 1, likely: 2, max: 3 }, 10)).toBeNull();
    expect(rangeError({ min: 3, likely: 2, max: 4 }, 10)).toBe('Minimum ≤ most likely ≤ maximum');
    expect(rangeError({ min: -1, likely: 2, max: 4 }, 10)).toBe('The values must be positive or zero');
    expect(rangeError({ min: 1, likely: 2, max: 40 }, 10)).toBe('The maximum is too large');
    expect(rangeError({ min: NaN, likely: 2, max: 4 }, 10)).toBe('Enter three numbers');
  });
  it('parses the range form: empty triple = default, partial triple refused, decimals with a comma', () => {
    expect(parseActivityRanges({ dMin: '8', dLikely: '10', dMax: '15', cMin: '', cLikely: '', cMax: '' })).toEqual({
      ok: true, duration: { min: 8, likely: 10, max: 15 }, cost: null,
    });
    expect(parseActivityRanges({ dMin: '8', dLikely: '', dMax: '15' })).toEqual({ ok: false, error: 'Enter three numbers' });
    expect(parseActivityRanges({ cMin: '90,5', cLikely: '100', cMax: '130' })).toEqual({ ok: true, duration: null, cost: { min: 90.5, likely: 100, max: 130 } });
    expect(parseActivityRanges({ cMin: '120', cLikely: '100', cMax: '130' })).toEqual({ ok: false, error: 'Minimum ≤ most likely ≤ maximum' });
    expect(parseActivityRanges({ dMin: 'x', dLikely: '1', dMax: '2' })).toEqual({ ok: false, error: 'Enter three numbers' });
  });
  it('parses the iterations', () => {
    expect(parseIterations(undefined)).toBe(MC_ITERATIONS_DEFAULT);
    expect(parseIterations('1000')).toBe(1000);
    expect(parseIterations('50')).toBeNull();
    expect(parseIterations('100000')).toBeNull();
    expect(parseIterations('12.5')).toBeNull();
  });
  it('risk defaults: delay = impact × 5 working days, occurrence = P / 5', () => {
    expect([1, 3, 5, 9].map(defaultRiskDelay)).toEqual([5, 15, 25, 25]);
    expect([1, 3, 5].map(riskOccurrence)).toEqual([0.2, 0.6, 1]);
  });
  it('rights: the leads on a project they may edit', () => {
    expect(canEditRiskAnalysis({ lead: true, canEdit: true })).toBe(true);
    expect(canEditRiskAnalysis({ lead: true, canEdit: false })).toBe(false);
    expect(canEditRiskAnalysis({ lead: false, canEdit: true })).toBe(false);
  });
});

describe('random numbers and statistics', () => {
  it('the generator is seeded and in [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seedOf('HLT-026|2026-09-25|2000')).toBe(seedOf('HLT-026|2026-09-25|2000'));
    expect(seedOf('HLT-026|2026-09-25|2000')).not.toBe(seedOf('HLT-026|2026-10-02|2000'));
  });
  it('triangular inverse CDF', () => {
    const r = { min: 10, likely: 20, max: 40 };
    expect(triangular(r, 0)).toBe(10);
    expect(triangular(r, 1)).toBe(40);
    // F(mode) = (20 − 10) / (40 − 10) = 1/3.
    expect(triangular(r, 1 / 3)).toBeCloseTo(20, 10);
    expect(triangular({ min: 5, likely: 5, max: 5 }, 0.7)).toBe(5);
    // Mean of the triangular = (a + b + c) / 3 = 23.33.
    const rnd = seededRandom(7);
    let s = 0;
    for (let i = 0; i < 20000; i++) s += triangular(r, rnd());
    expect(s / 20000).toBeCloseTo(23.33, 0);
  });
  it('percentile, share, correlation, histogram, S-curve', () => {
    const v = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([percentile(v, 0.1), percentile(v, 0.5), percentile(v, 0.8), percentile(v, 0.9), percentile(v, 1)]).toEqual([1, 5, 8, 9, 10]);
    expect(shareAtOrBelow(v, 3)).toBe(0.3);
    expect(shareAtOrBelow(v, 0)).toBe(0);
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBe(0);
    const h = histogram(v, 5);
    expect(h.map((b) => [b.from, b.to, b.count])).toEqual([[0, 2, 1], [2, 4, 2], [4, 6, 2], [6, 8, 2], [8, 10, 2], [10, 12, 1]]);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(10);
    const c = sCurve(v, 5);
    expect(c).toEqual([{ x: 1, p: 0 }, { x: 3, p: 0.25 }, { x: 5, p: 0.5 }, { x: 8, p: 0.75 }, { x: 10, p: 1 }]);
  });
});

describe('simulate (R-205)', () => {
  const base = { network: NET, activities: COSTS, risks: [] as McRisk[], iterations: 500, seed: 1 };

  it('the deterministic plan: CPM finish and Σ costs', () => {
    const r = simulate(base);
    // A 5 d (5–9 Jan), C 10 d (12–23 Jan), D 5 d (26–30 Jan).
    expect(r.deterministic).toEqual({ finish: '2026-01-30', cost: 400 });
    expect(r.inputs).toEqual({ activities: 4, entered: 0, risks: 0, riskCostKeur: 0 });
  });

  it('is deterministic for a seed', () => {
    expect(simulate(base)).toEqual(simulate(base));
    expect(simulate({ ...base, seed: 2 }).finish.mean).not.toBe(simulate(base).finish.mean);
  });

  it('default ranges skew the finish and the cost later and higher than the plan', () => {
    const r = simulate(base);
    // Plan: 25 calendar days after the data date. With −10 % / +25 % the P50 is later, P80 ≥ P50, all within the extremes.
    expect(r.finish.p50).toBeGreaterThan(25);
    expect(r.finish.p80).toBeGreaterThanOrEqual(r.finish.p50);
    expect(r.finish.p90).toBeGreaterThanOrEqual(r.finish.p80);
    // Extremes: −10 % on 20 working days ≈ 18 → 22 days; +25 % = 25 working days → 33 days.
    expect(r.finish.min).toBeGreaterThanOrEqual(21);
    expect(r.finish.max).toBeLessThanOrEqual(33);
    expect(r.finish.dates.p80 >= r.finish.dates.p50).toBe(true);
    // Cost: mean of each factor = (0.9 + 1 + 1.25) / 3 = 1.05 → ≈ 420 k€.
    expect(r.cost.mean).toBeCloseTo(420, -1);
    expect(r.cost.min).toBeGreaterThanOrEqual(360);
    expect(r.cost.max).toBeLessThanOrEqual(500);
    expect(r.finish.histogram.reduce((s, b) => s + b.count, 0)).toBe(500);
    expect(r.cost.histogram.reduce((s, b) => s + b.count, 0)).toBe(500);
    expect(r.finish.curve.at(-1)).toEqual({ x: r.finish.max, p: 1 });
  });

  it('criticality index and tornado: the driving branch dominates', () => {
    const r = simulate(base);
    const crit = Object.fromEntries(r.criticality.map((d) => [d.id, d.criticality]));
    expect(crit).toMatchObject({ A: 1, C: 1, D: 1 });
    // B (6 days of float, at most 5 working days long) is never critical.
    expect(crit.B).toBeUndefined();
    const ids = r.tornado.map((d) => d.id);
    expect(ids[0]).toBe('C');
    expect(ids).not.toContain('B');
    expect(r.tornado.every((d) => d.correlation > 0 && d.kind === 'activity')).toBe(true);
  });

  it('targets: probability of meeting the end date and the budget', () => {
    const r = simulate({ ...base, targetFinish: '2026-01-30', targetCost: 400 });
    expect(r.finish.target).toBe('2026-01-30');
    expect(r.finish.probOnTarget).toBeGreaterThan(0);
    expect(r.finish.probOnTarget).toBeLessThan(0.5);
    expect(r.cost.probWithinTarget).toBeGreaterThan(0);
    expect(r.cost.probWithinTarget).toBeLessThan(0.5);
    const late = simulate({ ...base, targetFinish: '2026-03-31', targetCost: 1000 });
    expect([late.finish.probOnTarget, late.cost.probWithinTarget]).toEqual([1, 1]);
    expect(simulate(base).finish.probOnTarget).toBeNull();
  });

  it('entered ranges replace the default (a fixed range gives the plan)', () => {
    const fixed: McActivity[] = COSTS.map((c) => ({
      ...c, duration: { min: NET.activities.find((a) => a.id === c.id)!.duration, likely: NET.activities.find((a) => a.id === c.id)!.duration, max: NET.activities.find((a) => a.id === c.id)!.duration },
      cost: { min: c.refCost, likely: c.refCost, max: c.refCost },
    }));
    const r = simulate({ ...base, activities: fixed });
    expect([r.finish.min, r.finish.max, r.cost.min, r.cost.max]).toEqual([25, 25, 400, 400]);
    expect(r.inputs.entered).toBe(4);
    expect(r.tornado).toEqual([]);
    // C entered 10 / 15 / 20: the finish moves later.
    const slow = simulate({ ...base, activities: fixed.map((a) => (a.id === 'C' ? { ...a, duration: { min: 10, likely: 15, max: 20 } } : a)) });
    expect(slow.finish.p50).toBeGreaterThan(30);
  });

  it('a risk on an activity is a discrete event: its delay and cost with its probability', () => {
    const fixed: McActivity[] = COSTS.map((c) => {
      const d = NET.activities.find((a) => a.id === c.id)!.duration;
      return { ...c, duration: { min: d, likely: d, max: d }, cost: { min: c.refCost, likely: c.refCost, max: c.refCost } };
    });
    const risk: McRisk = { id: 'R-01', activityId: 'C', probability: 0.4, delayDays: 10, costKeur: 60 };
    const r = simulate({ ...base, activities: fixed, risks: [risk], iterations: 2000 });
    // Either the plan (25 days, 400 k€) or +10 working days (39 days, 460 k€).
    expect(new Set(r.finish.histogram.filter((b) => b.count).map((b) => b.count)).size).toBeGreaterThan(0);
    expect([r.finish.min, r.finish.max]).toEqual([25, 39]);
    expect([r.cost.min, r.cost.max]).toEqual([400, 460]);
    expect(r.risks[0].occurrence).toBeCloseTo(0.4, 1);
    expect(r.finish.p50).toBe(25);
    expect(r.finish.p80).toBe(39);
    expect(r.inputs).toMatchObject({ risks: 1, riskCostKeur: 60 });
    // The tornado names the risk: its occurrence alone moves the finish.
    expect(r.tornado.map((d) => [d.id, d.kind])).toEqual([['R-01', 'risk']]);
    expect(r.tornado[0].correlation).toBeCloseTo(1, 5);
    // A risk on B (6 days of float) with a 5-day delay never moves the finish; one without activity adds its cost only.
    const absorbed = simulate({ ...base, activities: fixed, risks: [{ ...risk, activityId: 'B', delayDays: 5 }, { id: 'R-02', activityId: null, probability: 1, delayDays: 30, costKeur: 10 }] });
    expect([absorbed.finish.min, absorbed.finish.max]).toEqual([25, 25]);
    expect(absorbed.cost.min).toBe(410);
  });

  it('progress: a completed activity is fixed, an activity in progress varies on its remaining work only', () => {
    const progressed = net(
      [A('A', 5, { actualStart: '2025-12-29', actualFinish: '2026-01-02' }), A('C', 10, { actualStart: '2026-01-02', percentComplete: 50 }), A('D', 5)],
      [L('A', 'C'), L('C', 'D')],
    );
    const costs: McActivity[] = [
      { id: 'A', duration: null, cost: null, refCost: 100, actualCost: 100 },
      { id: 'C', duration: null, cost: null, refCost: 200, actualCost: 100 },
      { id: 'D', duration: null, cost: null, refCost: 50, actualCost: 0 },
    ];
    const r = simulate({ network: progressed, activities: costs, risks: [], iterations: 400, seed: 3 });
    // C: 5 days left from the data date (5–9 Jan), D 12–16 Jan.
    expect(r.deterministic).toEqual({ finish: '2026-01-16', cost: 350 });
    expect(r.inputs.activities).toBe(2);
    // Cost: 200 spent + (100 + 50) × factor ∈ [0.9, 1.25].
    expect(r.cost.min).toBeGreaterThanOrEqual(335);
    expect(r.cost.max).toBeLessThanOrEqual(387.5);
    expect(r.criticality.find((d) => d.id === 'A')).toBeUndefined();
  });

  it('runs 2 000 iterations of a 120-activity network in a few seconds', () => {
    const acts: CpmActivityInput[] = [];
    const links: CpmLinkInput[] = [];
    for (let i = 0; i < 120; i++) {
      acts.push(A(`X${i}`, 3 + (i % 7)));
      if (i >= 1) links.push(L(`X${i - 1}`, `X${i}`));
      if (i >= 5 && i % 3 === 0) links.push(L(`X${i - 5}`, `X${i}`));
    }
    const t0 = Date.now();
    const r = simulate({ network: { ...net(acts, links), calendars: { mf: new WorkCalendar(MF) } }, activities: [], risks: [], iterations: 2000, seed: 9 });
    expect(r.iterations).toBe(2000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
