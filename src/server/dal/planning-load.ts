import 'server-only';
// Planning load (R-084; owner answers 17 Oct 2026, third round — rules in src/domain/planning-load.ts): the ONE source of the
// people's load and of the demand by trade, read from the project schedules (activities × activity_assignments × working
// calendars). Every load reader goes through it: Resources (heatmap, week view, capacity vs demand), Project resources, the
// what-if, the department head's Home, the portfolio over-allocation alert, Approvals, the new-request dialog, My work, Site
// conflicts, the capacity what-if of Prioritisation, the exports. The `allocations` table is no longer read for load.
// Also: the activities that need work and declare no resource at all (owner answer B: an alert), and — owner answers 18 Oct 2026,
// fourth round — those with no assignment that start within 15 days (J-15 alert); external crews are left out of the load.
// R-084 (absences): each person's weekly capacity — 40 h less their absence days (`leave_entries`, every source: Cursus and
// the seeded rows; Settings public holidays never count as a day off) — rule `personWeekCapacities`.
import { cache } from 'react';
import { and, asc, eq, gt, gte, isNotNull, lt, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { addCalendarDays, type WorkCalendar } from '@/domain/calendar';
import { DEFAULT_PROJECT_CALENDAR, projectCalendarCode } from '@/domain/ch4-defaults';
import {
  personWeekCapacities, planningLoad, unassignedActivitiesAt, undeclaredActivities, type PlanActivity, type PlanAssignment, type PlanningLoad,
} from '@/domain/planning-load';
import { WHATIF_RULES } from '@/domain/whatif';
import { versionedRead } from '@/server/cache/read-cache';
import { getDb } from '@/server/db/client';
import { activities, activityAssignments, departments, leaveEntries, persons, projects, rateRoles } from '@/server/db/schema';
import { loadWorkCalendarsOf } from './calendars';
import { settingsHolidayRows } from './settings-lists';

/** Name of a person as the pool names them (full name, else short name). */
const poolName = (p: { full: string | null; short: string }) => p.full ?? p.short;

export interface PlanningLoadData extends PlanningLoad {
  /** Person key (id) → name as the pool shows it. */
  names: Record<string, string>;
  /**
   * R-084 (absences): capacity per week (hours) of the persons (by id) with an absence in the weeks — 40 h less 8 h per day off;
   * everyone else has 40 h a week (`capacityOf`).
   */
  capacity: Record<string, number[]>;
}

/** R-084 (absences): the persons' capacities over `weeks` from the leave calendar (every source) and the Settings holidays. */
async function capacities(weeks: readonly string[]): Promise<Record<string, number[]>> {
  const db = await getDb();
  const friday = addCalendarDays(weeks[weeks.length - 1], 4);
  const [rows, holidays] = await Promise.all([
    db.select({ person: leaveEntries.personId, type: leaveEntries.leaveType, start: leaveEntries.startDate, end: leaveEntries.endDate })
      .from(leaveEntries).where(and(lte(leaveEntries.startDate, friday), gte(leaveEntries.endDate, weeks[0]))),
    settingsHolidayRows(db),
  ]);
  return personWeekCapacities(rows, weeks, new Set(holidays.map((h) => h.date)));
}

/**
 * Working calendars of each project (by code), Settings holidays applied. Also read by the Cursus task push (R-180). R-017: in
 * three reads for every project (it read the calendars once per project).
 */
export async function calendarsOf(codes: readonly string[]) {
  return loadWorkCalendarsOf(codes);
}

/** An activity's working calendar: its own, else its project's, else the default project calendar. */
export const calendarFor = (own: Record<string, WorkCalendar>, activityCalendar: string | null, projectCalendar: string | null): WorkCalendar =>
  (activityCalendar && own[activityCalendar]) || own[projectCalendarCode({ calendar: projectCalendar })] || own[DEFAULT_PROJECT_CALENDAR];

/** Activities dated across [from, to] (every project) with their assignments, in the shape of the load rules. */
async function planFacts(from: string, to: string): Promise<{ acts: PlanActivity[]; asg: PlanAssignment[]; names: Record<string, string> }> {
  const db = await getDb();
  const owner = alias(persons, 'owner');
  const odept = alias(departments, 'odept');
  const inWindow = and(isNotNull(activities.startDate), isNotNull(activities.finishDate), lte(activities.startDate, to), gte(activities.finishDate, from));
  const rows = await db
    .select({
      id: activities.id, code: activities.code, name: activities.name, start: activities.startDate, finish: activities.finishDate, dur: activities.durationDays,
      pc: activities.percentComplete, cal: activities.calendarCode, project: projects.code, projectCal: projects.calendar, owner: activities.ownerPersonId, ownerDept: odept.name,
    })
    .from(activities)
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .leftJoin(owner, eq(owner.id, activities.ownerPersonId))
    .leftJoin(odept, eq(odept.id, owner.departmentId))
    .where(inWindow);
  if (!rows.length) return { acts: [], asg: [], names: {} };
  const adept = alias(departments, 'adept');
  const who = alias(persons, 'who');
  const asg = await db
    .select({
      act: activityAssignments.activityId, resource: activityAssignments.resource, person: activityAssignments.personId, full: who.fullName, short: who.shortName,
      dept: adept.name, units: activityAssignments.resourceCount, hpd: activityAssignments.hoursPerDay, planned: activityAssignments.plannedHours,
      external: rateRoles.isExternal,
    })
    .from(activityAssignments)
    // R-017: the activities of the window by a join on the same conditions (an IN list of thousands of ids was the slowest part).
    .innerJoin(activities, eq(activities.id, activityAssignments.activityId))
    .leftJoin(who, eq(who.id, activityAssignments.personId))
    .leftJoin(rateRoles, eq(rateRoles.id, who.rateRoleId))
    .leftJoin(adept, eq(adept.id, activityAssignments.departmentId))
    .where(inWindow)
    .orderBy(asc(activityAssignments.position));
  const cals = await calendarsOf(rows.map((r) => r.project));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names: Record<string, string> = {};
  for (const a of asg) if (a.person && a.short) names[a.person] = poolName({ full: a.full, short: a.short });
  return {
    acts: rows.map((r) => ({
      project: r.project, code: r.code, name: r.name, start: r.start, finish: r.finish, durationDays: r.dur, percentComplete: r.pc, owner: r.owner, ownerTrade: r.ownerDept,
      calendar: calendarFor(cals.get(r.project)!, r.cal, r.projectCal),
    })),
    asg: asg.flatMap((a) => {
      const r = byId.get(a.act);
      return r ? [{
        project: r.project, activity: r.code, resource: a.resource, person: a.person, department: a.dept, personExternal: !!a.external, units: a.units, hoursPerDay: a.hpd,
        plannedHours: a.planned,
      }] : [];
    }),
    names,
  };
}

/**
 * Memoised per request on the weeks asked (several readers of one page share it), and across requests while the database has
 * not changed (R-017: it reads every activity dated in the window across the portfolio; exact, src/server/cache/read-cache.ts).
 */
const loadOf = cache(async (key: string): Promise<PlanningLoadData> => {
  const weeks = key ? key.split(',') : [];
  if (!weeks.length) return { weeks: [], people: {}, personProjects: {}, trades: [], names: {}, capacity: {} };
  return versionedRead(`planning-load|${key}`, async () => {
    const [{ acts, asg, names }, capacity] = await Promise.all([planFacts(weeks[0], addCalendarDays(weeks[weeks.length - 1], 6)), capacities(weeks)]);
    return { ...planningLoad(acts, asg, weeks, WHATIF_RULES.ownerHoursPerDay), names, capacity };
  });
});

/**
 * Hours per week over `weeks` (ISO Mondays): of every named person (by person id; `names` gives their pool name) and of every
 * trade (unnamed assignments and owner-only activities), from every project's schedule; with the persons' weekly capacities
 * reduced by their absences (`capacity`, R-084).
 */
export async function getPlanningLoad(weeks: readonly string[]): Promise<PlanningLoadData> {
  return loadOf(weeks.join(','));
}

export interface UndeclaredActivity {
  projectCode: string;
  /** "A1250". */
  code: string;
  /** EN source name, as typed. */
  name: string;
  start: string | null;
  finish: string | null;
  percentComplete: number;
}

/** Activities that need work (of one project, or every project; plan order) with their assignments' quantities. */
async function staffingFacts(projectCode?: string) {
  const db = await getDb();
  // R-017: the activities that need work are filtered in SQL, and their assignments read by a join on the same condition (an IN
  // list of every open activity id could pass PostgreSQL's 65 535 parameters on a large portfolio).
  const needsWork = and(projectCode ? eq(projects.code, projectCode) : undefined, gt(activities.durationDays, 0), lt(activities.percentComplete, 100));
  const open = await db
    .select({
      id: activities.id, project: projects.code, code: activities.code, name: activities.name, start: activities.startDate, finish: activities.finishDate,
      durationDays: activities.durationDays, percentComplete: activities.percentComplete, owner: activities.ownerPersonId,
    })
    .from(activities)
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .where(needsWork)
    .orderBy(asc(projects.sortOrder), asc(activities.position));
  if (!open.length) return { open, asg: [] };
  const list = await db
    .select({ id: activityAssignments.activityId, units: activityAssignments.resourceCount, hoursPerDay: activityAssignments.hoursPerDay, plannedHours: activityAssignments.plannedHours })
    .from(activityAssignments)
    .innerJoin(activities, eq(activities.id, activityAssignments.activityId))
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .where(needsWork);
  const byId = new Map(open.map((r) => [r.id, r]));
  const asg = list.flatMap((d) => {
    const r = byId.get(d.id);
    return r ? [{ project: r.project, activity: r.code, units: d.units, hoursPerDay: d.hoursPerDay, plannedHours: d.plannedHours }] : [];
  });
  return { open, asg };
}

const toUndeclared = (r: Awaited<ReturnType<typeof staffingFacts>>['open'][number]): UndeclaredActivity => ({
  projectCode: r.project, code: r.code, name: r.name, start: r.start, finish: r.finish, percentComplete: r.percentComplete,
});

/**
 * Activities that need work (not a milestone, not complete) with no resource declared at all — no assignment and no owner
 * (owner answer 17 Oct 2026, third round, B: an alert). Of one project, or of every project; in plan order.
 */
export async function listUndeclaredActivities(projectCode?: string): Promise<UndeclaredActivity[]> {
  const { open, asg } = await staffingFacts(projectCode);
  return undeclaredActivities(open, asg).map(toUndeclared);
}

/**
 * Activities the PM is warned about at J-15 (owner answer 18 Oct 2026, fourth round: « à 15 jours d'une activité sans affectation
 * préviens le chef de projet »): need work, an owner but no labour assignment, starting within 15 days of `today` (the business
 * date) or already started (rule `unassignedActivitiesAt`). Of one project, or of every project; in plan order.
 */
export async function listUnassignedActivities(today: string, projectCode?: string): Promise<UndeclaredActivity[]> {
  const { open, asg } = await staffingFacts(projectCode);
  return unassignedActivitiesAt(open, asg, today).map(toUndeclared);
}
