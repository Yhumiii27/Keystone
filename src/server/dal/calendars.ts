import 'server-only';
// Calendars DAL (chapter 4, S-2): the work calendars (built-in, imported per project), their exceptions, the company holidays
// of Settings, the project calendar and the per-activity override. `loadWorkCalendars` builds the WorkCalendar objects the
// CPM engine uses. Writers validate the codes and write audit + activity; Server Functions check the viewer first.
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { WorkCalendar, isIsoDate, type CalendarDef } from '@/domain/calendar';
import { DEFAULT_PROJECT_CALENDAR } from '@/domain/ch4-defaults';
import { getDb, type DB, type Tx } from '@/server/db/client';
import type { CalendarCode } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, calendarExceptions, calendars, projects, referenceValues } from '@/server/db/schema';

type Q = DB | Tx;

export interface CalendarException {
  date: string;
  working: boolean;
  name: string;
}

export interface CalendarRow extends CalendarDef {
  builtIn: boolean;
  active: boolean;
  /** Project of an imported calendar; null for company calendars. */
  projectCode: string | null;
  externalUid: string | null;
  exceptions: CalendarException[];
}

/** Company holidays of Settings › Public holidays (active entries whose code is an ISO date). */
export async function settingsHolidayDates(q?: Q): Promise<string[]> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ code: referenceValues.code })
    .from(referenceValues)
    .where(and(eq(referenceValues.listKey, 'holidays'), eq(referenceValues.active, true)));
  return rows.map((r) => r.code).filter(isIsoDate).sort();
}

/** Calendars: company ones plus the project's imported ones (`projectCode`), in display order. */
export async function listCalendars(opts: { projectCode?: string | null; includeInactive?: boolean } = {}, q?: Q): Promise<CalendarRow[]> {
  const db = q ?? (await getDb());
  const projectId = opts.projectCode ? (await requireProject(db, opts.projectCode)).id : null;
  const rows = await db
    .select({ c: calendars, projectCode: projects.code })
    .from(calendars)
    .leftJoin(projects, eq(projects.id, calendars.projectId))
    .where(projectId ? or(isNull(calendars.projectId), eq(calendars.projectId, projectId)) : isNull(calendars.projectId))
    .orderBy(asc(calendars.position), asc(calendars.code));
  const ex = await db.select().from(calendarExceptions).orderBy(asc(calendarExceptions.date));
  return rows
    .filter(({ c }) => opts.includeInactive || c.active)
    .map(({ c, projectCode }) => ({
      code: c.code, name: c.name, workDays: c.workDays, hoursPerDay: c.hoursPerDay, holidaySet: c.holidaySet, useSettingsHolidays: c.useSettingsHolidays,
      builtIn: c.builtIn, active: c.active, projectCode, externalUid: c.externalUid,
      exceptions: ex.filter((e) => e.calendarCode === c.code).map((e) => ({ date: e.date, working: e.working, name: e.name })),
    }));
}

/** WorkCalendars by code (company + the project's calendars) with Settings holidays and exceptions applied. */
export async function loadWorkCalendars(projectCode?: string | null, q?: Q): Promise<Record<string, WorkCalendar>> {
  const [rows, holidays] = await Promise.all([listCalendars({ projectCode, includeInactive: true }, q), settingsHolidayDates(q)]);
  return Object.fromEntries(rows.map((r) => [r.code, new WorkCalendar(r, { settingsHolidays: holidays, exceptions: r.exceptions })]));
}

/**
 * `loadWorkCalendars` of several projects in three reads (R-017: the planning load used to read the calendars once per project
 * of the portfolio). Project code → WorkCalendars by code (company calendars + that project's imported ones); the company
 * calendars are the same objects for every project (WorkCalendar is immutable once built).
 */
export async function loadWorkCalendarsOf(projectCodes: readonly string[], q?: Q): Promise<Map<string, Record<string, WorkCalendar>>> {
  const db = q ?? (await getDb());
  const codes = [...new Set(projectCodes)];
  const [rows, ex, holidays] = await Promise.all([
    db.select({ c: calendars, projectCode: projects.code }).from(calendars).leftJoin(projects, eq(projects.id, calendars.projectId))
      .orderBy(asc(calendars.position), asc(calendars.code)),
    db.select().from(calendarExceptions).orderBy(asc(calendarExceptions.date)),
    settingsHolidayDates(db),
  ]);
  const build = (c: typeof calendars.$inferSelect) => new WorkCalendar(
    { code: c.code, name: c.name, workDays: c.workDays, hoursPerDay: c.hoursPerDay, holidaySet: c.holidaySet, useSettingsHolidays: c.useSettingsHolidays },
    { settingsHolidays: holidays, exceptions: ex.filter((e) => e.calendarCode === c.code).map((e) => ({ date: e.date, working: e.working, name: e.name })) },
  );
  const company = rows.filter((r) => !r.c.projectId).map((r) => [r.c.code, build(r.c)] as const);
  const wanted = new Set(codes);
  const own = new Map<string, (readonly [string, WorkCalendar])[]>();
  for (const r of rows) if (r.c.projectId && r.projectCode && wanted.has(r.projectCode)) own.set(r.projectCode, [...(own.get(r.projectCode) ?? []), [r.c.code, build(r.c)] as const]);
  // Same order as listCalendars (position, code) — company and project calendars interleaved as stored.
  const order = new Map(rows.map((r, i) => [r.c.code, i]));
  return new Map(codes.map((code) => {
    const list = [...company, ...(own.get(code) ?? [])].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
    return [code, Object.fromEntries(list)] as const;
  }));
}

/** The project's calendar code (S-2 default when none is set). */
export async function getProjectCalendarCode(code: string, q?: Q): Promise<string> {
  const db = q ?? (await getDb());
  const [p] = await db.select({ calendar: projects.calendar }).from(projects).where(eq(projects.code, code));
  if (!p) throw new Error(`Unknown project ${code}`);
  return p.calendar ?? DEFAULT_PROJECT_CALENDAR;
}

async function requireCalendar(q: Q, calendarCode: string, projectId: string): Promise<{ code: string; name: string }> {
  const [c] = await q.select({ code: calendars.code, name: calendars.name, active: calendars.active, projectId: calendars.projectId }).from(calendars).where(eq(calendars.code, calendarCode));
  if (!c || !c.active || (c.projectId && c.projectId !== projectId)) throw new Error(`Unknown calendar "${calendarCode}"`);
  return c;
}

/** Sets the project calendar ("Calendar" chip). Durations are re-dated at the next Reschedule (S-1 manual). */
export async function setProjectCalendar(code: string, calendarCode: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const cal = await requireCalendar(tx, calendarCode, p.id);
    const [cur] = await tx.select({ calendar: projects.calendar }).from(projects).where(eq(projects.id, p.id));
    if ((cur.calendar ?? DEFAULT_PROJECT_CALENDAR) === calendarCode && cur.calendar) return;
    await tx.update(projects).set({ calendar: calendarCode as CalendarCode, updatedAt: new Date() }).where(eq(projects.id, p.id));
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: code, change: `calendar: ${cur.calendar ?? DEFAULT_PROJECT_CALENDAR} → ${calendarCode}`, area: 'Planning', entityType: 'project', projectId: p.id });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Set the project calendar to ${cal.name}`, kind: 'change', projectId: p.id });
  });
}

/** Per-activity calendar override (null = back to the project calendar). */
export async function setActivityCalendar(code: string, activityCode: string, calendarCode: string | null, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const [a] = await tx.select({ id: activities.id, calendarCode: activities.calendarCode }).from(activities).where(and(eq(activities.projectId, p.id), eq(activities.code, activityCode)));
    if (!a) throw new Error(`Unknown activity ${activityCode}`);
    if (calendarCode) await requireCalendar(tx, calendarCode, p.id);
    if ((a.calendarCode ?? null) === calendarCode) return;
    await tx.update(activities).set({ calendarCode: calendarCode as CalendarCode | null, updatedAt: new Date() }).where(eq(activities.id, a.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: activityCode, change: `calendar: ${a.calendarCode ?? 'project'} → ${calendarCode ?? 'project'}`,
      area: 'Planning', entityType: 'activity', entityId: a.id, projectId: p.id,
    });
  });
}

export interface CalendarInput {
  code: string;
  name: string;
  /** ISO weekdays 1–7. */
  workDays: number[];
  hoursPerDay: number;
  holidaySet?: string | null;
  useSettingsHolidays?: boolean;
  /** Imported calendar of a project. */
  projectCode?: string | null;
  externalUid?: string | null;
  exceptions?: CalendarException[];
}

/** Creates or replaces a non-built-in calendar and its exceptions (MS Project / P6 imports). Returns its code. */
export async function upsertCalendar(input: CalendarInput, actorName: string, q?: Q): Promise<string> {
  const run = async (tx: Q) => {
    const code = input.code.trim();
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(code)) throw new Error(`Invalid calendar code "${input.code}"`);
    const workDays = [...new Set(input.workDays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort();
    if (!workDays.length) throw new Error(`Calendar ${code} has no working day`);
    if (!(input.hoursPerDay > 0 && input.hoursPerDay <= 24)) throw new Error(`Calendar ${code}: hours per day must be in ]0, 24]`);
    const [existing] = await tx.select({ builtIn: calendars.builtIn }).from(calendars).where(eq(calendars.code, code));
    if (existing?.builtIn) throw new Error(`Calendar ${code} is built in`);
    const projectId = input.projectCode ? (await requireProject(tx, input.projectCode)).id : null;
    const values = {
      code, name: input.name.trim() || code, workDays, hoursPerDay: input.hoursPerDay, holidaySet: input.holidaySet ?? null, useSettingsHolidays: input.useSettingsHolidays ?? false,
      builtIn: false, active: true, projectId, externalUid: input.externalUid ?? null,
    };
    if (existing) await tx.update(calendars).set({ ...values, updatedAt: new Date() }).where(eq(calendars.code, code));
    else {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${calendars.position}), -1)::int` }).from(calendars);
      await tx.insert(calendars).values({ ...values, position: max + 1 });
    }
    await tx.delete(calendarExceptions).where(eq(calendarExceptions.calendarCode, code));
    const ex = (input.exceptions ?? []).filter((e) => isIsoDate(e.date));
    const seen = new Set<string>();
    const rows = ex.filter((e) => !seen.has(e.date) && !!seen.add(e.date)).map((e) => ({ calendarCode: code, date: e.date, working: e.working, name: e.name ?? '' }));
    if (rows.length) await tx.insert(calendarExceptions).values(rows);
    await writeAudit(tx, { actorName, objectRef: `Calendar ${code}`, change: existing ? 'updated' : 'created', area: 'Planning', entityType: 'calendar', projectId });
    return code;
  };
  if (q) return run(q);
  return (await getDb()).transaction(run);
}

/** Adds or replaces one exception of a calendar (closure or exceptional working day). */
export async function setCalendarException(calendarCode: string, e: CalendarException, actorName: string): Promise<void> {
  if (!isIsoDate(e.date)) throw new Error(`Invalid date "${e.date}"`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ code: calendars.code }).from(calendars).where(eq(calendars.code, calendarCode));
    if (!c) throw new Error(`Unknown calendar "${calendarCode}"`);
    await tx.delete(calendarExceptions).where(and(eq(calendarExceptions.calendarCode, calendarCode), eq(calendarExceptions.date, e.date)));
    await tx.insert(calendarExceptions).values({ calendarCode, date: e.date, working: e.working, name: e.name ?? '' });
    await writeAudit(tx, { actorName, objectRef: `Calendar ${calendarCode}`, change: `${e.date}: ${e.working ? 'working' : 'non-working'}`, area: 'Planning', entityType: 'calendar' });
  });
}

export async function removeCalendarException(calendarCode: string, date: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const del = await tx.delete(calendarExceptions).where(and(eq(calendarExceptions.calendarCode, calendarCode), eq(calendarExceptions.date, date))).returning({ id: calendarExceptions.id });
    if (del.length) await writeAudit(tx, { actorName, objectRef: `Calendar ${calendarCode}`, change: `${date}: exception removed`, area: 'Planning', entityType: 'calendar' });
  });
}
