import 'server-only';
// Quality DAL — non-conformities and the client deliverables register (docs/spec/07 §2.3; client portal 03 §8.4; My
// approvals "NCR verification" and "Deliverable acceptance").
// - NCRs are owned by Vigie (user decision): read through the Vigie quality connector (mirror + progress waiting for
//   Vigie); Keystone records the viewer's step decisions (one step forward; verification / closure by quality) through
//   the connector's outbox ("pending sync with Vigie"). Creation and management happen in Vigie (links in vigie/links.ts).
// - Deliverables are Keystone's: Start → To internal review → Submit to client, and the client's acceptance (PV).
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import {
  DELIVERABLE_ACCEPTANCE_DAYS, DELIVERABLE_STATUS_TAG, NCR_FLOW, NCR_STATUS_TAG, NCR_VERIFIER_ROLES, RACI_CODES, SEVERITY_TAG, STATUS_ISO, addDaysIso, deliverableStatus, deliverableType,
  fmtDOfIso, ncrNextStatus, ncrSeverity, ncrSource, ncrStatus, vigieSyncStatus,
  type DeliverableStatus, type NcrStatus, type NcrVerificationDecision, type RaciCode,
} from '@/server/db/codes';
import { activities, auditEntries, deliverableRaci, deliverables, documents, projects, referenceValues, vigieNcrProgress, vigieNcrs, wbsNodes } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { getVigieQualityConnector, type NcrProgressReceipt, type VigieNcr } from '@/server/integrations/vigie/quality-connector';
import { vigieNcrListUrl, vigieNcrUrl, vigieReportNcrUrl } from '@/server/integrations/vigie/links';
import { initialsOf, isClientContactOf, optionalText, projectOf, requireWorkspace, trace, whoIs, type Actor } from './ops-common';

export type { Actor, NcrProgressReceipt, VigieNcr };
export { vigieNcrListUrl, vigieNcrUrl, vigieReportNcrUrl };

// ── NCRs (Vigie mirror) ────────────────────────────────────────────────────────────────────────────────

export interface NcrRow extends VigieNcr {
  severityLabel: string;
  severityTag: string;
  sourceLabel: string;
  statusLabel: string;
  statusTag: string;
  /** Index in NCR_FLOW (0 Open … 5 Closed): the progress segments filled up to it. */
  stepIndex: number;
  /** Next step of Vigie's status; null when closed. */
  nextStatus: NcrStatus | null;
  nextStatusLabel: string | null;
  open: boolean;
  /** Name of the linked activity in the project's plan ("Steel erection — Bays 3–4"). */
  activityName: string | null;
  /** Step requested in Keystone and pending sync with Vigie, labelled. */
  requestedStatusLabel: string | null;
  pendingSync: boolean;
  /** "Pending sync with Vigie" / "Sync with Vigie failed" / "Sent to Vigie"; null when nothing waits. */
  pendingSyncLabel: string | null;
  /** The viewer may advance it one step from Keystone (not closed, nothing waiting, next step is not Closed). */
  canStep: boolean;
  /** In verification and nothing waiting: the quality manager decides (close / back to corrective action). */
  awaitingVerification: boolean;
}

async function activityNames(projectCode: string): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select({ code: activities.code, name: activities.name }).from(activities).innerJoin(projects, eq(projects.id, activities.projectId)).where(eq(projects.code, projectCode));
  return new Map(rows.map((r) => [r.code, r.name]));
}

function ncrRow(n: VigieNcr, names: Map<string, string>): NcrRow {
  const last = n.pendingProgress.at(-1) ?? null;
  const next = n.status === 'closed' ? null : ncrNextStatus(n.status);
  return {
    ...n, severityLabel: ncrSeverity.label(n.severity), severityTag: SEVERITY_TAG[n.severity], sourceLabel: ncrSource.label(n.source), statusLabel: ncrStatus.label(n.status),
    statusTag: NCR_STATUS_TAG[n.status], stepIndex: NCR_FLOW.indexOf(n.status), nextStatus: next, nextStatusLabel: next ? ncrStatus.label(next) : null,
    open: n.status !== 'closed', activityName: n.activityCode ? names.get(n.activityCode) ?? null : null,
    requestedStatusLabel: n.requestedStatus ? ncrStatus.label(n.requestedStatus) : null, pendingSync: !!last,
    pendingSyncLabel: last ? vigieSyncStatus.label(last.syncStatus) : null, canStep: !!next && next !== 'closed' && !n.requestedStatus,
    awaitingVerification: n.status === 'verification' && !n.requestedStatus,
  };
}

/** NCRs of a project, in Vigie's order (none for projects without data). */
export async function listNcrs(projectCode: string): Promise<NcrRow[]> {
  const [list, names] = await Promise.all([getVigieQualityConnector().listNcrs({ projectCodes: [projectCode] }), activityNames(projectCode)]);
  return list.map((n) => ncrRow(n, names));
}

/** One NCR ("NCR-029"), case-insensitive; null when unknown on that project. */
export async function getNcr(projectCode: string, number: string): Promise<NcrRow | null> {
  return (await listNcrs(projectCode)).find((n) => n.number.toLowerCase() === number.trim().toLowerCase()) ?? null;
}

/**
 * "→ <next step>" / "Move to <next step>": records the next step of the NCR, sent to Vigie. Closing is the quality
 * verification (`verifyNcr`). Rules: recordNcrProgressEntry (src/server/integrations/vigie/quality-progress.ts).
 */
export async function advanceNcr(projectCode: string, number: string, actor: Actor, comment?: string | null): Promise<NcrProgressReceipt> {
  const n = await getNcr(projectCode, number);
  if (!n) throw new Error(`Unknown NCR ${number} on ${projectCode}`);
  if (n.status === 'closed') throw new Error(`${n.number} is closed`);
  return getVigieQualityConnector().recordNcrProgress(projectCode, n.number, { step: ncrNextStatus(n.status), comment }, actor);
}

/** Quality verification (My approvals "NCR verification"): approve → Closed, reject → back to Corrective action; sent to Vigie. */
export async function verifyNcr(projectCode: string, number: string, decision: NcrVerificationDecision, actor: Actor, comment?: string | null): Promise<NcrProgressReceipt> {
  return getVigieQualityConnector().recordNcrProgress(projectCode, number, { verification: decision, comment }, actor);
}

/** NCRs waiting for the viewer's verification on a project: quality role, status Verification, nothing pending (apprItems 4730). */
export async function ncrVerificationQueue(projectCode: string, actor: Actor): Promise<NcrRow[]> {
  if (!NCR_VERIFIER_ROLES.includes(actor.role)) return [];
  return (await listNcrs(projectCode)).filter((n) => n.awaitingVerification);
}

/** Verifications the viewer recorded in Keystone (My approvals "Decided" count). */
export async function ncrVerificationDecidedCount(actor: Actor): Promise<number> {
  const db = await getDb();
  const { who } = await whoIs(db, actor);
  const rows = await db.select({ id: vigieNcrProgress.id }).from(vigieNcrProgress).where(and(eq(vigieNcrProgress.kind, 'verification'), eq(vigieNcrProgress.actorName, who)));
  return rows.length;
}

/** Open critical NCRs per project (Quality nav badge, `qBadge`). */
export async function criticalOpenNcrsByProject(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const n of await getVigieQualityConnector().listNcrs()) if (n.status !== 'closed' && n.severity === 'critical') out[n.projectCode] = (out[n.projectCode] ?? 0) + 1;
  return out;
}

/** NCR references of a project for the supplier scorecard (goods-receipt NCRs on delivered parts): number, source label, part. */
export async function listProjectNcrRefs(projectCode: string): Promise<{ id: string; src: string; part: string }[]> {
  return (await getVigieQualityConnector().listNcrs({ projectCodes: [projectCode] })).map((n) => ({ id: n.number, src: ncrSource.label(n.source), part: n.partRef ?? '' }));
}

// ── Deliverables (Keystone) ────────────────────────────────────────────────────────────────────────────

export interface DeliverableRaciCell {
  role: RaciCode;
  /** Null when the line has nobody in that role ("Without backup (B)"). */
  name: string | null;
  initials: string;
}

export interface DeliverableRow {
  number: string;
  projectCode: string;
  title: string;
  type: string;
  /** Settings label of the type ("Test & inspection reports"). */
  typeLabel: string;
  wbsCode: string;
  /** Name of the WBS element ("Crane installation"); null when the code is not in the project's WBS. */
  wbsName: string | null;
  dueOn: string;
  status: DeliverableStatus;
  statusLabel: string;
  statusTag: string;
  /** Null = "—". */
  revision: string | null;
  issueOn: string | null;
  submittedOn: string | null;
  acceptanceDueOn: string | null;
  acceptedOn: string | null;
  acceptedBy: string | null;
  rejectedOn: string | null;
  reviewComments: string | null;
  /**
   * The register's "Acceptance" text (EN, dates "12 Mar"): "12 Mar · N. Bensaïd", "Accept by 2 Oct", "Issue 30 Sep",
   * "25 Sep · comments issued", "—".
   */
  acceptanceText: string;
  raci: DeliverableRaciCell[];
  /** NCRs of the project impacting this deliverable (Vigie mirror). */
  linkedNcrs: string[];
  /** Issued document in the Codex index. */
  documentNumber: string | null;
  position: number;
}

/** Display text of the acceptance fields (the prototype's `acc`). */
export function acceptanceTextOf(d: Pick<DeliverableRow, 'status' | 'issueOn' | 'acceptanceDueOn' | 'acceptedOn' | 'acceptedBy' | 'rejectedOn'>): string {
  if (d.status === 'accepted' && d.acceptedOn) return `${fmtDOfIso(d.acceptedOn)} · ${d.acceptedBy ?? '—'}`;
  if (d.status === 'rejected' && d.rejectedOn) return `${fmtDOfIso(d.rejectedOn)} · comments issued`;
  if (d.status === 'submitted' && d.acceptanceDueOn) return `Accept by ${fmtDOfIso(d.acceptanceDueOn)}`;
  if (d.issueOn && (d.status === 'in_progress' || d.status === 'internal_review')) return `Issue ${fmtDOfIso(d.issueOn)}`;
  return '—';
}

/** Short form of a person for the acceptance text ("Nadia Bensaïd" → "N. Bensaïd"); external parties unchanged. */
const shortOf = (name: string | null, short: string | null) => short ?? name;

async function loadDeliverables(projectCode: string, numbers?: string[]): Promise<DeliverableRow[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const rows = await db
    .select({ d: deliverables, wbsName: wbsNodes.name, doc: documents.number })
    .from(deliverables)
    .leftJoin(wbsNodes, eq(wbsNodes.id, deliverables.wbsNodeId))
    .leftJoin(documents, eq(documents.id, deliverables.documentId))
    .where(and(eq(deliverables.projectId, p.id), numbers?.length ? inArray(deliverables.number, numbers) : undefined))
    .orderBy(asc(deliverables.position));
  if (!rows.length) return [];
  const [raci, types, ncrs, people] = await Promise.all([
    db.select().from(deliverableRaci).where(inArray(deliverableRaci.deliverableId, rows.map((r) => r.d.id))),
    db.select({ code: referenceValues.code, label: referenceValues.label }).from(referenceValues).where(eq(referenceValues.listKey, 'delivTypes')),
    db.select({ number: vigieNcrs.number, deliv: vigieNcrs.deliverableNumber }).from(vigieNcrs).where(eq(vigieNcrs.projectCode, projectCode)).orderBy(asc(vigieNcrs.position)),
    db.query.persons.findMany({ columns: { id: true, shortName: true } }),
  ]);
  const shortById = new Map(people.map((x) => [x.id, x.shortName]));
  const typeLabel = new Map(types.map((t) => [t.code, t.label]));
  return rows.map(({ d, wbsName, doc }) => {
    const acceptedBy = shortOf(d.acceptedByName, d.acceptedByPersonId ? shortById.get(d.acceptedByPersonId) ?? null : null);
    const base = {
      status: d.status, issueOn: d.issueOn, acceptanceDueOn: d.acceptanceDueOn, acceptedOn: d.acceptedOn, acceptedBy, rejectedOn: d.rejectedOn,
    };
    const cells = raci.filter((r) => r.deliverableId === d.id);
    return {
      number: d.number, projectCode, title: d.title, type: d.type,
      typeLabel: typeLabel.get(d.type) ?? (deliverableType.isCode(d.type) ? deliverableType.label(d.type) : d.type), wbsCode: d.wbsCode, wbsName: wbsName ?? null,
      dueOn: d.dueOn, statusLabel: deliverableStatus.label(d.status), statusTag: DELIVERABLE_STATUS_TAG[d.status],
      revision: d.revision, submittedOn: d.submittedOn, reviewComments: d.reviewComments, ...base, acceptanceText: acceptanceTextOf(base),
      raci: RACI_CODES.map((role) => {
        const c = cells.find((x) => x.role === role);
        return { role, name: c?.name ?? null, initials: c ? initialsOf(c.name) : '' };
      }),
      linkedNcrs: ncrs.filter((n) => n.deliv === d.number).map((n) => n.number), documentNumber: doc ?? null, position: d.position,
    };
  });
}

/** Deliverables register of a project (HLT_DELIVS order; empty for projects without data). */
export async function listDeliverables(projectCode: string): Promise<DeliverableRow[]> {
  return loadDeliverables(projectCode);
}

/** One deliverable ("D-016"), case-insensitive; null when unknown. */
export async function getDeliverable(projectCode: string, number: string): Promise<DeliverableRow | null> {
  return (await loadDeliverables(projectCode)).find((d) => d.number.toLowerCase() === number.trim().toLowerCase()) ?? null;
}

/** Deliverable types offered (Settings › Deliverable types, active, in order). */
export async function listDeliverableTypes(): Promise<{ code: string; label: string }[]> {
  const db = await getDb();
  return db.select({ code: referenceValues.code, label: referenceValues.label }).from(referenceValues)
    .where(and(eq(referenceValues.listKey, 'delivTypes'), eq(referenceValues.active, true))).orderBy(asc(referenceValues.position));
}

/** Producer-side steps of the register (Start, To internal review, Submit to client). */
const PRODUCER_NEXT: Partial<Record<DeliverableStatus, DeliverableStatus>> = { planned: 'in_progress', in_progress: 'internal_review', internal_review: 'submitted' };

async function loadOne(tx: Tx, projectCode: string, number: string) {
  const p = await projectOf(tx, projectCode);
  const [d] = await tx.select().from(deliverables).where(and(eq(deliverables.projectId, p.id), eq(deliverables.number, number)));
  if (!d) throw new Error(`Unknown deliverable ${number} on ${projectCode}`);
  return { p, d };
}

/**
 * "Start" (Planned → In progress), "To internal review" (In progress → Internal review), "Submit to client" (Internal review
 * → Submitted; the client has 10 days from the status date to accept: "Accept by 5 Oct"). `to` must be the next step.
 */
export async function moveDeliverable(projectCode: string, number: string, to: 'in_progress' | 'internal_review' | 'submitted', actor: Actor, on: string = STATUS_ISO): Promise<void> {
  requireWorkspace('quality', actor, 'Quality');
  if (actor.role === 'client') throw new Error('The client accepts or rejects submitted deliverables only');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, d } = await loadOne(tx, projectCode, number);
    if (PRODUCER_NEXT[d.status] !== to) throw new Error(`${number} cannot move from ${deliverableStatus.label(d.status)} to ${deliverableStatus.label(to)}`);
    const who = await whoIs(tx, actor);
    const patch: Partial<typeof deliverables.$inferInsert> = { status: to, updatedAt: new Date() };
    if (to === 'submitted') Object.assign(patch, { submittedOn: on, acceptanceDueOn: addDaysIso(on, DELIVERABLE_ACCEPTANCE_DAYS) });
    await tx.update(deliverables).set(patch).where(eq(deliverables.id, d.id));
    await trace(tx, who, {
      objectRef: number, change: `status: ${deliverableStatus.label(d.status)} → ${deliverableStatus.label(to)}`, area: 'Deliverables', entityType: 'deliverable', entityId: d.id,
      projectId: p.id, activity: to === 'submitted' ? { text: `Submitted deliverable ${number} ${d.title} to the client`, kind: 'client' } : undefined,
    });
  });
}

/**
 * Client acceptance (PV de réception) or rejection of a submitted deliverable — the client contact of the project's
 * client organisation only (register, drawer, My approvals, client portal). Accept stamps the date and the viewer
 * ("25 Sep · N. Bensaïd"); reject records the comments ("comments issued").
 */
export async function decideDeliverable(
  projectCode: string, number: string, decision: 'accepted' | 'rejected', actor: Actor, comments?: string | null, on: string = STATUS_ISO,
): Promise<void> {
  requireWorkspace('quality', actor, 'Quality');
  const note = optionalText(comments, 'Comments');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, d } = await loadOne(tx, projectCode, number);
    if (!(await isClientContactOf(tx, actor, p.clientId))) throw new Error('Only the client accepts or rejects deliverables');
    if (d.status !== 'submitted') throw new Error(`${number} is not submitted to the client`);
    const who = await whoIs(tx, actor);
    const at = new Date();
    if (decision === 'accepted')
      await tx.update(deliverables).set({ status: 'accepted', acceptedOn: on, acceptedByPersonId: who.personId, acceptedByName: who.who, updatedAt: at }).where(eq(deliverables.id, d.id));
    else
      await tx.update(deliverables).set({ status: 'rejected', rejectedOn: on, rejectedByPersonId: who.personId, reviewComments: note ?? 'comments issued', updatedAt: at }).where(eq(deliverables.id, d.id));
    await trace(tx, who, {
      objectRef: number, change: `status: Submitted → ${decision === 'accepted' ? 'Accepted (PV)' : 'Rejected'}${note ? ` · ${note}` : ''}`, area: 'Deliverables',
      entityType: 'deliverable', entityId: d.id, projectId: p.id,
      activity: { text: decision === 'accepted' ? `Accepted deliverable ${number} ${d.title} (PV signed)` : `Rejected deliverable ${number} ${d.title} · comments issued`, kind: 'client' },
    });
  });
}

/** Links the issued document (a Codex index record) to a deliverable (the drawer's drop slot; OPEN QUESTION D-1). */
export async function linkDeliverableDocument(projectCode: string, number: string, documentNumber: string, actor: Actor): Promise<void> {
  requireWorkspace('quality', actor, 'Quality');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, d } = await loadOne(tx, projectCode, number);
    const [doc] = await tx.select({ id: documents.id, projectId: documents.projectId }).from(documents).where(eq(documents.number, documentNumber.trim()));
    if (!doc) throw new Error(`Unknown document ${documentNumber}`);
    if (doc.projectId && doc.projectId !== p.id) throw new Error(`${documentNumber} belongs to another project`);
    await tx.update(deliverables).set({ documentId: doc.id, updatedAt: new Date() }).where(eq(deliverables.id, d.id));
    await trace(tx, await whoIs(tx, actor), { objectRef: number, change: `document: ${documentNumber.trim()}`, area: 'Deliverables', entityType: 'deliverable', entityId: d.id, projectId: p.id });
  });
}

/** Submitted deliverables waiting for the viewer's acceptance (client contact of the project's client; apprItems 4729). */
export async function deliverableAcceptanceQueue(projectCode: string, actor: Actor): Promise<DeliverableRow[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  if (!(await isClientContactOf(db, actor, p.clientId))) return [];
  return (await loadDeliverables(projectCode)).filter((d) => d.status === 'submitted');
}

/** Deliverables the viewer accepted or rejected in Keystone (My approvals "Decided" count; the audit trail of decisions). */
export async function deliverableDecidedCount(actor: Actor): Promise<number> {
  const db = await getDb();
  const { who } = await whoIs(db, actor);
  const rows = await db.select({ change: auditEntries.change }).from(auditEntries)
    .where(and(eq(auditEntries.area, 'Deliverables'), eq(auditEntries.actorName, who), eq(auditEntries.entityType, 'deliverable')));
  return rows.filter((r) => r.change.startsWith('status: Submitted → ')).length;
}

/** Submitted deliverables per project (client portal "Awaiting your decision", client Home). */
export async function submittedDeliverablesByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ code: projects.code }).from(deliverables).innerJoin(projects, eq(projects.id, deliverables.projectId)).where(eq(deliverables.status, 'submitted'));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.code] = (out[r.code] ?? 0) + 1;
  return out;
}
