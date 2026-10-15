import 'server-only';
// Outbox of the decisions recorded in Keystone for Codex (schema/documents.ts `codex_document_outbox`; Delivery 7,
// R-124 / R-106). The documents DAL queues entries (circuit step decisions, engineering circuit starts); the connector
// delivers them (connector.ts) and the index refresh closes the ones Codex reflects (mirror.ts). Entries never change
// the index record itself.
import { and, asc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import type { CodexEntryLike } from '@/domain/codex-approvals';
import type { ApproverRole, CodexDecision, CodexOutboxKind, CodexSyncStatus } from '@/server/db/codes';
import { codexDocumentOutbox } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { claimExpiry } from '../outbox';

type Q = DB | Tx;

export interface CodexOutboxEntry extends CodexEntryLike {
  id: string;
  documentId: string;
  documentNumber: string;
  role: ApproverRole | null;
  comment: string | null;
  actorRole: string;
  attempts: number;
  lastError: string | null;
  codexRef: string | null;
}

const entryOf = (r: typeof codexDocumentOutbox.$inferSelect): CodexOutboxEntry => ({
  id: r.id, documentId: r.documentId, documentNumber: r.documentNumber, revision: r.revision, kind: r.kind, stepPosition: r.stepPosition, role: r.role,
  decision: r.decision, comment: r.comment, actorName: r.actorName, actorRole: r.actorRole, recordedAt: r.recordedAt.toISOString(), syncStatus: r.syncStatus,
  attempts: r.attempts, lastError: r.lastError, codexRef: r.codexRef,
});

export interface NewCodexEntry {
  documentId: string;
  documentNumber: string;
  revision: string;
  kind: CodexOutboxKind;
  stepPosition?: number | null;
  role?: ApproverRole | null;
  decision?: CodexDecision | null;
  comment?: string | null;
  actorName: string;
  actorPersonId: string | null;
  actorRole: string;
  recordedAt: Date;
}

/** Queues an entry, "pending sync with Codex". */
export async function insertCodexEntry(q: Q, e: NewCodexEntry): Promise<CodexOutboxEntry> {
  const [row] = await q
    .insert(codexDocumentOutbox)
    .values({
      documentId: e.documentId, documentNumber: e.documentNumber, revision: e.revision, kind: e.kind, stepPosition: e.stepPosition ?? null, role: e.role ?? null,
      decision: e.decision ?? null, comment: e.comment ?? null, actorName: e.actorName, actorPersonId: e.actorPersonId, actorRole: e.actorRole, recordedAt: e.recordedAt,
      syncStatus: 'pending',
    })
    .returning();
  return entryOf(row);
}

/** Open entries (not reflected by Codex yet) of the given documents — every document when omitted —, oldest first. */
export async function openCodexEntries(q: Q, documentIds?: readonly string[]): Promise<CodexOutboxEntry[]> {
  if (documentIds && !documentIds.length) return [];
  const rows = await q
    .select()
    .from(codexDocumentOutbox)
    .where(and(isNull(codexDocumentOutbox.closedAt), documentIds ? inArray(codexDocumentOutbox.documentId, [...documentIds]) : undefined))
    .orderBy(asc(codexDocumentOutbox.recordedAt));
  return rows.map(entryOf);
}

/** Open entries waiting for delivery (pending or failed), oldest first. */
export async function undeliveredCodexEntries(q: Q): Promise<CodexOutboxEntry[]> {
  const rows = await q
    .select()
    .from(codexDocumentOutbox)
    .where(and(isNull(codexDocumentOutbox.closedAt), ne(codexDocumentOutbox.syncStatus, 'sent')))
    .orderBy(asc(codexDocumentOutbox.recordedAt));
  return rows.map(entryOf);
}

/** Delivery state of an entry (null when unknown). */
export async function codexEntrySyncStatus(q: Q, id: string): Promise<CodexSyncStatus | null> {
  const [r] = await q.select({ s: codexDocumentOutbox.syncStatus }).from(codexDocumentOutbox).where(eq(codexDocumentOutbox.id, id));
  return r?.s ?? null;
}

/**
 * Claims an outbox entry for one delivery (R-010): false when it was sent meanwhile or another delivery holds a live claim
 * (an expired claim — a sender that died — is taken over).
 */
export async function claimCodexDelivery(q: Q, id: string, at = new Date()): Promise<boolean> {
  const rows = await q
    .update(codexDocumentOutbox)
    .set({ claimedAt: at })
    .where(and(eq(codexDocumentOutbox.id, id), ne(codexDocumentOutbox.syncStatus, 'sent'), or(isNull(codexDocumentOutbox.claimedAt), lt(codexDocumentOutbox.claimedAt, claimExpiry(at)))))
    .returning({ id: codexDocumentOutbox.id });
  return rows.length > 0;
}

/** Records a delivery attempt (and releases its claim). */
export async function markCodexDelivery(q: Q, id: string, result: { ok: true; codexRef?: string | null } | { ok: false; error: string }, at = new Date()): Promise<void> {
  const [r] = await q.select({ attempts: codexDocumentOutbox.attempts }).from(codexDocumentOutbox).where(eq(codexDocumentOutbox.id, id));
  if (!r) return;
  await q
    .update(codexDocumentOutbox)
    .set(result.ok
      ? { syncStatus: 'sent', sentAt: at, lastAttemptAt: at, attempts: r.attempts + 1, lastError: null, codexRef: result.codexRef ?? null, claimedAt: null }
      : { syncStatus: 'failed', lastAttemptAt: at, attempts: r.attempts + 1, lastError: result.error.slice(0, 500), claimedAt: null })
    .where(eq(codexDocumentOutbox.id, id));
}

/** Closes open entries (reflected by Codex, or superseded by a new revision handed to Codex). */
export async function closeCodexEntries(q: Q, ids: readonly string[], at = new Date()): Promise<void> {
  if (!ids.length) return;
  await q.update(codexDocumentOutbox).set({ closedAt: at }).where(and(inArray(codexDocumentOutbox.id, [...ids]), isNull(codexDocumentOutbox.closedAt)));
}

/** Circuit decisions recorded by a person in Keystone (My approvals "Decided" count of the Codex kind). */
export async function codexDecisionsBy(q: Q, actorName: string): Promise<number> {
  const rows = await q
    .select({ id: codexDocumentOutbox.id })
    .from(codexDocumentOutbox)
    .where(and(eq(codexDocumentOutbox.kind, 'approval'), eq(codexDocumentOutbox.actorName, actorName)));
  return rows.length;
}
