'use server';
// Server Functions of Quality — NCR & deliverables (docs/spec/07 §2.3) and of the two My approvals kinds it owns.
// - NCRs are owned by Vigie: Keystone records the viewer's progress — the next step ("→ Containment" / "Move to
//   Containment") or the quality manager's verification (close / back to corrective action) — through the Vigie
//   connector's outbox (src/server/dal/quality.ts → integrations/vigie), "pending sync with Vigie" until Vigie takes it.
//   No Server Function creates or edits an NCR ("New NCR" opens Vigie's report form).
// - Deliverables are Keystone's: Start / To internal review / Submit to client / Start next revision after a rejection
//   (the project team; R-114), the client's acceptance (PV, signed outside Keystone) or rejection with comments recorded by
//   the project's leads — PM of record, co-PM, deputy, director (D9-06: clients never see Keystone) —, the link to the issued document in the Codex index, and "New deliverable"
//   (the project's manager or the director; R-115).
// Each function validates the raw input, checks the viewer server-side with the screen's rules (src/domain/quality.ts:
// not outside the workspace, project not read-only, the role / person that holds the step), writes with the viewer as
// the actor, then revalidates (screen, sidebar badge, My approvals, Home). Messages are English source strings: the
// client shows them with toast `showEn` (FormDialog results are translated here).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { yearOfIso } from '@/domain/clock';
import { DELIVERABLE_CREATOR_ROLES, deliverableActionFor, deliverableRefusalText, ncrActionFor, ncrRefusalText, ncrRequestText, parseNewDeliverable, producerNextOf, type ProducerTarget } from '@/domain/quality';
import { NCR_VERIFIER_ROLES, deliverableStatus, ncrStatus, vigieSyncStatus, type NcrStatus, type VigieSyncStatus } from '@/server/db/codes';
import { businessToday } from '@/server/clock';
import { getProject } from '@/server/dal/projects';
import {
  CLIENT_DECISION_REF_MAX, advanceNcr, createDeliverable, decideDeliverable, deliverableWbsOptions, getDeliverable, getNcr, linkDeliverableDocument, listDeliverableTypes, moveDeliverable, verifyNcr,
} from '@/server/dal/quality';
import { teamOwnerOptions } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { logError } from '@/server/log';

export type QualityResult = { ok: true; toast: string } | { ok: false; error: string };

const INVALID = 'Invalid request';
const UNKNOWN_PROJECT = 'Unknown project';
const READ_ONLY = 'Quality is read-only for you';
const QUALITY_ONLY = 'Only the quality manager verifies and closes NCRs';
const UNKNOWN_NCR = 'Unknown NCR';
const UNKNOWN_DLV = 'Unknown deliverable';
const FAILED = 'The progress could not be recorded';
const NOT_SAVED = 'The change could not be saved';

/**
 * An NCR reference: the demo numbers ("NCR-029") and Vigie's own event numbers ("EV-2026-130"; V-3a, R-023) — letters,
 * then one to four dash-separated groups of letters and digits. Nothing else (no space, slash or dot) reaches the DAL.
 */
const NCR_NUMBER = /^[A-Z]{1,10}(?:-[A-Z0-9]{1,12}){1,4}$/i;
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
  /** The viewer leads the project (PM of record, co-PM, deputy, or the director — R-041). */
  isLead: boolean;
}

/** The project and the viewer's edit right on its Quality screen (outside workspace / read-only project → false). */
async function access(projectCode: unknown): Promise<Access | { error: string }> {
  const raw = str(projectCode, 20);
  if (!raw) return { error: INVALID };
  const project = await getProject(raw);
  if (!project) return { error: UNKNOWN_PROJECT };
  const ctx = await getProjectContext(project.code, 'quality');
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role }, canEdit: ctx.canEdit('quality'), isLead: ctx.isLead };
}

const syncText = (s: VigieSyncStatus) => vigieSyncStatus.label(s);

/**
 * "→ <next step>" (log row) / "Move to <next step>" (drawer): the next step of the NCR, sent to Vigie. Any editor of the
 * project's Quality screen but the client; never Closed (the quality manager's verification); one request at a time.
 */
export async function advanceNcrAction(input: { projectCode: string; number: string; step: string }): Promise<QualityResult> {
  const a = await access(input?.projectCode);
  if ('error' in a) return { ok: false, error: a.error };
  if (!a.canEdit) return { ok: false, error: READ_ONLY };
  const number = str(input?.number);
  const step = input?.step as NcrStatus;
  if (!NCR_NUMBER.test(number) || !ncrStatus.isCode(step)) return { ok: false, error: INVALID };
  try {
    const n = await getNcr(a.code, number);
    if (!n) return { ok: false, error: UNKNOWN_NCR };
    const next = ncrActionFor(n, { role: a.actor.role, canEdit: a.canEdit });
    if (next?.kind !== 'step' || next.target !== step) {
      refreshAll(); // the row or the drawer is stale
      return { ok: false, error: ncrRefusalText(n, 'step') };
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
      return { ok: false, error: ncrRefusalText(n, 'verify') };
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
  const number = str(input?.number);
  const to = input?.to as ProducerTarget;
  if (!DLV_NUMBER.test(number) || !PRODUCER_TARGETS.includes(to)) return { ok: false, error: INVALID };
  try {
    const d = await getDeliverable(a.code, number);
    if (!d) return { ok: false, error: UNKNOWN_DLV };
    if (producerNextOf(d.status) !== to) {
      refreshAll();
      return { ok: false, error: deliverableRefusalText(d, 'move') };
    }
    try {
      await moveDeliverable(a.code, d.number, to, a.actor, undefined, d.status);
    } catch (e) {
      if (e instanceof Error && / has moved on$| cannot move from /.test(e.message)) {
        refreshAll();
        return { ok: false, error: deliverableRefusalText({ number: d.number, status: 'in_progress' }, 'move') };
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
 * "Record client acceptance" / "Record client rejection" (register, drawer — dialog with the date and the reference of the signed
 * document). D9-06 (owner, 10 Nov 2026): clients never see Keystone — the PV is signed outside (DocuSign planned) and the
 * project's leads (PM of record, co-PM, deputy, or the director) record "accepted by the client on … (reference)" or the
 * rejection with its comments, on a submitted deliverable. Accept needs the reference; the date is not after the status date.
 */
export async function recordClientDecisionAction(projectCode: string, number: string, decision: string, values: Record<string, string>): Promise<FormDialogResult> {
  const a = await access(projectCode);
  if ('error' in a) return { error: await tr(a.error) };
  if (!a.canEdit) return { error: await tr(READ_ONLY) };
  const dlv = str(number);
  const d0 = decision === 'accepted' || decision === 'rejected' ? decision : null;
  const v = values && typeof values === 'object' ? values : {};
  const text = (k: string, max: number) => (typeof v[k] === 'string' ? (v[k].length <= max ? v[k].trim() : undefined) : '');
  const on = text('on', 10);
  const reference = text('reference', CLIENT_DECISION_REF_MAX);
  const comments = text('comments', 2000);
  if (!DLV_NUMBER.test(dlv) || !d0 || on === undefined || reference === undefined || comments === undefined) return { error: await tr(INVALID) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: await tr('Enter the date of the client’s decision') };
  if (d0 === 'accepted' && !reference) return { error: await tr('Enter the reference of the signed acceptance (PV)') };
  if (on > (await businessToday())) return { error: await tr('The client’s decision cannot be after the status date') };
  try {
    const d = await getDeliverable(a.code, dlv);
    if (!d) return { error: await tr(UNKNOWN_DLV) };
    if (deliverableActionFor(d, { role: a.actor.role, canEdit: a.canEdit, isLead: a.isLead })?.kind !== 'decide') {
      refreshAll();
      return { error: await tr(deliverableRefusalText(d, 'decide')) };
    }
    await decideDeliverable(a.code, d.number, d0, a.actor, { on, reference: reference || null, comments: comments || null });
    refreshAll();
    return { toast: await tr(`${d.number} · ${d0 === 'accepted' ? 'Client acceptance recorded' : 'Client rejection recorded'}`) };
  } catch (e) {
    logError('recordClientDecisionAction', e);
    return { error: await tr(NOT_SAVED) };
  }
}

/** "Link a Codex document" (drawer's Document section): the issued document of the deliverable, a record of the project. */
export async function linkDeliverableDocumentAction(projectCode: string, number: string, values: Record<string, string>): Promise<FormDialogResult> {
  const a = await access(projectCode);
  if ('error' in a) return { error: await tr(a.error) };
  if (!a.canEdit) return { error: await tr(READ_ONLY) };
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
  const parsed = parseNewDeliverable(raw, { types: opts.types, wbs: opts.wbs.map((w) => w.code), team: opts.team, year: yearOfIso(await businessToday()) });
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
