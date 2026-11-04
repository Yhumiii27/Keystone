// Client portal (docs/spec/11 §3.2 ClientIssue; screen 03 §8). Issues are scoped to the project (they were global in
// the prototype, 11 §7 #22). Decisions read the change requests (change.ts) and deliverables (quality.ts); invoices the
// contract billing plan (contract.ts); documents the Codex index (documents.ts).
import { date, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { ClientIssueStatus } from '../codes';
import { id, timestamps } from './_common';
import { persons } from './organisation';
import { projects } from './portfolio';

/** Issues raised by the client (CLIENT_ISSUES 3544: CI-04, CI-06, CI-07 on HLT-026; new ones continue at CI-08). */
export const clientIssues = pgTable(
  'client_issues',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "CI-07" (per project, zero-padded to 2 digits: CI-08, CI-09, CI-10 — the prototype built "CI-010", 00 §7.16). */
    number: text('number').notNull(),
    title: text('title').notNull(),
    raisedOn: date('raised_on', { mode: 'string' }).notNull(),
    raisedByName: text('raised_by_name').notNull(),
    raisedByPersonId: uuid('raised_by_person_id').references(() => persons.id),
    status: text('status').$type<ClientIssueStatus>().notNull(),
    /** Answer of the project manager ("Acknowledged — response within 2 working days" when raised). */
    response: text('response').notNull(),
    // ── Handling by the project manager (R-137, L-6): Open → In progress → Closed ──
    /** Who took the issue in charge (In progress) and when. */
    handledByName: text('handled_by_name'),
    handledByPersonId: uuid('handled_by_person_id').references(() => persons.id),
    takenOn: date('taken_on', { mode: 'string' }),
    /** Last answer written by the project manager (the client sees it as `response`). */
    answeredOn: date('answered_on', { mode: 'string' }),
    closedOn: date('closed_on', { mode: 'string' }),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);

// The prototype's typed document categories (CLIENT_DOCS 3543, table `client_document_categories`) were dropped in
// Delivery 8 (L-9 = a, R-138): the client portal computes them from the Codex index (src/domain/rexclient.ts).

// The client communication log (chapter 4, table `client_communications`) was dropped in delivery 9 (D-5, S-03, R-171):
// the Site screen opens the client decisions of the project meetings instead.
