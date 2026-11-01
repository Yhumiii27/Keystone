// R-206 (K-206, K-206b) — schedule quality diagnostic: the 14 checks of the DCMA 14-point assessment on Keystone's schedule
// model. Pure and deterministic; reads only. The checks consume what the schedule already holds (stored dates, floats and
// constraints as the last "Reschedule" published them, the reference baseline's snapshot) and, for the critical path test, the
// outputs of the CPM engine through `criticalPathTest` (src/domain/schedule-quality-cpm.ts) — never the engine's internals.
//
// Population: "incomplete" activities = not complete (complete = actual finish flagged or 100 %), as in DCMA; relationship
// checks look at the relationships whose successor is incomplete (the logic still matters there). Durations and floats are in
// working days (S-8), so the "44 days" of the standard are 44 working days. Every rule is documented in
// docs/delivery-9/notes-r206-schedule-quality.md § 2.
import type { IsoDate, WorkCalendar } from './calendar';

// ── Thresholds (Settings, K-206b: the standard by default) ─────────────────────────────────────────────────────────────

export interface DcmaThresholds {
  /** 1 · Incomplete activities without predecessor or successor, % of incomplete (≤). */
  logicPct: number;
  /** 2 · Relationships with a lead (negative lag), count (≤). */
  leadsCount: number;
  /** 3 · Relationships with a lag, % of relationships (≤). */
  lagsPct: number;
  /** 4 · Finish-to-start relationships, % of relationships (≥). */
  fsMinPct: number;
  /** 5 · Incomplete activities with a hard constraint, % (≤). */
  hardConstraintsPct: number;
  /** 6 · "High float" above this many working days… */
  highFloatDays: number;
  /** …on at most this % of incomplete activities. */
  highFloatPct: number;
  /** 7 · Incomplete activities with negative float, count (≤). */
  negativeFloatCount: number;
  /** 8 · "High duration" above this many working days… */
  highDurationDays: number;
  /** …on at most this % of incomplete activities. */
  highDurationPct: number;
  /** 9 · Activities with invalid dates, count (≤). */
  invalidDatesCount: number;
  /** 10 · Incomplete activities (duration > 0) without resource, hours or budget, % (≤). */
  resourcesPct: number;
  /** 11 · Activities that missed their baseline finish, % of those due (≤). */
  missedTasksPct: number;
  /** 13 · Critical path length index (≥). */
  cpliMin: number;
  /** 14 · Baseline execution index (≥). */
  beiMin: number;
}

/** The DCMA 14-point standard (resources: every loaded activity — the standard gives no figure, see the notes § 3). */
export const DCMA_STANDARD: Readonly<DcmaThresholds> = Object.freeze({
  logicPct: 5,
  leadsCount: 0,
  lagsPct: 5,
  fsMinPct: 90,
  hardConstraintsPct: 5,
  highFloatDays: 44,
  highFloatPct: 5,
  negativeFloatCount: 0,
  highDurationDays: 44,
  highDurationPct: 5,
  invalidDatesCount: 0,
  resourcesPct: 0,
  missedTasksPct: 5,
  cpliMin: 0.95,
  beiMin: 0.95,
});

export type DcmaThresholdKey = keyof DcmaThresholds;
export type DcmaThresholdUnit = 'pct' | 'count' | 'days' | 'index';

export interface DcmaThresholdField {
  key: DcmaThresholdKey;
  /** EN source label (Settings). */
  label: string;
  unit: DcmaThresholdUnit;
  min: number;
  max: number;
  /** Whole numbers only (counts, days). */
  integer: boolean;
}

/** The editable thresholds, in check order (Settings card). */
export const DCMA_THRESHOLD_FIELDS: readonly DcmaThresholdField[] = [
  { key: 'logicPct', label: 'Missing logic (max %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'leadsCount', label: 'Leads (max count)', unit: 'count', min: 0, max: 9999, integer: true },
  { key: 'lagsPct', label: 'Lags (max %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'fsMinPct', label: 'Finish-to-start relationships (min %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'hardConstraintsPct', label: 'Hard constraints (max %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'highFloatDays', label: 'High float above (working days)', unit: 'days', min: 1, max: 9999, integer: true },
  { key: 'highFloatPct', label: 'High float (max %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'negativeFloatCount', label: 'Negative float (max count)', unit: 'count', min: 0, max: 9999, integer: true },
  { key: 'highDurationDays', label: 'High duration above (working days)', unit: 'days', min: 1, max: 9999, integer: true },
  { key: 'highDurationPct', label: 'High duration (max %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'invalidDatesCount', label: 'Invalid dates (max count)', unit: 'count', min: 0, max: 9999, integer: true },
  { key: 'resourcesPct', label: 'Activities without resources (max %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'missedTasksPct', label: 'Missed activities (max %)', unit: 'pct', min: 0, max: 100, integer: false },
  { key: 'cpliMin', label: 'Critical path length index (min)', unit: 'index', min: 0, max: 2, integer: false },
  { key: 'beiMin', label: 'Baseline execution index (min)', unit: 'index', min: 0, max: 2, integer: false },
];

export const isDcmaThresholdKey = (v: unknown): v is DcmaThresholdKey => typeof v === 'string' && DCMA_THRESHOLD_FIELDS.some((f) => f.key === v);

/** Refusal of a threshold out of its range (EN source; FR in src/i18n/extra/d9-schedule-quality.json). */
export const DCMA_THRESHOLD_RANGE = 'Enter a number within the range of this threshold';

/** A valid value for one threshold (its range; counts and days whole), else null. Accepts "5", "0,95", 5. */
export function parseDcmaThreshold(key: DcmaThresholdKey, raw: unknown): number | null {
  const f = DCMA_THRESHOLD_FIELDS.find((x) => x.key === key);
  if (!f) return null;
  let v: number;
  if (typeof raw === 'number') v = raw;
  else if (typeof raw === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(raw)) v = Number(raw.trim().replace(',', '.'));
  else return null;
  if (!Number.isFinite(v) || v < f.min || v > f.max) return null;
  if (f.integer && !Number.isInteger(v)) return null;
  return Math.round(v * 1000) / 1000;
}

/** Stored thresholds (app_settings "schedule.dcma") over the standard: an unknown key or an invalid value keeps the standard. */
export function usableDcmaThresholds(stored: unknown): DcmaThresholds {
  const out: DcmaThresholds = { ...DCMA_STANDARD };
  if (!stored || typeof stored !== 'object') return out;
  for (const f of DCMA_THRESHOLD_FIELDS) {
    const v = parseDcmaThreshold(f.key, (stored as Record<string, unknown>)[f.key]);
    if (v !== null) out[f.key] = v;
  }
  return out;
}

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QualityActivity {
  id: string;
  /** Original duration, working days (0 = milestone). */
  duration: number;
  /** 0–100. */
  pct: number;
  startActual: boolean;
  finishActual: boolean;
  /** Current dates as the schedule holds them (actual where flagged, else the last Reschedule's early dates). */
  startDate: IsoDate | null;
  finishDate: IsoDate | null;
  /** Constraint type ('ASAP' / null = none). */
  constraintType: string | null;
  /** Total float as published, working days; null when not computed or complete. */
  totalFloat: number | null;
  /** Resource-loaded: a resource assignment, or a budget (DCMA: "hours or dollars"). */
  resourced: boolean;
  /** Finish date in the reference baseline; null when the activity is not in it. */
  baselineFinish: IsoDate | null;
}

export interface QualityLink {
  pred: string;
  succ: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  /** Working days (negative = lead). */
  lag: number;
}

/** Outcome of the critical path test (src/domain/schedule-quality-cpm.ts). */
export type CriticalPathTestOutcome =
  | { kind: 'done'; activity: string; delay: number; slip: number; tolerance: number }
  | { kind: 'no_critical' }
  | { kind: 'cycle'; cycle: string[] }
  | { kind: 'invalid' };

export interface QualityBaseline {
  code: string;
  /** Project finish in the baseline (latest snapshot finish, else the baseline's recorded finish). */
  finish: IsoDate | null;
  /** The snapshot holds activities (missed tasks and BEI need them). */
  hasActivities: boolean;
}

export interface QualityInput {
  dataDate: IsoDate;
  activities: readonly QualityActivity[];
  links: readonly QualityLink[];
  thresholds: DcmaThresholds;
  /** The reference baseline (the displayed one); null = the project has none. */
  baseline: QualityBaseline | null;
  /** Project calendar (CPLI counts working days on it). */
  calendar: WorkCalendar;
  /** Critical path test; null = not run. */
  cpt: CriticalPathTestOutcome | null;
}

// ── Output ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const DCMA_CHECK_IDS = [
  'logic', 'leads', 'lags', 'relationshipTypes', 'hardConstraints', 'highFloat', 'negativeFloat', 'highDuration', 'invalidDates', 'resources',
  'missedTasks', 'criticalPathTest', 'cpli', 'bei',
] as const;
export type DcmaCheckId = (typeof DCMA_CHECK_IDS)[number];

/** EN source names and what each check measures (FR in src/i18n/extra/d9-schedule-quality.json). */
export const DCMA_CHECK_TEXT: Record<DcmaCheckId, { name: string; rule: string }> = {
  logic: { name: 'Logic', rule: 'Incomplete activities without a predecessor or a successor' },
  leads: { name: 'Leads', rule: 'Relationships with a negative lag' },
  lags: { name: 'Lags', rule: 'Relationships with a positive lag' },
  relationshipTypes: { name: 'Relationship types', rule: 'Share of finish-to-start relationships' },
  hardConstraints: { name: 'Hard constraints', rule: 'Must start / finish on, start / finish no later than' },
  highFloat: { name: 'High float', rule: 'Incomplete activities with a total float above the limit' },
  negativeFloat: { name: 'Negative float', rule: 'Incomplete activities with a total float below zero' },
  highDuration: { name: 'High duration', rule: 'Incomplete activities longer than the limit' },
  invalidDates: { name: 'Invalid dates', rule: 'Forecast dates before the data date, actual dates after it' },
  resources: { name: 'Resources', rule: 'Incomplete activities without a resource, hours or budget' },
  missedTasks: { name: 'Missed activities', rule: 'Activities due by the data date that did not finish on their baseline date' },
  criticalPathTest: { name: 'Critical path test', rule: 'A long delay on the first critical activity moves the project finish by as much' },
  cpli: { name: 'Critical path length index', rule: '(Critical path length + float to the baseline finish) ÷ critical path length' },
  bei: { name: 'Baseline execution index', rule: 'Activities completed ÷ activities due by the data date in the baseline' },
};

/** Why a check is not applicable (EN source). */
export const DCMA_NA = {
  noIncomplete: 'No incomplete activity',
  noRelationship: 'No relationship to an incomplete activity',
  noBaseline: 'No reference baseline with activities',
  noBaselineFinish: 'No reference baseline finish',
  noneDue: 'No activity due by the data date in the baseline',
  noLoaded: 'No incomplete activity with a duration',
  complete: 'The remaining work finishes before the data date',
  notRun: 'The schedule could not be computed',
  cycle: 'The logic contains a loop',
  noCritical: 'No incomplete critical activity',
} as const;
export type DcmaNaReason = (typeof DCMA_NA)[keyof typeof DCMA_NA];

export type DcmaStatus = 'pass' | 'fail' | 'na';
export type DcmaValueUnit = 'pct' | 'count' | 'index' | 'test';

/** An offending activity or relationship. `value` = the measured figure where one helps (float, duration, lag, variance). */
export type DcmaOffender =
  | { kind: 'activity'; id: string; value?: number; note?: DcmaOffenderNote }
  | { kind: 'link'; pred: string; succ: string; type: QualityLink['type']; lag: number };

/** EN source notes on an offender. */
export const DCMA_NOTES = {
  noPredecessor: 'No predecessor',
  noSuccessor: 'No successor',
  noLinks: 'No predecessor, no successor',
  startBeforeDataDate: 'Forecast start before the data date',
  finishBeforeDataDate: 'Forecast finish before the data date',
  actualStartAfter: 'Actual start after the data date',
  actualFinishAfter: 'Actual finish after the data date',
  notFinished: 'Not finished',
  finishedLate: 'Finished after its baseline date',
} as const;
export type DcmaOffenderNote = (typeof DCMA_NOTES)[keyof typeof DCMA_NOTES];

export interface DcmaCheck {
  id: DcmaCheckId;
  /** 1–14. */
  number: number;
  status: DcmaStatus;
  /** Measured value: % (one decimal), count, index (two decimals); null when not applicable. For the CPT: the slip, working days. */
  value: number | null;
  unit: DcmaValueUnit;
  /** Offenders / population (percentage checks). */
  count: number | null;
  total: number | null;
  /** Threshold: `value op limit`. */
  op: '≤' | '≥' | '=';
  limit: number;
  /** For the float and duration checks: the limit in working days. */
  limitDays?: number;
  naReason?: DcmaNaReason;
  offenders: DcmaOffender[];
}

export interface DcmaReport {
  checks: DcmaCheck[];
  passed: number;
  failed: number;
  notApplicable: number;
  /** Incomplete activities / relationships checked. */
  incomplete: number;
  relationships: number;
}

// ── Rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Hard constraints (DCMA #5): they fix a date whatever the logic. SNET / FNET are soft. */
export const HARD_CONSTRAINTS: readonly string[] = ['MSO', 'MFO', 'SNLT', 'FNLT'];

const isComplete = (a: Pick<QualityActivity, 'finishActual' | 'pct'>) => a.finishActual || a.pct >= 100;
const isStarted = (a: Pick<QualityActivity, 'startActual' | 'pct'>) => a.startActual || a.pct > 0;
const pct1 = (n: number, d: number) => Math.round((n / d) * 1000) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

function ratioCheck(
  id: DcmaCheckId, number: number, offenders: DcmaOffender[], total: number, op: '≤' | '≥', limit: number, na: DcmaNaReason, numerator = offenders.length,
): DcmaCheck {
  if (total === 0) return { id, number, status: 'na', value: null, unit: 'pct', count: null, total: 0, op, limit, naReason: na, offenders: [] };
  const value = pct1(numerator, total);
  const pass = op === '≤' ? value <= limit : value >= limit;
  return { id, number, status: pass ? 'pass' : 'fail', value, unit: 'pct', count: numerator, total, op, limit, offenders };
}

function countCheck(id: DcmaCheckId, number: number, offenders: DcmaOffender[], total: number, limit: number, na: DcmaNaReason): DcmaCheck {
  if (total === 0) return { id, number, status: 'na', value: null, unit: 'count', count: null, total: 0, op: '≤', limit, naReason: na, offenders: [] };
  return { id, number, status: offenders.length <= limit ? 'pass' : 'fail', value: offenders.length, unit: 'count', count: offenders.length, total, op: '≤', limit, offenders };
}

const naIndex = (id: DcmaCheckId, number: number, limit: number, naReason: DcmaNaReason): DcmaCheck =>
  ({ id, number, status: 'na', value: null, unit: 'index', count: null, total: null, op: '≥', limit, naReason, offenders: [] });

/** Runs the 14 checks. */
export function dcmaAssessment(input: QualityInput): DcmaReport {
  const th = input.thresholds;
  const { dataDate } = input;
  const byId = new Map(input.activities.map((a) => [a.id, a]));
  const open = input.activities.filter((a) => !isComplete(a));
  const openIds = new Set(open.map((a) => a.id));
  const known = input.links.filter((l) => byId.has(l.pred) && byId.has(l.succ));
  const rels = known.filter((l) => openIds.has(l.succ));
  const hasPred = new Set(known.map((l) => l.succ));
  const hasSucc = new Set(known.map((l) => l.pred));
  const linkOf = (l: QualityLink): DcmaOffender => ({ kind: 'link', pred: l.pred, succ: l.succ, type: l.type, lag: l.lag });

  // 1 · Logic. The project's start (the only activity without predecessor) and finish (the only one without successor) are
  // the network's ends, not gaps.
  const noPred = input.activities.filter((a) => !hasPred.has(a.id));
  const noSucc = input.activities.filter((a) => !hasSucc.has(a.id));
  const startEnd = noPred.length === 1 ? noPred[0].id : null;
  const finishEnd = noSucc.length === 1 ? noSucc[0].id : null;
  const logicOff: DcmaOffender[] = [];
  for (const a of open) {
    const p = !hasPred.has(a.id) && a.id !== startEnd;
    const s = !hasSucc.has(a.id) && a.id !== finishEnd;
    if (p || s) logicOff.push({ kind: 'activity', id: a.id, note: p && s ? DCMA_NOTES.noLinks : p ? DCMA_NOTES.noPredecessor : DCMA_NOTES.noSuccessor });
  }

  // 2–4 · Relationships to incomplete activities.
  const leads = rels.filter((l) => l.lag < 0).map(linkOf);
  const lags = rels.filter((l) => l.lag > 0).map(linkOf);
  const nonFs = rels.filter((l) => l.type !== 'FS').map(linkOf);
  const fsCount = rels.length - nonFs.length;

  // 5 · Hard constraints.
  const hard = open.filter((a) => a.constraintType && HARD_CONSTRAINTS.includes(a.constraintType)).map((a): DcmaOffender => ({ kind: 'activity', id: a.id }));

  // 6, 7 · Float (as published; an activity without a computed float is not counted).
  const highFloat = open.filter((a) => a.totalFloat != null && a.totalFloat > th.highFloatDays).map((a): DcmaOffender => ({ kind: 'activity', id: a.id, value: a.totalFloat! }));
  const negFloat = open.filter((a) => a.totalFloat != null && a.totalFloat < 0).map((a): DcmaOffender => ({ kind: 'activity', id: a.id, value: a.totalFloat! }));

  // 8 · Duration (original duration).
  const highDur = open.filter((a) => a.duration > th.highDurationDays).map((a): DcmaOffender => ({ kind: 'activity', id: a.id, value: a.duration }));

  // 9 · Invalid dates.
  const invalid: DcmaOffender[] = [];
  for (const a of input.activities) {
    const started = isStarted(a);
    const complete = isComplete(a);
    let note: DcmaOffenderNote | null = null;
    if (complete && a.finishDate && a.finishDate > dataDate) note = DCMA_NOTES.actualFinishAfter;
    else if (started && a.startDate && a.startDate > dataDate) note = DCMA_NOTES.actualStartAfter;
    else if (!started && a.startDate && a.startDate < dataDate) note = DCMA_NOTES.startBeforeDataDate;
    else if (!complete && a.finishDate && a.finishDate < dataDate) note = DCMA_NOTES.finishBeforeDataDate;
    if (note) invalid.push({ kind: 'activity', id: a.id, note });
  }

  // 10 · Resources (activities with a duration).
  const loadable = open.filter((a) => a.duration > 0);
  const unloaded = loadable.filter((a) => !a.resourced).map((a): DcmaOffender => ({ kind: 'activity', id: a.id }));

  const checks: DcmaCheck[] = [
    ratioCheck('logic', 1, logicOff, open.length, '≤', th.logicPct, DCMA_NA.noIncomplete),
    countCheck('leads', 2, leads, rels.length, th.leadsCount, DCMA_NA.noRelationship),
    ratioCheck('lags', 3, lags, rels.length, '≤', th.lagsPct, DCMA_NA.noRelationship),
    ratioCheck('relationshipTypes', 4, nonFs, rels.length, '≥', th.fsMinPct, DCMA_NA.noRelationship, fsCount),
    ratioCheck('hardConstraints', 5, hard, open.length, '≤', th.hardConstraintsPct, DCMA_NA.noIncomplete),
    { ...ratioCheck('highFloat', 6, highFloat, open.length, '≤', th.highFloatPct, DCMA_NA.noIncomplete), limitDays: th.highFloatDays },
    countCheck('negativeFloat', 7, negFloat, open.length, th.negativeFloatCount, DCMA_NA.noIncomplete),
    { ...ratioCheck('highDuration', 8, highDur, open.length, '≤', th.highDurationPct, DCMA_NA.noIncomplete), limitDays: th.highDurationDays },
    countCheck('invalidDates', 9, invalid, input.activities.length, th.invalidDatesCount, DCMA_NA.noIncomplete),
    ratioCheck('resources', 10, unloaded, loadable.length, '≤', th.resourcesPct, DCMA_NA.noLoaded),
    missedTasks(input),
    criticalPathCheck(input.cpt),
    cpli(input),
    bei(input),
  ];
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  return { checks, passed, failed, notApplicable: checks.length - passed - failed, incomplete: open.length, relationships: rels.length };
}

/** Activities of the reference baseline due by the data date (baseline finish ≤ data date). */
const dueActivities = (input: QualityInput) => input.activities.filter((a) => a.baselineFinish != null && a.baselineFinish <= input.dataDate);

/** 11 · Missed activities: due by the data date and not finished on or before their baseline finish. */
function missedTasks(input: QualityInput): DcmaCheck {
  const limit = input.thresholds.missedTasksPct;
  if (!input.baseline?.hasActivities) return { id: 'missedTasks', number: 11, status: 'na', value: null, unit: 'pct', count: null, total: null, op: '≤', limit, naReason: DCMA_NA.noBaseline, offenders: [] };
  const due = dueActivities(input);
  const missed: DcmaOffender[] = [];
  for (const a of due) {
    if (!isComplete(a)) missed.push({ kind: 'activity', id: a.id, note: DCMA_NOTES.notFinished });
    else if (a.finishDate && a.finishDate > a.baselineFinish!) missed.push({ kind: 'activity', id: a.id, note: DCMA_NOTES.finishedLate });
  }
  return ratioCheck('missedTasks', 11, missed, due.length, '≤', limit, DCMA_NA.noneDue);
}

/** 12 · Critical path test. */
function criticalPathCheck(cpt: CriticalPathTestOutcome | null): DcmaCheck {
  const base = { id: 'criticalPathTest' as const, number: 12, unit: 'test' as const, count: null, total: null, op: '=' as const, offenders: [] as DcmaOffender[] };
  if (!cpt || cpt.kind === 'invalid') return { ...base, status: 'na', value: null, limit: 0, naReason: DCMA_NA.notRun };
  if (cpt.kind === 'cycle') return { ...base, status: 'fail', value: null, limit: 0, naReason: DCMA_NA.cycle, offenders: cpt.cycle.slice(0, -1).map((id) => ({ kind: 'activity', id })) };
  if (cpt.kind === 'no_critical') return { ...base, status: 'na', value: null, limit: 0, naReason: DCMA_NA.noCritical };
  const pass = cpt.slip >= cpt.delay - cpt.tolerance;
  return { ...base, status: pass ? 'pass' : 'fail', value: cpt.slip, limit: cpt.delay, offenders: [{ kind: 'activity', id: cpt.activity, value: cpt.slip }] };
}

/** Latest current finish over the activities (the forecast project finish). */
export function forecastFinish(activities: readonly Pick<QualityActivity, 'finishDate'>[]): IsoDate | null {
  let f: IsoDate | null = null;
  for (const a of activities) if (a.finishDate && (!f || a.finishDate > f)) f = a.finishDate;
  return f;
}

/**
 * 13 · CPLI = (CPL + TF) / CPL: CPL = working days from the data date to the forecast finish (project calendar), TF = working
 * days from the forecast finish to the baseline finish (negative when late).
 */
function cpli(input: QualityInput): DcmaCheck {
  const limit = input.thresholds.cpliMin;
  const bf = input.baseline?.finish ?? null;
  if (!bf) return naIndex('cpli', 13, limit, DCMA_NA.noBaselineFinish);
  const open = input.activities.filter((a) => !isComplete(a));
  if (!open.length) return naIndex('cpli', 13, limit, DCMA_NA.noIncomplete);
  const ff = forecastFinish(input.activities);
  if (!ff) return naIndex('cpli', 13, limit, DCMA_NA.noIncomplete);
  const cal = input.calendar;
  const cpl = cal.finishBoundary(ff) - cal.startBoundary(input.dataDate);
  if (cpl <= 0) return naIndex('cpli', 13, limit, DCMA_NA.complete);
  const tf = cal.finishBoundary(bf) - cal.finishBoundary(ff);
  const value = round2((cpl + tf) / cpl);
  return { id: 'cpli', number: 13, status: value >= limit ? 'pass' : 'fail', value, unit: 'index', count: cpl + tf, total: cpl, op: '≥', limit, offenders: [] };
}

/** 14 · BEI = activities completed / activities with a baseline finish on or before the data date. */
function bei(input: QualityInput): DcmaCheck {
  const limit = input.thresholds.beiMin;
  if (!input.baseline?.hasActivities) return naIndex('bei', 14, limit, DCMA_NA.noBaseline);
  const due = dueActivities(input);
  if (!due.length) return naIndex('bei', 14, limit, DCMA_NA.noneDue);
  const completed = input.activities.filter((a) => isComplete(a)).length;
  const value = round2(completed / due.length);
  const offenders = due.filter((a) => !isComplete(a)).map((a): DcmaOffender => ({ kind: 'activity', id: a.id, note: DCMA_NOTES.notFinished }));
  return { id: 'bei', number: 14, status: value >= limit ? 'pass' : 'fail', value, unit: 'index', count: completed, total: due.length, op: '≥', limit, offenders };
}
