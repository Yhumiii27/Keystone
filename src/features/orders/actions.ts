'use server';
// Purchase orders Server Functions (docs/spec/08 §2.5, PO_FLOW; My approvals 08 §7.5). Each one validates its raw
// input, checks the viewer server-side, writes through the data-layer writers with the viewer as the actor, then
// revalidates the app (Orders, Deliveries / BOM figures, the sidebar badges and My approvals).
// - Orders screen (create drafts, send for approval, approve & order, push to X3): the viewer may edit Orders on this
//   project (not outside the workspace, not a read-only project);
// - "Approve & order" and the My approvals Approve / Reject: only the portfolio director or the project's manager
//   (the prototype's inbox routing; the Orders screen had no check, 08 OQ11 — enforced again by the writers).
// Results carry English source messages; the client shows them with `toast.showEn`.
import { revalidatePath } from 'next/cache';
import { canApprovePo, canPushPoToX3, canSubmitPo } from '@/domain/orders';
import { poStatus } from '@/server/db/codes';
import { pushPurchaseOrderToX3 } from '@/server/dal/orders';
import { getProject } from '@/server/dal/projects';
import {
  approvePurchaseOrder, canApprovePurchaseOrders, createDraftPurchaseOrders, getPurchaseOrder, rejectPurchaseOrder, submitPurchaseOrder, type PurchaseOrderRow,
} from '@/server/dal/purchasing';
import { getProjectContext, getScreenAccess } from '@/server/project-context';

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
    console.error('createDraftOrdersAction', e);
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
    console.error('submitOrderAction', e);
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
    console.error('approveOrderAction', e);
    return { ok: false, error: FAILED };
  }
  refresh();
  return { ok: true };
}

/** Drawer "Push to X3": an order drafted in Keystone, once approved, gets its Sage X3 reference (mock connector). */
export async function pushOrderToX3Action(code: string, number: string): Promise<OrderActionResult> {
  const ok = await editable(code);
  if ('error' in ok) return { ok: false, error: ok.error };
  const o = await orderOf(ok.code, number);
  if ('error' in o) return { ok: false, error: o.error };
  if (!canPushPoToX3(o.po)) return stale(NOT_PUSHABLE);
  try {
    const ref = await pushPurchaseOrderToX3(o.po.number, ok.actor);
    refresh();
    return { ok: true, message: `${o.po.number} · Pushed to X3 · ${ref}` };
  } catch (e) {
    console.error('pushOrderToX3Action', e);
    return { ok: false, error: FAILED };
  }
}

/**
 * My approvals inline decision on a "Purchase order" row: Approve → Ordered, Reject → Cancelled. The viewer must
 * have My approvals in their workspace and approve the project's orders; the order must still await approval.
 */
export async function decidePurchaseOrderAction(input: { projectCode: string; number: string; decision: string }): Promise<DecisionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit) return { ok: false, error: INBOX_NOT_ALLOWED };
  const code = typeof input?.projectCode === 'string' ? input.projectCode.trim() : '';
  const number = typeof input?.number === 'string' ? input.number.trim() : '';
  const decision = input?.decision === 'ok' || input?.decision === 'rejected' ? input.decision : null;
  if (!CODE_RE.test(code) || !PO_RE.test(number) || !decision) return { ok: false, error: INVALID };
  try {
    const po = await getPurchaseOrder(number);
    if (!po || po.projectCode !== code || !canApprovePo(po.status) || !(await canApprovePurchaseOrders(code, viewer.name))) {
      refresh(); // the row is stale
      return { ok: false, error: INBOX_NOT_YOURS };
    }
    if (decision === 'ok') await approvePurchaseOrder(number, viewer.name);
    else await rejectPurchaseOrder(number, viewer.name);
    refresh();
    return { ok: true, status: poStatus.label(decision === 'ok' ? 'ordered' : 'cancelled') };
  } catch (e) {
    console.error('decidePurchaseOrderAction', e);
    return { ok: false, error: INBOX_FAILED };
  }
}
