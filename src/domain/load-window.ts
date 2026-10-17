// Week window of the load plans (R-085, owner decision R-7 = a: "8 semaines glissantes depuis la semaine en cours", with
// previous / next buttons). Pure: the business date is a required parameter (R-013). Used by Resources, Project resources,
// Leave & working calendar (navigable through `?week=`) and the what-if levelling (its horizon is the current window).
//
// - The window is 8 consecutive weeks, each identified by its Monday (ISO date, the allocations' and leave rows' `week_start`).
// - The current window starts on the Monday of the business date's week ("semaine en cours"; a Saturday or Sunday belongs to
//   the week that started on the Monday before it). On the demo date, Fri 25 Sep 2026, that is Mon 21 Sep 2026.
// - Navigation slides the window one week at a time (`LOAD_WINDOW_STEP_WEEKS`), within one year either side of the current
//   week (`LOAD_WINDOW_MAX_OFFSET_WEEKS`) — a Keystone default, wide enough for planning, narrow enough to keep the URL
//   state meaningful. The current window carries no `?week=`.
import { isIsoDate, mondayOf } from './absences';
import { addDaysIso, daysBetweenIso } from '@/server/db/codes';

/** Weeks shown by a load plan (R-7 a). */
export const LOAD_WINDOW_WEEKS = 8;
/** Weeks the window slides on "Previous week" / "Following week". */
export const LOAD_WINDOW_STEP_WEEKS = 1;
/** Farthest window start from the current week, in weeks, either side. */
export const LOAD_WINDOW_MAX_OFFSET_WEEKS = 52;
/** Search param of the window start (`?week=YYYY-MM-DD`, the Monday of its first week). */
export const LOAD_WEEK_PARAM = 'week';

export interface LoadWindow {
  /** Monday of the first week shown. */
  start: string;
  /** Mondays of the weeks shown, in order (`LOAD_WINDOW_WEEKS` of them). */
  weeks: string[];
  /** Monday of the business date's week (the current window's start). */
  current: string;
  /** The window shown is the current one. */
  isCurrent: boolean;
  /** Start of the previous / following window; null at the bound. */
  prev: string | null;
  next: string | null;
}

/** Monday of the business date's week: the current window's start. */
export const currentWeekStart = (today: string): string => mondayOf(today);

/** `n` consecutive Mondays from `start`. */
export const weekStartsFrom = (start: string, n: number): string[] => Array.from({ length: Math.max(0, n) }, (_, i) => addDaysIso(start, 7 * i));

/** Earliest and latest window start allowed on `today`. */
export function loadWindowBounds(today: string): { min: string; max: string } {
  const current = currentWeekStart(today);
  return { min: addDaysIso(current, -7 * LOAD_WINDOW_MAX_OFFSET_WEEKS), max: addDaysIso(current, 7 * LOAD_WINDOW_MAX_OFFSET_WEEKS) };
}

/**
 * `?week=` → the Monday of that date's week, or null (= the current window) when absent, not a real `YYYY-MM-DD` date, or
 * outside the bounds. A date that is not a Monday is read as its week (a link to "the week of 24 Sep" is the week of 21 Sep).
 */
export function parseLoadWeekParam(v: unknown, today: string): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  if (typeof raw !== 'string' || !isIsoDate(raw.trim())) return null;
  const monday = mondayOf(raw.trim());
  const { min, max } = loadWindowBounds(today);
  return monday >= min && monday <= max ? monday : null;
}

/** The window shown on `today`, starting at `week` (a parsed `?week=`; null = the current window). */
export function loadWindow(today: string, week: string | null): LoadWindow {
  const current = currentWeekStart(today);
  const { min, max } = loadWindowBounds(today);
  const asked = week && isIsoDate(week) ? mondayOf(week) : null;
  const start = asked && asked >= min && asked <= max ? asked : current;
  const step = 7 * LOAD_WINDOW_STEP_WEEKS;
  const prev = addDaysIso(start, -step);
  const next = addDaysIso(start, step);
  return {
    start, weeks: weekStartsFrom(start, LOAD_WINDOW_WEEKS), current, isCurrent: start === current,
    prev: prev >= min ? prev : start > min ? min : null,
    next: next <= max ? next : start < max ? max : null,
  };
}

/** Weeks between the current window and `start` (negative in the past): 0 for the current window. */
export const windowOffsetWeeks = (w: Pick<LoadWindow, 'start' | 'current'>): number => Math.round(daysBetweenIso(w.current, w.start) / 7);

/**
 * Link to a window of a load-plan screen: `path` with `?week=` (left out for the current window, so "Current week" is the bare
 * screen) and the other search params kept as given (null / empty values dropped).
 */
export function loadWindowHref(path: string, start: string, current: string, keep: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (k !== LOAD_WEEK_PARAM && v) q.set(k, v);
  if (start !== current) q.set(LOAD_WEEK_PARAM, start);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
