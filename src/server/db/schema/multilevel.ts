// R-204 — multi-level planning: activity codes (a dictionary per project, assigned to activities, to filter and group the Plan
// and the Gantt) and supplier schedules (the sub-network of milestones / activities a supplier commits to for one purchase
// order — the purchasing package — consolidated into the project CPM through ties to the project's activities).
// Pure rules: src/domain/activity-codes.ts, src/domain/supplier-schedule.ts. Writers: src/server/dal/activity-codes.ts,
// src/server/dal/supplier-schedules.ts.
import { check, date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { LinkType } from '../codes';
import { id, timestamps } from './_common';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';
import { purchaseOrders } from './purchasing';

/** Stored code types of a project ('site' at most once per project; 'custom' = a type the PM names). */
export type ActivityCodeKind = 'site' | 'custom';

/**
 * Activity code types the PM adds to a project. The equipment line (R-185) and the purchasing package (purchase orders) are
 * derived from existing links and are not stored here.
 */
export const activityCodeTypes = pgTable(
  'activity_code_types',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ActivityCodeKind>().notNull(),
    /** As typed ("Zone", "Discipline"); the site type keeps the name the PM gave it. */
    name: text('name').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.name), check('activity_code_types_kind_check', sql`${t.kind} in ('site', 'custom')`)],
);

/** Values of a stored code type ("Z1" · "Hall A"). */
export const activityCodeValues = pgTable(
  'activity_code_values',
  {
    id: id(),
    typeId: uuid('type_id').notNull().references(() => activityCodeTypes.id, { onDelete: 'cascade' }),
    /** Short code ("Z1"), unique in its type. */
    code: text('code').notNull(),
    /** Description as typed ("Hall A"). */
    label: text('label').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.typeId, t.code)],
);

/** One value per type and activity. */
export const activityCodeAssignments = pgTable(
  'activity_code_assignments',
  {
    id: id(),
    activityId: uuid('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id').notNull().references(() => activityCodeTypes.id, { onDelete: 'cascade' }),
    valueId: uuid('value_id').notNull().references(() => activityCodeValues.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.activityId, t.typeId), index('activity_code_assignments_value_id_idx').on(t.valueId), index('activity_code_assignments_type_id_idx').on(t.typeId)],
);

/** The supplier schedule of one purchase order (the purchasing package): at most one per order. */
export const supplierSchedules = pgTable(
  'supplier_schedules',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    poId: uuid('po_id').notNull().unique().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    ...timestamps,
  },
  (t) => [index('supplier_schedules_project_id_idx').on(t.projectId)],
);

/**
 * Milestones (duration 0) and activities of a supplier schedule, as the supplier's schedule gives them: duration in working days
 * (project calendar) and the committed dates (the supplier's reference); the buyer enters the actual dates and % complete.
 */
export const supplierScheduleActivities = pgTable(
  'supplier_schedule_activities',
  {
    id: id(),
    scheduleId: uuid('schedule_id').notNull().references(() => supplierSchedules.id, { onDelete: 'cascade' }),
    /** "F10", unique in the schedule (the CPM node is "PO-1082/F10"). */
    code: text('code').notNull(),
    name: text('name').notNull(),
    durationDays: integer('duration_days').notNull(),
    committedStart: date('committed_start', { mode: 'string' }),
    committedFinish: date('committed_finish', { mode: 'string' }),
    actualStart: date('actual_start', { mode: 'string' }),
    actualFinish: date('actual_finish', { mode: 'string' }),
    percentComplete: integer('percent_complete').notNull().default(0),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.scheduleId, t.code), check('supplier_schedule_activities_pct_check', sql`${t.percentComplete} between 0 and 100`)],
);

/** Logic inside a supplier schedule. */
export const supplierScheduleLinks = pgTable(
  'supplier_schedule_links',
  {
    id: id(),
    scheduleId: uuid('schedule_id').notNull().references(() => supplierSchedules.id, { onDelete: 'cascade' }),
    predecessorId: uuid('predecessor_id').notNull().references(() => supplierScheduleActivities.id, { onDelete: 'cascade' }),
    successorId: uuid('successor_id').notNull().references(() => supplierScheduleActivities.id, { onDelete: 'cascade' }),
    type: text('type').$type<LinkType>().notNull(),
    lagDays: integer('lag_days').notNull().default(0),
  },
  (t) => [
    unique().on(t.predecessorId, t.successorId),
    index('supplier_schedule_links_schedule_id_idx').on(t.scheduleId),
    index('supplier_schedule_links_successor_id_idx').on(t.successorId),
  ],
);

/** Direction of a tie between a supplier activity and a project activity (always finish-to-start). */
export type SupplierTieDirection = 'to_project' | 'from_project';

/**
 * Ties consolidating a supplier schedule into the project CPM, set by the project's leads: 'to_project' = the supplier activity
 * (usually the delivery) precedes the project activity (reception, installation); 'from_project' = a project activity (drawings
 * approval by EPC2i) precedes the supplier activity.
 */
export const supplierScheduleTies = pgTable(
  'supplier_schedule_ties',
  {
    id: id(),
    scheduleId: uuid('schedule_id').notNull().references(() => supplierSchedules.id, { onDelete: 'cascade' }),
    supplierActivityId: uuid('supplier_activity_id').notNull().references(() => supplierScheduleActivities.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<SupplierTieDirection>().notNull(),
    lagDays: integer('lag_days').notNull().default(0),
  },
  (t) => [
    unique().on(t.supplierActivityId, t.activityId),
    index('supplier_schedule_ties_schedule_id_idx').on(t.scheduleId),
    index('supplier_schedule_ties_activity_id_idx').on(t.activityId),
    check('supplier_schedule_ties_direction_check', sql`${t.direction} in ('to_project', 'from_project')`),
  ],
);
