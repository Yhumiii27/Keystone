// Quality — client deliverables register with RACI-B and client acceptance (PV de réception) (docs/spec/11 §3.7
// Deliverable / DeliverableRaci; screens 07 §2.3.b, client portal 03 §8.4, My approvals "Deliverable acceptance").
// Keystone owns the deliverables. Non-conformities (NCR, 8D) are owned by Vigie: see the read-only mirror in vigie.ts.
import { date, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { DeliverableStatus, DeliverableType, RaciCode } from '../codes';
import { id, timestamps } from './_common';
import { documents } from './documents';
import { persons } from './organisation';
import { wbsNodes } from './planning';
import { projects } from './portfolio';

/**
 * Deliverables (HLT_DELIVS 3515: HLT-026 × 10; the 5 other projects with data get the prototype's generated D-110…D-113
 * — HLT_DELIVS[0..3] with R = the project's PM). The prototype's `acc` text mixed acceptance and due information
 * ("12 Mar · N. Bensaïd", "Accept by 2 Oct", "Issue 30 Sep", "25 Sep · comments issued"): it is split into dates and
 * people below; the display text is derived (DAL `acceptanceText`).
 */
export const deliverables = pgTable(
  'deliverables',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "D-021" (per project). */
    number: text('number').notNull(),
    title: text('title').notNull(),
    /** Settings › Deliverable types code (`deliverableType`; custom codes allowed). */
    type: text('deliverable_type').$type<DeliverableType>().notNull(),
    /** WBS element the deliverable is tied to ("1.5"); the node when it exists in the project's WBS. */
    wbsCode: text('wbs_code').notNull(),
    wbsNodeId: uuid('wbs_node_id').references(() => wbsNodes.id, { onDelete: 'set null' }),
    /** "28 Feb" → 2026-02-28; "14 Jan" (D-021) is read as 2026 like every prototype date without a year. */
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    status: text('status').$type<DeliverableStatus>().notNull(),
    /** Revision letter ("C"); null = "—". */
    revision: text('revision'),
    /** Planned issue date of a deliverable in progress ("Issue 30 Sep"). */
    issueOn: date('issue_on', { mode: 'string' }),
    submittedOn: date('submitted_on', { mode: 'string' }),
    /** Client acceptance deadline of a submitted deliverable ("Accept by 2 Oct"; submission + 10 days). */
    acceptanceDueOn: date('acceptance_due_on', { mode: 'string' }),
    /** Client acceptance (PV signed): date and signatory ("12 Mar · N. Bensaïd", "20 Mar · Bureau de contrôle"). */
    acceptedOn: date('accepted_on', { mode: 'string' }),
    acceptedByPersonId: uuid('accepted_by_person_id').references(() => persons.id),
    acceptedByName: text('accepted_by_name'),
    /** Client rejection ("25 Sep · comments issued") and the comments. */
    rejectedOn: date('rejected_on', { mode: 'string' }),
    rejectedByPersonId: uuid('rejected_by_person_id').references(() => persons.id),
    reviewComments: text('review_comments'),
    /** Issued document in the Codex index (the drawer's drop slot; OPEN QUESTION D-1). */
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Register order (HLT_DELIVS order). */
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);

/** RACI-B of a deliverable: R produces, A signs off, C consulted, I informed, B backup (names as the register shows them). */
export const deliverableRaci = pgTable(
  'deliverable_raci',
  {
    deliverableId: uuid('deliverable_id').notNull().references(() => deliverables.id, { onDelete: 'cascade' }),
    role: text('raci_role').$type<RaciCode>().notNull(),
    /** "Julien Wagner", "Bureau de contrôle" (external parties have no person). */
    name: text('name').notNull(),
    personId: uuid('person_id').references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.deliverableId, t.role)],
);
