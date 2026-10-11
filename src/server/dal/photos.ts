import 'server-only';
// Photos stored by Keystone (R-126, X-15 / SC-4a): goods receipts, site daily reports and punch items. The bytes and the
// metadata are the file store's (`stored_files`, purpose `photo`, owner type + id); a receipt photo is also a
// `receipt_attachments` row of kind photo (the receipt's photo count includes it). Callers check the viewer's rights first
// (src/features/photos/access.ts); these writers re-check nothing about people, they record who added / removed (audit).
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { fileSizeText } from '@/domain/ch4-defaults';
import { MAX_PHOTOS_PER_OWNER, type PhotoOwnerKey, type PhotoOwnerKind } from '@/domain/photos';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf } from '@/server/db/helpers';
import { dailyReports, goodsReceipts, projects, punchItems, receiptAttachments, storedFiles } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { checkUpload, deleteStoredFile, readStoredFile, storeFile, type StoredFileMeta } from '@/server/storage/files';
import { trace } from './ops-common';

type Q = DB | Tx;

/** owner_type of the stored files per owner kind. */
export const PHOTO_OWNER_TYPE: Record<PhotoOwnerKind, string> = { goods_receipt: 'goods_receipt_photo', daily_report: 'daily_report_photo', punch_item: 'punch_item_photo' };

export interface PhotoRow {
  /** Stored file id (the image route serves it). */
  id: string;
  name: string;
  sizeText: string;
  uploadedBy: string;
  /** ISO timestamp. */
  uploadedAt: string;
}

interface ResolvedOwner {
  ownerId: string;
  projectId: string;
  /** "BL-2026-0533", "DR-003", "P-04". */
  ref: string;
  /** Audit area. */
  area: string;
}

/** The record a photo belongs to, on that project; null when unknown there. */
export async function resolvePhotoOwner(q: Q, o: PhotoOwnerKey): Promise<ResolvedOwner | null> {
  const [p] = await q.select({ id: projects.id }).from(projects).where(eq(projects.code, o.code));
  if (!p) return null;
  if (o.kind === 'goods_receipt') {
    const [r] = await q.select({ id: goodsReceipts.id }).from(goodsReceipts).where(and(eq(goodsReceipts.number, o.ref), eq(goodsReceipts.projectId, p.id)));
    return r ? { ownerId: r.id, projectId: p.id, ref: o.ref, area: 'Deliveries' } : null;
  }
  if (o.kind === 'daily_report') {
    const [r] = await q.select({ id: dailyReports.id }).from(dailyReports).where(and(eq(dailyReports.number, o.ref), eq(dailyReports.projectId, p.id)));
    return r ? { ownerId: r.id, projectId: p.id, ref: o.ref, area: 'Site' } : null;
  }
  const [r] = await q.select({ id: punchItems.id }).from(punchItems)
    .where(and(eq(punchItems.number, o.ref), eq(punchItems.projectId, p.id), eq(punchItems.register, o.register === 'site' ? 'site' : 'itp')));
  return r ? { ownerId: r.id, projectId: p.id, ref: o.ref, area: 'Punch list' } : null;
}

const rowOf = (f: Pick<StoredFileMeta, 'id' | 'name' | 'sizeBytes' | 'createdByName' | 'createdAt'>): PhotoRow => ({
  id: f.id, name: f.name, sizeText: fileSizeText(f.sizeBytes), uploadedBy: f.createdByName, uploadedAt: f.createdAt.toISOString(),
});

/** Photos of every record of one kind on a project, by record number (upload order). Punch items: one register. */
export async function listProjectPhotos(projectCode: string, kind: PhotoOwnerKind, register?: 'itp' | 'site'): Promise<Map<string, PhotoRow[]>> {
  const db = await getDb();
  const out = new Map<string, PhotoRow[]>();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return out;
  const owners =
    kind === 'goods_receipt'
      ? await db.select({ id: goodsReceipts.id, ref: goodsReceipts.number }).from(goodsReceipts).where(eq(goodsReceipts.projectId, p.id))
      : kind === 'daily_report'
        ? await db.select({ id: dailyReports.id, ref: dailyReports.number }).from(dailyReports).where(eq(dailyReports.projectId, p.id))
        : await db.select({ id: punchItems.id, ref: punchItems.number }).from(punchItems).where(and(eq(punchItems.projectId, p.id), eq(punchItems.register, register ?? 'itp')));
  if (!owners.length) return out;
  const refOf = new Map(owners.map((o) => [o.id, o.ref]));
  const files = await db.select().from(storedFiles)
    .where(and(eq(storedFiles.purpose, 'photo'), eq(storedFiles.ownerType, PHOTO_OWNER_TYPE[kind]), inArray(storedFiles.ownerId, owners.map((o) => o.id))))
    .orderBy(asc(storedFiles.createdAt));
  for (const f of files) {
    const ref = refOf.get(f.ownerId!);
    if (ref) out.set(ref, [...(out.get(ref) ?? []), rowOf(f)]);
  }
  return out;
}

/** Photos counted on a receipt without a stored file (the seed's "3 attached", taken on mobile before Keystone stored them). */
export async function legacyReceiptPhotoCount(receiptNumber: string): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(receiptAttachments).innerJoin(goodsReceipts, eq(goodsReceipts.id, receiptAttachments.receiptId))
    .where(and(eq(goodsReceipts.number, receiptNumber), eq(receiptAttachments.kind, 'photo'), sql`${receiptAttachments.fileId} is null`));
  return r?.n ?? 0;
}

/**
 * Stores a photo for a record (size, type and content checked by the file store) and records it — a receipt photo also as a
 * receipt attachment — with the audit entry, in one transaction. Refused beyond MAX_PHOTOS_PER_OWNER. Returns the file id.
 */
export async function addPhoto(o: PhotoOwnerKey, file: { name: string; data: Uint8Array | ArrayBuffer } | File, actorName: string): Promise<string> {
  const data = file instanceof File ? (checkUpload('photo', file.name, file.size), new Uint8Array(await file.arrayBuffer())) : file.data;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const owner = await resolvePhotoOwner(tx, o);
    if (!owner) throw new Error(`Unknown ${o.kind} ${o.ref} on ${o.code}`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(storedFiles)
      .where(and(eq(storedFiles.ownerType, PHOTO_OWNER_TYPE[o.kind]), eq(storedFiles.ownerId, owner.ownerId)));
    if (n >= MAX_PHOTOS_PER_OWNER) throw new Error(`At most ${MAX_PHOTOS_PER_OWNER} photos`);
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const meta = await storeFile({ purpose: 'photo', name: file.name, data, projectId: owner.projectId, ownerType: PHOTO_OWNER_TYPE[o.kind], ownerId: owner.ownerId, actor: { name: who, personId: actor?.id } }, tx);
    if (o.kind === 'goods_receipt') {
      const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${receiptAttachments.position}), -1)::int` }).from(receiptAttachments).where(eq(receiptAttachments.receiptId, owner.ownerId));
      await tx.insert(receiptAttachments).values({ receiptId: owner.ownerId, kind: 'photo', fileName: meta.name, storageRef: meta.id, fileId: meta.id, addedByPersonId: actor?.id ?? null, position: pos + 1 });
    }
    await trace(tx, { personId: actor?.id ?? null, who }, { objectRef: owner.ref, change: `photo added: ${meta.name}`, area: owner.area, entityType: o.kind, entityId: owner.ownerId, projectId: owner.projectId });
    return meta.id;
  });
}

/** The record a stored photo belongs to (kind, project code, number, register); null when it is not a photo of a known record. */
export async function photoOwnerOf(fileId: string): Promise<PhotoOwnerKey | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const db = await getDb();
  const [f] = await db.select({ ownerType: storedFiles.ownerType, ownerId: storedFiles.ownerId, purpose: storedFiles.purpose }).from(storedFiles).where(eq(storedFiles.id, fileId));
  if (!f || f.purpose !== 'photo' || !f.ownerId) return null;
  const kind = (Object.entries(PHOTO_OWNER_TYPE).find(([, v]) => v === f.ownerType)?.[0] ?? null) as PhotoOwnerKind | null;
  if (kind === 'goods_receipt') {
    const [r] = await db.select({ ref: goodsReceipts.number, code: projects.code }).from(goodsReceipts).innerJoin(projects, eq(projects.id, goodsReceipts.projectId)).where(eq(goodsReceipts.id, f.ownerId));
    return r ? { kind, code: r.code, ref: r.ref } : null;
  }
  if (kind === 'daily_report') {
    const [r] = await db.select({ ref: dailyReports.number, code: projects.code }).from(dailyReports).innerJoin(projects, eq(projects.id, dailyReports.projectId)).where(eq(dailyReports.id, f.ownerId));
    return r ? { kind, code: r.code, ref: r.ref } : null;
  }
  if (kind === 'punch_item') {
    const [r] = await db.select({ ref: punchItems.number, code: projects.code, register: punchItems.register }).from(punchItems).innerJoin(projects, eq(projects.id, punchItems.projectId)).where(eq(punchItems.id, f.ownerId));
    return r ? { kind, code: r.code, ref: r.ref, register: r.register } : null;
  }
  return null;
}

/** Bytes and metadata of a stored photo (the caller checked the viewer may see its record). */
export async function readPhoto(fileId: string) {
  return readStoredFile(fileId);
}

/** Removes a photo (the stored file, and the receipt attachment row), audited. */
export async function removePhoto(fileId: string, actorName: string): Promise<void> {
  const o = await photoOwnerOf(fileId);
  if (!o) throw new Error('Unknown photo');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const owner = await resolvePhotoOwner(tx, o);
    if (!owner) throw new Error('Unknown photo');
    const [f] = await tx.select({ name: storedFiles.name }).from(storedFiles).where(eq(storedFiles.id, fileId));
    if (o.kind === 'goods_receipt') await tx.delete(receiptAttachments).where(eq(receiptAttachments.fileId, fileId));
    await deleteStoredFile(fileId, tx);
    const actor = await findPerson(tx, actorName);
    await trace(tx, { personId: actor?.id ?? null, who: actor ? nameOf(actor) : actorName }, {
      objectRef: owner.ref, change: `photo removed: ${f?.name ?? fileId}`, area: owner.area, entityType: o.kind, entityId: owner.ownerId, projectId: owner.projectId,
    });
  });
}
