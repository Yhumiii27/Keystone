// Planning (docs/spec/11 §3.3, docs/spec/05 §0.5 / §1 / §2): WBS nodes, activities, logic links, resource
// assignments, milestones, schedule bars (TASKS), pipeline stage plans and the project control header
// (the display figures of projectData()).
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { CapexMilestoneCode } from '@/domain/capex-milestones';
import type { CalendarCode, ConstraintType, LinkType, MilestoneStatus, PipelineWindow } from '../codes';
import { id, keur, months, num, rowVersion, timestamps } from './_common';
import { departments, persons } from './organisation';
import { projectEquipments, projects } from './portfolio';

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
    /** Chapter 4 (A-7): roll-up dates of the node's activities, written by "Reschedule" (null until then). */
    startDate: date('start_date', { mode: 'string' }),
    finishDate: date('finish_date', { mode: 'string' }),
    /** Chapter 4 (S-9): UID of the summary task / WBS element in the imported MS Project or P6 file (update matching). */
    externalUid: text('external_uid'),
    ...timestamps,
    /** R-185: the equipment line a work package specific to an equipment belongs to (wizard); null = common to the project. */
    equipmentId: uuid('equipment_id').references(() => projectEquipments.id, { onDelete: 'set null' }),
  },
  (t) => [unique().on(t.projectId, t.code), index('wbs_nodes_parent_id_idx').on(t.parentId)],
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
    // ── Chapter 4 (S-1, S-2): CPM results and inputs. `startDate` / `finishDate` stay the current dates (actual when the
    // matching `…Actual` flag is set, else early dates); the columns below are written by "Reschedule".
    /** Calendar override (S-2); null = the project calendar. */
    calendarCode: text('calendar_code').$type<CalendarCode>(),
    /** Remaining duration entered by the user (working days); null = derived from % complete (domain/ch4-defaults). */
    remainingDays: integer('remaining_days'),
    earlyStartDate: date('early_start_date', { mode: 'string' }),
    earlyFinishDate: date('early_finish_date', { mode: 'string' }),
    lateStartDate: date('late_start_date', { mode: 'string' }),
    lateFinishDate: date('late_finish_date', { mode: 'string' }),
    /** Free float, working days (S-8); null when complete. */
    freeFloatDays: integer('free_float_days'),
    /** Last "Reschedule" that wrote the CPM values. */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    /** UID in the imported MS Project / P6 file (S-9 update matching). */
    externalUid: text('external_uid'),
    /** R-010: optimistic locking (see rowVersion). */
    version: rowVersion(),
    ...timestamps,
    /** R-185: the equipment line of an activity of a lot specific to an equipment (wizard); null = common to the project. */
    equipmentId: uuid('equipment_id').references(() => projectEquipments.id, { onDelete: 'set null' }),
  },
  (t) => [unique().on(t.projectId, t.code), index('activities_wbs_node_id_idx').on(t.wbsNodeId), index('activities_owner_person_id_idx').on(t.ownerPersonId)],
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
    /** Chapter 4 (S-1): the link drives the successor's early date (last "Reschedule"). */
    isDriving: boolean('is_driving').notNull().default(false),
  },
  (t) => [unique().on(t.successorId, t.predecessorId), index('activity_links_project_id_idx').on(t.projectId), index('activity_links_predecessor_id_idx').on(t.predecessorId)],
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
  // ── Chapter 4 (S-7 levers, S-9 imports): numeric quantities parsed from / alongside the display texts (null when the
  // assignment is not counted in hours: equipment days, material tonnes).
  /** Planned and actual work, hours ("1,840 / 2,400 h" → 2400 / 1840). */
  plannedHours: num('planned_hours'),
  actualHours: num('actual_hours'),
  /** Units and hours per day per unit ("6 × 10 h/d" → 6 × 10; "40 h/wk" → 1 × 8). */
  resourceCount: num('resource_count'),
  hoursPerDay: num('hours_per_day'),
  /** Department of the resource (levelling by department); null for crews, equipment and material. */
  departmentId: uuid('department_id').references(() => departments.id),
  /** Resource UID in the imported file. */
  externalUid: text('external_uid'),
}, (t) => [index('activity_assignments_activity_id_idx').on(t.activityId), index('activity_assignments_person_id_idx').on(t.personId)]);

/** Milestones (HMILES 3122 / generated MILES). Months are fractional offsets from the project start. */
export const milestones = pgTable(
  'milestones',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    baselineMonth: months('baseline_month').notNull(),
    forecastMonth: months('forecast_month').notNull(),
    status: text('status').$type<MilestoneStatus>().notNull(),
    activityId: uuid('activity_id').references(() => activities.id),
    /** Last change (R-195: `maj_le` of pub_jalons, read by Crucible); set by the schedule's milestone roll-up. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * R-189 (Arche K-04): the CAPEX milestone this schedule milestone is (`commande` … `fin_garantie`, src/domain/capex-milestones.ts),
     * one per project; null = none. Set by the name rule (seed, import, 0056 backfill) when unambiguous, corrected by the leads on
     * the Schedule screen. pub_jalons_projets publishes the milestone's BL1 date as `reference_le`.
     */
    capexMilestoneCode: text('capex_milestone_code').$type<CapexMilestoneCode>(),
  },
  (t) => [
    unique('milestones_project_capex_code_unique').on(t.projectId, t.capexMilestoneCode),
    check(
      'milestones_capex_milestone_code_check',
      sql`${t.capexMilestoneCode} in ('commande', 'fin_etudes', 'fat', 'expedition', 'arrivee_site', 'sat', 'pv_reception', 'fin_garantie')`,
    ),
    index('milestones_activity_id_idx').on(t.activityId),
  ],
);

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
}, (t) => [index('schedule_bars_project_id_idx').on(t.projectId)]);

/** Pipeline stage plan (PIPE_PLAN 3665): windows in month offsets from Jan 2026. */
export const pipelineStagePlans = pgTable('pipeline_stage_plans', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  window: text('window').$type<PipelineWindow>().notNull(),
  startMonth: months('start_month').notNull(),
  endMonth: months('end_month').notNull(),
}, (t) => [index('pipeline_stage_plans_project_id_idx').on(t.projectId)]);

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
  /** Contingency line of the budget (k€): the provision of a project without a contingency register (delivery 7, A-8). */
  contingencyKeur: keur('contingency_keur').notNull(),
  /**
   * FORECAST consumption of the contingency (k€; the prototype's `contUsed`, e.g. HLT-026 208). Since delivery 7 (A-8) the
   * consumed figure is the register's validated draw-downs; this stays the forecast the Budget shows apart.
   */
  contingencyUsedKeur: keur('contingency_used_keur').notNull(),
  /**
   * Legacy: orders placed not yet in actual cost (the prototype's literal 713 k€ of HLT-026, 04 Q11). Since delivery 7
   * (R-073) the Budget computes them from the project's purchase orders; no longer read.
   */
  ordersPlacedKeur: keur('orders_placed_keur'),
  /** Narrative under the variance card. */
  note: text('note').notNull(),
  ...timestamps,
});


/**
 * Plan trash (chapter 4, S-5 "confirmation and keep the possibility to undo"): one row per removal of a work package or an
 * activity on the Plan. The removed rows (the node, its activities, their links, assignments and Plan to-dos, the package's
 * Schedule bar…) leave their tables — so no read anywhere has to filter them out — and are kept here as JSON with the
 * references other modules had to them, until "Undo" / "Recently deleted" restores them exactly or the purge drops the row
 * (src/server/dal/plan-trash.ts).
 */
export const planTrash = pgTable(
  'plan_trash',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** 'wp' (work package with its activities) | 'act'. */
    kind: text('kind').$type<'wp' | 'act'>().notNull(),
    /** "1.7" / "A1250" and the name at removal. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    activityCount: integer('activity_count').notNull(),
    /** Removed rows per table and the cleared references (plan-trash.ts TrashPayload). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
    deletedByPersonId: uuid('deleted_by_person_id').references(() => persons.id),
    deletedByName: text('deleted_by_name').notNull(),
  },
  (t) => [index('plan_trash_project_idx').on(t.projectId, t.deletedAt)],
);
