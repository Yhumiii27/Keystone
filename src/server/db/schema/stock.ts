// Stock (docs/spec/11 §3.8 StockPosition, StockMovement; screen 08 §4): positions per article and storage location
// imported from Sage X3, local movements recorded in Keystone and flagged until pushed back to X3 (the accounting
// reference), and the X3 exchange runs of the mock connector.
import { date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { StockMovementType, StockSource, X3SyncKind } from '../codes';
import { num, id, timestamps } from './_common';
import { parts } from './catalogue';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';
import { goodsReceipts } from './purchasing';
import { storageLocations } from './suppliers';

/**
 * Stock positions (STOCK0 3475, 18 lines). Available = on hand − reserved; value = on hand × last purchase price;
 * below minimum = min > 0 ∧ on hand < min (all derived).
 */
export const stockPositions = pgTable(
  'stock_positions',
  {
    id: id(),
    partId: uuid('part_id').notNull().references(() => parts.id),
    locationId: uuid('location_id').notNull().references(() => storageLocations.id),
    onHand: num('on_hand').notNull(),
    reserved: num('reserved').notNull(),
    /** Project the reserved quantity is held for (`proj` 3-letter in the prototype). */
    reservedForProjectId: uuid('reserved_for_project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Minimum level; 0 = none. */
    minQty: num('min_qty').notNull(),
    /** x3 = as imported; local = changed in Keystone, not yet pushed back to X3. */
    source: text('source').$type<StockSource>().notNull(),
    lastMovementOn: date('last_movement_on', { mode: 'string' }).notNull(),
    /** STOCK0 order; positions created by a transfer or a receipt are appended. */
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.partId, t.locationId)],
);

/** Stock movements (MOVES0 3484 + movements recorded in Keystone). */
export const stockMovements = pgTable('stock_movements', {
  id: id(),
  /** "25 Sep 14:10" (Europe/Paris). */
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  type: text('movement_type').$type<StockMovementType>().notNull(),
  partId: uuid('part_id').notNull().references(() => parts.id),
  qty: num('qty').notNull(),
  fromLocationId: uuid('from_location_id').references(() => storageLocations.id),
  toLocationId: uuid('to_location_id').references(() => storageLocations.id),
  /** Project reserved for / issued to. */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** Activity issued to. */
  activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
  /** Goods receipt that brought the goods in. */
  receiptId: uuid('receipt_id').references(() => goodsReceipts.id, { onDelete: 'set null' }),
  /** "Where" as the movement lists show it ("Entrepôt central — Lyon → Atelier mécanique — Lyon", "QC failed · BL-2026-0533"). */
  whereText: text('where_text').notNull(),
  /** Who (as cited) and the person when known. */
  personName: text('person_name').notNull(),
  personId: uuid('person_id').references(() => persons.id),
  /** Pushed back to Sage X3 (null = local, pending push). The seed movements come from X3. */
  pushedToX3At: timestamp('pushed_to_x3_at', { withTimezone: true }),
  /**
   * Delivery 7 (SC-5a, R-098): the stock unit cost at the movement (A-11: last purchase price, else list price) and the
   * value charged to (issue) or credited back to (return) the work package `wbsCode` (level-1 WBS code of the activity at
   * the time, kept when the activity is removed). Null on movements without a work package (seed, transfers…).
   */
  unitCostEur: num('unit_cost_eur'),
  valueEur: num('value_eur'),
  wbsCode: text('wbs_code'),
  /** Delivery 7 (R-099): units reserved for another project taken by the portfolio director's override, and that project. */
  overrideQty: num('override_qty'),
  overrideFromProjectId: uuid('override_from_project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('stock_movements_project_id_idx').on(t.projectId)]);

/** Sage X3 exchanges ("X3 import 07:15 · 15 lines from Sage X3"; Import from X3, Push to X3). */
export const x3SyncRuns = pgTable('x3_sync_runs', {
  id: id(),
  kind: text('kind').$type<X3SyncKind>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  /** Stock lines received from (import) or sent to (push) X3. */
  lineCount: integer('line_count').notNull(),
  requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
});
