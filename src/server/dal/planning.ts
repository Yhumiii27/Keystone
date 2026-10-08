import 'server-only';
// Planning DAL (docs/spec/05 §0.5, §1, §2): WBS, activities, logic links, milestones, schedule bars, baselines,
// project control header, resource assignments and the portfolio pipeline plan. Plain serialisable objects.
import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { monthLabels } from '@/lib/format';
import { getDb } from '@/server/db/client';
import {
  baselineState, constraintText, displayOfIso, milestoneStatus, pipelineWindow,
  type BaselineState, type LinkType, type MilestoneStatus, type PipelineWindow,
} from '@/server/db/codes';
import {
  activities, activityAssignments, activityLinks, baselines, changeRequests, milestones, persons, pipelineStagePlans, projectControls,
  projectMembers, projects, scheduleBars, wbsNodes,
} from '@/server/db/schema';

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────

/** WBS summary node: project root ("1", level 0) or work package ("1.4", level 1). */
export interface WbsNodeRow {
  code: string;
  name: string;
  level: number;
  /** Row index in the prototype's ACTS list (activities share the sequence). */
  position: number;
  /** Root only: "05 Jan", "14 Jan ’27", baseline finish "18 Dec", total float −27. */
  start: string | null;
  finish: string | null;
  baselineFinish: string | null;
  totalFloat: number | null;
}

export interface ActivityRow {
  /** "A1250". */
  id: string;
  /** WBS code of its work package ("1.4"). */
  wbs: string;
  name: string;
  durationDays: number;
  /** Display start/finish without the " A" suffix; the *Actual flags carry it. */
  start: string;
  startActual: boolean;
  finish: string;
  finishActual: boolean;
  startDate: string | null;
  finishDate: string | null;
  /** BL1 finish ("31 Aug"). */
  baselineFinish: string;
  baselineFinishDate: string | null;
  /** Finish variance vs baseline in days (negative = late). */
  variance: number;
  /** Prototype `c`: "FNLT 18 Dec", '' when none. */
  constraint: string;
  constraintType: string | null;
  violated: boolean;
  /** Total float (days); null when complete. */
  totalFloat: number | null;
  pct: number;
  /** Owner key ("JW", OWN) and full name. */
  owner: string | null;
  ownerName: string | null;
  budget: number;
  actual: number;
  eac: number;
  packageName: string | null;
  critical: boolean | null;
  description: string | null;
  isAdded: boolean;
  position: number;
  /** Predecessors in order: [predecessor id, type, lag days]. */
  preds: [string, LinkType, number][];
}

export interface ActivityLinkRow {
  predecessor: string;
  successor: string;
  type: LinkType;
  lag: number;
  /** Position in the successor's predecessor list (the first one is labelled "driving" by the prototype). */
  position: number;
}

export interface MilestoneRow {
  name: string;
  /** Fractional months from the project start. */
  baselineMonth: number;
  forecastMonth: number;
  status: MilestoneStatus;
  /** 'Done' | 'Late' | 'At risk' | 'On track' (EN source string). */
  statusLabel: string;
  position: number;
}

/** Work-package bar of the Schedule Gantt (TASKS). Months are fractional offsets from the project start. */
export interface ScheduleBarRow {
  name: string;
  wbs: string | null;
  /** Short name "J. Wagner". */
  owner: string;
  ownerName: string | null;
  baselineStart: number;
  baselineEnd: number;
  forecastStart: number;
  forecastEnd: number;
  pct: number;
  critical: boolean;
  position: number;
}

export interface BaselineRow {
  code: string;
  name: string;
  /** "12 Mar 2026", or "Pending CR-009" while the re-baseline awaits its change request. */
  setOn: string;
  setOnDate: string | null;
  bac: number;
  /** "18 Dec 2026". */
  finish: string;
  finishDate: string;
  state: BaselineState;
  /** 'Superseded' | 'Current' | 'Proposed'. */
  stateLabel: string;
  changeRequest: string | null;
}

/** Schedule header of projectData(): time model and display strings (docs/spec/05 §0.5). */
export interface ScheduleControl {
  /** Project start, month offset from Jan 2026. */
  start: number;
  /** Data date in months since the project start (8.8 − start). */
  tNow: number;
  /** round(progress × 100). */
  pct: number;
  /** Short code "HLT". */
  p3: string;
  floatDays: number;
  /** monthLabels(start, 12) / (start, 13). */
  chartMonths: string[];
  ganttMonths: string[];
  finishText: string;
  baselineText: string;
  floatText: string;
  floatShort: string;
  critText: string;
  milesText: string;
  milesSub: string;
  baselineSet: string;
  /** Team members' full names (DEFS.team). */
  team: string[];
}

export interface AssignmentRow {
  resource: string;
  personName: string | null;
  detail: string;
  units: string;
  progressText: string;
}

export interface PipelineWindowRow {
  window: PipelineWindow;
  /** 'Initiative' | 'Board' | 'APS' | 'APD'. */
  label: string;
  startMonth: number;
  endMonth: number;
}

/** Prototype ACTS row (docs/spec/05 Data entities): summary rows {w,n,lv(,s,f,bl,tf)} and activities. */
export interface ProtoAct {
  id?: string;
  w: string;
  n: string;
  lv?: number;
  d?: number;
  s?: string;
  f?: string;
  bl?: string;
  v?: number;
  p?: [string, LinkType, number][];
  c?: string;
  viol?: boolean;
  tf?: number | null;
  pc?: number;
  o?: string;
  b?: [number, number, number];
  pkg?: string;
}

// ── Queries ────────────────────────────────────────────────────────────────────────────────────────────

const byProject = (code: string) => eq(projects.code, code);

/** Project root and work packages, in ACTS order. */
export async function getWbs(code: string): Promise<WbsNodeRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ n: wbsNodes })
    .from(wbsNodes)
    .innerJoin(projects, eq(projects.id, wbsNodes.projectId))
    .where(byProject(code))
    .orderBy(asc(wbsNodes.position));
  return rows.map(({ n }) => ({
    code: n.code, name: n.name, level: n.level, position: n.position,
    start: n.startText, finish: n.finishText, baselineFinish: n.baselineFinishText, totalFloat: n.totalFloatDays,
  }));
}

/** Logic links of the project's activities, by successor then position. */
export async function getActivityLinks(code: string): Promise<ActivityLinkRow[]> {
  const db = await getDb();
  const pred = alias(activities, 'pred');
  const succ = alias(activities, 'succ');
  const rows = await db
    .select({ predecessor: pred.code, successor: succ.code, type: activityLinks.type, lag: activityLinks.lagDays, position: activityLinks.position })
    .from(activityLinks)
    .innerJoin(projects, eq(projects.id, activityLinks.projectId))
    .innerJoin(pred, eq(pred.id, activityLinks.predecessorId))
    .innerJoin(succ, eq(succ.id, activityLinks.successorId))
    .where(byProject(code))
    .orderBy(asc(succ.position), asc(activityLinks.position));
  return rows;
}

/** Activities in ACTS order, with their predecessors. */
export async function getActivities(code: string): Promise<ActivityRow[]> {
  const db = await getDb();
  const [rows, links] = await Promise.all([
    db
      .select({ a: activities, wbs: wbsNodes.code, ownerCode: persons.ownerCode, ownerInitials: persons.initials, ownerName: persons.fullName })
      .from(activities)
      .innerJoin(projects, eq(projects.id, activities.projectId))
      .innerJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
      .leftJoin(persons, eq(persons.id, activities.ownerPersonId))
      .where(byProject(code))
      .orderBy(asc(activities.position)),
    getActivityLinks(code),
  ]);
  const preds = new Map<string, [string, LinkType, number][]>();
  for (const l of links) {
    if (!preds.has(l.successor)) preds.set(l.successor, []);
    preds.get(l.successor)!.push([l.predecessor, l.type, l.lag]);
  }
  return rows.map(({ a, wbs, ownerCode, ownerInitials, ownerName }) => ({
    id: a.code, wbs, name: a.name, durationDays: a.durationDays,
    start: a.startText, startActual: a.startActual, finish: a.finishText, finishActual: a.finishActual,
    startDate: a.startDate, finishDate: a.finishDate, baselineFinish: a.baselineFinishText, baselineFinishDate: a.baselineFinishDate,
    variance: a.varianceDays, constraint: constraintText(a.constraintType, a.constraintDateText), constraintType: a.constraintType,
    violated: a.constraintViolated, totalFloat: a.totalFloatDays, pct: a.percentComplete,
    owner: ownerCode ?? ownerInitials ?? null, ownerName, budget: a.budgetKeur, actual: a.actualKeur, eac: a.eacKeur,
    packageName: a.packageName, critical: a.critical, description: a.description, isAdded: a.isAdded, position: a.position,
    preds: preds.get(a.code) ?? [],
  }));
}

/** Rebuilds the prototype's ACTS list (summary rows + activities, interleaved in their original order). */
export function toProtoActs(wbs: WbsNodeRow[], acts: ActivityRow[]): ProtoAct[] {
  const rows: { position: number; row: ProtoAct }[] = [
    ...wbs.map((n) => ({
      position: n.position,
      row: (n.level === 0
        ? { w: n.code, n: n.name, lv: 0, s: n.start ?? '', f: n.finish ?? '', bl: n.baselineFinish ?? '', tf: n.totalFloat }
        : { w: n.code, n: n.name, lv: n.level }) as ProtoAct,
    })),
    ...acts.map((a) => {
      const row: ProtoAct = {
        id: a.id, w: a.wbs, n: a.name, d: a.durationDays, s: a.start + (a.startActual ? ' A' : ''), f: a.finish + (a.finishActual ? ' A' : ''),
        bl: a.baselineFinish, v: a.variance, p: a.preds, c: a.constraint, tf: a.totalFloat, pc: a.pct, o: a.owner ?? '',
        b: [a.budget, a.actual, a.eac],
      };
      if (a.violated) row.viol = true;
      if (a.packageName != null) row.pkg = a.packageName;
      return { position: a.position, row };
    }),
  ];
  return rows.sort((x, y) => x.position - y.position).map((r) => r.row);
}

export async function getMilestones(code: string): Promise<MilestoneRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ m: milestones })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .where(byProject(code))
    .orderBy(asc(milestones.position));
  return rows.map(({ m }) => ({
    name: m.name, baselineMonth: m.baselineMonth, forecastMonth: m.forecastMonth, status: m.status,
    statusLabel: milestoneStatus.label(m.status), position: m.position,
  }));
}

/** Schedule Gantt bars (TASKS). */
export async function getScheduleBars(code: string): Promise<ScheduleBarRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ b: scheduleBars, wbs: wbsNodes.code, owner: persons.shortName, ownerName: persons.fullName })
    .from(scheduleBars)
    .innerJoin(projects, eq(projects.id, scheduleBars.projectId))
    .leftJoin(wbsNodes, eq(wbsNodes.id, scheduleBars.wbsNodeId))
    .leftJoin(persons, eq(persons.id, scheduleBars.ownerPersonId))
    .where(byProject(code))
    .orderBy(asc(scheduleBars.position));
  return rows.map(({ b, wbs, owner, ownerName }) => ({
    name: b.name, wbs, owner: owner ?? '—', ownerName, baselineStart: b.baselineStart, baselineEnd: b.baselineEnd,
    forecastStart: b.forecastStart, forecastEnd: b.forecastEnd, pct: b.percentComplete, critical: b.critical, position: b.position,
  }));
}

/** Baselines (BL0…BL2). Only HLT-026 has some in the seed. */
export async function getBaselines(code: string): Promise<BaselineRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ b: baselines, cr: changeRequests.number })
    .from(baselines)
    .innerJoin(projects, eq(projects.id, baselines.projectId))
    .leftJoin(changeRequests, eq(changeRequests.id, baselines.changeRequestId))
    .where(byProject(code))
    .orderBy(asc(baselines.position));
  return rows.map(({ b, cr }) => ({
    code: b.code, name: b.name, setOn: b.setOn ? displayOfIso(b.setOn) : cr ? `Pending ${cr}` : '—', setOnDate: b.setOn, bac: b.bacKeur,
    finish: displayOfIso(b.finishDate), finishDate: b.finishDate, state: b.state, stateLabel: baselineState.label(b.state), changeRequest: cr,
  }));
}

function toScheduleControl(c: typeof projectControls.$inferSelect, progress: number, shortCode: string, team: string[]): ScheduleControl {
  return {
    start: c.startMonth, tNow: c.tNow, pct: Math.round(progress * 100), p3: shortCode, floatDays: c.floatDays,
    chartMonths: monthLabels(c.startMonth, 12), ganttMonths: monthLabels(c.startMonth, 13),
    finishText: c.finishText, baselineText: c.baselineText, floatText: c.floatText, floatShort: c.floatShort, critText: c.critText,
    milesText: c.milesText, milesSub: c.milesSub, baselineSet: c.baselineSet, team,
  };
}

/** Schedule header of projectData(); null for projects without planning data. */
export async function getScheduleControl(code: string): Promise<ScheduleControl | null> {
  const db = await getDb();
  const [row] = await db
    .select({ c: projectControls, projectId: projects.id, progress: projects.progress, shortCode: projects.shortCode })
    .from(projectControls)
    .innerJoin(projects, eq(projects.id, projectControls.projectId))
    .where(byProject(code));
  if (!row) return null;
  const team = await db
    .select({ fullName: persons.fullName, shortName: persons.shortName })
    .from(projectMembers)
    .innerJoin(persons, eq(persons.id, projectMembers.personId))
    .where(eq(projectMembers.projectId, row.projectId))
    .orderBy(asc(projectMembers.position));
  return toScheduleControl(row.c, row.progress, row.shortCode, team.map((m) => m.fullName ?? m.shortName));
}

/**
 * Schedule header + milestones of every project with planning data, keyed by project code (register order) —
 * one round trip for portfolio screens (Projects register pvExtra, My projects, Home).
 */
export async function listScheduleSummaries(): Promise<Record<string, ScheduleControl & { milestones: MilestoneRow[] }>> {
  const db = await getDb();
  const [heads, miles, team] = await Promise.all([
    db
      .select({ c: projectControls, code: projects.code, progress: projects.progress, shortCode: projects.shortCode })
      .from(projectControls)
      .innerJoin(projects, eq(projects.id, projectControls.projectId))
      .orderBy(asc(projects.sortOrder)),
    db
      .select({ code: projects.code, m: milestones })
      .from(milestones)
      .innerJoin(projects, eq(projects.id, milestones.projectId))
      .orderBy(asc(milestones.position)),
    db
      .select({ code: projects.code, fullName: persons.fullName, shortName: persons.shortName })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .innerJoin(persons, eq(persons.id, projectMembers.personId))
      .orderBy(asc(projectMembers.position)),
  ]);
  const out: Record<string, ScheduleControl & { milestones: MilestoneRow[] }> = {};
  for (const h of heads)
    out[h.code] = {
      ...toScheduleControl(h.c, h.progress, h.shortCode, team.filter((t) => t.code === h.code).map((t) => t.fullName ?? t.shortName)),
      milestones: miles.filter((x) => x.code === h.code).map(({ m }) => ({
        name: m.name, baselineMonth: m.baselineMonth, forecastMonth: m.forecastMonth, status: m.status,
        statusLabel: milestoneStatus.label(m.status), position: m.position,
      })),
    };
  return out;
}

/** Resource assignments of one activity (A1250_RES); empty when none are recorded. */
export async function getActivityAssignments(code: string, activityId: string): Promise<AssignmentRow[]> {
  const db = await getDb();
  return db
    .select({
      resource: activityAssignments.resource, personName: persons.fullName, detail: activityAssignments.detail,
      units: activityAssignments.units, progressText: activityAssignments.progressText,
    })
    .from(activityAssignments)
    .innerJoin(activities, eq(activities.id, activityAssignments.activityId))
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .leftJoin(persons, eq(persons.id, activityAssignments.personId))
    .where(and(byProject(code), eq(activities.code, activityId)))
    .orderBy(asc(activityAssignments.position));
}

/** Pipeline stage plans (PIPE_PLAN) of every project that has one, keyed by project code. */
export async function getPipelinePlans(): Promise<Record<string, PipelineWindowRow[]>> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code, w: pipelineStagePlans })
    .from(pipelineStagePlans)
    .innerJoin(projects, eq(projects.id, pipelineStagePlans.projectId))
    .orderBy(asc(projects.sortOrder), asc(pipelineStagePlans.position));
  const out: Record<string, PipelineWindowRow[]> = {};
  for (const { code, w } of rows)
    (out[code] ??= []).push({ window: w.window, label: pipelineWindow.label(w.window), startMonth: w.startMonth, endMonth: w.endMonth });
  return out;
}
