import 'server-only';
// R-198 — interactive Gantt of the Schedule screen: the project's network as the browser needs it (src/domain/gantt-edit.ts).
// Read only: the Gantt's edits go through the Plan's writers (src/server/dal/plan.ts: updateActivity, addActivityLink,
// updateActivityLink, removeActivityLink) and "Reschedule" (src/server/dal/schedule.ts).
import { and, asc, eq } from 'drizzle-orm';
import { CRITICAL_FLOAT_DAYS } from '@/domain/schedule-rollup';
import { schedule, type CpmResult } from '@/domain/cpm';
import type { GanttActivity, GanttNetwork, GanttPackage } from '@/domain/gantt-edit';
import { isConsolidated, supplierNodeId } from '@/domain/supplier-schedule';
import type { SystemMessage } from '@/domain/system-messages';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject } from '@/server/db/helpers';
import { projects, wbsNodes } from '@/server/db/schema';
import { getActivityCodes } from './activity-codes';
import { getBaselineActivities, getDisplayedBaselineCode } from './baselines';
import { listCalendars, settingsHolidayDates } from './calendars';
import { tokenOf } from './record-version';
import { loadScheduleNetwork } from './schedule-network';

/** The project's Gantt network; null for an unknown project or a project without activities. */
export async function getGanttNetwork(code: string): Promise<GanttNetwork | null> {
  const readAt = new Date();
  // R-204: with the supplier schedules tied to the project (a « Suppliers » band, read-only here).
  const net = await loadScheduleNetwork(code, undefined, { suppliers: true });
  if (!net || !net.activities.length) return null;
  const db = await getDb();
  const [nodes, cals, holidays, blCode, codes] = await Promise.all([
    db
      .select({ code: wbsNodes.code, name: wbsNodes.name })
      .from(wbsNodes)
      .innerJoin(projects, eq(projects.id, wbsNodes.projectId))
      .where(and(eq(projects.code, code), eq(wbsNodes.level, 1)))
      .orderBy(asc(wbsNodes.position)),
    listCalendars({ projectCode: code, includeInactive: true }),
    settingsHolidayDates(),
    getDisplayedBaselineCode(code),
    getActivityCodes(code),
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
      codes: codes?.map[a.code] ?? {},
    };
  });
  // R-204: the supplier activities, dated by the consolidated network (as the last Reschedule would date them now); their
  // "baseline" bars are the supplier's committed dates.
  const tied = net.suppliers.filter((x) => isConsolidated(x.input));
  const supplierPackages: GanttPackage[] = [];
  if (tied.length) {
    let r: CpmResult | null = null;
    try {
      r = schedule(net.input);
    } catch {
      r = null; // a loop or invalid input: the Plan's Reschedule says it; the band is left out
    }
    if (r)
      for (const sch of tied) {
        supplierPackages.push({ code: sch.poNumber, name: sch.supplierName, supplier: true });
        for (const a of sch.activities) {
          const id = supplierNodeId(sch.poNumber, a.code);
          const x = r.activities[id];
          if (!x) continue;
          const complete = !!a.actualStart && !!a.actualFinish;
          activities.push({
            id, name: a.name, wbs: sch.poNumber, duration: a.durationDays, calendar: null, pct: complete ? 100 : a.percentComplete, remaining: null,
            startDate: x.start, finishDate: x.finish, startActual: !!a.actualStart, finishActual: complete,
            constraint: !a.actualStart && a.committedStart ? { type: 'SNET', date: a.committedStart } : null,
            critical: !complete && x.critical, totalFloat: complete ? null : x.totalFloat, baselineStart: a.committedStart ?? a.committedFinish,
            baselineFinish: a.committedFinish ?? a.committedStart, source: sch.poNumber, codes: { purchase_package: [sch.poNumber] },
          });
        }
      }
  }
  return {
    dataDate: net.dataDate, projectStart: net.input.projectStart ?? null, projectCalendar: net.projectCalendar,
    calendars: cals.map((c) => ({
      def: { code: c.code, name: c.name, workDays: c.workDays, hoursPerDay: c.hoursPerDay, holidaySet: c.holidaySet, useSettingsHolidays: c.useSettingsHolidays },
      settingsHolidays: holidays, exceptions: c.exceptions,
    })),
    packages: [...nodes, ...supplierPackages],
    activities,
    links: supplierPackages.length ? net.input.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })) : net.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })),
    codeTypes: codes?.types ?? [],
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
