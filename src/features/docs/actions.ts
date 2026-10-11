'use server';
// Documents — Codex index Server Functions (docs/spec/10 §4.4–§4.6; 10 §9 document workflow). Each one validates the
// raw input, resolves the project of the vault page and checks the viewer's access server-side, writes through the
// data-layer writers (src/server/dal/documents.ts) with the viewer as the actor (audit rows), then revalidates.
// - "Continue in Codex" (deposit hand-off, new document or new revision): the project's internal team and the director
//   (NEW-D3-1, R-047 — never the client, never another project's vault).
// - "Approve in Codex" (drawer) and Approve / Reject in My approvals: the named approver of the open circuit step, or
//   the portfolio director (canApproveDocument). Delivery 7 (P-7b = a, D-1b = a, R-124): the decision goes to Codex
//   through the outbox ("pending sync with Codex"); the index record changes only when Codex answers. A rejection
//   needs its reason.
// - Downloads (table icon, "Download PDF", revision "Native" / "PDF"): every viewer of the record (a read); a client only the
//   documents shared with them on their organisation's projects (P-10a, P-10b).
// - "Sync now": the portfolio director (NEW-D3-1: "directeur et administrateur" — Keystone has no administrator role); it also
//   delivers the Codex outbox (mock: the decisions stay pending).
// - "Acknowledge receipt" (client portal, cpVaultDocs): the client of the project's organisation.
// The Codex hand-off itself is simulated (OPEN QUESTION D-1): the index record is created / reset at once.
import { revalidatePath } from 'next/cache';
import { codexDecisionToast, parseRejectComment, type CodexDecision } from '@/domain/codex-approvals';
import { canApproveDocument, parseDeposit } from '@/domain/documents';
import { DEPOSIT_TYPES } from '@/server/db/codes';
import {
  CodexDecisionError, acknowledgeDocument, depositInCodex, getDocumentRecord, listVaultDocuments, logDocumentDownload, recordDocumentDecision, syncCodexIndex,
} from '@/server/dal/documents';
import { getProject } from '@/server/dal/projects';
import { canDepositInCodex, canSyncCodex } from '@/domain/rights';
import { clientProjectCodes, getProjectContext, getScreenAccess, type ProjectContext } from '@/server/project-context';
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { getCodexConnector } from '@/server/integrations/codex/connector';
import { codexSyncToastT } from '@/server/integrations/codex/display';
import { getI18n, type Viewer } from '@/server/session';
import { pendingSyncCountText } from './i18n';

export type DocActionResult = { ok: true; toast?: string } | { error: string };

/** NEW-D3-1 refusal: deposits and revisions are the project's internal team's. */
const NOT_TEAM = 'Only the project’s internal team deposits documents in Codex';
export type DepositResult = { ok: true; number: string; created: boolean; toast: string } | { error: string };

/** Sidebar badge, My approvals, the vault and the screens listing documents change together. */
const refreshAll = () => revalidatePath('/', 'layout');

async function tr(english: string) {
  const { t } = await getI18n();
  return t(english);
}

/** Project of the vault page and the viewer's access to it ('Invalid request' / 'Unknown project' otherwise). */
async function vault(project: unknown): Promise<{ ctx: ProjectContext } | { error: string }> {
  if (typeof project !== 'string' || !project) return { error: await tr('Invalid request') };
  const p = await getProject(project);
  if (!p) return { error: await tr('Unknown project') };
  return { ctx: await getProjectContext(p.code, 'docs') };
}

/** A record of the index (the vault lists every project's records under "All projects"; access is per screen, P-1). */
async function findRecord(number: unknown) {
  if (typeof number !== 'string' || !number) return null;
  return (await listVaultDocuments()).find((x) => x.number === number) ?? null;
}

/** "Continue in Codex": records the hand-off; toast "Codex · CER-HLT-042 recorded · synced to Keystone". */
export async function depositInCodexAction(raw: unknown): Promise<DepositResult> {
  const parsed = parseDeposit(raw, DEPOSIT_TYPES);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  const access = await vault(v.project);
  if ('error' in access) return access;
  const { ctx } = access;
  if (!canDepositInCodex(ctx.viewer.role, ctx.outside, ctx.access)) return { error: await tr(NOT_TEAM) };
  // A new revision keeps the record's own type (and title); a new document takes the type confirmed in the dialog. A revision
  // is deposited from the record's own project vault (R-047: the team of that project).
  let typeCode = v.type;
  if (v.revisionOf) {
    const d = await findRecord(v.revisionOf);
    if (!d) return { error: await tr('Unknown document') };
    if (d.project !== ctx.project.code) return { error: await tr(NOT_TEAM) };
    typeCode = d.type;
  }
  try {
    const r = await depositInCodex(
      { typeCode, project: ctx.project.code, linkedPo: v.po, linkedPart: v.part, revisionOf: v.revisionOf, title: v.title || null },
      ctx.viewer.name,
    );
    refreshAll();
    return { ok: true, number: r.number, created: r.created, toast: await tr(`Codex · ${r.number} recorded · synced to Keystone`) };
  } catch {
    return { error: await tr('The hand-off to Codex could not be recorded') };
  }
}

const NOT_YOURS = 'This decision is not waiting for you any more';

/**
 * Records the viewer's decision on the circuit step open in Keystone (the step they saw: `step`), sends it to Codex
 * through the connector and answers the toast "RPT-HLT-014 · Approved · Pending sync with Codex" (EN source).
 */
async function decide(viewer: Viewer, number: string, decision: CodexDecision, step: number | null, comment: string | null): Promise<{ ok: true; toast: string } | { error: string }> {
  const record = await getDocumentRecord(number);
  if (!record) return { error: 'Unknown document' };
  if (!record.canApprove || (step != null && record.circuitState.nextStep !== step)) return { error: step != null ? NOT_YOURS : 'No approval step is pending on this document' };
  if (!canApproveDocument({ short: viewer.short, role: viewer.role }, record)) return { error: 'You are not the approver of this step' };
  try {
    const r = await recordDocumentDecision(number, { decision, step: record.circuitState.nextStep, comment }, { name: viewer.name, role: viewer.role });
    const sync = await getCodexConnector().afterRecord(r.entryId).catch(() => 'pending' as const);
    refreshAll();
    return { ok: true, toast: codexDecisionToast(number, decision, sync) };
  } catch (e) {
    if (e instanceof CodexDecisionError && e.code === 'stale') {
      refreshAll(); // the drawer or the inbox row is stale
      return { error: NOT_YOURS };
    }
    console.error('decide document', e);
    return { error: 'The approval could not be recorded' };
  }
}

/**
 * "Approve in Codex · {role} · {approver}" (drawer): records the approval of the open step for Codex — the record keeps
 * its Codex status and approval proof until Codex answers ("Approved · Pending sync with Codex").
 */
export async function approveDocumentAction(project: string, number: string): Promise<DocActionResult> {
  const access = await vault(project);
  if ('error' in access) return access;
  const { ctx } = access;
  if (!(await findRecord(number))) return { error: await tr('Unknown document') };
  const r = await decide(ctx.viewer, number, 'approved', null, null);
  if ('error' in r) return { error: await tr(r.error) };
  return { ok: true, toast: await tr(r.toast) };
}

/** Result of an inline decision of My approvals: EN source strings (the inbox shows them with toast.showEn). */
export type InboxDocDecisionResult = { ok: true; toast: string } | { ok: false; error: string };

const DOC_NUMBER = /^[A-Z0-9]+(?:-[A-Z0-9]+){1,4}$/;

/**
 * Approve / Reject of a "Codex document" row of My approvals (Delivery 7, R-124): the same rules as the drawer — the
 * named approver of the open step or the director, the step the row showed still open — plus the reason of a
 * rejection. Refused outside the inbox's workspace.
 */
export async function decideDocumentFromInboxAction(input: { number: string; step: number; decision: string; comment?: string }): Promise<InboxDocDecisionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit) return { ok: false, error: 'Read-only — you cannot decide from this inbox' };
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const step = input?.step;
  const decision = input?.decision === 'approved' || input?.decision === 'rejected' ? input.decision : null;
  if (!DOC_NUMBER.test(number) || !Number.isInteger(step) || step < 1 || step > 20 || !decision) return { ok: false, error: 'Invalid request' };
  let comment: string | null = null;
  if (decision === 'rejected') {
    const c = parseRejectComment(input.comment);
    if (!c.ok) return { ok: false, error: c.error };
    comment = c.value;
  }
  const r = await decide(viewer, number, decision, step, comment);
  return 'error' in r ? { ok: false, error: r.error } : r;
}

/** Download of the current revision: appends "{viewer} · rev D · 29 Sep · PDF" to the download log. */
export async function logDownloadAction(project: string, number: string, format: 'PDF' | 'Native' = 'PDF'): Promise<DocActionResult> {
  const access = await vault(project);
  if ('error' in access) return access;
  const { ctx } = access;
  if (format !== 'PDF' && format !== 'Native') return { error: await tr('Invalid request') };
  const d = await findRecord(number);
  if (!d) return { error: await tr('Unknown document') };
  // P-10a / P-10b: a client downloads only the documents shared with them on their own projects.
  if (ctx.viewer.role === 'client' && (!d.shared || !(await clientProjectCodes(ctx.viewer)).has(d.project))) return { error: await tr('Unknown document') };
  await logDocumentDownload(number, ctx.viewer.name, format);
  revalidatePath(`/projects/${ctx.project.code}/documents`);
  return { ok: true };
}

/**
 * "Sync now": records a sync of the Codex index. R-021: Codex is a mock until its connector exists, so the toast says the
 * run is simulated ("Codex · simulated sync (mock connector) · 412 records").
 */
export async function syncCodexAction(project: string): Promise<DocActionResult> {
  const access = await vault(project);
  if ('error' in access) return access;
  const { ctx } = access;
  if (!canSyncCodex(ctx.viewer.role, ctx.outside)) return { error: await tr('Only the portfolio director synchronises the Codex index') };
  // Delivery 7 (R-124): delivers the approval outbox first (mock connector: the decisions stay pending).
  const outbox = await getCodexConnector().sync().catch((e) => {
    console.error('syncCodexAction: outbox', e);
    return null;
  });
  const records = await syncCodexIndex(ctx.viewer.name);
  refreshAll();
  const { t, lang } = await getI18n();
  const toast = codexSyncToastT(records, codexConnectorMode(), t, lang);
  return { ok: true, toast: outbox?.pending ? `${toast} · ${pendingSyncCountText(outbox.pending, lang)}` : toast };
}

/** Client portal "Acknowledge receipt" of a shared document's current revision (`engOv.ack[id|rev] = true`). */
export async function acknowledgeDocumentAction(project: string, number: string): Promise<DocActionResult> {
  const access = await vault(project);
  if ('error' in access) return access;
  const { ctx } = access;
  if (ctx.viewer.role !== 'client' || !ctx.isMine) return { error: await tr('Only the client can acknowledge receipt') };
  const d = await findRecord(number);
  if (!d || d.project !== ctx.project.code || !d.shared) return { error: await tr('Unknown document') };
  if (d.acknowledged) return { ok: true };
  await acknowledgeDocument(number, ctx.viewer.name);
  refreshAll();
  return { ok: true };
}
