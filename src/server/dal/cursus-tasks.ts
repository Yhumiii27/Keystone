import 'server-only';
// R-180: the facts of Keystone's planned work that Cursus receives as planned tasks — the schedules' named assignments (with their
// activity, project and working calendar) and the Keystone tasks with their assignee — for the tasks ending on or after `since`.
// Rules (what is sent, ids, hours per day): src/domain/cursus-tasks.ts; push: src/server/integrations/cursus/tasks.ts.
import { and, asc, eq, gte, isNotNull } from 'drizzle-orm';
import { cursusTaskSnapshot, type AssignmentFact, type CursusTaskSnapshot, type TaskFact } from '@/domain/cursus-tasks';
import { getDb } from '@/server/db/client';
import { activities, activityAssignments, persons, projects, rateRoles, tasks } from '@/server/db/schema';
import type { StageCode } from '@/server/db/codes';
import { calendarFor, calendarsOf } from './planning-load';

/** A project still open for timesheets: neither closed nor cancelled. */
const isOpenStage = (stage: StageCode) => stage !== 'clos' && stage !== 'annule';

/** Keystone tasks (with an assignee) ending on or after `since`. */
async function taskFacts(since: string): Promise<TaskFact[]> {
  const db = await getDb();
  const rows = await db
    .select({
      number: tasks.number, title: tasks.title, activityId: tasks.activityId, personId: tasks.assigneePersonId, matricule: persons.matricule, start: tasks.startDate,
      due: tasks.dueDate, estimateH: tasks.estimateH, code: projects.code, name: projects.name, stage: projects.stage,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(persons, eq(persons.id, tasks.assigneePersonId))
    .where(gte(tasks.dueDate, since))
    .orderBy(asc(tasks.number));
  return rows.map((r) => ({
    number: r.number, title: r.title, project: { code: r.code, name: r.name, open: isOpenStage(r.stage) }, activityId: r.activityId, personId: r.personId,
    matricule: r.matricule, start: r.start, due: r.due, estimateH: Number(r.estimateH),
  }));
}

/** Named schedule assignments on activities finishing on or after `since`, with the activity's working calendar. */
async function assignmentFacts(since: string): Promise<AssignmentFact[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: activityAssignments.id, personId: activityAssignments.personId, matricule: persons.matricule, external: rateRoles.isExternal, units: activityAssignments.resourceCount,
      hpd: activityAssignments.hoursPerDay, planned: activityAssignments.plannedHours, activityId: activities.id, activityCode: activities.code, activityName: activities.name,
      start: activities.startDate, finish: activities.finishDate, dur: activities.durationDays, cal: activities.calendarCode, code: projects.code, name: projects.name,
      stage: projects.stage, projectCal: projects.calendar,
    })
    .from(activityAssignments)
    .innerJoin(activities, eq(activities.id, activityAssignments.activityId))
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .innerJoin(persons, eq(persons.id, activityAssignments.personId))
    .leftJoin(rateRoles, eq(rateRoles.id, persons.rateRoleId))
    .where(and(isNotNull(activities.finishDate), gte(activities.finishDate, since)))
    .orderBy(asc(projects.code), asc(activities.position), asc(activityAssignments.position));
  if (!rows.length) return [];
  const cals = await calendarsOf(rows.map((r) => r.code));
  return rows.map((r) => ({
    id: r.id, project: { code: r.code, name: r.name, open: isOpenStage(r.stage) }, activityId: r.activityId, activityCode: r.activityCode, activityName: r.activityName,
    personId: r.personId!, matricule: r.matricule, external: !!r.external, start: r.start, finish: r.finish, durationDays: r.dur, units: r.units, hoursPerDay: r.hpd,
    plannedHours: r.planned, calendar: calendarFor(cals.get(r.code)!, r.cal, r.projectCal),
  }));
}

/** The snapshot of planned tasks for Cursus as of `since` (`depuis`). */
export async function readCursusTaskSnapshot(since: string): Promise<CursusTaskSnapshot> {
  const [t, a] = await Promise.all([taskFacts(since), assignmentFacts(since)]);
  return cursusTaskSnapshot({ tasks: t, assignments: a, since });
}
