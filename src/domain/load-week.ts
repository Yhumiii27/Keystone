// Week view of the load plans (owner answers 17 Oct 2026 to R-085: "Il faut les deux : une vision à la semaine et une vision
// à 8 semaines"). Pure rules of the one week shown in detail:
// - Resources / Project resources: a person's load that week — % of available hours (the allocation row), hours on the
//   40 h week the capacity bars use (HOURS_PER_PERSON_WINDOW ÷ 8), hours above capacity, over-allocation (> 110 %, the rule
//   of the "Over-allocated" tile) and, when allocation rows per project exist for that week, the split by project.
// - Leave & working calendar: day by day, Monday to Friday — the leave rows carry their dates (start / end inside the week,
//   `leave_entries`), so each working day is Leave, Absence, a public holiday or worked. A public holiday is never counted
//   as a day of absence (as `absenceWeeks` when Cursus pushes an absence); Leave wins over Absence on the same day.
import { LOAD_WINDOW_WEEKS } from './load-window';
import { HOURS_PER_PERSON_WINDOW, OVER_ALLOCATED_PCT, loadBand, type LoadBand } from './resources';

/** Capacity of one person for one week, hours (8 weeks × 40 h = 320 h on the capacity bars). */
export const HOURS_PER_PERSON_WEEK = HOURS_PER_PERSON_WINDOW / LOAD_WINDOW_WEEKS;
/** Working hours of a leave day and of the leave calendar's week (5 × 7 h = 35 h). */
export const LEAVE_DAY_HOURS = 7;

/** Hours of a weekly load (% of the 40 h week), one decimal. */
export const hoursOfLoad = (pct: number): number => Math.round(((pct * HOURS_PER_PERSON_WEEK) / 100) * 10) / 10;

export interface WeekProjectShare {
  /** Project code ("HLT-026"). */
  code: string;
  pct: number;
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
  /** Allocation rows per project for that week, largest first; empty when the data holds the weekly total only. */
  projects: WeekProjectShare[];
  /** Part of the total not split by project (% ; 0 when the split covers it, or when there is no split). */
  unsplitPct: number;
}

/** Load of a person for the week shown: the weekly total and its split by project (allocation rows with a project). */
export function weekLoad(pct: number, projects: readonly { code: string; pct: number }[]): WeekLoad {
  const hours = hoursOfLoad(pct);
  const split = projects.filter((p) => p.pct > 0).map((p) => ({ code: p.code, pct: p.pct, hours: hoursOfLoad(p.pct) })).sort((a, b) => b.pct - a.pct || a.code.localeCompare(b.code));
  const splitPct = split.reduce((a, p) => a + p.pct, 0);
  return {
    pct, hours, capacityH: HOURS_PER_PERSON_WEEK, overH: Math.max(0, Math.round((hours - HOURS_PER_PERSON_WEEK) * 10) / 10), overAllocated: pct > OVER_ALLOCATED_PCT,
    band: loadBand(pct), projects: split, unsplitPct: split.length ? Math.max(0, Math.round((pct - splitPct) * 10) / 10) : 0,
  };
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
