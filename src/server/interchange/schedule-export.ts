import 'server-only';
// "Export — MS Project XML" (chapter 4, S-9): a project's schedule as an MSPDI file — the WBS (work packages as summary tasks),
// activities with their Activity ID, durations, dates, % complete, actual dates, constraints, calendars (week, hours, public
// holidays and exceptions of the years the project spans), logic with lags, resource assignments and the DISPLAYED baseline as
// MS Project's Baseline 0 (S-3: the Baseline chip). Built from the database, written by ./mspdi.ts; the export route checks the
// viewer. Importing the file back (./schedule-import.ts) gives the same schedule (round trip).
import { asc, eq } from 'drizzle-orm';
import { BUILTIN_CALENDARS } from '@/domain/calendar';
import { DEFAULT_PROJECT_CALENDAR, projectDataDate } from '@/domain/ch4-defaults';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { activities, activityAssignments, activityLinks, clients, connectors, projects, wbsNodes } from '@/server/db/schema';
import { getBaselineActivities, getDisplayedBaselineCode } from '@/server/dal/baselines';
import { listCalendars, loadWorkCalendars } from '@/server/dal/calendars';
import { writeMspdi } from './mspdi';
import type { ImportedActivity, ImportedAssignment, ImportedCalendar, ImportedLink, ImportedResource, ImportedSchedule, ImportedWbs } from './model';

type Q = DB | Tx;

export interface ScheduleExport {
  schedule: ImportedSchedule;
  /** Baseline written as Baseline 0 (null when the project has none). */
  baselineCode: string | null;
  fileName: string;
}

/** Positive integer UIDs: an imported UID is kept when it is a free positive integer, the others are numbered after them. */
function uidAllocator(candidates: (string | null)[]): (uid: string | null) => string {
  const used = new Set<number>();
  for (const c of candidates) if (c && /^[1-9]\d{0,8}$/.test(c)) used.add(+c);
  let next = Math.max(0, ...used) + 1;
  const given = new Set<number>();
  return (uid) => {
    if (uid && /^[1-9]\d{0,8}$/.test(uid) && !given.has(+uid)) {
      given.add(+uid);
      return uid;
    }
    while (used.has(next) || given.has(next)) next++;
    given.add(next);
    return String(next++);
  };
}

/** Builds the neutral schedule of a project; null for an unknown project or one without planning data. */
export async function buildScheduleExport(code: string, now: Date = new Date(), q?: Q): Promise<ScheduleExport | null> {
  const db = q ?? (await getDb());
  const [p] = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, calendar: projects.calendar, dataDate: projects.dataDate, plannedStart: projects.plannedStartDate, client: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(eq(projects.code, code));
  if (!p) return null;
  const [nodes, acts, linkRows] = await Promise.all([
    db.select().from(wbsNodes).where(eq(wbsNodes.projectId, p.id)).orderBy(asc(wbsNodes.position)),
    db.select().from(activities).where(eq(activities.projectId, p.id)).orderBy(asc(activities.position)),
    db.select().from(activityLinks).where(eq(activityLinks.projectId, p.id)).orderBy(asc(activityLinks.position)),
  ]);
  if (!nodes.some((n) => n.level === 0)) return null;
  const assignRows = acts.length
    ? await db.select().from(activityAssignments).innerJoin(activities, eq(activities.id, activityAssignments.activityId)).where(eq(activities.projectId, p.id)).orderBy(asc(activityAssignments.position))
    : [];

  // Calendars: the project calendar and the activity overrides, with the holidays of the years the project spans.
  const projectCalendar = p.calendar ?? DEFAULT_PROJECT_CALENDAR;
  const calCodes = [...new Set([projectCalendar, ...acts.map((a) => a.calendarCode).filter((c): c is NonNullable<typeof c> => !!c)])];
  const [calRows, workCals] = await Promise.all([listCalendars({ projectCode: code, includeInactive: true }, db), loadWorkCalendars(code, db)]);
  const dates = acts.flatMap((a) => [a.startDate, a.finishDate]).filter((x): x is string => !!x).sort();
  const y0 = +(dates[0] ?? projectDataDate(p)).slice(0, 4);
  const y1 = Math.max(y0, +(dates[dates.length - 1] ?? projectDataDate(p)).slice(0, 4));
  const calUid = new Map<string, string>();
  const calendars: ImportedCalendar[] = [];
  for (const c of calCodes) {
    const row = calRows.find((r) => r.code === c) ?? BUILTIN_CALENDARS.find((b) => b.code === c);
    const wc = workCals[c];
    if (!row || !wc) continue;
    const uid = String(calendars.length + 1);
    calUid.set(c, uid);
    const off = new Map<string, string>();
    for (let y = y0; y <= y1; y++) for (const h of wc.holidays(y)) off.set(h.date, h.name);
    const working = 'exceptions' in row ? (row.exceptions as { date: string; working: boolean; name: string }[]).filter((e) => e.working) : [];
    calendars.push({
      uid, name: row.name, workDays: [...row.workDays], hoursPerDay: row.hoursPerDay,
      exceptions: [...[...off].map(([date, name]) => ({ date, working: false, name })), ...working.map((e) => ({ date: e.date, working: true, name: e.name }))].sort((a, b) => (a.date < b.date ? -1 : 1)),
    });
  }
  const hoursPerDay = calendars[0]?.hoursPerDay ?? 8;

  // UIDs: work packages and activities share MS Project's task UID space.
  const pkgs = nodes.filter((n) => n.level === 1);
  const uidOf = uidAllocator([...pkgs.map((n) => n.externalUid), ...acts.map((a) => a.externalUid)]);
  const pkgUid = new Map(pkgs.map((n) => [n.id, uidOf(n.externalUid)]));
  const actUid = new Map(acts.map((a) => [a.id, uidOf(a.externalUid)]));
  const wbs: ImportedWbs[] = pkgs.map((n, position) => ({ uid: pkgUid.get(n.id)!, code: n.code, name: n.name, parentUid: null, position }));

  // Displayed baseline → Baseline 0 (the activity snapshot; without one, the activity's own baseline finish).
  const baselineCode = await getDisplayedBaselineCode(code, db);
  const snapshot = baselineCode ? await getBaselineActivities(code, baselineCode, db) : [];
  const blByCode = new Map(snapshot.map((b) => [b.activityCode, b]));
  const activityRows: ImportedActivity[] = acts.map((a, i) => {
    const cal = a.calendarCode ? workCals[a.calendarCode] : workCals[projectCalendar];
    const bl = blByCode.get(a.code);
    const blFinish = bl?.finishDate ?? (snapshot.length ? null : a.baselineFinishDate);
    const blStart = bl?.startDate ?? (blFinish && cal ? cal.startOf(blFinish, a.durationDays) : null);
    const constraint = a.constraintType && a.constraintType !== 'ASAP' && a.constraintDate ? { type: a.constraintType, date: a.constraintDate } : null;
    return {
      uid: actUid.get(a.id)!, activityId: a.code, name: a.name, wbsUid: pkgUid.get(a.wbsNodeId) ?? null, durationDays: a.durationDays, start: a.startDate, finish: a.finishDate,
      actualStart: a.startActual ? a.startDate : null, actualFinish: a.finishActual ? a.finishDate : null, percentComplete: a.percentComplete, remainingDays: a.remainingDays,
      milestone: a.durationDays === 0, constraint, calendarUid: a.calendarCode && a.calendarCode !== projectCalendar ? (calUid.get(a.calendarCode) ?? null) : null,
      totalFloatDays: a.totalFloatDays, critical: a.critical ?? (a.totalFloatDays != null ? a.totalFloatDays <= 0 : null), costKeur: a.eacKeur, actualCostKeur: a.actualKeur,
      budgetKeur: a.budgetKeur, notes: a.description, codes: [],
      baselines: blFinish || blStart ? [{ number: 0, start: blStart, finish: blFinish, durationDays: bl?.durationDays ?? a.durationDays, costKeur: bl?.budgetKeur ?? a.budgetKeur }] : [],
      line: i + 1,
    };
  });
  const links: ImportedLink[] = linkRows
    .filter((l) => actUid.has(l.predecessorId) && actUid.has(l.successorId))
    .map((l) => ({ predUid: actUid.get(l.predecessorId)!, succUid: actUid.get(l.successorId)!, type: l.type, lagDays: l.lagDays }));

  // Resources: one per resource name.
  const resUid = new Map<string, string>();
  const resources: ImportedResource[] = [];
  const assignments: ImportedAssignment[] = [];
  for (const { activity_assignments: r } of assignRows) {
    if (!resUid.has(r.resource)) {
      resUid.set(r.resource, String(resources.length + 1));
      resources.push({ uid: String(resources.length + 1), name: r.resource, type: r.resourceCount != null || r.personId ? 'work' : 'material' });
    }
    assignments.push({ activityUid: actUid.get(r.activityId)!, resourceUid: resUid.get(r.resource)!, units: r.resourceCount ?? 1, plannedHours: r.plannedHours, actualHours: r.actualHours });
  }

  const starts = acts.map((a) => a.startDate).filter((x): x is string => !!x).sort();
  const schedule: ImportedSchedule = {
    format: 'mspdi', name: p.name, company: p.client, start: p.plannedStart ?? starts[0] ?? null, finish: dates[dates.length - 1] ?? null, statusDate: projectDataDate(p),
    calendarUid: calUid.get(projectCalendar) ?? null, hoursPerDay, calendars, wbs, activities: activityRows, links, resources, assignments, unmapped: [], warnings: [],
  };
  return { schedule, baselineCode, fileName: `${code}-schedule-${now.toISOString().slice(0, 10)}.xml` };
}

/** The MSPDI text of a project's schedule (see buildScheduleExport). */
export async function exportScheduleXml(code: string, now: Date = new Date(), q?: Q): Promise<{ xml: string; fileName: string; baselineCode: string | null; activities: number } | null> {
  const e = await buildScheduleExport(code, now, q);
  if (!e) return null;
  return { xml: writeMspdi(e.schedule, { fileName: e.fileName, now }), fileName: e.fileName, baselineCode: e.baselineCode, activities: e.schedule.activities.length };
}

/** Stamps the "MS Project" connector row (on demand, stays Ready) with the last exchange ("HLT-026 exported · BL1"), as the prototype's row shows. */
export async function stampMsProjectConnector(q: Q, volume: string, at: Date = new Date()): Promise<void> {
  await q.update(connectors).set({ lastSyncAt: at, lastVolume: volume, updatedAt: at }).where(eq(connectors.name, 'MS Project'));
}
