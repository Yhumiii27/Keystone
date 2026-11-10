// Project data date and the Friday weekly freeze (R-060, owner's answers D9-09 and D9-10 of 10 Nov 2026). Pure rules shared by
// the Plan's « Data date » dialog, its Server Function and the `friday-freeze` job (src/server/dal/weekly-freeze.ts).
//
// - D9-09 « Le chef de projet l’avance, Keystone la propose chaque vendredi »: the data date of a project (projects.data_date) is
//   moved by the project's leads (PM of record, co-PM, deputy) or the director — never by Keystone. Every Friday Keystone proposes
//   that Friday to the PM of record (a bell notice, once per project and Friday) while the stored date is older or unset.
// - D9-10 « CPI, SPI, EAC, marge, risques et avancement »: the Friday freeze records one snapshot per active project.
//
// Décisions prises sans demander (docs/delivery-9/notes-d9-planning.md): the data date only moves forward and never after the
// business date; an unset data date (= the business date, `projectDataDate`) may be set to any date up to today.
import { addDaysIso } from '@/server/db/codes';
import { isIsoDate, isoWeekday } from './calendar';

/** ISO weekday of the weekly status date (Friday). */
export const STATUS_WEEKDAY = 5;

/** The latest Friday on or before `today` (the week's status date). */
export function fridayOnOrBefore(today: string): string {
  const wd = isoWeekday(today);
  return addDaysIso(today, -((wd - STATUS_WEEKDAY + 7) % 7));
}

/**
 * D9-09: the data date Keystone proposes to a project — the latest Friday up to `today` — when the stored data date is unset or
 * older; null when the stored date is already that Friday or later (nothing to propose).
 */
export function proposedDataDate(stored: string | null | undefined, today: string): string | null {
  const friday = fridayOnOrBefore(today);
  return !stored || stored < friday ? friday : null;
}

/** EN refusals of a data date change (FR in src/i18n/extra/d9-planning.json). */
export const DATA_DATE_ERRORS = {
  invalid: 'Enter a valid data date',
  future: 'The data date cannot be after today',
  backwards: 'The data date only moves forward',
  unchanged: 'The data date is already set to this date',
} as const;

/** D9-09: may the data date become `next` (stored = projects.data_date, null = unset)? EN refusal or null. */
export function dataDateError(next: unknown, stored: string | null | undefined, today: string): string | null {
  if (typeof next !== 'string' || !isIsoDate(next)) return DATA_DATE_ERRORS.invalid;
  if (next > today) return DATA_DATE_ERRORS.future;
  if (stored && next < stored) return DATA_DATE_ERRORS.backwards;
  if (stored && next === stored) return DATA_DATE_ERRORS.unchanged;
  return null;
}

// ── D9-10 · the Friday freeze ─────────────────────────────────────────────────────────────────────────────────────────

/** One frozen week of a project (status_snapshots): what D9-10 asks to record, plus the float and milestone slip already kept. */
export interface FrozenFigures {
  cpi: number;
  spi: number;
  eacKeur: number;
  floatDays: number;
  /** Σ EMV of the open risks, k€. */
  riskEmvKeur: number;
  /** Number of open risks. */
  riskCount: number;
  milestoneSlipDays: number;
  /** Physical progress 0–100 %, one decimal. */
  progressPct: number;
  /** Margin at completion, whole % (C-10b); null for an internal project or without a billing plan. */
  marginPct: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Milestone slip of the week, calendar days: the largest delay of an open milestone's forecast finish on its baseline finish
 * (0 when none is late or none has a baseline date).
 */
export function milestoneSlipDays(milestones: readonly { finish: string | null; baselineFinish: string | null; done: boolean }[]): number {
  let slip = 0;
  for (const m of milestones) {
    if (m.done || !m.finish || !m.baselineFinish) continue;
    const d = Math.round((Date.parse(m.finish + 'T00:00:00Z') - Date.parse(m.baselineFinish + 'T00:00:00Z')) / 86_400_000);
    if (d > slip) slip = d;
  }
  return slip;
}

/** Critical-path float of the week: the smallest total float of the unfinished activities (0 when none carries one). */
export function criticalFloatDays(acts: readonly { totalFloatDays: number | null; finished: boolean }[]): number {
  const fl = acts.filter((a) => !a.finished && a.totalFloatDays != null).map((a) => a.totalFloatDays as number);
  return fl.length ? Math.min(...fl) : 0;
}

/** The ratios as frozen: two decimals; an index without a value (no planned value / no actual cost) is frozen as 1. */
export const frozenIndex = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 1 : round2(v));
export const frozenKeur = round2;
