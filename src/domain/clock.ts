// Business clock (R-013): the one source of "today" and "now" for business rules — lateness, due dates, the dates stamped on
// writes, the greeting, form periods, the portfolio "now" line. Pure: no environment, no database. The server resolves the
// setting (src/server/clock.ts) and passes `today` down; client components receive it from the layout (ClockProvider).
//
// - `real`: the wall clock in Europe/Paris (the data set's time zone).
// - `fixed`: the date is pinned, the time of day stays real — the demo data set (frozen at Fri 25 Sep 2026), tests and
//   reproducible screenshots. A pinned date keeps the demo coherent: its overdue items, weeks and periods were written for it.
//
// Technical timestamps (comments posted, audit rows, job runs, backups, sync times) are real instants (`new Date()`), not
// this clock.
import { dayOffsetOfIso, monthIndexOfIso, parisInstant, parisParts, addDaysIso, dowOfIso } from '@/server/db/codes';

/** Business date of the demo data set (the prototype's TODAY = 4, the status date "25 Sep 2026"). Seeds use it, never the clock. */
export const DEMO_TODAY_ISO = '2026-09-25';

export type ClockSetting = { kind: 'real' } | { kind: 'fixed'; iso: string };

export const REAL_CLOCK: ClockSetting = { kind: 'real' };
export const DEMO_CLOCK: ClockSetting = { kind: 'fixed', iso: DEMO_TODAY_ISO };

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** KEYSTONE_CLOCK value → setting: "real", or a pinned YYYY-MM-DD; null when invalid. */
export function parseClockSetting(raw: string): ClockSetting | null {
  const v = raw.trim().toLowerCase();
  if (v === 'real') return REAL_CLOCK;
  return isIsoDate(v) ? { kind: 'fixed', iso: v } : null;
}

/** Business date (ISO, Europe/Paris) of the clock at the real instant `at`. */
export function todayOf(setting: ClockSetting, at: Date = new Date()): string {
  return setting.kind === 'fixed' ? setting.iso : parisParts(at).iso;
}

/** Business instant: the real instant, or — on a pinned date — that date at the real Paris time of day. */
export function businessNowOf(setting: ClockSetting, at: Date = new Date()): Date {
  if (setting.kind === 'real') return at;
  const p = parisParts(at);
  return parisInstant(setting.iso, `${p.hh}:${p.mm}`);
}

/**
 * Working-day offset of a date on the prototype's axis (Mon 21 Sep 2026 = 0, five working days a week) — the prototype's
 * TODAY. A Saturday or Sunday counts as the Friday before (the last working day).
 */
export function workdayOffsetOf(iso: string): number {
  let d = iso;
  for (let i = 0; i < 2; i++) {
    const o = dayOffsetOfIso(d);
    if (o != null) return o;
    d = addDaysIso(d, -1);
  }
  return dayOffsetOfIso(d)!;
}

/** Month index since 1 Jan 2026 of the date (the prototype's PG_NOW, ≈ 8.97 on 30 Sep 2026). */
export const monthNowOf = (iso: string) => monthIndexOfIso(iso);

/** Last working day on or before the date (a weekend date → its Friday). */
export function lastWorkdayOf(iso: string): string {
  const dow = dowOfIso(iso);
  return dow === 6 ? addDaysIso(iso, -1) : dow === 0 ? addDaysIso(iso, -2) : iso;
}
