// Cost control (delivery 7, R-068 / owner decision A-4 "Registre unique, propagation automatique"): what the approval of a
// change request posted to the budget and the contract. One row per change request — the unique key makes the posting
// idempotent (an approval re-run, two concurrent decisions or a retry never post the same request twice).
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, keur } from './_common';
import { changeRequests } from './change';
import { contractAmendments } from './contract';
import { persons } from './organisation';
import { projects } from './portfolio';

/** Outcome of the posting on the contract (src/domain/cost-control.ts AmendmentOutcome). */
export type PostingAmendmentOutcome = 'prepared' | 'exists' | 'not_contractual' | 'no_contract';

/** Budget and contract posting of an approved change request. */
export const changeRequestPostings = pgTable('change_request_postings', {
  id: id(),
  changeRequestId: uuid('change_request_id').notNull().unique().references(() => changeRequests.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** Signed amount added to the BAC, k€. */
  amountKeur: keur('amount_keur').notNull(),
  /** Project BAC before and after the posting, k€. */
  bacBeforeKeur: keur('bac_before_keur').notNull(),
  bacAfterKeur: keur('bac_after_keur').notNull(),
  /** Split over the work packages at approval (the Budget re-derives it from the register: this is the audit record). */
  allocations: jsonb('allocations').$type<{ code: string; amountKeur: number }[]>().notNull(),
  amendmentOutcome: text('amendment_outcome').$type<PostingAmendmentOutcome>().notNull(),
  /** The draft amendment prepared for signature (outcome 'prepared') or the one already there ('exists'). */
  amendmentId: uuid('amendment_id').references(() => contractAmendments.id, { onDelete: 'set null' }),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  postedByPersonId: uuid('posted_by_person_id').references(() => persons.id),
  postedByName: text('posted_by_name').notNull(),
});
