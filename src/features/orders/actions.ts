'use server';
// Purchase orders Server Functions (docs/spec/08 §2.5, PO_FLOW; My approvals 08 §7.5). Each one validates its raw
// input, checks the viewer server-side, writes through the data-layer writers with the viewer as the actor, then
// revalidates the app (Orders, Deliveries / BOM figures, the sidebar badges and My approvals).
// - Orders screen (create drafts, send for approval, approve & order, push to X3): the viewer may edit Orders on this
//   project (not outside the workspace, not a read-only project);
// - "Approve & order" and the My approvals Approve / Reject: only the portfolio director or the project's manager
//   (the prototype's inbox routing; the Orders screen had no check, 08 OQ11 — enforced again by the writers);
// - R-095 "Cancel order" (drawer): an order drafted in Keystone before it is placed — a Draft by its author, the project's
//   leads or the director, an order awaiting approval withdrawn by whoever sent it (`poCancelRight`) — with a required
//   reason; the My approvals Reject also requires one (SC-3a, P-5c). The writer re-checks everything in its transaction.
// Results carry English source messages; the client shows them with `toast.showEn`.
import { revalidatePath } from 'next/cache';
import { canApprovePo, canPushPoToX3, canSubmitPo, isCancellablePo, poCancelReason, poX3State } from '@/domain/orders';
import { poStatus } from '@/server/db/codes';
import { notifyPurchaseOrderCancelled, pushPurchaseOrderToX3 } from '@/server/dal/orders';
import { getProject } from '@/server/dal/projects';
import {
  PurchaseOrderError, approvePurchaseOrder, canApprovePurchaseOrders, cancelPurchaseOrder, createDraftPurchaseOrders, getPurchaseOrder, poCancelRights, rejectPurchaseOrder,
  submitPurchaseOrder, type PurchaseOrderErrorCode, type PurchaseOrderRow,
} from '@/server/dal/purchasing';
import { X3_NOT_CONNECTED, x3Simulated } from '@/server/integrations/x3/mock-mode';
import { getProjectContext, getScreenAccess } from '@/server/project-context';
import { logError } from '@/server/log';

export type OrderActionResult = { ok: true; message?: string } | { ok: false; error: string };
/** My approvals decision result (same shape as the change-request decision). */
export type DecisionResult = { ok: true; status: string } | { ok: false; error: string };

const INVALID = 'Invalid request';
const UNKNOWN_PROJECT = 'Unknown project';
const UNKNOWN_ORDER = 'Unknown purchase order';
const READ_ONLY = 'Purchase orders are read-only for you';
const NOT_APPROVER = 'Only the project manager or the portfolio director approves purchase orders';
const FAILED = 'The change could not be saved';
const NOTHING_SHORT = 'Every BOM article is already ordered';
const NOT_DRAFT = 'This order is no longer a draft';
const NOT_AWAITING = 'This order is no longer awaiting approval';
const NOT_PUSHABLE = 'Only an approved order drafted in Keystone can be pushed to X3';
// R-095.
const NOT_CANCELLABLE = 'This order can no longer be cancelled';
const X3_ORDER = 'An order imported from Sage X3 is cancelled in Sage X3';
const NOT_CANCELLER_DRAFT = 'Only the order’s author, the project manager or the portfolio director cancels a draft';
const NOT_CANCELLER_SUBMITTED = 'Only the person who sent the order for approval withdraws it';
// My approvals wording (src/features/myapprovals/actions.ts).
const INBOX_NOT_ALLOWED = 'Read-only — you cannot decide from this inbox';
const INBOX_NOT_YOURS = 'This decision is not waiting for you any more';
const INBOX_FAILED = 'The decision could not be saved';

const CODE_RE = /^[A-Z]{3}-\d{3}$/;
const PO_RE = /^PO-\d{3,}$/;

const refresh = () => revalidatePath('/', 'layout');
/** Refusal because the order moved on since the page was rendered (another viewer acted): refresh the stale row. */
const stale = (error: string): OrderActionResult => {
  refresh();
  return { ok: false, error };
};

/** Project + viewer allowed to edit Orders on it; or an error message. */
async function editable(code: unknown): Promise<{ code: string; actor: string } | { error: string }> {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return { error: INVALID };
  const project = await getProject(code);
  if (!project) return { error: UNKNOWN_PROJECT };
  const ctx = await getProjectContext(project.code, 'orders');
  if (!ctx.canEdit('orders')) return { error: READ_ONLY };
  return { code: project.code, actor: ctx.viewer.name };
}

/** The order, checked to belong to the project. */
async function orderOf(code: string, number: unknown): Promise<{ po: PurchaseOrderRow } | { error: string }> {
  if (typeof number !== 'string' || !PO_RE.test(number)) return { error: INVALID };
  const po = await getPurchaseOrder(number);
  if (!po || po.projectCode !== code) return { error: UNKNOWN_ORDER };
  return { po };
}

/**
 * Header "New purchase order" / banner "Create draft POs by supplier" (`createDrafts`): one Draft per manufacturer of
 * the BOM shortfall, lines at list price. Refused when nothing is short any more.
 */
export async function createDraftOrdersAction(code: string): Promise<OrderActionResult> {
  const ok = await editable(code);
  if ('error' in ok) return { ok: false, error: ok.error };
  try {
    const numbers = await createDraftPurchaseOrders(ok.code, ok.actor);
    refresh(); // nothing short any more = the banner / header button were stale
    return numbers.length ? { ok: true } : { ok: false, error: NOTHING_SHORT };
  } catch (e) {
    logError('createDraftOrdersAction', e);
    return { ok: false, error: FAILED };
  }
}

/** Row "Send for approval": Draft → Awaiting approval. */
export async function submitOrderAction(code: string, number: string): Promise<OrderActionResult> {
  const ok = await editable(code);
  if ('error' in ok) return { ok: false, error: ok.error };
  const o = await orderOf(ok.code, number);
  if ('error' in o) return { ok: false, error: o.error };
  if (!canSubmitPo(o.po.status)) return stale(NOT_DRAFT);
  try {
    await submitPurchaseOrder(o.po.number, ok.actor);
  } catch (e) {
    logError('submitOrderAction', e);
    return { ok: false, error: FAILED };
  }
  refresh();
  return { ok: true };
}

/** Row "Approve & order": Awaiting approval → Ordered, by the director or the project's manager. */
export async function approveOrderAction(code: string, number: string): Promise<OrderActionResult> {
  const ok = await editable(code);
  if ('error' in ok) return { ok: false, error: ok.error };
  const o = await orderOf(ok.code, number);
  if ('error' in o) return { ok: false, error: o.error };
  if (!(await canApprovePurchaseOrders(ok.code, ok.actor))) return { ok: false, error: NOT_APPROVER };
  if (!canApprovePo(o.po.status)) return stale(NOT_AWAITING);
  try {
    await approvePurchaseOrder(o.po.number, ok.actor);
  } catch (e) {
    logError('approveOrderAction', e);
    return { ok: false, error: FAILED };
  }
  refresh();
  return { ok: true };
}

/**
 * Drawer "Push to X3": an order drafted in Keystone, once approved, gets its Sage X3 reference (mock connector). R-034: a
 * simulation on a demo database only — refused with "Sage X3 is not connected" otherwise; the toast says it was simulated.
 */
export async function pushOrderToX3Action(code: string, number: string): Promise<OrderActionResult> {
  const ok = await editable(code);
  if ('error' in ok) return { ok: false, error: ok.error };
  const o = await orderOf(ok.code, number);
  if ('error' in o) return { ok: false, error: o.error };
  if (!(await x3Simulated())) return { ok: false, error: X3_NOT_CONNECTED };
  if (!canPushPoToX3(o.po)) return stale(NOT_PUSHABLE);
  try {
    const ref = await pushPurchaseOrderToX3(o.po.number, ok.actor);
    refresh();
    return { ok: true, message: `${o.po.number} · Simulated push (Sage X3 not connected) · ${ref}` };
  } catch (e) {
    logError('pushOrderToX3Action', e);
    return { ok: false, error: FAILED };
  }
}

/**
 * Drawer "Cancel order" (R-095, SC-3a = a, P-5c = a): an order drafted in Keystone and not placed yet — a Draft cancelled by
 * its author, the project's leads or the director; an order awaiting approval withdrawn by whoever sent it. The reason is
 * required (≤ 1000 characters) and recorded on the order, in the audit trail and in the drawer; the author / submitter is
 * told when someone else did it. Orders imported from Sage X3 and placed orders are refused.
 */
export async function cancelOrderAction(code: string, number: string, reason: string): Promise<OrderActionResult> {
  const ok = await editable(code);
  if ('error' in ok) return { ok: false, error: ok.error };
  const o = await orderOf(ok.code, number);
  if ('error' in o) return { ok: false, error: o.error };
  const why = poCancelReason(reason);
  if (!why.ok) return { ok: false, error: why.error };
  if (poX3State(o.po) !== 'local') return { ok: false, error: X3_ORDER };
  if (!isCancellablePo(o.po)) return stale(NOT_CANCELLABLE);
  if (!(await poCancelRights(ok.code, ok.actor))[o.po.number]) return { ok: false, error: o.po.status === 'draft' ? NOT_CANCELLER_DRAFT : NOT_CANCELLER_SUBMITTED };
  try {
    const r = await cancelPurchaseOrder(o.po.number, why.value, ok.actor);
    refresh();
    await notifyPurchaseOrderCancelled({ number: o.po.number, projectCode: ok.code, reason: why.value, rejected: false, personIds: r.notify });
    return { ok: true, message: `${o.po.number} · ${r.kind === 'withdraw' ? 'Withdrawn from approval' : 'Cancelled'}` };
  } catch (e) {
    const refused = cancelRefusal(e, o.po.status);
    if (refused) return refused;
    logError('cancelOrderAction', e);
    return { ok: false, error: FAILED };
  }
}

/** A writer's refusal (the order moved on, or the right changed, between the page and the click) → its message. */
function cancelRefusal(e: unknown, status: string): OrderActionResult | null {
  if (!(e instanceof PurchaseOrderError)) return null;
  const msg: Record<PurchaseOrderErrorCode, string> = {
    stale: NOT_CANCELLABLE, not_local: X3_ORDER, not_allowed: status === 'draft' ? NOT_CANCELLER_DRAFT : NOT_CANCELLER_SUBMITTED,
    reason_required: 'Give the reason for the cancellation', reason_too_long: 'The reason is too long',
  };
  return e.code === 'stale' ? stale(msg.stale) : { ok: false, error: msg[e.code] };
}

/**
 * My approvals inline decision on a "Purchase order" row: Approve → Ordered, Reject → Cancelled. The viewer must
 * have My approvals in their workspace and approve the project's orders; the order must still await approval.
 * R-095: a rejection carries its reason (required, ≤ 1000 characters), stored on the order; the author / submitter is told.
 */
export async function decidePurchaseOrderAction(input: { projectCode: string; number: string; decision: string; reason?: string }): Promise<DecisionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit) return { ok: false, error: INBOX_NOT_ALLOWED };
  const code = typeof input?.projectCode === 'string' ? input.projectCode.trim() : '';
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const decision = input?.decision === 'ok' || input?.decision === 'rejected' ? input.decision : null;
  if (!CODE_RE.test(code) || !PO_RE.test(number) || !decision) return { ok: false, error: INVALID };
  const why = decision === 'rejected' ? poCancelReason(input?.reason) : null;
  if (why && !why.ok) return { ok: false, error: why.error };
  try {
    const po = await getPurchaseOrder(number);
    if (!po || po.projectCode !== code || !canApprovePo(po.status) || !(await canApprovePurchaseOrders(code, viewer.name))) {
      refresh(); // the row is stale
      return { ok: false, error: INBOX_NOT_YOURS };
    }
    if (decision === 'ok') await approvePurchaseOrder(number, viewer.name);
    else {
      const reason = why?.ok ? why.value : '';
      const r = await rejectPurchaseOrder(number, viewer.name, reason);
      await notifyPurchaseOrderCancelled({ number, projectCode: code, reason, rejected: true, personIds: r.notify });
    }
    refresh();
    return { ok: true, status: poStatus.label(decision === 'ok' ? 'ordered' : 'cancelled') };
  } catch (e) {
    if (e instanceof PurchaseOrderError && e.code === 'stale') {
      refresh(); // approved, rejected or withdrawn meanwhile
      return { ok: false, error: INBOX_NOT_YOURS };
    }
    logError('decidePurchaseOrderAction', e);
    return { ok: false, error: INBOX_FAILED };
  }
}
