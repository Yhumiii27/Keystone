// R-208 (owner's answer K-208 alt1, 1 Nov 2026): first version of the « dérive prévue » — a forecast of the finish slip and the
// cost overrun of a project from RULES and EARNED VALUE (no machine learning: there is no project history yet), with a confidence
// label, the reasons, and mitigation suggestions from a rule table. Pure: no I/O, no clock (the data date is an input), no
// translation (codes and numbers; the screen words them). Always shown as a rule-based estimate.
//
// Forecast (docs/delivery-9/notes-r205-r208-risk-forecast.md §4):
// - finish: the most pessimistic of the available estimates — the schedule (current CPM finish), the earned-value pace (the
//   planned time left stretched by 1 / SPI) and, when a Monte-Carlo run is current, its P80 finish (R-205);
// - cost: the most pessimistic of EAC = BAC / CPI (EAC = AC + (BAC − EV) / (CPI × SPI) when SPI < the SPI threshold) and the
//   Monte-Carlo P80 cost when current;
// - confidence: from the progress (earned value settles after ~15 %, and is reliable past 50 %), one level lower without a
//   current Monte-Carlo run, one level lower when the estimates disagree widely.
import { addCalendarDays, calendarDaysBetween, type IsoDate } from './calendar';

/**
 * S-25 (owner, follow-up questionnaire of delivery 9): the thresholds of the rules, edited in Settings (app_settings
 * "forecast.drift", the portfolio director) — the defaults are the item's own examples (notes §4). Indices as indices,
 * shares and probabilities in %, durations in days. `portfolioOnTimePct` is the portfolio alert of R-208 (risk_forecast).
 */
export interface DriftThresholds {
  /** SPI under this on the critical path → resequence / add resources; also the switch to the composite EAC. */
  spiCritical: number;
  /** CPI under this → review the open commitments. */
  cpiReview: number;
  /** CPI under this → high severity. */
  cpiHigh: number;
  /** TCPI above this → the remaining work must be done more efficiently than planned: re-estimate. */
  tcpiHigh: number;
  /** Float lost since the previous weekly snapshot, working days → early warning. */
  floatErosionDays: number;
  /** Monte-Carlo probability under this (%) → treat the drivers. */
  probabilityLowPct: number;
  /** Monte-Carlo probability under this (%) → high severity. */
  probabilityVeryLowPct: number;
  /** A Monte-Carlo run older than this (days before the data date) is not current any more. */
  monteCarloMaxAgeDays: number;
  /** Estimates disagree when their spread exceeds this many calendar days, or this share of the BAC (%). */
  spreadDays: number;
  spreadCostPct: number;
  /** Progress (%) where earned value starts to be meaningful, and where it is reliable. */
  progressEarlyPct: number;
  progressReliablePct: number;
  /** Portfolio alert (R-208): the latest Monte-Carlo chance of meeting the end date under this (%). */
  portfolioOnTimePct: number;
}

/** The defaults (unchanged by S-25). */
export const DRIFT_STANDARD: Readonly<DriftThresholds> = Object.freeze({
  spiCritical: 0.9,
  cpiReview: 0.95,
  cpiHigh: 0.9,
  tcpiHigh: 1.1,
  floatErosionDays: 5,
  probabilityLowPct: 50,
  probabilityVeryLowPct: 20,
  monteCarloMaxAgeDays: 30,
  spreadDays: 30,
  spreadCostPct: 10,
  progressEarlyPct: 15,
  progressReliablePct: 50,
  portfolioOnTimePct: 20,
});

export type DriftThresholdKey = keyof DriftThresholds;

export interface DriftThresholdField {
  key: DriftThresholdKey;
  /** EN source label (Settings). */
  label: string;
  unit: 'index' | 'pct' | 'days';
  min: number;
  max: number;
  /** Whole numbers only (days). */
  integer: boolean;
}

/** The editable thresholds, in rule order (Settings card). */
export const DRIFT_THRESHOLD_FIELDS: readonly DriftThresholdField[] = [
  { key: 'spiCritical', label: 'SPI under which the critical path is resequenced', unit: 'index', min: 0.01, max: 2, integer: false },
  { key: 'cpiReview', label: 'CPI under which the commitments are reviewed', unit: 'index', min: 0.01, max: 2, integer: false },
  { key: 'cpiHigh', label: 'CPI under which the review is urgent', unit: 'index', min: 0.01, max: 2, integer: false },
  { key: 'tcpiHigh', label: 'TCPI above which the EAC is re-estimated', unit: 'index', min: 0.5, max: 5, integer: false },
  { key: 'floatErosionDays', label: 'Float lost in a week (working days)', unit: 'days', min: 1, max: 999, integer: true },
  { key: 'probabilityLowPct', label: 'Monte-Carlo chance under which the drivers are treated (%)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'probabilityVeryLowPct', label: 'Monte-Carlo chance under which it is urgent (%)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'monteCarloMaxAgeDays', label: 'Monte-Carlo analysis current for (days)', unit: 'days', min: 1, max: 999, integer: true },
  { key: 'spreadDays', label: 'Estimates disagree beyond (calendar days)', unit: 'days', min: 1, max: 999, integer: true },
  { key: 'spreadCostPct', label: 'Estimates disagree beyond (% of the budget)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'progressEarlyPct', label: 'Earned value meaningful from (% progress)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'progressReliablePct', label: 'Earned value reliable from (% progress)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'portfolioOnTimePct', label: 'Portfolio alert: chance of meeting the end date under (%)', unit: 'pct', min: 0, max: 100, integer: false },
];

/** Pairs that must stay ordered (lower ≤ higher). */
export const DRIFT_THRESHOLD_ORDER: readonly (readonly [DriftThresholdKey, DriftThresholdKey])[] = [
  ['cpiHigh', 'cpiReview'],
  ['probabilityVeryLowPct', 'probabilityLowPct'],
  ['progressEarlyPct', 'progressReliablePct'],
];

/** Refusals (EN source; FR in src/i18n/extra/d9-s-quality.json). */
export const DRIFT_THRESHOLD_RANGE = 'Enter a number within the range of this threshold';
export const DRIFT_THRESHOLD_ORDER_ERROR = 'This threshold must stay consistent with its pair (the urgent level beyond the first one)';

export const isDriftThresholdKey = (k: unknown): k is DriftThresholdKey => typeof k === 'string' && DRIFT_THRESHOLD_FIELDS.some((f) => f.key === k);

/** A valid value for one threshold (its range; days whole), else null. Accepts "0,9", "0.9", 0.9. */
export function parseDriftThreshold(key: DriftThresholdKey, raw: unknown): number | null {
  const f = DRIFT_THRESHOLD_FIELDS.find((x) => x.key === key);
  if (!f) return null;
  let v: number;
  if (typeof raw === 'number') v = raw;
  else if (typeof raw === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(raw)) v = Number(raw.trim().replace(',', '.'));
  else return null;
  if (!Number.isFinite(v) || v < f.min || v > f.max) return null;
  if (f.integer && !Number.isInteger(v)) return null;
  return Math.round(v * 1000) / 1000;
}

/** The first ordered pair `t` breaks, else null. */
export function driftOrderBroken(t: DriftThresholds): readonly [DriftThresholdKey, DriftThresholdKey] | null {
  return DRIFT_THRESHOLD_ORDER.find(([lo, hi]) => t[lo] > t[hi]) ?? null;
}

/** Stored thresholds (app_settings "forecast.drift") over the defaults: an invalid value, or a broken pair, keeps the default. */
export function usableDriftThresholds(stored: unknown): DriftThresholds {
  const out: DriftThresholds = { ...DRIFT_STANDARD };
  if (!stored || typeof stored !== 'object') return out;
  for (const f of DRIFT_THRESHOLD_FIELDS) {
    const v = parseDriftThreshold(f.key, (stored as Record<string, unknown>)[f.key]);
    if (v !== null) out[f.key] = v;
  }
  for (const [lo, hi] of DRIFT_THRESHOLD_ORDER) if (out[lo] > out[hi]) [out[lo], out[hi]] = [DRIFT_STANDARD[lo], DRIFT_STANDARD[hi]];
  return out;
}

/** The thresholds as the rules use them (shares and probabilities 0–1). */
export function driftRules(t: DriftThresholds = DRIFT_STANDARD) {
  return {
    spiCritical: t.spiCritical,
    cpiReview: t.cpiReview,
    cpiHigh: t.cpiHigh,
    tcpiHigh: t.tcpiHigh,
    floatErosion: t.floatErosionDays,
    probabilityLow: t.probabilityLowPct / 100,
    probabilityVeryLow: t.probabilityVeryLowPct / 100,
    monteCarloMaxAgeDays: t.monteCarloMaxAgeDays,
    spreadDays: t.spreadDays,
    spreadCostShare: t.spreadCostPct / 100,
    progressEarly: t.progressEarlyPct / 100,
    progressReliable: t.progressReliablePct / 100,
    /** Activities named in a suggestion at most (not a threshold). */
    named: 3,
  };
}

/** The default rules (S-25: the Settings values replace them through `DriftInput.thresholds`). */
export const DRIFT_RULES = Object.freeze(driftRules());

export type Confidence = 'low' | 'medium' | 'high';
export type Severity = 'high' | 'medium' | 'low';

export interface DriftEvm {
  bac: number;
  ev: number;
  ac: number;
  pv: number;
  cpi: number | null;
  spi: number | null;
  /** Budget-weighted progress 0–1. */
  progress: number;
}

export interface DriftActivity {
  code: string;
  name: string;
  complete: boolean;
  inProgress: boolean;
  critical: boolean;
  totalFloat: number | null;
  start: IsoDate | null;
  finish: IsoDate | null;
  /** k€. */
  budget: number;
  eac: number;
}

export interface DriftMilestone {
  name: string;
  status: 'done' | 'late' | 'at_risk' | 'on_track';
  /** Total float of its anchor activity (working days); null when unknown or complete. */
  floatDays: number | null;
}

export interface DriftMonteCarlo {
  /** Data date of the run, and whether its inputs changed since (R-205 `stale`). */
  dataDate: IsoDate;
  stale: boolean;
  p80Finish: IsoDate;
  p80Cost: number;
  probOnTarget: number | null;
  probWithinBudget: number | null;
  /** Tornado ids, strongest first (activity codes or risk numbers). */
  drivers: string[];
}

export interface DriftInput {
  dataDate: IsoDate;
  /** Current (CPM) finish of the project and its target (planned or baseline finish). */
  currentFinish: IsoDate | null;
  targetFinish: IsoDate | null;
  evm: DriftEvm | null;
  activities: readonly DriftActivity[];
  milestones: readonly DriftMilestone[];
  /** Project float now and at the previous weekly snapshot, working days. */
  currentFloat: number | null;
  previousFloat: number | null;
  /** Orders placed not yet received, k€. */
  openCommitmentKeur: number;
  /** Contingency left (provision − validated draw-downs), k€; null when unknown. */
  contingencyLeftKeur: number | null;
  monteCarlo: DriftMonteCarlo | null;
  /** S-25: the Settings thresholds; absent = the defaults. */
  thresholds?: DriftThresholds;
}

export type FinishMethod = 'schedule' | 'evm' | 'monte_carlo';
export type CostMethod = 'cpi' | 'composite' | 'monte_carlo';

export type ReasonCode =
  | 'spi_low' | 'cpi_low' | 'tcpi_high' | 'schedule_late' | 'float_negative' | 'float_eroding' | 'milestones_late' | 'mc_on_time_low'
  | 'mc_budget_low' | 'eac_over_bac' | 'no_evm' | 'early_progress' | 'mc_missing' | 'mc_stale';

export interface DriftReason {
  code: ReasonCode;
  /** Numbers and names the screen words (ratios, days, k€, names as typed). */
  value?: number;
  names?: string[];
}

export type RuleId =
  | 'spi_critical' | 'cpi_review' | 'tcpi_reestimate' | 'milestone_float' | 'negative_float' | 'float_eroding' | 'mc_drivers' | 'mc_budget'
  | 'contingency_short' | 'mc_rerun' | 'mc_run';

export interface DriftSuggestion {
  rule: RuleId;
  severity: Severity;
  /** Named activities (codes) or milestones / risks the suggestion is about. */
  targets: string[];
  value?: number;
}

export interface DriftForecast {
  finish: {
    /** Forecast finish (null without any schedule data). */
    date: IsoDate | null;
    target: IsoDate | null;
    /** Calendar days after the target (negative = ahead); null without target. */
    slipDays: number | null;
    method: FinishMethod | null;
    estimates: Partial<Record<FinishMethod, IsoDate>>;
  };
  cost: {
    eac: number | null;
    bac: number | null;
    /** EAC − BAC, k€ and share of the BAC. */
    overrunKeur: number | null;
    overrunShare: number | null;
    method: CostMethod | null;
    estimates: Partial<Record<CostMethod, number>>;
    tcpi: number | null;
  };
  confidence: Confidence;
  reasons: DriftReason[];
  suggestions: DriftSuggestion[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const lower = (c: Confidence): Confidence => (c === 'high' ? 'medium' : 'low');

/** A Monte-Carlo run is current when its inputs did not change and it is at most N days (30 by default) older than the data date. */
export function monteCarloCurrent(mc: DriftMonteCarlo | null, dataDate: IsoDate, maxAgeDays: number = DRIFT_RULES.monteCarloMaxAgeDays): boolean {
  return !!mc && !mc.stale && calendarDaysBetween(mc.dataDate, dataDate) <= maxAgeDays;
}

/** Finish at the earned-value pace: the planned time left (to the target, else the current finish) stretched by 1 / SPI. */
export function evmFinish(dataDate: IsoDate, plannedFinish: IsoDate | null, spi: number | null): IsoDate | null {
  if (!plannedFinish || spi == null || !(spi > 0)) return null;
  const left = Math.max(0, calendarDaysBetween(dataDate, plannedFinish));
  return addCalendarDays(dataDate, Math.round(left / Math.min(1, spi)));
}

/** To-complete performance index (BAC − EV) / (BAC − AC); null when the budget is spent. */
export function tcpiOf(e: Pick<DriftEvm, 'bac' | 'ev' | 'ac'>): number | null {
  const left = e.bac - e.ac;
  return left > 0 ? round3((e.bac - e.ev) / left) : null;
}

/** The rule-based forecast of a project (see the file header). */
export function forecastDrift(input: DriftInput): DriftForecast {
  const R = input.thresholds ? driftRules(input.thresholds) : DRIFT_RULES;
  const { evm, dataDate } = input;
  const mcCurrent = monteCarloCurrent(input.monteCarlo, dataDate, R.monteCarloMaxAgeDays);
  const mc = mcCurrent ? input.monteCarlo : null;

  // ── Finish ──
  const finishEst: Partial<Record<FinishMethod, IsoDate>> = {};
  if (input.currentFinish) finishEst.schedule = input.currentFinish;
  const evmF = evm ? evmFinish(dataDate, input.targetFinish && input.targetFinish > dataDate ? input.targetFinish : input.currentFinish, evm.spi) : null;
  if (evmF) finishEst.evm = evmF;
  if (mc) finishEst.monte_carlo = mc.p80Finish;
  const finishPick = (Object.entries(finishEst) as [FinishMethod, IsoDate][]).sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))[0] ?? null;
  const target = input.targetFinish;
  const slipDays = finishPick && target ? calendarDaysBetween(target, finishPick[1]) : null;

  // ── Cost ──
  const costEst: Partial<Record<CostMethod, number>> = {};
  let tcpi: number | null = null;
  if (evm && evm.bac > 0 && evm.cpi != null && evm.cpi > 0) {
    if (evm.spi != null && evm.spi > 0 && evm.spi < R.spiCritical) costEst.composite = Math.round(evm.ac + (evm.bac - evm.ev) / (evm.cpi * evm.spi));
    else costEst.cpi = Math.round(evm.bac / evm.cpi);
    tcpi = tcpiOf(evm);
  }
  if (mc) costEst.monte_carlo = Math.round(mc.p80Cost);
  const costPick = (Object.entries(costEst) as [CostMethod, number][]).sort((a, b) => b[1] - a[1])[0] ?? null;
  const bac = evm?.bac ?? null;
  const overrun = costPick && bac ? costPick[1] - bac : null;

  // ── Confidence ──
  let confidence: Confidence = !evm ? 'low' : evm.progress < R.progressEarly ? 'low' : evm.progress < R.progressReliable ? 'medium' : 'high';
  if (!mc) confidence = lower(confidence);
  const fDates = Object.values(finishEst).sort();
  const cVals = Object.values(costEst);
  const spreadF = fDates.length > 1 ? calendarDaysBetween(fDates[0], fDates[fDates.length - 1]) : 0;
  const spreadC = cVals.length > 1 && bac ? (Math.max(...cVals) - Math.min(...cVals)) / bac : 0;
  if (spreadF > R.spreadDays || spreadC > R.spreadCostShare) confidence = lower(confidence);

  // ── Reasons ──
  const reasons: DriftReason[] = [];
  const open = input.activities.filter((a) => !a.complete);
  const critical = open.filter((a) => a.critical || (a.totalFloat != null && a.totalFloat <= 0));
  if (!evm) reasons.push({ code: 'no_evm' });
  else if (evm.progress < R.progressEarly) reasons.push({ code: 'early_progress', value: round1(evm.progress * 100) });
  if (evm?.spi != null && evm.spi < 1) reasons.push({ code: 'spi_low', value: round3(evm.spi) });
  if (evm?.cpi != null && evm.cpi < 1) reasons.push({ code: 'cpi_low', value: round3(evm.cpi) });
  if (tcpi != null && tcpi > R.tcpiHigh) reasons.push({ code: 'tcpi_high', value: tcpi });
  if (input.currentFinish && target && input.currentFinish > target) reasons.push({ code: 'schedule_late', value: calendarDaysBetween(target, input.currentFinish) });
  if (input.currentFloat != null && input.currentFloat < 0) reasons.push({ code: 'float_negative', value: input.currentFloat });
  const erosion = input.currentFloat != null && input.previousFloat != null ? input.previousFloat - input.currentFloat : 0;
  if (erosion >= R.floatErosion) reasons.push({ code: 'float_eroding', value: erosion });
  const lateMs = input.milestones.filter((m) => m.status === 'late').map((m) => m.name);
  if (lateMs.length) reasons.push({ code: 'milestones_late', names: lateMs });
  if (overrun != null && overrun > 0) reasons.push({ code: 'eac_over_bac', value: Math.round(overrun) });
  if (mc?.probOnTarget != null && mc.probOnTarget < R.probabilityLow) reasons.push({ code: 'mc_on_time_low', value: mc.probOnTarget });
  if (mc?.probWithinBudget != null && mc.probWithinBudget < R.probabilityLow) reasons.push({ code: 'mc_budget_low', value: mc.probWithinBudget });
  if (!input.monteCarlo) reasons.push({ code: 'mc_missing' });
  else if (!mcCurrent) reasons.push({ code: 'mc_stale' });

  // ── Suggestions (rule table) ──
  const suggestions: DriftSuggestion[] = [];
  const byUrgency = (a: DriftActivity, b: DriftActivity) =>
    Number(b.inProgress) - Number(a.inProgress) || (a.totalFloat ?? 0) - (b.totalFloat ?? 0) || (a.start ?? '').localeCompare(b.start ?? '') || a.code.localeCompare(b.code);
  if (evm?.spi != null && evm.spi < R.spiCritical && critical.length)
    suggestions.push({ rule: 'spi_critical', severity: 'high', targets: [...critical].sort(byUrgency).slice(0, R.named).map((a) => a.code), value: round3(evm.spi) });
  if (evm?.cpi != null && evm.cpi < R.cpiReview) {
    const over = open.filter((a) => a.eac > a.budget).sort((a, b) => b.eac - b.budget - (a.eac - a.budget) || a.code.localeCompare(b.code));
    suggestions.push({ rule: 'cpi_review', severity: evm.cpi < R.cpiHigh ? 'high' : 'medium', targets: over.slice(0, R.named).map((a) => a.code), value: Math.round(input.openCommitmentKeur) });
  }
  if (tcpi != null && tcpi > R.tcpiHigh) suggestions.push({ rule: 'tcpi_reestimate', severity: 'medium', targets: [], value: tcpi });
  const exhausted = input.milestones.filter((m) => m.status !== 'done' && (m.status === 'late' || (m.floatDays != null && m.floatDays <= 0)));
  if (exhausted.length)
    suggestions.push({ rule: 'milestone_float', severity: exhausted.some((m) => m.status === 'late') ? 'high' : 'medium', targets: exhausted.map((m) => m.name) });
  if (input.currentFloat != null && input.currentFloat < 0) {
    const worst = [...critical].sort((a, b) => (a.totalFloat ?? 0) - (b.totalFloat ?? 0) || byUrgency(a, b));
    suggestions.push({ rule: 'negative_float', severity: 'high', targets: worst.slice(0, R.named).map((a) => a.code), value: input.currentFloat });
  }
  if (erosion >= R.floatErosion) suggestions.push({ rule: 'float_eroding', severity: 'medium', targets: [], value: erosion });
  if (mc?.probOnTarget != null && mc.probOnTarget < R.probabilityLow)
    suggestions.push({ rule: 'mc_drivers', severity: mc.probOnTarget < R.probabilityVeryLow ? 'high' : 'medium', targets: mc.drivers.slice(0, R.named), value: mc.probOnTarget });
  if (mc?.probWithinBudget != null && mc.probWithinBudget < R.probabilityLow)
    suggestions.push({ rule: 'mc_budget', severity: mc.probWithinBudget < R.probabilityVeryLow ? 'high' : 'medium', targets: [], value: mc.probWithinBudget });
  if (overrun != null && overrun > 0 && input.contingencyLeftKeur != null && overrun > input.contingencyLeftKeur)
    suggestions.push({ rule: 'contingency_short', severity: 'high', targets: [], value: Math.round(overrun - input.contingencyLeftKeur) });
  if (!input.monteCarlo) suggestions.push({ rule: 'mc_run', severity: 'low', targets: [] });
  else if (!mcCurrent) suggestions.push({ rule: 'mc_rerun', severity: 'low', targets: [] });
  const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

  return {
    finish: { date: finishPick?.[1] ?? null, target, slipDays, method: finishPick?.[0] ?? null, estimates: finishEst },
    cost: {
      eac: costPick?.[1] ?? null, bac, overrunKeur: overrun != null ? Math.round(overrun) : null,
      overrunShare: overrun != null && bac ? round3(overrun / bac) : null, method: costPick?.[0] ?? null, estimates: costEst, tcpi,
    },
    confidence,
    reasons,
    suggestions,
  };
}

/** The forecast deserves a portfolio alert: a high-severity suggestion and a slip or an overrun (cheap: stored values only). */
export const driftAlert = (f: DriftForecast) =>
  f.suggestions.some((s) => s.severity === 'high') && ((f.finish.slipDays ?? 0) > 0 || (f.cost.overrunKeur ?? 0) > 0);
