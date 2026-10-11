// Client portal (docs/spec/11 §3.2 ClientIssue; screen 03 §8). Issues are scoped to the project (they were global in
// the prototype, 11 §7 #22). Decisions read the change requests (change.ts) and deliverables (quality.ts); invoices the
// contract billing plan (contract.ts); documents the Codex index (documents.ts).
import { date, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ClientCommChannel, ClientCommDirection, ClientIssueStatus } from '../codes';
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

/** Document categories shared with the client (CLIENT_DOCS 3543, HLT-026 × 5) — defined but not rendered by the prototype (L-9). */
export const clientDocumentCategories = pgTable(
  'client_document_categories',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    description: text('description').notNull(),
    /** "3 files". */
    fileCountText: text('file_count_text').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.position)],
);

/**
 * Client communication log (chapter 4, Site › "Client communication log"; Keystone-owned, per project): every exchange with
 * the client — date, channel, contact, subject, summary — and its follow-up (owner, due date, done). Numbered COM-001… per project.
 */
export const clientCommunications = pgTable(
  'client_communications',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "COM-001" (per project). */
    number: text('number').notNull(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    channel: text('channel').$type<ClientCommChannel>().notNull(),
    direction: text('direction').$type<ClientCommDirection>().notNull().default('outbound'),
    /** Client-side contact as typed, and the person when known. */
    contactName: text('contact_name').notNull(),
    contactPersonId: uuid('contact_person_id').references(() => persons.id),
    subject: text('subject').notNull(),
    summary: text('summary').notNull().default(''),
    followUpOwnerName: text('follow_up_owner_name'),
    followUpOwnerPersonId: uuid('follow_up_owner_person_id').references(() => persons.id),
    followUpDueOn: date('follow_up_due_on', { mode: 'string' }),
    followUpDoneAt: timestamp('follow_up_done_at', { withTimezone: true }),
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    createdByName: text('created_by_name').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);
