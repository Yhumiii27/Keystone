import 'server-only';
// Client portal DAL — "My project · client view" (docs/spec/03 §8). Issues are Keystone records scoped to the project
// (CI-nn, zero-padded: CI-08, CI-09, CI-10 — the prototype built "CI-010", 00 §7.16). Decisions read the change
// requests (client step of the approval chain, decided with changes.ts `decideChangeStep`) and the submitted
// deliverables (quality.ts `decideDeliverable`); invoices the project's billing plan (the contract when there is one);
// documents the Codex records shared with the client (documents.ts `listSharedDocuments`, acknowledged there).
// R-137 (L-6): the project manager is notified of a new issue, takes it in charge (In progress), answers and closes it
// from the project's Stakeholders & RACI screen; the client is notified of the answer and of the closure (Keystone
// notifications; no e-mail is sent, X-6). The client sees the answer and the status, never the internal handling.
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { registerReconciliation } from '@/domain/cost-control';
import { CLIENT_ISSUE_HANDLER_ROLES, ISSUE_ACKNOWLEDGEMENT, ISSUE_NOTICE, hasRealAnswer, issueSteps, type IssueStep } from '@/domain/client-issues';
import { clientDocCategories, type ClientDocCategory } from '@/domain/rexclient';
import { getDb } from '@/server/db/client';
import { NOW_ISO, STATUS_ISO, clientIssueStatus, nextBusinessNumber, type ClientIssueStatus } from '@/server/db/codes';
import { clientIssues, persons, projectControls, users } from '@/server/db/schema';
import { listChangeRequestDetails, type ChangeRequestDetail } from './changes';
import { BASE_CURRENCY, type CurrencyCode } from '@/domain/currency';
import { getBillingPlan } from './cashflow';
import { listSharedDocuments, type VaultDocument } from './documents';
import { createNotification } from './notifications';
import { isClientContactOf, managesProject, projectOf, requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';
import { listDeliverables, type DeliverableRow } from './quality';

export type { Actor };

/** Answer recorded with every new issue ("Acknowledged within 2 working days · answered by the project manager"). */
export { ISSUE_ACKNOWLEDGEMENT };

export interface ClientIssueRow {
  number: string;
  title: string;
  raisedOn: string;
  raisedBy: string;
  status: ClientIssueStatus;
  statusLabel: string;
  response: string;
  /** Date of the project manager's last answer (R-137); null while only acknowledged. */
  answeredOn: string | null;
}

/** An issue as the project team handles it (R-137): who took it in charge and when, the steps offered. Internal (P-10b). */
export interface ClientIssueHandlingRow extends ClientIssueRow {
  handledBy: string | null;
  takenOn: string | null;
  closedOn: string | null;
  /** The answer the client sees is a real one (not the automatic acknowledgement). */
  answered: boolean;
  steps: IssueStep[];
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
  /**
   * Categories of the shared documents, computed from the Codex index (L-9 = a, R-138: the prototype's typed CLIENT_DOCS rows
   * are gone): EN source category and type labels, file count, latest issue date.
   */
  documentCategories: ClientDocCategory[];
}

async function issuesOf(projectId: string): Promise<ClientIssueRow[]> {
  const db = await getDb();
  const rows = await db.select().from(clientIssues).where(eq(clientIssues.projectId, projectId)).orderBy(asc(clientIssues.position));
  return rows.map((r) => ({
    number: r.number, title: r.title, raisedOn: r.raisedOn, raisedBy: r.raisedByName, status: r.status, statusLabel: clientIssueStatus.label(r.status), response: r.response,
    answeredOn: r.answeredOn,
  }));
}

/** Client issues of a project as the project team handles them (newest first), with the internal handling (R-137). */
export async function listClientIssuesForTeam(projectCode: string): Promise<ClientIssueHandlingRow[]> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const rows = await db.select().from(clientIssues).where(eq(clientIssues.projectId, p.id)).orderBy(asc(clientIssues.position));
  return rows.map((r) => ({
    number: r.number, title: r.title, raisedOn: r.raisedOn, raisedBy: r.raisedByName, status: r.status, statusLabel: clientIssueStatus.label(r.status), response: r.response,
    answeredOn: r.answeredOn, handledBy: r.handledByName, takenOn: r.takenOn, closedOn: r.closedOn, answered: hasRealAnswer(r.response), steps: issueSteps(r.status),
  }));
}

/** Client issues of a project, newest first (issues raised in Keystone are prepended). */
export async function listClientIssues(projectCode: string): Promise<ClientIssueRow[]> {
  const db = await getDb();
  return issuesOf((await projectOf(db, projectCode)).id);
}

/** Σ amounts of the approved change requests of the register (A-4). */
const approvedChangesOf = (crs: ChangeRequestDetail[]) => registerReconciliation(crs.map((c) => ({ id: c.id, amount: c.amount, status: c.status, wbs: [], clientStep: null }))).approved;

/** Everything the client portal shows for a project. */
export async function getClientPortal(projectCode: string): Promise<ClientPortal> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [issues, crs, dlv, plan, docs, [ctl]] = await Promise.all([
    issuesOf(p.id), listChangeRequestDetails(projectCode), listDeliverables(projectCode), getBillingPlan(projectCode),
    listSharedDocuments(projectCode),
    db.select({ id: projectControls.projectId }).from(projectControls).where(eq(projectControls.projectId, p.id)),
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
    // Delivery 7 (R-068, A-4): approved changes read from the single register (Σ approved change requests); C-9: contract currency.
    contract: plan ? { valueKeur: plan.contractValueKeur, invoicedKeur: plan.invoicedKeur, paidKeur: plan.paidKeur, approvedChangesKeur: ctl ? approvedChangesOf(crs) : 0, currency } : null,
    // L-9 (R-138): the categories follow the shared documents of the Codex index, so they always agree with the table.
    documents: docs, documentCategories: clientDocCategories(docs),
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
    return { number, pmPersonId: p.pmPersonId, raisedBy: who.personId };
  }).then(async (r) => {
    // L-6: the project manager is told (Keystone notification; X-6: no e-mail is sent).
    await notifyPersons([r.pmPersonId], r.raisedBy, {
      kind: 'request', title: ISSUE_NOTICE.raised, sub: `${r.number} · ${text}`, screen: 'stakeholders', params: { issue: r.number }, projectCode,
    });
    return r.number;
  });
}

/**
 * Keystone notification to the users of some persons (the actor excluded). Best effort: a failure is logged, never
 * undoes the write that caused it (the notification store has its own transaction).
 */
async function notifyPersons(
  personIds: (string | null)[], actorPersonId: string | null,
  n: { kind: 'request' | 'approval'; title: string; sub: string; screen: string; params: Record<string, unknown>; projectCode: string },
): Promise<void> {
  const ids = personIds.filter((x): x is string => !!x && x !== actorPersonId);
  if (!ids.length) return;
  try {
    const db = await getDb();
    const roles = (await db.select({ roles: users.roles }).from(users).where(and(inArray(users.personId, ids), eq(users.active, true)))).flatMap((u) => u.roles);
    if (roles.length) await createNotification({ ...n, audience: [...new Set(roles)], toPersonIds: ids });
  } catch (e) {
    console.error('[client issues] notification failed', e);
  }
}

/** The client contacts to tell about an issue: the person who raised it, else the client organisation's contacts. */
async function clientRecipients(projectClientId: string | null, raisedByPersonId: string | null): Promise<string[]> {
  if (raisedByPersonId) return [raisedByPersonId];
  if (!projectClientId) return [];
  const db = await getDb();
  const rows = await db.select({ id: persons.id }).from(persons).leftJoin(users, eq(users.personId, persons.id))
    .where(or(eq(persons.clientId, projectClientId), eq(users.clientId, projectClientId)));
  return [...new Set(rows.map((r) => r.id))];
}

export type IssueHandling = { step: 'take' } | { step: 'answer'; answer: string } | { step: 'close'; answer?: string | null };

/**
 * The project manager's handling of a client issue (R-137, L-6): "Take in charge" (Open → In progress), "Answer" (the
 * answer the client sees; an Open issue is taken in charge at the same time) and "Close" (with a final answer, required
 * when the issue has no real answer yet). The project's manager or the director; with `expected` (the status the viewer
 * saw), an issue that moved on meanwhile is refused ("… has moved on"). The client is notified of an answer and of the
 * closure. Returns the new status.
 */
export async function handleClientIssue(projectCode: string, number: string, h: IssueHandling, actor: Actor, expected?: ClientIssueStatus, on: string = NOW_ISO): Promise<ClientIssueStatus> {
  if (!CLIENT_ISSUE_HANDLER_ROLES.includes(actor.role)) throw new Error('Only the project manager handles client issues');
  const answer = h.step === 'take' ? null : h.answer?.trim() || null;
  if (h.step === 'answer' && !answer) throw new Error('An answer is required');
  if (answer && (answer.length > 2000 || answer === ISSUE_ACKNOWLEDGEMENT)) throw new Error('Invalid answer');
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    const p = await projectOf(tx, projectCode);
    if (!(await managesProject(tx, actor, p))) throw new Error('Only the project manager handles client issues');
    const [i] = await tx.select().from(clientIssues).where(and(eq(clientIssues.projectId, p.id), eq(clientIssues.number, number)));
    if (!i) throw new Error(`Unknown issue ${number} on ${projectCode}`);
    if (expected && i.status !== expected) throw new Error(`${number} has moved on`);
    if (!issueSteps(i.status).includes(h.step)) throw new Error(`${number} cannot be handled from ${clientIssueStatus.label(i.status)}`);
    if (h.step === 'close' && !answer && !hasRealAnswer(i.response)) throw new Error('An answer is required to close the issue');
    const who = await whoIs(tx, actor);
    const to: ClientIssueStatus = h.step === 'close' ? 'closed' : 'in_progress';
    const patch: Partial<typeof clientIssues.$inferInsert> = { status: to, updatedAt: new Date() };
    if (i.status === 'open') Object.assign(patch, { handledByName: who.who, handledByPersonId: who.personId, takenOn: on });
    if (answer) Object.assign(patch, { response: answer, answeredOn: on });
    if (to === 'closed') patch.closedOn = on;
    // Optimistic guard: the update only applies to the status read above (a concurrent step makes it a no-op).
    const updated = await tx.update(clientIssues).set(patch).where(and(eq(clientIssues.id, i.id), eq(clientIssues.status, i.status))).returning({ id: clientIssues.id });
    if (!updated.length) throw new Error(`${number} has moved on`);
    const label = (s: ClientIssueStatus) => clientIssueStatus.label(s);
    await trace(tx, who, {
      objectRef: number,
      change: `${h.step === 'take' ? 'taken in charge' : h.step === 'answer' ? 'answered' : 'closed'} · status: ${label(i.status)} → ${label(to)}${answer ? ` · ${answer}` : ''}`,
      area: 'Client portal', entityType: 'client_issue', entityId: i.id, projectId: p.id,
      activity: h.step === 'take' ? undefined : { text: `${h.step === 'answer' ? 'Answered' : 'Closed'} client issue ${number} · ${i.title}`, kind: 'client' },
    });
    return { to, notify: h.step !== 'take', clientId: p.clientId, raisedBy: i.raisedByPersonId, actorPersonId: who.personId, title: i.title };
  });
  if (done.notify) {
    const recipients = await clientRecipients(done.clientId, done.raisedBy);
    await notifyPersons(recipients, done.actorPersonId, {
      kind: 'request', title: done.to === 'closed' ? ISSUE_NOTICE.closed : ISSUE_NOTICE.answered, sub: `${number} · ${done.title}`, screen: 'client', params: { tab: 'issues' },
      projectCode,
    });
  }
  return done.to;
}

/** Open (not closed) issues of a project ("Open issues · Raised by you"). */
export async function countOpenClientIssues(projectCode: string): Promise<number> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const rows = await db.select({ s: clientIssues.status }).from(clientIssues).where(and(eq(clientIssues.projectId, p.id)));
  return rows.filter((r) => r.s !== 'closed').length;
}
