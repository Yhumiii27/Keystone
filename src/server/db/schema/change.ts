// Change control and baselines (docs/spec/11 §3.3 Baseline, §3.5 ChangeRequest, §7 #2).
//
// The prototype holds two conflicting change-request datasets (11 §7 #2, OPEN QUESTION A-4):
//  - `change_requests` — the change-control register (HLT_CRS_X 3498, with the approval chain and WBS
//    allocations) plus CR-005 from HCRS, which only exists there;
//  - `budget_change_lines` — the Budget screen's own list (projectData().CRS = HCRS 3193), kept verbatim
//    (titles, days, status and "date · decider" meta differ) so the Budget screen renders the prototype exactly.
//    Each line points to the register entry with the same number.
import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { BaselineSource, BaselineState, BudgetChangeStatus, EstimateClass, ChangeStatus, ChangeStep, ChangeType, ContractImpact, StepDecision } from '../codes';
import { id, keur, timestamps } from './_common';
import { persons } from './organisation';
import { activities, wbsNodes } from './planning';
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
    /**
     * Delivery 8 (R-069, P-6c): contractual impact chosen on "New change request" — 'none' makes the client step not required,
     * a price impact prepares the amendment at approval (A-4). Null on requests raised before it (backfilled from the chain).
     */
    contractImpact: text('contract_impact').$type<ContractImpact>(),
    /**
     * Delivery 8 (R-081, C-3a): project cost category ("C03") whose budget the approved request moves; null = only the BAC and
     * the work packages move. Internal: never shown to the client.
     */
    costCategoryCode: text('cost_category_code'),
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

/**
 * Delivery 7 (NEW-D2-2 = a, R-062): plan activities a change request touches, in addition to its work packages, with
 * the new duration it asks for (optional). Linked by the activity code within the request's project, so a link survives
 * the activity's removal to the plan trash and its restore. Once the request is approved, the next "Reschedule" applies
 * the new duration (`appliedAt`, `appliedFromDays` = the duration it replaced).
 */
export const changeRequestActivities = pgTable(
  'change_request_activities',
  {
    id: id(),
    changeRequestId: uuid('change_request_id').notNull().references(() => changeRequests.id, { onDelete: 'cascade' }),
    /** "A1250". */
    activityCode: text('activity_code').notNull(),
    /** Working days; null = touched without a new duration. */
    newDurationDays: integer('new_duration_days'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    appliedFromDays: integer('applied_from_days'),
    position: integer('position').notNull(),
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.changeRequestId, t.activityCode)],
);

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
    // ── Chapter 4 (S-3): "Set baseline" snapshots and the change-request re-baseline write rows here. ──
    source: text('source').$type<BaselineSource>().notNull().default('snapshot'),
    /** "Set baseline" comment. */
    comment: text('comment'),
    /** Data date of the snapshot. */
    dataDate: date('data_date', { mode: 'string' }),
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    createdByName: text('created_by_name'),
    /** Re-baseline form fields (11 §3.3): approver and scope ("Dates & budget" / "Dates only" / "Budget only"). */
    approverPersonId: uuid('approver_person_id').references(() => persons.id),
    scope: text('scope'),
    /**
     * R-188 (DIG-PRODI, Arche K-03): estimate class of the version's BAC — E50 ±50 %, E30 ±30 %, E10 +10/−5 %
     * (src/domain/estimate-class.ts). Set when the version is created (default by the project's stage); null = not classified.
     * Rows older than R-188 were classified by 0048_baseline_estimate_class_backfill.
     */
    estimateClass: text('estimate_class').$type<EstimateClass>(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.code), check('baselines_estimate_class_check', sql`${t.estimateClass} in ('E50', 'E30', 'E10')`)],
);

/**
 * Activity snapshot of a baseline (11 §3.3 BaselineActivity). The seed snapshots BL1 of every project with planning data
 * from the activities' BL1 finish (`bl`); BL0 and the proposed BL2 have no activity rows (the prototype keeps none).
 * `activityId` is cleared if the activity is removed later — the code and name keep the snapshot readable.
 */
export const baselineActivities = pgTable(
  'baseline_activities',
  {
    id: id(),
    baselineId: uuid('baseline_id').notNull().references(() => baselines.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    activityCode: text('activity_code').notNull(),
    name: text('name').notNull(),
    wbsCode: text('wbs_code'),
    /** ISO dates; the start of seeded BL1 rows is derived (finish − duration on the project calendar). */
    startDate: date('start_date', { mode: 'string' }),
    finishDate: date('finish_date', { mode: 'string' }),
    /** Display texts as the Plan shows them ("31 Aug", "14 Jan ’27"). */
    startText: text('start_text'),
    finishText: text('finish_text'),
    durationDays: integer('duration_days'),
    budgetKeur: keur('budget_keur'),
    percentComplete: integer('percent_complete'),
    totalFloatDays: integer('total_float_days'),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.baselineId, t.activityCode)],
);
