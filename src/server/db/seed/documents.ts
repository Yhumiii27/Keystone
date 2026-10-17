// Documents seed (Codex index): document types and circuits (DOC_TYPES, DOC_WHO), the 42 DOCS records with the
// history the prototype synthesises at render time (docRow / docRevs / docAppr / docDist, logic 5020–5047) materialised
// as rows, and the Codex sync state ("Last sync 08:02 · 412 records"). See schema/documents.ts. Delivery 8 (D-2 = a,
// R-127): the download log (docDl) is not seeded — it stays in Codex; the revision rows are kept (KPI, A-15 demo history).
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { addDaysIso, approverRole, confidentiality, docFamily, docLinkKind, documentStatus, isoOfDemoDate, parisInstant, type DocRecipient, type DocService } from '../codes';
import {
  documentAcknowledgements, documentApprovals, documentApproverAssignments, documentIndexSyncs, documentLinks, documentRevisions,
  documentTypeCircuitSteps, documentTypes, documents,
} from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, type SeedCtx } from './context';

export interface ProtoDocType { code: string; label: string; fam: string; circuit: string; retention: string; iso: string; client: boolean }
export interface ProtoDoc {
  id: string; type: string; title: string; proj: string; svc: DocService; rev: string; status: string; date: string; by: string; conf: string;
  tags: string; links: [string, string][]; to: string;
}

/** Days between two revisions of the synthetic history (`dayShift(date, −21 × n)`). */
export const REVISION_SPACING_DAYS = 21;
/** Documents dated after this set are still awaiting the client's acknowledgement (`ack` default, logic 5026). */
const RECENT_RELEASES = new Set(['26 Sep', '28 Sep', '29 Sep']);
/** Records in Codex at the last sync (`codexSync`, logic 5056). */
const CODEX_RECORDS = 412;

const iso = (s: string) => {
  const v = isoOfDemoDate(s);
  if (!v) throw new Error(`Seed: unparseable date "${s}"`);
  return v;
};
export const circuitOf = (t: ProtoDocType) => t.circuit.split(' → ');

/** Document types and their approval circuits (DOC_TYPES) — reference data of both seeds (R-011). */
export async function seedDocumentTypes(tx: Tx): Promise<ProtoDocType[]> {
  const types = PROTO.DOC_TYPES as ProtoDocType[];
  await tx.insert(documentTypes).values(
    types.map((t, position) => ({
      code: t.code, label: t.label, family: docFamily.code(PROTO.DOC_FAM[t.fam]), retention: t.retention, isoClause: t.iso, isClientDeliverable: t.client, position,
    })),
  );
  await tx.insert(documentTypeCircuitSteps).values(
    types.flatMap((t) => circuitOf(t).map((role, position) => ({ typeCode: t.code, position, role: approverRole.code(role) }))),
  );
  return types;
}

export async function seedDocuments(tx: Tx, ctx: SeedCtx): Promise<void> {
  const types = await seedDocumentTypes(tx);
  const typeByCode = new Map(types.map((t) => [t.code, t]));
  const who = PROTO.DOC_WHO as Record<string, string>;
  await tx.insert(documentApproverAssignments).values(
    Object.entries(who).map(([role, name], position) => ({ id: newId(), role: approverRole.code(role), personId: must(ctx.personByShort, name, 'person'), position })),
  );

  // Client contact who acknowledges shared documents: the client persona of the project's client organisation.
  const [clientName, clientOrg] = [PROTO.PERSONAS.client[0] as string, 'Port authority'];
  const clientOf = new Map(PROTO_GEN.initialProjects.map((p) => [p.code as string, p.client as string]));
  const contactOf = (proj: string) => (clientOf.get(proj) === clientOrg ? must(ctx.personByFull, clientName, 'person') : null);

  const docs = PROTO.DOCS as ProtoDoc[];
  const docRows: (typeof documents.$inferInsert)[] = [];
  const revRows: (typeof documentRevisions.$inferInsert)[] = [];
  const apprRows: (typeof documentApprovals.$inferInsert)[] = [];
  const linkRows: (typeof documentLinks.$inferInsert)[] = [];
  const ackRows: (typeof documentAcknowledgements.$inferInsert)[] = [];
  docs.forEach((d, i) => {
    const id = newId();
    ctx.document.set(d.id, id);
    const t = must(typeByCode, d.type, 'document type');
    const status = documentStatus.code(d.status);
    const issuedOn = iso(d.date);
    const author = personIdOrNull(ctx, d.by);
    docRows.push({
      id, number: d.id, typeCode: d.type, title: d.title, projectId: d.proj === 'QMS' ? null : must(ctx.projectByCode, d.proj, 'project'), service: d.svc,
      currentRevision: d.rev, status, issuedOn, authorPersonId: author, authorName: d.by, confidentiality: confidentiality.code(d.conf),
      tags: d.tags.split(' · '), recipients: (d.to ? d.to.split(',') : []) as DocRecipient[], sortOrder: i + 1,
    });
    // Revisions A … current, one every 21 days; earlier ones withdrawn 21 days after their issue (docRevs).
    const cur = d.rev.charCodeAt(0) - 65;
    for (let k = 0; k <= cur; k++) {
      const revOn = k === cur ? issuedOn : addDaysIso(issuedOn, -REVISION_SPACING_DAYS * (cur - k));
      revRows.push({
        id: newId(), documentId: id, revision: String.fromCharCode(65 + k), position: k, issuedOn: revOn, authorPersonId: author, authorName: d.by,
        withdrawnOn: k === cur ? null : addDaysIso(revOn, REVISION_SPACING_DAYS), workingVersions: k === cur ? 3 : k + 2,
      });
    }
    // Approval proof of the current revision (docAppr): step 0 and every step of a released document are signed,
    // dated back from the document date one day per remaining step.
    const steps = circuitOf(t);
    const signedAll = status === 'released' || status === 'obsolete';
    steps.forEach((role, k) => {
      const name = k === 0 ? d.by : (who[role] ?? null);
      apprRows.push({
        documentId: id, revision: d.rev, stepPosition: k, role: approverRole.code(role), approverPersonId: personIdOrNull(ctx, name), approverName: name,
        signedOn: signedAll || k === 0 ? addDaysIso(issuedOn, -(steps.length - 1 - k)) : null,
      });
    });
    d.links.forEach(([kind, ref], position) => linkRows.push({ id: newId(), documentId: id, kind: docLinkKind.code(kind), targetRef: ref, position }));
    const shared = t.client && status === 'released';
    if (shared && !RECENT_RELEASES.has(d.date))
      ackRows.push({ documentId: id, revision: d.rev, acknowledgedByPersonId: d.proj === 'QMS' ? null : contactOf(d.proj), acknowledgedOn: addDaysIso(issuedOn, 1) });
    // D-2 = a (R-127): no synthetic Codex download log — the log stays in Codex (the prototype's docDl rows are not seeded).
  });
  await tx.insert(documents).values(docRows);
  await tx.insert(documentRevisions).values(revRows);
  await tx.insert(documentApprovals).values(apprRows);
  if (linkRows.length) await tx.insert(documentLinks).values(linkRows);
  if (ackRows.length) await tx.insert(documentAcknowledgements).values(ackRows);
  await tx.insert(documentIndexSyncs).values({ id: newId(), syncedAt: parisInstant('2026-09-29', '08:02'), recordCount: CODEX_RECORDS });
}
