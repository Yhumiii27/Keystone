// R-201: recurring tasks — value tests of the rule's validation and of the next occurrence's dates.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from './clock';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar } from './calendar';
import { addMonthsClamped, nextOccurrence, parseRecurrence, seriesDate, type TaskRecurrence } from './task-recurrence';

const today = DEMO_TODAY_ISO; // Fri 25 Sep 2026
const weekly = (anchor: string, interval = 1, until: string | null = null): TaskRecurrence => ({ kind: 'weekly', interval, anchor, until });
const monthly = (anchor: string, interval = 1, until: string | null = null): TaskRecurrence => ({ kind: 'monthly', interval, anchor, until });

describe('parseRecurrence', () => {
  it('no kind stops the series', () => {
    expect(parseRecurrence({ kind: '' }, { due: today })).toEqual({ ok: true, value: null });
    expect(parseRecurrence({}, { due: today })).toEqual({ ok: true, value: null });
  });
  it('anchors on the task’s due date, the interval 1–12 (a string accepted), milestone always 1', () => {
    expect(parseRecurrence({ kind: 'weekly', interval: '2' }, { due: '2026-09-25' })).toEqual({ ok: true, value: { kind: 'weekly', interval: 2, anchor: '2026-09-25', until: null } });
    expect(parseRecurrence({ kind: 'milestone', interval: 7 }, { due: '2026-09-25' })).toMatchObject({ ok: true, value: { interval: 1 } });
    expect(parseRecurrence({ kind: 'monthly', interval: 13 }, { due: today })).toEqual({ ok: false, error: 'The interval is a whole number from 1 to 12' });
    expect(parseRecurrence({ kind: 'monthly', interval: 1.5 }, { due: today })).toMatchObject({ ok: false });
    expect(parseRecurrence({ kind: 'daily' }, { due: today })).toEqual({ ok: false, error: 'Choose how the task repeats' });
  });
  it('the end date is a date, not before the due date', () => {
    expect(parseRecurrence({ kind: 'weekly', until: '2026-12-31' }, { due: today })).toMatchObject({ ok: true, value: { until: '2026-12-31' } });
    expect(parseRecurrence({ kind: 'weekly', until: '2026-09-01' }, { due: today })).toEqual({ ok: false, error: 'The end date is before the task’s due date' });
    expect(parseRecurrence({ kind: 'weekly', until: '31/12/2026' }, { due: today })).toEqual({ ok: false, error: 'Enter a valid end date' });
  });
});

describe('series dates', () => {
  it('months clamp to the last day without drifting', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
    expect(seriesDate(monthly('2026-01-31'), 2)).toBe('2026-03-31');
    expect(seriesDate(weekly('2026-09-25', 2), 3)).toBe('2026-11-06');
  });
});

describe('nextOccurrence', () => {
  it('weekly: one week later, keeping the lead time', () => {
    expect(nextOccurrence(weekly('2026-09-25'), { start: '2026-09-23', due: '2026-09-25' }, { today })).toEqual({ start: '2026-09-30', due: '2026-10-02' });
  });
  it('closed late: the first date of the series not before today, no backlog', () => {
    expect(nextOccurrence(weekly('2026-09-04'), { start: '2026-09-04', due: '2026-09-04' }, { today })).toEqual({ start: '2026-09-25', due: '2026-09-25' });
    expect(nextOccurrence(weekly('2026-09-01', 2), { start: '2026-08-28', due: '2026-09-01' }, { today })).toEqual({ start: '2026-09-25', due: '2026-09-29' });
  });
  it('monthly: same day of month from the anchor, clamped', () => {
    expect(nextOccurrence(monthly('2026-10-31'), { start: '2026-10-31', due: '2026-10-31' }, { today })).toEqual({ start: '2026-11-30', due: '2026-11-30' });
    // The anchor keeps the 31st after a clamped month.
    expect(nextOccurrence(monthly('2026-10-31'), { start: '2026-11-30', due: '2026-11-30' }, { today })).toEqual({ start: '2026-12-31', due: '2026-12-31' });
    expect(nextOccurrence(monthly('2026-09-30', 3), { start: '2026-09-28', due: '2026-09-30' }, { today })).toEqual({ start: '2026-12-28', due: '2026-12-30' });
  });
  it('moves onto working days of the project’s calendar', () => {
    const cal = new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8);
    const nextWorkDay = (iso: string) => cal.nextWorkDay(iso);
    // Anchor Sat 3 Oct 2026 → Sat 10 Oct, due moved to Mon 12 Oct.
    expect(nextOccurrence(weekly('2026-10-03'), { start: '2026-10-03', due: '2026-10-03' }, { today, nextWorkDay })).toEqual({ start: '2026-10-12', due: '2026-10-12' });
    // 11 Nov (holiday) → Thu 12 Nov.
    expect(nextOccurrence(monthly('2026-10-11'), { start: '2026-10-09', due: '2026-10-12' }, { today, nextWorkDay })?.due).toBe('2026-11-12');
  });
  it('the end date stops the series', () => {
    expect(nextOccurrence(weekly('2026-09-25', 1, '2026-09-30'), { start: '2026-09-25', due: '2026-09-25' }, { today })).toBeNull();
    expect(nextOccurrence(weekly('2026-09-25', 1, '2026-10-02'), { start: '2026-09-25', due: '2026-09-25' }, { today })).toMatchObject({ due: '2026-10-02' });
  });
  it('milestone: the next milestone after the closed one and not before today; none → the series ends', () => {
    const rule: TaskRecurrence = { kind: 'milestone', interval: 1, anchor: '2026-09-25', until: null };
    const milestones = ['2026-12-15', '2026-09-10', '2026-11-02', '2026-09-25'];
    expect(nextOccurrence(rule, { start: '2026-09-20', due: '2026-09-25' }, { today, milestones })).toEqual({ start: '2026-10-28', due: '2026-11-02' });
    expect(nextOccurrence(rule, { start: '2026-12-10', due: '2026-12-15' }, { today, milestones })).toBeNull();
    expect(nextOccurrence(rule, { start: '2026-09-01', due: '2026-09-01' }, { today, milestones })).toEqual({ start: '2026-09-25', due: '2026-09-25' });
  });
});
