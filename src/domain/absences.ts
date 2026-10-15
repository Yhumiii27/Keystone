// Absences received from Cursus (R-031: NEW-CURSUS-4 "a", NEW-CURSUS-7 "a"; Lucca is unplugged) — pure rules. Keystone keeps
// the dates and one of two simple types, never the reason (R-173): Leave (paid leave, RTT) or Absence (anything else). An
// absence is stored one row per week it covers (the leave grid is week-based); a week's days are its weekdays inside the
// absence minus the public holidays of Settings. Half days cannot be represented (whole days only: open question).

import { addDaysIso, dowOfIso, type LeaveType } from '@/server/db/codes';

/** The two leave types (reference data of both seeds and of the data migration). */
export const LEAVE_TYPE_ROWS: readonly { code: LeaveType; label: string; daysPerWeek: number }[] = [
  { code: 'leave', label: 'Leave', daysPerWeek: 5 },
  { code: 'absence', label: 'Absence', daysPerWeek: 5 },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date "YYYY-MM-DD". */
export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** Monday of the week of a date. */
export const mondayOf = (iso: string) => addDaysIso(iso, -((dowOfIso(iso) + 6) % 7));

/** Longest absence Keystone splits into weeks (a year and a bit); a longer one is refused as malformed. */
export const MAX_ABSENCE_DAYS = 400;

export interface AbsenceWeek {
  /** Monday of the week. */
  weekStart: string;
  /** The absence's first and last day inside that week. */
  startDate: string;
  endDate: string;
  /** Working days lost that week: weekdays of [startDate, endDate] that are not public holidays. */
  days: number;
}

/**
 * The weeks an absence [start, end] covers, with their working days; weeks without a working day lost (a weekend, a
 * public holiday) are left out. Throws on dates that are not real dates, an end before the start, or an absence longer
 * than MAX_ABSENCE_DAYS.
 */
export function absenceWeeks(start: string, end: string, holidays: ReadonlySet<string>): AbsenceWeek[] {
  if (!isIsoDate(start) || !isIsoDate(end)) throw new Error('Invalid absence dates');
  if (end < start) throw new Error('The absence ends before it starts');
  const span = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  if (span > MAX_ABSENCE_DAYS) throw new Error('The absence is too long');
  const out: AbsenceWeek[] = [];
  for (let week = mondayOf(start); week <= end; week = addDaysIso(week, 7)) {
    const from = week < start ? start : week;
    const sunday = addDaysIso(week, 6);
    const to = sunday > end ? end : sunday;
    let days = 0;
    for (let d = from; d <= to; d = addDaysIso(d, 1)) {
      const dow = dowOfIso(d);
      if (dow >= 1 && dow <= 5 && !holidays.has(d)) days++;
    }
    if (days > 0) out.push({ weekStart: week, startDate: from, endDate: to, days });
  }
  return out;
}

/**
 * Replacement key of an absence: Cursus's own id when it gives one, else matricule + dates (a corrected absence with new
 * dates and no id cannot replace the old one — open question to Cursus).
 */
export const absenceKey = (a: { id?: string | null; matricule: string; start: string; end: string }) => (a.id?.trim() ? `cursus:${a.id.trim()}` : `${a.matricule}|${a.start}|${a.end}`);

/**
 * For R-119 (site-team conflicts, site-quality lot): does an absence [start, end] overlap a site rotation [from, to]?
 * Inclusive dates.
 */
export const absenceOverlapsRotation = (absence: { start: string; end: string }, rotation: { from: string; to: string }) =>
  absence.start <= rotation.to && rotation.from <= absence.end;
