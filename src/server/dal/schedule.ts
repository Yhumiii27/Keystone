import 'server-only';
// Schedule screen DAL (docs/spec/05 §1.6) and the chapter-4 scheduling writers (S-1, S-3, S-8, A-7).
//
// Reads: schedule header + package bars + milestones (planning) and the cumulative PV/EV series + BAC (cost) of one
// project, shaped as the input of `scheduleView()` (src/domain/schedule-gantt.ts). One call per page; null for projects
// without planning data (empty state). Until a project's first Reschedule (or Baseline chip change) the bars and milestones
// are the seeded prototype rows; from then on they are roll-ups of the WBS (A-7) — `getScheduleRollup`.
//
// Writes:
// - `rescheduleProject` ("Reschedule", like F9 in P6 — S-1 manual recalculation): runs the CPM engine (src/domain/cpm.ts)
//   at the project data date and persists dates (ISO + prototype display texts), floats, critical flags, constraint
//   violations, driving links, then the roll-ups below. A second run changes nothing.
// - `showProjectBaseline` (Baseline chip, S-3): stores the displayed baseline and refreshes the roll-ups.
// - `refreshRollups` (shared): BL finish + variance of every activity against the displayed baseline (working days, S-8),
//   WBS node dates and the root row, the Schedule bars and milestones (A-7) and the project control header (finish, float,
//   critical packages, milestones) that Home, the registers and the portfolio screens read.
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { WorkCalendar } from '@/domain/calendar';
import { CpmCycleError, CpmInputError, schedule, type CpmResult } from '@/domain/cpm';
import { DEFAULT_PROJECT_CALENDAR, RECALCULATION_MODE, projectDataDate } from '@/domain/ch4-defaults';
import type { MilestoneInput, PackageBarInput, ScheduleInput } from '@/domain/schedule-gantt';
import {
  CRITICAL_FLOAT_DAYS, actualsFromProgress, activityDateText, barOf, critPackagesText, finishVariance, floatDaysText, floatShortText, longDateText,
  milestoneWbs, milestonesDoneText, milestonesOnTimeText, monthIndex, projectFloat, rollUpMilestone, rollUpPackage, type BaselineDates,
  type PackageRollup, type RollupActivity,
} from '@/domain/schedule-rollup';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { milestoneStatus } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { activities, activityLinks, baselines, evmPeriods, milestones, persons, projectControls, projects, scheduleBars, wbsNodes } from '@/server/db/schema';
import { getBaselineActivities, getDisplayedBaselineCode } from './baselines';
import { loadWorkCalendars } from './calendars';
import { getMilestones, getScheduleBars, getScheduleControl, type ScheduleControl } from './planning';
import { applyApprovedChangeDurations } from './change-activities';
import { loadScheduleNetwork, recordScheduleRun, toCpmActivity } from './schedule-network';

type Q = DB | Tx;

export interface ScheduleData extends ScheduleInput {
  /** Full schedule header (baselineSet, floatShort, team… for other consumers). */
  control: ScheduleControl;
  /** Bars and milestones are WBS roll-ups (A-7) — false while the project shows its seeded schedule. */
  rolledUp: boolean;
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
  const [control, bars, milestoneRows, evm, rollup] = await Promise.all([
    getScheduleControl(code), getScheduleBars(code), getMilestones(code), getEvmSeries(code), getScheduleRollup(code),
  ]);
  if (!control || !evm) return null;
  return {
    control,
    rolledUp: !!rollup,
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
    bars: rollup
      ? rollup.bars
      : bars.map((b) => ({
          name: b.name,
          owner: b.owner,
          baselineStart: b.baselineStart,
          baselineEnd: b.baselineEnd,
          forecastStart: b.forecastStart,
          forecastEnd: b.forecastEnd,
          pct: b.pct,
          critical: b.critical,
        })),
    milestones: rollup
      ? rollup.milestones
      : milestoneRows.map((m) => ({
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

// ── Roll-ups (A-7) ───────────────────────────────────────────────────────────────────────────────────────────────

interface RollupState {
  projectId: string;
  code: string;
  dataDate: string;
  startMonth: number;
  hasControls: boolean;
  calendar: WorkCalendar;
  calendarOf: (activityCalendar: string | null) => WorkCalendar;
  baseline: { code: string; setOn: string | null; finishDate: string } | null;
  baselineOf: (activityCode: string) => BaselineDates | undefined;
  nodes: (typeof wbsNodes.$inferSelect)[];
  acts: (typeof activities.$inferSelect)[];
  bars: { wbsNodeId: string | null; ownerPersonId: string | null }[];
  miles: (typeof milestones.$inferSelect)[];
  packages: { node: typeof wbsNodes.$inferSelect; rollup: PackageRollup }[];
}

const isComplete = (a: Pick<typeof activities.$inferSelect, 'finishActual' | 'percentComplete'>) => a.finishActual || a.percentComplete >= 100;
/** Critical for the roll-ups: the CPM flag once scheduled, else the stored float (S-1: total float ≤ 0), never when complete. */
const isCritical = (a: typeof activities.$inferSelect) =>
  !isComplete(a) && (a.scheduledAt ? !!a.critical : a.critical ?? (a.totalFloatDays != null && a.totalFloatDays <= CRITICAL_FLOAT_DAYS));

const rollupActivity = (a: typeof activities.$inferSelect, wbs: string): RollupActivity => ({
  code: a.code, wbs, start: a.startDate, finish: a.finishDate, budget: a.budgetKeur, pct: a.percentComplete, critical: isCritical(a), complete: isComplete(a),
});

async function loadRollupState(q: Q, code: string): Promise<RollupState | null> {
  const [p] = await q
    .select({ id: projects.id, dataDate: projects.dataDate, calendar: projects.calendar, startMonth: projects.startMonth, plannedStart: projects.plannedStartDate })
    .from(projects)
    .where(eq(projects.code, code));
  if (!p) return null;
  const [nodes, acts, bars, miles, [controls], calendars, blCode] = await Promise.all([
    q.select().from(wbsNodes).where(eq(wbsNodes.projectId, p.id)).orderBy(asc(wbsNodes.position)),
    q.select().from(activities).where(eq(activities.projectId, p.id)).orderBy(asc(activities.position)),
    q.select({ wbsNodeId: scheduleBars.wbsNodeId, ownerPersonId: scheduleBars.ownerPersonId }).from(scheduleBars).where(eq(scheduleBars.projectId, p.id)),
    q.select().from(milestones).where(eq(milestones.projectId, p.id)).orderBy(asc(milestones.position)),
    q.select({ startMonth: projectControls.startMonth }).from(projectControls).where(eq(projectControls.projectId, p.id)),
    loadWorkCalendars(code, q),
    getDisplayedBaselineCode(code, q),
  ]);
  const projectCal = calendars[p.calendar ?? DEFAULT_PROJECT_CALENDAR] ?? calendars[DEFAULT_PROJECT_CALENDAR] ?? Object.values(calendars)[0];
  if (!projectCal) throw new Error('No work calendar');
  const [blRow] = blCode
    ? await q.select({ code: baselines.code, setOn: baselines.setOn, finishDate: baselines.finishDate }).from(baselines).where(and(eq(baselines.projectId, p.id), eq(baselines.code, blCode)))
    : [];
  const snapshot = blCode ? await getBaselineActivities(code, blCode, q) : [];
  const blMap = new Map(snapshot.map((r) => [r.activityCode, { start: r.startDate, finish: r.finishDate }]));
  const firstStart = acts.map((a) => a.startDate).filter((d): d is string => !!d).sort()[0];
  const startMonth = controls?.startMonth ?? Math.floor(p.startMonth ?? (p.plannedStart ? monthIndex(p.plannedStart) : firstStart ? monthIndex(firstStart) : 0));
  const packages = nodes
    .filter((n) => n.level === 1)
    .map((node) => ({
      node,
      rollup: rollUpPackage(node.code, acts.filter((a) => a.wbsNodeId === node.id).map((a) => rollupActivity(a, node.code)), (c) => blMap.get(c)),
    }));
  return {
    projectId: p.id, code, dataDate: projectDataDate(p), startMonth, hasControls: !!controls, calendar: projectCal,
    calendarOf: (c) => (c && calendars[c]) || projectCal, baseline: blRow ?? null, baselineOf: (c) => blMap.get(c), nodes, acts, bars, miles, packages,
  };
}

/** Anchor activity of a milestone: its stored link, else the last activity of the work package it marks. */
function anchorOf(s: RollupState, m: typeof milestones.$inferSelect) {
  if (m.activityId) {
    const a = s.acts.find((x) => x.id === m.activityId);
    if (a) return a;
  }
  const w = milestoneWbs(m.name, s.packages.map((p) => ({ code: p.node.code, name: p.node.name })));
  const last = w ? s.packages.find((p) => p.node.code === w)?.rollup.lastActivity : null;
  return last ? s.acts.find((a) => a.code === last) ?? null : null;
}

function rolledMilestones(s: RollupState) {
  return s.miles.map((m) => {
    const a = anchorOf(s, m);
    if (!a?.finishDate) return { m, anchor: null, rolled: null, baselineFinish: null };
    const baselineFinish = s.baselineOf(a.code)?.finish ?? null;
    const rolled = rollUpMilestone({ finish: a.finishDate, complete: isComplete(a), baselineFinish }, s.startMonth, s.dataDate, s.calendar);
    return { m, anchor: a, rolled, baselineFinish };
  });
}

/** Read-time roll-ups of the Schedule screen; null while the project shows its seeded schedule (no roll-up written yet). */
export async function getScheduleRollup(code: string, q?: Q): Promise<{ bars: PackageBarInput[]; milestones: MilestoneInput[] } | null> {
  const db = q ?? (await getDb());
  // Cheap check first: roll-ups exist once a Reschedule or the Baseline chip dated the work packages.
  const [rolled] = await db
    .select({ id: wbsNodes.id })
    .from(wbsNodes)
    .innerJoin(projects, eq(projects.id, wbsNodes.projectId))
    .where(and(eq(projects.code, code), eq(wbsNodes.level, 1), isNotNull(wbsNodes.finishDate)))
    .limit(1);
  if (!rolled) return null;
  const s = await loadRollupState(db, code);
  if (!s) return null;
  const owners = new Map(s.packages.map(({ node }) => [node.id, barOwner(s, node)]));
  const ownerIds = [...new Set([...owners.values()].filter((x): x is string => !!x))];
  const people = ownerIds.length ? await db.select({ id: persons.id, short: persons.shortName }).from(persons).where(inArray(persons.id, ownerIds)) : [];
  const shortOf = new Map(people.map((p) => [p.id, p.short]));
  const bars: PackageBarInput[] = [];
  for (const { node, rollup } of s.packages) {
    const bar = barOf(rollup, s.startMonth, s.calendar);
    if (!bar) continue;
    const owner = owners.get(node.id);
    bars.push({ name: node.name, owner: (owner && shortOf.get(owner)) || '—', ...bar, slipDays: bar.slipDays ?? undefined });
  }
  const miles: MilestoneInput[] = rolledMilestones(s).map(({ m, anchor, rolled, baselineFinish }) =>
    rolled && anchor
      ? {
          name: m.name, baselineMonth: rolled.baselineMonth ?? m.baselineMonth, forecastMonth: rolled.forecastMonth, status: rolled.status,
          statusLabel: milestoneStatus.label(rolled.status), forecastDate: anchor.finishDate, baselineDate: baselineFinish, slipDays: rolled.slipDays ?? undefined,
        }
      : { name: m.name, baselineMonth: m.baselineMonth, forecastMonth: m.forecastMonth, status: m.status, statusLabel: milestoneStatus.label(m.status) },
  );
  return { bars, milestones: miles };
}

/** Owner of a work package's bar: the seeded bar's owner, else the package owner, else its most frequent activity owner. */
function barOwner(s: RollupState, node: typeof wbsNodes.$inferSelect): string | null {
  const seeded = s.bars.find((b) => b.wbsNodeId === node.id)?.ownerPersonId;
  if (seeded) return seeded;
  if (node.ownerPersonId) return node.ownerPersonId;
  const count = new Map<string, number>();
  for (const a of s.acts) if (a.wbsNodeId === node.id && a.ownerPersonId) count.set(a.ownerPersonId, (count.get(a.ownerPersonId) ?? 0) + 1);
  return [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
}

/**
 * Rewrites everything derived from the activities and the displayed baseline (see the file header). Call inside the writing
 * transaction, after the activities are up to date. Never touches `updated_at` of activities (the Plan's "edited" mark).
 */
export async function refreshRollups(tx: Q, code: string): Promise<void> {
  const s = await loadRollupState(tx, code);
  if (!s) throw new Error(`Unknown project ${code}`);

  // Activities: BL finish and finish variance against the displayed baseline (working days of the activity calendar).
  for (const a of s.acts) {
    const bl = s.baselineOf(a.code)?.finish ?? null;
    const next = {
      baselineFinishDate: bl,
      baselineFinishText: bl ? activityDateText(bl) : '—',
      varianceDays: bl && a.finishDate ? finishVariance(s.calendarOf(a.calendarCode), bl, a.finishDate) : 0,
    };
    if (next.baselineFinishDate !== a.baselineFinishDate || next.baselineFinishText !== a.baselineFinishText || next.varianceDays !== a.varianceDays) {
      await tx.update(activities).set(next).where(eq(activities.id, a.id));
      Object.assign(a, next);
    }
  }

  // WBS: package dates; root texts, float and baseline finish.
  const open = s.acts.filter((a) => !isComplete(a));
  const pFloat = projectFloat(open.map((a) => a.totalFloatDays ?? 0));
  const starts = s.acts.map((a) => a.startDate).filter((d): d is string => !!d).sort();
  const finishes = s.acts.map((a) => a.finishDate).filter((d): d is string => !!d).sort();
  const projectStart = starts[0] ?? null;
  const projectFinish = finishes.at(-1) ?? null;
  for (const { node, rollup } of s.packages)
    await tx.update(wbsNodes).set({ startDate: rollup.start, finishDate: rollup.finish }).where(eq(wbsNodes.id, node.id));
  const root = s.nodes.find((n) => n.level === 0);
  if (root)
    await tx
      .update(wbsNodes)
      .set({
        startDate: projectStart, finishDate: projectFinish, startText: projectStart ? activityDateText(projectStart) : root.startText,
        finishText: projectFinish ? activityDateText(projectFinish) : root.finishText, baselineFinishText: s.baseline ? activityDateText(s.baseline.finishDate) : '—',
        totalFloatDays: s.acts.length ? pFloat : root.totalFloatDays,
      })
      .where(eq(wbsNodes.id, root.id));

  // Schedule bars: one per work package with activities, in WBS order (A-7).
  const barRows = s.packages.flatMap(({ node, rollup }) => {
    const bar = barOf(rollup, s.startMonth, s.calendar);
    return bar ? [{ node, bar }] : [];
  });
  await tx.delete(scheduleBars).where(eq(scheduleBars.projectId, s.projectId));
  if (barRows.length)
    await tx.insert(scheduleBars).values(
      barRows.map(({ node, bar }, position) => ({
        projectId: s.projectId, wbsNodeId: node.id, position, name: node.name, ownerPersonId: barOwner(s, node), baselineStart: bar.baselineStart,
        baselineEnd: bar.baselineEnd, forecastStart: bar.forecastStart, forecastEnd: bar.forecastEnd, percentComplete: bar.pct, critical: bar.critical,
      })),
    );

  // Milestones: anchored on their activity, dated and given a status.
  const rolled = rolledMilestones(s);
  for (const { m, anchor, rolled: r } of rolled) {
    if (!anchor || !r) continue;
    await tx
      .update(milestones)
      .set({ activityId: anchor.id, forecastMonth: r.forecastMonth, baselineMonth: r.baselineMonth ?? m.baselineMonth, status: r.status })
      .where(eq(milestones.id, m.id));
  }

  // Project control header (Schedule KPIs, Home, registers, portfolio).
  if (!s.acts.length) return;
  const header = {
    tNow: Math.round((monthIndex(s.dataDate) - s.startMonth) * 10_000) / 10_000,
    floatDays: pFloat,
    finishText: projectFinish ? longDateText(projectFinish) : '—',
    floatText: floatDaysText(pFloat),
    floatShort: floatShortText(pFloat),
    critText: critPackagesText(s.packages.filter((p) => p.rollup.critical).length, s.packages.length),
    milesText: milestonesDoneText(rolled.filter((x) => (x.rolled ? x.rolled.status : x.m.status) === 'done').length, rolled.length),
    milesSub: milestonesOnTimeText(rolled.filter((x) => x.rolled?.onTime).length),
    baselineText: s.baseline ? longDateText(s.baseline.finishDate) : '—',
    baselineSet: s.baseline?.setOn ? longDateText(s.baseline.setOn) : '—',
    updatedAt: new Date(),
  };
  if (s.hasControls) await tx.update(projectControls).set(header).where(eq(projectControls.projectId, s.projectId));
  else
    // A project planned in Keystone (template, import) gets its control header at its first roll-up; cost figures stay 0.
    await tx.insert(projectControls).values({
      projectId: s.projectId, startMonth: s.startMonth, ...header, reconOrigKeur: 0, reconChangesKeur: 0, reconCrCount: 0, reconPendingKeur: 0, reconPendingSub: '',
      contingencyKeur: 0, contingencyUsedKeur: 0, note: '',
    });
}

// ── Reschedule (S-1) ────────────────────────────────────────────────────────────────────────────────────────────────

export type RescheduleResult =
  | {
      ok: true;
      dataDate: string;
      finishDate: string;
      previousFinishDate: string | null;
      /** Codes of the activities whose dates, float, critical flag or violation changed. */
      changed: string[];
      critical: number;
      violations: number;
      projectFloat: number;
      /** Delivery 7 (NEW-D2-2, R-062): new durations of approved change requests applied before this run. */
      appliedChanges?: { cr: string; code: string; from: number; to: number }[];
    }
  | { ok: false; reason: 'empty' | 'cycle' | 'invalid'; dataDate: string; cycle?: string[]; issues?: string[] };

/**
 * "Reschedule": CPM at the project data date (S-1, manual like F9 in P6). Progress implies actual dates (`actualsFromProgress`),
 * then the engine dates the remaining work with retained logic. Persists the results and the roll-ups, records the run,
 * audit and activity. Circular logic or invalid input is recorded as a failed run and nothing else changes.
 */
export async function rescheduleProject(code: string, actorName: string): Promise<RescheduleResult> {
  const db = await getDb();
  // NEW-D2-2 (R-062): the approved change requests' new activity durations enter the plan at the next Reschedule.
  const appliedChanges = await applyApprovedChangeDurations(code, actorName);
  const net = await loadScheduleNetwork(code);
  if (!net) throw new Error(`Unknown project ${code}`);
  const dataDate = net.dataDate;
  if (!net.activities.length) return { ok: false, reason: 'empty', dataDate };
  const progressed = net.activities.map((a) => {
    const p = actualsFromProgress(
      { pct: a.percentComplete, startActual: a.startActual, finishActual: a.finishActual, startDate: a.startDate, finishDate: a.finishDate },
      dataDate,
    );
    return { ...a, startActual: p.startActual, finishActual: p.finishActual, startDate: p.startDate, finishDate: p.finishDate };
  });
  let result: CpmResult;
  try {
    result = schedule({ ...net.input, activities: progressed.map(toCpmActivity) });
  } catch (e) {
    if (e instanceof CpmCycleError) {
      await recordScheduleRun(code, { outcome: 'cycle', dataDate, message: e.message, details: { cycle: e.cycle } }, actorName);
      return { ok: false, reason: 'cycle', dataDate, cycle: e.cycle };
    }
    if (e instanceof CpmInputError) {
      await recordScheduleRun(code, { outcome: 'error', dataDate, message: e.message, details: { issues: e.issues } }, actorName);
      return { ok: false, reason: 'invalid', dataDate, issues: e.issues };
    }
    throw e;
  }

  const previousFinishDate = net.activities.map((a) => a.finishDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const driving = new Set(result.drivingLinks);
  const changed: string[] = [];
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const a of progressed) {
      const r = result.activities[a.code];
      const stored = net.activities.find((x) => x.dbId === a.dbId)!;
      const complete = r.state === 'complete';
      const critical = complete ? false : r.critical;
      const violated = !!r.violation;
      const before = { start: stored.startDate, finish: stored.finishDate, tf: stored.totalFloatDays, violated: stored.constraintViolated };
      const storedCritical = stored.percentComplete < 100 && (stored.critical ?? (stored.totalFloatDays != null && stored.totalFloatDays <= CRITICAL_FLOAT_DAYS));
      if (before.start !== r.start || before.finish !== r.finish || before.tf !== r.totalFloat || before.violated !== violated || storedCritical !== critical)
        changed.push(a.code);
      await tx
        .update(activities)
        .set({
          startDate: r.start, finishDate: r.finish, startText: activityDateText(r.start), finishText: activityDateText(r.finish), startActual: a.startActual,
          finishActual: a.finishActual, earlyStartDate: r.earlyStart, earlyFinishDate: r.earlyFinish, lateStartDate: r.lateStart, lateFinishDate: r.lateFinish,
          totalFloatDays: r.totalFloat, freeFloatDays: r.freeFloat, critical, constraintViolated: violated, scheduledAt: now,
        })
        .where(eq(activities.id, a.dbId));
    }
    for (const l of net.links) {
      const isDriving = driving.has(`${l.pred}>${l.succ}`);
      if (isDriving !== l.isDriving) await tx.update(activityLinks).set({ isDriving }).where(eq(activityLinks.id, l.dbId));
    }
    await refreshRollups(tx, code);
    const pFloat = projectFloat(Object.values(result.activities).map((x) => x.totalFloat));
    const violations = Object.values(result.activities).filter((x) => x.violation).length;
    await recordScheduleRun(
      code,
      {
        outcome: 'ok', dataDate, previousFinishDate, finishDate: result.projectFinish, changedActivities: changed.length,
        criticalActivities: result.criticalPath.length, constraintViolations: violations, details: { changed, criticalPath: result.criticalPath, projectFloat: pFloat },
      },
      actorName,
      tx,
    );
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, {
      actorName: who, actorPersonId: actor?.id, objectRef: code, change: `rescheduled at ${dataDate} · finish ${result.projectFinish} · ${changed.length} activities changed`,
      area: 'Planning', entityType: 'project', projectId: net.projectId,
    });
    await recordActivity(tx, {
      actorName: who, actorPersonId: actor?.id, text: `Rescheduled ${code} · finish ${longDateText(result.projectFinish)} · ${changed.length} activities changed`,
      kind: 'change', projectId: net.projectId,
    });
  });
  return {
    ok: true, dataDate, finishDate: result.projectFinish, previousFinishDate, changed, critical: result.criticalPath.length,
    violations: Object.values(result.activities).filter((x) => x.violation).length, projectFloat: projectFloat(Object.values(result.activities).map((x) => x.totalFloat)),
    ...(appliedChanges.length ? { appliedChanges } : {}),
  };
}

/** S-1: with RECALCULATION_MODE 'automatic', logic edits reschedule at once; 'manual' (default) waits for "Reschedule". */
export async function rescheduleIfAutomatic(code: string, actorName: string): Promise<RescheduleResult | null> {
  return RECALCULATION_MODE === 'automatic' ? rescheduleProject(code, actorName) : null;
}

// ── Baseline chip (S-3) ─────────────────────────────────────────────────────────────────────────────────────────────

/** Shows `baselineCode` on Plan / Schedule: stores it on the project and refreshes variances and baseline geometry (audited). */
export async function showProjectBaseline(code: string, baselineCode: string, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id, displayed: projects.displayedBaselineCode }).from(projects).where(eq(projects.code, code));
    if (!p) throw new Error(`Unknown project ${code}`);
    const [b] = await tx.select({ id: baselines.id }).from(baselines).where(and(eq(baselines.projectId, p.id), eq(baselines.code, baselineCode)));
    if (!b) throw new Error(`Unknown baseline ${baselineCode}`);
    const before = await getDisplayedBaselineCode(code, tx);
    await tx.update(projects).set({ displayedBaselineCode: baselineCode, updatedAt: new Date() }).where(eq(projects.id, p.id));
    await refreshRollups(tx, code);
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: code, change: `displayed baseline: ${before ?? '—'} → ${baselineCode}`,
      area: 'Planning', entityType: 'project', projectId: p.id,
    });
  });
}
