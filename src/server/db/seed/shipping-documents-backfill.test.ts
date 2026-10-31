// L9-X3 — a demo database seeded before the decision (EXP-01 arrived, nothing filed) gets EXP-01's packing list, CMR and delivery
// note filed in Codex once, at its next opening (seedIfEmpty's demo backfills), through the real filing; never again after that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { codexDocumentOutbox, documentApprovals, documentLinks, documentRevisions, documents, shipmentDocuments, storedFiles } from '@/server/db/schema';
import type { DB } from '@/server/db/types';
import { setFilesRoot } from '@/server/storage/files';
import { seedIfEmpty } from './index';
import { demoShippingDocumentsToBackfill } from './shipments';

let dir: string;
let db: DB;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-l9x3-'));
  setFilesRoot(dir);
  db = await openDatabase();
  setDb(db);
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

const filed = async () => (await db.select({ number: shipmentDocuments.number, kind: shipmentDocuments.kind }).from(shipmentDocuments)).map((r) => `${r.kind} ${r.number}`).sort();

describe('L9-X3 backfill', () => {
  it('a demo database without EXP-01 documents gets them once; then never again', async () => {
    expect(await filed()).toEqual(['cmr SHP-HLT-041', 'delivery_note SHP-HLT-042', 'packing_list SHP-HLT-040']);
    expect(await demoShippingDocumentsToBackfill(db)).toBe(false);
    // As a database seeded before L9-X3 (the SHP type stays: it is never removed once added).
    const ids = (await db.select({ id: documents.id }).from(documents).where(eq(documents.typeCode, 'SHP'))).map((d) => d.id);
    await db.delete(codexDocumentOutbox).where(inArray(codexDocumentOutbox.documentId, ids));
    await db.delete(shipmentDocuments);
    await db.delete(documentApprovals).where(inArray(documentApprovals.documentId, ids));
    await db.delete(documentRevisions).where(inArray(documentRevisions.documentId, ids));
    await db.delete(documentLinks).where(inArray(documentLinks.documentId, ids));
    await db.delete(documents).where(inArray(documents.id, ids));
    await db.delete(storedFiles).where(eq(storedFiles.ownerType, 'shipment_document'));
    expect(await demoShippingDocumentsToBackfill(db)).toBe(true);
    expect(await seedIfEmpty(db)).toBe(false);
    expect(await filed()).toEqual(['cmr SHP-HLT-041', 'delivery_note SHP-HLT-042', 'packing_list SHP-HLT-040']);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(codexDocumentOutbox).where(eq(codexDocumentOutbox.kind, 'deposit'));
    expect(n).toBe(3);
    expect(await demoShippingDocumentsToBackfill(db)).toBe(false);
    await seedIfEmpty(db);
    expect(await filed()).toHaveLength(3);
  });
});
