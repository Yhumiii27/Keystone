// HR area — rate cards, skills matrix, leave & working calendar, Lucca hours reconciliation (docs/spec/06 §2–§5).
// Pure functions reproducing the prototype logic (design lines 4381–4404 and 5008–5018). They return English
// source strings and flags (`lo` = value in the attention colour); src/features/hr maps them to tokens and t().

// ── Rate cards (§2, logic 4381–4389) ─────────────────────────────────────────────────────────────────────

/** Roles allowed to see and edit rate values (`canSeeRates`, line 4382). */
export const RATE_VIEWER_ROLES = ['director', 'pm'] as const;
export const canSeeRates = (role: string) => (RATE_VIEWER_ROLES as readonly string[]).includes(role);

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
  gap: boolean;
  /** "1 expert · 1 at level ≥3" / "2 experts · 3 at level ≥3". */
  text: string;
}

/** `coverage` (line 4394). */
export function skillCoverage(skills: string[], people: SkillPersonInput[]): SkillCoverage[] {
  return skills.map((name, i) => {
    const lv = people.map((p) => p.levels[i] || 0);
    const experts = lv.filter((v) => v >= EXPERT_LEVEL).length;
    const able = lv.filter((v) => v >= ABLE_LEVEL).length;
    return { name, experts, able, gap: experts < MIN_EXPERTS, text: `${experts} expert${experts === 1 ? '' : 's'} · ${able} at level ≥3` };
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
  singleExpert: number;
  certifications: number;
}

/**
 * `skillKpis` (line 4396) computed values. The 4th tile, "Open requests needing level ≥4", is computed by the page from the
 * pending requests (A-12, domain/resources `requestsNeedingExperts`); the prototype's constant "2 · Structural · Quality" is gone.
 */
export function skillKpis(coverage: SkillCoverage[], peopleWithCerts: number): SkillKpis {
  return { families: coverage.length, singleExpert: coverage.filter((c) => c.gap).length, certifications: peopleWithCerts };
}

// ── Leave & working calendar (§4, logic 4398–4404) ──────────────────────────────────────────────────────

/** Leave code shown in the cell ("CP", "RTT", "Sick", "Training"). */
export type LeaveLabel = 'CP' | 'RTT' | 'Sick' | 'Training';

export interface LeaveWeekInput {
  /** Leave label of the week, null when none. */
  type: LeaveLabel | string | null;
  /** Working days lost to that leave (LEAVE_DAYS). */
  days: number;
  /** Weekday public holidays in the week. */
  holidays: number;
}

/** Cell look: sick → accent-800/accent-200 · other leave → accent-900/accent-200 · holiday → neutral-800 · none → neutral-900. */
export type LeaveCellTone = 'sick' | 'leave' | 'holiday' | 'none';

export interface LeaveCell {
  /** "CP" / "Training" / "Hol." / '' (EN source). */
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
  const tone: LeaveCellTone = t === 'Sick' ? 'sick' : t ? 'leave' : hol ? 'holiday' : 'none';
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

/** Flat valuation rate of the variance KPI (`hrRate`, line 5015; independent of the rate card — 06 OQ7). */
export const HOURS_VALUATION_RATE = 62;

export type HoursView = 'resource' | 'wp' | 'unassigned';
export const HOURS_VIEWS: HoursView[] = ['resource', 'wp', 'unassigned'];
export const parseHoursView = (raw: string | string[] | undefined): HoursView => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (HOURS_VIEWS as string[]).includes(v ?? '') ? (v as HoursView) : 'resource';
};

/** Variance colour: over by > 10 % and under plan both read in accent-300 (06 OQ10); otherwise neutral-300. */
export type VarianceTone = 'over' | 'under' | 'ok';

export interface HoursVariance {
  /** Declared − planned. */
  varH: number;
  /** "+23 h" / "-10 h" / "0 h" (ASCII minus, as the prototype). */
  varText: string;
  tone: VarianceTone;
  /** Bar width in % (min(100, round(d ÷ max(p,1) × 100))). */
  barPct: number;
  /** d > 1.1 × p → accent-700 bar, else accent. */
  barOver: boolean;
}

/** Variance of a line or a group (lines 5010–5012). */
export function hoursVariance(planned: number, declared: number): HoursVariance {
  const v = declared - planned;
  return {
    varH: v,
    varText: (v > 0 ? '+' : '') + v + ' h',
    tone: v > planned * 0.1 ? 'over' : v < 0 ? 'under' : 'ok',
    barPct: Math.min(100, Math.round((declared / Math.max(planned, 1)) * 100)),
    barOver: declared > planned * 1.1,
  };
}

export interface HoursKpiInput {
  lines: { plannedH: number; declaredH: number }[];
  /** Hours still to assign (lines without a planned task). */
  unassigned: { hours: number }[];
  /** All hours declared without a planned task, assigned since or not (part of the Lucca total). */
  unassignedTotalH?: number;
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
  /** Variance valued at the flat rate, in k€ rounded (`round(var × 62 / 1000)`). */
  varianceCostK: number;
  /** Variance above 5 % of planned → LO. */
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
  return {
    declaredTotalH: declared + un,
    plannedH: planned,
    matchedDeclaredH: declared,
    lineCount: i.lines.length,
    varianceH: v,
    variancePct: planned ? Math.round((v / planned) * 100) : 0,
    varianceCostK: Math.round((v * HOURS_VALUATION_RATE) / 1000),
    varianceLo: v > planned * 0.05,
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
