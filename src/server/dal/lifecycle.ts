import 'server-only';
// Lifecycle DAL (docs/spec/03 §5, 01 §11): stage reference (labels, gates, descriptions, deliverables, allowed
// transitions), per-project deliverable checklists and stage history, plus the two lifecycle writes.
// Permission checks and revalidation belong to the calling Server Functions.
import { and, asc, eq, sql } from 'drizzle-orm';
import { cache } from 'react';
import { STATUS_DATE } from '@/lib/format';
import { getDb } from '@/server/db/client';
import {
  displayOfIso, isoOfDisplayDate, nextStageOf, stage as stageCodec,
  type StageCode, type StageGroup, type TransitionMode, type ValidationStatus,
} from '@/server/db/codes';
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
