// R-158 lot A — Incoterms (reference data, Settings) and the project's shipments (Expéditions screen): shipments, their
// equipment lines, transport steps, loads, content lines and the reasons given for the packing-control gaps. Rules in
// src/domain/incoterms.ts and src/domain/shipments.ts; notes in docs/delivery-9/notes-r158-shipments.md. Lot B: the site reception
// (`shipment_reception_lines`, the punch items it raised `shipment_punch_items`), the generated documents filed in Codex
// (`shipment_documents`), the risk raised for a freight delay, and pub_expeditions (rules in src/domain/shipment-reception.ts and
// src/domain/shipping-documents.ts).
// Relative imports only (drizzle-kit loads these files directly; type-only imports are erased).
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { IncotermModes, IncotermSplit } from '@/domain/incoterms';
import type { ReceptionGap, ReceptionLoadState } from '@/domain/shipment-reception';
import type { LoadType, ShipmentMode, ShipmentStatus } from '@/domain/shipments';
import type { ShippingDocKind } from '@/domain/shipping-documents';
import { eur, id, num, timestamps } from './_common';
import { parts } from './catalogue';
import { risks } from './control';
import { documents } from './documents';
import { storedFiles } from './files';
import { punchItems } from './operations';
import { persons } from './organisation';
import { projectEquipments, projects } from './portfolio';

/**
 * Incoterms (owner's decision 9): the 11 Incoterms 2020 seeded in both seeds (`standard`), others added by the administrator.
 * Names and descriptions are typed in both languages and shown in the viewer's (`incotermText`); `split` gives the party of each
 * step (`INCOTERM_STEPS`). Never deleted while a contract uses it, nor when standard: deactivated instead (`active`).
 */
export const incoterms = pgTable('incoterms', {
  id: id(),
  /** "DAP". */
  code: text('code').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameFr: text('name_fr').notNull(),
  descriptionEn: text('description_en').notNull().default(''),
  descriptionFr: text('description_fr').notNull().default(''),
  /** 'any' (any mode of transport) or 'sea' (sea and inland waterway). */
  modes: text('modes').$type<IncotermModes>().notNull(),
  /** { export_packaging: 'seller', … } — the 10 steps. */
  split: jsonb('split').$type<IncotermSplit>().notNull(),
  /** One of the 11 Incoterms 2020 of the seeds (deactivated, never deleted). */
  standard: boolean('standard').notNull().default(false),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull(),
  ...timestamps,
}, (t) => [
  check('incoterms_code_check', sql`${t.code} ~ '^[A-Z]{3}$'`),
  check('incoterms_modes_check', sql`${t.modes} in ('any', 'sea')`),
]);

/** A shipment of the project's equipment to the site (EXP-01…), linked to one or more equipment lines. */
export const shipments = pgTable('shipments', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** "EXP-01", unique per project. */
  ref: text('ref').notNull(),
  /** Typed title ("Modules MEMU M1–M3"), optional. */
  label: text('label'),
  status: text('status').$type<ShipmentStatus>().notNull().default('draft'),
  mode: text('mode').$type<ShipmentMode>(),
  /** Forwarder (decision 8): an external party without access, typed by EPC2i. */
  forwarder: text('forwarder'),
  /** Origin and destination ports, airports or places (typed). */
  origin: text('origin'),
  destination: text('destination'),
  etd: date('etd', { mode: 'string' }),
  eta: date('eta', { mode: 'string' }),
  /** Actual departure (pick-up) and arrival dates — lot B publishes them as the `expedition` / `arrivee_site` milestones. */
  atd: date('atd', { mode: 'string' }),
  ata: date('ata', { mode: 'string' }),
  note: text('note'),
  /** Packing list validated (status "prepared"): when and by whom; cleared when the content changes. */
  packingValidatedAt: timestamp('packing_validated_at', { withTimezone: true }),
  packingValidatedByPersonId: uuid('packing_validated_by_person_id').references(() => persons.id),
  createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
  /** Lot B: the site reception completed (status "received"), business date. */
  receivedOn: date('received_on', { mode: 'string' }),
  /** Lot B: closed — automatically once its last punch item is closed, or by hand with a reason (`close_reason`). */
  closedOn: date('closed_on', { mode: 'string' }),
  closeReason: text('close_reason'),
  /** Lot B: the risk raised from the freight-delay warning (ETA later than the site need date), when one was. */
  riskId: uuid('risk_id').references(() => risks.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => [
  // Arche K-11: the incremental read of pub_expeditions (`maj_le > …`, maj_le = updated_at) reaches this index.
  index('shipments_updated_at_idx').on(t.updatedAt),
  // R-017 rule (c): a risk deleted from the register clears the link.
  index('shipments_risk_id_idx').on(t.riskId),
  unique('shipments_project_ref_unique').on(t.projectId, t.ref),
  check('shipments_ref_check', sql`${t.ref} ~ '^EXP-[0-9]{2,}$'`),
  check('shipments_status_check', sql`${t.status} in ('draft', 'prepared', 'picked_up', 'in_transit', 'arrived', 'received', 'closed')`),
  check('shipments_mode_check', sql`${t.mode} is null or ${t.mode} in ('road', 'sea', 'air', 'multimodal')`),
]);

/** The equipment lines a shipment carries (R-185 lines; at least one). */
export const shipmentEquipments = pgTable('shipment_equipments', {
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  equipmentId: uuid('equipment_id').notNull().references(() => projectEquipments.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.shipmentId, t.equipmentId] }), index('shipment_equipments_equipment_id_idx').on(t.equipmentId)]);

/** Tracking of a transport step EPC2i organises (the seller's steps of the contract's Incoterm). */
export const shipmentSteps = pgTable('shipment_steps', {
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  /** `INCOTERM_STEPS` key. */
  step: text('step').notNull(),
  plannedOn: date('planned_on', { mode: 'string' }),
  actualOn: date('actual_on', { mode: 'string' }),
  note: text('note'),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.shipmentId, t.step] })]);

/** A load EPC2i declares (decision 10): a truck or a container, its number and seal, its gross weight. */
export const shipmentLoads = pgTable('shipment_loads', {
  id: id(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  /** 1, 2… within the shipment ("Load 2"). */
  number: integer('number').notNull(),
  type: text('load_type').$type<LoadType>().notNull(),
  /** Container number or truck plate (typed, "MSKU 123456-7"). */
  identifier: text('identifier'),
  seal: text('seal'),
  /** Gross weight of the load as declared, kg (content lines carry their own weights). */
  grossKg: num('gross_kg'),
  note: text('note'),
  ...timestamps,
}, (t) => [
  unique('shipment_loads_number_unique').on(t.shipmentId, t.number),
  check('shipment_loads_type_check', sql`${t.type} in ('truck', 'c20', 'c40', 'c40hc', 'open_top', 'flat_rack', 'out_of_gauge')`),
]);

/**
 * Content of a load: a catalogue part (matched to the project's BOM by the packing control) or a free item (description, HS
 * code and unit value typed), with its quantity, packages, package dimensions, weights and origin.
 */
export const shipmentItems = pgTable('shipment_items', {
  id: id(),
  loadId: uuid('load_id').notNull().references(() => shipmentLoads.id, { onDelete: 'cascade' }),
  partId: uuid('part_id').references(() => parts.id),
  /** Free item: its description (null for a part, whose name is the catalogue's). */
  description: text('description'),
  /** Free item: HS code and unit value, €. */
  hsCode: text('hs_code'),
  unitValueEur: eur('unit_value_eur'),
  quantity: num('quantity').notNull(),
  packages: integer('packages'),
  lengthCm: num('length_cm'),
  widthCm: num('width_cm'),
  heightCm: num('height_cm'),
  netKg: num('net_kg'),
  grossKg: num('gross_kg'),
  /** ISO 3166-1 alpha-2 country of origin ("FR"). */
  originCountry: text('origin_country'),
  position: integer('position').notNull(),
  ...timestamps,
}, (t) => [
  check('shipment_items_kind_check', sql`(${t.partId} is not null) or (${t.description} is not null)`),
  check('shipment_items_quantity_check', sql`${t.quantity} > 0`),
  index('shipment_items_load_id_idx').on(t.loadId),
]);

/** The reason given for a packing-control gap (decision 4), valid for the difference it was given for (`delta`). */
export const shipmentGapReasons = pgTable('shipment_gap_reasons', {
  id: id(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  /** 'part:<ref>' or 'item:<content line id>' (`partKey` / `itemKey`). */
  gapKey: text('gap_key').notNull(),
  delta: num('delta').notNull(),
  reason: text('reason').notNull(),
  byPersonId: uuid('by_person_id').references(() => persons.id),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('shipment_gap_reasons_key_unique').on(t.shipmentId, t.gapKey)]);

/**
 * Lot B — the site reception (decision 5), pointed once the shipment has arrived: one row per load (`item_id` null: the load as a
 * whole — received, missing or damaged container / truck) and one per content line (quantities received, missing and damaged,
 * their sum = the quantity shipped). Rules: src/domain/shipment-reception.ts.
 */
export const shipmentReceptionLines = pgTable('shipment_reception_lines', {
  id: id(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  loadId: uuid('load_id').notNull().references(() => shipmentLoads.id, { onDelete: 'cascade' }),
  /** Null = the load itself. */
  itemId: uuid('item_id').references(() => shipmentItems.id, { onDelete: 'cascade' }),
  /** A load's state; null on a content line. */
  loadState: text('load_state').$type<ReceptionLoadState>(),
  receivedQty: num('received_qty'),
  missingQty: num('missing_qty'),
  damagedQty: num('damaged_qty'),
  note: text('note'),
  byPersonId: uuid('by_person_id').references(() => persons.id),
  /** Business date of the pointing. */
  pointedOn: date('pointed_on', { mode: 'string' }).notNull(),
  ...timestamps,
}, (t) => [
  unique('shipment_reception_lines_line_unique').on(t.loadId, t.itemId).nullsNotDistinct(),
  // R-017: the reception is read by shipment; a content line removed cascades.
  index('shipment_reception_lines_shipment_id_idx').on(t.shipmentId),
  index('shipment_reception_lines_item_id_idx').on(t.itemId),
  check('shipment_reception_lines_state_check', sql`${t.loadState} is null or ${t.loadState} in ('received', 'missing', 'damaged')`),
  check('shipment_reception_lines_kind_check', sql`(${t.itemId} is null) = (${t.loadState} is not null)`),
]);

/** Lot B — the punch items (réserves, R-117 list) a reception gap raised (decision 5), on the shipment's equipment line. */
export const shipmentPunchItems = pgTable('shipment_punch_items', {
  id: id(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  punchItemId: uuid('punch_item_id').notNull().unique().references(() => punchItems.id, { onDelete: 'cascade' }),
  loadId: uuid('load_id').notNull().references(() => shipmentLoads.id, { onDelete: 'cascade' }),
  /** Null = a gap of the load itself. */
  itemId: uuid('item_id').references(() => shipmentItems.id, { onDelete: 'cascade' }),
  gap: text('gap').$type<ReceptionGap>().notNull(),
  /** Quantity of the gap when the item was raised or last updated (a content line). */
  quantity: num('quantity'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('shipment_punch_items_gap_unique').on(t.loadId, t.itemId, t.gap).nullsNotDistinct(),
  // R-017: read by shipment (pub_expeditions counts them); a content line removed cascades.
  index('shipment_punch_items_shipment_id_idx').on(t.shipmentId),
  index('shipment_punch_items_item_id_idx').on(t.itemId),
  check('shipment_punch_items_gap_check', sql`${t.gap} in ('missing', 'damaged')`),
]);

/**
 * Lot B — a shipping document generated by Keystone and filed in Codex (decision 3: every document but the invoices). One row per
 * filed version: the PDF kept as filed (`stored_file_id`, its SHA-256) and the Codex index record it revised (type SHP, one record
 * per shipment and kind, a new revision letter at each filing).
 */
export const shipmentDocuments = pgTable('shipment_documents', {
  id: id(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<ShippingDocKind>().notNull(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  /** Codex number and revision at filing ("SHP-HLT-041", "B"). */
  number: text('number').notNull(),
  revision: text('revision').notNull(),
  storedFileId: uuid('stored_file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
  /** SHA-256 of the PDF as filed; null for the demo data set's rows (seeded without a file, regenerated on demand). */
  sha256: text('sha256'),
  /** Language the PDF was generated in. */
  lang: text('lang').notNull(),
  generatedByPersonId: uuid('generated_by_person_id').references(() => persons.id),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('shipment_documents_version_unique').on(t.shipmentId, t.kind, t.revision),
  // R-017: a Codex index record or a stored file removed clears the link.
  index('shipment_documents_document_id_idx').on(t.documentId),
  index('shipment_documents_stored_file_id_idx').on(t.storedFileId),
  check('shipment_documents_kind_check', sql`${t.kind} in ('packing_list', 'container_packing_list', 'delivery_note', 'marking', 'cmr', 'shipping_instructions', 'origin_request', 'export_declaration')`),
]);
