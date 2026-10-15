import 'server-only';
// Documents — Codex index DAL (docs/spec/10 §4 Documents, §5 Document types register; 11 §3.10). Keystone mirrors
// the Codex records (number, revision, status, confidentiality, tags, links), shows the approval proof, distribution
// and acknowledgements, and hands deposits over to Codex (simulated: the index record is created at once, OPEN QUESTION
// D-1). Writers follow the vault's state machine (10 §9): Draft → Frozen → Release proposed → (approvals) → Released;
// client acknowledgement of released client deliverables.
// Delivery 8 (D-2 = a, A-15 = a; R-127): Keystone keeps the record, its current revision and its current circuit — the
// earlier revisions and the download log stay in Codex (the drawer links there); no Keystone download log is written.
// R-128: the drawer's relations (deliverable, order, punch item) resolve in the record's own project.
// Delivery 7 (P-7b = a, D-1b = a, P-7c = a; R-124, R-106): circuit decisions and the start of an engineering
// deliverable's circuit are recorded in the Codex outbox (src/server/integrations/codex) and shown "pending sync with
// Codex" over the mirrored circuit; the status and the approval proof change only when Codex answers.
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { cache } from 'react';
import { getDb } from '@/server/db/client';
import {
  CODEX_TODAY_ISO, approverRole, codexDecision, codexSyncStatus, confidentiality, docFamily, docLinkKind, docRecipient, docService, documentStatus, parisParts,
  shortDateOfIso, type ApproverRole, type Confidentiality, type DocFamily, type DocLinkKind, type DocRecipient, type DocService,
  type DocumentStatus,
} from '@/server/db/codes';
import { demoFloor, findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import {
  circuitNoteText, codexCircuitState, isEngineeringDeliverable, type CircuitState, type CodexDecision, type CodexSyncStatus,
} from '@/domain/codex-approvals';
import { closeCodexEntries, insertCodexEntry, openCodexEntries, type CodexOutboxEntry } from '@/server/integrations/codex/outbox';
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { readCodexIndex } from '@/server/integrations/codex/connector';
import { awaitsKeystoneData } from '@/server/integrations/codex/mirror';
import {
  clients, deliverables, documentAcknowledgements, documentApprovals, documentApproverAssignments, documentDeposits, documentIndexSyncs,
  documentLinks, documentRevisions, documentTypeCircuitSteps, documentTypes, documents, persons, projects, punchItems, purchaseOrders, users,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';

/** Scope value of company quality-system documents (`proj: 'QMS'`). */
export const QMS = 'QMS';
/** Title of a new deposit when none is given (the prototype's hard-coded record title, 10 OQ14). */
export const DEPOSIT_DEFAULT_TITLE = 'Material certificate 3.1 — S355 · heat 7781';

// ── Document types register ────────────────────────────────────────────────────────────────────────────

export interface CircuitStep {
  role: ApproverRole;
  /** EN source label ("Engineering lead"). */
  label: string;
}

export interface DocumentTypeRow {
  /** "PID". */
  code: string;
  /** EN source label ("P&ID"). */
  label: string;
  family: DocFamily;
  /** "Engineering". */
  familyLabel: string;
  /** Step 0 is the originator (Author, Buyer, Auditor…); approvals needed to release = steps − 1. */
  circuit: CircuitStep[];
  /** "Author → Engineering lead → Project manager". */
  circuitText: string;
  retention: string;
  isoClause: string;
  isClientDeliverable: boolean;
  /** Vault records of the type, all projects (deposits included). */
  inCodex: number;
}

/** DOC_TYPES order with the "In Codex" count (10 §5.3). */
export async function listDocumentTypes(): Promise<DocumentTypeRow[]> {
  const db = await getDb();
  const [types, steps, counts] = await Promise.all([
    db.select().from(documentTypes).orderBy(asc(documentTypes.position)),
    db.select().from(documentTypeCircuitSteps).orderBy(asc(documentTypeCircuitSteps.typeCode), asc(documentTypeCircuitSteps.position)),
    db.select({ code: documents.typeCode, n: sql<number>`count(*)::int` }).from(documents).groupBy(documents.typeCode),
  ]);
  const n = new Map(counts.map((c) => [c.code, c.n]));
  return types.map((t) => {
    const circuit = steps.filter((s) => s.typeCode === t.code).map((s) => ({ role: s.role, label: approverRole.label(s.role) }));
    return {
      code: t.code, label: t.label, family: t.family, familyLabel: docFamily.label(t.family), circuit, circuitText: circuit.map((c) => c.label).join(' → '),
      retention: t.retention, isoClause: t.isoClause, isClientDeliverable: t.isClientDeliverable, inCodex: n.get(t.code) ?? 0,
    };
  });
}

/** Named approver per circuit role (DOC_WHO): short names ("G. Comte"). */
export async function getApproverDirectory(): Promise<Partial<Record<ApproverRole, string>>> {
  const db = await getDb();
  const rows = await db
    .select({ role: documentApproverAssignments.role, short: persons.shortName })
    .from(documentApproverAssignments)
    .innerJoin(persons, eq(persons.id, documentApproverAssignments.personId))
    .where(isNull(documentApproverAssignments.projectId))
    .orderBy(asc(documentApproverAssignments.position));
  return Object.fromEntries(rows.map((r) => [r.role, r.short]));
}

// ── Vault ──────────────────────────────────────────────────────────────────────────────────────────────

export interface VaultDocument {
  /** "PID-HLT-026". */
  number: string;
  type: string;
  typeLabel: string;
  family: DocFamily;
  familyLabel: string;
  title: string;
  /** Project code, or "QMS" for company quality-system documents. */
  project: string;
  service: DocService;
  /** "Process", "Project management". */
  serviceLabel: string;
  /** Current revision letter. */
  revision: string;
  status: DocumentStatus;
  /** EN source label ("Release proposed"). */
  statusLabel: string;
  /** ISO date of the current revision and its display ("26 Sep"). */
  issuedOn: string;
  dateText: string;
  /** Author short name ("P. Noguès"). */
  author: string;
  confidentiality: Confidentiality;
  confidentialityLabel: string;
  tags: string[];
  /** Tags joined with " · ", or "—". */
  tagsText: string;
  recipients: DocRecipient[];
  links: { kind: DocLinkKind; kindLabel: string; ref: string }[];
  /** Created from Keystone (deposit, meeting minutes): "New" tag. */
  isNew: boolean;
  /** Client deliverable type, released and of Client confidentiality: shared with the client (`sharedWithClient`). */
  shared: boolean;
  /** Shared and acknowledged by the client for the current revision. */
  acknowledged: boolean;
  circuit: CircuitStep[];
  circuitText: string;
  retention: string;
  isoClause: string;
  /** Approval steps after the originator signed in Codex, and the number required to release (steps − 1). */
  approvalsGiven: number;
  approvalsRequired: number;
  /**
   * Next circuit role to approve and its named approver (DOC_WHO, else the author); null when none is pending. In
   * Release proposed it is the step open in Keystone (Delivery 7): none before the PM's validation of an engineering
   * deliverable, after a rejection, or once every step is decided and waits for Codex.
   */
  nextRole: ApproverRole | null;
  nextRoleLabel: string | null;
  nextApprover: string | null;
  /** Status-driven actions of the engineering screens and the vault (`canFreeze`, `canPropose`, `canApprove`). */
  canFreeze: boolean;
  canPropose: boolean;
  canApprove: boolean;
  /**
   * Delivery 7 (P-7b, P-7c): the circuit as Keystone shows it — Codex's signed steps, then the decisions recorded in
   * Keystone that Codex has not applied yet ("pending sync with Codex").
   */
  circuitState: CircuitState;
  /** Engineering deliverable: its circuit starts with the PM's "Validate release (PM)" (P-7c). */
  needsCircuitStart: boolean;
  /** Line under the status (EN source): "Awaiting PM validation", "Approved · Pending sync with Codex"…; null when none. */
  circuitNote: string | null;
  /** Withdrawal of the previous revision on the last release ("rev C withdrawn automatically · 29 Sep"). */
  withdrawal: { revision: string; on: string } | null;
  /**
   * Revisions withdrawn so far (obsolete revision rows): the KPI "Obsolete revisions withdrawn" keeps reading the stored rows,
   * never the revision letter (00 §7.16, 10 OQ16); they are not displayed any more (D-2, R-127). TODO(codex): the D-1 index
   * payload must carry a withdrawn-revision count, or the KPI only counts the withdrawals seen after connection.
   */
  withdrawnRevisions: number;
  /** Codex's own link of the record, once the index read brought it (R-033); null until then (links open Codex's home). */
  codexUrl: string | null;
}

const tagsTextOf = (tags: string[]) => tags.join(' · ') || '—';

interface VaultBundle {
  docs: (typeof documents.$inferSelect & { projectCode: string | null })[];
  types: Map<string, typeof documentTypes.$inferSelect>;
  steps: Map<string, CircuitStep[]>;
  approvals: Map<string, (typeof documentApprovals.$inferSelect)[]>;
  links: Map<string, (typeof documentLinks.$inferSelect)[]>;
  acks: Set<string>;
  withdrawn: Map<string, number>;
  who: Partial<Record<ApproverRole, string>>;
  /** Open Codex outbox entries per document. */
  entries: Map<string, CodexOutboxEntry[]>;
}

async function loadVault(q: Awaited<ReturnType<typeof getDb>> | Tx, where?: ReturnType<typeof eq>): Promise<VaultBundle> {
  const docRows = await q
    .select({ d: documents, projectCode: projects.code })
    .from(documents)
    .leftJoin(projects, eq(projects.id, documents.projectId))
    .where(where)
    .orderBy(asc(documents.sortOrder));
  const ids = docRows.map((r) => r.d.id);
  const none = ids.length === 0;
  const [types, steps, approvals, links, acks, revs, whoRows, entries] = await Promise.all([
    q.select().from(documentTypes),
    q.select().from(documentTypeCircuitSteps).orderBy(asc(documentTypeCircuitSteps.position)),
    none ? [] : q.select().from(documentApprovals).where(inArray(documentApprovals.documentId, ids)).orderBy(asc(documentApprovals.stepPosition)),
    none ? [] : q.select().from(documentLinks).where(inArray(documentLinks.documentId, ids)).orderBy(asc(documentLinks.position)),
    none ? [] : q.select().from(documentAcknowledgements).where(inArray(documentAcknowledgements.documentId, ids)),
    none ? [] : q.select({ documentId: documentRevisions.documentId, withdrawnOn: documentRevisions.withdrawnOn }).from(documentRevisions).where(inArray(documentRevisions.documentId, ids)),
    q.select({ role: documentApproverAssignments.role, short: persons.shortName }).from(documentApproverAssignments)
      .innerJoin(persons, eq(persons.id, documentApproverAssignments.personId)).where(isNull(documentApproverAssignments.projectId)),
    none ? [] : openCodexEntries(q, ids),
  ]);
  const group = <T extends { documentId: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) (m.get(x.documentId) ?? m.set(x.documentId, []).get(x.documentId)!).push(x);
    return m;
  };
  const stepMap = new Map<string, CircuitStep[]>();
  for (const s of steps) (stepMap.get(s.typeCode) ?? stepMap.set(s.typeCode, []).get(s.typeCode)!).push({ role: s.role, label: approverRole.label(s.role) });
  const withdrawn = new Map<string, number>();
  for (const r of revs) if (r.withdrawnOn) withdrawn.set(r.documentId, (withdrawn.get(r.documentId) ?? 0) + 1);
  return {
    docs: docRows.map((r) => ({ ...r.d, projectCode: r.projectCode })),
    types: new Map(types.map((t) => [t.code, t])),
    steps: stepMap,
    approvals: group(approvals),
    links: group(links),
    acks: new Set(acks.map((a) => `${a.documentId}|${a.revision}`)),
    withdrawn,
    who: Object.fromEntries(whoRows.map((w) => [w.role, w.short])),
    entries: group(entries),
  };
}

/**
 * Shared with the client: a released record of a client-deliverable type whose confidentiality is Client. P-10b / R-043:
 * an internal or supplier record never reaches the client, even of a client type — the minutes of an internal meeting (MIN,
 * Internal) or a record the Codex index read brings with that confidentiality.
 */
function sharedWithClient(t: { isClientDeliverable: boolean }, d: { status: DocumentStatus; confidentiality: Confidentiality }): boolean {
  return t.isClientDeliverable && d.status === 'released' && d.confidentiality === 'client';
}

function toVault(b: VaultBundle, d: VaultBundle['docs'][number]): VaultDocument {
  const t = b.types.get(d.typeCode)!;
  const circuit = b.steps.get(d.typeCode) ?? [];
  const appr = (b.approvals.get(d.id) ?? []).filter((a) => a.revision === d.currentRevision);
  const signed = appr.filter((a) => a.stepPosition > 0 && a.signedOn).map((a) => a.stepPosition);
  const given = signed.length;
  const project = d.projectCode ?? QMS;
  const needsCircuitStart = isEngineeringDeliverable({ project, service: d.service, recipients: d.recipients });
  const state = codexCircuitState({
    status: d.status, revision: d.currentRevision, steps: circuit.length, signed, entries: b.entries.get(d.id) ?? [], needsStart: needsCircuitStart,
  });
  // Release proposed: the step open in Keystone; other statuses: the step after Codex's signed ones (register exports).
  const next = d.status === 'release_proposed' ? (state.nextStep != null ? circuit[state.nextStep] ?? null : null) : circuit.length > 1 + given ? circuit[1 + given] : null;
  const shared = sharedWithClient(t, d);
  return {
    number: d.number, type: d.typeCode, typeLabel: t.label, family: t.family, familyLabel: docFamily.label(t.family), title: d.title,
    project, service: d.service, serviceLabel: docService.label(d.service), revision: d.currentRevision, status: d.status,
    statusLabel: documentStatus.label(d.status), issuedOn: d.issuedOn, dateText: shortDateOfIso(d.issuedOn), author: d.authorName,
    confidentiality: d.confidentiality, confidentialityLabel: confidentiality.label(d.confidentiality), tags: d.tags, tagsText: tagsTextOf(d.tags),
    recipients: d.recipients, links: (b.links.get(d.id) ?? []).map((l) => ({ kind: l.kind, kindLabel: docLinkKind.label(l.kind), ref: l.targetRef })),
    isNew: d.isNew, shared, acknowledged: shared && b.acks.has(`${d.id}|${d.currentRevision}`), circuit, circuitText: circuit.map((c) => c.label).join(' → '),
    retention: t.retention, isoClause: t.isoClause, approvalsGiven: given, approvalsRequired: Math.max(0, circuit.length - 1),
    nextRole: next?.role ?? null, nextRoleLabel: next?.label ?? null, nextApprover: next ? (b.who[next.role] ?? d.authorName) : null,
    canFreeze: d.status === 'draft', canPropose: d.status === 'frozen', canApprove: state.nextStep != null && !!next,
    circuitState: state, needsCircuitStart, circuitNote: circuitNoteText(state, needsCircuitStart, d.status),
    withdrawal: d.lastWithdrawnRevision && d.lastWithdrawnOn ? { revision: d.lastWithdrawnRevision, on: d.lastWithdrawnOn } : null,
    withdrawnRevisions: b.withdrawn.get(d.id) ?? 0,
    codexUrl: d.codexUrl,
  };
}

/** Every vault record, all projects: Keystone-created records first, then the Codex (DOCS) order. Memoised per request. */
export const listVaultDocuments = cache(async (): Promise<VaultDocument[]> => {
  const db = await getDb();
  const b = await loadVault(db);
  return b.docs.map((d) => toVault(b, d));
});

/** Records in the scope of a project: its own documents plus the company QMS documents (`inScope`, scope "Current project"). */
export async function listProjectDocuments(projectCode: string): Promise<VaultDocument[]> {
  return (await listVaultDocuments()).filter((d) => d.project === projectCode || d.project === QMS);
}

/** Released client-deliverable documents of a project (client portal "Documents", `cpVaultDocs`). */
export async function listSharedDocuments(projectCode: string): Promise<VaultDocument[]> {
  return (await listVaultDocuments()).filter((d) => d.shared && d.project === projectCode);
}

/**
 * Documents with a circuit step open for a decision, all projects (sidebar "Documents · Codex" badge). Delivery 7: a
 * record whose remaining steps all wait for Codex, or an engineering deliverable awaiting the PM's validation, is not
 * counted (nobody can approve it in Keystone).
 */
export async function countDocumentsAwaitingApproval(): Promise<number> {
  return (await listVaultDocuments()).filter((d) => d.canApprove).length;
}

// ── Document record (drawer) ───────────────────────────────────────────────────────────────────────────

export interface DocumentRevisionRow {
  revision: string;
  current: boolean;
  /** Current revision: the document status; earlier revisions: obsolete. */
  status: DocumentStatus;
  issuedOn: string;
  dateText: string;
  author: string;
  /** Working versions recorded in Codex (prototype display: current "A.3", earlier "{n} working versions"). */
  workingVersions: number;
  withdrawnOn: string | null;
}

export interface ApprovalProofRow {
  position: number;
  role: ApproverRole;
  roleLabel: string;
  /**
   * Delivery 7: the decision recorded in Keystone on a step Codex has not signed yet — by whom (short name), the Paris
   * day it was recorded and its delivery state; null otherwise.
   */
  keystone: { decision: CodexDecision; by: string; on: string; sync: CodexSyncStatus } | null;
  /**
   * Named approver (author for step 0), "—" when the role has no approver; a step signed in Keystone shows its
   * signer (the portfolio director may sign on the approver's behalf).
   */
  who: string;
  signed: boolean;
  signedOn: string | null;
}

export type DistributionRow =
  | { kind: 'client'; organisation: string; contact: string | null; revision: string; date: string; acknowledgedOn: string | null }
  | { kind: 'internal'; recipient: DocRecipient; label: string; revision: string; date: string };

/**
 * Screen a relation of a record opens (R-128), resolved in the record's own project: a deliverable (Quality ›
 * Deliverables), a purchase order (Orders, `ref` = the Keystone number even when Codex carried the Sage X3 one) or a punch
 * item (Inspections & punch list, one list per project — A-6).
 */
export interface DocumentLinkTarget {
  screen: 'deliverable' | 'order' | 'punch';
  project: string;
  ref: string;
}

export interface DocumentLinkRow {
  kind: DocLinkKind;
  kindLabel: string;
  ref: string;
  /** Deliverable / order / punch item found in the record's project; null for a QMS record or an unknown reference (inert). */
  target: DocumentLinkTarget | null;
}

export interface DocumentRecord extends VaultDocument {
  /**
   * The current revision only (D-2 = a, R-127): the earlier revisions and the download log stay in Codex, which the drawer
   * links to. One row (none for a record without revision row).
   */
  revisions: DocumentRevisionRow[];
  approvals: ApprovalProofRow[];
  distribution: DistributionRow[];
  /** Relations with their target in the record's own project (R-128). */
  links: DocumentLinkRow[];
  /** "PHO" → JPG ×12, else native + PDF (display only). */
  files: 'photos' | 'native_pdf';
}

type Q = Awaited<ReturnType<typeof getDb>> | Tx;

/**
 * Punch item of a project by number (R-128): one punch list per project, numbered over the project (R-117, A-6 'a'), so a
 * number names one item; it opens that item's row of the project's punch list (`#punch-P-01`).
 */
async function findPunchItem(q: Q, projectId: string, numbers: readonly string[]): Promise<Set<string>> {
  if (!numbers.length) return new Set();
  const rows = await q.select({ number: punchItems.number }).from(punchItems)
    .where(and(eq(punchItems.projectId, projectId), inArray(punchItems.number, [...numbers])));
  return new Set(rows.map((r) => r.number));
}

/**
 * Targets of the relations of a record (R-128), in the record's own project — never the vault page's: deliverable by
 * number, purchase order by number then by Sage X3 reference (SC-4b: Codex may carry the X3 number), punch item by
 * number. Article and change-request relations keep their own links (docs/model.ts); a QMS record resolves nothing.
 */
async function linkTargets(q: Q, projectId: string | null, projectCode: string | null, links: VaultDocument['links']): Promise<DocumentLinkRow[]> {
  const refs = (kind: DocLinkKind) => [...new Set(links.filter((l) => l.kind === kind).map((l) => l.ref))];
  if (!projectId || !projectCode) return links.map((l) => ({ ...l, target: null }));
  const [dlv, po, punch] = await Promise.all([
    refs('deliverable').length
      ? q.select({ number: deliverables.number }).from(deliverables).where(and(eq(deliverables.projectId, projectId), inArray(deliverables.number, refs('deliverable'))))
      : Promise.resolve([]),
    refs('purchase_order').length
      ? q.select({ number: purchaseOrders.number, x3Ref: purchaseOrders.x3Ref }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.projectId, projectId), or(inArray(purchaseOrders.number, refs('purchase_order')), inArray(purchaseOrders.x3Ref, refs('purchase_order')))))
      : Promise.resolve([]),
    findPunchItem(q, projectId, refs('punch_item')),
  ]);
  const dlvSet = new Set(dlv.map((r) => r.number));
  const poOf = (ref: string) => po.find((r) => r.number === ref)?.number ?? po.find((r) => r.x3Ref === ref)?.number ?? null;
  return links.map((l) => {
    const target = (screen: DocumentLinkTarget['screen'], ref: string | null): DocumentLinkTarget | null => (ref ? { screen, project: projectCode, ref } : null);
    if (l.kind === 'deliverable') return { ...l, target: target('deliverable', dlvSet.has(l.ref) ? l.ref : null) };
    if (l.kind === 'purchase_order') return { ...l, target: target('order', poOf(l.ref)) };
    if (l.kind === 'punch_item') return { ...l, target: target('punch', punch.has(l.ref) ? l.ref : null) };
    return { ...l, target: null };
  });
}

/**
 * Drawer of a vault record (`showDoc`, 10 §4.5); null when the number is unknown. D-2 = a (R-127): the record, its current
 * revision and its current circuit — no earlier revision, no download log (both stay in Codex). R-128: relations resolved
 * in the record's own project.
 */
export async function getDocumentRecord(number: string): Promise<DocumentRecord | null> {
  const db = await getDb();
  const b = await loadVault(db, eq(documents.number, number));
  const d = b.docs[0];
  if (!d) return null;
  const base = toVault(b, d);
  const [revs, ack, client, links] = await Promise.all([
    db.select().from(documentRevisions).where(and(eq(documentRevisions.documentId, d.id), eq(documentRevisions.revision, d.currentRevision))),
    db.select().from(documentAcknowledgements).where(and(eq(documentAcknowledgements.documentId, d.id), eq(documentAcknowledgements.revision, d.currentRevision))),
    d.projectId ? clientContactOf(db, d.projectId) : Promise.resolve(null),
    linkTargets(db, d.projectId, d.projectCode, base.links),
  ]);
  const current = (b.approvals.get(d.id) ?? []).filter((a) => a.revision === d.currentRevision);
  const signerIds = [...new Set(current.map((a) => (a.signedOn ? a.signedByPersonId : null)).filter((x): x is string => !!x))];
  const signers = new Map(
    (signerIds.length ? await db.select({ id: persons.id, short: persons.shortName }).from(persons).where(inArray(persons.id, signerIds)) : []).map((p) => [p.id, p.short]),
  );
  const decided = [...base.circuitState.approved, ...(base.circuitState.rejection ? [base.circuitState.rejection] : [])];
  const deciders = new Map<string, string>();
  for (const x of decided) if (!deciders.has(x.actorName)) deciders.set(x.actorName, (await findPerson(db, x.actorName))?.shortName ?? x.actorName);
  const approvals = current.map((a) => {
    const k = decided.find((x) => x.step === a.stepPosition && !a.signedOn);
    return {
      position: a.stepPosition, role: a.role, roleLabel: approverRole.label(a.role),
      who: (a.signedOn && a.signedByPersonId ? signers.get(a.signedByPersonId) : null) ?? a.approverName ?? '—', signed: !!a.signedOn, signedOn: a.signedOn,
      keystone: k ? { decision: k.decision, by: deciders.get(k.actorName) ?? k.actorName, on: parisParts(new Date(k.recordedAt)).iso, sync: k.syncStatus } : null,
    };
  });
  const distribution: DistributionRow[] = [
    ...(base.shared
      ? [{ kind: 'client' as const, organisation: client?.organisation ?? '—', contact: client?.contact ?? null, revision: d.currentRevision, date: d.issuedOn, acknowledgedOn: ack[0]?.acknowledgedOn ?? null }]
      : []),
    ...d.recipients.filter((r) => r !== 'client').map((r) => ({ kind: 'internal' as const, recipient: r, label: docRecipient.isCode(r) ? docRecipient.label(r) : r, revision: d.currentRevision, date: d.issuedOn })),
  ];
  return {
    ...base,
    revisions: revs.map((r) => ({
      revision: r.revision, current: true, status: d.status, issuedOn: r.issuedOn, dateText: shortDateOfIso(r.issuedOn), author: r.authorName,
      workingVersions: r.workingVersions, withdrawnOn: r.withdrawnOn,
    })),
    approvals, distribution, links, files: d.typeCode === 'PHO' ? 'photos' : 'native_pdf',
  };
}

/** Client organisation of a project and its client contact (the client user of that organisation), for the distribution row. */
async function clientContactOf(q: Awaited<ReturnType<typeof getDb>> | Tx, projectId: string): Promise<{ organisation: string; contact: string | null; personId: string | null } | null> {
  const [p] = await q.select({ clientId: projects.clientId, name: clients.name }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(eq(projects.id, projectId));
  if (!p?.clientId || !p.name) return null;
  const [u] = await q.select({ short: persons.shortName, id: persons.id }).from(users).innerJoin(persons, eq(persons.id, users.personId)).where(eq(users.clientId, p.clientId));
  return { organisation: p.name, contact: u?.short ?? null, personId: u?.id ?? null };
}

// ── Codex sync state and deposits ──────────────────────────────────────────────────────────────────────

export interface CodexSyncState {
  /** Wall-clock time of the last sync in Europe/Paris ("08:02") and its instant. */
  time: string;
  syncedAt: string;
  /** Records in Codex: the count at the last sync + records created from Keystone since then (412 + new deposits). */
  records: number;
}

/**
 * "Last sync 08:02 · 412 records" (`codexSync`). Delivery 8 (R-033): with the HTTP connector, the last read of Codex's index
 * (its record count), null before the first one — a seeded or mock sync is never shown as a sync with Codex.
 */
export async function getCodexSyncState(): Promise<CodexSyncState | null> {
  const db = await getDb();
  if (codexConnectorMode() === 'http') {
    const [r] = await db.select().from(documentIndexSyncs).where(eq(documentIndexSyncs.source, 'codex')).orderBy(desc(documentIndexSyncs.syncedAt)).limit(1);
    if (!r) return null;
    const p = parisParts(r.syncedAt);
    return { time: `${p.hh}:${p.mm}`, syncedAt: r.syncedAt.toISOString(), records: r.recordCount };
  }
  const [s] = await db.select().from(documentIndexSyncs).orderBy(desc(documentIndexSyncs.syncedAt)).limit(1);
  if (!s) return null;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(eq(documents.isNew, true));
  const p = parisParts(s.syncedAt);
  return { time: `${p.hh}:${p.mm}`, syncedAt: s.syncedAt.toISOString(), records: s.recordCount + n };
}

/**
 * `since` of the next read of Codex's index by the HTTP connector (R-033): the last read's mark — its time, or an earlier mark
 * held while records waited for their project or document type in Keystone (integration review). Null = the whole index
 * (before the first read, or while the first read's skipped records wait).
 */
export async function nextCodexIndexSince(): Promise<Date | null> {
  const db = await getDb();
  const [r] = await db.select({ next: documentIndexSyncs.nextSince }).from(documentIndexSyncs).where(eq(documentIndexSyncs.source, 'codex'))
    .orderBy(desc(documentIndexSyncs.syncedAt)).limit(1);
  return r?.next ?? null;
}

export interface CodexIndexRead {
  /** Codex's index was read (false when IT disabled the connector: nothing was asked). */
  read: boolean;
  /** Records of Keystone's index after the read. */
  records: number;
  applied: number;
  created: number;
  skipped: number;
}

/**
 * HTTP connector (Delivery 8, R-033): reads Codex's index since the last read (the whole index the first time), writes it
 * into Keystone's index (mirror.ts `applyCodexIndex`) and records the read. Throws when Codex is unreachable or answers
 * badly (nothing recorded, the next read asks again). `actorName` null = the scheduled job.
 * Integration review: a read that skipped a record for a project or document type Keystone does not know yet keeps its own
 * `since` as the next one (`awaitsKeystoneData`), so the record comes back once the project or type exists — Codex sends a
 * record again only when it changes; the upserts are idempotent. The read's time stays the banner's "Last sync".
 */
export async function refreshCodexIndex(actorName: string | null, at: Date = new Date()): Promise<CodexIndexRead> {
  const since = await nextCodexIndexSince();
  const r = await readCodexIndex({ since }, at);
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(documents);
  if (!r) return { read: false, records: n, applied: 0, created: 0, skipped: 0 };
  const nextSince = r.skipped.some(awaitsKeystoneData) ? since : at;
  await db.transaction(async (tx) => {
    const actor = actorName ? await findPerson(tx, actorName) : null;
    await tx.insert(documentIndexSyncs).values({ syncedAt: at, recordCount: n, requestedByPersonId: actor?.id ?? null, source: 'codex', nextSince });
  });
  return { read: true, records: n, applied: r.applied, created: r.created, skipped: r.skipped.length };
}

/** Codex project code of a number: "QMS" or the 3-letter prefix of the project code (HLT-026 → HLT). */
const codexProjectCode = (project: string) => (project === QMS ? QMS : project.split('-')[0]);

/**
 * Number previewed by the deposit dialog (`depNumber`): `TYPE-PROJ-SEQ` with SEQ = (records of the type in the
 * project) + 40, the next free one when taken; a new revision keeps the existing number.
 */
export async function previewDepositNumber(input: { typeCode: string; project: string; revisionOf?: string | null }): Promise<string> {
  const db = await getDb();
  return depositNumber(db, input);
}

async function depositNumber(q: Awaited<ReturnType<typeof getDb>> | Tx, input: { typeCode: string; project: string; revisionOf?: string | null }): Promise<string> {
  if (input.revisionOf) return input.revisionOf;
  const projectId = input.project === QMS ? null : (await q.select({ id: projects.id }).from(projects).where(eq(projects.code, input.project)))[0]?.id;
  if (projectId === undefined) throw new Error(`Unknown project ${input.project}`);
  const sameScope = await q
    .select({ number: documents.number })
    .from(documents)
    .where(and(eq(documents.typeCode, input.typeCode), projectId ? eq(documents.projectId, projectId) : isNull(documents.projectId)));
  const taken = new Set((await q.select({ number: documents.number }).from(documents)).map((r) => r.number));
  // The prototype's preview started at records + 40; a production database numbers from records + 1 (R-011).
  for (let seq = sameScope.length + 1 + (await demoFloor(q, 39)); ; seq++) {
    const n = `${input.typeCode}-${codexProjectCode(input.project)}-${String(seq).padStart(3, '0')}`;
    if (!taken.has(n)) return n;
  }
}

export interface DepositInput {
  typeCode: string;
  /** Project code or "QMS". */
  project: string;
  /** "Linked purchase order" / "Linked article" (free text). */
  linkedPo?: string | null;
  linkedPart?: string | null;
  /** New revision of this existing document (drawer "New revision · Codex"). */
  revisionOf?: string | null;
  /** Title of a new record (defaults to the prototype's literal, 10 OQ14). */
  title?: string | null;
}

/** Service of a deposit from its type family (`finish`, logic 5058). */
const depositService = (family: DocFamily): DocService => (family === 'purchasing' ? 'procurement' : family === 'quality' ? 'quality' : family === 'site' ? 'site' : 'pm');

/**
 * "Continue in Codex" (`handoff`): records the hand-off and its result in the index. A new document is created as
 * Draft, rev A, dated `on`, authored by the viewer, prepended to the vault ("New"); a new revision sets the existing
 * record back to Draft (the revision letter is not bumped, as in the prototype — D-1) and resets its approvals.
 */
export async function depositInCodex(input: DepositInput, actorName: string, on: string = CODEX_TODAY_ISO): Promise<{ number: string; created: boolean }> {
  // A-15 (R-033, default to confirm): with Codex connected, a deposit is made in Codex — no Keystone-numbered draft that Codex
  // never receives (the Server Function answers with an "Open Codex" link; R-125 later brings the prefilled deposit form).
  if (codexConnectorMode() === 'http') throw new DepositInCodexOnlyError();
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [type] = await tx.select().from(documentTypes).where(eq(documentTypes.code, input.typeCode));
    if (!type) throw new Error(`Unknown document type ${input.typeCode}`);
    const actor = await findPerson(tx, actorName);
    const link = input.linkedPo?.trim() || null;
    const part = input.linkedPart?.trim() || null;
    let projectId: string | null = null;
    if (input.project !== QMS) {
      const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, input.project));
      if (!p) throw new Error(`Unknown project ${input.project}`);
      projectId = p.id;
    }
    if (input.revisionOf) {
      const [doc] = await tx.select().from(documents).where(eq(documents.number, input.revisionOf));
      if (!doc) throw new Error(`Unknown document ${input.revisionOf}`);
      await tx.update(documents).set({ status: 'draft', updatedAt: new Date() }).where(eq(documents.id, doc.id));
      await tx.update(documentApprovals).set({ signedOn: null, signedByPersonId: null })
        .where(and(eq(documentApprovals.documentId, doc.id), eq(documentApprovals.revision, doc.currentRevision), sql`${documentApprovals.stepPosition} > 0`));
      // Decisions still waiting for Codex concern the revision being replaced.
      await closeCodexEntries(tx, (await openCodexEntries(tx, [doc.id])).map((e) => e.id));
      await tx.insert(documentDeposits).values({
        typeCode: type.code, projectId: doc.projectId, linkedPoRef: link, linkedPartRef: part, contextDocumentId: doc.id, number: doc.number, documentId: doc.id,
        status: 'recorded', requestedByPersonId: actor?.id ?? null, requestedOn: on,
      });
      await writeAudit(tx, {
        actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: doc.number,
        change: `new revision deposited in Codex · status: ${documentStatus.label(doc.status)} → Draft`, area: 'Documents', entityType: 'document', entityId: doc.id, projectId: doc.projectId,
      });
      return { number: doc.number, created: false };
    }
    const number = await depositNumber(tx, { typeCode: type.code, project: input.project });
    const [{ minOrder }] = await tx.select({ minOrder: sql<number>`coalesce(min(${documents.sortOrder}), 1)::int` }).from(documents);
    const authorName = actor?.shortName ?? actorName;
    const [doc] = await tx
      .insert(documents)
      .values({
        number, typeCode: type.code, title: input.title?.trim() || DEPOSIT_DEFAULT_TITLE, projectId, service: depositService(type.family), currentRevision: 'A',
        status: 'draft', issuedOn: on, authorPersonId: actor?.id ?? null, authorName, confidentiality: type.isClientDeliverable ? 'client' : 'internal',
        tags: [link, part].filter((x): x is string => !!x), recipients: [], isNew: true, sortOrder: minOrder - 1,
      })
      .returning({ id: documents.id });
    await insertFirstRevision(tx, doc.id, type.code, on, actor?.id ?? null, authorName, false);
    const links = [...(link ? [{ kind: 'purchase_order' as const, ref: link }] : []), ...(part ? [{ kind: 'article' as const, ref: part }] : [])];
    if (links.length) await tx.insert(documentLinks).values(links.map((l, position) => ({ documentId: doc.id, kind: l.kind, targetRef: l.ref, position })));
    await tx.insert(documentDeposits).values({
      typeCode: type.code, projectId, linkedPoRef: link, linkedPartRef: part, contextDocumentId: null, number, documentId: doc.id, status: 'recorded',
      requestedByPersonId: actor?.id ?? null, requestedOn: on,
    });
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: 'deposited in Codex · Draft rev A', area: 'Documents',
      entityType: 'document', entityId: doc.id, projectId,
    });
    return { number, created: true };
  });
}

/** Revision A and its approval proof (step 0 signed at issue; every step when created released). */
async function insertFirstRevision(tx: Tx, documentId: string, typeCode: string, on: string, authorId: string | null, authorName: string, released: boolean) {
  await tx.insert(documentRevisions).values({ documentId, revision: 'A', position: 0, issuedOn: on, authorPersonId: authorId, authorName, withdrawnOn: null, workingVersions: 1 });
  const steps = await tx.select().from(documentTypeCircuitSteps).where(eq(documentTypeCircuitSteps.typeCode, typeCode)).orderBy(asc(documentTypeCircuitSteps.position));
  const who = await tx
    .select({ role: documentApproverAssignments.role, personId: persons.id, short: persons.shortName })
    .from(documentApproverAssignments)
    .innerJoin(persons, eq(persons.id, documentApproverAssignments.personId))
    .where(isNull(documentApproverAssignments.projectId));
  await tx.insert(documentApprovals).values(
    steps.map((s) => {
      const w = who.find((x) => x.role === s.role);
      return {
        documentId, revision: 'A', stepPosition: s.position, role: s.role, approverPersonId: s.position === 0 ? authorId : (w?.personId ?? null),
        approverName: s.position === 0 ? authorName : (w?.short ?? null), signedOn: s.position === 0 || released ? on : null,
      };
    }),
  );
}

/**
 * Index record of meeting minutes sent from Keystone (`sendMinutes`): MIN, rev A, Released at `on`, authored by the
 * organizer, Client confidentiality for external meetings. Runs inside the caller's transaction. Returns the id.
 */
export async function createMinutesDocument(
  tx: Tx,
  input: { number: string; title: string; projectId: string; authorPersonId: string | null; authorName: string; external: boolean; tags: string[] },
  on: string,
): Promise<string> {
  const [{ minOrder }] = await tx.select({ minOrder: sql<number>`coalesce(min(${documents.sortOrder}), 1)::int` }).from(documents);
  const [doc] = await tx
    .insert(documents)
    .values({
      number: input.number, typeCode: 'MIN', title: input.title, projectId: input.projectId, service: 'pm', currentRevision: 'A', status: 'released',
      issuedOn: on, authorPersonId: input.authorPersonId, authorName: input.authorName, confidentiality: input.external ? 'client' : 'internal',
      tags: input.tags, recipients: [], isNew: true, sortOrder: minOrder - 1,
    })
    .returning({ id: documents.id });
  await insertFirstRevision(tx, doc.id, 'MIN', on, input.authorPersonId, input.authorName, true);
  return doc.id;
}

// ── Lifecycle writers ──────────────────────────────────────────────────────────────────────────────────

async function loadDoc(tx: Tx, number: string) {
  const [d] = await tx.select().from(documents).where(eq(documents.number, number));
  if (!d) throw new Error(`Unknown document ${number}`);
  return d;
}

async function setStatus(number: string, from: DocumentStatus, to: DocumentStatus, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const d = await loadDoc(tx, number);
    if (d.status !== from) throw new Error(`${number} is ${documentStatus.label(d.status)}, not ${documentStatus.label(from)}`);
    const actor = await findPerson(tx, actorName);
    await tx.update(documents).set({ status: to, updatedAt: new Date() }).where(eq(documents.id, d.id));
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `status: ${documentStatus.label(from)} → ${documentStatus.label(to)}`,
      area: 'Documents', entityType: 'document', entityId: d.id, projectId: d.projectId,
    });
  });
}

/** "Freeze" (engineering screens): Draft → Frozen. */
export const freezeDocument = (number: string, actorName: string) => setStatus(number, 'draft', 'frozen', actorName);
/** "Propose release" (engineering screens): Frozen → Release proposed. */
export const proposeDocumentRelease = (number: string, actorName: string) => setStatus(number, 'frozen', 'release_proposed', actorName);

/**
 * A decision refused because the record moved on (stale screen), the request does not fit the circuit, or the actor is not
 * the step's approver (`forbidden`).
 */
export class CodexDecisionError extends Error {
  constructor(public readonly code: 'stale' | 'invalid' | 'forbidden', message: string) {
    super(message);
    this.name = 'CodexDecisionError';
  }
}

/** The record locked for the transaction, its circuit and the circuit state Keystone shows. */
async function lockedCircuit(tx: Tx, number: string) {
  const [row] = await tx.select({ d: documents, projectCode: projects.code }).from(documents).leftJoin(projects, eq(projects.id, documents.projectId))
    .where(eq(documents.number, number)).for('update', { of: documents });
  if (!row) throw new CodexDecisionError('invalid', `Unknown document ${number}`);
  const d = row.d;
  const [steps, appr, entries] = await Promise.all([
    tx.select().from(documentTypeCircuitSteps).where(eq(documentTypeCircuitSteps.typeCode, d.typeCode)).orderBy(asc(documentTypeCircuitSteps.position)),
    tx.select().from(documentApprovals).where(and(eq(documentApprovals.documentId, d.id), eq(documentApprovals.revision, d.currentRevision))),
    openCodexEntries(tx, [d.id]),
  ]);
  const needsStart = isEngineeringDeliverable({ project: row.projectCode ?? QMS, service: d.service, recipients: d.recipients });
  const signed = appr.filter((a) => a.stepPosition > 0 && a.signedOn).map((a) => a.stepPosition);
  const state = codexCircuitState({ status: d.status, revision: d.currentRevision, steps: steps.length, signed, entries, needsStart });
  return { d, steps, signed, state, needsStart };
}

export interface DocumentDecisionInput {
  decision: CodexDecision;
  /** The step the viewer saw open (stale-screen guard); the open step when omitted. */
  step?: number | null;
  /** Reason of a rejection (required by the Server Functions). */
  comment?: string | null;
}

/** Refusal of a decision by someone else than the step's approver or the director (EN source; FR in docs.json). */
export const NOT_THE_APPROVER = 'You are not the approver of this step';

/**
 * "Approve in Codex · {role} · {approver}" (drawer) and Approve / Reject in My approvals (Delivery 7, R-124): records
 * the decision on the step open in Keystone in the Codex outbox, "pending sync with Codex". The index record is not
 * changed — Codex signs the step, releases the record (withdrawing the previous revision) or sends it back, and the
 * refresh brings its answer (src/server/integrations/codex/mirror.ts). The next step opens in Keystone at once; a
 * rejection stops the circuit until Codex answers. Who may decide — the step's named approver or the portfolio director
 * (`canApproveDocument`, src/domain/documents.ts) — is checked by the Server Functions and re-checked here with `actor`.
 */
export async function recordDocumentDecision(
  number: string, input: DocumentDecisionInput, actor: { name: string; role: string }, at: Date = new Date(),
): Promise<{ entryId: string; step: number; role: ApproverRole; releaseRequested: boolean }> {
  if (input.decision !== 'approved' && input.decision !== 'rejected') throw new CodexDecisionError('invalid', 'Invalid decision');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { d, steps, signed, state } = await lockedCircuit(tx, number);
    if (d.status !== 'release_proposed' || state.nextStep == null) throw new CodexDecisionError('stale', `${number} has no approval step open`);
    if (input.step != null && input.step !== state.nextStep) throw new CodexDecisionError('stale', `${number}: step ${input.step} is no longer open`);
    const step = steps.find((x) => x.position === state.nextStep);
    if (!step) throw new CodexDecisionError('invalid', `${number}: unknown circuit step`);
    const person = await findPerson(tx, actor.name);
    // The step's approver as the vault names it (the role's assigned person, else the author) — or the director (P-7).
    if (actor.role !== 'director') {
      const [assigned] = await tx.select({ short: persons.shortName }).from(documentApproverAssignments)
        .innerJoin(persons, eq(persons.id, documentApproverAssignments.personId))
        .where(and(eq(documentApproverAssignments.role, step.role), isNull(documentApproverAssignments.projectId)));
      if (!person || (assigned?.short ?? d.authorName) !== person.shortName) throw new CodexDecisionError('forbidden', NOT_THE_APPROVER);
    }
    const who = person ? nameOf(person) : actor.name;
    const comment = input.decision === 'rejected' ? (input.comment?.trim() || null) : null;
    const entry = await insertCodexEntry(tx, {
      documentId: d.id, documentNumber: d.number, revision: d.currentRevision, kind: 'approval', stepPosition: step.position, role: step.role, decision: input.decision,
      comment, actorName: who, actorPersonId: person?.id ?? null, actorRole: actor.role, recordedAt: at,
    });
    // The last open step approved: every step is signed in Codex or approved in Keystone — Codex releases on sync.
    const releaseRequested = input.decision === 'approved'
      && steps.every((x) => x.position === 0 || x.position === step.position || signed.includes(x.position) || state.approved.some((a) => a.step === x.position));
    const sync = codexSyncStatus.label('pending');
    const role = approverRole.label(step.role);
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: number, occurredAt: at, area: 'Documents', entityType: 'codex_document_outbox', entityId: entry.id, projectId: d.projectId,
      change: `${input.decision} · ${role}${releaseRequested ? ' · release requested' : ''} · ${sync}`,
    });
    await recordActivity(tx, {
      actorName: who, actorPersonId: person?.id, kind: 'change', projectId: d.projectId, occurredAt: at,
      text: `${number} rev ${d.currentRevision} · ${codexDecision.label(input.decision)} · ${role} · ${sync}`,
    });
    return { entryId: entry.id, step: step.position, role: step.role, releaseRequested };
  });
}

/**
 * "Validate release (PM)" of an engineering deliverable (Delivery 7, P-7c = a, R-106): starts the type's approval
 * circuit in Codex through the outbox. Runs inside the caller's transaction (the engineering writer checks the PM).
 * The record stays Release proposed; it is Released when Codex has every step approved.
 */
export async function recordCircuitStart(tx: Tx, number: string, actor: { name: string; role: string }, at: Date = new Date()): Promise<{ entryId: string; revision: string }> {
  const { d, state, needsStart } = await lockedCircuit(tx, number);
  if (!needsStart) throw new CodexDecisionError('invalid', `${number} is not an engineering deliverable`);
  if (d.status !== 'release_proposed') throw new CodexDecisionError('stale', `${number} is not proposed for release`);
  if (state.started) throw new CodexDecisionError('stale', `${number}: the approval circuit has already started`);
  const person = await findPerson(tx, actor.name);
  const who = person ? nameOf(person) : actor.name;
  const entry = await insertCodexEntry(tx, {
    documentId: d.id, documentNumber: d.number, revision: d.currentRevision, kind: 'circuit_start', actorName: who, actorPersonId: person?.id ?? null, actorRole: actor.role,
    recordedAt: at,
  });
  const sync = codexSyncStatus.label('pending');
  await writeAudit(tx, {
    actorName: who, actorPersonId: person?.id, objectRef: number, occurredAt: at, area: 'Documents', entityType: 'codex_document_outbox', entityId: entry.id, projectId: d.projectId,
    change: `release validated by the PM · approval circuit started · ${sync}`,
  });
  await recordActivity(tx, {
    actorName: who, actorPersonId: person?.id, kind: 'change', projectId: d.projectId, occurredAt: at,
    text: `${number} rev ${d.currentRevision} · Release validated by the PM · Approval circuit started · ${sync}`,
  });
  return { entryId: entry.id, revision: d.currentRevision };
}

/** Client portal "Acknowledge receipt" of a shared document's current revision. */
export async function acknowledgeDocument(number: string, actorName: string, on: string = CODEX_TODAY_ISO): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const d = await loadDoc(tx, number);
    const [t] = await tx.select().from(documentTypes).where(eq(documentTypes.code, d.typeCode));
    if (!t || !sharedWithClient(t, d)) throw new Error(`${number} is not shared with the client`);
    const actor = await findPerson(tx, actorName);
    await tx.insert(documentAcknowledgements).values({ documentId: d.id, revision: d.currentRevision, acknowledgedByPersonId: actor?.id ?? null, acknowledgedOn: on })
      .onConflictDoNothing();
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `rev ${d.currentRevision} acknowledged by the client`,
      area: 'Documents', entityType: 'document', entityId: d.id, projectId: d.projectId,
    });
  });
}

/** A deposit refused because Codex is connected (HTTP connector): it is made in Codex itself (A-15, R-033). */
export class DepositInCodexOnlyError extends Error {
  constructor() {
    super('Codex is connected — deposit the document in Codex');
    this.name = 'DepositInCodexOnlyError';
  }
}

/**
 * "Sync now": the mock records a sync of Keystone's own index (count = last count + records created from Keystone); the
 * HTTP connector reads Codex's index (R-033, `refreshCodexIndex`; throws when Codex is unreachable or the connector is
 * disabled). Returns the record count.
 */
export async function syncCodexIndex(actorName: string, at: Date = new Date()): Promise<number> {
  if (codexConnectorMode() === 'http') {
    const r = await refreshCodexIndex(actorName, at);
    if (!r.read) throw new Error('The Codex connector is disabled — the index was not read');
    return r.records;
  }
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [last] = await tx.select().from(documentIndexSyncs).orderBy(desc(documentIndexSyncs.syncedAt)).limit(1);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(documents).where(eq(documents.isNew, true));
    const records = (last?.recordCount ?? 0) + n;
    const actor = await findPerson(tx, actorName);
    await tx.insert(documentIndexSyncs).values({ syncedAt: at, recordCount: last?.recordCount ?? 0, requestedByPersonId: actor?.id ?? null });
    return records;
  });
}
