// Change control and baselines (docs/spec/11 §3.3 Baseline, §3.5 ChangeRequest, §7 #2).
//
// The prototype holds two conflicting change-request datasets (11 §7 #2, OPEN QUESTION A-4):
//  - `change_requests` — the change-control register (HLT_CRS_X 3498, with the approval chain and WBS
//    allocations) plus CR-005 from HCRS, which only exists there;
//  - `budget_change_lines` — the Budget screen's own list (projectData().CRS = HCRS 3193), kept verbatim
//    (titles, days, status and "date · decider" meta differ) so the Budget screen renders the prototype exactly.
//    Each line points to the register entry with the same number.
import { date, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { BaselineState, BudgetChangeStatus, ChangeStatus, ChangeStep, ChangeType, StepDecision } from '../codes';
import { id, keur, timestamps } from './_common';
import { persons } from './organisation';
import { wbsNodes } from './planning';
import { projects } from './portfolio';

/** Change requests (HLT_CRS_X 3498 + CR-005 from HCRS). */
export const changeRequests = pgTable(
  'change_requests',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "CR-008". */
    number: text('number').notNull(),
    title: text('title').notNull(),
    types: text('types').array().$type<ChangeType[]>().notNull(),
    /** Signed k€. */
    amountKeur: keur('amount_keur').notNull(),
    /** Signed schedule impact in days (negative = gain). */
    scheduleDays: integer('schedule_days').notNull(),
    /** Stored status (the rebuild should derive it from the steps, 11 §5). */
    status: text('status').$type<ChangeStatus>().notNull(),
    /** "R. Aubert" or "Steering committee". */
    requestedBy: text('requested_by').notNull(),
    requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
    /** "14 May" (display) + ISO date. */
    requestedOnText: text('requested_on_text').notNull(),
    requestedOn: date('requested_on', { mode: 'string' }),
    /** Baseline the change applies to ("BL1" / "BL2"). */
    baselineCode: text('baseline_code'),
    justification: text('justification'),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);

/** Approval chain (HLT_CRS_X.chain: pm, director, client, ccb). */
export const changeRequestSteps = pgTable(
  'change_request_steps',
  {
    changeRequestId: uuid('change_request_id').notNull().references(() => changeRequests.id, { onDelete: 'cascade' }),
    step: text('step').$type<ChangeStep>().notNull(),
    decision: text('decision').$type<StepDecision>().notNull(),
    position: integer('position').notNull(),
    decidedByPersonId: uuid('decided_by_person_id').references(() => persons.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    comment: text('comment'),
  },
  (t) => [primaryKey({ columns: [t.changeRequestId, t.step] })],
);

/** WBS elements a change applies to (HLT_CRS_X.wbs), with the allocated amount when known. */
export const changeRequestWbs = pgTable('change_request_wbs', {
  id: id(),
  changeRequestId: uuid('change_request_id').notNull().references(() => changeRequests.id, { onDelete: 'cascade' }),
  wbsCode: text('wbs_code').notNull(),
  wbsNodeId: uuid('wbs_node_id').references(() => wbsNodes.id),
  amountKeur: keur('amount_keur'),
  position: integer('position').notNull(),
});

/** Budget screen change list (projectData().CRS = HCRS 3193) — see the file header. */
export const budgetChangeLines = pgTable('budget_change_lines', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  title: text('title').notNull(),
  amountKeur: keur('amount_keur').notNull(),
  scheduleDays: integer('schedule_days').notNull(),
  status: text('status').$type<BudgetChangeStatus>().notNull(),
  /** "14 May · R. Aubert", "Review 30 Sep · Steering committee". */
  meta: text('meta').notNull(),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id),
  position: integer('position').notNull(),
});

/** Baselines (BASELINES 3504). BL2 is pending CR-009 (no set date yet). */
export const baselines = pgTable(
  'baselines',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "BL1". */
    code: text('code').notNull(),
    name: text('name').notNull(),
    setOn: date('set_on', { mode: 'string' }),
    bacKeur: keur('bac_keur').notNull(),
    finishDate: date('finish_date', { mode: 'string' }).notNull(),
    state: text('state').$type<BaselineState>().notNull(),
    changeRequestId: uuid('change_request_id').references(() => changeRequests.id),
    reason: text('reason'),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.code)],
);
