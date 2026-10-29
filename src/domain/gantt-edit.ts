// R-198 — interactive Gantt of the Schedule screen: the pure rules behind it. Shared by the Client Component (optimistic
// preview while dragging, computed with the same CPM engine as "Reschedule") and the Server Functions (which re-validate every
// edit on the network they load themselves before writing it).
//
// - Network: the activities, links, calendars and data date of one project, serialisable (calendars travel as definitions and
//   are rebuilt with `buildCalendars`).
// - Edits: move (start → a "Start no earlier than" constraint, or the new date of a "Must start on"), duration (working days),
//   removal of the date constraint, and the relationships (add / change type and lag / remove). `applyGanttEdit` refuses what
//   the Plan refuses: unknown activity or link, actual dates (an activity in progress keeps its actual start, a complete one is
//   fixed), self link, duplicate, logic loop, lag outside ±999 working days.
// - Preview: `previewSchedule` = what "Reschedule" computes (progress implies actual dates, then src/domain/cpm.ts).
// - Scale: zoom day / week / month (pixels per calendar day), ticks, and the drag → date / duration conversions.
// - Geometry: bars and the elbow paths of the relationships.
import {
  CALENDAR_EPOCH, WorkCalendar, addCalendarDays, calendarDaysBetween, isIsoDate, isoWeekday, type CalendarDef, type CalendarException, type IsoDate,
} from './calendar';
import { DEFAULT_CPM_OPTIONS, CpmCycleError, CpmInputError, detectCycle, linkKey, schedule, type CpmActivityInput, type CpmLinkType, type CpmOptions } from './cpm';
import { actualsFromProgress } from './schedule-rollup';

// ── Network ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const GANTT_LINK_TYPES: readonly CpmLinkType[] = ['FS', 'SS', 'FF', 'SF'];
export const isGanttLinkType = (v: unknown): v is CpmLinkType => typeof v === 'string' && (GANTT_LINK_TYPES as readonly string[]).includes(v);
/** Constraint types the CPM engine schedules ('ASAP' = none). */
const CONSTRAINT_TYPES: readonly string[] = ['SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];
/** Lag bounds of a relationship, working days (same as the Plan drawer's "Add relationship"). */
export const GANTT_LAG_MAX = 999;
/** Longest duration the Gantt accepts, working days. */
export const GANTT_DURATION_MAX = 9999;

/** A calendar as it travels to the browser. */
export interface GanttCalendarSpec {
  def: CalendarDef;
  settingsHolidays: IsoDate[];
  exceptions: CalendarException[];
}

export interface GanttConstraint {
  type: string;
  date: IsoDate | null;
}

export interface GanttActivity {
  id: string;
  name: string;
  /** Work package code ("1.4"). */
  wbs: string;
  /** Original duration, working days (0 = milestone). */
  duration: number;
  /** Calendar override; null = the project calendar. */
  calendar: string | null;
  pct: number;
  /** Remaining duration stored by an import; null = from % complete. */
  remaining: number | null;
  /** Current dates as stored (actual where flagged, else the last Reschedule's early dates). */
  startDate: IsoDate | null;
  finishDate: IsoDate | null;
  startActual: boolean;
  finishActual: boolean;
  constraint: GanttConstraint | null;
  critical: boolean;
  totalFloat: number | null;
  /** Displayed baseline dates (null when the activity is not in it). */
  baselineStart: IsoDate | null;
  baselineFinish: IsoDate | null;
}

export interface GanttLink {
  pred: string;
  succ: string;
  type: CpmLinkType;
  lag: number;
}

export interface GanttPackage {
  code: string;
  name: string;
}

export interface GanttNetwork {
  /** Project data date (remaining work is scheduled from it). */
  dataDate: IsoDate;
  projectStart: IsoDate | null;
  projectCalendar: string;
  calendars: GanttCalendarSpec[];
  /** Work packages in WBS order. */
  packages: GanttPackage[];
  /** Activities in plan order. */
  activities: GanttActivity[];
  links: GanttLink[];
  options?: Partial<CpmOptions>;
}

export type GanttCalendars = Record<string, WorkCalendar>;

/** The network's calendars as WorkCalendars (build once per network, they are immutable). */
export function buildCalendars(specs: readonly GanttCalendarSpec[]): GanttCalendars {
  return Object.fromEntries(specs.map((c) => [c.def.code, new WorkCalendar(c.def, { settingsHolidays: c.settingsHolidays, exceptions: c.exceptions })]));
}

/** Calendar of an activity: its override, else the project calendar (else the first one). */
export function calendarOf(net: Pick<GanttNetwork, 'projectCalendar'>, cals: GanttCalendars, a: Pick<GanttActivity, 'calendar'>): WorkCalendar {
  return (a.calendar && cals[a.calendar]) || cals[net.projectCalendar] || Object.values(cals)[0];
}

/** Activity state at the data date, as "Reschedule" sees it (progress implies the actual dates). */
export type GanttLock = 'complete' | 'started' | null;
export function lockOf(a: Pick<GanttActivity, 'pct' | 'startActual' | 'finishActual'>): GanttLock {
  if (a.finishActual || a.pct >= 100) return 'complete';
  if (a.startActual || a.pct > 0) return 'started';
  return null;
}

// ── Preview (= Reschedule) ─────────────────────────────────────────────────────────────────────────────────────────

export interface GanttDates {
  start: IsoDate;
  finish: IsoDate;
  critical: boolean;
  totalFloat: number | null;
}

export type GanttPreview = { ok: true; dates: Record<string, GanttDates>; finish: IsoDate } | { ok: false; cycle?: string[]; issues?: string[] };

/** Engine input of an activity after progress (same rule as `toCpmActivity` on the server). */
function cpmActivity(a: GanttActivity, dataDate: IsoDate): CpmActivityInput {
  const p = actualsFromProgress({ pct: a.pct, startActual: a.startActual, finishActual: a.finishActual, startDate: a.startDate, finishDate: a.finishDate }, dataDate);
  const c = a.constraint;
  const constraint = c && CONSTRAINT_TYPES.includes(c.type) && c.date ? { type: c.type, date: c.date } : null;
  return {
    id: a.id, duration: a.duration, calendar: a.calendar, percentComplete: a.pct, remaining: a.remaining, actualStart: p.startActual ? p.startDate : null,
    actualFinish: p.finishActual && p.startActual ? p.finishDate : null, constraint,
  };
}

/** The dates "Reschedule" would give this network (the optimistic preview of an edit). */
export function previewSchedule(net: GanttNetwork, cals: GanttCalendars): GanttPreview {
  if (!net.activities.length) return { ok: true, dates: {}, finish: net.dataDate };
  try {
    const r = schedule({
      dataDate: net.dataDate, projectStart: net.projectStart, projectCalendar: net.projectCalendar, calendars: cals,
      activities: net.activities.map((a) => cpmActivity(a, net.dataDate)), links: net.links, options: { ...DEFAULT_CPM_OPTIONS, ...(net.options ?? {}) },
    });
    const dates: Record<string, GanttDates> = {};
    for (const [id, x] of Object.entries(r.activities)) dates[id] = { start: x.start, finish: x.finish, critical: x.state !== 'complete' && x.critical, totalFloat: x.totalFloat };
    return { ok: true, dates, finish: r.projectFinish };
  } catch (e) {
    if (e instanceof CpmCycleError) return { ok: false, cycle: e.cycle };
    if (e instanceof CpmInputError) return { ok: false, issues: e.issues };
    throw e;
  }
}

/** The stored dates of the network (what the screen shows when no edit is pending). */
export function storedDates(net: GanttNetwork): Record<string, GanttDates> {
  const out: Record<string, GanttDates> = {};
  for (const a of net.activities)
    if (a.startDate && a.finishDate) out[a.id] = { start: a.startDate, finish: a.finishDate < a.startDate ? a.startDate : a.finishDate, critical: a.critical, totalFloat: a.totalFloat };
  return out;
}

// ── Edits ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type GanttEdit =
  | { kind: 'move'; id: string; start: IsoDate }
  | { kind: 'duration'; id: string; days: number }
  | { kind: 'clearConstraint'; id: string }
  | { kind: 'addLink'; link: GanttLink }
  | { kind: 'editLink'; link: GanttLink }
  | { kind: 'removeLink'; pred: string; succ: string };

export type GanttEditError = 'unknown' | 'complete' | 'started' | 'milestone' | 'date' | 'duration' | 'type' | 'lag' | 'self' | 'duplicate' | 'missing' | 'cycle';

export type GanttEditResult = { ok: true; net: GanttNetwork; activity?: GanttActivity; link?: GanttLink } | { ok: false; error: GanttEditError; cycle?: string[] };

/** EN source sentence of a refusal (rendered through t()). The cycle text is built by the caller. */
export const GANTT_EDIT_ERRORS: Record<Exclude<GanttEditError, 'cycle'>, string> = {
  unknown: 'Invalid request',
  complete: 'This activity is complete: its dates are actual',
  started: 'This activity has started: its start is actual',
  milestone: 'A milestone has no duration to change',
  date: 'Enter a valid start date',
  duration: 'The duration is a whole number of working days between 1 and 9999',
  type: 'Unknown relationship type',
  lag: 'The lag is a whole number of working days between −999 and 999',
  self: 'An activity cannot be linked to itself',
  duplicate: 'This relationship already exists',
  missing: 'This relationship no longer exists',
};

/** Latest date a Gantt edit accepts. */
const DATE_MAX = '2100-12-31';

/**
 * Constraint set by moving an activity to `start`: a "Must start on" keeps its type and takes the new date; any other (or none)
 * becomes "Start no earlier than" (MS Project's rule when a task is dragged). The logic can still push the activity later.
 */
export function movedConstraint(current: GanttConstraint | null, start: IsoDate): GanttConstraint {
  return current?.type === 'MSO' ? { type: 'MSO', date: start } : { type: 'SNET', date: start };
}

/** A lag typed or dragged: whole working days within ±999 (null when not). */
export function parseLag(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim().replace('−', '-') : '';
  if (!/^[+-]?\d{1,3}$/.test(s || '0')) return null;
  const n = parseInt(s || '0', 10);
  return Math.abs(n) <= GANTT_LAG_MAX ? n : null;
}

/** A duration typed: whole working days in [1, 9999] (null when not). */
export function parseDurationDays(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 1 && n <= GANTT_DURATION_MAX ? n : null;
}

/**
 * Applies one edit to the network, or says why it is refused. Dates are snapped to a working day of the activity's calendar.
 * Pure: the network given is not changed.
 */
export function applyGanttEdit(net: GanttNetwork, edit: GanttEdit, cals: GanttCalendars): GanttEditResult {
  const ids = net.activities.map((a) => a.id);
  const find = (id: string) => net.activities.find((a) => a.id === id);
  const replace = (a: GanttActivity): GanttEditResult => ({ ok: true, net: { ...net, activities: net.activities.map((x) => (x.id === a.id ? a : x)) }, activity: a });
  switch (edit.kind) {
    case 'move': {
      const a = find(edit.id);
      if (!a) return { ok: false, error: 'unknown' };
      const lock = lockOf(a);
      if (lock) return { ok: false, error: lock };
      if (!isIsoDate(edit.start) || edit.start < CALENDAR_EPOCH || edit.start > DATE_MAX) return { ok: false, error: 'date' };
      const start = calendarOf(net, cals, a).nextWorkDay(edit.start);
      return replace({ ...a, constraint: movedConstraint(a.constraint, start) });
    }
    case 'duration': {
      const a = find(edit.id);
      if (!a) return { ok: false, error: 'unknown' };
      if (lockOf(a) === 'complete') return { ok: false, error: 'complete' };
      if (a.duration === 0) return { ok: false, error: 'milestone' };
      if (!Number.isInteger(edit.days) || edit.days < 1 || edit.days > GANTT_DURATION_MAX) return { ok: false, error: 'duration' };
      // A remaining duration stored by an import gives way to the new duration (as the Plan's inline edit).
      return replace({ ...a, duration: edit.days, remaining: null });
    }
    case 'clearConstraint': {
      const a = find(edit.id);
      if (!a) return { ok: false, error: 'unknown' };
      return replace({ ...a, constraint: null });
    }
    case 'addLink':
    case 'editLink': {
      const l = edit.link;
      if (!find(l.pred) || !find(l.succ)) return { ok: false, error: 'unknown' };
      if (l.pred === l.succ) return { ok: false, error: 'self' };
      if (!isGanttLinkType(l.type)) return { ok: false, error: 'type' };
      if (!Number.isInteger(l.lag) || Math.abs(l.lag) > GANTT_LAG_MAX) return { ok: false, error: 'lag' };
      const at = net.links.findIndex((x) => x.pred === l.pred && x.succ === l.succ);
      if (edit.kind === 'addLink' && at >= 0) return { ok: false, error: 'duplicate' };
      if (edit.kind === 'editLink' && at < 0) return { ok: false, error: 'missing' };
      const link: GanttLink = { pred: l.pred, succ: l.succ, type: l.type, lag: l.lag };
      const links = edit.kind === 'addLink' ? [...net.links, link] : net.links.map((x, i) => (i === at ? link : x));
      if (edit.kind === 'addLink') {
        const cycle = detectCycle(ids, links);
        if (cycle) return { ok: false, error: 'cycle', cycle };
      }
      return { ok: true, net: { ...net, links }, link };
    }
    case 'removeLink': {
      if (!net.links.some((x) => x.pred === edit.pred && x.succ === edit.succ)) return { ok: false, error: 'missing' };
      return { ok: true, net: { ...net, links: net.links.filter((x) => !(x.pred === edit.pred && x.succ === edit.succ)) } };
    }
  }
}

/** Applies edits in order; stops at the first refusal. */
export function applyGanttEdits(net: GanttNetwork, edits: readonly GanttEdit[], cals: GanttCalendars): GanttEditResult {
  let cur: GanttEditResult = { ok: true, net };
  for (const e of edits) {
    if (!cur.ok) return cur;
    cur = applyGanttEdit(cur.net, e, cals);
  }
  return cur;
}

/** Relationship label as the Plan writes it: "FS", "FS+5", "SS−3". */
export const linkLabel = (l: Pick<GanttLink, 'type' | 'lag'>) => `${l.type}${l.lag ? (l.lag > 0 ? '+' : '−') + Math.abs(l.lag) : ''}`;
export { linkKey };

// ── Scale (zoom) ───────────────────────────────────────────────────────────────────────────────────────────────────

export type GanttZoom = 'day' | 'week' | 'month';
export const GANTT_ZOOMS: readonly GanttZoom[] = ['day', 'week', 'month'];
export const isGanttZoom = (v: unknown): v is GanttZoom => typeof v === 'string' && (GANTT_ZOOMS as readonly string[]).includes(v);
/** Pixels per calendar day: a day column of 28 px, a week of 63 px, a month of about 91 px. */
export const PX_PER_DAY: Record<GanttZoom, number> = { day: 28, week: 9, month: 3 };

export interface GanttTick {
  date: IsoDate;
  x: number;
  width: number;
}

export interface GanttScale {
  zoom: GanttZoom;
  /** First calendar day of the timeline (x = 0). */
  origin: IsoDate;
  /** Last calendar day shown. */
  end: IsoDate;
  pxPerDay: number;
  width: number;
  /** Upper header: months (every zoom). */
  months: GanttTick[];
  /** Lower header: days (day zoom), weeks starting on Monday (week zoom), none (month zoom). */
  units: GanttTick[];
}

const monthStart = (iso: IsoDate) => `${iso.slice(0, 7)}-01`;
const nextMonth = (iso: IsoDate) => {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};
const mondayOf = (iso: IsoDate) => addCalendarDays(iso, 1 - isoWeekday(iso));

/** Timeline range for a zoom: whole months (month zoom), whole weeks from Monday (week zoom), a few days of margin (day zoom). */
export function ganttRange(dates: readonly IsoDate[], zoom: GanttZoom): { from: IsoDate; to: IsoDate } {
  const valid = dates.filter((d) => isIsoDate(d)).sort();
  const lo = valid[0] ?? CALENDAR_EPOCH;
  const hi = valid.at(-1) ?? lo;
  if (zoom === 'month') return { from: monthStart(lo), to: addCalendarDays(nextMonth(nextMonth(hi)), -1) };
  if (zoom === 'week') return { from: addCalendarDays(mondayOf(lo), -7), to: addCalendarDays(mondayOf(hi), 13) };
  return { from: addCalendarDays(lo, -3), to: addCalendarDays(hi, 7) };
}

export function ganttScale(zoom: GanttZoom, from: IsoDate, to: IsoDate): GanttScale {
  const pxPerDay = PX_PER_DAY[zoom];
  const days = Math.max(1, calendarDaysBetween(from, to) + 1);
  const end = addCalendarDays(from, days - 1);
  const x = (iso: IsoDate) => calendarDaysBetween(from, iso) * pxPerDay;
  const months: GanttTick[] = [];
  for (let m = monthStart(from); m <= end; m = nextMonth(m)) {
    const s = m < from ? from : m;
    const e = addCalendarDays(nextMonth(m), -1);
    const last = e > end ? end : e;
    months.push({ date: m, x: x(s), width: (calendarDaysBetween(s, last) + 1) * pxPerDay });
  }
  const units: GanttTick[] = [];
  if (zoom === 'day') for (let d = from; d <= end; d = addCalendarDays(d, 1)) units.push({ date: d, x: x(d), width: pxPerDay });
  if (zoom === 'week')
    for (let d = mondayOf(from); d <= end; d = addCalendarDays(d, 7)) {
      const s = d < from ? from : d;
      units.push({ date: d, x: x(s), width: (calendarDaysBetween(s, addCalendarDays(d, 6) > end ? end : addCalendarDays(d, 6)) + 1) * pxPerDay });
    }
  return { zoom, origin: from, end, pxPerDay, width: days * pxPerDay, months, units };
}

/** x of the start of a calendar day. */
export const xOf = (scale: Pick<GanttScale, 'origin' | 'pxPerDay'>, iso: IsoDate) => calendarDaysBetween(scale.origin, iso) * scale.pxPerDay;

/** ISO week number ("W40"). */
export function isoWeekNumber(iso: IsoDate): number {
  const thursday = addCalendarDays(iso, 4 - isoWeekday(iso));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(calendarDaysBetween(jan1, thursday) / 7) + 1;
}

/** Non-working days of a calendar inside the scale (shading in day and week zoom; none in month zoom). */
export function offDays(scale: GanttScale, cal: WorkCalendar): GanttTick[] {
  if (scale.zoom === 'month') return [];
  const out: GanttTick[] = [];
  for (let d = scale.origin; d <= scale.end; d = addCalendarDays(d, 1)) if (!cal.isWorkDay(d)) out.push({ date: d, x: xOf(scale, d), width: scale.pxPerDay });
  return out;
}

// ── Drag → date / duration ─────────────────────────────────────────────────────────────────────────────────────────

/** Whole calendar days a horizontal drag of `dx` pixels stands for. */
export const dayDelta = (dx: number, zoom: GanttZoom) => Math.round(dx / PX_PER_DAY[zoom]);

/** New start of a bar dragged by `dx` pixels: the first working day on or after the day under the bar's new left edge. */
export function draggedStart(start: IsoDate, dx: number, zoom: GanttZoom, cal: WorkCalendar): IsoDate {
  return cal.nextWorkDay(addCalendarDays(start, dayDelta(dx, zoom)));
}

/**
 * New duration of a bar whose end is dragged by `dx` pixels: the working days from its start to the day under the new right
 * edge (at least 1).
 */
export function draggedDuration(start: IsoDate, finish: IsoDate, dx: number, zoom: GanttZoom, cal: WorkCalendar): number {
  const target = addCalendarDays(finish, dayDelta(dx, zoom));
  return Math.min(GANTT_DURATION_MAX, Math.max(1, cal.durationOf(start, target < start ? start : target)));
}

/** The edit a finished drag stands for, or null when it changes nothing. */
export function dragEdit(
  mode: 'move' | 'resize',
  a: Pick<GanttActivity, 'id' | 'duration'>,
  shown: Pick<GanttDates, 'start' | 'finish'>,
  dx: number,
  zoom: GanttZoom,
  cal: WorkCalendar,
): GanttEdit | null {
  if (mode === 'move') {
    if (dayDelta(dx, zoom) === 0) return null;
    const start = draggedStart(shown.start, dx, zoom, cal);
    return start === shown.start ? null : { kind: 'move', id: a.id, start };
  }
  const days = draggedDuration(shown.start, shown.finish, dx, zoom, cal);
  return days === a.duration ? null : { kind: 'duration', id: a.id, days };
}

// ── Geometry ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BarBox {
  left: number;
  width: number;
  /** Zero-duration activity: drawn as a diamond at `left`. */
  milestone: boolean;
}

/** Bar of an activity from its first to its last day (both included). */
export function barBox(scale: Pick<GanttScale, 'origin' | 'pxPerDay'>, d: Pick<GanttDates, 'start' | 'finish'>, milestone = false): BarBox {
  const left = xOf(scale, d.start);
  if (milestone) return { left, width: 0, milestone: true };
  return { left, width: Math.max(scale.pxPerDay, (calendarDaysBetween(d.start, d.finish) + 1) * scale.pxPerDay), milestone: false };
}

/** Elbow path of a relationship between two bars (rows' vertical centres `y1`, `y2`), arrow at the successor. */
export function linkPath(type: CpmLinkType, pred: BarBox, succ: BarBox, y1: number, y2: number, gap = 8): string {
  const fromFinish = type === 'FS' || type === 'FF';
  const toStart = type === 'FS' || type === 'SS';
  const sx = fromFinish ? pred.left + pred.width : pred.left;
  const ex = toStart ? succ.left : succ.left + succ.width;
  const mid = y1 + (y2 - y1) / 2;
  const out = fromFinish ? sx + gap : sx - gap;
  const into = toStart ? ex - gap : ex + gap;
  // Straight elbow when the path can run forward between the two points; else around, through the space between the rows.
  if ((type === 'FS' && into >= out) || (type === 'SF' && into <= out)) return `M${sx},${y1} H${(out + into) / 2} V${y2} H${ex}`;
  if (type === 'SS') return `M${sx},${y1} H${Math.min(out, into)} V${y2} H${ex}`;
  if (type === 'FF') return `M${sx},${y1} H${Math.max(out, into)} V${y2} H${ex}`;
  return `M${sx},${y1} H${out} V${mid} H${into} V${y2} H${ex}`;
}
