import 'server-only';
// Import jobs (chapter 4, S-9 and the Excel / CSV table imports): the staging area of every import — upload → parse →
// (mapping) → preview → explicit confirmation → transactional write. These writers only move the job through its states and
// keep the preview rows; the importers (src/server/interchange) parse files and write the business tables, calling
// `markImportJobApplied` inside their own transaction.
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/server/db/client';
import type { ImportJobStatus, ImportKind, ImportMode, ImportRowAction, ImportRowStatus } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { importJobRows, importJobs, projects } from '@/server/db/schema';

type Q = DB | Tx;

export interface ImportJobView {
  id: string;
  kind: ImportKind;
  mode: ImportMode;
  status: ImportJobStatus;
  projectCode: string | null;
  fileId: string | null;
  fileName: string;
  mapping: Record<string, string | null>;
  options: Record<string, unknown>;
  summary: Record<string, unknown>;
  error: string | null;
  createdByName: string;
  createdAt: Date;
  previewedAt: Date | null;
  appliedAt: Date | null;
  appliedByName: string | null;
  /** Rows per status in the last preview. */
  counts: Record<ImportRowStatus, number>;
}

export interface ImportPreviewRow {
  status: ImportRowStatus;
  action: ImportRowAction;
  key?: string | null;
  data: Record<string, unknown>;
  /** EN source messages. */
  messages?: string[];
}

const toView = (j: typeof importJobs.$inferSelect, projectCode: string | null, counts: Record<ImportRowStatus, number>): ImportJobView => ({
  id: j.id, kind: j.kind, mode: j.mode, status: j.status, projectCode, fileId: j.fileId, fileName: j.fileName, mapping: j.mapping, options: j.options, summary: j.summary,
  error: j.error, createdByName: j.createdByName, createdAt: j.createdAt, previewedAt: j.previewedAt, appliedAt: j.appliedAt, appliedByName: j.appliedByName, counts,
});

async function countsOf(q: Q, jobIds: string[]): Promise<Map<string, Record<ImportRowStatus, number>>> {
  const out = new Map<string, Record<ImportRowStatus, number>>(jobIds.map((id) => [id, { ok: 0, warning: 0, error: 0 }]));
  if (!jobIds.length) return out;
  const rows = await q.select({ job: importJobRows.jobId, status: importJobRows.status }).from(importJobRows).where(inArray(importJobRows.jobId, jobIds));
  for (const r of rows) out.get(r.job)![r.status]++;
  return out;
}

export interface NewImportJob {
  kind: ImportKind;
  mode: ImportMode;
  /** Target project (update, or the project a table import goes to); null for a schedule imported as a new project. */
  projectCode?: string | null;
  fileId?: string | null;
  fileName: string;
  options?: Record<string, unknown>;
  actorName: string;
}

/** Records an uploaded file as a new job (status 'uploaded'). Returns the job id. */
export async function createImportJob(input: NewImportJob, q?: Q): Promise<string> {
  const db = q ?? (await getDb());
  const projectId = input.projectCode ? (await requireProject(db, input.projectCode)).id : null;
  const actor = await findPerson(db, input.actorName);
  const [j] = await db
    .insert(importJobs)
    .values({
      kind: input.kind, mode: input.mode, status: 'uploaded', projectId, fileId: input.fileId ?? null, fileName: input.fileName, options: input.options ?? {},
      createdByPersonId: actor?.id ?? null, createdByName: actor ? nameOf(actor) : input.actorName,
    })
    .returning({ id: importJobs.id });
  return j.id;
}

/** A job with its preview counts; null when unknown. */
export async function getImportJob(id: string, q?: Q): Promise<ImportJobView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = q ?? (await getDb());
  const [r] = await db.select({ j: importJobs, code: projects.code }).from(importJobs).leftJoin(projects, eq(projects.id, importJobs.projectId)).where(eq(importJobs.id, id));
  if (!r) return null;
  return toView(r.j, r.code, (await countsOf(db, [id])).get(id)!);
}

/** Recent jobs, newest first (filters: project, kind, status). */
export async function listImportJobs(filter: { projectCode?: string; kind?: ImportKind; status?: ImportJobStatus; limit?: number } = {}, q?: Q): Promise<ImportJobView[]> {
  const db = q ?? (await getDb());
  const where: SQL[] = [];
  if (filter.projectCode) where.push(eq(projects.code, filter.projectCode));
  if (filter.kind) where.push(eq(importJobs.kind, filter.kind));
  if (filter.status) where.push(eq(importJobs.status, filter.status));
  const rows = await db
    .select({ j: importJobs, code: projects.code })
    .from(importJobs)
    .leftJoin(projects, eq(projects.id, importJobs.projectId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(importJobs.createdAt))
    .limit(filter.limit ?? 50);
  const counts = await countsOf(db, rows.map((r) => r.j.id));
  return rows.map((r) => toView(r.j, r.code, counts.get(r.j.id)!));
}

async function requireOpenJob(q: Q, id: string) {
  const [j] = await q.select().from(importJobs).where(eq(importJobs.id, id));
  if (!j) throw new Error('Unknown import');
  if (j.status === 'applied' || j.status === 'cancelled') throw new Error(`This import is ${j.status === 'applied' ? 'already imported' : 'cancelled'}`);
  return j;
}

/** Saves the column mapping (Excel / CSV: target field → source column) and options; status 'mapped'. */
export async function setImportJobMapping(id: string, mapping: Record<string, string | null>, options?: Record<string, unknown>, q?: Q): Promise<void> {
  const db = q ?? (await getDb());
  const j = await requireOpenJob(db, id);
  await db.update(importJobs).set({ mapping, options: { ...j.options, ...(options ?? {}) }, status: 'mapped' }).where(eq(importJobs.id, id));
}

/** Replaces the preview rows (dry run — nothing else is written); status 'previewed' with the summary. */
export async function saveImportPreview(id: string, rows: ImportPreviewRow[], summary: Record<string, unknown>, q?: Q): Promise<void> {
  const run = async (tx: Q) => {
    await requireOpenJob(tx, id);
    await tx.delete(importJobRows).where(eq(importJobRows.jobId, id));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(importJobRows).values(
        rows.slice(i, i + 500).map((r, k) => ({ jobId: id, position: i + k, status: r.status, action: r.action, key: r.key ?? null, data: r.data, messages: r.messages ?? [] })),
      );
    }
    await tx.update(importJobs).set({ status: 'previewed', summary, previewedAt: new Date(), error: null }).where(eq(importJobs.id, id));
  };
  if (q) return run(q);
  await (await getDb()).transaction(run);
}

/** Preview rows in file order (optionally one status). */
export async function getImportJobRows(id: string, filter: { status?: ImportRowStatus; limit?: number } = {}, q?: Q): Promise<(ImportPreviewRow & { position: number })[]> {
  const db = q ?? (await getDb());
  const rows = await db
    .select()
    .from(importJobRows)
    .where(filter.status ? and(eq(importJobRows.jobId, id), eq(importJobRows.status, filter.status)) : eq(importJobRows.jobId, id))
    .orderBy(asc(importJobRows.position))
    .limit(filter.limit ?? 100_000);
  return rows.map((r) => ({ position: r.position, status: r.status, action: r.action, key: r.key, data: r.data, messages: r.messages }));
}

/**
 * Marks the job imported — call it inside the importer's write transaction, after the business rows. Sets the project (a
 * schedule imported as a new project), the result summary, and writes audit + activity.
 */
export async function markImportJobApplied(id: string, result: { summary: Record<string, unknown>; projectCode?: string | null; actorName: string; activityText?: string }, q: Q): Promise<void> {
  const j = await requireOpenJob(q, id);
  if (j.status !== 'previewed') throw new Error('Preview the import before confirming it');
  const projectId = result.projectCode ? (await requireProject(q, result.projectCode)).id : j.projectId;
  const actor = await findPerson(q, result.actorName);
  const who = actor ? nameOf(actor) : result.actorName;
  await q.update(importJobs).set({ status: 'applied', projectId, summary: { ...j.summary, ...result.summary }, appliedAt: new Date(), appliedByName: who }).where(eq(importJobs.id, id));
  await writeAudit(q, { actorName: who, actorPersonId: actor?.id, objectRef: `Import ${j.fileName}`, change: `${j.kind} imported (${j.mode})`, area: 'Integrations', entityType: 'import_job', entityId: id, projectId });
  await recordActivity(q, { actorName: who, actorPersonId: actor?.id, text: result.activityText ?? `Imported ${j.fileName}`, kind: 'sync', projectId });
}

/** Records a failure (parse error, refused confirmation…) with an EN source message. */
export async function markImportJobFailed(id: string, error: string, q?: Q): Promise<void> {
  const db = q ?? (await getDb());
  await db.update(importJobs).set({ status: 'failed', error }).where(eq(importJobs.id, id));
}

/** Cancels a job that was not imported. */
export async function cancelImportJob(id: string, actorName: string, q?: Q): Promise<void> {
  const db = q ?? (await getDb());
  const j = await requireOpenJob(db, id);
  await db.update(importJobs).set({ status: 'cancelled' }).where(eq(importJobs.id, j.id));
  await writeAudit(db, { actorName, objectRef: `Import ${j.fileName}`, change: 'cancelled', area: 'Integrations', entityType: 'import_job', entityId: id, projectId: j.projectId });
}
