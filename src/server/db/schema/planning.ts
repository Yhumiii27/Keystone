// Planning (docs/spec/11 §3.3, docs/spec/05 §0.5 / §1 / §2): WBS nodes, activities, logic links, resource
// assignments, milestones, schedule bars (TASKS), pipeline stage plans and the project control header
// (the display figures of projectData()).
import { boolean, date, integer, pgTable, text, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { ConstraintType, LinkType, MilestoneStatus, PipelineWindow } from '../codes';
import { id, keur, months, timestamps } from './_common';
import { persons } from './organisation';
import { projects } from './portfolio';

/**
 * WBS nodes: the project root ("1", level 0) and work packages ("1.1"…, level 1) — the summary rows of
 * `ACTS` (`HACTS` 3196 / generated). `position` is the row's index in ACTS (activities share the sequence).
 */
export const wbsNodes = pgTable(
  'wbs_nodes',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    level: integer('level').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => wbsNodes.id),
    position: integer('position').notNull(),
    /** Root row only: display dates ("05 Jan", "14 Jan ’27"), baseline finish and total float. */
    startText: text('start_text'),
    finishText: text('finish_text'),
    baselineFinishText: text('baseline_finish_text'),
    totalFloatDays: integer('total_float_days'),
    /** Added work packages (OPEN QUESTION S-6). */
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    scope: text('scope'),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.code)],
);

/** Activities (ACTS rows with an id). Dates are kept as the prototype's display strings plus ISO dates. */
export const activities = pgTable(
  'activities',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    wbsNodeId: uuid('wbs_node_id').notNull().references(() => wbsNodes.id),
    /** "A1250". */
    code: text('code').notNull(),
    name: text('name').notNull(),
    durationDays: integer('duration_days').notNull(),
    /** Display start without the " A" suffix ("17 Aug"); startActual = the suffix. */
    startText: text('start_text').notNull(),
    startActual: boolean('start_actual').notNull(),
    finishText: text('finish_text').notNull(),
    finishActual: boolean('finish_actual').notNull(),
    startDate: date('start_date', { mode: 'string' }),
    finishDate: date('finish_date', { mode: 'string' }),
    /** BL1 finish ("31 Aug"). */
    baselineFinishText: text('baseline_finish_text').notNull(),
    baselineFinishDate: date('baseline_finish_date', { mode: 'string' }),
    /** Finish variance vs baseline, days (negative = late). */
    varianceDays: integer('variance_days').notNull(),
    /** "FNLT" + "18 Dec" (prototype `c` = "FNLT 18 Dec"). */
    constraintType: text('constraint_type').$type<ConstraintType>(),
    constraintDateText: text('constraint_date_text'),
    constraintDate: date('constraint_date', { mode: 'string' }),
    constraintViolated: boolean('constraint_violated').notNull().default(false),
    /** Null when complete. */
    totalFloatDays: integer('total_float_days'),
    percentComplete: integer('percent_complete').notNull(),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    budgetKeur: keur('budget_keur').notNull(),
    actualKeur: keur('actual_keur').notNull(),
    eacKeur: keur('eac_keur').notNull(),
    /** `pkg`: work-package name the activity belongs to. */
    packageName: text('package_name'),
    /** Added activities only (`crit`, `desc`). */
    critical: boolean('critical'),
    description: text('description'),
    isAdded: boolean('is_added').notNull().default(false),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.code)],
);

/** Logic links (`p` = [[predId, type, lag]] on the successor). */
export const activityLinks = pgTable(
  'activity_links',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    predecessorId: uuid('predecessor_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    successorId: uuid('successor_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    type: text('type').$type<LinkType>().notNull(),
    lagDays: integer('lag_days').notNull(),
    /** Position in the successor's predecessor list. */
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.successorId, t.predecessorId)],
);

/** Activity resource assignments (A1250_RES 3227). */
export const activityAssignments = pgTable('activity_assignments', {
  id: id(),
  activityId: uuid('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  /** Person, crew, equipment or material: "Steel erection crew". */
  resource: text('resource').notNull(),
  personId: uuid('person_id').references(() => persons.id),
  /** "Subcontractor · 6 ironworkers". */
  detail: text('detail').notNull(),
  /** "6 × 10 h/d". */
  units: text('units').notNull(),
  /** "1,840 / 2,400 h". */
  progressText: text('progress_text').notNull(),
});

/** Milestones (HMILES 3122 / generated MILES). Months are fractional offsets from the project start. */
export const milestones = pgTable('milestones', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  baselineMonth: months('baseline_month').notNull(),
  forecastMonth: months('forecast_month').notNull(),
  status: text('status').$type<MilestoneStatus>().notNull(),
  activityId: uuid('activity_id').references(() => activities.id),
});

/**
 * Schedule bars (HTASKS 3113 / generated TASKS): one bar per work package, as shown on the Schedule screen.
 * Kept as data (golden values) — not recomputed from the activities (OPEN QUESTION A-7).
 */
export const scheduleBars = pgTable('schedule_bars', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  wbsNodeId: uuid('wbs_node_id').references(() => wbsNodes.id),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  ownerPersonId: uuid('owner_person_id').references(() => persons.id),
  baselineStart: months('baseline_start').notNull(),
  baselineEnd: months('baseline_end').notNull(),
  forecastStart: months('forecast_start').notNull(),
  forecastEnd: months('forecast_end').notNull(),
  percentComplete: integer('percent_complete').notNull(),
  critical: boolean('critical').notNull(),
});

/** Pipeline stage plan (PIPE_PLAN 3665): windows in month offsets from Jan 2026. */
export const pipelineStagePlans = pgTable('pipeline_stage_plans', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  window: text('window').$type<PipelineWindow>().notNull(),
  startMonth: months('start_month').notNull(),
  endMonth: months('end_month').notNull(),
});

/**
 * Project control header — the figures and display strings of projectData() (HLT_PD 3308 / generated,
 * docs/spec/05 §0.5, 04 §1.8) for projects with planning data. `chartMonths`/`ganttMonths` derive from
 * `startMonth`, `p3` from the project short code, `pct` from progress and BAC from the project budget.
 */
export const projectControls = pgTable('project_controls', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  /** Project start, month offset from Jan 2026 (DEFS.start). */
  startMonth: integer('start_month').notNull(),
  /** Data date in months since the project start (8.8 − start). */
  tNow: months('t_now').notNull(),
  floatDays: integer('float_days').notNull(),
  finishText: text('finish_text').notNull(),
  baselineText: text('baseline_text').notNull(),
  floatText: text('float_text').notNull(),
  floatShort: text('float_short').notNull(),
  critText: text('crit_text').notNull(),
  milesText: text('miles_text').notNull(),
  milesSub: text('miles_sub').notNull(),
  baselineSet: text('baseline_set').notNull(),
  /** BAC reconciliation tiles (recon). */
  reconOrigKeur: keur('recon_orig_keur').notNull(),
  reconChangesKeur: keur('recon_changes_keur').notNull(),
  reconCrCount: integer('recon_cr_count').notNull(),
  reconPendingKeur: keur('recon_pending_keur').notNull(),
  reconPendingSub: text('recon_pending_sub').notNull(),
  contingencyKeur: keur('contingency_keur').notNull(),
  contingencyUsedKeur: keur('contingency_used_keur').notNull(),
  /**
   * Orders placed not yet in actual cost (Cash & recovery `openCommit`, 04 §1.6): HLT-026's 713 k€ until purchase
   * orders are modelled (04 Q11); null → 60 % of next month's planned value.
   */
  ordersPlacedKeur: keur('orders_placed_keur'),
  /** Narrative under the variance card. */
  note: text('note').notNull(),
  ...timestamps,
});

