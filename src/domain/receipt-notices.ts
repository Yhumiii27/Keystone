// Who is told in Keystone when goods are rejected at receipt or a supplier invoice gets blocked by the 3-way match
// (R-096: NEW-D4-3 "a", SC-3b "a"; R-015: X-6a). Pure rules over person ids; the DAL reads the facts after the quality
// decision commits (src/server/dal/receipt-notices.ts) and sends the bell notifications (X-6: no e-mail).
//
// Defaults (owner to confirm, docs/delivery-8/notes-connectors.md):
// - the buyer of an order is the person who submitted it for approval, else its author, else the owner of the RFQ that
//   drafted it — the first of them with an active Keystone account (the owner never defined "acheteur");
// - the actor is never told about their own decision, at any step: when the buyer is the actor, nobody stands in for them;
// - when no buyer has an active account (orders from Sage X3, people without account), the procurement users stand in;
// - a rejection also goes to the project's leads (PM of record, co-PMs, deputies) — X-6a;
// - a newly blocked invoice also goes to the portfolio director(s) (prototype notification n8).

export interface NoticePeople {
  /** Persons with an active user account (only they can be notified). */
  active: ReadonlySet<string>;
  /** The person deciding (excluded everywhere); null when unknown. */
  actor: string | null;
}

/** The buyer of an order: the first of [submitted by, created by, RFQ owner] with an active account; null when none. */
export function orderBuyer(chain: readonly (string | null | undefined)[], active: ReadonlySet<string>): string | null {
  for (const id of chain) if (id && active.has(id)) return id;
  return null;
}

/** The buyer slot: the buyer (unless they are the actor: then nobody), or the procurement users when there is no buyer. */
function buyerSlot(chain: readonly (string | null | undefined)[], procurement: readonly string[], p: NoticePeople): string[] {
  const buyer = orderBuyer(chain, p.active);
  if (buyer) return buyer === p.actor ? [] : [buyer];
  return procurement.filter((id) => p.active.has(id) && id !== p.actor);
}

const unique = (ids: string[], p: NoticePeople) => [...new Set(ids)].filter((id) => p.active.has(id) && id !== p.actor);

/** "Delivery rejected at receipt": the order's buyer (else procurement) and the project's leads, the actor removed. */
export function rejectionRecipients(
  input: { buyerChain: readonly (string | null | undefined)[]; leads: readonly string[]; procurement: readonly string[] }, p: NoticePeople,
): string[] {
  return unique([...buyerSlot(input.buyerChain, input.procurement, p), ...input.leads], p);
}

/** "Invoice blocked by the 3-way match": the order's buyer (else procurement) and the directors, the actor removed. */
export function invoiceBlockedRecipients(
  input: { buyerChain: readonly (string | null | undefined)[]; directors: readonly string[]; procurement: readonly string[] }, p: NoticePeople,
): string[] {
  return unique([...buyerSlot(input.buyerChain, input.procurement, p), ...input.directors], p);
}

/** Invoices whose status (as the 3-way match sees it) turned from "Awaiting receipt" to "Blocked" (R-015 part 1). */
export function newlyBlockedInvoices(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after.entries()].filter(([n, s]) => s === 'blocked' && before.get(n) === 'awaiting_receipt').map(([n]) => n);
}

/** Fixed EN titles (translated by t() in the bell; typed text stays in the sub-line, R-148). */
export const RECEIPT_NOTICE = {
  rejected: 'Delivery rejected at receipt',
  invoiceBlocked: 'Invoice blocked by the 3-way match',
} as const;
