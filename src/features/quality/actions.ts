'use server';
// Server Functions of Quality — NCR & deliverables (docs/spec/07 §2.3) and of the two My approvals kinds it owns.
// - NCRs are owned by Vigie: Keystone records the viewer's progress — the next step ("→ Containment" / "Move to
//   Containment") or the quality manager's verification (close / back to corrective action) — through the Vigie
//   connector's outbox (src/server/dal/quality.ts → integrations/vigie), "pending sync with Vigie" until Vigie takes it.
//   No Server Function creates or edits an NCR ("New NCR" opens Vigie's report form).
// - Deliverables are Keystone's: Start / To internal review / Submit to client / Start next revision after a rejection
//   (the project team, not the client; R-114), the client's acceptance (PV) or rejection with comments (a client contact
//   of the project's client organisation), the link to the issued document in the Codex index, and "New deliverable"
//   (the project's manager or the director; R-115).
// Each function validates the raw input, checks the viewer server-side with the screen's rules (src/domain/quality.ts:
// not outside the workspace, project not read-only, the role / person that holds the step), writes with the viewer as
// the actor, then revalidates (screen, sidebar badge, My approvals, Home). Messages are English source strings: the
// client shows them with toast `showEn` (FormDialog results are translated here).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { DELIVERABLE_CREATOR_ROLES, deliverableActionFor, ncrActionFor, ncrRequestText, parseNewDeliverable, producerNextOf, type ProducerTarget } from '@/domain/quality';
import { NCR_VERIFIER_ROLES, deliverableStatus, ncrStatus, vigieSyncStatus, type NcrStatus } from '@/server/db/codes';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { getProject } from '@/server/dal/projects';
import {
  advanceNcr, createDeliverable, decideDeliverable, deliverableWbsOptions, getDeliverable, getNcr, linkDeliverableDocument, listDeliverableTypes, moveDeliverable, verifyNcr,
} from '@/server/dal/quality';
import { teamOwnerOptions } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { logError } from '@/server/log';

export type QualityResult = { ok: true; toast: string } | { ok: false; error: string };

const INVALID = 'Invalid request';
const UNKNOWN_PROJECT = 'Unknown project';
const READ_ONLY = 'Quality is read-only for you';
const TEAM_ONLY = 'Only the project team records this progress';
const QUALITY_ONLY = 'Only the quality manager verifies and closes NCRs';
const UNKNOWN_NCR = 'Unknown NCR';
const UNKNOWN_DLV = 'Unknown deliverable';
const STEP_GONE = 'This step is not available any more';
const NOT_YOURS = 'This decision is not waiting for you any more';
const FAILED = 'The progress could not be recorded';
const NOT_SAVED = 'The change could not be saved';

const NCR_NUMBER = /^NCR-\d{2,}$/i;
const DLV_NUMBER = /^D-\d{2,}$/i;
const PRODUCER_TARGETS: readonly ProducerTarget[] = ['in_progress', 'internal_review', 'submitted'];

/** Quality screen, sidebar badge, My approvals and Home change together. */
const refreshAll = () => revalidatePath('/', 'layout');

const str = (v: unknown, max = 60) => (typeof v === 'string' && v.trim().length <= max ? v.trim() : '');

/** EN source → the viewer's language, per " · " segment (FormDialog shows its result as is). */
async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

interface Access {
  code: string;
  actor: { name: string; role: string };
  canEdit: boolean;
}

/** The project and the viewer's edit right on its Quality screen (outside workspace / read-only project → false). */
async function access(projectCode: unknown): Promise<Access | { error: string }> {
  const raw = str(projectCode, 20);
  if (!raw) return { error: INVALID };
  const project = await getProject(raw);
  if (!project) return { error: UNKNOWN_PROJECT };
  const ctx = await getProjectContext(project.code, 'quality');
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role }, canEdit: ctx.canEdit('quality') };
}

const syncText = (s: 'pending' | 'sent' | 'failed') => vigieSyncStatus.label(s);

/**
 * "→ <next step>" (log row) / "Move to <next step>" (drawer): the next step of the NCR, sent to Vigie. Any editor of the
 * project's Quality screen but the client; never Closed (the quality manager's verification); one request at a time.
 */
export async function advanceNcrAction(input: { projectCode: string; number: string; step: string }): Promise<QualityResult> {
  const a = await access(input?.projectCode);
  if ('error' in a) return { ok: false, error: a.error };
  if (!a.canEdit) return { ok: false, error: READ_ONLY };
  if (a.actor.role === 'client') return { ok: false, error: TEAM_ONLY };
  const number = str(input?.number);
  const step = input?.step as NcrStatus;
  if (!NCR_NUMBER.test(number) || !ncrStatus.isCode(step)) return { ok: false, error: INVALID };
  try {
    const n = await getNcr(a.code, number);
    if (!n) return { ok: false, error: UNKNOWN_NCR };
    const next = ncrActionFor(n, { role: a.actor.role, canEdit: a.canEdit });
    if (next?.kind !== 'step' || next.target !== step) {
      refreshAll(); // the row or the drawer is stale
      return { ok: false, error: STEP_GONE };
    }
    const receipt = await advanceNcr(a.code, n.number, a.actor);
    refreshAll();
    return { ok: true, toast: `${n.number} · ${ncrRequestText({ kind: 'step', decision: null, targetStatus: step })} · ${syncText(receipt.syncStatus)}` };
  } catch (e) {
    logError('advanceNcrAction', e);
    return { ok: false, error: FAILED };
  }
}

/**
 * Quality verification of an NCR in Verification (drawer "Move to Closed" / "Back to corrective action", log "→ Closed",
 * My approvals Approve / Reject): approved → Closed, rejected → Corrective action; sent to Vigie. Quality manager only.
 */
export async function verifyNcrAction(input: { projectCode: string; number: string; decision: string }): Promise<QualityResult> {
  const a = await access(input?.projectCode);
  if ('error' in a) return { ok: false, error: a.error };
  if (!a.canEdit) return { ok: false, error: READ_ONLY };
  if (!NCR_VERIFIER_ROLES.includes(a.actor.role)) return { ok: false, error: QUALITY_ONLY };
  const number = str(input?.number);
  const decision = input?.decision === 'approved' || input?.decision === 'rejected' ? input.decision : null;
  if (!NCR_NUMBER.test(number) || !decision) return { ok: false, error: INVALID };
  try {
    const n = await getNcr(a.code, number);
    if (!n) return { ok: false, error: UNKNOWN_NCR };
    if (ncrActionFor(n, { role: a.actor.role, canEdit: a.canEdit })?.kind !== 'verify') {
      refreshAll();
      return { ok: false, error: NOT_YOURS };
    }
    const receipt = await verifyNcr(a.code, n.number, decision, a.actor);
    refreshAll();
    return { ok: true, toast: `${n.number} · ${ncrRequestText({ kind: 'verification', decision, targetStatus: receipt.targetStatus })} · ${syncText(receipt.syncStatus)}` };
  } catch (e) {
    logError('verifyNcrAction', e);
    return { ok: false, error: FAILED };
  }
}

/** "Start" / "To internal review" / "Submit to client" (the client then has 10 days to accept): the project team only. */
export async function moveDeliverableAction(input: { projectCode: string; number: string; to: string }): Promise<QualityResult> {
  const a = await access(input?.projectCode);
  if ('error' in a) return { ok: false, error: a.error };
  if (!a.canEdit) return { ok: false, error: READ_ONLY };
  if (a.actor.role === 'client') return { ok: false, error: TEAM_ONLY };
  const number = str(input?.number);
  const to = input?.to as ProducerTarget;
  if (!DLV_NUMBER.test(number) || !PRODUCER_TARGETS.includes(to)) return { ok: false, error: INVALID };
  try {
    const d = await getDeliverable(a.code, number);
    if (!d) return { ok: false, error: UNKNOWN_DLV };
    if (producerNextOf(d.status) !== to) {
      refreshAll();
      return { ok: false, error: STEP_GONE };
    }
    try {
      await moveDeliverable(a.code, d.number, to, a.actor, undefined, d.status);
    } catch (e) {
      if (e instanceof Error && / has moved on$| cannot move from /.test(e.message)) {
        refreshAll();
        return { ok: false, error: STEP_GONE };
      }
      throw e;
    }
    refreshAll();
    // "Start next revision" names the new revision (R-114).
    const after = d.status === 'rejected' ? await getDeliverable(a.code, d.number) : null;
    return { ok: true, toast: `${d.number} · ${deliverableStatus.label(to)}${after?.revision ? ` · Rev ${after.revision}` : ''}` };
  } catch (e) {
    logError('moveDeliverableAction', e);
    return { ok: false, error: NOT_SAVED };
  }
}

/**
 * "Accept (PV)" / "Reject with comments" (register, drawer, My approvals): a submitted deliverable, decided by a client
 * contact of the project's client organisation. Accept stamps the status date and the viewer; reject keeps the comments.
 */
export async function decideDeliverableAction(input: { projectCode: string; number: string; decision: string; comments?: string | null }): Promise<QualityResult> {
  const a = await access(input?.projectCode);
  if ('error' in a) return { ok: false, error: a.error };
  if (!a.canEdit) return { ok: false, error: READ_ONLY };
  const number = str(input?.number);
  const decision = input?.decision === 'accepted' || input?.decision === 'rejected' ? input.decision : null;
  const comments = input?.comments == null ? null : typeof input.comments === 'string' && input.comments.length <= 2000 ? input.comments : undefined;
  if (!DLV_NUMBER.test(number) || !decision || comments === undefined) return { ok: false, error: INVALID };
  try {
    const [d, ctx] = await Promise.all([getDeliverable(a.code, number), getProjectContext(a.code, 'quality')]);
    if (!d) return { ok: false, error: UNKNOWN_DLV };
    const identity = await getApproverIdentity(ctx.viewer);
    const viewer = { role: a.actor.role, canEdit: a.canEdit, isClientContact: identity.clientProjects.includes(a.code) };
    if (deliverableActionFor(d, viewer)?.kind !== 'decide') {
      refreshAll();
      return { ok: false, error: NOT_YOURS };
    }
    await decideDeliverable(a.code, d.number, decision, a.actor, comments);
    refreshAll();
    return { ok: true, toast: `${d.number} · ${decision === 'accepted' ? 'Accepted' : 'Rejected'}` };
  } catch (e) {
    logError('decideDeliverableAction', e);
    return { ok: false, error: NOT_SAVED };
  }
}

/** "Reject with comments" (drawer dialog): the FormDialog version of the rejection, answers translated. */
export async function rejectDeliverableWithCommentsAction(projectCode: string, number: string, values: Record<string, string>): Promise<FormDialogResult> {
  const comments = values && typeof values.comments === 'string' ? values.comments : '';
  const r = await decideDeliverableAction({ projectCode, number, decision: 'rejected', comments });
  return r.ok ? { toast: await tr(r.toast) } : { error: await tr(r.error) };
}

/** "Link a Codex document" (drawer's Document section): the issued document of the deliverable, a record of the project. */
export async function linkDeliverableDocumentAction(projectCode: string, number: string, values: Record<string, string>): Promise<FormDialogResult> {
  const a = await access(projectCode);
  if ('error' in a) return { error: await tr(a.error) };
  if (!a.canEdit) return { error: await tr(READ_ONLY) };
  if (a.actor.role === 'client') return { error: await tr(TEAM_ONLY) };
  const dlv = str(number);
  const doc = str(values?.doc);
  if (!DLV_NUMBER.test(dlv) || !doc) return { error: await tr(INVALID) };
  try {
    const d = await getDeliverable(a.code, dlv);
    if (!d) return { error: await tr(UNKNOWN_DLV) };
    await linkDeliverableDocument(a.code, d.number, doc, a.actor);
    refreshAll();
    return { toast: await tr(`${d.number} · ${doc} · Issued document linked`) };
  } catch (e) {
    logError('linkDeliverableDocumentAction', e);
    return { error: await tr(NOT_SAVED) };
  }
}

const PM_ONLY = 'Only the project manager creates deliverables';

/** Options of "New deliverable": Settings deliverable types (active), the project's WBS elements and team. */
async function newDeliverableOptions(code: string) {
  const [types, wbs, team] = await Promise.all([listDeliverableTypes(), deliverableWbsOptions(code), teamOwnerOptions(code)]);
  return { types, wbs, team };
}

/**
 * "New deliverable" (R-115, Q-3b): type (Settings list), title, due date, WBS element, responsible (R) and backup (B). The
 * project's manager or the director, on a project they may edit; the data layer re-checks the role and the ownership.
 */
export async function createDeliverableAction(projectCode: string, values: Record<string, string>): Promise<FormDialogResult> {
  const a = await access(projectCode);
  if ('error' in a) return { error: await tr(a.error) };
  if (!a.canEdit) return { error: await tr(READ_ONLY) };
  if (!DELIVERABLE_CREATOR_ROLES.includes(a.actor.role)) return { error: await tr(PM_ONLY) };
  const ctx = await getProjectContext(a.code, 'quality');
  if (!ctx.isLead) return { error: await tr(PM_ONLY) };
  const opts = await newDeliverableOptions(a.code);
  const raw = values && typeof values === 'object' ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
  const parsed = parseNewDeliverable(raw, { types: opts.types, wbs: opts.wbs.map((w) => w.code), team: opts.team });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  try {
    const number = await createDeliverable(a.code, { type: v.type, title: v.title, dueOn: v.dueOn, wbsCode: v.wbsCode, responsible: v.responsible, backup: v.backup }, a.actor);
    refreshAll();
    return { toast: await tr(`${number} · Deliverable added`) };
  } catch (e) {
    console.error('createDeliverableAction', e);
    return { error: await tr(NOT_SAVED) };
  }
}
