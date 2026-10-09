// Chapter 4 planning roll-ups (open questions S-1, S-3, S-8, A-7) — pure, shared by the "Reschedule" writer, the
// Baseline chip, the Schedule screen DAL and the tests. No I/O, no translation: texts are the prototype's English forms.
//
// - Display dates: activities "05 Oct" / "14 Jan ’27" (wbsFmtDate form), Schedule milestones "1 Apr" / "13 Jan ’27"
//   (fmtD form), headers "14 Jan 2027" (fmtDY form). Gantt positions are fractional months (mIdx convention).
// - Progress → actual dates (P6 rule applied at Reschedule, as Keystone only records % complete).
// - Work-package roll-ups (A-7): earliest start, latest finish, budget-weighted %, critical when one unfinished child is.
// - Milestones are anchored on the activity that ends their work package (the prototype's HMILES carry no link).
// - Variance / slip in WORKING days of the activity / project calendar (S-8); floats come from the CPM engine (S-1).
//
// Every threshold a questionnaire answer may change is a named constant below.
import { MO } from '@/lib/format';
import type { MilestoneStatus } from '@/server/db/codes';
import { isIsoDate, type IsoDate, type WorkCalendar } from './calendar';
import { CPM_DEFAULTS } from './ch4-defaults';

// ── Defaults (chapter-5 questionnaire) ────────────────────────────────────────────────────────────────────────────
/** A-7: a milestone is "Late" when its forecast is more than this many working days after its baseline (≈ 0.4 month, the generated-data rule). */
export const MILESTONE_LATE_SLIP_DAYS = 8;
/** A-7: an unfinished milestone whose baseline falls within this many working days of the data date is "At risk" (≈ 2 months). */
export const MILESTONE_RISK_HORIZON_DAYS = 42;
/** S-1: an activity is critical when its total float is ≤ this (working days). */
export const CRITICAL_FLOAT_DAYS = CPM_DEFAULTS.criticalFloat;
/**
 * HLT-026's six milestones (HMILES 3122) → the work package whose last activity they mark. The generated projects name
 * theirs "<work package> complete"; other names stay unanchored (their stored dates are kept).
 */
export const PROTOTYPE_MILESTONE_WBS: Readonly<Record<string, string>> = {
  'Permits approved': '1.1',
  'Foundations complete': '1.3',
  'Structure topped out': '1.4',
  'Cranes operational': '1.5',
  'Systems energised': '1.6',
  Handover: '1.8',
};

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────────────────────
const parts = (iso: IsoDate) => {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return { y, m, d };
};
/** Activity display date ("05 Oct", "14 Jan ’27"): 2-digit day, year suffix when not 2026 (prototype `wbsFmtDate`). */
export function activityDateText(iso: IsoDate): string {
  const { y, m, d } = parts(iso);
  return `${String(d).padStart(2, '0')} ${MO[m - 1]}${y !== 2026 ? ' ’' + String(y).slice(2) : ''}`;
}
/** Short date ("1 Apr", "13 Jan ’27"), the prototype's `fmtD` / `dateOf` form. */
export function shortDateText(iso: IsoDate): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MO[m - 1]}${y > 2026 ? ' ’' + String(y).slice(2) : ''}`;
}
/** Long date ("14 Jan 2027"), the prototype's `fmtDY` form. */
export function longDateText(iso: IsoDate): string {
  const { y, m, d } = parts(iso);
  return `${d} ${MO[m - 1]} ${y}`;
}
/** Fractional month index from Jan 2026 (`mIdx`: (y − 2026) × 12 + month + (day − 1) / 30). */
export function monthIndex(iso: IsoDate): number {
  const { y, m, d } = parts(iso);
  return (y - 2026) * 12 + (m - 1) + (d - 1) / 30;
}
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
/**
 * Gantt positions in months from the project start: start of a day, end of a day, and inside a day for diamonds — 0.6 day
 * in, so that `dateOf` (round(fraction × 30)) reads the same day back after rounding to 4 decimals (days 1–30).
 */
export const startMonthOf = (iso: IsoDate, projectStartMonth: number) => round4(monthIndex(iso) - projectStartMonth);
export const endMonthOf = (iso: IsoDate, projectStartMonth: number) => round4(monthIndex(iso) + 1 / 30 - projectStartMonth);
export const midMonthOf = (iso: IsoDate, projectStartMonth: number) => round4(monthIndex(iso) + 0.6 / 30 - projectStartMonth);

const minIso = (a: IsoDate, b: IsoDate) => (a < b ? a : b);
const maxIso = (a: IsoDate, b: IsoDate) => (a > b ? a : b);

/** Working days from `baseline` to `actual` on `cal` (positive = later than the baseline). */
export const slipWorkDays = (cal: WorkCalendar, baseline: IsoDate, actual: IsoDate) => cal.ordinal(actual) - cal.ordinal(baseline);
/** Finish variance vs the baseline (S-8, working days): negative = late (the prototype's `v`). */
export const finishVariance = (cal: WorkCalendar, baselineFinish: IsoDate, finish: IsoDate) => {
  const slip = slipWorkDays(cal, baselineFinish, finish);
  return slip === 0 ? 0 : -slip;
};

// ── Progress → actual dates ─────────────────────────────────────────────────────────────────────────────────────
export interface ProgressState {
  pct: number;
  startActual: boolean;
  finishActual: boolean;
  startDate: IsoDate | null;
  finishDate: IsoDate | null;
}

/**
 * Actual dates implied by the % complete at the data date (P6 progress rule, applied by Reschedule because Keystone records
 * only %): > 0 % → started (actual start = the planned start, at the latest the data date); 100 % → finished (actual finish =
 * the planned finish, at the latest the data date); 0 % → not started; below 100 % → not finished. Recorded actual dates are kept.
 */
export function actualsFromProgress(a: ProgressState, dataDate: IsoDate): ProgressState {
  const pct = Math.max(0, Math.min(100, a.pct));
  if (pct === 0) return { ...a, pct, startActual: false, finishActual: false };
  const start = a.startActual && a.startDate ? a.startDate : minIso(isIsoDate(a.startDate) ? a.startDate : dataDate, dataDate);
  if (pct < 100) return { ...a, pct, startActual: true, finishActual: false, startDate: start };
  let finish = a.finishActual && a.finishDate ? a.finishDate : minIso(isIsoDate(a.finishDate) ? a.finishDate : dataDate, dataDate);
  finish = maxIso(finish, start);
  return { pct, startActual: true, finishActual: true, startDate: start, finishDate: finish };
}

// ── Header texts (projectData() display strings) ─────────────────────────────────────────────────────────────────
/** "−27 days" / "+2 days" / "0 days" (U+2212 minus, as the prototype). */
export const floatDaysText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} days`;
/** "−27 d" / "+2 d". */
export const floatShortText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} d`;
export const critPackagesText = (critical: number, total: number) => `${critical} of ${total} packages critical`;
export const milestonesDoneText = (done: number, total: number) => `${done} of ${total}`;
export const milestonesOnTimeText = (onTime: number) => `Complete · ${onTime} on baseline date`;

// ── Work-package roll-ups (A-7) ──────────────────────────────────────────────────────────────────────────────────
export interface RollupActivity {
  code: string;
  wbs: string;
  start: IsoDate | null;
  finish: IsoDate | null;
  budget: number;
  pct: number;
  /** CPM critical (total float ≤ threshold) and not complete. */
  critical: boolean;
  complete: boolean;
}

export interface BaselineDates {
  start: IsoDate | null;
  finish: IsoDate | null;
}

export interface PackageRollup {
  wbs: string;
  start: IsoDate | null;
  finish: IsoDate | null;
  baselineStart: IsoDate | null;
  baselineFinish: IsoDate | null;
  /** Budget-weighted % complete (Σ b·pc / Σ b, rounded). */
  pct: number;
  critical: boolean;
  count: number;
  /** Activity that finishes last (milestone anchor). */
  lastActivity: string | null;
}

/** Roll-up of one work package's activities (in plan order). `baselineOf` gives the displayed baseline's dates of an activity. */
export function rollUpPackage(wbs: string, children: readonly RollupActivity[], baselineOf: (code: string) => BaselineDates | undefined): PackageRollup {
  let start: IsoDate | null = null;
  let finish: IsoDate | null = null;
  let bs: IsoDate | null = null;
  let bf: IsoDate | null = null;
  let last: string | null = null;
  for (const a of children) {
    if (a.start) start = start ? minIso(start, a.start) : a.start;
    if (a.finish && (!finish || a.finish >= finish)) {
      finish = a.finish;
      last = a.code;
    }
    const b = baselineOf(a.code);
    if (b?.start) bs = bs ? minIso(bs, b.start) : b.start;
    if (b?.finish) bf = bf ? maxIso(bf, b.finish) : b.finish;
  }
  const tb = children.reduce((s, a) => s + a.budget, 0) || 1;
  return {
    wbs, start, finish, baselineStart: bs, baselineFinish: bf,
    pct: Math.round(children.reduce((s, a) => s + a.budget * a.pct, 0) / tb),
    critical: children.some((a) => a.critical && !a.complete),
    count: children.length,
    lastActivity: last ?? children.at(-1)?.code ?? null,
  };
}

/** Schedule bar of a work package (months from the project start); the baseline falls back to the forecast when the baseline lacks it. */
export interface RolledBar {
  baselineStart: number;
  baselineEnd: number;
  forecastStart: number;
  forecastEnd: number;
  pct: number;
  critical: boolean;
  /** Forecast finish − baseline finish, working days of the project calendar (S-8); null without a baseline. */
  slipDays: number | null;
}

export function barOf(r: PackageRollup, projectStartMonth: number, cal: WorkCalendar): RolledBar | null {
  if (!r.start || !r.finish) return null;
  const fs = startMonthOf(r.start, projectStartMonth);
  const fe = endMonthOf(r.finish, projectStartMonth);
  const hasBl = !!(r.baselineStart && r.baselineFinish);
  return {
    forecastStart: fs,
    forecastEnd: fe,
    baselineStart: hasBl ? startMonthOf(r.baselineStart!, projectStartMonth) : fs,
    baselineEnd: hasBl ? endMonthOf(r.baselineFinish!, projectStartMonth) : fe,
    pct: r.pct,
    critical: r.critical,
    slipDays: r.baselineFinish ? slipWorkDays(cal, r.baselineFinish, r.finish) : null,
  };
}

// ── Milestones ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Work package a milestone marks: "<work package name> complete" (generated projects), else the HLT-026 table; null when none. */
export function milestoneWbs(name: string, packages: readonly { code: string; name: string }[]): string | null {
  const m = /^(.*) complete$/.exec(name.trim());
  if (m) {
    const wp = packages.find((p) => p.name === m[1]);
    if (wp) return wp.code;
  }
  const w = PROTOTYPE_MILESTONE_WBS[name.trim()];
  return w && packages.some((p) => p.code === w) ? w : null;
}

export interface MilestoneRollupInput {
  /** Anchor activity's current finish and whether it is complete. */
  finish: IsoDate;
  complete: boolean;
  /** Anchor activity's finish in the displayed baseline (null when the baseline lacks it). */
  baselineFinish: IsoDate | null;
}

export interface RolledMilestone {
  forecastMonth: number;
  baselineMonth: number | null;
  status: MilestoneStatus;
  /** Working days late vs the baseline (project calendar), null without baseline. */
  slipDays: number | null;
  /** Complete on or before its baseline date. */
  onTime: boolean;
}

/** Milestone status (A-7): Done when its activity is complete; Late beyond the slip threshold; At risk when due soon; else On track. */
export function milestoneStatusOf(i: { complete: boolean; slipDays: number | null; daysToBaseline: number | null }): MilestoneStatus {
  if (i.complete) return 'done';
  if (i.slipDays != null && i.slipDays > MILESTONE_LATE_SLIP_DAYS) return 'late';
  if (i.daysToBaseline != null && i.daysToBaseline <= MILESTONE_RISK_HORIZON_DAYS) return 'at_risk';
  if (i.slipDays != null && i.slipDays > 0) return 'at_risk';
  return 'on_track';
}

export function rollUpMilestone(i: MilestoneRollupInput, projectStartMonth: number, dataDate: IsoDate, cal: WorkCalendar): RolledMilestone {
  const slip = i.baselineFinish ? slipWorkDays(cal, i.baselineFinish, i.finish) : null;
  const daysToBaseline = i.baselineFinish ? cal.ordinal(i.baselineFinish) - cal.ordinal(dataDate) : null;
  return {
    forecastMonth: midMonthOf(i.finish, projectStartMonth),
    baselineMonth: i.baselineFinish ? midMonthOf(i.baselineFinish, projectStartMonth) : null,
    status: milestoneStatusOf({ complete: i.complete, slipDays: slip, daysToBaseline }),
    slipDays: slip,
    onTime: i.complete && slip != null && slip <= 0,
  };
}

// ── Project float ───────────────────────────────────────────────────────────────────────────────────────────────
/** Project (critical path) float: the lowest total float of the unfinished activities; 0 when every activity is complete. */
export function projectFloat(floats: readonly (number | null)[]): number {
  const open = floats.filter((f): f is number => f != null);
  return open.length ? Math.min(...open) : 0;
}
