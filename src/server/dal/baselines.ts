import 'server-only';
// Baselines DAL (chapter 4, S-3): the project's baselines with their activity snapshots, the displayed baseline (Baseline chip,
// stored on the project, BL1 by default — written by schedule.ts showProjectBaseline) and the writers behind "Set baseline",
// the change-request re-baseline and the baseline a change request proposes (src/domain/baseline-policy.ts: after BL1, a new
// baseline goes through a change request; it is filled and made current when the request is approved, dal/changes.ts).
// The Change control register keeps reading `getBaselines` / `getBaselineRegister` (planning.ts, changes-baselines.ts).
import { and, asc, eq, sql } from 'drizzle-orm';
import { baselineNumber, canSnapshotFreely } from '@/domain/baseline-policy';
import { DEFAULT_DISPLAYED_BASELINE, displayedBaselineCode, nextBaselineCode, projectDataDate } from '@/domain/ch4-defaults';
import { getDb, type DB, type Tx } from '@/server/db/client';
import type { BaselineSource, BaselineState } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, baselineActivities, baselines, changeRequests, projects, wbsNodes } from '@/server/db/schema';
import { markBl1Deliverable } from './lifecycle';

type Q = DB | Tx;

export interface BaselineInfo {
  code: string;
  name: string;
  /** ISO; null for a proposed baseline waiting for its change request. */
  setOn: string | null;
  finishDate: string;
  bacKeur: number;
  state: BaselineState;
  source: BaselineSource;
  comment: string | null;
  dataDate: string | null;
  createdByName: string | null;
  /** "CR-009". */
  changeRequest: string | null;
  /** Activities in the snapshot (0 for BL0 / proposed BL2 of the seed). */
  activityCount: number;
  /** Shown by Plan / Schedule. */
  displayed: boolean;
}

export interface BaselineActivityRow {
  activityCode: string;
  /** Null when the activity was removed after the snapshot. */
  activityId: string | null;
  name: string;
  wbsCode: string | null;
  startDate: string | null;
  finishDate: string | null;
  startText: string | null;
  finishText: string | null;
  durationDays: number | null;
  budgetKeur: number | null;
  percentComplete: number | null;
  totalFloatDays: number | null;
}

async function projectHead(q: Q, code: string) {
  const [p] = await q
    .select({ id: projects.id, displayed: projects.displayedBaselineCode, dataDate: projects.dataDate, budget: projects.budgetKeur })
    .from(projects)
    .where(eq(projects.code, code));
  if (!p) throw new Error(`Unknown project ${code}`);
  return p;
}

/** Baselines of a project in register order, with snapshot sizes and the displayed flag. */
export async function listProjectBaselines(code: string, q?: Q): Promise<BaselineInfo[]> {
  const db = q ?? (await getDb());
  const p = await projectHead(db, code);
  const rows = await db
    .select({
      b: baselines, cr: changeRequests.number,
      n: sql<number>`(select count(*)::int from ${baselineActivities} where ${baselineActivities.baselineId} = ${baselines.id})`,
    })
    .from(baselines)
    .leftJoin(changeRequests, eq(changeRequests.id, baselines.changeRequestId))
    .where(eq(baselines.projectId, p.id))
    .orderBy(asc(baselines.position));
  const shown = resolveDisplayed(p.displayed, rows.map((r) => r.b.code));
  return rows.map(({ b, cr, n }) => ({
    code: b.code, name: b.name, setOn: b.setOn, finishDate: b.finishDate, bacKeur: b.bacKeur, state: b.state, source: b.source, comment: b.comment,
    dataDate: b.dataDate, createdByName: b.createdByName, changeRequest: cr, activityCount: n, displayed: b.code === shown,
  }));
}

/** The stored choice when it still exists, else BL1 (S-3 default), else the current baseline, else null. */
function resolveDisplayed(stored: string | null, codes: string[]): string | null {
  const want = displayedBaselineCode({ displayedBaselineCode: stored });
  if (codes.includes(want)) return want;
  if (codes.includes(DEFAULT_DISPLAYED_BASELINE)) return DEFAULT_DISPLAYED_BASELINE;
  return codes[0] ?? null;
}

/** Code of the baseline Plan / Schedule display (null when the project has none). */
export async function getDisplayedBaselineCode(code: string, q?: Q): Promise<string | null> {
  const db = q ?? (await getDb());
  const p = await projectHead(db, code);
  const codes = (await db.select({ code: baselines.code }).from(baselines).where(eq(baselines.projectId, p.id)).orderBy(asc(baselines.position))).map((r) => r.code);
  return resolveDisplayed(p.displayed, codes);
}

/** Activity snapshot of a baseline, in plan order ([] for a baseline without snapshot). */
export async function getBaselineActivities(code: string, baselineCode: string, q?: Q): Promise<BaselineActivityRow[]> {
  const db = q ?? (await getDb());
  const p = await projectHead(db, code);
  const rows = await db
    .select({ r: baselineActivities })
    .from(baselineActivities)
    .innerJoin(baselines, eq(baselines.id, baselineActivities.baselineId))
    .where(and(eq(baselines.projectId, p.id), eq(baselines.code, baselineCode)))
    .orderBy(asc(baselineActivities.position));
  return rows.map(({ r }) => ({
    activityCode: r.activityCode, activityId: r.activityId, name: r.name, wbsCode: r.wbsCode, startDate: r.startDate, finishDate: r.finishDate, startText: r.startText,
    finishText: r.finishText, durationDays: r.durationDays, budgetKeur: r.budgetKeur, percentComplete: r.percentComplete, totalFloatDays: r.totalFloatDays,
  }));
}

/** Snapshot rows of the project's current activities (dates as currently planned / actual). */
async function snapshotRows(tx: Q, projectId: string, baselineId: string) {
  const acts = await tx
    .select({ a: activities, wbs: wbsNodes.code })
    .from(activities)
    .innerJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
    .where(eq(activities.projectId, projectId))
    .orderBy(asc(activities.position));
  return acts.map(({ a, wbs }, position) => ({
    baselineId, activityId: a.id, activityCode: a.code, name: a.name, wbsCode: wbs, startDate: a.startDate, finishDate: a.finishDate, startText: a.startText,
    finishText: a.finishText, durationDays: a.durationDays, budgetKeur: a.budgetKeur, percentComplete: a.percentComplete, totalFloatDays: a.totalFloatDays, position,
  }));
}

export interface SnapshotInput {
  actorName: string;
  /** Default: the new code ("BL3"). */
  name?: string;
  comment?: string | null;
  /** Default 'snapshot' ("Set baseline"); 'change_request' for an approved re-baseline; 'import' for MS Project baselines. */
  source?: BaselineSource;
  /** Default 'proposed' for a snapshot (approval through change control), 'current' when `makeCurrent`. */
  makeCurrent?: boolean;
  changeRequestNumber?: string | null;
  /** Default: the project budget. */
  bacKeur?: number;
  /** Default: the project data date. */
  setOn?: string;
  approverName?: string | null;
  scope?: string | null;
  /**
   * Re-checks the S-3 policy inside the writing transaction (R-010: two simultaneous "Set baseline" at BL0 must not create
   * BL2 without a change request): a snapshot made current, or one without change request, needs the project below BL1;
   * a change request carries one proposed baseline at most. Violations throw BaselinePolicyError.
   */
  enforcePolicy?: boolean;
}

/** S-3 refusal raised inside the snapshot transaction (`SnapshotInput.enforcePolicy`). */
export class BaselinePolicyError extends Error {
  /** `change_request_required`: the project has BL1 already; `already_proposed`: the change request proposes `baseline`. */
  readonly reason: 'change_request_required' | 'already_proposed';
  readonly baseline: string | null;
  constructor(reason: BaselinePolicyError['reason'], baseline: string | null = null) {
    super(reason === 'already_proposed' ? `The change request already proposes ${baseline}` : 'After BL1, a new baseline goes through a change request');
    this.name = 'BaselinePolicyError';
    this.reason = reason;
    this.baseline = baseline;
  }
}

async function supersedeCurrent(tx: Q, projectId: string, exceptId: string): Promise<void> {
  await tx
    .update(baselines)
    .set({ state: 'superseded', updatedAt: new Date() })
    .where(and(eq(baselines.projectId, projectId), eq(baselines.state, 'current'), sql`${baselines.id} <> ${exceptId}`));
}

/**
 * "Set baseline": snapshots every activity of the project into a new baseline BLn (next free number). Its finish is the
 * latest activity finish. Returns the new code. Pass `q` to run inside the caller's transaction.
 */
export async function createBaselineSnapshot(code: string, input: SnapshotInput, q?: Q): Promise<{ code: string; activityCount: number; bl1Ticked?: true }> {
  const run = async (tx: Q) => {
    const proj = await requireProject(tx, code);
    const p = await projectHead(tx, code);
    const existing = await tx
      .select({ code: baselines.code, position: baselines.position, state: baselines.state, changeRequestId: baselines.changeRequestId })
      .from(baselines)
      .where(eq(baselines.projectId, proj.id));
    const blCode = nextBaselineCode(existing.map((b) => b.code));
    const cr = input.changeRequestNumber
      ? (await tx.select({ id: changeRequests.id }).from(changeRequests).where(and(eq(changeRequests.projectId, proj.id), eq(changeRequests.number, input.changeRequestNumber))))[0]
      : null;
    if (input.changeRequestNumber && !cr) throw new Error(`Unknown change request ${input.changeRequestNumber}`);
    if (input.enforcePolicy) {
      const free = canSnapshotFreely(existing.map((b) => b.code));
      if (!free && (input.makeCurrent || !cr)) throw new BaselinePolicyError('change_request_required');
      const taken = cr ? existing.find((b) => b.changeRequestId === cr.id && b.state === 'proposed') : undefined;
      if (taken) throw new BaselinePolicyError('already_proposed', taken.code);
    }
    const actor = await findPerson(tx, input.actorName);
    const approver = input.approverName ? await findPerson(tx, input.approverName) : null;
    const [{ finish }] = await tx.select({ finish: sql<string | null>`max(${activities.finishDate})::text` }).from(activities).where(eq(activities.projectId, proj.id));
    const setOn = input.setOn ?? projectDataDate(p);
    const [b] = await tx
      .insert(baselines)
      .values({
        projectId: proj.id, code: blCode, name: input.name?.trim() || blCode, setOn, bacKeur: input.bacKeur ?? p.budget, finishDate: finish ?? setOn,
        state: input.makeCurrent ? 'current' : 'proposed', changeRequestId: cr?.id ?? null, comment: input.comment?.trim() || null, source: input.source ?? 'snapshot',
        dataDate: projectDataDate(p), createdByPersonId: actor?.id ?? null, createdByName: actor ? nameOf(actor) : input.actorName, approverPersonId: approver?.id ?? null,
        scope: input.scope ?? null, position: Math.max(-1, ...existing.map((e) => e.position)) + 1,
      })
      .returning({ id: baselines.id });
    if (input.makeCurrent) await supersedeCurrent(tx, proj.id, b.id);
    const rows = await snapshotRows(tx, proj.id, b.id);
    if (rows.length) await tx.insert(baselineActivities).values(rows);
    const who = actor ? nameOf(actor) : input.actorName;
    await writeAudit(tx, { actorName: who, actorPersonId: actor?.id, objectRef: `${code} ${blCode}`, change: `baseline set · ${rows.length} activities`, area: 'Planning', entityType: 'baseline', entityId: b.id, projectId: proj.id });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Set baseline ${blCode} · ${rows.length} activities`, kind: 'snapshot', projectId: proj.id });
    // R-054 (L-2 "a"): BL1 (or a later BLn) made current ticks « Planning BL1 posé » — returned, never kept outside (R-010).
    const bl1Ticked = input.makeCurrent && baselineNumber(blCode) >= 1 ? await markBl1Deliverable(tx, proj.id, input.actorName) : false;
    return { code: blCode, activityCount: rows.length, ...(bl1Ticked ? { bl1Ticked: true as const } : {}) };
  };
  if (q) return run(q);
  return (await getDb()).transaction(run);
}

/**
 * Fills (or refills) an existing baseline with the current activities — e.g. BL2 "Pending CR-009" once the change request
 * is approved — and optionally makes it current (the others current become superseded). Stamps setOn with the data date.
 */
export async function snapshotIntoBaseline(code: string, baselineCode: string, input: Omit<SnapshotInput, 'name' | 'changeRequestNumber' | 'source'>, q?: Q): Promise<number> {
  const run = async (tx: Q) => {
    const proj = await requireProject(tx, code);
    const p = await projectHead(tx, code);
    const [b] = await tx.select({ id: baselines.id }).from(baselines).where(and(eq(baselines.projectId, proj.id), eq(baselines.code, baselineCode)));
    if (!b) throw new Error(`Unknown baseline ${baselineCode}`);
    await tx.delete(baselineActivities).where(eq(baselineActivities.baselineId, b.id));
    const rows = await snapshotRows(tx, proj.id, b.id);
    if (rows.length) await tx.insert(baselineActivities).values(rows);
    const [{ finish }] = await tx.select({ finish: sql<string | null>`max(${activities.finishDate})::text` }).from(activities).where(eq(activities.projectId, proj.id));
    const actor = await findPerson(tx, input.actorName);
    await tx
      .update(baselines)
      .set({
        setOn: input.setOn ?? projectDataDate(p), dataDate: projectDataDate(p), ...(finish ? { finishDate: finish } : {}), ...(input.bacKeur != null ? { bacKeur: input.bacKeur } : {}),
        ...(input.makeCurrent ? { state: 'current' as const } : {}), ...(input.comment ? { comment: input.comment } : {}), updatedAt: new Date(),
      })
      .where(eq(baselines.id, b.id));
    if (input.makeCurrent) await supersedeCurrent(tx, proj.id, b.id);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : input.actorName, actorPersonId: actor?.id, objectRef: `${code} ${baselineCode}`, change: `baseline snapshot · ${rows.length} activities${input.makeCurrent ? ' · current' : ''}`,
      area: 'Planning', entityType: 'baseline', entityId: b.id, projectId: proj.id,
    });
    // R-054 (L-2 "a"): a BLn ≥ 1 made current (the change request's re-baseline) ticks « Planning BL1 posé ».
    if (input.makeCurrent && baselineNumber(baselineCode) >= 1) await markBl1Deliverable(tx, proj.id, input.actorName);
    return rows.length;
  };
  if (q) return run(q);
  return (await getDb()).transaction(run);
}

/**
 * The baseline a change request proposes (S-3, after BL1): an empty proposed row BLn linked to the request, like the seed's
 * BL2 "Pending CR-009". The activity snapshot is taken when the request is approved (dal/changes.ts decideChangeStep). Runs in
 * the caller's transaction; returns the new code.
 */
export async function createProposedBaseline(tx: Q, input: { projectId: string; changeRequestId: string; changeRequestNumber: string; actorName: string; comment?: string | null }): Promise<string> {
  const [p] = await tx.select({ budget: projects.budgetKeur, dataDate: projects.dataDate }).from(projects).where(eq(projects.id, input.projectId));
  if (!p) throw new Error('Unknown project');
  const existing = await tx.select({ code: baselines.code, position: baselines.position }).from(baselines).where(eq(baselines.projectId, input.projectId));
  const blCode = nextBaselineCode(existing.map((b) => b.code));
  const [{ finish }] = await tx.select({ finish: sql<string | null>`max(${activities.finishDate})::text` }).from(activities).where(eq(activities.projectId, input.projectId));
  const actor = await findPerson(tx, input.actorName);
  const [b] = await tx
    .insert(baselines)
    .values({
      projectId: input.projectId, code: blCode, name: `${blCode} — ${input.changeRequestNumber}`, setOn: null, bacKeur: p.budget, finishDate: finish ?? projectDataDate(p),
      state: 'proposed', changeRequestId: input.changeRequestId, comment: input.comment?.trim() || null, source: 'change_request', dataDate: null,
      createdByPersonId: actor?.id ?? null, createdByName: actor ? nameOf(actor) : input.actorName, position: Math.max(-1, ...existing.map((e) => e.position)) + 1,
    })
    .returning({ id: baselines.id });
  await writeAudit(tx, {
    actorName: actor ? nameOf(actor) : input.actorName, actorPersonId: actor?.id, objectRef: blCode, change: `baseline proposed by ${input.changeRequestNumber}`,
    area: 'Planning', entityType: 'baseline', entityId: b.id, projectId: input.projectId,
  });
  return blCode;
}

/** Number of activity rows in a baseline's snapshot. */
export async function baselineSnapshotSize(baselineId: string, q?: Q): Promise<number> {
  const db = q ?? (await getDb());
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(baselineActivities).where(eq(baselineActivities.baselineId, baselineId));
  return n;
}
