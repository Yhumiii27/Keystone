// Resource loads, load bands, capacity vs demand and availability from leave (docs/spec/06 §1.4–§1.6, §4,
// "Status machines" #5; prototype logic 3866–3882 and 4400–4403). Pure functions on the 8-week window: loads are
// % of available hours per week, hours are 8-week totals. Formatting (money, translated sentences) stays in the UI
// (src/features/resources/model.ts), except the two KPI sub-lines Resources shares with the department head's Home
// (`peakWeeksText`, `shortfallText`, A-12). Golden values: src/domain/resources.test.ts.
import type { Lang, T } from '@/i18n/translate';
import { isoWeekOf } from '@/server/db/codes';

// ── Load bands (shade(), logic 3867) ───────────────────────────────────────────────────────────────────

/** Heat band of a weekly load: < 60 % · 60–89 % · 90–100 % nominal · 101–115 % stretched · > 115 % over-allocated. */
export type LoadBand = 'under' | 'moderate' | 'nominal' | 'stretched' | 'over';

/** Band order from "Under" to "Over" (legend swatches). */
export const LOAD_BANDS: LoadBand[] = ['under', 'moderate', 'nominal', 'stretched', 'over'];

/** Same thresholds as the prototype's `shade(v)`: > 115 · > 100 · ≥ 90 · ≥ 60 · else. */
export function loadBand(v: number): LoadBand {
  if (v > 115) return 'over';
  if (v > 100) return 'stretched';
  if (v >= 90) return 'nominal';
  if (v >= 60) return 'moderate';
  return 'under';
}

/** A person is over-allocated when any week is above this load (strict: 110 % is not over). */
export const OVER_ALLOCATED_PCT = 110;
/** The 8-week average is shown in the attention colour above this load (strict). */
export const AVERAGE_ALERT_PCT = 100;

// ── Person loads (logic 3869–3871) ─────────────────────────────────────────────────────────────────────

export interface PersonLoad {
  /** Weekly loads (%). */
  loads: number[];
  /** Mean of the weekly loads (unrounded). */
  avg: number;
  /** `Math.round(avg)` — the "Avg" column (`avgText`), also the basis of project demand. */
  avgPct: number;
  max: number;
  /** Any week > 110 %. */
  overAllocated: boolean;
  /** avg > 100 % → "Avg" in the attention colour. */
  avgAlert: boolean;
  bands: LoadBand[];
}

export function personLoad(loads: number[]): PersonLoad {
  const avg = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;
  const max = loads.length ? Math.max(...loads) : 0;
  return { loads, avg, avgPct: Math.round(avg), max, overAllocated: max > OVER_ALLOCATED_PCT, avgAlert: avg > AVERAGE_ALERT_PCT, bands: loads.map(loadBand) };
}

/** "Team utilization" / "Project team load": `round(Σ person avg / n)` (unweighted, unrounded averages); 0 for nobody. */
export function teamUtilization(people: Pick<PersonLoad, 'avg'>[]): number {
  return people.length ? Math.round(people.reduce((a, p) => a + p.avg, 0) / people.length) : 0;
}

/** "Over-allocated": people with any week above 110 %. */
export function overAllocatedCount(people: Pick<PersonLoad, 'overAllocated'>[]): number {
  return people.filter((p) => p.overAllocated).length;
}

/** Number of people above `threshold` % in each week (What-if "People above 100%"). */
export function peopleAboveByWeek(people: Pick<PersonLoad, 'loads'>[], threshold = AVERAGE_ALERT_PCT): number[] {
  const n = Math.max(0, ...people.map((p) => p.loads.length));
  return Array.from({ length: n }, (_, i) => people.filter((p) => (p.loads[i] ?? 0) > threshold).length);
}

// ── Capacity vs demand (logic 3872–3874) ───────────────────────────────────────────────────────────────

export interface CapacityRow {
  /** Department name (EN source). */
  name: string;
  capacityH: number;
  demandH: number;
}

/** 8 weeks × 40 h: the capacity one team member brings to Project resources. */
export const HOURS_PER_PERSON_WINDOW = 320;
/** Department of a team member without one. */
export const OTHER_DEPARTMENT = 'Other';

/**
 * Project resources bars: per department of the team (first-appearance order), capacity += 320 h per person and
 * demand += round(avg% × 3.2) h, with the rounded average as the prototype (`parseInt(avgText) * 3.2`).
 */
export function projectDepartmentDemand(people: { department: string | null | undefined; avgPct: number }[]): CapacityRow[] {
  const m = new Map<string, CapacityRow>();
  for (const p of people) {
    const d = p.department || OTHER_DEPARTMENT;
    const row = m.get(d) ?? { name: d, capacityH: 0, demandH: 0 };
    row.capacityH += HOURS_PER_PERSON_WINDOW;
    row.demandH += Math.round(p.avgPct * (HOURS_PER_PERSON_WINDOW / 100));
    m.set(d, row);
  }
  return [...m.values()];
}

export interface CapacityBarGeometry {
  /** Demand above capacity → accent fill, attention text. */
  over: boolean;
  /** Bar scale = max(capacity, demand) × 1.1 — the larger value sits at 90.9 %. */
  scale: number;
  /** Fractions of the track (0..1). */
  demand: number;
  capacity: number;
}

export function capacityBar(row: Pick<CapacityRow, 'capacityH' | 'demandH'>): CapacityBarGeometry {
  const scale = Math.max(row.capacityH, row.demandH) * 1.1;
  return { over: row.demandH > row.capacityH, scale, demand: scale ? row.demandH / scale : 0, capacity: scale ? row.capacityH / scale : 0 };
}

/**
 * "Unmet demand": Σ max(0, demand − capacity) over the department bars. Chapter 4 (A-12, 06 OQ1): the portfolio Resources
 * screen computes it too (the prototype's constant "240 h" became the 280 h its own ROLES bars give).
 */
export function unmetDemand(rows: Pick<CapacityRow, 'capacityH' | 'demandH'>[]): number {
  return rows.reduce((a, r) => a + Math.max(0, r.demandH - r.capacityH), 0);
}

/** Department with the largest unmet demand ("Mostly engineering"); null when no department is over capacity. */
export function mainShortfall<R extends Pick<CapacityRow, 'name' | 'capacityH' | 'demandH'>>(rows: readonly R[]): R | null {
  let best: R | null = null;
  for (const r of rows) if (r.demandH > r.capacityH && (!best || r.demandH - r.capacityH > best.demandH - best.capacityH)) best = r;
  return best;
}

// ── Peak weeks (A-12: "Peak weeks 41–43" was a constant) ──────────────────────────────────────────────────────────────

/** Window weeks (indexes) in which at least one person is above `threshold` % (strict). */
export function weeksAbove(people: Pick<PersonLoad, 'loads'>[], threshold = OVER_ALLOCATED_PCT): number[] {
  const n = Math.max(0, ...people.map((p) => p.loads.length));
  return Array.from({ length: n }, (_, i) => i).filter((i) => people.some((p) => (p.loads[i] ?? 0) > threshold));
}

/** Week numbers as ranges: [42, 43, 44] → "42–44", [41, 42, 46] → "41–42, 46". */
export function weekRangesText(weeks: readonly number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(', ');
}

/** ISO week numbers of the window weeks in which someone is above 110 % ("Over-allocated" peak weeks). */
export function peakWeekNumbers(people: Pick<PersonLoad, 'loads'>[], weekStarts: readonly string[]): number[] {
  return weeksAbove(people, OVER_ALLOCATED_PCT).flatMap((i) => (weekStarts[i] ? [isoWeekOf(weekStarts[i])] : []));
}

/**
 * "Over-allocated" sub (A-12; the prototype's constant "Peak weeks 41–43"): ISO weeks in which someone is above 110 %
 * ("Peak weeks 42–44", FR "Pointe semaines 42–44"). Shared by Resources and the department head's Home.
 */
export function peakWeeksText(people: Pick<PersonLoad, 'loads'>[], weekStarts: readonly string[], lang: Lang): string {
  const weeks = peakWeekNumbers(people, weekStarts);
  const fr = lang === 'fr';
  if (!weeks.length) return fr ? 'Aucune semaine au-dessus de 110 %' : 'No week above 110%';
  const range = weekRangesText(weeks);
  if (fr) return `${weeks.length === 1 ? 'Pointe semaine' : 'Pointe semaines'} ${range}`;
  return `${weeks.length === 1 ? 'Peak week' : 'Peak weeks'} ${range}`;
}

/** First letter in lower case, unless the word is an acronym ("MEP", "CVC-élec"). */
const lowerFirst = (s: string) => (/^[A-ZÀ-Ý]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/**
 * "Unmet demand" sub (A-12; the prototype's constant "Mostly engineering"): the department short the most ("Mostly
 * engineering", FR "Surtout ingénierie"). Shared by Resources and the department head's Home.
 */
export function shortfallText(rows: readonly CapacityRow[], t: T, lang: Lang): string {
  const top = mainShortfall(rows);
  if (!top) return lang === 'fr' ? 'Aucun service au-delà de sa capacité' : 'No department over capacity';
  return lang === 'fr' ? `Surtout ${lowerFirst(t(top.name))}` : `Mostly ${lowerFirst(top.name)}`;
}

// ── Requests needing an expert (A-12: Skills "Open requests needing level ≥4" was the constant 2) ────────────────────

/** Skill level of an expert (Skills coverage "Experts = level 4–5"). */
export const EXPERT_LEVEL = 4;

/**
 * Open requests needing level ≥ 4: pending requests that name a person whose main skill (highest level, first in skill
 * order on a tie) is at expert level — the request needs that expertise. Contract roles carry no level and are not
 * counted. Returns the count and the skills concerned in skill order (chapter-5 questionnaire: confirm the rule).
 */
export function requestsNeedingExperts(
  requests: readonly { person: string | null; status: string }[],
  people: readonly { name: string; levels: readonly number[] }[],
  skills: readonly string[],
  level = EXPERT_LEVEL,
): { count: number; skills: string[] } {
  const mainSkill = new Map<string, number>();
  for (const p of people) {
    let best = -1;
    p.levels.forEach((v, i) => {
      if (v >= level && (best < 0 || v > p.levels[best])) best = i;
    });
    if (best >= 0) mainSkill.set(p.name, best);
  }
  const hits = requests.filter((r) => r.status === 'pending' && r.person && mainSkill.has(r.person)).map((r) => mainSkill.get(r.person!)!);
  return { count: hits.length, skills: [...new Set(hits)].sort((a, b) => a - b).map((i) => skills[i]).filter(Boolean) };
}

/** "Labor cost to date" sub: `round(actual / budget × 100)` % of the labour budget (null without a budget). */
export function laborShare(labor: { budget: number; actual: number }): number | null {
  return labor.budget ? Math.round((labor.actual / labor.budget) * 100) : null;
}

// ── Availability from leave (Leave & working calendar, logic 4400–4403) ───────────────────────────────

/** Weekly basis of the leave calendar: 5 working days × 7 h = 35 h. */
export const WORKING_DAYS_PER_WEEK = 5;
export const HOURS_PER_DAY = 7;
export const WEEK_HOURS = WORKING_DAYS_PER_WEEK * HOURS_PER_DAY;
/** A person's 8-week availability below this share is shown in the attention colour. */
export const LOW_AVAILABILITY = 0.7;
/** "Weeks under 60% team capacity". */
export const LOW_TEAM_CAPACITY = 0.6;

/** Hours available in one week: max(0, 5 − leave days − public-holiday days) × 7. */
export function availableHours(leaveDays: number, holidayDays = 0): number {
  return Math.max(0, WORKING_DAYS_PER_WEEK - leaveDays - holidayDays) * HOURS_PER_DAY;
}

export interface LeaveWeek {
  /** Working days of leave that week (LEAVE_DAYS of its type; 0 when none). */
  days: number;
  /** Public-holiday working days that week. */
  holidays: number;
}

export interface PersonAvailability {
  /** Available hours per week. */
  hours: number[];
  total: number;
  /** `round(total / (weeks × 35) × 100)`. */
  pct: number;
  /** Leave days in the window (public holidays excluded). */
  leaveDays: number;
  /** total / capacity < 70 %. */
  low: boolean;
}

export function personAvailability(weeks: LeaveWeek[]): PersonAvailability {
  const hours = weeks.map((w) => availableHours(w.days, w.holidays));
  const total = hours.reduce((a, b) => a + b, 0);
  const cap = weeks.length * WEEK_HOURS;
  return { hours, total, pct: cap ? Math.round((total / cap) * 100) : 0, leaveDays: weeks.reduce((a, w) => a + w.days, 0), low: cap ? total / cap < LOW_AVAILABILITY : false };
}

/** "Team availability": mean of the people's rounded availability %, rounded (as the prototype parses "73%"). */
export function teamAvailability(people: Pick<PersonAvailability, 'pct'>[]): number {
  return people.length ? Math.round(people.reduce((a, p) => a + p.pct, 0) / people.length) : 0;
}

/** Weeks whose team hours fall below 60 % of the 35 h × people basis. */
export function weeksUnderTeamCapacity(people: Pick<PersonAvailability, 'hours'>[], threshold = LOW_TEAM_CAPACITY): number {
  if (!people.length) return 0;
  const n = Math.max(...people.map((p) => p.hours.length));
  let count = 0;
  for (let i = 0; i < n; i++) if (people.reduce((a, p) => a + (p.hours[i] ?? 0), 0) / (WEEK_HOURS * people.length) < threshold) count++;
  return count;
}
