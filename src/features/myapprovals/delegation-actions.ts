'use server';
// R-051 (owner answer P-7d, "Suppléant déclaré par l'approbateur pour une période"): Server Functions of the delegation of
// approvals, on My approvals.
// - declareDelegationAction: the viewer (an internal approver with My approvals in their workspace) names a substitute and a
//   period (rules: src/domain/delegations.ts, checked again in the writer's transaction).
// - cancelDelegationAction: the approver cancels their own delegation; the portfolio director cancels any.
// - decideOnBehalfAction: the substitute decides one item of the approver's own queue. The delegation must name the viewer and
//   run on the business date, and the item must be in the approver's own inbox (no chaining: never an item the approver holds
//   as a substitute). The module's own Server Function then records it inside `runOnBehalf` — with the approver's rights for
//   that item only, while audit and activity name the substitute "on behalf of" the approver (src/server/delegation-scope.ts).
// Messages are English source strings (the client shows them with toast showEn).
import { revalidatePath } from 'next/cache';
import type { ApprovalDecision } from '@/domain/approvals';
import { DELEGATION_ERRORS, DELEGATION_NOTE_MAX, decisionKey } from '@/domain/delegations';
import { decideReceiptFromInboxAction } from '@/features/deliveries/actions';
import { decideDocumentFromInboxAction } from '@/features/docs/actions';
import { decideEcoApprovalAction } from '@/features/eco/actions';
import { decidePurchaseOrderAction } from '@/features/orders/actions';
import { decideDeliverableAction, verifyNcrAction } from '@/features/quality/actions';
import { decideDrawDownAction } from '@/features/risks/actions';
import { getOwnApprovalInbox } from '@/server/approvals';
import { businessToday } from '@/server/clock';
import { DelegationRefused, approverViewerOf, cancelDelegation, createDelegation, getDelegation, viewerUserId } from '@/server/dal/delegations';
import { runOnBehalf } from '@/server/delegation-scope';
import { logError } from '@/server/log';
import { getScreenAccess } from '@/server/project-context';
import { decideChangeRequestAction, decideForcedStageChangeAction, decideResourceRequestAction } from './actions';

/** `toast`: EN source message of the success (a decision without one: the row's default "{id} · Approved"). */
export type DelegationResult = { ok: true; toast?: string } | { ok: false; error: string };

const NOT_ALLOWED = 'Read-only — you cannot decide from this inbox';
const NOT_YOURS = 'This decision is not waiting for you any more';
const INVALID = 'Invalid request';
const FAILED = 'The decision could not be saved';
const NOT_ACTIVE = 'This delegation is not running today';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function refused(e: unknown, where: string): DelegationResult {
  if (e instanceof DelegationRefused) {
    if (e.code === 'unknown' || e.code === 'not_allowed') return { ok: false, error: e.code === 'unknown' ? 'Unknown delegation' : 'You cannot change this delegation' };
    return { ok: false, error: DELEGATION_ERRORS[e.code] };
  }
  logError(where, e);
  return { ok: false, error: 'The delegation could not be saved' };
}

/** Declares a substitute for the viewer's approvals over a period (first and last day included). */
export async function declareDelegationAction(input: { substituteUserId: string; startsOn: string; endsOn: string; note?: string }): Promise<DelegationResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit || viewer.role === 'client') return { ok: false, error: DELEGATION_ERRORS.approver };
  const substituteUserId = str(input?.substituteUserId, 64);
  if (!UUID_RE.test(substituteUserId)) return { ok: false, error: DELEGATION_ERRORS.external };
  const approverUserId = await viewerUserId(viewer);
  if (!approverUserId) return { ok: false, error: DELEGATION_ERRORS.approver };
  try {
    await createDelegation({ approverUserId, substituteUserId, startsOn: str(input?.startsOn, 10), endsOn: str(input?.endsOn, 10), note: str(input?.note, DELEGATION_NOTE_MAX) }, viewer.name);
  } catch (e) {
    return refused(e, 'declareDelegationAction');
  }
  revalidatePath('/', 'layout');
  return { ok: true, toast: 'Delegation recorded' };
}

/** Cancels a delegation (its approver, or the portfolio director), with an optional reason. */
export async function cancelDelegationAction(input: { id: string; reason?: string }): Promise<DelegationResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit || viewer.role === 'client') return { ok: false, error: 'You cannot change this delegation' };
  const id = str(input?.id, 64);
  if (!UUID_RE.test(id)) return { ok: false, error: INVALID };
  try {
    await cancelDelegation(id, { name: viewer.name, userId: await viewerUserId(viewer), role: viewer.role }, str(input?.reason, DELEGATION_NOTE_MAX));
  } catch (e) {
    return refused(e, 'cancelDelegationAction');
  }
  revalidatePath('/', 'layout');
  return { ok: true, toast: 'Delegation cancelled' };
}

type Outcome = { ok: true; toast?: string } | { ok: false; error: string };

/** The module's Server Function of an inline decision (the same as decision-buttons.tsx calls for the viewer's own rows). */
async function record(decision: ApprovalDecision, ok: boolean, note: string | undefined): Promise<Outcome> {
  let r: { ok?: boolean; toast?: string; error?: string };
  switch (decision.mode) {
    case 'change-request':
      r = await decideChangeRequestAction({ projectCode: decision.projectCode, number: decision.number, step: decision.step, decision: ok ? 'ok' : 'rejected' });
      break;
    case 'purchase-order':
      r = await decidePurchaseOrderAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'ok' : 'rejected', reason: note });
      break;
    case 'delivery-qc':
      r = await decideReceiptFromInboxAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'ok' : 'rejected' });
      break;
    case 'eco':
      r = await decideEcoApprovalAction({ number: decision.number, key: decision.key, decision: ok ? 'ok' : 'rejected' });
      break;
    case 'ncr-verification':
      r = await verifyNcrAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'approved' : 'rejected' });
      break;
    case 'deliverable':
      r = await decideDeliverableAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'accepted' : 'rejected' });
      break;
    case 'resource-request':
      r = await decideResourceRequestAction({ number: decision.number, decision: ok ? 'ok' : 'rejected', note });
      break;
    case 'stage':
      r = await decideForcedStageChangeAction({ projectCode: decision.projectCode, transitionId: decision.transitionId, decision: ok ? 'approved' : 'rejected', comment: note });
      break;
    case 'contingency-draw':
      r = await decideDrawDownAction({ projectCode: decision.projectCode, drawId: decision.drawId, decision: ok ? 'validated' : 'rejected', comment: note });
      break;
    case 'codex-document':
      r = await decideDocumentFromInboxAction({ number: decision.number, step: decision.step, decision: ok ? 'approved' : 'rejected', comment: note });
      break;
    default:
      return { ok: false, error: INVALID };
  }
  return r.ok && !r.error ? { ok: true, toast: r.toast } : { ok: false, error: r.error ?? FAILED };
}

const projectOf = (d: ApprovalDecision): string | undefined => ('projectCode' in d && typeof d.projectCode === 'string' ? d.projectCode : undefined);

/**
 * Approve (ok = true) or reject an item of the approver's queue as their substitute. `decision` is the row's inline decision;
 * `note` the reason / comment typed when rejecting (the module's own rules apply).
 */
export async function decideOnBehalfAction(input: { delegationId: string; decision: ApprovalDecision; ok: boolean; note?: string }): Promise<DelegationResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit || viewer.role === 'client') return { ok: false, error: NOT_ALLOWED };
  const delegationId = str(input?.delegationId, 64);
  const decision = input?.decision;
  if (!UUID_RE.test(delegationId) || !decision || typeof decision !== 'object' || typeof input.ok !== 'boolean') return { ok: false, error: INVALID };
  const note = typeof input.note === 'string' ? input.note.slice(0, 2000) : undefined;
  const [today, userId] = await Promise.all([businessToday(), viewerUserId(viewer)]);
  const d = await getDelegation(delegationId, today);
  if (!d || !userId || d.substituteUserId !== userId || d.state !== 'active') {
    revalidatePath('/', 'layout');
    return { ok: false, error: NOT_ACTIVE };
  }
  const approver = await approverViewerOf(d.approverUserId);
  if (!approver || approver.role === 'client') return { ok: false, error: NOT_ACTIVE };
  // The item must wait for the approver themselves (their own queue, the same routing as their inbox).
  const own = await getOwnApprovalInbox(approver, { projectCode: projectOf(decision) });
  const key = decisionKey(decision);
  if (!key || !own.items.some((i) => i.decision && decisionKey(i.decision) === key)) {
    revalidatePath('/', 'layout'); // the row is stale
    return { ok: false, error: NOT_YOURS };
  }
  const mine = own.items.find((i) => i.decision && decisionKey(i.decision) === key)!.decision!;
  let out: Outcome;
  try {
    out = await runOnBehalf({ delegationId, approver, substitute: viewer }, () => record(mine, input.ok, note));
  } catch (e) {
    logError('decideOnBehalfAction', e);
    return { ok: false, error: FAILED };
  }
  revalidatePath('/', 'layout');
  return out;
}
