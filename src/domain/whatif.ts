// What-if levelling (docs/spec/05 §4.4–§4.5; prototype logic 4405–4419, constants LEVERS / AUTO 3462–3463).
// A scenario switches levers on; their effects add up and move the project's critical-path float, forecast
// finish, cost (EAC), peak weekly load and the number of people above 100 %. Pure functions; the base figures
// (float −27 d, finish 14 Jan 2027, peak 130 %, 3 people) come from the data instead of the prototype's literals.
// Formatting stays in the UI (src/features/resources/whatif-model.ts). Golden values: src/domain/whatif.test.ts.

export type WhatIfPriority = 'date' | 'budget' | 'people';
export const WHATIF_PRIORITIES: WhatIfPriority[] = ['date', 'budget', 'people'];

export interface LeverEffect {
  code: string;
  /** Critical-path float gained (days). */
  floatDays: number;
  /** Cost impact on the EAC (k€). */
  costKeur: number;
  /** Change of the peak weekly load (percentage points). */
  peakPts: number;
  /** Change of the number of people above 100 %. */
  overPeople: number;
  /** Side effect on another project ("Westfield SPI −0.02"). */
  sideEffect?: string | null;
}

export interface LeverSum {
  floatDays: number;
  costKeur: number;
  peakPts: number;
  overPeople: number;
  /** Side effects of the enabled levers, in lever order. */
  sideEffects: string[];
}

/** Component-wise sum of the enabled levers (lever order). */
export function sumLevers(levers: LeverEffect[], enabled: Record<string, boolean>): LeverSum {
  const on = levers.filter((l) => enabled[l.code]);
  return {
    floatDays: on.reduce((a, l) => a + l.floatDays, 0),
    costKeur: on.reduce((a, l) => a + l.costKeur, 0),
    peakPts: on.reduce((a, l) => a + l.peakPts, 0),
    overPeople: on.reduce((a, l) => a + l.overPeople, 0),
    sideEffects: on.map((l) => l.sideEffect).filter((s): s is string => !!s),
  };
}

/** "Auto-level for this priority": the lever set becomes exactly AUTO[priority]. */
export function autoLevelSet(levers: Pick<LeverEffect, 'code'>[], auto: string[]): Record<string, boolean> {
  return Object.fromEntries(levers.map((l) => [l.code, auto.includes(l.code)]));
}

export interface WhatIfBase {
  /** Current critical-path float (days, negative = late): −27. */
  floatDays: number;
  /** Current forecast finish (ISO): 2027-01-14. Null when unknown. */
  forecastFinish: string | null;
  /** Peak weekly load of the pool (%): 130. */
  peakPct: number;
  /** Most people above 100 % in one week: 3. */
  overPeople: number;
  /** Peak-load profile the bars start from (one value per week). */
  baseLoad: number[];
}

/** The peak load never drops below this floor, whatever the levers (`max(85, …)`). */
export const PEAK_FLOOR = 85;
/** Cost impacts above this amount (k€) are shown in the attention colour. */
export const COST_ALERT_KEUR = 12;
/** Peak loads above this % are shown in the attention colour (and bars turn accent-400). */
export const PEAK_ALERT_PCT = 115;
/** Bars: loads above 100 % turn accent-600. */
export const STRETCHED_PCT = 100;
/** The bar profile never drops below 50 %; a bar is full height at 140 % (height % = load / 1.4). */
export const BAR_FLOOR = 50;
export const BAR_FULL = 1.4;
/** Weeks 1–4 of the window (Oct 5 → Oct 26) take the full peak change; the others 40 %. */
export const FULL_EFFECT_WEEKS = [1, 2, 3, 4];
export const PARTIAL_EFFECT = 0.4;

/** Adds calendar days to an ISO date (UTC arithmetic: no DST shift). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface ScenarioOutcome {
  sum: LeverSum;
  /** Critical-path float after the levers (days). */
  floatDays: number;
  /** Forecast finish moved earlier by the float gained (calendar days, as the prototype). */
  finish: string | null;
  /** The finish recovers the whole slip (float ≥ 0). */
  finishOk: boolean;
  peakPct: number;
  overPeople: number;
  costAlert: boolean;
  peakAlert: boolean;
  /** Bars "Peak load by week": load % per week, its height (% of the 64px chart) and band. */
  bars: { load: number; height: number; band: 'over' | 'stretched' | 'normal' }[];
  /** Score computed by the prototype but not displayed (05 §4.4). */
  score: { date: boolean; budget: boolean; people: boolean };
}

export function scenarioOutcome(base: WhatIfBase, levers: LeverEffect[], enabled: Record<string, boolean>): ScenarioOutcome {
  const sum = sumLevers(levers, enabled);
  const floatDays = base.floatDays + sum.floatDays;
  const peakPct = Math.max(PEAK_FLOOR, base.peakPct + sum.peakPts);
  const overPeople = Math.max(0, base.overPeople + sum.overPeople);
  const bars = base.baseLoad.map((b, i) => {
    const load = Math.max(BAR_FLOOR, b + sum.peakPts * (FULL_EFFECT_WEEKS.includes(i) ? 1 : PARTIAL_EFFECT));
    return { load, height: Math.min(100, load / BAR_FULL), band: load > PEAK_ALERT_PCT ? ('over' as const) : load > STRETCHED_PCT ? ('stretched' as const) : ('normal' as const) };
  });
  return {
    sum,
    floatDays,
    finish: base.forecastFinish ? addDaysIso(base.forecastFinish, -sum.floatDays) : null,
    finishOk: floatDays >= 0,
    peakPct,
    overPeople,
    costAlert: sum.costKeur > COST_ALERT_KEUR,
    peakAlert: peakPct > PEAK_ALERT_PCT,
    bars,
    score: { date: floatDays >= 0, budget: sum.costKeur <= 10, people: overPeople === 0 },
  };
}

/** Most people above 100 % in any one week. */
export const maxOverPeople = (overByWeek: number[]) => (overByWeek.length ? Math.max(...overByWeek) : 0);
