import 'server-only';
// Plan — WBS & activities DAL (docs/spec/05 §2): reads the WBS, activities, owners and the linked to-dos (tasks) /
// resource requests of one project (tasks and requests DALs); writes the Plan edits (the prototype's wbsOv / wbsRm / wbsOrd / added maps
// become persisted changes). Permission checks and revalidation stay in the Server Functions
// (src/features/plan/actions.ts).
import { and, asc, eq, gte, inArray, max, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PlanActivity, PlanPackage, PlanRoot, PredLink, TodoStatus } from '@/domain/schedule';
import { workingDayOf } from '@/domain/tasks';
import { getDb } from '@/server/db/client';
import { constraintText } from '@/server/db/codes';
import {
  activities, activityLinks, changeRequestWbs, milestones, persons, projects, scheduleBars, wbsNodes, wpBudgets,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { PROTO } from '@/server/prototype';
import { getScheduleControl, type ScheduleControl } from './planning';
import { listResourceRequests } from './requests';
import { listTasks } from './tasks';

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────────

export interface PlanActivityRow extends PlanActivity {
  ownerName: string | null;
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
  status: 'pending' | 'approved' | 'reschedule' | 'rejected' | 'withdrawn';
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────

async function projectIdOf(tx: Tx, code: string): Promise<string | null> {
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  return p?.id ?? null;
}

/** Everything the Plan screen needs for one project; null for projects without planning data (empty state). */
export async function getPlanData(code: string): Promise<PlanData | null> {
  const control = await getScheduleControl(code);
  if (!control) return null;
  const db = await getDb();
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
      .select({ a: activities, wbs: wbsNodes.code, ownerCode: owner.ownerCode, ownerInitials: owner.initials, ownerName: owner.fullName })
      .from(activities)
      .innerJoin(projects, eq(projects.id, activities.projectId))
      .innerJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
      .leftJoin(owner, eq(owner.id, activities.ownerPersonId))
      .where(eq(projects.code, code))
      .orderBy(asc(activities.position)),
    db
      .select({ succ: activityLinks.successorId, pred: pred.code, type: activityLinks.type, lag: activityLinks.lagDays, position: activityLinks.position })
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
  for (const l of links) {
    if (!preds.has(l.succ)) preds.set(l.succ, []);
    preds.get(l.succ)!.push([l.pred, l.type, l.lag]);
  }
  const seedTime = rootNode.createdAt.getTime();
  return {
    control,
    projectIdx: projectIdxOf(code, acts.map(({ a }) => a.code)),
    root: {
      code: rootNode.code, name: rootNode.name, start: rootNode.startText, finish: rootNode.finishText,
      baselineFinish: rootNode.baselineFinishText, totalFloat: rootNode.totalFloatDays,
    },
    packages: nodes
      .filter(({ n }) => n.level === 1)
      .map(({ n, ownerName }) => ({ code: n.code, name: n.name, position: n.position, added: n.createdAt.getTime() > seedTime, ownerName, scope: n.scope })),
    activities: acts.map(({ a, wbs, ownerCode, ownerInitials, ownerName }) => ({
      id: a.code, wbs, name: a.name, durationDays: a.durationDays,
      start: a.startText, startActual: a.startActual, finish: a.finishText, finishActual: a.finishActual, startDate: a.startDate,
      baselineFinish: a.baselineFinishText, variance: a.varianceDays,
      constraint: constraintText(a.constraintType, a.constraintDateText), violated: a.constraintViolated,
      totalFloat: a.totalFloatDays, pct: a.percentComplete, owner: ownerCode ?? ownerInitials ?? null, ownerName,
      budget: a.budgetKeur, actual: a.actualKeur, eac: a.eacKeur, preds: preds.get(a.id) ?? [],
      isAdded: a.isAdded, edited: !a.isAdded && a.updatedAt.getTime() > a.createdAt.getTime(),
      description: a.description, critical: a.critical, position: a.position,
    })),
    owners: owners.map((o) => ({ code: o.code!, name: o.name ?? o.short, title: o.title ?? '' })),
  };
}

/** DEFS idx of a project (TODO(db): not stored) — else the digit after "A" of its activity ids, else 1. */
function projectIdxOf(code: string, actCodes: string[]): number {
  const idx = PROTO.DEFS?.[code]?.idx;
  if (typeof idx === 'number') return idx;
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

async function deleteActivities(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.update(milestones).set({ activityId: null }).where(inArray(milestones.activityId, ids));
  await tx.delete(activities).where(inArray(activities.id, ids));
}

/** Removes an activity (`rmKey`); its logic links and assignments go with it. */
export async function deleteActivity(code: string, actId: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const a = await findActivity(tx, code, actId);
    if (!a) return false;
    await deleteActivities(tx, [a.id]);
    return true;
  });
}

/**
 * Removes a work package and all its activities (`rmKey` on a WP). Rows of other modules that point at the
 * node (Budget WP lines, change-request WBS, Schedule bars) keep their own code/name and lose only the link.
 */
export async function deleteWorkPackage(code: string, w: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const n = await findNode(tx, code, w);
    if (!n || n.level !== 1) return false;
    await deleteActivities(tx, (await packageActivities(tx, n.id)).map((k) => k.id));
    await tx.update(wpBudgets).set({ wbsNodeId: null }).where(eq(wpBudgets.wbsNodeId, n.id));
    await tx.update(changeRequestWbs).set({ wbsNodeId: null }).where(eq(changeRequestWbs.wbsNodeId, n.id));
    await tx.update(scheduleBars).set({ wbsNodeId: null }).where(eq(scheduleBars.wbsNodeId, n.id));
    await tx.delete(wbsNodes).where(eq(wbsNodes.id, n.id));
    return true;
  });
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

/** Inserts an activity at the end of its work package (positions after it shift by one). */
export async function insertActivity(code: string, input: NewActivity): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const n = await findNode(tx, code, input.wbs);
    if (!n || n.level !== 1) return false;
    const [{ last }] = await tx.select({ last: max(activities.position) }).from(activities).where(eq(activities.wbsNodeId, n.id));
    const position = Math.max(n.position, last ?? n.position) + 1;
    await tx.update(wbsNodes).set({ position: sql`${wbsNodes.position} + 1` }).where(and(eq(wbsNodes.projectId, n.projectId), gte(wbsNodes.position, position)));
    await tx.update(activities).set({ position: sql`${activities.position} + 1` }).where(and(eq(activities.projectId, n.projectId), gte(activities.position, position)));
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

/** Appends a work package after the existing ones (no activities yet). */
export async function insertWorkPackage(code: string, input: NewWorkPackage): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const projectId = await projectIdOf(tx, code);
    if (!projectId) return false;
    const [root] = await tx.select({ id: wbsNodes.id }).from(wbsNodes).where(and(eq(wbsNodes.projectId, projectId), eq(wbsNodes.level, 0)));
    if (!root) return false;
    const [[{ n }], [{ a }]] = await Promise.all([
      tx.select({ n: max(wbsNodes.position) }).from(wbsNodes).where(eq(wbsNodes.projectId, projectId)),
      tx.select({ a: max(activities.position) }).from(activities).where(eq(activities.projectId, projectId)),
    ]);
    const [owner] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.fullName, input.ownerName));
    await tx.insert(wbsNodes).values({
      projectId, code: input.code, name: input.name, level: 1, parentId: root.id, position: Math.max(n ?? 0, a ?? 0) + 1,
      ownerPersonId: owner?.id ?? null, scope: input.scope || null,
    });
    return true;
  });
}

/** OWN key of a full name (INIT_OF), or null. */
export async function ownerCodeOfName(name: string): Promise<string | null> {
  const db = await getDb();
  const [p] = await db.select({ code: persons.ownerCode }).from(persons).where(eq(persons.fullName, name));
  return p?.code ?? null;
}
