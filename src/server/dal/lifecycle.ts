import 'server-only';
// Lifecycle DAL (docs/spec/03 §5, 01 §11): stage reference (labels, gates, descriptions, deliverables, allowed
// transitions), per-project deliverable checklists and stage history, plus the lifecycle writes (stage moves, deliverable
// ticks and — chapter 4, L-1 — the portfolio director's validation of forced stage changes).
// Permission checks and revalidation belong to the calling Server Functions.
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { cache } from 'react';
import type { RoleKey } from '@/config/screens';
import { REVERT_BLOCKER_MESSAGE, isForcedStageDecider, revertBlocker, revertReason, FORCED_STAGE_COMMENT_MAX } from '@/domain/forced-stage';
import { STATUS_DATE } from '@/lib/format';
import { getDb } from '@/server/db/client';
import {
  displayOfIso, isoOfDisplayDate, nextStageOf, stage as stageCodec,
  type StageCode, type StageGroup, type TransitionMode, type ValidationStatus,
} from '@/server/db/codes';
import { actorOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { lifecycleStages, lifecycleTransitions, persons, projects, stageDeliverableChecks, stageDeliverableDefs, stageTransitions } from '@/server/db/schema';

export interface StageInfo {
  code: StageCode;
  /** Prototype value (French domain label): "Fabrication & Assemblage". */
  label: string;
  /** Slider label (ST_SHORT): "Fab.". */
  short: string;
  /** 1–12 in STAGE_ORDER; null for Annulé. */
  seq: number | null;
  group: StageGroup;
  /** LIFE (French). */
  description: string;
  /** GATES (French) — entry gate; null for Initiative. */
  gate: string | null;
  /** STAGE_DELIVS (French). */
  deliverables: string[];
  /** Allowed targets (TRANS): next stage and/or Annulé. */
  next: StageCode[];
}

/** The 13 stages in STATUSES order. Memoised per request. */
export const listStages = cache(async (): Promise<StageInfo[]> => {
  const db = await getDb();
  const [stages, defs, trans] = await Promise.all([
    db.select().from(lifecycleStages).orderBy(asc(lifecycleStages.sortOrder)),
    db.select().from(stageDeliverableDefs).orderBy(asc(stageDeliverableDefs.position)),
    db.select().from(lifecycleTransitions).orderBy(asc(lifecycleTransitions.sortOrder)),
  ]);
  return stages.map((s) => ({
    code: s.code, label: s.label, short: s.shortLabel, seq: s.seq, group: s.group, description: s.description, gate: s.entryGate,
    deliverables: defs.filter((d) => d.stage === s.code).map((d) => d.label),
    next: trans.filter((t) => t.fromStage === s.code).map((t) => t.toStage),
  }));
});

/** Deliverable ticks of a project for every stage that has deliverables (unticked when never recorded). */
export async function getStageChecklist(projectCode: string): Promise<Record<StageCode, boolean[]>> {
  const db = await getDb();
  const [stages, done] = await Promise.all([
    listStages(),
    db
      .select({ stage: stageDeliverableDefs.stage, position: stageDeliverableDefs.position, done: stageDeliverableChecks.done })
      .from(stageDeliverableChecks)
      .innerJoin(projects, eq(projects.id, stageDeliverableChecks.projectId))
      .innerJoin(stageDeliverableDefs, eq(stageDeliverableDefs.id, stageDeliverableChecks.deliverableId))
      .where(eq(projects.code, projectCode)),
  ]);
  const out = {} as Record<StageCode, boolean[]>;
  for (const s of stages) out[s.code] = s.deliverables.map((_, i) => done.some((d) => d.stage === s.code && d.position === i && d.done));
  return out;
}

/** Unticked deliverables of a stage (missingOf 3920). */
export async function getMissingDeliverables(projectCode: string, stage: StageCode): Promise<string[]> {
  const [stages, checklist] = await Promise.all([listStages(), getStageChecklist(projectCode)]);
  const s = stages.find((x) => x.code === stage);
  return (s?.deliverables ?? []).filter((_, i) => !checklist[stage]?.[i]);
}

export interface StageHistoryRow {
  stage: StageCode;
  /** Prototype label of the stage entered. */
  label: string;
  from: StageCode | null;
  /** "12 Jan 2026" (English month; translate with t()). */
  date: string;
  dateIso: string;
  mode: TransitionMode;
  /** '' for auto moves. */
  reason: string;
  missing: string[];
  requestedBy: string | null;
  validationStatus: ValidationStatus | null;
}

const historySelect = {
  code: projects.code,
  t: stageTransitions,
  requestedBy: persons.shortName,
};

function toHistory(t: typeof stageTransitions.$inferSelect, requestedBy: string | null): StageHistoryRow {
  return {
    stage: t.toStage, label: stageCodec.label(t.toStage), from: t.fromStage, date: displayOfIso(t.effectiveOn), dateIso: t.effectiveOn,
    mode: t.mode, reason: t.reason ?? '', missing: t.missingDeliverables ?? [], requestedBy, validationStatus: t.validationStatus,
  };
}

/** Stage history of a project, chronological (the UI lists it newest first). */
export async function getStageHistory(projectCode: string): Promise<StageHistoryRow[]> {
  return (await listStageHistory())[projectCode] ?? [];
}

/** Stage history of every project, keyed by project code (chronological). Memoised per request. */
export const listStageHistory = cache(async (): Promise<Record<string, StageHistoryRow[]>> => {
  const db = await getDb();
  const rows = await db
    .select(historySelect)
    .from(stageTransitions)
    .innerJoin(projects, eq(projects.id, stageTransitions.projectId))
    .leftJoin(persons, eq(persons.id, stageTransitions.requestedByPersonId))
    .orderBy(asc(projects.sortOrder), asc(stageTransitions.seq));
  const out: Record<string, StageHistoryRow[]> = {};
  for (const r of rows) (out[r.code] ??= []).push(toHistory(r.t, r.requestedBy));
  return out;
});

/** Status date of the frozen data set as ISO ('2026-09-25'): the date stamped on stage changes. */
const STATUS_ISO = isoOfDisplayDate(STATUS_DATE)!;

/**
 * Moves a project to `to` (advance 3922): sets the stage, clears the "New" flag and appends a history entry
 * dated at the status date. Forced moves keep the reason and the missing deliverables, and are left pending
 * validation by the portfolio director (OPEN QUESTION L-1). Does not check TRANS — the caller does.
 */
export async function recordStageChange(
  projectCode: string,
  to: StageCode,
  mode: TransitionMode,
  opts: { reason?: string; missing?: string[]; requestedByShortName?: string; effectiveOn?: string } = {},
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id, stage: projects.stage }).from(projects).where(eq(projects.code, projectCode));
    if (!p) throw new Error(`Unknown project ${projectCode}`);
    const [{ seq }] = await tx
      .select({ seq: sql<number>`coalesce(max(${stageTransitions.seq}), 0)::int` })
      .from(stageTransitions)
      .where(eq(stageTransitions.projectId, p.id));
    const [by] = opts.requestedByShortName
      ? await tx.select({ id: persons.id }).from(persons).where(eq(persons.shortName, opts.requestedByShortName))
      : [];
    await tx.insert(stageTransitions).values({
      projectId: p.id, seq: seq + 1, fromStage: p.stage, toStage: to, effectiveOn: opts.effectiveOn ?? STATUS_ISO, mode,
      reason: opts.reason?.trim() || null, missingDeliverables: mode === 'forced' ? (opts.missing ?? []) : null,
      requestedByPersonId: by?.id ?? null, validationStatus: mode === 'forced' ? 'pending' : null,
    });
    await tx.update(projects).set({ stage: to, isNew: false, updatedAt: new Date() }).where(eq(projects.id, p.id));
  });
}

/** Ticks / unticks one stage deliverable (by its index in STAGE_DELIVS[stage]). */
export async function setStageDeliverable(projectCode: string, stage: StageCode, position: number, done: boolean): Promise<void> {
  const db = await getDb();
  const [[p], [d]] = await Promise.all([
    db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode)),
    db.select({ id: stageDeliverableDefs.id }).from(stageDeliverableDefs).where(and(eq(stageDeliverableDefs.stage, stage), eq(stageDeliverableDefs.position, position))),
  ]);
  if (!p || !d) throw new Error(`Unknown project ${projectCode} or deliverable ${stage}#${position}`);
  await db
    .insert(stageDeliverableChecks)
    .values({ projectId: p.id, deliverableId: d.id, done, doneAt: done ? new Date() : null })
    .onConflictDoUpdate({
      target: [stageDeliverableChecks.projectId, stageDeliverableChecks.deliverableId],
      set: { done, doneAt: done ? new Date() : null },
    });
}

/**
 * Prototype toggleDeliv (3923): flips a deliverable; when this completes the project's current stage and a next
 * stage exists, the project auto-advances (history mode 'auto'). Returns the stage entered, if any.
 */
export async function toggleStageDeliverable(projectCode: string, stage: StageCode, position: number): Promise<StageCode | null> {
  const before = await getStageChecklist(projectCode);
  const done = !before[stage]?.[position];
  await setStageDeliverable(projectCode, stage, position, done);
  const after = await getStageChecklist(projectCode);
  const db = await getDb();
  const [p] = await db.select({ stage: projects.stage }).from(projects).where(eq(projects.code, projectCode));
  const next = nextStageOf(stage);
  if (p?.stage === stage && next && after[stage].every(Boolean)) {
    await recordStageChange(projectCode, next, 'auto');
    return next;
  }
  return null;
}

// ── Forced stage changes: the portfolio director's validation (chapter 4, L-1 — rules in src/domain/forced-stage.ts) ──

export interface PendingForcedTransition {
  /** stage_transitions.id — what the decision names. */
  id: string;
  projectCode: string;
  projectName: string;
  /** Stage the project left (null only for a project's first move) and its prototype label. */
  fromStage: StageCode | null;
  fromLabel: string | null;
  /** Stage the project was forced into. */
  stage: StageCode;
  stageLabel: string;
  reason: string | null;
  effectiveOn: string;
  /** Full name of whoever forced it (null when unknown). */
  requestedBy: string | null;
  /** Full name of the project manager. */
  pm: string | null;
}

/** Forced stage changes waiting for the portfolio director, oldest first (My approvals "Forced stage change"). */
export async function listPendingForcedTransitions(): Promise<PendingForcedTransition[]> {
  const db = await getDb();
  const req = alias(persons, 'req');
  const pm = alias(persons, 'pm');
  const rows = await db
    .select({ t: stageTransitions, code: projects.code, name: projects.name, reqFull: req.fullName, reqShort: req.shortName, pmFull: pm.fullName, pmShort: pm.shortName })
    .from(stageTransitions)
    .innerJoin(projects, eq(projects.id, stageTransitions.projectId))
    .leftJoin(req, eq(req.id, stageTransitions.requestedByPersonId))
    .leftJoin(pm, eq(pm.id, projects.pmPersonId))
    .where(and(eq(stageTransitions.mode, 'forced'), eq(stageTransitions.validationStatus, 'pending')))
    .orderBy(asc(stageTransitions.createdAt), asc(stageTransitions.seq));
  return rows.map((r) => ({
    id: r.t.id, projectCode: r.code, projectName: r.name, fromStage: r.t.fromStage, fromLabel: r.t.fromStage ? stageCodec.label(r.t.fromStage) : null,
    stage: r.t.toStage, stageLabel: stageCodec.label(r.t.toStage), reason: r.t.reason, effectiveOn: r.t.effectiveOn,
    requestedBy: r.reqShort ? (r.reqFull ?? r.reqShort) : null, pm: r.pmShort ? (r.pmFull ?? r.pmShort) : null,
  }));
}

/** Forced stage changes decided by this person (approved or rejected) — My approvals "Decided this week". */
export async function countForcedStageDecisions(actorName: string): Promise<number> {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stageTransitions)
    .innerJoin(persons, eq(persons.id, stageTransitions.validatedByPersonId))
    .where(and(eq(stageTransitions.mode, 'forced'), sql`${stageTransitions.validationStatus} in ('approved', 'rejected')`, sql`(${persons.fullName} = ${actorName} or ${persons.shortName} = ${actorName})`));
  return r?.n ?? 0;
}

/** A decision that cannot be recorded: `stale` (already decided / unknown), `moved_on` / `no_previous` (Reject cannot revert), `not_allowed`. */
export class StageDecisionError extends Error {
  readonly code: 'stale' | 'moved_on' | 'no_previous' | 'not_allowed';
  constructor(code: StageDecisionError['code'], message: string) {
    super(message);
    this.name = 'StageDecisionError';
    this.code = code;
  }
}

export interface ForcedStageDecision {
  projectCode: string;
  decision: 'approved' | 'rejected';
  /** The forced move. */
  from: StageCode | null;
  to: StageCode;
  /** Stage of the project after the decision (the forced one when approved, the one it left when rejected). */
  stage: StageCode;
  /** Who forced it and the PM (full names; notification recipients). */
  requestedBy: string | null;
  pm: string | null;
  actorName: string;
}

/**
 * The portfolio director approves or rejects a pending forced stage change (L-1). Approve keeps the stage; Reject puts
 * the project back in the stage it left through a 'revert' history row (only while the forced move is the project's
 * last one and the project still stands in that stage). The decider must hold a decider role (FORCED_STAGE_DECIDER_ROLES);
 * the decision, the comment, the decider and the time are kept on the forced row; audited and written to the feed.
 * Throws StageDecisionError when the decision cannot be recorded.
 */
export async function decideForcedStageChange(
  projectCode: string,
  transitionId: string,
  decision: 'approved' | 'rejected',
  opts: { actorName: string; comment?: string | null; effectiveOn?: string },
): Promise<ForcedStageDecision> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const req = alias(persons, 'req');
    const pm = alias(persons, 'pm');
    const [row] = await tx
      .select({ t: stageTransitions, p: { id: projects.id, code: projects.code, stage: projects.stage }, reqFull: req.fullName, reqShort: req.shortName, pmFull: pm.fullName, pmShort: pm.shortName })
      .from(stageTransitions)
      .innerJoin(projects, eq(projects.id, stageTransitions.projectId))
      .leftJoin(req, eq(req.id, stageTransitions.requestedByPersonId))
      .leftJoin(pm, eq(pm.id, projects.pmPersonId))
      .where(and(eq(stageTransitions.id, transitionId), eq(projects.code, projectCode)));
    if (!row || row.t.mode !== 'forced' || row.t.validationStatus !== 'pending') throw new StageDecisionError('stale', 'This decision is not waiting for you any more');
    const actor = await actorOf(tx, opts.actorName);
    if (!actor.personId || !actor.roles.some((r) => isForcedStageDecider(r as RoleKey))) {
      throw new StageDecisionError('not_allowed', 'Only the portfolio director validates forced stage changes');
    }
    const t = row.t;
    const comment = (opts.comment ?? '').trim().slice(0, FORCED_STAGE_COMMENT_MAX) || null;
    const at = new Date();
    let stage: StageCode = t.toStage;
    if (decision === 'rejected') {
      const [{ lastSeq }] = await tx.select({ lastSeq: sql<number>`coalesce(max(${stageTransitions.seq}), 0)::int` }).from(stageTransitions).where(eq(stageTransitions.projectId, row.p.id));
      const blocker = revertBlocker(t, { stage: row.p.stage, lastSeq });
      if (blocker) throw new StageDecisionError(blocker, REVERT_BLOCKER_MESSAGE[blocker]);
      stage = t.fromStage!;
      await tx.insert(stageTransitions).values({
        projectId: row.p.id, seq: lastSeq + 1, fromStage: t.toStage, toStage: stage, effectiveOn: opts.effectiveOn ?? STATUS_ISO, mode: 'revert',
        reason: revertReason(comment), requestedByPersonId: actor.personId, revertsTransitionId: t.id,
      });
      await tx.update(projects).set({ stage, updatedAt: at }).where(eq(projects.id, row.p.id));
    }
    await tx
      .update(stageTransitions)
      .set({ validationStatus: decision, validatedByPersonId: actor.personId, validatedAt: at, decisionComment: comment })
      .where(eq(stageTransitions.id, t.id));
    const move = `${t.fromStage ? stageCodec.label(t.fromStage) : '—'} → ${stageCodec.label(t.toStage)}`;
    await writeAudit(tx, {
      actorName: actor.name, actorPersonId: actor.personId, objectRef: `${projectCode} stage`,
      change: decision === 'approved'
        ? `forced stage change approved: ${move}${comment ? ` — ${comment}` : ''}`
        : `forced stage change rejected: ${move} · reverted to ${stageCodec.label(stage)}${comment ? ` — ${comment}` : ''}`,
      area: 'Lifecycle', entityType: 'stage_transition', entityId: t.id, projectId: row.p.id, occurredAt: at,
    });
    await recordActivity(tx, {
      actorName: actor.name, actorPersonId: actor.personId, kind: 'change', projectId: row.p.id, occurredAt: at,
      text: decision === 'approved'
        ? `Approved the forced stage change of ${projectCode} → ${stageCodec.label(t.toStage)}`
        : `Rejected the forced stage change of ${projectCode} → ${stageCodec.label(t.toStage)} · back to ${stageCodec.label(stage)}`,
    });
    return {
      projectCode, decision, from: t.fromStage, to: t.toStage, stage,
      requestedBy: row.reqShort ? (row.reqFull ?? row.reqShort) : null, pm: row.pmShort ? (row.pmFull ?? row.pmShort) : null, actorName: actor.name,
    };
  });
}
