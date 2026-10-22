// R-180 — Keystone's planned work of each person, as Cursus's planned tasks (Cursus docs/API-KEYSTONE.md « Tâches planifiées »,
// « Synchronisation complète »; Keystone's page docs/integrations/cursus-contract.md § 7). Cursus's timesheet « Proposer depuis
// Keystone » proposes, for the week shown (Monday to Sunday), one line per task with the hours planned that day; Cursus itself
// zeroes public holidays, validated absences and days not worked. One Cursus task = one person: `{ id, projet, tache, matricule,
// debut, fin, heures: { "YYYY-MM-DD": h } }`, hours 0–24 per day, every day inside `debut` → `fin`.
//
// What Keystone sends (rules, pure; the reads are src/server/dal/cursus-tasks.ts):
// - the schedules' NAMED assignments (`activity_assignments` with a person — R-084 (A): « il faut partir des allocations du
//   planning » — the one source of a person's planned hours): one Cursus task per assignment, id `KA-<assignment id>`, label
//   "<activity code> · <activity name>"; hours on every working day of the activity's calendar between its start and finish —
//   units × hours per day, else the planned hours spread evenly over those working days (the rule of `assignmentHoursInWeek`,
//   per day instead of per week). A 6-day site calendar puts hours on Saturday: Cursus proposes weekend days as the others.
//   Milestones, equipment and material (no hours) and external labour (R-083 external rate role) are not sent.
// - the Keystone TASKS (My work, `tasks`) of their assignee, id `KT-<task number>`, label "<number> · <title>", with the rule of
//   the share view `pub_taches_jours` (contract D05, drizzle/0035_share.sql) so the view and the push agree: the estimate spread
//   evenly over the weekdays (Monday–Friday) between start and due date, 2 decimals — UNLESS the assignee is also assigned on the
//   task's activity: the task is then a to-do inside that assignment, whose hours already cover it (sending both would count
//   the work twice in the timesheet proposal).
// - only for a person with a matricule (`persons.matricule`, the identifier Cursus is set to receive — EMP-xxxx by default, or
//   the payroll matricule after Cursus's switch), on a project still open (not closed nor cancelled), with at least one hour.
// - projects: every project a task cites, `{ code, nom }` (Cursus refuses a task whose project it has not received).
// Validity is checked here as Cursus checks it (ids, lengths, dates, 0–24 h), so one bad record never refuses the snapshot.

import { addCalendarDays, isoWeekday, type IsoDate } from './calendar';

/** Cursus's identifier rule (1–64 characters: letters, digits, `.`, `_`, `:`, `-`; first a letter or a digit). */
export const CURSUS_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** Lengths Cursus accepts: task label 160, project name 120, matricule 32. */
export const CURSUS_TASK_LABEL_MAX = 160;
export const CURSUS_PROJECT_NAME_MAX = 120;
const MATRICULE_MAX = 32;
/** Hours of one day, at most (Cursus refuses more). */
export const CURSUS_DAY_HOURS_MAX = 24;
/** Weeks of history the snapshot covers before the current week (`depuis`): the timesheets people may still fill or correct. */
export const CURSUS_SNAPSHOT_WEEKS_BACK = 4;
/** Largest body Cursus reads (2 MB); the snapshot above it is refused before it is sent. */
export const CURSUS_BODY_MAX_BYTES = 2 * 1024 * 1024;

export interface CursusProjectPayload {
  code: string;
  nom: string;
}

export interface CursusTaskPayload {
  id: string;
  projet: string;
  tache: string;
  matricule: string;
  debut: IsoDate;
  fin: IsoDate;
  heures: Record<IsoDate, number>;
}

interface ProjectFact {
  code: string;
  /** As typed. */
  name: string;
  /** Not closed nor cancelled. */
  open: boolean;
}

/** A Keystone task (`tasks`) with its assignee. */
export interface TaskFact {
  /** "T-2314". */
  number: string;
  title: string;
  project: ProjectFact;
  activityId: string | null;
  personId: string | null;
  matricule: string | null;
  start: IsoDate;
  due: IsoDate;
  estimateH: number;
}

/** A schedule assignment (`activity_assignments`) of a person, with its activity. */
export interface AssignmentFact {
  /** The assignment's id. */
  id: string;
  project: ProjectFact;
  activityId: string;
  /** "A1250". */
  activityCode: string;
  activityName: string;
  personId: string;
  matricule: string | null;
  /** R-083: the person's rate role is external (not EPC2i staff). */
  external: boolean;
  start: IsoDate | null;
  finish: IsoDate | null;
  /** Working days of the activity (0 = milestone). */
  durationDays: number;
  units: number | null;
  hoursPerDay: number | null;
  plannedHours: number | null;
  calendar: { isWorkDay(iso: IsoDate): boolean };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const clampDay = (h: number) => Math.min(CURSUS_DAY_HOURS_MAX, round2(h));

function* daysOf(from: IsoDate, to: IsoDate): Generator<IsoDate> {
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) yield d;
}

/**
 * Hours per day of a Keystone task — the rule of `pub_taches_jours`: `round(estimate / weekdays, 2)` on each weekday (Monday–
 * Friday) between start and due date inclusive; nothing when the period has no weekday or the estimate is not positive. A day
 * above 24 h (an estimate too large for its dates) is sent as 24 h, Cursus's limit.
 */
export function taskDailyHours(start: IsoDate, due: IsoDate, estimateH: number): Record<IsoDate, number> {
  if (!(estimateH > 0) || due < start) return {};
  const days = [...daysOf(start, due)].filter((d) => isoWeekday(d) < 6);
  if (!days.length) return {};
  const h = clampDay(estimateH / days.length);
  return h > 0 ? Object.fromEntries(days.map((d) => [d, h])) : {};
}

/**
 * Hours per day of a schedule assignment — the rule of `assignmentHoursInWeek` day by day: every working day of the activity's
 * calendar between start and finish (inclusive) receives units × hours per day, else the planned hours spread evenly over those
 * working days (2 decimals, 24 h at most). Nothing for an undated activity or an assignment counted in neither way.
 */
export function assignmentDailyHours(a: Pick<AssignmentFact, 'start' | 'finish' | 'units' | 'hoursPerDay' | 'plannedHours' | 'calendar'>): Record<IsoDate, number> {
  if (!a.start || !a.finish || a.finish < a.start) return {};
  const days = [...daysOf(a.start, a.finish)].filter((d) => a.calendar.isWorkDay(d));
  if (!days.length) return {};
  const rate = a.units != null && a.hoursPerDay != null && a.units > 0 && a.hoursPerDay > 0
    ? a.units * a.hoursPerDay
    : a.plannedHours != null && a.plannedHours > 0 ? a.plannedHours / days.length : 0;
  const h = clampDay(rate);
  return h > 0 ? Object.fromEntries(days.map((d) => [d, h])) : {};
}

/** First day the snapshot covers (`depuis`): the Monday CURSUS_SNAPSHOT_WEEKS_BACK weeks before the business date's week. */
export function cursusSnapshotSince(today: IsoDate): IsoDate {
  const monday = addCalendarDays(today, 1 - isoWeekday(today));
  return addCalendarDays(monday, -7 * CURSUS_SNAPSHOT_WEEKS_BACK);
}

const label = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** Why a record is not sent. */
export type CursusTaskSkip = 'no_matricule' | 'closed_project' | 'no_hours' | 'before_since' | 'invalid';

export interface CursusTaskSnapshot {
  /** `depuis` of the snapshot: Cursus deletes only the absent tasks that end on or after it. */
  depuis: IsoDate;
  projets: CursusProjectPayload[];
  /** Ordered by id (a stable body: the same state sends the same snapshot). */
  taches: CursusTaskPayload[];
  /** Records left out, by reason (counts). */
  skipped: Record<CursusTaskSkip, number>;
  /** Distinct persons with planned work and no matricule (they get no proposal in Cursus). */
  personsWithoutMatricule: number;
}

/**
 * The snapshot of Keystone's planned tasks for Cursus (`PUT /v1/instantane` section `taches`, plus the projects they cite) from
 * the schedules' named assignments and the Keystone tasks (rules above), for the tasks that end on or after `since`.
 */
export function cursusTaskSnapshot(input: { tasks: readonly TaskFact[]; assignments: readonly AssignmentFact[]; since: IsoDate }): CursusTaskSnapshot {
  const skipped: Record<CursusTaskSkip, number> = { no_matricule: 0, closed_project: 0, no_hours: 0, before_since: 0, invalid: 0 };
  const noMatricule = new Set<string>();
  const projects = new Map<string, CursusProjectPayload>();
  const out: CursusTaskPayload[] = [];
  const staffed = new Set<string>();

  const take = (personId: string | null, matricule: string | null, project: ProjectFact, t: Omit<CursusTaskPayload, 'matricule' | 'projet'>) => {
    if (!project.open) return void skipped.closed_project++;
    const days = Object.keys(t.heures);
    if (!days.length) return void skipped.no_hours++;
    if (t.fin < input.since) return void skipped.before_since++;
    const m = matricule?.trim() ?? '';
    if (!m) {
      skipped.no_matricule++;
      if (personId) noMatricule.add(personId);
      return;
    }
    const nom = label(project.name, CURSUS_PROJECT_NAME_MAX);
    if (!CURSUS_IDENTIFIER.test(t.id) || !CURSUS_IDENTIFIER.test(project.code) || m.length > MATRICULE_MAX || !t.tache || !nom) return void skipped.invalid++;
    projects.set(project.code, { code: project.code, nom });
    out.push({ id: t.id, projet: project.code, tache: t.tache, matricule: m, debut: t.debut, fin: t.fin, heures: t.heures });
  };

  for (const a of input.assignments) {
    // Labour of EPC2i staff only (R-084, owner 18 Oct 2026: external crews are not EPC2i's work); a milestone is no work.
    if (a.external || a.durationDays <= 0) continue;
    const heures = assignmentDailyHours(a);
    if (Object.keys(heures).length) staffed.add(`${a.personId}|${a.activityId}`);
    if (!a.start || !a.finish) { skipped.no_hours++; continue; }
    take(a.personId, a.matricule, a.project, {
      id: `KA-${a.id}`, tache: label(`${a.activityCode} · ${a.activityName}`, CURSUS_TASK_LABEL_MAX), debut: a.start, fin: a.finish, heures,
    });
  }
  for (const t of input.tasks) {
    // A to-do inside an assignment of its assignee on the same activity: the assignment's hours cover it.
    if (t.personId && t.activityId && staffed.has(`${t.personId}|${t.activityId}`)) continue;
    if (!t.personId) continue; // a contract role that is not a person yet
    take(t.personId, t.matricule, t.project, {
      id: `KT-${t.number}`, tache: label(`${t.number} · ${t.title}`, CURSUS_TASK_LABEL_MAX), debut: t.start, fin: t.due, heures: taskDailyHours(t.start, t.due, t.estimateH),
    });
  }
  out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return {
    depuis: input.since,
    projets: [...projects.values()].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0)),
    taches: out,
    skipped,
    personsWithoutMatricule: noMatricule.size,
  };
}

// ── Cursus's answers (Cursus docs/API-KEYSTONE.md « Authentification », « Idempotence »; keystone-routes.ts) ──────────────────

/**
 * Whether a refused call is worth sending again later: no answer (network, time-out), 401 (Cursus's key just changed — « les
 * appels faits entre-temps reçoivent 401 et sont à rejouer »), 408, 429 (Retry-After), 5xx (503 NON_CONFIGUREE included). Any
 * other 4xx (400 VALIDATION, 403 proxy, 413, 415) is final: sending the same body again would be refused again.
 */
export const isRetryableCursusStatus = (status: number | null): boolean =>
  status == null || status === 401 || status === 408 || status === 429 || status >= 500;

/**
 * Indexes of the `taches` items a 400 VALIDATION answer names (`details: [{ champ: "taches[3].matricule" }]`), so the snapshot
 * can be sent again without them; null when a refused field is not inside a task (the snapshot as a whole is wrong).
 */
export function refusedTaskIndexes(body: unknown): number[] | null {
  const details = (body as { details?: unknown } | null)?.details;
  if (!Array.isArray(details) || !details.length) return null;
  const out = new Set<number>();
  for (const d of details) {
    const m = /^taches\[(\d+)\]/.exec(String((d as { champ?: unknown } | null)?.champ ?? ''));
    if (!m) return null;
    out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** UTF-8 size of a JSON body. */
export const jsonBytes = (body: unknown): number => new TextEncoder().encode(JSON.stringify(body)).length;
