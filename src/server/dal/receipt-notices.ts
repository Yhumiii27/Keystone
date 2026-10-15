import 'server-only';
// Notices of a goods-receipt quality decision (R-096: NEW-D4-3 "a", SC-3b "a"; R-015 parts "delivery refused" and
// "invoice blocked": X-6a). Read AFTER the decision's transaction commits — a small reader beside decideReceipt rather
// than a change of its return type — and sent best effort by the Server Function (src/features/deliveries/actions.ts):
// - goods rejected (Rejected or Partially rejected): the order's buyer (else the procurement users) and the project's
//   leads — "Delivery rejected at receipt";
// - an invoice of the receipt or of its order that the 3-way match now blocks (it was "Awaiting receipt"): the buyer
//   (else procurement) and the directors (prototype n8) — "Invoice blocked by the 3-way match".
// Recipient rules: src/domain/receipt-notices.ts (the actor is never told). Nothing is recorded about the Vigie NCR (no
// echo of its number, V-3): the drawer only links to Vigie's report form.
import { eq } from 'drizzle-orm';
import { RECEIPT_NOTICE, invoiceBlockedRecipients, newlyBlockedInvoices, rejectionRecipients } from '@/domain/receipt-notices';
import { getDb } from '@/server/db/client';
import { purchaseOrders, rfqs } from '@/server/db/schema';
import { getReceipt } from './deliveries';
import { actorPersonIdOf, activePersonIds, notifyPersonIds, personIdsWithRoles, projectLeadIds } from './person-notices';
import { listSupplierInvoices } from './purchasing';

/** Invoices of a receipt or of its order, with their status as the 3-way match sees it (`matchedInvoiceStatus`). */
export async function invoiceStatusesOfReceipt(receipt: { number: string; poNumber: string }): Promise<Map<string, string>> {
  const all = await listSupplierInvoices();
  return new Map(all.filter((i) => i.receiptNumber === receipt.number || i.poNumber === receipt.poNumber).map((i) => [i.number, i.status]));
}

/** [submitted by, created by, owner of the RFQ that drafted it] of an order (person ids, null when absent). */
async function buyerChainOf(poNumber: string): Promise<(string | null)[]> {
  const db = await getDb();
  const [po] = await db.select({ id: purchaseOrders.id, sub: purchaseOrders.submittedByPersonId, by: purchaseOrders.createdByPersonId })
    .from(purchaseOrders).where(eq(purchaseOrders.number, poNumber));
  if (!po) return [];
  const [rfq] = await db.select({ owner: rfqs.ownerPersonId }).from(rfqs).where(eq(rfqs.purchaseOrderId, po.id));
  return [po.sub, po.by, rfq?.owner ?? null];
}

export interface ReceiptNoticesSent {
  /** Persons told about the rejection (empty: none, or nothing rejected). */
  rejection: string[];
  /** Persons told per newly blocked invoice. */
  invoices: { number: string; to: string[] }[];
}

/**
 * Sends the notices of a decided receipt: `before` = the invoice statuses read before the decision. Throws on a read or
 * notification failure — the caller logs it; the decision is already committed.
 */
export async function notifyReceiptDecision(
  number: string, before: ReadonlyMap<string, string>, actor: { name: string; short?: string | null; personId?: string | null },
): Promise<ReceiptNoticesSent> {
  const out: ReceiptNoticesSent = { rejection: [], invoices: [] };
  const r = await getReceipt(number);
  if (!r) return out;
  const db = await getDb();
  const after = await invoiceStatusesOfReceipt(r);
  const blocked = newlyBlockedInvoices(before, after);
  const rejected = r.totals.rejected;
  if (rejected <= 0 && !blocked.length) return out;
  const [actorId, active, buyerChain, procurement] = await Promise.all([
    actorPersonIdOf(db, actor), activePersonIds(db), buyerChainOf(r.poNumber), personIdsWithRoles(db, ['procurement']),
  ]);
  const people = { active, actor: actorId };
  if (rejected > 0 && (r.status === 'rejected' || r.status === 'partially_rejected')) {
    const leads = await projectLeadIds(db, r.projectCode);
    out.rejection = await notifyPersonIds({
      kind: 'delivery', title: RECEIPT_NOTICE.rejected, sub: `${r.number} · ${r.poNumber} · ${r.supplier} · × ${rejected}`, screen: 'deliveries',
      params: { receipt: r.number }, projectCode: r.projectCode,
    }, rejectionRecipients({ buyerChain, leads, procurement }, people), actorId);
  }
  if (blocked.length) {
    const directors = await personIdsWithRoles(db, ['director']);
    const to = invoiceBlockedRecipients({ buyerChain, directors, procurement }, people);
    for (const inv of blocked)
      out.invoices.push({
        number: inv,
        to: await notifyPersonIds({
          kind: 'invoice', title: RECEIPT_NOTICE.invoiceBlocked, sub: `${inv} · ${r.supplier} · ${r.number} · ${r.poNumber}`, screen: 'procurement',
          params: { pTab: 'inv', inv }, projectCode: r.projectCode,
        }, to, actorId),
      });
  }
  return out;
}
