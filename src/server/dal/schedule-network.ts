import 'server-only';
// Schedule network loader (chapter 4, S-1): reads a project's activities, links, calendars and data date and returns the CPM
// input (src/domain/cpm.ts) plus the stored values a Reschedule compares against. Used by "Reschedule" (planning) and the
// what-if engine (computing on an in-memory copy). Also the log of Reschedule runs.
import { and, asc, desc, eq } from 'drizzle-orm';
import type { WorkCalendar } from '@/domain/calendar';
import { CPM_DEFAULTS, projectCalendarCode, projectDataDate } from '@/domain/ch4-defaults';
import { businessToday } from '@/server/clock';
import type { CpmActivityInput, CpmInput, CpmLinkInput, CpmLinkType } from '@/domain/cpm';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { isConstraintType, type ScheduleRunOutcome } from '@/server/db/codes';
import { findPerson, nameOf } from '@/server/db/helpers';
import { activities, activityLinks, projects, scheduleRuns, wbsNodes } from '@/server/db/schema';
import { loadWorkCalendars } from './calendars';

type Q = DB | Tx;

/** An activity as stored, with the values Reschedule rewrites. */
export interface NetworkActivity {
  /** Database id. */
  dbId: string;
  code: string;
  name: string;
  wbsCode: string;
  durationDays: number;
  percentComplete: number;
  remainingDays: number | null;
  calendarCode: string | null;
  startDate: string | null;
  finishDate: string | null;
  startActual: boolean;
  finishActual: boolean;
  startText: string;
  finishText: string;
  constraintType: string | null;
  constraintDate: string | null;
  constraintViolated: boolean;
  totalFloatDays: number | null;
  freeFloatDays: number | null;
  critical: boolean | null;
  position: number;
  /** R-010: the activity row's version (optimistic locking of the Gantt's edits). */
  version: number;
}

export interface NetworkLink {
  dbId: string;
  pred: string;
  succ: string;
  type: CpmLinkType;
  lag: number;
  isDriving: boolean;
}

export interface ScheduleNetwork {
  projectId: string;
  projectCode: string;
  dataDate: string;
  projectCalendar: string;
  calendars: Record<string, WorkCalendar>;
  activities: NetworkActivity[];
  links: NetworkLink[];
  /** Ready for `schedule()` (activity ids are the activity codes). */
  input: CpmInput;
}

/** Activity → engine input: actual dates from the "A" flags, constraint from type + ISO date (unknown types are ignored). */
export function toCpmActivity(a: NetworkActivity): CpmActivityInput {
  const constraint = a.constraintType && a.constraintType !== 'ASAP' && isConstraintType(a.constraintType) && a.constraintDate ? { type: a.constraintType, date: a.constraintDate } : null;
  return {
    id: a.code, duration: a.durationDays, calendar: a.calendarCode, percentComplete: a.percentComplete, remaining: a.remainingDays,
    actualStart: a.startActual ? a.startDate : null, actualFinish: a.finishActual && a.startActual ? a.finishDate : null, constraint,
  };
}

/** The project's schedule network; null for an unknown project. Projects without activities give an empty network. */
export async function loadScheduleNetwork(code: string, q?: Q): Promise<ScheduleNetwork | null> {
  const db = q ?? (await getDb());
  const [p] = await db
    .select({ id: projects.id, code: projects.code, dataDate: projects.dataDate, calendar: projects.calendar, plannedStart: projects.plannedStartDate })
    .from(projects)
    .where(eq(projects.code, code));
  if (!p) return null;
  const [rows, linkRows, calendars] = await Promise.all([
    db
      .select({ a: activities, wbs: wbsNodes.code })
      .from(activities)
      .innerJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
      .where(eq(activities.projectId, p.id))
      .orderBy(asc(activities.position)),
    db.select().from(activityLinks).where(eq(activityLinks.projectId, p.id)).orderBy(asc(activityLinks.successorId), asc(activityLinks.position)),
    loadWorkCalendars(code, q),
  ]);
  const codeOf = new Map(rows.map(({ a }) => [a.id, a.code]));
  const acts: NetworkActivity[] = rows.map(({ a, wbs }) => ({
    dbId: a.id, code: a.code, name: a.name, wbsCode: wbs, durationDays: a.durationDays, percentComplete: a.percentComplete, remainingDays: a.remainingDays,
    calendarCode: a.calendarCode, startDate: a.startDate, finishDate: a.finishDate, startActual: a.startActual, finishActual: a.finishActual, startText: a.startText,
    finishText: a.finishText, constraintType: a.constraintType, constraintDate: a.constraintDate, constraintViolated: a.constraintViolated, totalFloatDays: a.totalFloatDays,
    freeFloatDays: a.freeFloatDays, critical: a.critical, position: a.position, version: a.version,
  }));
  // Links in the successor's predecessor order (activity order first).
  const order = new Map(acts.map((a, i) => [a.code, i]));
  const links: NetworkLink[] = linkRows
    .map((l) => ({ dbId: l.id, pred: codeOf.get(l.predecessorId)!, succ: codeOf.get(l.successorId)!, type: l.type, lag: l.lagDays, isDriving: l.isDriving, pos: l.position }))
    .filter((l) => l.pred && l.succ)
    .sort((x, y) => order.get(x.succ)! - order.get(y.succ)! || x.pos - y.pos)
    .map((l): NetworkLink => ({ dbId: l.dbId, pred: l.pred, succ: l.succ, type: l.type, lag: l.lag, isDriving: l.isDriving }));
  const dataDate = projectDataDate(p, await businessToday(db));
  const projectCalendar = projectCalendarCode(p);
  const input: CpmInput = {
    dataDate, projectStart: p.plannedStart, projectCalendar, calendars, activities: acts.map(toCpmActivity),
    links: links.map((l): CpmLinkInput => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })), options: CPM_DEFAULTS,
  };
  return { projectId: p.id, projectCode: p.code, dataDate, projectCalendar, calendars, activities: acts, links, input };
}

export interface ScheduleRunInput {
  outcome: ScheduleRunOutcome;
  dataDate: string;
  previousFinishDate?: string | null;
  finishDate?: string | null;
  changedActivities?: number;
  criticalActivities?: number;
  constraintViolations?: number;
  /** EN source text (cycle, error). */
  message?: string | null;
  details?: Record<string, unknown>;
}

/** Records a Reschedule run (inside the Reschedule transaction when `q` is given). */
export async function recordScheduleRun(code: string, run: ScheduleRunInput, actorName: string, q?: Q): Promise<void> {
  const db = q ?? (await getDb());
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  if (!p) throw new Error(`Unknown project ${code}`);
  const actor = await findPerson(db, actorName);
  await db.insert(scheduleRuns).values({
    projectId: p.id, ranByPersonId: actor?.id ?? null, ranByName: actor ? nameOf(actor) : actorName, dataDate: run.dataDate, outcome: run.outcome,
    previousFinishDate: run.previousFinishDate ?? null, finishDate: run.finishDate ?? null, changedActivities: run.changedActivities ?? 0,
    criticalActivities: run.criticalActivities ?? 0, constraintViolations: run.constraintViolations ?? 0, message: run.message ?? null, details: run.details ?? {},
  });
}

export interface ScheduleRunRow extends Required<Omit<ScheduleRunInput, 'details'>> {
  ranAt: Date;
  ranByName: string;
  details: Record<string, unknown>;
}

/** Reschedule runs of a project, newest first. */
export async function listScheduleRuns(code: string, limit = 20, q?: Q): Promise<ScheduleRunRow[]> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ r: scheduleRuns })
    .from(scheduleRuns)
    .innerJoin(projects, eq(projects.id, scheduleRuns.projectId))
    .where(and(eq(projects.code, code)))
    .orderBy(desc(scheduleRuns.ranAt))
    .limit(limit);
  return rows.map(({ r }) => ({
    ranAt: r.ranAt, ranByName: r.ranByName, outcome: r.outcome, dataDate: r.dataDate, previousFinishDate: r.previousFinishDate, finishDate: r.finishDate,
    changedActivities: r.changedActivities, criticalActivities: r.criticalActivities, constraintViolations: r.constraintViolations, message: r.message, details: r.details,
  }));
}
