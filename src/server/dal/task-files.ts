import 'server-only';
// Task attachments with stored files (chapter 4, R-8 "Attach"): files are kept by Keystone (src/server/storage), not Codex.
// The seed's FILES rows have no content (`hasFile` false). Server Functions check that the viewer may edit the task.
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { MAX_ATTACHMENTS_PER_TASK, fileSizeText } from '@/domain/ch4-defaults';
import { getDb } from '@/server/db/client';
import { ATTACHMENT_ICON, STATUS_ISO, type AttachmentKind } from '@/server/db/codes';
import { findPerson, nameOf, writeAudit } from '@/server/db/helpers';
import { persons, taskAttachments, tasks } from '@/server/db/schema';
import { checkUpload, deleteStoredFile, extensionOf, readStoredFile, setFileOwner, storeFile, type BlockedStoredFile, type StoredFileMeta } from '@/server/storage/files';
import { scanUpload } from '@/server/storage/scan';

export interface TaskFileRow {
  /** Attachment id (task_attachments.id). */
  id: string;
  name: string;
  sizeText: string;
  sizeBytes: number | null;
  mime: string | null;
  kind: AttachmentKind;
  icon: string;
  uploadedBy: string | null;
  uploadedOn: string;
  /** The content is stored (download / delete possible); false for the seed's FILES rows. */
  hasFile: boolean;
}

/** Attachment kind (icon) of a file name. */
export function attachmentKindOf(name: string): AttachmentKind {
  const ext = extensionOf(name);
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'xls';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'txt'].includes(ext)) return 'doc';
  return 'other';
}

async function taskOf(number: string) {
  const db = await getDb();
  const [t] = await db.select({ id: tasks.id, number: tasks.number, projectId: tasks.projectId }).from(tasks).where(eq(tasks.number, number));
  if (!t) throw new Error(`Unknown task ${number}`);
  return t;
}

/** Attachments of a task in upload order. */
export async function listTaskFiles(number: string): Promise<TaskFileRow[]> {
  const t = await taskOf(number);
  const db = await getDb();
  const up = alias(persons, 'uploader');
  const rows = await db
    .select({ f: taskAttachments, short: up.shortName })
    .from(taskAttachments)
    .leftJoin(up, eq(up.id, taskAttachments.uploadedByPersonId))
    .where(eq(taskAttachments.taskId, t.id))
    .orderBy(asc(taskAttachments.position));
  return rows.map(({ f, short }) => ({
    id: f.id, name: f.name, sizeText: f.sizeText, sizeBytes: f.sizeBytes, mime: f.mime, kind: f.kind, icon: ATTACHMENT_ICON[f.kind], uploadedBy: short,
    uploadedOn: f.uploadedOn, hasFile: !!f.fileId,
  }));
}

/**
 * Attaches a file to a task: checks size / type (storage limits), the antivirus verdict (R-175, before the transaction) and
 * the per-task limit, stores the bytes, records the attachment ("48 KB · H. Sauvage · today", dated the status date) and the
 * audit entry. Returns the attachment id.
 */
export async function attachTaskFile(number: string, file: { name: string; data: Uint8Array | ArrayBuffer } | File, actorName: string): Promise<string> {
  const t = await taskOf(number);
  const db = await getDb();
  const name = file.name;
  const raw = file instanceof File ? (checkUpload('attachment', file.name, file.size), new Uint8Array(await file.arrayBuffer())) : file.data;
  checkUpload('attachment', name, raw.byteLength);
  const actorRow = await findPerson(db, actorName);
  const data = await scanUpload(raw, { purpose: 'attachment', name, actor: { name: actorRow ? nameOf(actorRow) : actorName, personId: actorRow?.id }, objectRef: t.number, projectId: t.projectId });
  return db.transaction(async (tx) => {
    const [{ n, pos }] = await tx
      .select({ n: sql<number>`count(*)::int`, pos: sql<number>`coalesce(max(${taskAttachments.position}), -1)::int` })
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, t.id));
    if (n >= MAX_ATTACHMENTS_PER_TASK) throw new Error(`A task holds at most ${MAX_ATTACHMENTS_PER_TASK} files`);
    const actor = await findPerson(tx, actorName);
    const meta: StoredFileMeta = await storeFile({ purpose: 'attachment', name, data, projectId: t.projectId, ownerType: 'task_attachment', actor: { name: actor ? nameOf(actor) : actorName, personId: actor?.id } }, tx);
    const [a] = await tx
      .insert(taskAttachments)
      .values({
        taskId: t.id, name: meta.name, sizeText: fileSizeText(meta.sizeBytes), uploadedByPersonId: actor?.id ?? null, uploadedOn: STATUS_ISO, kind: attachmentKindOf(meta.name),
        storageRef: meta.id, fileId: meta.id, mime: meta.mime, sizeBytes: meta.sizeBytes, position: pos + 1,
      })
      .returning({ id: taskAttachments.id });
    await setFileOwner(meta.id, { ownerType: 'task_attachment', ownerId: a.id }, tx);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: t.number, change: `file attached: ${meta.name}`, area: 'Tasks', entityType: 'task', entityId: t.id, projectId: t.projectId });
    return a.id;
  });
}

/** Content of an attachment of the task (download); `{ blocked: true }` when the antivirus flagged it (R-175); null when unknown or without stored content. */
export async function getTaskFile(number: string, attachmentId: string): Promise<{ blocked?: false; meta: StoredFileMeta; data: Buffer } | BlockedStoredFile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
  const t = await taskOf(number);
  const db = await getDb();
  const [a] = await db.select({ fileId: taskAttachments.fileId }).from(taskAttachments).where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.taskId, t.id)));
  return a?.fileId ? readStoredFile(a.fileId) : null;
}

/** Removes an attachment and its stored file (audited). */
export async function removeTaskFile(number: string, attachmentId: string, actorName: string): Promise<void> {
  const t = await taskOf(number);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(taskAttachments).where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.taskId, t.id)));
    if (!a) throw new Error('Unknown attachment');
    await tx.delete(taskAttachments).where(eq(taskAttachments.id, a.id));
    if (a.fileId) await deleteStoredFile(a.fileId, tx);
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: t.number, change: `file removed: ${a.name}`, area: 'Tasks', entityType: 'task', entityId: t.id, projectId: t.projectId });
  });
}
