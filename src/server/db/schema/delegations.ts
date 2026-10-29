// R-051 (owner answer P-7d, "Suppléant déclaré par l'approbateur pour une période"): an approver declares a substitute for a
// period; while it runs, the approver's items of My approvals also reach the substitute, who decides them on the approver's
// behalf (src/server/approvals/delegation.ts). Rules: src/domain/delegations.ts. Rows are never deleted: a delegation is
// cancelled (who, when, why). Relative imports only (drizzle-kit loads this file directly).
import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './_common';
import { users } from './organisation';

export const approvalDelegations = pgTable(
  'approval_delegations',
  {
    id: id(),
    /** The approver who is away. */
    approverUserId: uuid('approver_user_id').notNull().references(() => users.id),
    /** The internal person who stands in. */
    substituteUserId: uuid('substitute_user_id').notNull().references(() => users.id),
    /** First and last business day of the period (both included). */
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    /** Optional note typed by the approver (shown as typed). */
    note: text('note'),
    createdByName: text('created_by_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByName: text('cancelled_by_name'),
    cancelReason: text('cancel_reason'),
  },
  (t) => [index('approval_delegations_approver_idx').on(t.approverUserId), index('approval_delegations_substitute_idx').on(t.substituteUserId)],
);
