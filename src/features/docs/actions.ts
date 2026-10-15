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
//   documents shared with them on their organisation's projects (P-10a, P-10b). Delivery 8 (D-2 = a, R-127): the files are in
//   Codex — nothing is written (no Keystone download log, no read event in the audit trail); the answer is the Codex hand-off
//   toast, with a link to the record in Codex for the internal team (clients have no Codex access).
// - "Sync now": the portfolio director (NEW-D3-1: "directeur et administrateur" — Keystone has no administrator role); it also
//   delivers the Codex outbox (mock: the decisions stay pending). Delivery 8 (R-033): with Codex connected (HTTP) it reads
//   Codex's index, and the toast reports sent / pending / refreshed — "index up to date" only when the index was read.
// - Delivery 8 (A-15, R-033, default to confirm): with Codex connected the deposit hand-off is refused with an "Open Codex"
//   link — the document is deposited in Codex itself (no Keystone-numbered draft Codex never receives); mock unchanged.
// - "Acknowledge receipt" (client portal, cpVaultDocs): the client of the project's organisation.
// The Codex hand-off itself is simulated (OPEN QUESTION D-1): the index record is created / reset at once.
import { revalidatePath } from 'next/cache';
import { codexDecisionToast, parseRejectComment, type CodexDecision } from '@/domain/codex-approvals';
import { canApproveDocument, parseDeposit } from '@/domain/documents';
import { DEPOSIT_TYPES } from '@/server/db/codes';
import {
  CodexDecisionError, DepositInCodexOnlyError, acknowledgeDocument, depositInCodex, getDocumentRecord, listVaultDocuments, recordDocumentDecision, syncCodexIndex,
} from '@/server/dal/documents';
import { getProject } from '@/server/dal/projects';
import { canDepositInCodex, canSyncCodex } from '@/domain/rights';
import { clientProjectCodes, getProjectContext, getScreenAccess, type ProjectContext } from '@/server/project-context';
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { getCodexConnector } from '@/server/integrations/codex/connector';
import { codexSyncToastT } from '@/server/integrations/codex/display';
import { codexDocumentUrl, codexHomeUrl } from '@/server/integrations/codex/links';
import { logError } from '@/server/log';
import { getI18n, type Viewer } from '@/server/session';
import { pendingSyncCountText } from './i18n';

export type DocActionResult = { ok: true; toast?: string } | { error: string };

/** NEW-D3-1 refusal: deposits and revisions are the project's internal team's. */
const NOT_TEAM = 'Only the project’s internal team deposits documents in Codex';
/** A-15 (R-033): with Codex connected, deposits are made in Codex itself. */
const DEPOSIT_IN_CODEX = 'Codex is connected — deposit the document in Codex';
export type DepositResult =
  | { ok: true; number: string; created: boolean; toast: string }
  | { error: string; link?: { href: string; label: string } };

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
  const inCodexOnly = async () => {
    const { t } = await getI18n();
    return { error: t(DEPOSIT_IN_CODEX), link: { href: v.revisionOf ? codexDocumentUrl(v.revisionOf) : codexHomeUrl(ctx.project.code), label: t('Open Codex') } };
  };
  if (codexConnectorMode() === 'http') return inCodexOnly();
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
  } catch (e) {
    // The DAL re-checks the connector mode (defense in depth).
    if (e instanceof DepositInCodexOnlyError) return inCodexOnly();
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
    // The DAL re-checks the approver (defense in depth): same refusal as above.
    if (e instanceof CodexDecisionError && e.code === 'forbidden') return { error: e.message };
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

/** Answer of a download: the Codex hand-off toast, with the "Open Codex" link to the record for the internal team. */
export type DownloadResult = { ok: true; toast: string; link: { href: string; label: string } | null } | { error: string };

/** The hand-off toast of a download (the files are stored in Codex, D-2 = a). */
export const DOWNLOAD_IN_CODEX = 'Download needs Codex — the document files are stored in Codex';

/**
 * Download of the current revision (table icon, drawer "Download PDF", revision "Native" / "PDF"). D-2 = a (R-127): the
 * files are stored in Codex and Keystone keeps no download log — after the access checks (the vault's project, a client
 * only the documents shared with them on their own projects, P-10a / P-10b) the answer is the Codex hand-off toast, with a
 * link to the record in Codex except for a client. Nothing is written.
 */
export async function logDownloadAction(project: string, number: string, format: 'PDF' | 'Native' = 'PDF'): Promise<DownloadResult> {
  const access = await vault(project);
  if ('error' in access) return access;
  const { ctx } = access;
  if (format !== 'PDF' && format !== 'Native') return { error: await tr('Invalid request') };
  const d = await findRecord(number);
  if (!d) return { error: await tr('Unknown document') };
  // P-10a / P-10b: a client downloads only the documents shared with them on their own projects.
  const client = ctx.viewer.role === 'client';
  if (client && (!d.shared || !(await clientProjectCodes(ctx.viewer)).has(d.project))) return { error: await tr('Unknown document') };
  const { t } = await getI18n();
  return { ok: true, toast: t(DOWNLOAD_IN_CODEX), link: client ? null : { href: codexDocumentUrl(d.number, d.revision, d.codexUrl), label: t('Open Codex') } };
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
    logError('syncCodexAction: Codex outbox', e, { component: 'codex' });
    return null;
  });
  const mode = codexConnectorMode();
  const { t, lang } = await getI18n();
  if (mode === 'http') {
    // R-033: Codex's index is read; unreachable, the toast says the index was not read (never "up to date").
    let records = 0;
    let indexRead = false;
    try {
      records = await syncCodexIndex(ctx.viewer.name);
      indexRead = true;
    } catch (e) {
      logError('syncCodexAction: Codex index', e, { component: 'codex' });
    }
    refreshAll();
    const toast = codexSyncToastT({ records, indexRead, delivered: outbox?.delivered ?? 0, pending: outbox?.pending ?? 0, refreshed: outbox?.refreshed ?? 0 }, mode, t, lang);
    // A failed delivery, an outbox that could not run or an index not read is reported as an error toast.
    return indexRead && outbox && !outbox.failed ? { ok: true, toast } : { error: toast };
  }
  const records = await syncCodexIndex(ctx.viewer.name);
  refreshAll();
  const toast = codexSyncToastT(records, mode, t, lang);
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
