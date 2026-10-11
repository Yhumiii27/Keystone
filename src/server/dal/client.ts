import 'server-only';
// Client portal DAL — "My project · client view" (docs/spec/03 §8). Issues are Keystone records scoped to the project
// (CI-nn, zero-padded: CI-08, CI-09, CI-10 — the prototype built "CI-010", 00 §7.16). Decisions read the change
// requests (client step of the approval chain, decided with changes.ts `decideChangeStep`) and the submitted
// deliverables (quality.ts `decideDeliverable`); invoices the project's billing plan (the contract when there is one);
// documents the Codex records shared with the client (documents.ts `listSharedDocuments`, acknowledged there).
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { STATUS_ISO, clientIssueStatus, nextBusinessNumber, type ClientIssueStatus } from '@/server/db/codes';
import { clientDocumentCategories, clientIssues, projectControls } from '@/server/db/schema';
import { listChangeRequestDetails, type ChangeRequestDetail } from './changes';
import { BASE_CURRENCY, type CurrencyCode } from '@/domain/currency';
import { getBillingPlan } from './cashflow';
import { listSharedDocuments, type VaultDocument } from './documents';
import { isClientContactOf, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';
import { listDeliverables, type DeliverableRow } from './quality';

export type { Actor };

/** Answer recorded with every new issue ("Acknowledged within 2 working days · answered by the project manager"). */
export const ISSUE_ACKNOWLEDGEMENT = 'Acknowledged — response within 2 working days';

export interface ClientIssueRow {
  number: string;
  title: string;
  raisedOn: string;
  raisedBy: string;
  status: ClientIssueStatus;
  statusLabel: string;
  response: string;
}

export interface ClientDecision {
  kind: 'change_request' | 'deliverable';
  /** "CR-008" / "D-014". */
  id: string;
  title: string;
  changeRequest: ChangeRequestDetail | null;
  deliverable: DeliverableRow | null;
}

export interface ClientDecided extends ClientDecision {
  /** Change request: the client's step decision; deliverable: its status. */
  state: 'approved' | 'rejected' | 'accepted';
}

export interface ClientInvoiceRow {
  /** "M3" (contract) or null (legacy plan). */
  milestoneNumber: string | null;
  milestone: string;
  amountKeur: number;
  status: 'planned' | 'invoiced' | 'paid';
  statusLabel: string;
  /** Customer invoice issued for the milestone ("INV-2026-003"), when there is one. */
  invoiceNumber: string | null;
  dueOn: string | null;
  paidOn: string | null;
}

export interface ClientPortal {
  projectCode: string;
  issues: ClientIssueRow[];
  decisions: ClientDecision[];
  decided: ClientDecided[];
  invoices: ClientInvoiceRow[];
  /**
   * Contract summary: value, invoiced, paid (thousands of the contract's currency, C-9) and approved changes (k€); null without
   * a billing plan. An internal project (contract value 0) keeps its rows (€0k), as the prototype's `cpInvKpis`.
   */
  contract: { valueKeur: number; invoicedKeur: number; paidKeur: number; approvedChangesKeur: number; currency: CurrencyCode } | null;
  /** C-9: currency of the invoices and of the contract summary (the contract's, EUR for a legacy plan). */
  currency: CurrencyCode;
  documents: VaultDocument[];
  /** CLIENT_DOCS categories (not rendered by the prototype, L-9). */
  documentCategories: { category: string; description: string; fileCount: string }[];
}

async function issuesOf(projectId: string): Promise<ClientIssueRow[]> {
  const db = await getDb();
  const rows = await db.select().from(clientIssues).where(eq(clientIssues.projectId, projectId)).orderBy(asc(clientIssues.position));
  return rows.map((r) => ({
    number: r.number, title: r.title, raisedOn: r.raisedOn, raisedBy: r.raisedByName, status: r.status, statusLabel: clientIssueStatus.label(r.status), response: r.response,
  }));
}

/** Client issues of a project, newest first (issues raised in Keystone are prepended). */
export async function listClientIssues(projectCode: string): Promise<ClientIssueRow[]> {
  const db = await getDb();
  return issuesOf((await projectOf(db, projectCode)).id);
}

/** Everything the client portal shows for a project. */
export async function getClientPortal(projectCode: string): Promise<ClientPortal> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [issues, crs, dlv, plan, docs, cats, [ctl]] = await Promise.all([
    issuesOf(p.id), listChangeRequestDetails(projectCode), listDeliverables(projectCode), getBillingPlan(projectCode),
    listSharedDocuments(projectCode),
    db.select().from(clientDocumentCategories).where(eq(clientDocumentCategories.projectId, p.id)).orderBy(asc(clientDocumentCategories.position)),
    db.select({ chg: projectControls.reconChangesKeur }).from(projectControls).where(eq(projectControls.projectId, p.id)),
  ]);
  const clientStep = (c: ChangeRequestDetail) => c.chain.find((s) => s.step === 'client')?.decision ?? null;
  const decisions: ClientDecision[] = [
    ...crs.filter((c) => c.status === 'in_review' && clientStep(c) === 'pending').map((c) => ({ kind: 'change_request' as const, id: c.id, title: c.title, changeRequest: c, deliverable: null })),
    ...dlv.filter((d) => d.status === 'submitted').map((d) => ({ kind: 'deliverable' as const, id: d.number, title: d.title, changeRequest: null, deliverable: d })),
  ];
  const decided: ClientDecided[] = [
    ...crs.filter((c) => clientStep(c) === 'ok' || clientStep(c) === 'rejected').map((c) => ({
      kind: 'change_request' as const, id: c.id, title: c.title, changeRequest: c, deliverable: null, state: clientStep(c) === 'ok' ? 'approved' as const : 'rejected' as const,
    })),
    ...dlv.filter((d) => d.status === 'accepted' || d.status === 'rejected').map((d) => ({
      kind: 'deliverable' as const, id: d.number, title: d.title, changeRequest: null, deliverable: d, state: d.status as 'accepted' | 'rejected',
    })),
  ];
  // The billing plan in the contract's currency (C-9): the client reads the amounts of its own contract; due dates follow the
  // contract's payment rule (R-076); an amendment's milestones appear once it is signed (NEW-D3-3).
  const invoices: ClientInvoiceRow[] = (plan?.milestones ?? []).map((m) => ({
    milestoneNumber: m.number, milestone: m.label, amountKeur: m.amountKeur, status: m.status, statusLabel: m.statusLabel, invoiceNumber: m.invoiceNumber,
    dueOn: m.paymentDueOn, paidOn: m.paidOn,
  }));
  const currency = plan?.currency ?? BASE_CURRENCY;
  return {
    projectCode, issues, decisions, decided, invoices, currency,
    contract: plan ? { valueKeur: plan.contractValueKeur, invoicedKeur: plan.invoicedKeur, paidKeur: plan.paidKeur, approvedChangesKeur: ctl?.chg ?? 0, currency } : null,
    documents: docs, documentCategories: cats.map((c) => ({ category: c.category, description: c.description, fileCount: c.fileCountText })),
  };
}

/**
 * "Raise issue": a new Open issue of the project (CI-08, CI-09…), raised by the viewer on the status date with the
 * standard acknowledgement. The project's client contacts and the director (client portal workspace) may raise one.
 */
export async function raiseClientIssue(projectCode: string, title: string, actor: Actor, on: string = STATUS_ISO): Promise<string> {
  requireWorkspace('client', actor, 'My project');
  const text = requiredText(title, 'Issue', 500);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    if (actor.role !== 'director' && !(await isClientContactOf(tx, actor, p.clientId))) throw new Error('Only the project’s client raises issues here');
    const existing = await tx.select({ n: clientIssues.number, pos: clientIssues.position }).from(clientIssues).where(eq(clientIssues.projectId, p.id));
    const number = nextBusinessNumber(existing.map((e) => e.n), 'CI-', 2);
    const who = await whoIs(tx, actor);
    const [row] = await tx.insert(clientIssues).values({
      projectId: p.id, number, title: text, raisedOn: on, raisedByName: who.who, raisedByPersonId: who.personId, status: 'open', response: ISSUE_ACKNOWLEDGEMENT,
      position: existing.reduce((m, e) => Math.min(m, e.pos - 1), 0),
    }).returning({ id: clientIssues.id });
    await trace(tx, who, {
      objectRef: number, change: `issue raised · ${text}`, area: 'Client portal', entityType: 'client_issue', entityId: row.id, projectId: p.id,
      activity: { text: `Raised issue ${number} · ${text}`, kind: 'client' },
    });
    return number;
  });
}

/** Open (not closed) issues of a project ("Open issues · Raised by you"). */
export async function countOpenClientIssues(projectCode: string): Promise<number> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const rows = await db.select({ s: clientIssues.status }).from(clientIssues).where(and(eq(clientIssues.projectId, p.id)));
  return rows.filter((r) => r.s !== 'closed').length;
}
