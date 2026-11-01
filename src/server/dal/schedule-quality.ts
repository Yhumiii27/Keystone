import 'server-only';
// R-206 (K-206, K-206b) — "Schedule quality" card of the Schedule screen: the DCMA 14-point checks (src/domain/schedule-quality.ts)
// and the forensic delay analysis (src/domain/schedule-forensics.ts) of one project. Reads only: nothing here writes to the
// schedule. The checks read the schedule as the last "Reschedule" published it (stored dates, floats, constraints), the
// displayed baseline's snapshot, the resource assignments and budgets, and the Settings thresholds; the CPM engine runs in
// memory (as "Reschedule" would, progress → actual dates first) for the critical path test, the driving path to the finish
// and the "not rescheduled since" count.
import { inArray, sql } from 'drizzle-orm';
import { CpmCycleError, CpmInputError, changedActivities, schedule, type CpmResult } from '@/domain/cpm';
import { CRITICAL_FLOAT_DAYS, actualsFromProgress } from '@/domain/schedule-rollup';
import { compareSchedules, slipAttribution, type DatedActivity, type ScheduleComparison, type SlipAttribution } from '@/domain/schedule-forensics';
import { dcmaAssessment, type DcmaReport, type DcmaThresholds, type QualityActivity } from '@/domain/schedule-quality';
import { criticalPathTest, drivingPathToFinish } from '@/domain/schedule-quality-cpm';
import { getDb } from '@/server/db/client';
import { activities, activityAssignments } from '@/server/db/schema';
import { getBaselineActivities, listProjectBaselines } from './baselines';
import { dcmaThresholds } from './dcma-thresholds';
import { loadScheduleNetwork, toCpmActivity } from './schedule-network';

/** "Current schedule" as the later side of the forensic comparison. */
export const CURRENT_SCHEDULE = 'current';

export interface QualityBaselineOption {
  code: string;
  name: string;
  /** Snapshot size (a baseline without activities cannot be compared). */
  activityCount: number;
  displayed: boolean;
}

export interface ScheduleQualityData {
  dataDate: string;
  thresholds: DcmaThresholds;
  report: DcmaReport;
  /** The reference baseline of the checks (the displayed one); null = none. */
  reference: QualityBaselineOption | null;
  /** Activities whose dates, float or critical flag "Reschedule" would change now (0 = up to date); null = the CPM cannot run. */
  outdated: number | null;
  /** The CPM cannot run: the logic loop, or true for an invalid network. */
  cycle: string[] | null;
  invalid: boolean;
  /** Activity names and work packages by code (offender lists). */
  names: Record<string, { name: string; wbs: string }>;
  forensic: {
    /** Baselines with an activity snapshot, in register order. */
    baselines: QualityBaselineOption[];
    /** Reference (earlier) baseline code; null when no baseline can be compared. */
    from: string | null;
    /** Later side: a baseline code or CURRENT_SCHEDULE. */
    to: string;
    comparison: ScheduleComparison | null;
    /** Along the current driving path to the project finish (computed with the current logic, also between two baselines). */
    attribution: SlipAttribution | null;
  };
}

/** The project's schedule quality; null for an unknown project or one without activities. `from` / `to` pick the forensic pair. */
export async function getScheduleQuality(code: string, pick: { from?: string | null; to?: string | null } = {}): Promise<ScheduleQualityData | null> {
  const net = await loadScheduleNetwork(code);
  if (!net || !net.activities.length) return null;
  const db = await getDb();
  const ids = net.activities.map((a) => a.dbId);
  const [baselineRows, thresholds, budgets, assigned] = await Promise.all([
    listProjectBaselines(code),
    dcmaThresholds(),
    db.select({ id: activities.id, budget: activities.budgetKeur }).from(activities).where(inArray(activities.id, ids)),
    db
      .select({ id: activityAssignments.activityId, n: sql<number>`count(*)::int` })
      .from(activityAssignments)
      .where(inArray(activityAssignments.activityId, ids))
      .groupBy(activityAssignments.activityId),
  ]);
  const options: QualityBaselineOption[] = baselineRows.map((b) => ({ code: b.code, name: b.name, activityCount: b.activityCount, displayed: b.displayed }));
  const reference = options.find((b) => b.displayed) ?? null;
  const comparable = options.filter((b) => b.activityCount > 0);
  const from = pick.from && comparable.some((b) => b.code === pick.from) ? pick.from : reference && reference.activityCount > 0 ? reference.code : comparable[0]?.code ?? null;
  const to = pick.to && pick.to !== from && comparable.some((b) => b.code === pick.to) ? pick.to : CURRENT_SCHEDULE;

  const snapshotCodes = [...new Set([reference?.code, from, to === CURRENT_SCHEDULE ? null : to].filter((c): c is string => !!c))];
  const snapshots = new Map(await Promise.all(snapshotCodes.map(async (c) => [c, await getBaselineActivities(code, c)] as const)));
  const refSnapshot = reference ? (snapshots.get(reference.code) ?? []) : [];
  const refFinishOf = new Map(refSnapshot.map((r) => [r.activityCode, r.finishDate]));
  const baselineFinish = refSnapshot.reduce<string | null>((m, r) => (r.finishDate && (!m || r.finishDate > m) ? r.finishDate : m), null)
    ?? (reference ? baselineRows.find((b) => b.code === reference.code)?.finishDate ?? null : null);

  const budgetOf = new Map(budgets.map((b) => [b.id, Number(b.budget) || 0]));
  const assignedIds = new Set(assigned.filter((a) => a.n > 0).map((a) => a.id));
  const projectCal = net.calendars[net.projectCalendar];

  // The CPM as "Reschedule" would run it now (in memory).
  const progressed = net.activities.map((a) => {
    const p = actualsFromProgress({ pct: a.percentComplete, startActual: a.startActual, finishActual: a.finishActual, startDate: a.startDate, finishDate: a.finishDate }, net.dataDate);
    return { ...a, startActual: p.startActual, finishActual: p.finishActual, startDate: p.startDate, finishDate: p.finishDate };
  });
  const cpmInput = { ...net.input, activities: progressed.map(toCpmActivity) };
  let fresh: CpmResult | null = null;
  let cycle: string[] | null = null;
  let invalid = false;
  try {
    fresh = schedule(cpmInput);
  } catch (e) {
    if (e instanceof CpmCycleError) cycle = e.cycle;
    else if (e instanceof CpmInputError) invalid = true;
    else throw e;
  }
  const cpt = fresh ? criticalPathTest(cpmInput) : cycle ? { kind: 'cycle' as const, cycle } : { kind: 'invalid' as const };
  const outdated = fresh
    ? changedActivities(
        Object.fromEntries(net.activities.map((a) => [a.code, {
          start: a.startDate ?? '', finish: a.finishDate ?? '', totalFloat: a.totalFloatDays,
          critical: a.percentComplete < 100 && !a.finishActual && (a.critical ?? (a.totalFloatDays != null && a.totalFloatDays <= CRITICAL_FLOAT_DAYS)),
        }])),
        { ...fresh, activities: Object.fromEntries(Object.entries(fresh.activities).map(([k, r]) => [k, { ...r, critical: r.state === 'complete' ? false : r.critical }])) },
      ).length
    : null;

  const qualityActivities: QualityActivity[] = net.activities.map((a) => ({
    id: a.code, duration: a.durationDays, pct: a.percentComplete, startActual: a.startActual, finishActual: a.finishActual, startDate: a.startDate, finishDate: a.finishDate,
    constraintType: a.constraintType, totalFloat: a.totalFloatDays, resourced: assignedIds.has(a.dbId) || (budgetOf.get(a.dbId) ?? 0) > 0,
    baselineFinish: refFinishOf.get(a.code) ?? null,
  }));
  const report = dcmaAssessment({
    dataDate: net.dataDate, activities: qualityActivities, links: net.links.map((l) => ({ pred: l.pred, succ: l.succ, type: l.type, lag: l.lag })), thresholds,
    baseline: reference ? { code: reference.code, finish: baselineFinish, hasActivities: refSnapshot.length > 0 } : null, calendar: projectCal, cpt,
  });

  // Forensic pair.
  let comparison: ScheduleComparison | null = null;
  let attribution: SlipAttribution | null = null;
  if (from) {
    const snap = (c: string): DatedActivity[] => (snapshots.get(c) ?? []).map((r) => ({ id: r.activityCode, start: r.startDate, finish: r.finishDate }));
    const later: DatedActivity[] = to === CURRENT_SCHEDULE ? net.activities.map((a) => ({ id: a.code, start: a.startDate, finish: a.finishDate })) : snap(to);
    comparison = compareSchedules(snap(from), later, projectCal);
    if (fresh) attribution = slipAttribution(drivingPathToFinish(fresh), comparison);
  }

  const names: ScheduleQualityData['names'] = Object.fromEntries(net.activities.map((a) => [a.code, { name: a.name, wbs: a.wbsCode }]));
  for (const rows of snapshots.values()) for (const r of rows) names[r.activityCode] ??= { name: r.name, wbs: r.wbsCode ?? '' };
  return {
    dataDate: net.dataDate, thresholds, report, reference, outdated, cycle, invalid, names,
    forensic: { baselines: comparable, from, to, comparison, attribution },
  };
}
