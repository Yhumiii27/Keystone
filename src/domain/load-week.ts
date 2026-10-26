// Week view of the load plans (owner answers 17 Oct 2026 to R-085: "Il faut les deux : une vision à la semaine et une vision
// à 8 semaines"). Pure rules of the one week shown in detail:
// - Resources / Project resources: a person's load that week — % of available hours (the allocation row), hours on the
//   40 h week the capacity bars use (HOURS_PER_PERSON_WINDOW ÷ 8), hours above capacity, over-allocation (> 110 %, the rule
//   of the "Over-allocated" tile) and its split by project. Owner answer 17 Oct 2026 (second round): « la répartition projet
//   est à tirer des affectations projets » — the split is the hours the projects' schedules assign the person that week
//   (`activity_assignments`, rule `assignmentHoursInWeek` below), set against the weekly load: the part of the load no
//   assignment covers is "not assigned", assignments above the load are "assigned beyond the load".
// - Leave & working calendar: day by day, Monday to Friday — the leave rows carry their dates (start / end inside the week,
//   `leave_entries`), so each working day is Leave, Absence, a public holiday or worked. A public holiday is never counted
//   as a day of absence (as `absenceWeeks` when Cursus pushes an absence); Leave wins over Absence on the same day.
import { addCalendarDays, type IsoDate, type WorkCalendar } from './calendar';
import { LOAD_WINDOW_WEEKS } from './load-window';
import { HOURS_PER_PERSON_WINDOW, OVER_ALLOCATED_PCT, loadBand, type LoadBand } from './resources';

/** Capacity of one person for one week, hours (8 weeks × 40 h = 320 h on the capacity bars). */
export const HOURS_PER_PERSON_WEEK = HOURS_PER_PERSON_WINDOW / LOAD_WINDOW_WEEKS;
/** Working hours of a leave day and of the leave calendar's week (5 × 7 h = 35 h). */
export const LEAVE_DAY_HOURS = 7;

/** Hours of a weekly load (% of the 40 h week), one decimal. */
export const hoursOfLoad = (pct: number): number => Math.round(((pct * HOURS_PER_PERSON_WEEK) / 100) * 10) / 10;

/** Hours with one decimal (the week view's precision). */
const round1 = (v: number) => Math.round(v * 10) / 10;

/** A person's assignment on a schedule activity (`activity_assignments` joined to its activity and project). */
export interface WeekAssignment {
  /** Project code ("HLT-026"). */
  project: string;
  /** Person name, as the pool names them (full name, else short name). */
  person: string;
  /** Activity dates (ISO, inclusive): actual start / forecast finish as the schedule stores them; null = not dated. */
  start: IsoDate | null;
  finish: IsoDate | null;
  /** Units × hours per day per unit ("40 h/wk" → 1 × 8); null when not parsed. */
  units: number | null;
  hoursPerDay: number | null;
  /** Planned work, hours ("296 / 400 h" → 400); null when not counted in hours. */
  plannedHours: number | null;
  /** Working calendar of the activity (its own, else the project's). */
  calendar: Pick<WorkCalendar, 'isWorkDay'>;
}

/**
 * Hours an assignment puts on its person in the week starting `weekStart` (Monday, ISO). Rule (owner answer 17 Oct 2026,
 * second round): the assignment works on every working day of its activity's calendar between the activity's start and finish
 * (inclusive); the week receives the working days that fall inside it (Monday–Sunday, so a 6-day site calendar counts its
 * Saturday). Hours per working day = units × hours per day — the rate the what-if levelling loads a person with
 * (`weeklyHours`, src/domain/whatif.ts); when the rate is not known, the planned hours spread evenly over the activity's
 * working days. 0 for an undated activity, or an assignment counted neither way (equipment days, material tonnes).
 */
export function assignmentHoursInWeek(a: Omit<WeekAssignment, 'project' | 'person'>, weekStart: IsoDate): number {
  return hoursOfWorkDays(a, activityWorkDays(a, [weekStart]), 0);
}

/**
 * Working days of an activity, for `assignmentHoursInWeek` over several weeks (R-017: the planning load spreads every assignment
 * of the portfolio over the load window; the days of an activity are now counted once for all its assignments and weeks, with
 * the same result). `inWeek[i]` = working days of the activity in the week starting `weeks[i]`; `all()` = its working days from
 * start to finish (counted on first use, then kept).
 */
export interface ActivityWorkDays {
  inWeek: number[];
  all: () => number;
}

export function activityWorkDays(a: Pick<WeekAssignment, 'start' | 'finish' | 'calendar'>, weeks: readonly IsoDate[]): ActivityWorkDays {
  if (!a.start || !a.finish || a.finish < a.start) return { inWeek: weeks.map(() => 0), all: () => 0 };
  const start = a.start;
  const finish = a.finish;
  const count = workDaysCounter(a.calendar);
  const inWeek = weeks.map((weekStart) => {
    const weekEnd = addCalendarDays(weekStart, 6);
    const from = start > weekStart ? start : weekStart;
    const to = finish < weekEnd ? finish : weekEnd;
    return from <= to ? count(from, to) : 0;
  });
  let all: number | null = null;
  return { inWeek, all: () => (all ??= count(start, finish)) };
}

/**
 * Working days of `calendar` from `from` to `to` (inclusive, from ≤ to): by the calendar's working-day ordinals when it has them
 * (WorkCalendar: two binary searches), else day by day (the same count).
 */
function workDaysCounter(calendar: Pick<WorkCalendar, 'isWorkDay'> & Partial<Pick<WorkCalendar, 'ordinal'>>): (from: IsoDate, to: IsoDate) => number {
  const dayByDay = (from: IsoDate, to: IsoDate) => {
    let n = 0;
    for (let d = from; d <= to; d = addCalendarDays(d, 1)) if (calendar.isWorkDay(d)) n++;
    return n;
  };
  const ordinal = calendar.ordinal?.bind(calendar);
  if (!ordinal) return dayByDay;
  return (from, to) => {
    try {
      return ordinal(addCalendarDays(to, 1)) - ordinal(from);
    } catch {
      // Before the calendar epoch or beyond its last year: counted day by day.
      return dayByDay(from, to);
    }
  };
}

/** Hours an assignment puts on the week `i` of `days` (the rule of `assignmentHoursInWeek`). */
export function hoursOfWorkDays(a: Pick<WeekAssignment, 'units' | 'hoursPerDay' | 'plannedHours'>, days: ActivityWorkDays, i: number): number {
  const inWeek = days.inWeek[i];
  if (!inWeek) return 0;
  if (a.units != null && a.hoursPerDay != null && a.units > 0 && a.hoursPerDay > 0) return round1(inWeek * a.units * a.hoursPerDay);
  if (a.plannedHours == null || a.plannedHours <= 0) return 0;
  const all = days.all();
  return all ? round1((a.plannedHours * inWeek) / all) : 0;
}

/** Hours per project of one week, by person: Σ `assignmentHoursInWeek` per (person, project), largest first, zeros left out. */
export function weekProjectHours(assignments: readonly WeekAssignment[], weekStart: IsoDate): Record<string, WeekProjectHours[]> {
  const acc = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    const h = assignmentHoursInWeek(a, weekStart);
    if (h <= 0) continue;
    const mine = acc.get(a.person) ?? new Map<string, number>();
    mine.set(a.project, (mine.get(a.project) ?? 0) + h);
    acc.set(a.person, mine);
  }
  return Object.fromEntries(
    [...acc].map(([person, m]) => [person, [...m].map(([code, hours]) => ({ code, hours: round1(hours) })).sort((x, y) => y.hours - x.hours || x.code.localeCompare(y.code))]),
  );
}

export interface WeekProjectHours {
  /** Project code ("HLT-026"). */
  code: string;
  /** Hours the project's schedule assigns the person that week. */
  hours: number;
}

export interface WeekLoad {
  /** % of available hours (0 without an allocation row). */
  pct: number;
  hours: number;
  capacityH: number;
  /** Hours above the 40 h capacity (0 when within). */
  overH: number;
  /** Above 110 % (the "Over-allocated" tile's rule; 110 % is not over). */
  overAllocated: boolean;
  band: LoadBand;
  /** Hours assigned per project that week (schedule assignments), largest first; empty when none. */
  projects: WeekProjectHours[];
  /** Σ projects. */
  assignedH: number;
  /** Load hours no assignment covers (0 without assignments: nothing to split). */
  notAssignedH: number;
  /** Assigned hours above the load (the allocation does not carry what the schedules assign). */
  beyondH: number;
}

/**
 * Load of a person for the week shown set against the hours the schedules assign per project. R-084 (owner answer 17 Oct 2026,
 * third round): the load IS the schedules' hours (`hours`, from `getPlanningLoad`), so the split covers it exactly; without
 * `hours`, the hours of the % (the rule of a weekly total from another source). R-084 (absences): `capacityH` = the person's
 * capacity that week (40 h less their days off; default 40 h) — the hours above it are "above capacity".
 */
export function weekLoad(pct: number, projects: readonly WeekProjectHours[], hours: number = hoursOfLoad(pct), capacityH: number = HOURS_PER_PERSON_WEEK): WeekLoad {
  const split = projects.filter((p) => p.hours > 0).map((p) => ({ code: p.code, hours: round1(p.hours) })).sort((a, b) => b.hours - a.hours || a.code.localeCompare(b.code));
  const assignedH = round1(split.reduce((a, p) => a + p.hours, 0));
  return {
    pct, hours, capacityH, overH: Math.max(0, round1(hours - capacityH)), overAllocated: pct > OVER_ALLOCATED_PCT,
    band: loadBand(pct), projects: split, assignedH,
    notAssignedH: split.length ? Math.max(0, round1(hours - assignedH)) : 0, beyondH: Math.max(0, round1(assignedH - hours)),
  };
}

/**
 * "HLT-026 40 h · 12 h not assigned" / « HLT-026 40 h · 12 h non affectées » — the "By project" cell of the week view and its
 * export ('' without assignments). Hours, as the load column next to it ("52 h / 40 h").
 */
export function weekSplitText(w: Pick<WeekLoad, 'projects' | 'notAssignedH' | 'beyondH'>, lang: 'en' | 'fr'): string {
  const fr = lang === 'fr';
  const h = (v: number) => `${fr ? String(v).replace('.', ',') : v} h`;
  const parts = w.projects.map((p) => `${p.code} ${h(p.hours)}`);
  if (!parts.length) return '';
  if (w.notAssignedH > 0) parts.push(fr ? `${h(w.notAssignedH)} non affectées` : `${h(w.notAssignedH)} not assigned`);
  if (w.beyondH > 0) parts.push(fr ? `${h(w.beyondH)} affectées au-delà de la charge` : `${h(w.beyondH)} assigned beyond the load`);
  return parts.join(' · ');
}

export type LeaveDayKind = 'leave' | 'absence' | 'holiday' | 'worked';

/** An absence row of the week (`leave_entries`: its dates inside the week). */
export interface LeaveSpan {
  type: 'leave' | 'absence';
  /** ISO dates, inclusive. */
  start: string;
  end: string;
}

export interface LeaveWeekDays {
  /** One per working day given (Monday to Friday). */
  days: LeaveDayKind[];
  /** Days of Leave or Absence (public holidays excluded). */
  daysOff: number;
  /** Public holidays on those days. */
  holidays: number;
  /** Hours available: worked days × 7 h. */
  availH: number;
}

/**
 * Day by day of one person's week: a public holiday first (not worked, never a day of absence), then Leave, then Absence,
 * else worked. `days` = the week's working days (`workingDaysOf`), `holidays` = the public holiday dates.
 */
export function leaveWeekDays(spans: readonly LeaveSpan[], days: readonly string[], holidays: ReadonlySet<string>): LeaveWeekDays {
  const kinds = days.map((d): LeaveDayKind => {
    if (holidays.has(d)) return 'holiday';
    const on = spans.filter((s) => s.start <= d && d <= s.end);
    if (on.some((s) => s.type === 'leave')) return 'leave';
    return on.length ? 'absence' : 'worked';
  });
  const daysOff = kinds.filter((k) => k === 'leave' || k === 'absence').length;
  const hol = kinds.filter((k) => k === 'holiday').length;
  return { days: kinds, daysOff, holidays: hol, availH: kinds.filter((k) => k === 'worked').length * LEAVE_DAY_HOURS };
}
