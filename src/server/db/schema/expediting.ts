// R-159 (P1, D9-31) — expediting of the purchase orders: the supplier's fabrication progress, the inspections at the supplier's
// works (FAT included, tied to an ITP FAT point when one exists) and the release notes (bons de libération) that authorise the
// supplier to ship. Rules: src/domain/expediting.ts. R-162 (P4, D9-34) — the dated reference exchange rates (Settings) that
// value the projects' FX exposure (src/domain/fx-exposure.ts).
import { date, index, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { PoInspectionKind, PoInspectionResult } from '@/domain/expediting';
import { id, timestamps } from './_common';
import { itpInspections } from './operations';
import { persons } from './organisation';
import { projects } from './portfolio';
import { purchaseOrders } from './purchasing';

/** One fabrication follow-up per order: the progress the supplier reports (entered by the buyer or quality). */
export const poExpediting = pgTable('po_expediting', {
  poId: uuid('po_id').primaryKey().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** % complete of the fabrication, 0–100. */
  fabricationPct: integer('fabrication_pct').notNull().default(0),
  /** Day the supplier reported it. */
  reportedOn: date('reported_on', { mode: 'string' }),
  note: text('note'),
  updatedByName: text('updated_by_name'),
  updatedByPersonId: uuid('updated_by_person_id').references(() => persons.id),
  ...timestamps,
}, (t) => [index('po_expediting_project_id_idx').on(t.projectId)]);

/** Inspection milestones of an order at the supplier's works ("I-1", "I-2"… per order). */
export const poInspections = pgTable(
  'po_inspections',
  {
    id: id(),
    poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    kind: text('kind').$type<PoInspectionKind>().notNull(),
    name: text('name').notNull(),
    /** Where it is held ("Supplier's works, Lyon"); null = the supplier's works. */
    location: text('location'),
    plannedOn: date('planned_on', { mode: 'string' }),
    /** Inspector as typed (a person of EPC2i, a third-party inspector). */
    inspectorName: text('inspector_name'),
    result: text('result').$type<PoInspectionResult>().notNull().default('planned'),
    resultOn: date('result_on', { mode: 'string' }),
    resultComment: text('result_comment'),
    /** NCR number Vigie gave (typed); Vigie's own echo of the inspection reference is read from the NCR mirror. */
    ncrRef: text('ncr_ref'),
    /** The project's ITP FAT point this FAT stands for (stage 'fat'); null when none. */
    itpInspectionId: uuid('itp_inspection_id').references(() => itpInspections.id, { onDelete: 'set null' }),
    resultRecordedByName: text('result_recorded_by_name'),
    resultRecordedAt: timestamp('result_recorded_at', { withTimezone: true }),
    createdByName: text('created_by_name'),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.poId, t.number), index('po_inspections_project_id_idx').on(t.projectId), index('po_inspections_itp_inspection_id_idx').on(t.itpInspectionId)],
);

/** Release notes (bons de libération) of an order: issued by quality, withdrawn with a reason (never deleted). */
export const poReleaseNotes = pgTable(
  'po_release_notes',
  {
    id: id(),
    poId: uuid('po_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "PO-1078-RN1". */
    number: text('number').notNull().unique(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    issuedByName: text('issued_by_name').notNull(),
    issuedByPersonId: uuid('issued_by_person_id').references(() => persons.id),
    /** Inspector who signs the release with quality (typed), null when none. */
    inspectorName: text('inspector_name'),
    /** What is released ("Whole order", "Frames 1–4"). */
    scope: text('scope').notNull(),
    reserves: text('reserves'),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnByName: text('withdrawn_by_name'),
    withdrawReason: text('withdraw_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('po_release_notes_po_id_idx').on(t.poId), index('po_release_notes_project_id_idx').on(t.projectId)],
);

/** R-162: reference exchange rates — euros per unit of a currency, valid from a date (one per currency and date). */
export const fxReferenceRates = pgTable(
  'fx_reference_rates',
  {
    id: id(),
    currency: text('currency').notNull(),
    rate: numeric('rate', { mode: 'number' }).notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    createdByName: text('created_by_name').notNull(),
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.currency, t.validFrom)],
);
