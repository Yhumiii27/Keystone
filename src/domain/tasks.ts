// Personal tasks — My work and Task detail logic (docs/spec/10 §6–7, §9 "Task"; prototype logic 3893–3896,
// 4058–4107). Pure TypeScript shared by the server pages, the client islands and the Server Functions.
//
// Day axis: working-day offsets from Mon 21 Sep 2026 (`dayDate`, 3266): 0 = Mon 21 Sep … 4 = Fri 25 Sep (TODAY,
// the frozen status date) … 9 = Fri 2 Oct, 10 = Mon 5 Oct. Every English string returned here is a source string
// to render through t().
import { MO, TODAY, dayDate, dayLabel } from '@/lib/format';

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
export type TaskPriority = 'high' | 'med' | 'low';

/** Status segment order (task.statusSeg) and board columns (boardCols). */
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'review', 'done'];
/** STATUS_L (3264). */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', review: 'In review', done: 'Done' };
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { high: 'High', med: 'Medium', low: 'Low' };
/** Progress segment (task.pctSeg). */
export const PCT_STEPS = [0, 25, 50, 75, 100] as const;
/** Hours of a working week ("of 40 h"). */
export const WEEK_HOURS = 40;
/** Days shown by the calendar view (two working weeks). */
export const CAL_DAYS = 10;

export const isTaskStatus = (v: unknown): v is TaskStatus => typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);

/** What the computations need from a task (offsets on the working-day axis). */
export interface WorkTask {
  status: TaskStatus;
  priority: TaskPriority;
  start: number;
  due: number;
  estimateH: number;
  loggedH: number;
}

// ── Day axis ─────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const DAY_ZERO_UTC = utc('2026-09-21');

/**
 * ISO date → working-day offset. A Saturday or Sunday rounds `up` to the next Monday (start dates) or `down` to the
 * previous Friday (due dates), so tasks whose dates fall on a weekend still sit on the axis.
 */
export function workingDayOf(iso: string, round: 'up' | 'down' = 'down'): number {
  const d = Math.round((utc(iso) - DAY_ZERO_UTC) / DAY_MS);
  const w = Math.floor(d / 7);
  const dow = d - w * 7;
  if (dow <= 4) return w * 5 + dow;
  return round === 'up' ? (w + 1) * 5 : w * 5 + 4;
}

/** Last day of next week (TODAY = 4 → 9, Fri 2 Oct): the "Next week" bucket is TODAY < due ≤ this. */
export const nextWeekEnd = (today = TODAY) => (Math.floor(today / 5) + 1) * 5 + 4;

/** "21 Sep – 2 Oct": span of two working-day offsets (calendar title, "Next week" KPI sub). */
export function spanText(from: number, to: number): string {
  const a = dayDate(from);
  const b = dayDate(to);
  return `${a.getDate()} ${MO[a.getMonth()]} – ${b.getDate()} ${MO[b.getMonth()]}`;
}

// ── Due dates (dueTextOf / dueColorOf, 3893–3894) ───────────────────────────────────────────────────────

export type DueBucket = 'overdue' | 'today' | 'next' | 'later';
export type DueTone = 'done' | 'overdue' | 'today' | 'normal';

/** Urgency bucket of an open task. */
export function dueBucket(due: number, today = TODAY): DueBucket {
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return due <= nextWeekEnd(today) ? 'next' : 'later';
}

/** "Done" · "Overdue · Tue 22 Sep" · "Today" · "Thu 1 Oct". */
export function dueText(t: Pick<WorkTask, 'status' | 'due'>, today = TODAY): string {
  if (t.status === 'done') return 'Done';
  if (t.due < today) return 'Overdue · ' + dayLabel(t.due);
  if (t.due === today) return 'Today';
  return dayLabel(t.due);
}

/** Colour role of the due text: neutral-500 (done) · LO (overdue) · accent-300 (today) · neutral-400. */
export function dueTone(t: Pick<WorkTask, 'status' | 'due'>, today = TODAY): DueTone {
  if (t.status === 'done') return 'done';
  if (t.due < today) return 'overdue';
  return t.due === today ? 'today' : 'normal';
}

/**
 * `byDue` (4075): due date ascending, then high priority first. The prototype's comparator
 * (`a.due-b.due||(a.prio==='high'?-1:1)`) is not symmetric; this one is, and gives the same order on stable sorts.
 */
export function byDue(a: Pick<WorkTask, 'due' | 'priority'>, b: Pick<WorkTask, 'due' | 'priority'>): number {
  return a.due - b.due || (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1);
}

export const sortByDue = <T extends Pick<WorkTask, 'due' | 'priority'>>(xs: readonly T[]): T[] => [...xs].sort(byDue);

// ── My work: groups, board, KPIs (4060–4078) ──────────────────────────────────────────────────────────

export type WorkGroupKey = DueBucket | 'done';
/** Group labels (EN source). */
export const WORK_GROUP_LABEL: Record<WorkGroupKey, string> = {
  overdue: 'Overdue', today: 'Today', next: 'Next week', later: 'Later', done: 'Recently done',
};

export interface WorkGroup<T> {
  key: WorkGroupKey;
  items: T[];
}

/** List view: Overdue · Today · Next week · Later (open tasks, byDue) · Recently done (list order); empty groups omitted. */
export function workGroups<T extends WorkTask>(mine: readonly T[], today = TODAY): WorkGroup<T>[] {
  const open = mine.filter((t) => t.status !== 'done');
  const keys: DueBucket[] = ['overdue', 'today', 'next', 'later'];
  const groups: WorkGroup<T>[] = keys.map((key) => ({ key, items: sortByDue(open.filter((t) => dueBucket(t.due, today) === key)) }));
  groups.push({ key: 'done', items: mine.filter((t) => t.status === 'done') });
  return groups.filter((g) => g.items.length);
}

/** Board view: one column per status (all the person's tasks, byDue). */
export function boardColumns<T extends WorkTask>(mine: readonly T[]): { status: TaskStatus; items: T[] }[] {
  return TASK_STATUSES.map((status) => ({ status, items: sortByDue(mine.filter((t) => t.status === status)) }));
}

export interface WorkKpis {
  dueToday: number;
  overdue: number;
  nextWeek: number;
  /** Hours logged on the person's tasks started by today (incl. done) — the prototype's formula (10 OQ18). */
  loggedH: number;
  /** round(logged / 40 · 100). */
  loggedPct: number;
  /** round(mean of the next two weekly loads) %; null when the person is not in the resource pool. */
  load: number | null;
  overCapacity: boolean;
}

/** `workKpis` (4066). `loads` = the person's weekly loads from the resource pool (first two = next two weeks). */
export function workKpis(mine: readonly WorkTask[], loads: readonly number[] | null, today = TODAY): WorkKpis {
  const open = mine.filter((t) => t.status !== 'done');
  const loggedH = mine.reduce((a, t) => a + (t.start <= today ? t.loggedH : 0), 0);
  const load = loads && loads.length >= 2 ? Math.round((loads[0] + loads[1]) / 2) : null;
  return {
    dueToday: open.filter((t) => t.due === today).length,
    overdue: open.filter((t) => t.due < today).length,
    nextWeek: open.filter((t) => t.due > today && t.due <= nextWeekEnd(today)).length,
    loggedH,
    loggedPct: Math.round((loggedH / WEEK_HOURS) * 100),
    load,
    overCapacity: load != null && load > 100,
  };
}

/** Number shown in the "My tasks" badge: open tasks due today ('' when none). */
export const dueTodayBadge = (mine: readonly WorkTask[], today = TODAY) => {
  const n = mine.filter((t) => t.status !== 'done' && t.due === today).length;
  return n ? String(n) : '';
};

/** "Log time" target (4083 `open[0] || mine[0]`): first open task in list order, else the first task; null when none. */
export function logTimeTarget<T extends Pick<WorkTask, 'status'>>(mine: readonly T[]): T | null {
  return mine.find((t) => t.status !== 'done') ?? mine[0] ?? null;
}

// ── Calendar view (calDays / calRows / calHours, 4077–4080) ────────────────────────────────────────────

/** First offset of the two-week window `week` weeks after the default one (week 0 = Mon 21 Sep – Fri 2 Oct). */
export const calendarStart = (week: number) => week * 5;

export interface CalendarDay {
  offset: number;
  /** "Mon" (EN). */
  weekday: string;
  /** Day of month. */
  day: number;
  isToday: boolean;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function calendarDays(start: number, today = TODAY): CalendarDay[] {
  return Array.from({ length: CAL_DAYS }, (_, i) => {
    const d = dayDate(start + i);
    return { offset: start + i, weekday: DOW[d.getDay()], day: d.getDate(), isToday: start + i === today };
  });
}

export type CalendarBarTone = 'late' | 'doing' | 'idle';

export interface CalendarBar<T> {
  task: T;
  /** Fractions of the 10-day track (0..1). */
  left: number;
  width: number;
  tone: CalendarBarTone;
}

/** Open tasks overlapping the window, byDue, with their bar geometry (clipped to the window). */
export function calendarBars<T extends WorkTask>(mine: readonly T[], start: number, today = TODAY): CalendarBar<T>[] {
  const end = start + CAL_DAYS - 1;
  return sortByDue(mine.filter((t) => t.status !== 'done' && t.start <= end && t.due >= start)).map((task) => {
    const l = Math.max(task.start, start);
    const r = Math.min(task.due, end);
    return {
      task,
      left: (l - start) / CAL_DAYS,
      width: (r - l + 1) / CAL_DAYS,
      tone: task.due < today ? 'late' : task.status === 'doing' ? 'doing' : 'idle',
    };
  });
}

/** "Planned hours" row: Σ est / (due − start + 1) over open tasks covering each day; > 8 h is over. */
export function plannedHours(mine: readonly WorkTask[], start: number): { hours: number; over: boolean }[] {
  const open = mine.filter((t) => t.status !== 'done');
  return Array.from({ length: CAL_DAYS }, (_, i) => {
    const day = start + i;
    const hours = open.reduce((a, t) => a + (t.start <= day && t.due >= day ? t.estimateH / (t.due - t.start + 1) : 0), 0);
    return { hours, over: hours > 8 };
  });
}

/** "6.5" / "—" (calHours value). */
export const hoursCellText = (h: number) => (h ? h.toFixed(1) : '—');

/** Column of the status date in the window (the shaded "today" band), null when outside. */
export const todayColumn = (start: number, today = TODAY): number | null =>
  today >= start && today < start + CAL_DAYS ? today - start : null;

// ── Status ⇄ percent coupling (setTask, 4095–4097; 10 §9) ─────────────────────────────────────────────

export interface TaskProgressState {
  status: TaskStatus;
  pct: number;
}

/** Status segment / "Mark done": done ⇒ 100 %; leaving done from 100 % ⇒ 75 %; otherwise % unchanged. */
export function applyStatus(cur: TaskProgressState, status: TaskStatus): TaskProgressState {
  return { status, pct: status === 'done' ? 100 : cur.pct === 100 ? 75 : cur.pct };
}

/**
 * % segment: 100 % ⇒ done; > 0 % on a to-do or done task ⇒ in progress; 0 % on a done task ⇒ to do (the prototype
 * left it "Done" at 0 %, 10 OQ20 — done always means 100 %).
 */
export function applyProgress(cur: TaskProgressState, pct: number): TaskProgressState {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  if (v === 100) return { status: 'done', pct: v };
  if (cur.status === 'done') return { status: v > 0 ? 'doing' : 'todo', pct: v };
  if (cur.status === 'todo' && v > 0) return { status: 'doing', pct: v };
  return { status: cur.status, pct: v };
}

/** List done toggle (todoRow.toggleDone): done ↔ in progress (100 % ↔ 75 %). */
export const toggleDone = (cur: TaskProgressState): TaskProgressState =>
  cur.status === 'done' ? { status: 'doing', pct: 75 } : { status: 'done', pct: 100 };

/** Initial % of a seeded task: 100 when done, else min(100, round(logged / est · 100)). */
export const initialPct = (status: TaskStatus, loggedH: number, estimateH: number) =>
  status === 'done' ? 100 : estimateH > 0 ? Math.min(100, Math.round((loggedH / estimateH) * 100)) : 0;

// ── Task sheet ───────────────────────────────────────────────────────────────────────────────────────

/** Checklist counts (`clOf`): from the items when the task has some, else the stored counts. */
export function checklistCounts(items: readonly boolean[], stored: { done: number; total: number }): { done: number; total: number } {
  return items.length ? { done: items.filter(Boolean).length, total: items.length } : stored;
}

/** Checklist bar width in %: round(done / total · 100), 0 without items. */
export const checklistPct = (c: { done: number; total: number }) => (c.total ? Math.round((c.done / c.total) * 100) : 0);

/** Time bar: width min(logged / est, 1); over when logged > estimate (LO colour). */
export function hoursBar(loggedH: number, estimateH: number): { share: number; over: boolean } {
  return { share: estimateH > 0 ? Math.min(loggedH / estimateH, 1) : loggedH > 0 ? 1 : 0, over: loggedH > estimateH };
}

/** Plan card "Total float": "— (complete)" when the activity has no float (finished), else signed days ("-27d", "+3d"). */
export const floatText = (tf: number | null) => (tf == null ? '— (complete)' : (tf > 0 ? '+' : '') + tf + 'd');

/** "On the critical path" notice: activity float negative and the task not done. */
export const isCritical = (tf: number | null, status: TaskStatus) => tf != null && tf < 0 && status !== 'done';

/** "6/8 h", "4.5/4 h" (list/board hours). */
export const hoursText = (loggedH: number, estimateH: number) => `${loggedH}/${estimateH} h`;

/**
 * Hours typed in the Log form → number, or null when not loggable. Accepts "1.5" and "1,5"; must be > 0 and
 * ≤ 24 (the prototype accepted negative and unbounded values, 10 OQ20). Rounded to the minute-friendly 0.01 h.
 */
export function parseHours(text: unknown): number | null {
  const raw = typeof text === 'number' ? String(text) : typeof text === 'string' ? text.trim().replace(',', '.') : '';
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(raw)) return null;
  const h = Math.round(parseFloat(raw) * 100) / 100;
  return h > 0 && h <= 24 ? h : null;
}
