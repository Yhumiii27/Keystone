import 'server-only';
// Codex's answer coming back into the index (Delivery 7, R-124): the state of the records concerned by the outbox —
// status, approval proof of the current revision, withdrawal of the previous revision on a release. Codex is the
// reference: this refresh is what turns a Keystone decision into a signed step or a Released status, never the
// decision itself. Entries Codex reflects (step signed, status moved on, other revision) are closed.
import { and, eq, isNull } from 'drizzle-orm';
import { documentStatus, type DocumentStatus } from '@/server/db/codes';
import { findPerson, writeAudit } from '@/server/db/helpers';
import { documentAcknowledgements, documentApprovals, documentRevisions, documents } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { closeCodexEntries, openCodexEntries } from './outbox';

/** State of a record as Codex reports it — TODO(codex): payload to confirm with Codex's API (OPEN QUESTION D-1). */
export interface CodexDocumentState {
  number: string;
  revision: string;
  status: DocumentStatus;
  /** Approval proof of `revision`: steps after the originator, signed on (ISO date) or null. */
  approvals: { step: number; signedOn: string | null; signedBy?: string | null }[];
  /** Revision withdrawn by the release of `revision`, and when. */
  withdrawnRevision?: string | null;
  withdrawnOn?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape check of one record of Codex's payload (anything else is ignored). */
export function isCodexDocumentState(v: unknown): v is CodexDocumentState {
  const r = v as CodexDocumentState;
  return !!r && typeof r === 'object' && typeof r.number === 'string' && typeof r.revision === 'string' && documentStatus.isCode(r.status) && Array.isArray(r.approvals)
    && r.approvals.every((a) => a && Number.isInteger(a.step) && (a.signedOn === null || (typeof a.signedOn === 'string' && ISO_DATE.test(a.signedOn))))
    && (r.withdrawnOn == null || (typeof r.withdrawnOn === 'string' && ISO_DATE.test(r.withdrawnOn)));
}

/**
 * Writes Codex's state of the records into the index and closes the outbox entries it reflects. A record of another
 * revision than the index's is left to the index synchronisation (new revisions come with it, D-1); its open entries
 * are stale and closed. Returns the number of records updated.
 */
export async function applyCodexDocumentStates(tx: Tx, records: readonly CodexDocumentState[], at = new Date()): Promise<number> {
  let n = 0;
  for (const rec of records) {
    if (!isCodexDocumentState(rec)) continue;
    const [d] = await tx.select().from(documents).where(eq(documents.number, rec.number)).for('update');
    if (!d) continue;
    const open = await openCodexEntries(tx, [d.id]);
    if (rec.revision !== d.currentRevision) {
      await closeCodexEntries(tx, open.filter((e) => e.revision !== d.currentRevision).map((e) => e.id), at);
      continue;
    }
    const signed = new Set<number>();
    for (const a of rec.approvals) {
      if (a.step < 1) continue;
      if (a.signedOn) signed.add(a.step);
      const signer = a.signedOn && a.signedBy ? await findPerson(tx, a.signedBy) : null;
      await tx.update(documentApprovals).set({ signedOn: a.signedOn, signedByPersonId: signer?.id ?? null })
        .where(and(eq(documentApprovals.documentId, d.id), eq(documentApprovals.revision, d.currentRevision), eq(documentApprovals.stepPosition, a.step)));
    }
    if (rec.status !== d.status) {
      const released = rec.status === 'released';
      const prev = released && rec.withdrawnRevision ? rec.withdrawnRevision : null;
      const on = rec.withdrawnOn ?? null;
      await tx.update(documents).set({
        status: rec.status, ...(released ? { lastWithdrawnRevision: prev, lastWithdrawnOn: prev ? on : null } : {}), updatedAt: at,
      }).where(eq(documents.id, d.id));
      if (prev && on)
        await tx.update(documentRevisions).set({ withdrawnOn: on })
          .where(and(eq(documentRevisions.documentId, d.id), eq(documentRevisions.revision, prev), isNull(documentRevisions.withdrawnOn)));
      // A new release of the revision waits for the client's acknowledgement again (client deliverables).
      if (released) await tx.delete(documentAcknowledgements).where(and(eq(documentAcknowledgements.documentId, d.id), eq(documentAcknowledgements.revision, d.currentRevision)));
      await writeAudit(tx, {
        actorName: 'Codex', objectRef: d.number, change: `status: ${documentStatus.label(d.status)} → ${documentStatus.label(rec.status)} · synced from Codex`,
        area: 'Documents', entityType: 'document', entityId: d.id, projectId: d.projectId, occurredAt: at,
      });
    }
    const moved = rec.status !== 'release_proposed';
    await closeCodexEntries(
      tx,
      open.filter((e) => e.revision !== rec.revision || moved || (e.kind === 'approval' && e.stepPosition != null && signed.has(e.stepPosition)) || (e.kind === 'circuit_start' && signed.size > 0))
        .map((e) => e.id),
      at,
    );
    n++;
  }
  return n;
}
