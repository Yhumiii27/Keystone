// R-201 (K-201, owner's answer of 1 Nov 2026 « Lancer »): recurring tasks of « Mon travail ». Pure rules — the rule a task
// carries, its validation, and the dates of the next occurrence created when the current one is closed (status Done).
//
// Rule (décisions prises sans demander, docs/delivery-9/notes-r196-r201.md):
// - `weekly` / `monthly`: every `interval` weeks / months (1–12) counted from the rule's anchor — the due date of the
//   occurrence on which the rule was set — so the series never drifts (a monthly rule anchored on 31 Jan falls on 28 Feb,
//   31 Mar…). The next occurrence's due date is the first date of the series after the closed occurrence's due date and not
//   before the business date: an occurrence closed late does not leave a backlog of missed occurrences.
// - `milestone`: at each schedule milestone of the project — due on the next milestone date after the closed occurrence's due
//   date and not before the business date; no further milestone → the series ends (no occurrence).
// - The due date and the start date move forward onto a working day of the project's calendar (`nextWorkDay`); the start
//   keeps the closed occurrence's lead time (due − start, calendar days), is never before the business date and never after
//   the due date.
// - `until` (optional): no occurrence is due after it.
import { addCalendarDays, calendarDaysBetween, isIsoDate, type IsoDate } from './calendar';

export const RECURRENCE_KINDS = ['weekly', 'monthly', 'milestone'] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];

/** Largest interval (weeks or months). */
export const MAX_RECURRENCE_INTERVAL = 12;

export interface TaskRecurrence {
  kind: RecurrenceKind;
  /** Every `interval` weeks / months; always 1 for `milestone`. */
  interval: number;
  /** Due date the series is counted from (weekly / monthly). */
  anchor: IsoDate;
  /** Last possible due date; null = no end. */
  until: IsoDate | null;
}

export const isRecurrenceKind = (v: unknown): v is RecurrenceKind => typeof v === 'string' && (RECURRENCE_KINDS as readonly string[]).includes(v);

/** EN source labels of the kinds (t() — FR entries in src/i18n/extra/mywork.json). */
export const RECURRENCE_KIND_LABEL: Record<RecurrenceKind, string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  milestone: 'At each project milestone',
};

export type ParsedRecurrence = { ok: true; value: TaskRecurrence | null } | { ok: false; error: string };

/**
 * Checks the recurrence typed on the task sheet. `kind` '' = no recurrence (stops the series). The anchor is the task's due
 * date. Messages are EN source strings.
 */
export function parseRecurrence(input: { kind?: unknown; interval?: unknown; until?: unknown }, task: { due: IsoDate }): ParsedRecurrence {
  const kind = input?.kind;
  if (kind === '' || kind == null) return { ok: true, value: null };
  if (!isRecurrenceKind(kind)) return { ok: false, error: 'Choose how the task repeats' };
  const raw = input.interval ?? 1;
  const interval = kind === 'milestone' ? 1 : typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,2}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) return { ok: false, error: `The interval is a whole number from 1 to ${MAX_RECURRENCE_INTERVAL}` };
  const until = input.until === '' || input.until == null ? null : input.until;
  if (until !== null && !isIsoDate(until)) return { ok: false, error: 'Enter a valid end date' };
  if (until !== null && until < task.due) return { ok: false, error: 'The end date is before the task’s due date' };
  return { ok: true, value: { kind, interval, anchor: task.due, until } };
}

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `iso` + `months` months, the day clamped to the month's last day (31 Jan + 1 → 28 Feb). */
export function addMonthsClamped(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const nd = Math.min(d, lastDayOfMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** The k-th date of a weekly / monthly series (k = 0 is the anchor). */
export function seriesDate(rule: Pick<TaskRecurrence, 'kind' | 'interval' | 'anchor'>, k: number): IsoDate {
  return rule.kind === 'monthly' ? addMonthsClamped(rule.anchor, k * rule.interval) : addCalendarDays(rule.anchor, k * 7 * rule.interval);
}

export interface NextOccurrenceContext {
  /** Business date (R-013). */
  today: IsoDate;
  /** Schedule milestone dates of the project (any order; `milestone` rule). */
  milestones?: readonly IsoDate[];
  /** First working day on or after a date (the project's calendar); identity when absent. */
  nextWorkDay?: (iso: IsoDate) => IsoDate;
}

/** Bound of the search (≈ 77 years of weekly occurrences): a rule never loops forever. */
const MAX_STEPS = 4000;

/**
 * Start and due dates of the occurrence following `current` (the occurrence being closed), or null when the series ends
 * (`until` passed, no further milestone).
 */
export function nextOccurrence(rule: TaskRecurrence, current: { start: IsoDate; due: IsoDate }, ctx: NextOccurrenceContext): { start: IsoDate; due: IsoDate } | null {
  const floor = current.due > ctx.today ? current.due : ctx.today;
  let raw: IsoDate | null = null;
  if (rule.kind === 'milestone') {
    raw = [...(ctx.milestones ?? [])].filter((m) => m > current.due && m >= ctx.today).sort()[0] ?? null;
  } else {
    for (let k = 1; k <= MAX_STEPS; k++) {
      const d = seriesDate(rule, k);
      if (d > current.due && d >= floor) {
        raw = d;
        break;
      }
    }
  }
  if (!raw || (rule.until && raw > rule.until)) return null;
  const work = ctx.nextWorkDay ?? ((iso: IsoDate) => iso);
  const due = work(raw);
  const lead = Math.max(0, calendarDaysBetween(current.start, current.due));
  let start = work(addCalendarDays(due, -lead));
  if (start < ctx.today) start = ctx.today;
  if (start > due) start = due;
  return { start, due };
}
