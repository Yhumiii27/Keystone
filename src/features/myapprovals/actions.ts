'use server';
// Server Functions of My approvals (docs/spec/08 §7.5, 00 §7.8 "apply the same server actions as the module
// screens"). Here: the change-request step (Change control writer `decideChangeStep` — status re-derived from the chain,
// BL2 switch, audit row — after checking that the viewer holds that pending step: named approver, or the CCB recorder of
// Change control); chapter 4: the resource request (the Approvals screen's own Server Functions, same rules) and the
// forced stage change (L-1, src/domain/forced-stage.ts: the portfolio director approves → the stage is kept, or rejects →
// the project goes back to the stage it left; audited, notified to whoever forced it and to the PM). The other kinds
// are decided by their module's Server Functions (src/features/myapprovals/decision-buttons.tsx).
// Messages are English source strings (the client shows them with toast showEn).
import { revalidatePath } from 'next/cache';
import { canDecideStep } from '@/domain/approvals';
import { FORCED_STAGE_COMMENT_MAX, isForcedStageDecider } from '@/domain/forced-stage';
import { approveRequestAction, rejectRequestAction } from '@/features/requests/actions';
import { changeStatus, stage as stageCodec, type ChangeStep } from '@/server/db/codes';
import { decideChangeStep, listChangeRequestDetails } from '@/server/dal/changes';
import { StageDecisionError, decideForcedStageChange, type ForcedStageDecision } from '@/server/dal/lifecycle';
import { notifyRequestEvent, type RequestNotice } from '@/server/dal/requests-screens';
import { getScreenAccess } from '@/server/project-context';
import { logError } from '@/server/log';

export type DecisionResult = { ok: true; status: string } | { ok: false; error: string };

const STEPS: readonly ChangeStep[] = ['pm', 'director', 'client', 'ccb'];
const NOT_ALLOWED = 'Read-only — you cannot decide from this inbox';
const NOT_YOURS = 'This decision is not waiting for you any more';
const INVALID = 'Invalid request';
const FAILED = 'The decision could not be saved';

/** Approve (ok) or reject a change-request step waiting for the viewer (inline buttons of a "Change request" row). */
export async function decideChangeRequestAction(input: { projectCode: string; number: string; step: string; decision: string }): Promise<DecisionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit) return { ok: false, error: NOT_ALLOWED };
  const code = typeof input?.projectCode === 'string' ? input.projectCode.trim() : '';
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const step = input?.step as ChangeStep;
  const decision = input?.decision === 'ok' || input?.decision === 'rejected' ? input.decision : null;
  if (!/^[A-Z]{3}-\d{3}$/.test(code) || !/^CR-\d{3,}$/.test(number) || !STEPS.includes(step) || !decision) return { ok: false, error: INVALID };
  try {
    const cr = (await listChangeRequestDetails(code)).find((c) => c.id === number);
    // Same routing rule as the inbox: in review, this step pending, and the viewer holds it.
    if (!cr || !canDecideStep(cr, step, viewer)) {
      revalidatePath('/', 'layout'); // the row is stale
      return { ok: false, error: NOT_YOURS };
    }
    const status = await decideChangeStep(code, number, step, decision, viewer.name);
    revalidatePath('/', 'layout');
    return { ok: true, status: changeStatus.label(status) };
  } catch (e) {
    logError('decideChangeRequestAction', e);
    return { ok: false, error: FAILED };
  }
}

// ── Chapter 4: resource requests and forced stage changes ─────────────────────────────────────────────────

/** Outcome of the chapter-4 inline decisions: `toast` is the EN source message of the success. */
export type InboxDecisionResult = { ok: true; toast: string } | { ok: false; error: string };

const REQUEST_RE = /^RQ-\d{3,6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_RE = /^[A-Z]{3}-\d{3}$/;
const MAX_NOTE = 1000;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Approve (task created in the person's list) or reject (with the reason the PM sees) a pending resource request from
 * the inbox — the Approvals screen's Server Functions, so the same rules apply (Approvals in the viewer's workspace, the
 * request still pending, notifications to the PM and the person, activity feed).
 */
export async function decideResourceRequestAction(input: { number: string; decision: string; note?: string }): Promise<InboxDecisionResult> {
  const { canEdit } = await getScreenAccess('myapprovals');
  if (!canEdit) return { ok: false, error: NOT_ALLOWED };
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const decision = input?.decision === 'ok' || input?.decision === 'rejected' ? input.decision : null;
  if (!REQUEST_RE.test(number) || !decision) return { ok: false, error: INVALID };
  const r = decision === 'ok' ? await approveRequestAction(number) : await rejectRequestAction(number, text(input.note, MAX_NOTE));
  if (!r.ok) {
    revalidatePath('/', 'layout'); // the row may be stale
    return r;
  }
  return { ok: true, toast: decision === 'ok' ? `${number} · Approved${r.number ? ` · Task created · ${r.number}` : ''}` : `${number} · Rejected` };
}

/** Notices of a forced-stage decision: whoever forced the move and the project manager (once each, never the decider). */
function stageNotices(d: ForcedStageDecision): RequestNotice[] {
  const approved = d.decision === 'approved';
  const sub = approved
    ? `${d.projectCode} → ${stageCodec.label(d.to)} · ${d.actorName}`
    : `${d.projectCode} · ${stageCodec.label(d.to)} → ${stageCodec.label(d.stage)} · ${d.actorName}`;
  const to = [...new Set([d.requestedBy, d.pm].filter((x): x is string => !!x && x !== d.actorName))];
  return to.map((person) => ({
    kind: 'approval', title: approved ? 'Forced stage change approved' : 'Forced stage change rejected', sub, screen: 'projects', params: { q: d.projectCode },
    projectCode: d.projectCode, to: person,
  }));
}

/**
 * L-1: the portfolio director approves (the project keeps the stage it was forced into) or rejects (the project goes back
 * to the stage it left) a forced stage change, with an optional comment. Refused outside the workspace, for any other
 * role, on a decided / unknown item, and — Reject only — when the project has moved on since.
 */
export async function decideForcedStageChangeAction(input: { projectCode: string; transitionId: string; decision: string; comment?: string }): Promise<InboxDecisionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit || !isForcedStageDecider(viewer.role)) return { ok: false, error: NOT_ALLOWED };
  const code = typeof input?.projectCode === 'string' ? input.projectCode.trim() : '';
  const id = typeof input?.transitionId === 'string' ? input.transitionId.trim() : '';
  const decision = input?.decision === 'approved' || input?.decision === 'rejected' ? input.decision : null;
  if (!PROJECT_RE.test(code) || !UUID_RE.test(id) || !decision) return { ok: false, error: INVALID };
  let d: ForcedStageDecision;
  try {
    d = await decideForcedStageChange(code, id, decision, { actorName: viewer.name, comment: text(input.comment, FORCED_STAGE_COMMENT_MAX) });
  } catch (e) {
    revalidatePath('/', 'layout');
    if (e instanceof StageDecisionError) return { ok: false, error: e.code === 'stale' ? NOT_YOURS : e.message };
    logError('decideForcedStageChangeAction', e);
    return { ok: false, error: FAILED };
  }
  try {
    await notifyRequestEvent(stageNotices(d), viewer.role);
  } catch (e) {
    logError('decideForcedStageChangeAction notification', e); // a courtesy: never undoes the decision
  }
  revalidatePath('/', 'layout');
  return { ok: true, toast: decision === 'approved' ? `${code} · Stage change approved` : `${code} · Stage change rejected · Reverted to the previous stage` };
}
