// Connector outboxes (Vigie ECO / NCR progress, Cursus requests) under concurrent deliveries (R-010). A delivery run lists
// the undelivered entries, then sends them one by one over HTTP. Two runs at the same time — two users, a page view and the
// job worker, two server instances — would send the same entry twice. Before sending, a run claims the entry with one
// conditional UPDATE (not sent, and not claimed by a delivery still in flight); the result of the attempt clears the claim.
// A claim older than the lease (a process that died mid-delivery) no longer blocks the entry.

/** Longest a delivery holds an outbox entry (HTTP calls time out after 5 s). */
export const DELIVERY_LEASE_MS = 120_000;

/** Claims older than this instant are expired. */
export const claimExpiry = (at: Date) => new Date(at.getTime() - DELIVERY_LEASE_MS);
