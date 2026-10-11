import 'server-only';
// Approval-item provider registry — the server side of "My approvals" (docs/spec/08 §7, 00 §7.8): every kind
// that needs a decision registers one provider (one file per kind in this folder); the inbox of a viewer is the
// concatenation of the providers' items in the prototype's push order (08 §7.5), Codex documents last.
//
//   getApprovalInbox(viewer, { projectCode, lang })   → items + "Decided this week" (the My approvals page)
//   approvalCount(viewer, projectCode?)               → sidebar badge of the current project
//   approvalCountsByProject(viewer, codes)            → badge per project (the shell's projectBadges shape)
//
// Project-bound kinds follow the current project (default: the viewer's last project, `ks-project` cookie).
import type { Persona } from '@/config/personas';
import type { ApprovalItem } from '@/domain/approvals';
import { CLIENT_APPROVAL_KINDS, clientRefusedProject } from '@/domain/rights';
import type { Lang } from '@/i18n/translate';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { getProject } from '@/server/dal/projects';
import { getLastProject } from '@/server/session';
import { changeRequestProvider } from './change-requests';
import { codexDocumentProvider } from './codex-documents';
import { contingencyDrawProvider } from './contingency-draws';
import { deliverableProvider } from './deliverables';
import { deliveryQcProvider } from './delivery-qc';
import { ecoProvider } from './ecos';
import { forcedStageChangeProvider } from './forced-stage-changes';
import { invoiceProvider } from './invoices';
import { ncrVerificationProvider } from './ncr-verification';
import { purchaseOrderProvider } from './purchase-orders';
import { resourceRequestProvider } from './resource-requests';
import { rfqAwardProvider } from './rfq-awards';
import type { ApprovalContext, ApprovalProvider } from './types';
import { logError } from '@/server/log';

export type { ApprovalContext, ApprovalProvider } from './types';

/** Registered providers, in inbox order (APPROVAL_KINDS). */
export const APPROVAL_PROVIDERS: readonly ApprovalProvider[] = [
  resourceRequestProvider,
  purchaseOrderProvider,
  ecoProvider,
  deliveryQcProvider,
  forcedStageChangeProvider,
  changeRequestProvider,
  contingencyDrawProvider,
  deliverableProvider,
  rfqAwardProvider,
  invoiceProvider,
  ncrVerificationProvider,
  codexDocumentProvider,
];

export interface ApprovalInbox {
  /** Current project the project-bound kinds were computed for (null when unknown). */
  projectCode: string | null;
  items: ApprovalItem[];
  /** "Decided this week": the viewer's decisions on the kinds they decide. */
  decided: number;
}

async function contextOf(viewer: Persona, projectCode: string | undefined, lang: Lang): Promise<ApprovalContext> {
  const code = projectCode ?? (await getLastProject());
  const [identity, found] = await Promise.all([getApproverIdentity(viewer), getProject(code)]);
  // P-10a (R-042): a client's project-bound kinds never cover another organisation's project.
  const project = found && clientRefusedProject(viewer, found) ? null : found;
  return { viewer: identity, project, lang };
}

/**
 * Providers that may reach the viewer: every one, except for a client (P-10b, R-043) — change requests and deliverable
 * acceptance only, never purchasing, NCR or internal kinds.
 */
const providersFor = (viewer: Persona): readonly ApprovalProvider[] =>
  viewer.role === 'client' ? APPROVAL_PROVIDERS.filter((p) => CLIENT_APPROVAL_KINDS.includes(p.kind)) : APPROVAL_PROVIDERS;

/** The viewer's inbox (My approvals page). */
export async function getApprovalInbox(viewer: Persona, opts: { projectCode?: string; lang?: Lang } = {}): Promise<ApprovalInbox> {
  const ctx = await contextOf(viewer, opts.projectCode, opts.lang ?? 'en');
  const providers = providersFor(viewer);
  const [items, decided] = await Promise.all([
    Promise.all(providers.map((p) => p.items(ctx))),
    Promise.all(providers.map((p) => p.decided(ctx))),
  ]);
  return { projectCode: ctx.project?.code ?? null, items: items.flat(), decided: decided.reduce((a, n) => a + n, 0) };
}

/** Item count of a provider; a failing provider counts 0 (the sidebar must never break). */
async function safeCount(p: ApprovalProvider, ctx: ApprovalContext): Promise<number> {
  try {
    return (await p.items(ctx)).length;
  } catch (e) {
    logError("Approvals provider", e, { provider: p.kind });
    return 0;
  }
}

/** Number of items waiting for the viewer (My approvals sidebar badge) on a project (default: last project used). */
export async function approvalCount(viewer: Persona, projectCode?: string): Promise<number> {
  const ctx = await contextOf(viewer, projectCode, 'en');
  return (await Promise.all(providersFor(viewer).map((p) => safeCount(p, ctx)))).reduce((a, n) => a + n, 0);
}

/**
 * Badge per project code (global kinds computed once, project-bound kinds per project) — the shape of the shell's
 * `projectBadges[code].myapprovals`.
 */
export async function approvalCountsByProject(viewer: Persona, codes: string[]): Promise<Record<string, number>> {
  const base = await contextOf(viewer, codes[0] ?? '', 'en');
  const providers = providersFor(viewer);
  const globals = providers.filter((p) => p.scope === 'global');
  const perProject = providers.filter((p) => p.scope === 'project');
  const global = (await Promise.all(globals.map((p) => safeCount(p, base)))).reduce((a, n) => a + n, 0);
  const out: Record<string, number> = {};
  await Promise.all(
    codes.map(async (code) => {
      const found = await getProject(code);
      const ctx = { ...base, project: found && clientRefusedProject(viewer, found) ? null : found };
      out[code] = global + (await Promise.all(perProject.map((p) => safeCount(p, ctx)))).reduce((a, n) => a + n, 0);
    }),
  );
  return out;
}
