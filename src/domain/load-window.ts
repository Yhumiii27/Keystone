// Week window of the load plans (R-085, owner decision R-7 = a: "8 semaines glissantes depuis la semaine en cours", with
// previous / next buttons). Pure: the business date is a required parameter (R-013). Used by Resources, Project resources,
// Leave & working calendar and the what-if levelling (its horizon), all navigable through `?week=`.
//
// - The window is 8 consecutive weeks, each identified by its Monday (ISO date, the allocations' and leave rows' `week_start`).
// - The current window starts on the Monday of the business date's week ("semaine en cours"; a Saturday or Sunday belongs to
//   the week that started on the Monday before it). On the demo date, Fri 25 Sep 2026, that is Mon 21 Sep 2026.
// - Navigation slides the window one week at a time (`LOAD_WINDOW_STEP_WEEKS`), within one year either side of the current
//   week (`LOAD_WINDOW_MAX_OFFSET_WEEKS`) — a Keystone default, wide enough for planning, narrow enough to keep the URL
//   state meaningful. The current window carries no `?week=`.
// - Owner answers 17 Oct 2026 ("Il faut les deux : une vision à la semaine et une vision à 8 semaines"): two views, `?view=`
//   — "8 weeks" (`8w`, the default, no param) and "Week" (`week`: the one week `?week=` names, shown in detail). The week
//   view steps one week; the 8-week view steps one week or a full 8-week page (`LOAD_PAGE_STEP_WEEKS`), within the same
//   bounds. The what-if levelling's horizon is the 8-week window of the page (previous / current / next, the same links), a
//   horizon entirely in the past (`isPastWindow`) is read-only.
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
/** Weeks of a full page of the 8-week view ("Previous 8 weeks" / "Next 8 weeks"). */
export const LOAD_PAGE_STEP_WEEKS = LOAD_WINDOW_WEEKS;

/** View of a load plan (owner answers 17 Oct 2026): one week in detail, or 8 weeks (the default). */
export type LoadView = 'week' | '8w';
export const LOAD_VIEWS: readonly LoadView[] = ['week', '8w'];
/** The view without `?view=`. */
export const DEFAULT_LOAD_VIEW: LoadView = '8w';
/** Search param of the view (`?view=week`; the 8-week view carries none). */
export const LOAD_VIEW_PARAM = 'view';
/** Weeks a view shows. */
export const loadViewWeeks = (view: LoadView): number => (view === 'week' ? 1 : LOAD_WINDOW_WEEKS);

/** `?view=` → the view; anything else (absent, unknown, several values whose first is unknown) → the 8-week view. */
export function parseLoadViewParam(v: unknown): LoadView {
  const raw = Array.isArray(v) ? v[0] : v;
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (LOAD_VIEWS as readonly string[]).includes(s) ? (s as LoadView) : DEFAULT_LOAD_VIEW;
}

export interface LoadWindow {
  /** View shown: one week (`week`) or 8 weeks (`8w`). */
  view: LoadView;
  /** Monday of the first week shown. */
  start: string;
  /** Mondays of the weeks shown, in order (`loadViewWeeks(view)` of them: 1 or 8). */
  weeks: string[];
  /** Sunday of the last week shown. */
  end: string;
  /** Monday of the business date's week (the current window's start). */
  current: string;
  /** The window shown is the current one. */
  isCurrent: boolean;
  /** Start of the previous / following window (one week); null at the bound. */
  prev: string | null;
  next: string | null;
  /** 8-week view: start of the previous / next full page (8 weeks); null at the bound, and always null in the week view. */
  prevPage: string | null;
  nextPage: string | null;
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

/**
 * Start `weeks` weeks before (negative) or after `start`, clamped to the bounds: the bound itself when the step would cross
 * it, null when `start` already is the bound (the link is disabled).
 */
export function stepWindowStart(start: string, weeks: number, bounds: { min: string; max: string }): string | null {
  const to = addDaysIso(start, 7 * weeks);
  if (weeks < 0) return to >= bounds.min ? to : start > bounds.min ? bounds.min : null;
  return to <= bounds.max ? to : start < bounds.max ? bounds.max : null;
}

/**
 * The window shown on `today`, starting at `week` (a parsed `?week=`; null = the current window), in `view` (a parsed
 * `?view=`): 8 weeks, or the one week in the week view.
 */
export function loadWindow(today: string, week: string | null, view: LoadView): LoadWindow {
  const current = currentWeekStart(today);
  const bounds = loadWindowBounds(today);
  const asked = week && isIsoDate(week) ? mondayOf(week) : null;
  const start = asked && asked >= bounds.min && asked <= bounds.max ? asked : current;
  const weeks = weekStartsFrom(start, loadViewWeeks(view));
  const paged = view === '8w';
  return {
    view, start, weeks, end: addDaysIso(weeks[weeks.length - 1], 6), current, isCurrent: start === current,
    prev: stepWindowStart(start, -LOAD_WINDOW_STEP_WEEKS, bounds),
    next: stepWindowStart(start, LOAD_WINDOW_STEP_WEEKS, bounds),
    prevPage: paged ? stepWindowStart(start, -LOAD_PAGE_STEP_WEEKS, bounds) : null,
    nextPage: paged ? stepWindowStart(start, LOAD_PAGE_STEP_WEEKS, bounds) : null,
  };
}

/** The window lies entirely before the business date (its last day is past): a what-if on it is read-only. */
export const isPastWindow = (w: Pick<LoadWindow, 'end'>, today: string): boolean => w.end < today;

/** Working days (Monday to Friday, ISO) of the week starting on `monday`. */
export const workingDaysOf = (monday: string): string[] => Array.from({ length: 5 }, (_, i) => addDaysIso(monday, i));

/** Weeks between the current window and `start` (negative in the past): 0 for the current window. */
export const windowOffsetWeeks = (w: Pick<LoadWindow, 'start' | 'current'>): number => Math.round(daysBetweenIso(w.current, w.start) / 7);

/**
 * Link to a window of a load-plan screen: `path` with `?view=week` (the 8-week view carries none) and `?week=` (left out for
 * the current window, so "Current week" is the bare screen), the other search params kept as given (null / empty values
 * dropped).
 */
export function loadWindowHref(
  path: string, start: string, current: string, keep: Record<string, string | null | undefined> = {}, view: LoadView = DEFAULT_LOAD_VIEW,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (k !== LOAD_WEEK_PARAM && k !== LOAD_VIEW_PARAM && v) q.set(k, v);
  if (view !== DEFAULT_LOAD_VIEW) q.set(LOAD_VIEW_PARAM, view);
  if (start !== current) q.set(LOAD_WEEK_PARAM, start);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
