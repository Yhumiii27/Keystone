import 'server-only';
// Data of the client status report (C-5 audience `client`, generated from Trends and sent by the project team — clients never
// open Keystone, D9-06 / D9-22; this was the client portal's DAL, docs/spec/03 §8). Decisions read the change requests (client
// step of the approval chain, recorded by the project's leads with changes.ts `decideChangeStep`) and the submitted
// deliverables (the client's acceptance recorded by the project's leads, quality.ts `decideDeliverable`); invoices the
// project's billing plan (the contract when there is one). The client issues and the shared documents went with the portal.
import { eq } from 'drizzle-orm';
import { currentStep } from '@/domain/change-control';
import { registerReconciliation } from '@/domain/cost-control';
import { getDb } from '@/server/db/client';
import { projectControls } from '@/server/db/schema';
import { listChangeRequestDetails, type ChangeRequestDetail } from './changes';
import { BASE_CURRENCY, type CurrencyCode } from '@/domain/currency';
import { getBillingPlan } from './cashflow';
import { projectOf } from './ops-common';
import { listDeliverables, type DeliverableRow } from './quality';

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

export interface ClientReportData {
  projectCode: string;
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
}

/** Σ amounts of the approved change requests of the register (A-4). */
const approvedChangesOf = (crs: ChangeRequestDetail[]) => registerReconciliation(crs.map((c) => ({ id: c.id, amount: c.amount, status: c.status, wbs: [], clientStep: null }))).approved;

/** Everything the client status report shows for a project. */
export async function getClientReportData(projectCode: string): Promise<ClientReportData> {
  const db = await getDb();
  const p = await projectOf(db, projectCode);
  const [crs, dlv, plan, [ctl]] = await Promise.all([
    listChangeRequestDetails(projectCode), listDeliverables(projectCode), getBillingPlan(projectCode),
    db.select({ id: projectControls.projectId }).from(projectControls).where(eq(projectControls.projectId, p.id)),
  ]);
  const clientStep = (c: ChangeRequestDetail) => c.chain.find((s) => s.step === 'client')?.decision ?? null;
  // Delivery 8: a request waits for the client once its current step is theirs (R-069, P-6b — after the PM and the director); the
  // internal cost category of a request (R-081) never goes into the client's report.
  const forClient = (c: ChangeRequestDetail): ChangeRequestDetail => ({ ...c, costCategoryCode: null, requestedByPersonId: null });
  const decisions: ClientDecision[] = [
    ...crs.filter((c) => c.status === 'in_review' && currentStep(c.chain) === 'client')
      .map((c) => ({ kind: 'change_request' as const, id: c.id, title: c.title, changeRequest: forClient(c), deliverable: null })),
    ...dlv.filter((d) => d.status === 'submitted').map((d) => ({ kind: 'deliverable' as const, id: d.number, title: d.title, changeRequest: null, deliverable: d })),
  ];
  const decided: ClientDecided[] = [
    ...crs.filter((c) => clientStep(c) === 'ok' || clientStep(c) === 'rejected').map((c) => ({
      kind: 'change_request' as const, id: c.id, title: c.title, changeRequest: forClient(c), deliverable: null, state: clientStep(c) === 'ok' ? 'approved' as const : 'rejected' as const,
    })),
    ...dlv.filter((d) => d.status === 'accepted' || d.status === 'rejected').map((d) => ({
      kind: 'deliverable' as const, id: d.number, title: d.title, changeRequest: null, deliverable: d, state: d.status as 'accepted' | 'rejected',
    })),
  ];
  // The billing plan in the contract's currency (C-9): the amounts of the client's own contract; due dates follow the
  // contract's payment rule (R-076); an amendment's milestones appear once it is signed (NEW-D3-3).
  const invoices: ClientInvoiceRow[] = (plan?.milestones ?? []).map((m) => ({
    milestoneNumber: m.number, milestone: m.label, amountKeur: m.amountKeur, status: m.status, statusLabel: m.statusLabel, invoiceNumber: m.invoiceNumber,
    dueOn: m.paymentDueOn, paidOn: m.paidOn,
  }));
  const currency = plan?.currency ?? BASE_CURRENCY;
  return {
    projectCode, decisions, decided, invoices, currency,
    // Delivery 7 (R-068, A-4): approved changes read from the single register (Σ approved change requests); C-9: contract currency.
    contract: plan ? { valueKeur: plan.contractValueKeur, invoicedKeur: plan.invoicedKeur, paidKeur: plan.paidKeur, approvedChangesKeur: ctl ? approvedChangesOf(crs) : 0, currency } : null,
  };
}
