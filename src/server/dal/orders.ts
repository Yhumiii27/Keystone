import 'server-only';
// Purchase orders screen data (docs/spec/08 §2): the project's orders, the BOM shortfall the assistant would draft,
// the goods receipts and supplier invoices that reference each order (drawer links to Deliveries and Sourcing), and
// whether the viewer approves the project's orders. Plus the "Push to X3" writer of an order drafted in Keystone
// (Sage X3 mock connector: the order gets its X3 reference; TODO(X3): call the real connector).
// The order lifecycle writers themselves (drafts, submit, approve, reject) are in ./purchasing.ts.
import { eq } from 'drizzle-orm';
import { canPushPoToX3, mockX3OrderRef, poX3State, type PoCancelKind } from '@/domain/orders';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { purchaseOrders } from '@/server/db/schema';
import { requireX3Simulation } from '@/server/integrations/x3/mock-mode';
import { logError } from '@/server/log';
import { listReceipts } from './deliveries';
import { createNotification } from './notifications';
import { canApprovePurchaseOrders, getBomShortfall, getPurchaseOrder, listPurchaseOrders, listSupplierInvoices, poCancelRights, type PurchaseOrderRow, type ShortfallLine } from './purchasing';

export interface PoDocRef {
  number: string;
  /** EN status label ("QC pending", "Blocked"). */
  statusLabel: string;
}

export interface OrdersScreenData {
  orders: PurchaseOrderRow[];
  shortfall: { lines: ShortfallLine[]; valueEur: number };
  /** Goods receipts per order number (Deliveries list order). */
  receipts: Record<string, PoDocRef[]>;
  /** Supplier invoices per order number (Sourcing list order). */
  invoices: Record<string, PoDocRef[]>;
  /** The viewer approves this project's orders (portfolio director or the project's manager). */
  canApprove: boolean;
  /** R-095: orders the viewer may cancel (`cancel`, a Draft) or withdraw from approval (`withdraw`), by number. */
  cancelRights: Record<string, PoCancelKind>;
  /** Business date (R-013): order dates show their year outside its year. */
  today: string;
}

const group = <T extends { statusLabel: string; number: string }>(rows: T[], key: (r: T) => string | null) => {
  const out: Record<string, PoDocRef[]> = {};
  for (const r of rows) {
    const k = key(r);
    if (k) (out[k] ??= []).push({ number: r.number, statusLabel: r.statusLabel });
  }
  return out;
};

/** Everything the Orders screen reads for a project. Projects without orders or BOM get empty lists. */
export async function getOrdersScreen(projectCode: string, viewerName: string): Promise<OrdersScreenData> {
  const [orders, shortfall, receipts, invoices, canApprove, cancelRights, today] = await Promise.all([
    listPurchaseOrders(projectCode),
    getBomShortfall(projectCode),
    listReceipts(projectCode),
    listSupplierInvoices(),
    canApprovePurchaseOrders(projectCode, viewerName),
    poCancelRights(projectCode, viewerName),
    businessToday(),
  ]);
  const mine = new Set(orders.map((o) => o.number));
  return {
    orders,
    shortfall,
    receipts: group(receipts, (r) => r.poNumber),
    invoices: group(invoices, (i) => (i.poNumber && mine.has(i.poNumber) ? i.poNumber : null)),
    canApprove,
    cancelRights,
    today,
  };
}

/**
 * "Push to X3" of an order drafted in Keystone once approved (Ordered or later): the order gets its Sage X3 reference
 * and leaves the local changes. Refused for orders imported from X3, already pushed, not approved yet or cancelled.
 * Returns the X3 reference. R-034: a simulation (Sage X3 is not connected) — demo database only, refused otherwise
 * (`requireX3Simulation`); the audit and the activity say it was simulated.
 */
export async function pushPurchaseOrderToX3(number: string, actorName: string, at: Date = new Date()): Promise<string> {
  await requireX3Simulation();
  const po = await getPurchaseOrder(number);
  if (!po) throw new Error(`Unknown purchase order ${number}`);
  if (!canPushPoToX3(po)) {
    const state = poX3State(po);
    throw new Error(state === 'local' ? `${number} is not approved yet` : `${number} is already in Sage X3`);
  }
  const db = await getDb();
  const ref = mockX3OrderRef(number);
  await db.transaction(async (tx) => {
    const [o] = await tx.select({ id: purchaseOrders.id, projectId: purchaseOrders.projectId, x3Ref: purchaseOrders.x3Ref }).from(purchaseOrders).where(eq(purchaseOrders.number, number));
    if (o.x3Ref) throw new Error(`${number} is already in Sage X3`);
    await tx.update(purchaseOrders).set({ x3Ref: ref, updatedAt: at }).where(eq(purchaseOrders.id, o.id));
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, {
      actorName: who, actorPersonId: actor?.id, objectRef: number, change: `simulated push to Sage X3 (not connected) · ${ref}`, area: 'Purchase orders', entityType: 'purchase_order',
      entityId: o.id, projectId: o.projectId, occurredAt: at,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `Simulated push of ${number} to Sage X3 (not connected) · ${ref}`, kind: 'sync', projectId: o.projectId, occurredAt: at });
  });
  return ref;
}

/**
 * R-095 (optional, best effort): tells the order's author and submitter — never the actor — that someone else cancelled,
 * withdrew or rejected it. Called after the writer's transaction committed; a failure is logged and never undoes the
 * cancellation. The bell shows the fixed English title through t() and the typed reason as typed (fieldsText).
 */
export async function notifyPurchaseOrderCancelled(input: { number: string; projectCode: string; reason: string; rejected: boolean; personIds: string[] }): Promise<void> {
  if (!input.personIds.length) return;
  try {
    await createNotification({
      kind: 'alert', title: `${input.number} · ${input.rejected ? 'Purchase order rejected' : 'Purchase order cancelled'}`, sub: input.reason, screen: 'orders',
      params: { po: input.number }, projectCode: input.projectCode, audience: [], toPersonIds: input.personIds,
    });
  } catch (e) {
    logError('notifyPurchaseOrderCancelled', e);
  }
}
