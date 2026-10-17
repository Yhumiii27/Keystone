// Chapter 4 seed (delivery 6): built-in work calendars (S-2), BL1 baseline rows and their activity snapshots (S-3), and the
// numeric quantities of the resource assignments (S-7). Reads the database it seeds — not the prototype JSON — so the same
// code seeds a fresh database and backfills one seeded before migration 0005 (see seedIfEmpty). Nothing here changes a
// displayed value: the BL1 rows carry exactly what the Plan and the Change control register showed before.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { parseAssignmentQuantities } from '@/domain/assignments';
import { BUILTIN_CALENDARS, BUILTIN_CALENDAR_BY_CODE, WorkCalendar } from '@/domain/calendar';
import { DEFAULT_PROJECT_CALENDAR } from '@/domain/ch4-defaults';
import { isoOfDemoDate } from '../codes';
import { activities, activityAssignments, baselineActivities, baselines, calendars, persons, projectControls, projects, wbsNodes } from '../schema';
import type { Tx } from '../types';
import { newId } from './context';

/** The four built-in calendars, in display order. */
export function builtinCalendarRows(): (typeof calendars.$inferInsert)[] {
  return BUILTIN_CALENDARS.map((c, position) => ({
    code: c.code, name: c.name, workDays: [...c.workDays], hoursPerDay: c.hoursPerDay, holidaySet: c.holidaySet, useSettingsHolidays: c.useSettingsHolidays,
    builtIn: true, active: true, position,
  }));
}

/** Baseline rows recorded before chapter 4 (BASELINES of HLT-026) are seed data. */
async function markSeedBaselines(tx: Tx): Promise<void> {
  await tx.update(baselines).set({ source: 'seed' });
}

/**
 * BL1 of every project with planning data: the recorded one (HLT-026), else the approved baseline of the project controls
 * ("BL1 · 9 Apr 2026", the BAC of `recon.orig`, the finish of `baselineText` — exactly what the Change control register
 * showed through its fallback); then the activity snapshot from each activity's BL1 finish (`bl`). The snapshot start is
 * derived: BL1 finish − duration on the project calendar (the prototype keeps only the finish).
 */
async function seedBaselineSnapshots(tx: Tx): Promise<void> {
  const ctl = await tx
    .select({ projectId: projects.id, calendar: projects.calendar, setOn: projectControls.baselineSet, finish: projectControls.baselineText, bac: projectControls.reconOrigKeur })
    .from(projectControls)
    .innerJoin(projects, eq(projects.id, projectControls.projectId));
  for (const c of ctl) {
    const existing = await tx.select({ id: baselines.id, code: baselines.code }).from(baselines).where(eq(baselines.projectId, c.projectId));
    let bl1 = existing.find((b) => b.code === 'BL1')?.id;
    if (!bl1) {
      const finish = isoOfDemoDate(c.finish);
      if (!finish) continue;
      bl1 = newId();
      await tx.insert(baselines).values({
        id: bl1, projectId: c.projectId, code: 'BL1', name: 'Approved baseline', setOn: isoOfDemoDate(c.setOn), bacKeur: c.bac, finishDate: finish, state: 'current',
        position: 1, source: 'seed',
      });
    }
    const snap = await tx.select({ id: baselineActivities.id }).from(baselineActivities).where(eq(baselineActivities.baselineId, bl1)).limit(1);
    if (snap.length) continue;
    const def = BUILTIN_CALENDAR_BY_CODE[c.calendar ?? DEFAULT_PROJECT_CALENDAR] ?? BUILTIN_CALENDAR_BY_CODE[DEFAULT_PROJECT_CALENDAR];
    const cal = new WorkCalendar(def);
    const acts = await tx
      .select({ a: activities, wbs: wbsNodes.code })
      .from(activities)
      .innerJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
      .where(eq(activities.projectId, c.projectId))
      .orderBy(asc(activities.position));
    const rows = acts.map(({ a, wbs }, position) => ({
      id: newId(), baselineId: bl1!, activityId: a.id, activityCode: a.code, name: a.name, wbsCode: wbs,
      startDate: a.baselineFinishDate ? cal.startOf(a.baselineFinishDate, a.durationDays) : null, finishDate: a.baselineFinishDate,
      startText: null, finishText: a.baselineFinishText, durationDays: a.durationDays, budgetKeur: a.budgetKeur, percentComplete: null, totalFloatDays: null, position,
    }));
    if (rows.length) await tx.insert(baselineActivities).values(rows);
  }
}

/** Numeric quantities of the assignments (A1250_RES texts) and the department of named people. */
async function seedAssignmentQuantities(tx: Tx): Promise<void> {
  const rows = await tx
    .select({ id: activityAssignments.id, units: activityAssignments.units, progress: activityAssignments.progressText, dept: persons.departmentId })
    .from(activityAssignments)
    .leftJoin(persons, eq(persons.id, activityAssignments.personId))
    .where(and(isNull(activityAssignments.plannedHours), isNull(activityAssignments.resourceCount)));
  for (const r of rows) {
    const q = parseAssignmentQuantities(r.units, r.progress);
    await tx.update(activityAssignments).set({ ...q, departmentId: r.dept ?? null }).where(eq(activityAssignments.id, r.id));
  }
}

/** Chapter 4 seed: in the initial seed transaction, or once on a database seeded before migration 0005. */
export async function seedChapter4(tx: Tx): Promise<void> {
  const have = new Set((await tx.select({ code: calendars.code }).from(calendars)).map((c) => c.code));
  const missing = builtinCalendarRows().filter((c) => !have.has(c.code));
  if (missing.length) await tx.insert(calendars).values(missing);
  await markSeedBaselines(tx);
  await seedBaselineSnapshots(tx);
  await seedAssignmentQuantities(tx);
}

/** Codes of the built-in calendars present in the database (db-check). */
export async function builtinCalendarCodes(tx: Tx): Promise<string[]> {
  return (await tx.select({ code: calendars.code }).from(calendars).where(inArray(calendars.code, BUILTIN_CALENDARS.map((c) => c.code)))).map((c) => c.code);
}
