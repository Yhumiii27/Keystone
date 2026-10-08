// Suppliers and storage locations (docs/spec/11 §3.8 Supplier, StorageLocation; screens 08 §1.4.4 scorecard, 08 §4
// stock). Kept apart from the catalogue and the purchasing tables so both can reference them without an import cycle.
// Relative imports only: drizzle-kit loads these files directly.
import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';
import type { LocationType, SupplierGrade } from '../codes';
import { id, num, timestamps } from './_common';

/**
 * Suppliers and manufacturers: the 8 companies of the supplier scorecard (SUPPLIERS 3538) plus every other company the
 * data set cites — part manufacturers (`PARTS.mfr`, incl. Keystone's own workshops), RFQ bidders, invoice issuers.
 * The scorecard fields are null for companies that are not rated.
 */
export const suppliers = pgTable('suppliers', {
  id: id(),
  /** "Halvorsen Cranes". */
  name: text('name').notNull().unique(),
  /** Sage X3 supplier code (not in the prototype). */
  x3Code: text('x3_code'),
  /** Scorecard (static in the prototype; derivation OPEN QUESTION SC-6): on-time delivery, quality acceptance, NCR rate (%). */
  onTimeDeliveryPct: num('on_time_delivery_pct'),
  qualityAcceptancePct: num('quality_acceptance_pct'),
  ncrRatePct: num('ncr_rate_pct'),
  grade: text('grade').$type<SupplierGrade>(),
  /**
   * Open purchase orders of the supplier in Sage X3, all company orders (scorecard "Open POs" — a snapshot of the
   * ERP, not a count of this database's orders).
   */
  openPoCount: integer('open_po_count'),
  /** Row order on the scorecard (SUPPLIERS order); null = not on the scorecard. */
  scorecardPosition: integer('scorecard_position'),
  /** Keystone's own workshops (Keystone Steelworks, Keystone Cranes, Keystone Electronics) — manufacturers of the "Manufactured" parts. */
  isInternal: boolean('is_internal').notNull().default(false),
  position: integer('position').notNull(),
  ...timestamps,
});

/** Storage locations & workshops (SETTINGS0.locations; Settings › "Stock locations & workshops"). */
export const storageLocations = pgTable('storage_locations', {
  id: id(),
  /** "Entrepôt central — Lyon" (data value, French). */
  name: text('name').notNull().unique(),
  type: text('location_type').$type<LocationType>().notNull(),
  /** Settings order (stock chips, transfer targets). */
  position: integer('position').notNull(),
  /**
   * Configured in Settings (chips, transfer targets, location count). False for "Magasin chantier — Lyon", the
   * put-away location of the prototype's generated receipts that Settings does not list (11 §7 #23, SC-5): kept so
   * those receipts show what the prototype shows, never offered as a target.
   */
  active: boolean('active').notNull().default(true),
  ...timestamps,
});
