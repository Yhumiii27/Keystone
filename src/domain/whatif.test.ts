// Golden values reproduced from the prototype's what-if logic (design lines 4405–4419) on LEVERS / AUTO
// (3462–3463) and the initial state {A: date + contractor + overtime, B: people + delay + move} — docs/spec/05 §4.4.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { addDaysIso, autoLevelSet, maxOverPeople, scenarioOutcome, sumLevers, type LeverEffect, type WhatIfBase } from './whatif';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
const LEVERS: LeverEffect[] = (P.LEVERS as [string, string, { float: number; cost: number; peak: number; over: number; side?: string }][]).map(([code, , fx]) => ({
  code, floatDays: fx.float, costKeur: fx.cost, peakPts: fx.peak, overPeople: fx.over, sideEffect: fx.side ?? null,
}));
const AUTO = P.AUTO as Record<'date' | 'budget' | 'people', string[]>;
const BASE: WhatIfBase = { floatDays: -27, forecastFinish: '2027-01-14', peakPct: 130, overPeople: 3, baseLoad: [100, 110, 130, 125, 110, 100, 80, 60] };
const A = { contractor: true, overtime: true };
const B = { delay: true, move: true };

describe('scenario outcome', () => {
  it('Scenario A (contractor + overtime): 25 Dec 2026, −7 days, +€27k, 120 %, 2, no side effect', () => {
    const o = scenarioOutcome(BASE, LEVERS, A);
    expect(o.sum).toEqual({ floatDays: 20, costKeur: 27, peakPts: -10, overPeople: -1, sideEffects: [] });
    expect([o.finish, o.floatDays, o.peakPct, o.overPeople]).toEqual(['2026-12-25', -7, 120, 2]);
    expect([o.finishOk, o.costAlert, o.peakAlert]).toEqual([false, true, true]);
    expect(o.score).toEqual({ date: false, budget: false, people: false });
  });

  it('Scenario B (delay + move): 8 Jan 2027, −21 days, no cost, 105 %, 1, Westfield SPI −0.02', () => {
    const o = scenarioOutcome(BASE, LEVERS, B);
    expect(o.sum).toEqual({ floatDays: 6, costKeur: 0, peakPts: -25, overPeople: -2, sideEffects: ['Westfield SPI −0.02'] });
    expect([o.finish, o.floatDays, o.peakPct, o.overPeople]).toEqual(['2027-01-08', -21, 105, 1]);
    expect([o.finishOk, o.costAlert, o.peakAlert]).toEqual([false, false, false]);
  });

  it('every lever: float recovered (+30 d → 15 Dec 2026), peak floored at 85 %, nobody above 100 %', () => {
    const all = Object.fromEntries(LEVERS.map((l) => [l.code, true]));
    const o = scenarioOutcome(BASE, LEVERS, all);
    expect([o.finish, o.floatDays, o.finishOk, o.sum.costKeur, o.peakPct, o.overPeople]).toEqual(['2026-12-15', 3, true, 29, 90, 0]);
    expect(scenarioOutcome({ ...BASE, peakPct: 90 }, LEVERS, all).peakPct).toBe(85);
  });

  it('no lever: the current situation', () => {
    const o = scenarioOutcome(BASE, LEVERS, {});
    expect([o.finish, o.floatDays, o.peakPct, o.overPeople, o.costAlert]).toEqual(['2027-01-14', -27, 130, 3, false]);
    expect(scenarioOutcome({ ...BASE, forecastFinish: null }, LEVERS, {}).finish).toBeNull();
  });

  it('peak bars: weeks 1–4 take the full change, the others 40 %; height = load / 1.4; bands >115 / >100', () => {
    const a = scenarioOutcome(BASE, LEVERS, A).bars;
    expect(a.map((b) => b.load)).toEqual([96, 100, 120, 115, 100, 96, 76, 56]);
    expect(a.map((b) => b.band)).toEqual(['normal', 'normal', 'over', 'stretched', 'normal', 'normal', 'normal', 'normal']);
    expect(a[0].height).toBe(96 / 1.4);
    const b = scenarioOutcome(BASE, LEVERS, B).bars;
    expect(b.map((x) => x.load)).toEqual([90, 85, 105, 100, 85, 90, 70, 50]);
    expect(b.map((x) => x.band)).toEqual(['normal', 'normal', 'stretched', 'normal', 'normal', 'normal', 'normal', 'normal']);
    expect(scenarioOutcome(BASE, LEVERS, {}).bars[2]).toEqual({ load: 130, height: 130 / 1.4, band: 'over' });
    expect(scenarioOutcome({ ...BASE, baseLoad: [150] }, LEVERS, {}).bars[0].height).toBe(100);
  });
});

describe('levers', () => {
  it('sums in lever order with side effects', () => {
    expect(sumLevers(LEVERS, { move: true, split: true }).sideEffects).toEqual(['Westfield SPI −0.02']);
    expect(sumLevers(LEVERS, { nope: true })).toEqual({ floatDays: 0, costKeur: 0, peakPts: 0, overPeople: 0, sideEffects: [] });
  });

  it('auto-level replaces the set with AUTO[priority]', () => {
    expect(autoLevelSet(LEVERS, AUTO.date)).toEqual({ delay: false, contractor: true, overtime: true, split: true, move: false });
    expect(autoLevelSet(LEVERS, AUTO.budget)).toEqual({ delay: true, contractor: false, overtime: false, split: true, move: true });
    expect(autoLevelSet(LEVERS, AUTO.people)).toEqual({ delay: true, contractor: true, overtime: false, split: false, move: true });
    // "Protect people": delay + move + contractor = +18 d → 27 Dec 2026
    expect(scenarioOutcome(BASE, LEVERS, autoLevelSet(LEVERS, AUTO.people)).finish).toBe('2026-12-27');
  });

  it('max people above 100 % and calendar arithmetic across the year end', () => {
    expect(maxOverPeople([0, 1, 2, 3, 2, 0, 1, 0])).toBe(3);
    expect(maxOverPeople([])).toBe(0);
    expect(addDaysIso('2027-01-14', -20)).toBe('2026-12-25');
    expect(addDaysIso('2026-03-28', 2)).toBe('2026-03-30'); // DST change in Europe: no shift
  });
});
