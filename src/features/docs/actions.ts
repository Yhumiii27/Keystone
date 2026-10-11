'use server';
// Documents — Codex index Server Functions (docs/spec/10 §4.4–§4.6; 10 §9 document workflow). Each one validates the
// raw input, resolves the project of the vault page and checks the viewer's access server-side, writes through the
// data-layer writers (src/server/dal/documents.ts) with the viewer as the actor (audit rows), then revalidates.
// - "Continue in Codex" (deposit hand-off, new document or new revision): the project's internal team and the director
//   (NEW-D3-1, R-047 — never the client, never another project's vault).
// - "Approve in Codex": the named approver of the next circuit step, or the portfolio director (canApproveDocument).
// - Downloads (table icon, "Download PDF", revision "Native" / "PDF"): every viewer of the record (a read); a client only the
//   documents shared with them on their organisation's projects (P-10a, P-10b).
// - "Sync now": the portfolio director (NEW-D3-1: "directeur et administrateur" — Keystone has no administrator role).
// - "Acknowledge receipt" (client portal, cpVaultDocs): the client of the project's organisation.
// The Codex hand-off itself is simulated (OPEN QUESTION D-1): the index record is created / reset at once.
import { revalidatePath } from 'next/cache';
import { canApproveDocument, parseDeposit } from '@/domain/documents';
import { DEPOSIT_TYPES } from '@/server/db/codes';
import {
  acknowledgeDocument, approveDocumentStep, depositInCodex, getDocumentRecord, listVaultDocuments, logDocumentDownload, syncCodexIndex,
} from '@/server/dal/documents';
import { getProject } from '@/server/dal/projects';
import { canDepositInCodex, canSyncCodex } from '@/domain/rights';
import { clientProjectCodes, getProjectContext, type ProjectContext } from '@/server/project-context';
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { codexSyncToastT } from '@/server/integrations/codex/display';
import { getI18n } from '@/server/session';

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

/** "Approve in Codex · {role} · {approver}": signs the next circuit step; the last one releases the record. */
export async function approveDocumentAction(project: string, number: string): Promise<DocActionResult> {
  const access = await vault(project);
  if ('error' in access) return access;
  const { ctx } = access;
  if (!(await findRecord(number))) return { error: await tr('Unknown document') };
  const record = await getDocumentRecord(number);
  if (!record || !record.canApprove) return { error: await tr('No approval step is pending on this document') };
  if (!canApproveDocument({ short: ctx.viewer.short, role: ctx.viewer.role }, record))
    return { error: await tr('You are not the approver of this step') };
  try {
    await approveDocumentStep(number, ctx.viewer.name);
  } catch {
    return { error: await tr('The approval could not be recorded') };
  }
  refreshAll();
  return { ok: true };
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
  const records = await syncCodexIndex(ctx.viewer.name);
  revalidatePath(`/projects/${ctx.project.code}/documents`);
  const { t, lang } = await getI18n();
  return { ok: true, toast: codexSyncToastT(records, codexConnectorMode(), t, lang) };
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
