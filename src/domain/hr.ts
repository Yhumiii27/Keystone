// HR area — rate cards, skills matrix, leave & working calendar, Lucca hours reconciliation (docs/spec/06 §2–§5).
// Pure functions reproducing the prototype logic (design lines 4381–4404 and 5008–5018). They return English
// source strings and flags (`lo` = value in the attention colour); src/features/hr maps them to tokens and t().

// ── Rate cards (§2, logic 4381–4389) ─────────────────────────────────────────────────────────────────────

/**
 * Roles allowed to see rate values (`canSeeRates`, line 4382): the director and the PMs, and Finance (R-044, P-12 c) — the
 * rate card, the task cost note, the what-if helpers and the exports.
 */
export const RATE_VIEWER_ROLES = ['director', 'pm', 'finance'] as const;
export const canSeeRates = (role: string) => (RATE_VIEWER_ROLES as readonly string[]).includes(role);
/** Roles allowed to edit the rate grid — base rates, coefficients, "Add role" (P-12 c, R-044): the director and Finance; PMs read. */
export const RATE_EDITOR_ROLES = ['director', 'finance'] as const;
export const canEditRates = (role: string) => (RATE_EDITOR_ROLES as readonly string[]).includes(role);

/** Masked value placeholder. */
export const MASK = '•••';

/** Roles of the "Contractor premium" KPI (hard-wired names in the prototype). */
export const CONTRACTOR_ROLE = 'Contractor — structural (external)';
export const INTERNAL_REFERENCE_ROLE = 'Structural engineer';

/** Standard working week (KPI "Standard week", leave basis). */
export const WEEK_HOURS = 35;
/** Working hours of one leave day. */
export const DAY_HOURS = 7;
/** Working days of a week. */
export const WEEK_DAYS = 5;

export const isExternalRole = (role: string) => /external/.test(role);

/**
 * `eur(v)` (line 4383): rounded to 2 decimals, French number format whatever the UI language (0–2 decimals),
 * suffix " €" — "106,25 €", "115 €", "119,6 €". Thousands use the fr-FR narrow no-break space.
 */
export function eurRate(v: number): string {
  const r = Math.round(v * 100) / 100;
  const neg = r < 0;
  const [int, dec] = Math.abs(r).toFixed(2).split('.');
  const intFr = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const decFr = dec.replace(/0+$/, '');
  return `${neg ? '-' : ''}${intFr}${decFr ? ',' + decFr : ''} €`;
}

/** Rate input parsing (`setRate` / `setMult`, lines 4384–4385): `parseFloat`, NaN → 0. */
export function parseRateInput(raw: string): number {
  const v = parseFloat(raw);
  return Number.isNaN(v) ? 0 : v;
}

export interface RateRoleInput {
  role: string;
  baseRateEur: number;
}

export interface MultiplierInput {
  key: string;
  label: string;
  factor: number;
}

/** Multiplied rates of a role, one per multiplier in order (base × factor). */
export const multipliedRates = (base: number, mults: MultiplierInput[]) => mults.map((m) => base * m.factor);

/** Hint under a multiplier label (`multRows`, line 4387). */
export const multiplierHint = (key: string) => (key === 'oncall' ? '× base, per hour on call' : '× base rate');

export interface RateKpis {
  /** Mean base rate of the internal roles (72.33 with the seed). */
  avgInternalRate: number;
  internalCount: number;
  /** Contractor premium in % (rounded), null when either reference role is missing or zero. */
  contractorPremiumPct: number | null;
  /** Sunday / public holiday multiplier (`mults.sun`). */
  weekendMultiplier: number | null;
}

/**
 * `rateKpis` (line 4389). Average internal rate = Σ internal base rates ÷ number of internal roles (the prototype
 * divides by `RATE_ROLES.length − 1`, which is the same while there is exactly one external role).
 */
export function rateKpis(roles: RateRoleInput[], mults: MultiplierInput[]): RateKpis {
  const internal = roles.filter((r) => !isExternalRole(r.role));
  const avg = internal.length ? internal.reduce((a, r) => a + (r.baseRateEur || 0), 0) / internal.length : 0;
  const rate = (name: string) => roles.find((r) => r.role === name)?.baseRateEur;
  const ext = rate(CONTRACTOR_ROLE);
  const ref = rate(INTERNAL_REFERENCE_ROLE);
  const premium = ext != null && ref ? Math.round((ext / ref - 1) * 100) : null;
  const sun = mults.find((m) => m.key === 'sun');
  return { avgInternalRate: avg, internalCount: internal.length, contractorPremiumPct: premium, weekendMultiplier: sun ? sun.factor : null };
}

/** "+39%" (sign only when positive, as the prototype always prints "+"; a negative premium keeps its "-"). */
export const premiumText = (pct: number) => (pct >= 0 ? '+' : '') + pct + '%';

// ── Dated rate grid and one valuation of hours (R-083: A-10, R-4a, R-4b) ─────────────────────────────────────────

/** One version of a rate or a factor: in force from `effectiveFrom` (ISO) until the next version. */
export interface DatedValue {
  effectiveFrom: string;
  value: number;
}

/** The version in force on `date` (ISO): the latest one effective on or before it; null before the first (not valued). */
export function versionAt<V extends { effectiveFrom: string }>(versions: readonly V[], date: string): V | null {
  let hit: V | null = null;
  for (const v of versions) if (v.effectiveFrom <= date && (!hit || v.effectiveFrom > hit.effectiveFrom)) hit = v;
  return hit;
}

export interface GridRole {
  id: string;
  /** "Planner" — typed text of the grid (shown with dataText). */
  role: string;
  isExternal: boolean;
  costCenter: string | null;
  grade: string | null;
  /** Base €/h versions, oldest first. */
  versions: DatedValue[];
}

export interface GridMultiplier {
  key: string;
  /** EN source string ("Overtime > 8 h/day"). */
  label: string;
  /** Factor versions, oldest first. */
  versions: DatedValue[];
}

/** The rate grid with every version (the DAL reader `getRateGrid`). */
export interface RateGrid {
  /** RATE_ROLES order. */
  roles: GridRole[];
  /** MULTS order. */
  multipliers: GridMultiplier[];
}

/**
 * A-10: the base €/h of a grid role (by id or name) in force on `date`; null for an unknown role or a date before its first
 * version — "not valued", never an invented rate (R-4a).
 */
export function rateAt(grid: Pick<RateGrid, 'roles'>, role: string | null | undefined, date: string): number | null {
  if (!role) return null;
  const r = grid.roles.find((x) => x.id === role) ?? grid.roles.find((x) => x.role === role);
  return r ? (versionAt(r.versions, date)?.value ?? null) : null;
}

/** A-10: the factor of a premium multiplier in force on `date`; null when unknown or not in force yet. */
export function multiplierAt(grid: Pick<RateGrid, 'multipliers'>, key: string, date: string): number | null {
  const m = grid.multipliers.find((x) => x.key === key);
  return m ? (versionAt(m.versions, date)?.value ?? null) : null;
}

/** The grid as it stands on `date`: each role's base rate and each multiplier's factor in force (0 when none yet — KPIs only). */
export function gridOn(grid: RateGrid, date: string): { roles: RateRoleInput[]; multipliers: MultiplierInput[] } {
  return {
    roles: grid.roles.map((r) => ({ role: r.role, baseRateEur: versionAt(r.versions, date)?.value ?? 0 })),
    multipliers: grid.multipliers.map((m) => ({ key: m.key, label: m.label, factor: versionAt(m.versions, date)?.value ?? 0 })),
  };
}

/** Lowest and highest effective date an edit may take (the grid's dates are ISO days; R-4a dates every change). */
export const RATE_DATE_MIN = '2000-01-01';
export const RATE_DATE_MAX = '2099-12-31';
const isIsoDay = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
/** An effective date sent by the rate card (ISO "2026-11-01") within the accepted range; null otherwise. */
export const parseEffectiveDate = (v: unknown): string | null => (isIsoDay(v) && v >= RATE_DATE_MIN && v <= RATE_DATE_MAX ? v : null);

/**
 * Audit line of a dated rate change (R-083): "Planner base: 74 → 78 €/h from 1 Nov 2026", "Saturday multiplier: ×1.5 → ×1.6
 * from 1 Jan 2027"; "(backdated)" when the date is before the business date (an earlier valuation changes).
 */
export function rateChangeText(subject: string, from: number | null, to: number, unit: '€/h' | '×', effectiveText: string, backdated: boolean): string {
  const v = (x: number | null) => (x == null ? '—' : unit === '×' ? `×${x}` : String(x));
  const tail = unit === '×' ? '' : ' €/h';
  return `${subject}: ${v(from)} → ${v(to)}${tail} from ${effectiveText}${backdated ? ' (backdated)' : ''}`;
}

export interface TaskCostInput {
  /** Hours logged on the task (the stored total). */
  loggedH: number;
  /** Time entries, each valued at the rate of the person who logged it on the entry's date (null: no rate role / no version). */
  entries: readonly { hours: number; rateEur: number | null }[];
  /** Rate in force today of the task's assignee: the logged hours without an entry (the seed's totals) are valued at it. */
  restRateEur: number | null;
}

export interface TaskCost {
  /** Actual labour cost (€, rounded); null when an hour has no rate ("rate missing"). */
  cost: number | null;
  /** The single €/h when every valued hour has the same rate (the note shows "h × rate"); null otherwise. */
  rate: number | null;
  /** Some hours have no rate: the person has no grid role, or the grid has no version on that date (R-4a). */
  missing: boolean;
}

/**
 * The task cost note's valuation (A-10, R-083 — replaces the job-title rates and the 100 €/h default): every time entry at the
 * rate of the person who logged it on the entry's date, the logged hours without an entry at the assignee's rate in force today.
 */
export function taskLaborCost(i: TaskCostInput): TaskCost {
  const entered = i.entries.reduce((a, e) => a + e.hours, 0);
  const rest = Math.max(0, i.loggedH - entered);
  const parts = [...i.entries.filter((e) => e.hours > 0).map((e) => ({ hours: e.hours, rate: e.rateEur })), ...(rest > 0 ? [{ hours: rest, rate: i.restRateEur }] : [])];
  if (parts.some((p) => p.rate == null)) return { cost: null, rate: null, missing: true };
  const rates = new Set(parts.map((p) => p.rate as number));
  const cost = Math.round(parts.reduce((a, p) => a + p.hours * (p.rate as number), 0));
  return { cost, rate: rates.size === 1 ? [...rates][0] : rates.size === 0 ? i.restRateEur : null, missing: false };
}

/**
 * The cost note while the sheet is open: hours logged since the page was read (`extraH`) are valued at today's rate until the
 * server recomputes the note.
 */
export function liveTaskCost(note: TaskCost & { todayRate: number | null }, extraH: number): TaskCost {
  if (extraH <= 0 || note.missing) return { cost: note.cost, rate: note.rate, missing: note.missing };
  if (note.todayRate == null) return { cost: null, rate: null, missing: true };
  const cost = Math.round((note.cost ?? 0) + extraH * note.todayRate);
  const sameRate = note.cost === 0 && note.rate == null ? note.todayRate : note.rate === note.todayRate ? note.rate : null;
  return { cost, rate: sameRate, missing: false };
}

// ── Skills matrix (§3, logic 4390–4396) ─────────────────────────────────────────────────────────────────

/** Expert threshold (level 4–5) and the matrix filter threshold (level ≥ 3). */
export const EXPERT_LEVEL = 4;
export const ABLE_LEVEL = 3;
/** A skill is a single point of failure when it has fewer than 2 experts. */
export const MIN_EXPERTS = 2;

/** Dot colour token of a level (`lvColor`, line 4392): ≥4 accent-400 · 3 accent-600 · 2 accent-800 · 1 neutral-800 · 0 none. */
export type LevelTone = 'accent-400' | 'accent-600' | 'accent-800' | 'neutral-800' | 'none';
export function levelTone(v: number): LevelTone {
  if (v >= 4) return 'accent-400';
  if (v === 3) return 'accent-600';
  if (v === 2) return 'accent-800';
  if (v === 1) return 'neutral-800';
  return 'none';
}

/** The 5 dots of a cell: dot d (1..5) is filled when d ≤ level (empty dots take the cell colour). */
export const levelDots = (v: number) => [1, 2, 3, 4, 5].map((d) => d <= v);

export interface SkillPersonInput {
  name: string;
  /** Level per skill (aligned with the skill list; 0 = none). */
  levels: number[];
}

export interface SkillCoverage {
  name: string;
  experts: number;
  able: number;
  /** Fewer than 2 experts (the coverage list's flag, unchanged). */
  gap: boolean;
  /** R-5b: nobody at level ≥ 4. */
  noExpert: boolean;
  /** R-5b: exactly one person at level ≥ 4. */
  singleExpert: boolean;
  /** "No expert · 1 at level ≥3" / "1 expert · 1 at level ≥3" / "2 experts · 3 at level ≥3" (R-5b names the case). */
  text: string;
}

/** Coverage text of a skill: the number of experts — "No expert" when none (R-5b) — and the people at level ≥ 3. */
export const coverageText = (experts: number, able: number) =>
  `${experts === 0 ? 'No expert' : `${experts} expert${experts === 1 ? '' : 's'}`} · ${able} at level ≥3`;

/** `coverage` (line 4394); R-5b: the two cases under 2 experts are told apart (no expert / a single expert). */
export function skillCoverage(skills: string[], people: SkillPersonInput[]): SkillCoverage[] {
  return skills.map((name, i) => {
    const lv = people.map((p) => p.levels[i] || 0);
    const experts = lv.filter((v) => v >= EXPERT_LEVEL).length;
    const able = lv.filter((v) => v >= ABLE_LEVEL).length;
    return { name, experts, able, gap: experts < MIN_EXPERTS, noExpert: experts === 0, singleExpert: experts === 1, text: coverageText(experts, able) };
  });
}

/** `skillRows` filter (line 4393): everyone, or people at level ≥ 3 on the filtered skill. */
export function filterBySkill<P extends SkillPersonInput>(people: P[], skill: number | null): P[] {
  return skill == null ? people : people.filter((p) => (p.levels[skill] || 0) >= ABLE_LEVEL);
}

/** Parses the `?filter=` skill index; anything else (or out of range) → null ("Everyone"). */
export function parseSkillFilter(raw: string | string[] | undefined, count: number): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v == null || !/^\d+$/.test(v)) return null;
  const n = parseInt(v, 10);
  return n < count ? n : null;
}

export interface SkillKpis {
  families: number;
  /** R-5b: skills nobody masters at level ≥ 4 (2 with the seed). */
  noExpert: number;
  /** R-5b: skills exactly one person masters at level ≥ 4 (6 with the seed; the prototype's tile counted both cases: 8). */
  singleExpert: number;
  certifications: number;
}

/**
 * `skillKpis` (line 4396) computed values. The last tile, "Open requests needing level ≥4", is computed by the page from the
 * pending requests (A-12, domain/resources `requestsNeedingExperts`); the prototype's constant "2 · Structural · Quality" is gone.
 * R-5b: two indicators instead of the prototype's single "Single-expert skills" (< 2 experts).
 */
export function skillKpis(coverage: SkillCoverage[], peopleWithCerts: number): SkillKpis {
  return {
    families: coverage.length,
    noExpert: coverage.filter((c) => c.noExpert).length,
    singleExpert: coverage.filter((c) => c.singleExpert).length,
    certifications: peopleWithCerts,
  };
}

// ── Leave & working calendar (§4, logic 4398–4404) ──────────────────────────────────────────────────────

/** Leave type shown in the cell (NEW-CURSUS-4, R-173: "Leave" or "Absence" — never the reason of an absence). */
export type LeaveLabel = 'Leave' | 'Absence';

export interface LeaveWeekInput {
  /** Leave label of the week, null when none. */
  type: LeaveLabel | string | null;
  /** Working days lost to that leave (LEAVE_DAYS). */
  days: number;
  /** Weekday public holidays in the week. */
  holidays: number;
}

/**
 * Cell look: absence → accent-800/accent-200 (the prototype's sick-leave look) · leave → accent-900/accent-200 · holiday →
 * neutral-800 · none → neutral-900.
 */
export type LeaveCellTone = 'absence' | 'leave' | 'holiday' | 'none';

export interface LeaveCell {
  /** "Leave" / "Absence" / "Hol." / '' (EN source). */
  label: string;
  tone: LeaveCellTone;
  /** Available hours in the week: max(0, 5 − days off) × 7. */
  hours: number;
}

export interface LeaveRow {
  cells: LeaveCell[];
  /** Σ leave days (holidays excluded). */
  days: number;
  /** Σ available hours. */
  availH: number;
  /** round(Σ availH ÷ (weeks × 35) × 100). */
  availPct: number;
  /** Availability ratio under 70 % → LO. */
  lo: boolean;
}

/** One week cell (`leaveRows`, line 4400): leave wins over the holiday label, but both are deducted. */
export function leaveCell(w: LeaveWeekInput): LeaveCell {
  const t = w.type || null;
  const hol = w.holidays > 0;
  const daysOff = (t ? w.days : 0) + w.holidays;
  const hours = Math.max(0, WEEK_DAYS - daysOff) * DAY_HOURS;
  const tone: LeaveCellTone = t === 'Absence' ? 'absence' : t ? 'leave' : hol ? 'holiday' : 'none';
  return { label: t ?? (hol ? 'Hol.' : ''), tone, hours };
}

export function leaveRow(weeks: LeaveWeekInput[]): LeaveRow {
  const cells = weeks.map(leaveCell);
  const days = weeks.reduce((a, w) => a + (w.type ? w.days : 0), 0);
  const availH = cells.reduce((a, c) => a + c.hours, 0);
  const basis = weeks.length * WEEK_HOURS;
  const ratio = basis ? availH / basis : 0;
  return { cells, days, availH, availPct: Math.round(ratio * 100), lo: ratio < 0.7 };
}

export interface LeaveKpis {
  /** Mean of the rounded row percentages, rounded. */
  teamAvailabilityPct: number;
  leaveDays: number;
  /** Weeks where Σ available hours ÷ (35 × people) < 0.6. */
  weeksUnder60: number;
}

/** `leaveKpis` (line 4403). */
export function leaveKpis(rows: LeaveRow[], weekCount: number): LeaveKpis {
  const n = rows.length;
  const team = n ? rows.reduce((a, r) => a + r.availPct, 0) / n : 0;
  let under = 0;
  for (let i = 0; i < weekCount; i++) {
    const h = rows.reduce((a, r) => a + (r.cells[i]?.hours ?? 0), 0);
    if (n && h / (WEEK_HOURS * n) < 0.6) under++;
  }
  return { teamAvailabilityPct: Math.round(team), leaveDays: rows.reduce((a, r) => a + r.days, 0), weeksUnder60: under };
}

// ── Hours — Lucca reconciliation (§5, logic 5008–5018) ──────────────────────────────────────────────────

// R-083 (A-10): the variance KPI is valued at each person's grid rate on the import's month (`HOURS_VALUATION_RATE`, the
// prototype's flat 62 €/h, is retired).

/**
 * R-088 (R-6b): the hours-variance threshold of Settings (app_settings "hours.variance" = { pct }), an integer % of the planned
 * hours, 1–50, default 10. The same threshold flags lines and groups both ways and the Variance KPI.
 */
export const HOURS_VARIANCE_DEFAULT = 10;
export const HOURS_VARIANCE_MIN = 1;
export const HOURS_VARIANCE_MAX = 50;
export const isHoursVariancePct = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= HOURS_VARIANCE_MIN && v <= HOURS_VARIANCE_MAX;
/** Where the threshold applies (Settings, EN source; FR in d8-roles-rates-hr.json). */
export const HOURS_VARIANCE_RULE = 'Lines at or beyond ± this share of their planned hours are flagged, over and under · Hours (Lucca)';
/** The stored setting → its threshold; a missing or invalid row (databases seeded before delivery 8) → the default 10. */
export const usableHoursVariance = (stored: unknown): number => {
  const pct = stored && typeof stored === 'object' ? (stored as { pct?: unknown }).pct : undefined;
  return isHoursVariancePct(pct) ? pct : HOURS_VARIANCE_DEFAULT;
};
/** A threshold typed in Settings ("10", " 7 ", 12): an integer 1–50; null otherwise (decimals refused). */
export function parseHoursVarianceInput(raw: unknown): number | null {
  const v = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d{1,3}\s*$/.test(raw) ? Number(raw.trim()) : NaN;
  return isHoursVariancePct(v) ? v : null;
}

export type HoursView = 'resource' | 'wp' | 'unassigned';
export const HOURS_VIEWS: HoursView[] = ['resource', 'wp', 'unassigned'];
export const parseHoursView = (raw: string | string[] | undefined): HoursView => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (HOURS_VIEWS as string[]).includes(v ?? '') ? (v as HoursView) : 'resource';
};

/**
 * Variance tone (R-6b): declared over plan by the threshold or more → over; under plan by the threshold or more → under (a
 * distinct, less alarming look — the prototype read every under-declaration like an overrun, 06 OQ10); otherwise ok.
 */
export type VarianceTone = 'over' | 'under' | 'ok';

export interface HoursVariance {
  /** Declared − planned. */
  varH: number;
  /** "+23 h" / "-10 h" / "0 h" (ASCII minus, as the prototype). */
  varText: string;
  tone: VarianceTone;
  /** Bar width in % (min(100, round(d ÷ max(p,1) × 100))). */
  barPct: number;
  /** Declared over plan by the threshold or more → accent-700 bar, else accent. */
  barOver: boolean;
}

/** Hours in hundredths (integers): the inclusive comparisons never meet float rounding (110 × 1.1 = 121.00000000000001). */
const centi = (h: number) => Math.round(h * 100);

/**
 * Variance of a line or a group (lines 5010–5012; R-6b): one symmetric threshold `pct` (% of planned), inclusive, compared in
 * integers — over when declared − planned ≥ planned × pct / 100, under when planned − declared ≥ planned × pct / 100; no
 * variance is ok (0 / 0 included); a line planned at 0 with hours declared is over.
 */
export function hoursVariance(planned: number, declared: number, pct: number = HOURS_VARIANCE_DEFAULT): HoursVariance {
  const v = declared - planned;
  const P = centi(planned);
  const V = centi(declared) - P;
  const over = V > 0 && V * 100 >= P * pct;
  const under = V < 0 && -V * 100 >= P * pct;
  return {
    varH: v,
    varText: (v > 0 ? '+' : '') + v + ' h',
    tone: over ? 'over' : under ? 'under' : 'ok',
    barPct: Math.min(100, Math.round((declared / Math.max(planned, 1)) * 100)),
    barOver: over,
  };
}

export interface HoursKpiInput {
  /** Matched lines; `rateEur` = the person's grid rate in force on the import's month (null: not valued — R-083). */
  lines: { plannedH: number; declaredH: number; rateEur?: number | null }[];
  /** Hours still to assign (lines without a planned task). */
  unassigned: { hours: number }[];
  /** All hours declared without a planned task, assigned since or not (part of the Lucca total). */
  unassignedTotalH?: number;
  /** R-6b threshold (% of planned); default 10. */
  thresholdPct?: number;
}

export interface HoursKpis {
  /** Σ declared + Σ hours without a planned task → "779 h". */
  declaredTotalH: number;
  plannedH: number;
  matchedDeclaredH: number;
  lineCount: number;
  /** Σ declared − Σ planned of the matched lines → +12. */
  varianceH: number;
  /** round(variance ÷ planned × 100), 0 when nothing is planned. */
  variancePct: number;
  /**
   * A-10 (R-083): Σ per line (declared − planned) × the person's rate on the import's month, in k€ rounded (the prototype's flat
   * 62 €/h is retired). Lines without a rate are left out (`unvaluedLines`).
   */
  varianceCostK: number;
  /** Lines whose person has no grid role or rate on that month (not valued). */
  unvaluedLines: number;
  /** R-6b: the variance reaches the threshold of planned, either way (the prototype flagged over 5 % only). */
  varianceLo: boolean;
  toAssignH: number;
  toAssignCount: number;
}

/** `hrKpis` (line 5016). */
export function hoursKpis(i: HoursKpiInput): HoursKpis {
  const planned = i.lines.reduce((a, l) => a + l.plannedH, 0);
  const declared = i.lines.reduce((a, l) => a + l.declaredH, 0);
  const toAssign = i.unassigned.reduce((a, u) => a + u.hours, 0);
  const un = i.unassignedTotalH ?? toAssign;
  const v = declared - planned;
  const valued = i.lines.filter((l) => l.rateEur != null);
  const costEur = valued.reduce((a, l) => a + (l.declaredH - l.plannedH) * (l.rateEur as number), 0);
  return {
    declaredTotalH: declared + un,
    plannedH: planned,
    matchedDeclaredH: declared,
    lineCount: i.lines.length,
    varianceH: v,
    variancePct: planned ? Math.round((v / planned) * 100) : 0,
    varianceCostK: Math.round(costEur / 1000),
    unvaluedLines: i.lines.length - valued.length,
    varianceLo: hoursVariance(planned, declared, i.thresholdPct ?? HOURS_VARIANCE_DEFAULT).tone !== 'ok',
    toAssignH: toAssign,
    toAssignCount: i.unassigned.length,
  };
}

/** "J. Wagner" form of a person name (by-WP sub-line, line 5012). */
export const abbreviatedName = (name: string) =>
  name
    .split(' ')
    .map((w, i) => (i ? w : w[0] + '.'))
    .join(' ');
