import 'server-only';
// Plan — WBS & activities DAL (docs/spec/05 §2): reads the WBS, activities, owners and the linked to-dos (tasks) /
// resource requests of one project (tasks and requests DALs); writes the Plan edits (the prototype's wbsOv / wbsRm / wbsOrd / added maps
// become persisted changes). Permission checks and revalidation stay in the Server Functions
// (src/features/plan/actions.ts).
import { and, asc, eq, gte, inArray, max, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { projectCalendarCode, projectDataDate } from '@/domain/ch4-defaults';
import { detectCycle } from '@/domain/cpm';
import type { PlanActivity, PlanPackage, PlanRoot, PredLink, TodoStatus } from '@/domain/schedule';
import { workingDayOf } from '@/domain/tasks';
import { monthLabels } from '@/lib/format';
import { getDb } from '@/server/db/client';
import { constraintText, type LinkType } from '@/server/db/codes';
import { findPerson, nameOf, writeAudit } from '@/server/db/helpers';
import {
  activities, activityLinks, persons, projects, wbsNodes,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { listProjectBaselines, type BaselineInfo } from './baselines';
import { lockProjectRow, maxTrashedPosition, shiftTrashedPositions, trashPlanRow } from './plan-trash';
import { listCalendars } from './calendars';
import { getProjectEvm } from './evm';
import { getScheduleControl, type ScheduleControl } from './planning';
import { listResourceRequests } from './requests';
import { listScheduleRuns } from './schedule-network';
import { listTasks } from './tasks';

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────

export interface PlanActivityRow extends PlanActivity {
  /** R-172: the owner's full name, else their short name ("S. Perrin" — the wizard's default PM has no full name); null without owner. */
  ownerName: string | null;
  /**
   * R-172: `owner` is an OWN key (persons.owner_code) — false when it fell back to the person's initials, which are not unique
   * ("SP"): the Owner select then shows that person apart from the OWN list instead of a namesake.
   */
  ownerIsCode: boolean;
  description: string | null;
  critical: boolean | null;
  position: number;
}

export interface PlanPackageRow extends PlanPackage {
  position: number;
  /** Added work packages only (stored, not displayed — docs/spec/05 §2.5 AF `wp`). */
  ownerName: string | null;
  scope: string | null;
}

/** A schedulable owner (OWN): key, full name, job title (EN source). */
export interface PlanOwner {
  code: string;
  name: string;
  title: string;
}

export interface PlanData {
  control: ScheduleControl;
  /** DEFS idx used by the "Add activity" numbering ('A' + idx + '9' + NN). */
  projectIdx: number;
  root: PlanRoot;
  packages: PlanPackageRow[];
  /** Activities in display order (position). */
  activities: PlanActivityRow[];
  /** The 9 OWN people (Owner select). */
  owners: PlanOwner[];
}

export interface PlanTodo {
  id: string;
  person: string;
  title: string;
  act: string;
  status: TodoStatus;
  due: number;
}

export interface PlanRequest {
  id: string;
  person: string;
  dept: string;
  title: string;
  act: string;
  status: 'draft' | 'pending' | 'approved' | 'reschedule' | 'rejected' | 'withdrawn';
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────

/** Everything the Plan screen needs for one project; null for projects without planning data (empty state). */
export async function getPlanData(code: string): Promise<PlanData | null> {
  const db = await getDb();
  const control = (await getScheduleControl(code)) ?? (await defaultControl(db, code));
  if (!control) return null;
  const owner = alias(persons, 'owner');
  const pred = alias(activities, 'pred');
  const [nodes, acts, links, owners] = await Promise.all([
    db
      .select({ n: wbsNodes, ownerName: persons.fullName })
      .from(wbsNodes)
      .innerJoin(projects, eq(projects.id, wbsNodes.projectId))
      .leftJoin(persons, eq(persons.id, wbsNodes.ownerPersonId))
      .where(eq(projects.code, code))
      .orderBy(asc(wbsNodes.position)),
    db
      .select({ a: activities, wbs: wbsNodes.code, ownerCode: owner.ownerCode, ownerInitials: owner.initials, ownerName: owner.fullName, ownerShort: owner.shortName })
      .from(activities)
      .innerJoin(projects, eq(projects.id, activities.projectId))
      .innerJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
      .leftJoin(owner, eq(owner.id, activities.ownerPersonId))
      .where(eq(projects.code, code))
      .orderBy(asc(activities.position)),
    db
      .select({ succ: activityLinks.successorId, pred: pred.code, type: activityLinks.type, lag: activityLinks.lagDays, position: activityLinks.position, driving: activityLinks.isDriving })
      .from(activityLinks)
      .innerJoin(projects, eq(projects.id, activityLinks.projectId))
      .innerJoin(pred, eq(pred.id, activityLinks.predecessorId))
      .where(eq(projects.code, code))
      .orderBy(asc(activityLinks.position)),
    db
      .select({ code: persons.ownerCode, name: persons.fullName, short: persons.shortName, title: persons.jobTitle })
      .from(persons)
      .where(sql`${persons.ownerCode} is not null`)
      .orderBy(asc(persons.sortOrder)),
  ]);
  const rootNode = nodes.find(({ n }) => n.level === 0)?.n;
  if (!rootNode) return null;
  const preds = new Map<string, PredLink[]>();
  const driving = new Map<string, string[]>();
  for (const l of links) {
    if (!preds.has(l.succ)) preds.set(l.succ, []);
    preds.get(l.succ)!.push([l.pred, l.type, l.lag]);
    if (l.driving) driving.set(l.succ, [...(driving.get(l.succ) ?? []), l.pred]);
  }
  const seedTime = rootNode.createdAt.getTime();
  return {
    control,
    projectIdx: projectIdxOf(acts.map(({ a }) => a.code)),
    root: {
      code: rootNode.code, name: rootNode.name, start: rootNode.startText, finish: rootNode.finishText,
      baselineFinish: rootNode.baselineFinishText, totalFloat: rootNode.totalFloatDays,
    },
    packages: nodes
      .filter(({ n }) => n.level === 1)
      .map(({ n, ownerName }) => ({ code: n.code, name: n.name, position: n.position, added: n.createdAt.getTime() > seedTime, ownerName, scope: n.scope })),
    activities: acts.map(({ a, wbs, ownerCode, ownerInitials, ownerName, ownerShort }) => ({
      id: a.code, wbs, name: a.name, durationDays: a.durationDays,
      start: a.startText, startActual: a.startActual, finish: a.finishText, finishActual: a.finishActual, startDate: a.startDate,
      baselineFinish: a.baselineFinishText, variance: a.varianceDays,
      constraint: constraintText(a.constraintType, a.constraintDateText), violated: a.constraintViolated,
      totalFloat: a.totalFloatDays, pct: a.percentComplete, owner: ownerCode ?? ownerInitials ?? null, ownerName: ownerName ?? ownerShort ?? null, ownerIsCode: !!ownerCode,
      budget: a.budgetKeur, actual: a.actualKeur, eac: a.eacKeur, preds: preds.get(a.id) ?? [],
      isAdded: a.isAdded, edited: !a.isAdded && a.updatedAt.getTime() > a.createdAt.getTime(),
      description: a.description, critical: a.critical, position: a.position,
      finishDate: a.finishDate, baselineFinishDate: a.baselineFinishDate, calendarCode: a.calendarCode, remainingDays: a.remainingDays,
      freeFloat: a.scheduledAt ? a.freeFloatDays : null, scheduled: !!a.scheduledAt, drivingPreds: a.scheduledAt ? (driving.get(a.id) ?? []) : null,
    })),
    owners: owners.map((o) => ({ code: o.code!, name: o.name ?? o.short, title: o.title ?? '' })),
  };
}

/**
 * Schedule header of a project planned in Keystone (machine-type template, MS Project / P6 import) before its first
 * Reschedule writes one (`refreshRollups`): neutral texts, start month from the project. Null without a WBS root.
 */
async function defaultControl(db: Tx | Awaited<ReturnType<typeof getDb>>, code: string): Promise<ScheduleControl | null> {
  const [p] = await db
    .select({ id: projects.id, startMonth: projects.startMonth, progress: projects.progress, shortCode: projects.shortCode })
    .from(projects)
    .where(eq(projects.code, code));
  if (!p) return null;
  const [root] = await db.select({ id: wbsNodes.id }).from(wbsNodes).where(and(eq(wbsNodes.projectId, p.id), eq(wbsNodes.level, 0)));
  if (!root) return null;
  const start = Math.max(0, Math.floor(p.startMonth ?? 0));
  // R-073 (delivery 7): progress computed from the activities.
  const progress = (await getProjectEvm(code, db))?.progress ?? p.progress;
  return {
    start, tNow: 0, pct: Math.round(progress * 100), p3: p.shortCode, floatDays: 0, chartMonths: monthLabels(start, 12), ganttMonths: monthLabels(start, 13),
    finishText: '—', baselineText: '—', floatText: '—', floatShort: '—', critText: '', milesText: '—', milesSub: '', baselineSet: '—', team: [],
  };
}

/**
 * Numbering prefix of a project's added activities ('A' + idx + '9' + NN): the digit after "A" of its activity ids,
 * else 1. R-170: the prototype's DEFS idx is no longer read — the six seeded projects' ids carry it (A1… HLT-026,
 * A3… NDC-031, A2… RCF-019, A4… ERP-202, A5… WSA-044, A6… MSR-012), so the numbering is unchanged.
 */
export function projectIdxOf(actCodes: readonly string[]): number {
  const d = actCodes.map((c) => /^A(\d)/.exec(c)?.[1]).find(Boolean);
  return d ? parseInt(d, 10) : 1;
}

/** To-dos (tasks) of a project, in list order, linked to their activity by `act` ('' when none). */
export async function getPlanTodos(code: string): Promise<PlanTodo[]> {
  return (await listTasks({ projectCode: code })).map((t) => ({
    id: t.id, person: t.assignee, title: t.title, act: t.activity?.code ?? '', status: t.status, due: t.dueDay ?? workingDayOf(t.due, 'down'),
  }));
}

/** Resource requests of a project, in list order, linked to their activity by `act` ('' when none). */
export async function getPlanRequests(code: string): Promise<PlanRequest[]> {
  return (await listResourceRequests({ projectCode: code })).map((r) => ({
    id: r.id, person: r.resource, dept: r.department, title: r.title, act: r.activity?.code ?? '', status: r.status,
  }));
}

// ── Writes ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ActivityPatch {
  name?: string;
  /** OWN key ("JW"). */
  ownerCode?: string;
  durationDays?: number;
  budget?: number;
  eac?: number;
  preds?: PredLink[];
  pct?: number;
}

async function findActivity(tx: Tx, code: string, actId: string) {
  const [row] = await tx
    .select({ a: activities })
    .from(activities)
    .innerJoin(projects, eq(projects.id, activities.projectId))
    .where(and(eq(projects.code, code), eq(activities.code, actId)));
  return row?.a ?? null;
}

async function findNode(tx: Tx, code: string, w: string) {
  const [row] = await tx
    .select({ n: wbsNodes })
    .from(wbsNodes)
    .innerJoin(projects, eq(projects.id, wbsNodes.projectId))
    .where(and(eq(projects.code, code), eq(wbsNodes.code, w)));
  return row?.n ?? null;
}

/**
 * Applies an inline edit. Structure edits (name, owner, duration, budget, logic) stamp `updatedAt` — the
 * "edited" dot of the Structure view; progress alone does not (as `applyOv`). Returns false when not found.
 */
export async function updateActivity(code: string, actId: string, patch: ActivityPatch): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const a = await findActivity(tx, code, actId);
    if (!a) return false;
    const set: Partial<typeof activities.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.durationDays !== undefined) set.durationDays = patch.durationDays;
    if (patch.budget !== undefined) set.budgetKeur = patch.budget;
    if (patch.eac !== undefined) set.eacKeur = patch.eac;
    if (patch.pct !== undefined) set.percentComplete = patch.pct;
    if (patch.ownerCode !== undefined) {
      const [p] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.ownerCode, patch.ownerCode));
      if (!p) return false;
      set.ownerPersonId = p.id;
    }
    const structural = Object.keys(set).some((k) => k !== 'percentComplete') || patch.preds !== undefined;
    if (structural) set.updatedAt = new Date();
    // A remaining duration stored by an import (MSPDI / XER) wins over % complete in the CPM: a new % or duration replaces it.
    if (patch.pct !== undefined || patch.durationDays !== undefined) set.remainingDays = null;
    if (Object.keys(set).length) await tx.update(activities).set(set).where(eq(activities.id, a.id));
    if (patch.preds !== undefined) {
      await tx.delete(activityLinks).where(eq(activityLinks.successorId, a.id));
      if (patch.preds.length) {
        const ids = await tx
          .select({ id: activities.id, code: activities.code })
          .from(activities)
          .where(and(eq(activities.projectId, a.projectId), inArray(activities.code, patch.preds.map((p) => p[0]))));
        const byCode = new Map(ids.map((x) => [x.code, x.id]));
        const rows = patch.preds
          .filter(([pred]) => byCode.has(pred))
          .map(([pred, type, lag], position) => ({ projectId: a.projectId, predecessorId: byCode.get(pred)!, successorId: a.id, type, lagDays: lag, position }));
        if (rows.length) await tx.insert(activityLinks).values(rows);
      }
    }
    return true;
  });
}

/** Renames a work package (WP renames do not set the "edited" mark). */
export async function renameWorkPackage(code: string, w: string, name: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const n = await findNode(tx, code, w);
    if (!n || n.level !== 1) return false;
    await tx.update(wbsNodes).set({ name }).where(eq(wbsNodes.id, n.id));
    return true;
  });
}

/** Activity ids of a work package in display order. */
async function packageActivities(tx: Tx, wbsNodeId: string) {
  return tx.select({ id: activities.id, code: activities.code, position: activities.position }).from(activities).where(eq(activities.wbsNodeId, wbsNodeId)).orderBy(asc(activities.position));
}

/** Re-orders the activities of one work package (`wbsOrd`): `order` = activity ids, reusing their positions. */
export async function reorderActivities(code: string, w: string, order: string[]): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const n = await findNode(tx, code, w);
    if (!n) return false;
    const kids = await packageActivities(tx, n.id);
    if (kids.length !== order.length || !kids.every((k) => order.includes(k.code))) return false;
    const slots = kids.map((k) => k.position);
    const byCode = new Map(kids.map((k) => [k.code, k.id]));
    for (let i = 0; i < order.length; i++) await tx.update(activities).set({ position: slots[i] }).where(eq(activities.id, byCode.get(order[i])!));
    return true;
  });
}

/** Work package of an activity plus its siblings' ids in order (for moves). */
export async function getPackageOrder(code: string, actId: string): Promise<{ wbs: string; ids: string[] } | null> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const a = await findActivity(tx, code, actId);
    if (!a) return null;
    const [n] = await tx.select({ code: wbsNodes.code }).from(wbsNodes).where(eq(wbsNodes.id, a.wbsNodeId));
    return { wbs: n.code, ids: (await packageActivities(tx, a.wbsNodeId)).map((k) => k.code) };
  });
}

/**
 * Removes an activity (`rmKey`) into the Plan trash (S-5): its logic links, assignments and Plan to-dos go with it and can be
 * restored (plan-trash.ts). False when not found.
 */
export async function deleteActivity(code: string, actId: string, actorName = 'Keystone'): Promise<boolean> {
  return !!(await trashPlanRow(code, 'act', actId, actorName));
}

/**
 * Removes a work package and all its activities (`rmKey` on a WP) into the Plan trash (S-5): their links, assignments, to-dos
 * and the package's Schedule bar (A-7 roll-up) go with them. Rows of other modules that point at the node or the activities
 * (Budget WP lines, change-request WBS, milestones…) keep their own code/name and lose only the link, given back on restore.
 * False for the root or an unknown package.
 */
export async function deleteWorkPackage(code: string, w: string, actorName = 'Keystone'): Promise<boolean> {
  return !!(await trashPlanRow(code, 'wp', w, actorName));
}

export interface NewActivity {
  id: string;
  wbs: string;
  name: string;
  durationDays: number;
  ownerCode: string;
  /** Display texts ("05 Oct") and ISO dates (null when the typed text did not parse). */
  start: string;
  startDate: string | null;
  finish: string;
  finishDate: string | null;
  budget: number;
  totalFloat: number;
  critical: boolean;
  description: string;
}

/**
 * Inserts an activity at the end of its work package (positions after it shift by one — R-064: the ghost slots of the removed
 * rows in the Plan trash too, so a later restore lands back in place). The project row is locked for the transaction.
 */
export async function insertActivity(code: string, input: NewActivity): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (!(await lockProjectRow(tx, { code }))) return false;
    const n = await findNode(tx, code, input.wbs);
    if (!n || n.level !== 1) return false;
    const [{ last }] = await tx.select({ last: max(activities.position) }).from(activities).where(eq(activities.wbsNodeId, n.id));
    const position = Math.max(n.position, last ?? n.position) + 1;
    await tx.update(wbsNodes).set({ position: sql`${wbsNodes.position} + 1` }).where(and(eq(wbsNodes.projectId, n.projectId), gte(wbsNodes.position, position)));
    await tx.update(activities).set({ position: sql`${activities.position} + 1` }).where(and(eq(activities.projectId, n.projectId), gte(activities.position, position)));
    await shiftTrashedPositions(tx, n.projectId, position, 1);
    const [owner] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.ownerCode, input.ownerCode));
    await tx.insert(activities).values({
      projectId: n.projectId, wbsNodeId: n.id, code: input.id, name: input.name, durationDays: input.durationDays,
      startText: input.start, startActual: false, finishText: input.finish, finishActual: false,
      startDate: input.startDate, finishDate: input.finishDate, baselineFinishText: input.finish, baselineFinishDate: input.finishDate,
      varianceDays: 0, constraintViolated: false, totalFloatDays: input.totalFloat, percentComplete: 0,
      ownerPersonId: owner?.id ?? null, budgetKeur: input.budget, actualKeur: 0, eacKeur: input.budget,
      critical: input.critical, description: input.description || null, isAdded: true, position,
    });
    return true;
  });
}

export interface NewWorkPackage {
  code: string;
  name: string;
  /** Full name of the owner (TEAM select). */
  ownerName: string;
  scope: string;
}

/**
 * Appends a work package after the existing ones (no activities yet) — R-064: after the removed ones still in the Plan trash too
 * (their ghost slots), so restoring them keeps the order. The project row is locked for the transaction.
 */
export async function insertWorkPackage(code: string, input: NewWorkPackage): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const projectId = (await lockProjectRow(tx, { code }))?.id;
    if (!projectId) return false;
    const [root] = await tx.select({ id: wbsNodes.id }).from(wbsNodes).where(and(eq(wbsNodes.projectId, projectId), eq(wbsNodes.level, 0)));
    if (!root) return false;
    const [[{ n }], [{ a }]] = await Promise.all([
      tx.select({ n: max(wbsNodes.position) }).from(wbsNodes).where(eq(wbsNodes.projectId, projectId)),
      tx.select({ a: max(activities.position) }).from(activities).where(eq(activities.projectId, projectId)),
    ]);
    const ghost = await maxTrashedPosition(tx, projectId);
    const [owner] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.fullName, input.ownerName));
    await tx.insert(wbsNodes).values({
      projectId, code: input.code, name: input.name, level: 1, parentId: root.id, position: Math.max(n ?? 0, a ?? 0, ghost ?? 0) + 1,
      ownerPersonId: owner?.id ?? null, scope: input.scope || null,
    });
    return true;
  });
}

/**
 * OWN key of the viewer (P-9a: an activity's owner enters its progress) — by person for signed-in users, by short name for the
 * demo personas; null when the viewer owns no activity anywhere.
 */
export async function ownerCodeOfViewer(v: { personId: string | null; short: string }): Promise<string | null> {
  const db = await getDb();
  const [p] = await db.select({ code: persons.ownerCode }).from(persons).where(v.personId ? eq(persons.id, v.personId) : eq(persons.shortName, v.short));
  return p?.code ?? null;
}

/** OWN key of a full name (INIT_OF), or null. */
export async function ownerCodeOfName(name: string): Promise<string | null> {
  const db = await getDb();
  const [p] = await db.select({ code: persons.ownerCode }).from(persons).where(eq(persons.fullName, name));
  return p?.code ?? null;
}

// ── Chapter 4: toolbar settings and relationships (S-1, S-2, S-3, S-5) ─────────────────────────────────────────────

export interface PlanCalendarOption {
  code: string;
  /** EN source name ("Chantier 6d · 10h"). */
  name: string;
  hoursPerDay: number;
}

export interface PlanSettings {
  /** Project data date (ISO, S-4 default: the status date). */
  dataDate: string;
  /** Project calendar code (S-2 default when none is set). */
  calendarCode: string;
  /** Active company calendars plus the project's imported ones. */
  calendars: PlanCalendarOption[];
  /** Baselines in register order, the displayed one flagged. */
  baselines: BaselineInfo[];
  displayed: BaselineInfo | null;
  /** Last Reschedule run (null when never rescheduled). */
  lastRun: { ranAt: Date; ranByName: string; outcome: string; finishDate: string | null; changedActivities: number } | null;
}

/** Calendar, data date, baselines and last run of a project (Plan toolbar chips, drawer calendar select). */
export async function getPlanSettings(code: string): Promise<PlanSettings | null> {
  const db = await getDb();
  const [p] = await db.select({ dataDate: projects.dataDate, calendar: projects.calendar }).from(projects).where(eq(projects.code, code));
  if (!p) return null;
  const [cals, bls, runs] = await Promise.all([listCalendars({ projectCode: code }), listProjectBaselines(code), listScheduleRuns(code, 1)]);
  const run = runs[0];
  return {
    dataDate: projectDataDate(p),
    calendarCode: projectCalendarCode(p),
    calendars: cals.map((c) => ({ code: c.code, name: c.name, hoursPerDay: c.hoursPerDay })),
    baselines: bls,
    displayed: bls.find((b) => b.displayed) ?? null,
    lastRun: run ? { ranAt: run.ranAt, ranByName: run.ranByName, outcome: run.outcome, finishDate: run.finishDate, changedActivities: run.changedActivities } : null,
  };
}

export type LinkWriteResult = { ok: true } | { error: 'unknown' | 'self' | 'duplicate' | 'cycle' | 'missing'; cycle?: string[] };

async function linkEnds(tx: Tx, code: string, pred: string, succ: string) {
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  if (!p) return null;
  const rows = await tx.select({ id: activities.id, code: activities.code }).from(activities).where(and(eq(activities.projectId, p.id), inArray(activities.code, [pred, succ])));
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  return { projectId: p.id, predId: byCode.get(pred) ?? null, succId: byCode.get(succ) ?? null };
}

/**
 * Drawer "Add relationship": `pred` → `succ` with a type and a lag (working days, negative = lead). Refuses unknown activities,
 * self links, duplicates and logic loops (CPM cycle detection). Appended to the successor's predecessor list; audited.
 */
export async function addActivityLink(code: string, link: { pred: string; succ: string; type: LinkType; lag: number }, actorName: string): Promise<LinkWriteResult> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const ends = await linkEnds(tx, code, link.pred, link.succ);
    if (!ends || !ends.predId || !ends.succId) return { error: 'unknown' as const };
    if (link.pred === link.succ) return { error: 'self' as const };
    const pred = alias(activities, 'pred');
    const succ = alias(activities, 'succ');
    const existing = await tx
      .select({ pred: pred.code, succ: succ.code, position: activityLinks.position, succId: activityLinks.successorId })
      .from(activityLinks)
      .innerJoin(pred, eq(pred.id, activityLinks.predecessorId))
      .innerJoin(succ, eq(succ.id, activityLinks.successorId))
      .where(eq(activityLinks.projectId, ends.projectId));
    if (existing.some((l) => l.pred === link.pred && l.succ === link.succ)) return { error: 'duplicate' as const };
    const ids = (await tx.select({ code: activities.code }).from(activities).where(eq(activities.projectId, ends.projectId))).map((r) => r.code);
    const cycle = detectCycle(ids, [...existing, { pred: link.pred, succ: link.succ }]);
    if (cycle) return { error: 'cycle' as const, cycle };
    const position = Math.max(-1, ...existing.filter((l) => l.succId === ends.succId).map((l) => l.position)) + 1;
    await tx.insert(activityLinks).values({ projectId: ends.projectId, predecessorId: ends.predId, successorId: ends.succId, type: link.type, lagDays: link.lag, position });
    await tx.update(activities).set({ updatedAt: new Date() }).where(eq(activities.id, ends.succId));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: link.succ,
      change: `relationship added: ${link.pred} ${link.type}${link.lag ? (link.lag > 0 ? '+' : '') + link.lag : ''} → ${link.succ}`,
      area: 'Planning', entityType: 'activity', entityId: ends.succId, projectId: ends.projectId,
    });
    return { ok: true as const };
  });
}

/** Drawer link removal (a predecessor or a successor line). */
export async function removeActivityLink(code: string, pred: string, succ: string, actorName: string): Promise<LinkWriteResult> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const ends = await linkEnds(tx, code, pred, succ);
    if (!ends || !ends.predId || !ends.succId) return { error: 'unknown' as const };
    const del = await tx
      .delete(activityLinks)
      .where(and(eq(activityLinks.predecessorId, ends.predId), eq(activityLinks.successorId, ends.succId)))
      .returning({ type: activityLinks.type });
    if (!del.length) return { error: 'missing' as const };
    await tx.update(activities).set({ updatedAt: new Date() }).where(eq(activities.id, ends.succId));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: succ, change: `relationship removed: ${pred} ${del[0].type} → ${succ}`,
      area: 'Planning', entityType: 'activity', entityId: ends.succId, projectId: ends.projectId,
    });
    return { ok: true as const };
  });
}
