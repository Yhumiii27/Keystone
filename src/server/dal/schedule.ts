import 'server-only';
// Schedule screen DAL (docs/spec/05 §1.6): schedule header + package bars + milestones (planning) and the
// cumulative PV/EV series + BAC (cost) of one project, shaped as the input of `scheduleView()`
// (src/domain/schedule-gantt.ts). One call per page; null for projects without planning data (empty state).
import { asc, eq } from 'drizzle-orm';
import type { ScheduleInput } from '@/domain/schedule-gantt';
import { getDb } from '@/server/db/client';
import { evmPeriods, projects } from '@/server/db/schema';
import { getMilestones, getScheduleBars, getScheduleControl, type ScheduleControl } from './planning';

export interface ScheduleData extends ScheduleInput {
  /** Full schedule header (baselineSet, floatShort, team… for other consumers). */
  control: ScheduleControl;
}

/** Cumulative EVM series (k€) and BAC of a project. EV stops at the data date. */
async function getEvmSeries(code: string): Promise<{ bac: number; pv: number[]; ev: number[] } | null> {
  const db = await getDb();
  const [head] = await db.select({ id: projects.id, bac: projects.budgetKeur }).from(projects).where(eq(projects.code, code));
  if (!head) return null;
  const rows = await db
    .select({ pv: evmPeriods.pvKeur, ev: evmPeriods.evKeur })
    .from(evmPeriods)
    .where(eq(evmPeriods.projectId, head.id))
    .orderBy(asc(evmPeriods.monthIndex));
  return { bac: head.bac, pv: rows.map((r) => r.pv), ev: rows.filter((r) => r.ev != null).map((r) => r.ev!) };
}

/** Everything the Schedule screen shows for `code`; null when the project has no schedule. */
export async function getScheduleData(code: string): Promise<ScheduleData | null> {
  const [control, bars, milestones, evm] = await Promise.all([getScheduleControl(code), getScheduleBars(code), getMilestones(code), getEvmSeries(code)]);
  if (!control || !evm) return null;
  return {
    control,
    header: {
      start: control.start,
      tNow: control.tNow,
      floatDays: control.floatDays,
      finishText: control.finishText,
      baselineText: control.baselineText,
      floatText: control.floatText,
      critText: control.critText,
      milesText: control.milesText,
      milesSub: control.milesSub,
      chartMonths: control.chartMonths,
      ganttMonths: control.ganttMonths,
    },
    bars: bars.map((b) => ({
      name: b.name,
      owner: b.owner,
      baselineStart: b.baselineStart,
      baselineEnd: b.baselineEnd,
      forecastStart: b.forecastStart,
      forecastEnd: b.forecastEnd,
      pct: b.pct,
      critical: b.critical,
    })),
    milestones: milestones.map((m) => ({
      name: m.name,
      baselineMonth: m.baselineMonth,
      forecastMonth: m.forecastMonth,
      status: m.status,
      statusLabel: m.statusLabel,
    })),
    pv: evm.pv,
    ev: evm.ev,
    bac: evm.bac,
  };
}
