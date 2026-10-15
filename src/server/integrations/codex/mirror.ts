import 'server-only';
// Codex's answer coming back into the index (Delivery 7, R-124): the state of the records concerned by the outbox —
// status, approval proof of the current revision, withdrawal of the previous revision on a release. Codex is the
// reference: this refresh is what turns a Keystone decision into a signed step or a Released status, never the
// decision itself. Entries Codex reflects (step signed, status moved on, other revision) are closed.
// Delivery 8 (R-033): the index read (`applyCodexIndex`) writes Codex's records into the index, with the same state rule.
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  confidentiality, docService, documentStatus, type Confidentiality, type DocRecipient, type DocService, type DocumentStatus,
} from '@/server/db/codes';
import { findPerson, writeAudit } from '@/server/db/helpers';
import {
  documentAcknowledgements, documentApprovals, documentRevisions, documentTypeCircuitSteps, documentTypes, documents, projects,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { safeCodexUrl } from './links';
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

// ── Index read (Delivery 8, R-033; D-2 = a, A-15 = a) ──────────────────────────────────────────────────

/**
 * A record of Codex's index as Keystone reads it — TODO(codex): payload of `GET /api/documents?since=…` proposed until Codex
 * publishes its API (OPEN QUESTION D-1). D-2 scope: the record, its current revision and its current circuit — no earlier
 * revision, no download log. `project` is Keystone's project code ("HLT-026") or "QMS" for a company quality document
 * (NEW-SYS-1: the project key is likely to change).
 */
export interface CodexIndexRecord {
  /** Codex's own id and link of the record. */
  id: string;
  url?: string | null;
  number: string;
  /** Document type code of the register ("PID"). */
  type: string;
  project: string;
  title: string;
  service: DocService;
  status: DocumentStatus;
  confidentiality: Confidentiality;
  /** Author as Codex names them ("P. Noguès"). */
  author: string;
  tags?: string[];
  recipients?: string[];
  /** The current revision. */
  revision: { letter: string; issuedOn: string; author?: string | null; workingVersions?: number | null };
  /** Approval proof of the current revision (step 0 = originator). */
  approvals: { step: number; approver?: string | null; signedOn: string | null; signedBy?: string | null }[];
  /** Revision withdrawn by the release of the current one, and when. */
  withdrawnRevision?: string | null;
  withdrawnOn?: string | null;
}

const isText = (v: unknown, max = 500): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v);
const DOC_NUMBER = /^[A-Z0-9]+(?:-[A-Z0-9]+){1,4}$/;

/** Shape check of one record of the index payload (anything else is skipped and logged). */
export function isCodexIndexRecord(v: unknown): v is CodexIndexRecord {
  const r = v as CodexIndexRecord;
  return !!r && typeof r === 'object' && isText(r.id, 200) && typeof r.number === 'string' && DOC_NUMBER.test(r.number) && isText(r.type, 20)
    && isText(r.project, 40) && isText(r.title, 500) && docService.isCode(r.service) && documentStatus.isCode(r.status) && confidentiality.isCode(r.confidentiality)
    && isText(r.author, 200) && (r.url == null || typeof r.url === 'string')
    && (r.tags == null || (Array.isArray(r.tags) && r.tags.length <= 50 && r.tags.every((x) => isText(x, 200))))
    && (r.recipients == null || (Array.isArray(r.recipients) && r.recipients.length <= 20 && r.recipients.every((x) => isText(x, 40))))
    && !!r.revision && typeof r.revision === 'object' && isText(r.revision.letter, 10) && isDate(r.revision.issuedOn)
    && (r.revision.workingVersions == null || (Number.isInteger(r.revision.workingVersions) && r.revision.workingVersions >= 0))
    && Array.isArray(r.approvals) && r.approvals.length <= 20
    && r.approvals.every((a) => a && Number.isInteger(a.step) && a.step >= 0 && (a.signedOn === null || isDate(a.signedOn)))
    && (r.withdrawnRevision == null || isText(r.withdrawnRevision, 10)) && (r.withdrawnOn == null || isDate(r.withdrawnOn));
}

export interface CodexIndexResult {
  /** Records written to the index (created or updated). */
  applied: number;
  created: number;
  /** Records skipped: malformed, or a project / type Keystone does not know (each logged). */
  skipped: { number: string; reason: string }[];
}

const UNKNOWN_TYPE = 'unknown document type';
const UNKNOWN_PROJECT = 'unknown project';

/**
 * A record skipped because Keystone does not know its project or document type yet (integration review): once the project or
 * the type exists, the next read must bring it again — the read mark does not move past it (`refreshCodexIndex`). A
 * malformed record is dropped.
 */
export const awaitsKeystoneData = (s: { reason: string }): boolean => s.reason.startsWith(`${UNKNOWN_TYPE} `) || s.reason.startsWith(`${UNKNOWN_PROJECT} `);

/**
 * Writes Codex's index records into Keystone's index (Delivery 8, R-033): the record (codexId, codexUrl included), its
 * current revision row and its approval proof. A record whose project or type code Keystone does not know is skipped and
 * logged — never filed as a QMS record (projectId null), which every project's vault would show. Authors, approvers and
 * signers are matched to persons by name (null when unknown, the name kept). A status change, the withdrawal of the
 * previous revision, the client acknowledgement reset and the closing of the outbox entries Codex reflects go through
 * `applyCodexDocumentStates` (one rule for both reads); a new revision of an indexed record is audited, and released over a
 * released one it withdraws the previous revision here. Runs in the caller's transaction.
 */
export async function applyCodexIndex(tx: Tx, records: readonly unknown[], at = new Date()): Promise<CodexIndexResult> {
  const result: CodexIndexResult = { applied: 0, created: 0, skipped: [] };
  const skip = (number: string, reason: string) => result.skipped.push({ number, reason });
  const [types, steps] = await Promise.all([
    tx.select({ code: documentTypes.code }).from(documentTypes),
    tx.select().from(documentTypeCircuitSteps),
  ]);
  const knownTypes = new Set(types.map((t) => t.code));
  for (const raw of records) {
    if (!isCodexIndexRecord(raw)) {
      skip(typeof (raw as { number?: unknown })?.number === 'string' ? String((raw as { number: string }).number).slice(0, 40) : '?', 'malformed record');
      continue;
    }
    const rec = raw;
    if (!knownTypes.has(rec.type)) {
      skip(rec.number, `${UNKNOWN_TYPE} ${rec.type}`);
      continue;
    }
    let projectId: string | null = null;
    if (rec.project !== 'QMS') {
      const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, rec.project));
      if (!p) {
        skip(rec.number, `${UNKNOWN_PROJECT} ${rec.project}`);
        continue;
      }
      projectId = p.id;
    }
    const author = await findPerson(tx, rec.author);
    const fields = {
      typeCode: rec.type, title: rec.title.trim(), projectId, service: rec.service, currentRevision: rec.revision.letter, issuedOn: rec.revision.issuedOn,
      authorPersonId: author?.id ?? null, authorName: rec.author.trim(), confidentiality: rec.confidentiality, tags: (rec.tags ?? []).map((x) => x.trim()),
      recipients: (rec.recipients ?? []).map((x) => x.trim()) as DocRecipient[], codexId: rec.id, codexUrl: safeCodexUrl(rec.url), updatedAt: at,
    };
    const [existing] = await tx.select().from(documents).where(eq(documents.number, rec.number)).for('update');
    let documentId: string;
    if (existing) {
      // The status, the withdrawal and the acknowledgements follow `applyCodexDocumentStates` below.
      await tx.update(documents).set(fields).where(eq(documents.id, existing.id));
      documentId = existing.id;
    } else {
      const [{ maxOrder }] = await tx.select({ maxOrder: sql<number>`coalesce(max(${documents.sortOrder}), 0)::int` }).from(documents);
      const [row] = await tx.insert(documents).values({
        ...fields, number: rec.number, status: rec.status, isNew: false, sortOrder: maxOrder + 1,
        lastWithdrawnRevision: rec.status === 'released' && rec.withdrawnRevision && rec.withdrawnOn ? rec.withdrawnRevision : null,
        lastWithdrawnOn: rec.status === 'released' && rec.withdrawnRevision && rec.withdrawnOn ? rec.withdrawnOn : null,
      }).returning({ id: documents.id });
      documentId = row.id;
      result.created++;
      await writeAudit(tx, {
        actorName: 'Codex', objectRef: rec.number, change: `indexed from Codex · ${documentStatus.label(rec.status)} rev ${rec.revision.letter}`, area: 'Documents',
        entityType: 'document', entityId: documentId, projectId, occurredAt: at,
      });
    }
    // The current revision row (its position after the record's other revisions when new).
    const revs = await tx.select({ revision: documentRevisions.revision, position: documentRevisions.position }).from(documentRevisions).where(eq(documentRevisions.documentId, documentId));
    const revAuthor = rec.revision.author ? await findPerson(tx, rec.revision.author) : author;
    const position = revs.find((r) => r.revision === rec.revision.letter)?.position ?? (revs.length ? Math.max(...revs.map((r) => r.position)) + 1 : 0);
    const revision = {
      issuedOn: rec.revision.issuedOn, authorPersonId: revAuthor?.id ?? null, authorName: (rec.revision.author ?? rec.author).trim(),
      workingVersions: rec.revision.workingVersions ?? 1, withdrawnOn: null,
    };
    await tx.insert(documentRevisions).values({ documentId, revision: rec.revision.letter, position, ...revision })
      .onConflictDoUpdate({ target: [documentRevisions.documentId, documentRevisions.revision], set: revision });
    // The approval proof of the current revision, on the type's circuit (a step the circuit does not have is ignored).
    const circuit = steps.filter((s) => s.typeCode === rec.type);
    for (const a of rec.approvals) {
      const step = circuit.find((s) => s.position === a.step);
      if (!step) continue;
      const approver = a.approver ? await findPerson(tx, a.approver) : null;
      const signer = a.signedOn && a.signedBy ? await findPerson(tx, a.signedBy) : null;
      const proof = {
        role: step.role, approverPersonId: approver?.id ?? null, approverName: a.approver?.trim() || null, signedOn: a.signedOn, signedByPersonId: signer?.id ?? null,
      };
      await tx.insert(documentApprovals).values({ documentId, revision: rec.revision.letter, stepPosition: a.step, ...proof })
        .onConflictDoUpdate({ target: [documentApprovals.documentId, documentApprovals.revision, documentApprovals.stepPosition], set: proof });
    }
    if (existing && existing.currentRevision !== rec.revision.letter) {
      // A new revision of a record Keystone already indexed (integration review): audited, and when it was released over a
      // released one (both reads between Codex's release), the previous revision is withdrawn as on a status change — the
      // status-change rule below does not run when the status stays Released.
      await writeAudit(tx, {
        actorName: 'Codex', objectRef: rec.number, change: `revision ${existing.currentRevision} → ${rec.revision.letter} · synced from Codex`, area: 'Documents',
        entityType: 'document', entityId: documentId, projectId, occurredAt: at,
      });
      if (existing.status === 'released' && rec.status === 'released' && rec.withdrawnRevision && rec.withdrawnOn) {
        await tx.update(documents).set({ lastWithdrawnRevision: rec.withdrawnRevision, lastWithdrawnOn: rec.withdrawnOn }).where(eq(documents.id, documentId));
        await tx.update(documentRevisions).set({ withdrawnOn: rec.withdrawnOn })
          .where(and(eq(documentRevisions.documentId, documentId), eq(documentRevisions.revision, rec.withdrawnRevision), isNull(documentRevisions.withdrawnOn)));
      }
    }
    if (existing)
      await applyCodexDocumentStates(tx, [{
        number: rec.number, revision: rec.revision.letter, status: rec.status, approvals: rec.approvals.map((a) => ({ step: a.step, signedOn: a.signedOn, signedBy: a.signedBy ?? null })),
        withdrawnRevision: rec.withdrawnRevision ?? null, withdrawnOn: rec.withdrawnOn ?? null,
      }], at);
    else if (rec.withdrawnRevision && rec.withdrawnOn)
      await tx.update(documentRevisions).set({ withdrawnOn: rec.withdrawnOn })
        .where(and(eq(documentRevisions.documentId, documentId), eq(documentRevisions.revision, rec.withdrawnRevision), isNull(documentRevisions.withdrawnOn)));
    result.applied++;
  }
  return result;
}
