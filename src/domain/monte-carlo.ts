// R-205 (owner's answers K-205 and K-205b, 1 Nov 2026): Monte-Carlo risk analysis on the schedule AND the cost of a project.
// Pure, deterministic for a given seed (tests compare values): no I/O, no clock, no translation.
//
// Model (docs/delivery-9/notes-r205-r208-risk-forecast.md):
// - Three-point estimates (min / most likely / max) on each activity's duration (working days) and cost at completion (k€),
//   entered by the project manager; an activity without one gets the default range −10 % / +25 % around its current value
//   (K-205b, `defaultRange`).
// - Distribution: TRIANGULAR (the item's wording, "lois triangulaires"; a PERT-beta would weight the most likely value more and
//   give narrower tails — the triangular is the conservative choice and is what the PM can check by hand).
// - A sample applies to the work left: the sampled value over the reference value (the activity's duration or cost at
//   completion) is a factor on the remaining duration (and on the cost still to spend). A completed activity is fixed; a
//   milestone (duration 0) keeps duration 0 unless a risk delays it.
// - Open risks linked to an activity (risks.activity_id) are discrete events: in each iteration a risk occurs with its
//   probability (P / 5, the EMV scale of Q-1); when it occurs it adds its delay to its activity's remaining duration and its
//   cost (if it occurs) to the cost at completion. A risk without activity adds its cost only.
// - Each iteration runs the critical path method (src/domain/cpm.ts `schedule`, consumed as a pure function) on the sampled
//   network → project finish, critical activities; cost at completion = Σ activities (actual + sampled cost to go) + risks.
// - Results: percentiles P10 / P50 / P80 / P90 of the finish date and of the cost, the probability of meeting the target finish
//   and budget, a histogram and an S-curve of each, the criticality index (share of iterations where an activity is critical)
//   and the tornado (correlation with the project finish of an activity's sampled duration factor, or of a risk's occurrence,
//   strongest first).
import { addCalendarDays, calendarDaysBetween, type IsoDate } from './calendar';
import { remainingDuration, schedule, type CpmActivityInput, type CpmInput } from './cpm';

// ── Bounds and defaults ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Iterations of a run: default 2 000 (K-205), the PM may choose between the bounds. */
export const MC_ITERATIONS_DEFAULT = 2000;
export const MC_ITERATIONS_MIN = 200;
export const MC_ITERATIONS_MAX = 5000;
export const MC_ITERATION_CHOICES: readonly number[] = [500, 1000, 2000, 5000];

/** K-205b: default range of an activity without a three-point estimate — −10 % / +25 % around its current value. */
export const DEFAULT_RANGE_LOW = 0.9;
export const DEFAULT_RANGE_HIGH = 1.25;

/** Upper bound of an entered duration (working days) and cost (k€): rejects typing slips (a 10-year activity). */
export const MAX_RANGE_DAYS = 2500;
export const MAX_RANGE_KEUR = 1_000_000;

/** Number of histogram bins at most; S-curve points at most; activities kept in the tornado and the criticality list. */
export const HISTOGRAM_BINS = 20;
export const CURVE_POINTS = 41;
export const TORNADO_SIZE = 10;
export const CRITICALITY_SIZE = 15;
/** Correlations below this (in absolute value) are noise at 500–5 000 iterations: left out of the tornado. */
export const TORNADO_MIN_CORRELATION = 0.1;

export interface ThreePoint {
  min: number;
  likely: number;
  max: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The default three-point estimate of a value (K-205b): −10 % / value / +25 %, to two decimals. */
export function defaultRange(value: number): ThreePoint {
  const v = Math.max(0, value);
  return { min: round2(v * DEFAULT_RANGE_LOW), likely: round2(v), max: round2(v * DEFAULT_RANGE_HIGH) };
}

/** An entered range is valid: finite, ≥ 0, min ≤ most likely ≤ max, max within `bound`. EN error, or null. */
export function rangeError(r: ThreePoint, bound: number): string | null {
  if (![r.min, r.likely, r.max].every((v) => Number.isFinite(v))) return 'Enter three numbers';
  if (r.min < 0) return 'The values must be positive or zero';
  if (!(r.min <= r.likely && r.likely <= r.max)) return 'Minimum ≤ most likely ≤ maximum';
  if (r.max > bound) return 'The maximum is too large';
  return null;
}

/** Parses "12", "12,5", "" (→ null). */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Parses the "range" form of one activity: both triples optional (empty = the default range), each complete when given. */
export function parseActivityRanges(values: Record<string, string>): { ok: true; duration: ThreePoint | null; cost: ThreePoint | null } | { ok: false; error: string } {
  const triple = (prefix: 'd' | 'c', bound: number): { ok: true; value: ThreePoint | null } | { ok: false; error: string } => {
    const raw = [values[`${prefix}Min`], values[`${prefix}Likely`], values[`${prefix}Max`]].map(parseNumber);
    if (raw.every((v) => v === null)) return { ok: true, value: null };
    if (raw.some((v) => v === null || Number.isNaN(v))) return { ok: false, error: 'Enter three numbers' };
    const r = { min: raw[0]!, likely: raw[1]!, max: raw[2]! };
    const e = rangeError(r, bound);
    return e ? { ok: false, error: e } : { ok: true, value: { min: round2(r.min), likely: round2(r.likely), max: round2(r.max) } };
  };
  const d = triple('d', MAX_RANGE_DAYS);
  if (!d.ok) return d;
  const c = triple('c', MAX_RANGE_KEUR);
  if (!c.ok) return c;
  return { ok: true, duration: d.value, cost: c.value };
}

/** Parses the iterations chosen for a run (default 2 000), within the bounds. */
export function parseIterations(raw: unknown): number | null {
  if (raw == null || raw === '') return MC_ITERATIONS_DEFAULT;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n) || n < MC_ITERATIONS_MIN || n > MC_ITERATIONS_MAX) return null;
  return n;
}

/** Default delay of a risk without an entered one: impact (1–5) × 5 working days (decision taken without asking, notes §3). */
export const DEFAULT_DELAY_PER_IMPACT = 5;
export const defaultRiskDelay = (impact: number) => Math.max(1, Math.min(5, Math.round(impact))) * DEFAULT_DELAY_PER_IMPACT;

/** Probability that a risk occurs, from its 1–5 probability score (Q-1 scale: P = 1 → 20 %, P = 5 → 100 %). */
export const riskOccurrence = (probability: number) => Math.max(1, Math.min(5, Math.round(probability))) / 5;

// ── Random numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Mulberry32: a small, fast, seeded generator in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 31-bit seed from a text (FNV-1a; fits a PostgreSQL integer): the same project, data date and iterations give the same run. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

/** Inverse CDF of the triangular distribution (min, mode, max) at u ∈ [0, 1). */
export function triangular(r: ThreePoint, u: number): number {
  const { min: a, likely: c, max: b } = r;
  if (!(b > a)) return c;
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

// ── Statistics ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nearest-rank percentile of sorted values (p ∈ (0, 1]). */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (!sorted.length) return NaN;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1];
}

/** Pearson correlation of two series (0 when one is constant). */
export function correlation(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}

export interface HistogramBin {
  /** Lower bound (inclusive) and upper bound (exclusive, inclusive for the last bin). */
  from: number;
  to: number;
  count: number;
}

/** Histogram of sorted values in at most `bins` bins of a "round" width ≥ `minWidth`. */
export function histogram(sorted: ArrayLike<number>, bins = HISTOGRAM_BINS, minWidth = 1): HistogramBin[] {
  if (!sorted.length) return [];
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const width = Math.max(minWidth, niceStep((hi - lo) / bins));
  const start = Math.floor(lo / width) * width;
  const n = Math.max(1, Math.floor((hi - start) / width) + 1);
  const out: HistogramBin[] = Array.from({ length: n }, (_, i) => ({ from: round2(start + i * width), to: round2(start + (i + 1) * width), count: 0 }));
  for (let i = 0; i < sorted.length; i++) out[Math.min(n - 1, Math.floor((sorted[i] - start) / width))].count++;
  return out;
}

/** 1, 2, 5 × 10^k at or above `x`. */
function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

export interface CurvePoint {
  /** Value (day offset or k€). */
  x: number;
  /** Probability of finishing (costing) at or below x, 0–1. */
  p: number;
}

/** S-curve: cumulative probability at `CURVE_POINTS` percentiles (0 %, 2.5 % … 100 %) of sorted values. */
export function sCurve(sorted: ArrayLike<number>, points = CURVE_POINTS): CurvePoint[] {
  if (!sorted.length) return [];
  const out: CurvePoint[] = [];
  for (let i = 0; i < points; i++) {
    const p = i / (points - 1);
    const x = p === 0 ? sorted[0] : percentile(sorted, p);
    out.push({ x, p: round4(p) });
  }
  return out;
}
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Share (0–1) of sorted values at or below `limit`. */
export function shareAtOrBelow(sorted: ArrayLike<number>, limit: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= limit) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length ? lo / sorted.length : 0;
}

// ── Simulation ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface McActivity {
  /** Activity code (the CPM id). */
  id: string;
  /** Entered three-point estimate of the duration (working days); null = the default range around `refDuration`. */
  duration: ThreePoint | null;
  /** Entered three-point estimate of the cost at completion (k€); null = the default range around `refCost`. */
  cost: ThreePoint | null;
  /** Current cost at completion (EAC) and actual cost of the activity, k€. */
  refCost: number;
  actualCost: number;
}

export interface McRisk {
  /** "R-03". */
  id: string;
  /** Activity code the risk is linked to; null = cost only. */
  activityId: string | null;
  /** Probability of occurrence 0–1. */
  probability: number;
  /** Delay added to the activity when it occurs, working days. */
  delayDays: number;
  /** Cost if it occurs, k€. */
  costKeur: number;
}

export interface McInput {
  /** The project's network, as Reschedule computes it (src/server/dal/schedule-network.ts). */
  network: CpmInput;
  /** Cost data and entered ranges by activity code; activities absent here keep the default ranges with no cost. */
  activities: readonly McActivity[];
  risks: readonly McRisk[];
  iterations: number;
  seed: number;
  /** Target finish (contractual end or baseline finish) and target cost (BAC); null = no probability computed. */
  targetFinish?: IsoDate | null;
  targetCost?: number | null;
}

export interface McStats {
  min: number;
  p10: number;
  p50: number;
  p80: number;
  p90: number;
  max: number;
  mean: number;
}

export interface McDriver {
  /** Activity code, or risk number for a risk in the tornado. */
  id: string;
  kind: 'activity' | 'risk';
  /** Share of iterations where the activity is critical, 0–1. */
  criticality: number;
  /** Correlation of its sampled duration with the project finish, −1…1. */
  correlation: number;
}

export interface McRiskOutcome {
  id: string;
  /** Share of iterations where it occurred. */
  occurrence: number;
  activityId: string | null;
  delayDays: number;
  costKeur: number;
}

export interface McResult {
  iterations: number;
  seed: number;
  dataDate: IsoDate;
  /** The deterministic plan (no sampling, no risk): CPM finish and Σ activities' cost at completion. */
  deterministic: { finish: IsoDate; cost: number };
  /** Finish: statistics in calendar days after the data date, plus the dates. */
  finish: McStats & {
    dates: { p10: IsoDate; p50: IsoDate; p80: IsoDate; p90: IsoDate; min: IsoDate; max: IsoDate };
    histogram: HistogramBin[];
    curve: CurvePoint[];
    target: IsoDate | null;
    /** Probability of finishing on or before the target. */
    probOnTarget: number | null;
  };
  cost: McStats & {
    histogram: HistogramBin[];
    curve: CurvePoint[];
    target: number | null;
    probWithinTarget: number | null;
  };
  /** Tornado: strongest correlations first (`TORNADO_SIZE`). */
  tornado: McDriver[];
  /** Highest criticality index first (`CRITICALITY_SIZE`, only activities critical at least once). */
  criticality: McDriver[];
  risks: McRiskOutcome[];
  /** Inputs summary (stored with the run). */
  inputs: { activities: number; entered: number; risks: number; riskCostKeur: number };
}

const statsOf = (sorted: Float64Array): McStats => {
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) sum += sorted[i];
  return {
    min: sorted[0], p10: percentile(sorted, 0.1), p50: percentile(sorted, 0.5), p80: percentile(sorted, 0.8), p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1], mean: round2(sum / sorted.length),
  };
};

/** Base work left of an activity as the CPM schedules it (null when complete). */
function baseRemaining(a: CpmActivityInput, rounding: 'round' | 'ceil' | 'floor'): number | null {
  if (a.actualFinish) return null;
  if (a.actualStart || (a.percentComplete ?? 0) > 0 || a.remaining != null) return remainingDuration(a, rounding);
  return Math.max(0, Math.round(a.duration));
}

/**
 * Runs the simulation. Throws the CPM's errors (CpmInputError, CpmCycleError) on an invalid network — the caller reports them
 * like Reschedule does.
 */
export function simulate(input: McInput): McResult {
  const n = input.iterations;
  if (!Number.isInteger(n) || n < 1) throw new Error('iterations must be a positive integer');
  const rand = seededRandom(input.seed);
  const net = input.network;
  const rounding = net.options?.remainingRounding ?? 'round';
  const byId = new Map(input.activities.map((a) => [a.id, a]));
  const acts = net.activities;

  // Per activity: base remaining, duration range and its reference, cost to go, cost range.
  const plan = acts.map((a) => {
    const base = baseRemaining(a, rounding);
    const m = byId.get(a.id);
    const ref = a.duration;
    const dRange = base == null || !(ref > 0) ? null : m?.duration ?? defaultRange(ref);
    const refCost = Math.max(0, m?.refCost ?? 0);
    const actual = Math.max(0, m?.actualCost ?? 0);
    const toGo = base == null ? 0 : Math.max(0, refCost - actual);
    const cRange = base == null || !(refCost > 0) || !(toGo > 0) ? null : m?.cost ?? defaultRange(refCost);
    return { a, base, ref, dRange, refCost, actual, toGo, cRange };
  });
  const risks = input.risks.map((r) => ({ ...r, p: Math.max(0, Math.min(1, r.probability)) }));
  const riskOn = new Map<string, number[]>();
  risks.forEach((r, i) => {
    if (!r.activityId) return;
    const list = riskOn.get(r.activityId) ?? [];
    list.push(i);
    riskOn.set(r.activityId, list);
  });

  // Deterministic run.
  const det = schedule(net);
  const detCost = plan.reduce((s, x) => s + (x.base == null ? Math.max(x.refCost, x.actual) : x.actual + x.toGo), 0);

  const finish = new Float64Array(n);
  const cost = new Float64Array(n);
  const factors = acts.map(() => new Float64Array(n));
  const critical = new Uint32Array(acts.length);
  const occurred = new Uint32Array(risks.length);
  const fired = new Uint8Array(risks.length);
  const firedAt = risks.map(() => new Float64Array(n));

  for (let it = 0; it < n; it++) {
    // Risks first (one draw each, in register order), then the activities (two draws each, in network order).
    for (let i = 0; i < risks.length; i++) {
      fired[i] = rand() < risks[i].p ? 1 : 0;
      occurred[i] += fired[i];
      firedAt[i][it] = fired[i];
    }
    let c = 0;
    const sampled: CpmActivityInput[] = new Array(acts.length);
    for (let k = 0; k < plan.length; k++) {
      const x = plan[k];
      const ud = rand();
      const uc = rand();
      if (x.base == null) {
        sampled[k] = x.a;
        factors[k][it] = 1;
        c += Math.max(x.refCost, x.actual);
        continue;
      }
      const f = x.dRange ? triangular(x.dRange, ud) / x.ref : 1;
      factors[k][it] = f;
      let rem = x.base * f;
      for (const ri of riskOn.get(x.a.id) ?? []) if (fired[ri]) rem += risks[ri].delayDays;
      sampled[k] = { ...x.a, remaining: Math.max(0, rem) };
      c += x.actual + (x.cRange ? (x.toGo * triangular(x.cRange, uc)) / x.refCost : x.toGo);
    }
    for (let i = 0; i < risks.length; i++) if (fired[i]) c += Math.max(0, risks[i].costKeur);
    const r = schedule({ ...net, activities: sampled });
    finish[it] = calendarDaysBetween(net.dataDate, r.projectFinish);
    cost[it] = c;
    for (let k = 0; k < acts.length; k++) if (r.activities[acts[k].id]?.critical) critical[k]++;
  }

  // Correlations before sorting (same iteration order).
  const drivers: McDriver[] = acts.map((a, k) => ({
    id: a.id,
    kind: 'activity' as const,
    criticality: round4(critical[k] / n),
    // An activity never critical cannot drive the finish: its correlation is sampling noise.
    correlation: plan[k].dRange && critical[k] > 0 ? round4(correlation(factors[k], finish)) : 0,
  }));
  const fSorted = Float64Array.from(finish).sort();
  const cSorted = Float64Array.from(cost).sort();
  const fs = statsOf(fSorted);
  const cs = statsOf(cSorted);
  const dateAt = (d: number) => addCalendarDays(net.dataDate, d);
  const target = input.targetFinish ?? null;
  const targetCost = input.targetCost != null && input.targetCost > 0 ? input.targetCost : null;
  const costWidth = Math.max(1, niceStep((cs.max - cs.min) / HISTOGRAM_BINS));

  return {
    iterations: n,
    seed: input.seed,
    dataDate: net.dataDate,
    deterministic: { finish: det.projectFinish, cost: round2(detCost) },
    finish: {
      ...fs,
      dates: { p10: dateAt(fs.p10), p50: dateAt(fs.p50), p80: dateAt(fs.p80), p90: dateAt(fs.p90), min: dateAt(fs.min), max: dateAt(fs.max) },
      histogram: histogram(fSorted, HISTOGRAM_BINS, 1),
      curve: sCurve(fSorted),
      target,
      probOnTarget: target ? round4(shareAtOrBelow(fSorted, calendarDaysBetween(net.dataDate, target))) : null,
    },
    cost: {
      ...roundStats(cs),
      histogram: histogram(cSorted, HISTOGRAM_BINS, costWidth),
      curve: sCurve(cSorted).map((p) => ({ x: round2(p.x), p: p.p })),
      target: targetCost,
      probWithinTarget: targetCost != null ? round4(shareAtOrBelow(cSorted, targetCost)) : null,
    },
    tornado: [
      ...drivers,
      // A risk delaying an activity drives the finish when it occurs: its occurrence (0 / 1) against the finish.
      ...risks.map((r, i): McDriver => ({
        id: r.id, kind: 'risk', criticality: 0,
        correlation: r.activityId && r.delayDays > 0 && r.p > 0 && r.p < 1 ? round4(correlation(firedAt[i], finish)) : 0,
      })),
    ]
      .filter((d) => Math.abs(d.correlation) >= TORNADO_MIN_CORRELATION)
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation) || a.id.localeCompare(b.id))
      .slice(0, TORNADO_SIZE),
    criticality: drivers
      .filter((d) => d.criticality > 0)
      .sort((a, b) => b.criticality - a.criticality || a.id.localeCompare(b.id))
      .slice(0, CRITICALITY_SIZE),
    risks: risks.map((r, i) => ({ id: r.id, occurrence: round4(occurred[i] / n), activityId: r.activityId, delayDays: r.delayDays, costKeur: r.costKeur })),
    inputs: {
      activities: plan.filter((x) => x.base != null).length,
      entered: input.activities.filter((a) => a.duration || a.cost).length,
      risks: risks.length,
      riskCostKeur: round2(risks.reduce((s, r) => s + Math.max(0, r.costKeur), 0)),
    },
  };
}

const roundStats = (s: McStats): McStats => ({
  min: round2(s.min), p10: round2(s.p10), p50: round2(s.p50), p80: round2(s.p80), p90: round2(s.p90), max: round2(s.max), mean: round2(s.mean),
});

// ── Rights ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * K-205b: the ranges and risk delays are entered by the project manager — the project's leads (PM of record, co-PM, deputy)
 * and the director (`isLead`), on a project they may edit (`canEdit('risks')`, never read-only nor outside the workspace).
 * Running the analysis follows the same rule (it records a result in the project's history).
 */
export const canEditRiskAnalysis = (p: { lead: boolean; canEdit: boolean }) => p.lead && p.canEdit;
