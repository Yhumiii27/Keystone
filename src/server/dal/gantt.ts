import 'server-only';
// R-198 — interactive Gantt of the Schedule screen: the project's network as the browser needs it (src/domain/gantt-edit.ts).
// Read only: the Gantt's edits go through the Plan's writers (src/server/dal/plan.ts: updateActivity, addActivityLink,
// updateActivityLink, removeActivityLink) and "Reschedule" (src/server/dal/schedule.ts).
import { and, asc, eq } from 'drizzle-orm';
import { CRITICAL_FLOAT_DAYS } from '@/domain/schedule-rollup';
import type { GanttActivity, GanttNetwork } from '@/domain/gantt-edit';
import type { SystemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject } from '@/server/db/helpers';
import { projects, wbsNodes } from '@/server/db/schema';
import { getBaselineActivities, getDisplayedBaselineCode } from './baselines';
import { listCalendars, settingsHolidayDates } from './calendars';
import { tokenOf } from './record-version';
import { loadScheduleNetwork } from './schedule-network';

/** The project's Gantt network; null for an unknown project or a project without activities. */
export async function getGanttNetwork(code: string): Promise<GanttNetwork | null> {
  const readAt = new Date();
  const net = await loadScheduleNetwork(code);
  if (!net || !net.activities.length) return null;
  const db = await getDb();
  const [nodes, cals, holidays, blCode] = await Promise.all([
    db
      .select({ code: wbsNodes.code, name: wbsNodes.name })
      .from(wbsNodes)
      .innerJoin(projects, eq(projects.id, wbsNodes.projectId))
      .where(and(eq(projects.code, code), eq(wbsNodes.level, 1)))
      .orderBy(asc(wbsNodes.position)),
    listCalendars({ projectCode: code, includeInactive: true }),
    settingsHolidayDates(),
    getDisplayedBaselineCode(code),
  ]);
  const snapshot = blCode ? await getBaselineActivities(code, blCode) : [];
  const bl = new Map(snapshot.map((r) => [r.activityCode, r]));
  const activities = net.activities.map((a): GanttActivity => {
    const complete = a.finishActual || a.percentComplete >= 100;
    const b = bl.get(a.code);
    return {
      id: a.code, name: a.name, wbs: a.wbsCode, duration: a.durationDays, calendar: a.calendarCode, pct: a.percentComplete, remaining: a.remainingDays,
      startDate: a.startDate, finishDate: a.finishDate, startActual: a.startActual, finishActual: a.finishActual,
      constraint: a.constraintType && a.constraintType !== 'ASAP' ? { type: a.constraintType, date: a.constraintDate } : null,
      // Same rule as the Schedule roll-ups: the CPM flag, else the stored float; never when complete.
      critical: !complete && (a.critical ?? (a.totalFloatDays != null && a.totalFloatDays <= CRITICAL_FLOAT_DAYS)),
      totalFloat: complete ? null : a.totalFloatDays, baselineStart: b?.startDate ?? null, baselineFinish: b?.finishDate ?? null,
      version: tokenOf(a.version, readAt),
    };
  });
  return {
    dataDate: net.dataDate, projectStart: net.input.projectStart ?? null, projectCalendar: net.projectCalendar,
    calendars: cals.map((c) => ({
      def: { code: c.code, name: c.name, workDays: c.workDays, hoursPerDay: c.hoursPerDay, holidaySet: c.holidaySet, useSettingsHolidays: c.useSettingsHolidays },
      settingsHolidays: holidays, exceptions: c.exceptions,
    })),
    packages: nodes,
    activities,
    links: net.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })),
    options: net.input.options,
  };
}

/** Activity-feed event of a relationship edited on the Gantt (the relationship writers audit; the feed says it in words). */
export async function recordGanttActivity(code: string, actorName: string, message: SystemMessage): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const actor = await findPerson(tx, actorName);
    await recordActivity(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, message, kind: 'change', projectId: p.id });
  });
}
