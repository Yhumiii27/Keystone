// Parts catalogue — PLM master data (docs/spec/11 §3.9 Part, AssemblyLink, SpareListLine; screens 09 §1–3): parts with
// their customs and export data, equivalents, last purchase price, product structure (assembly links) and the
// recommended wear & spare parts lists of the systems. Project usage (BOM lines), drawings and revision diffs live in
// plm.ts. HS code, quantities and values are first-class columns: the future "Expédition & transport" module
// (docs/BACKLOG.md §1) reads them for customs summaries and packing-list checks.
import { boolean, date, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ExportControl, PartMakeBuy, PartStatus, PartType, PartUnit, WearSpare } from '../codes';
import { eur, id, num, timestamps } from './_common';
import { persons } from './organisation';
import { suppliers } from './suppliers';

/** Catalogue articles (PARTS 3343, 54 rows; `pu` from WEAR_SPARE 3341). */
export const parts = pgTable('parts', {
  id: id(),
  /** "EL-VFD-200". */
  ref: text('ref').notNull().unique(),
  /** EN data text ("Frequency drive 200 kW"). */
  name: text('name').notNull(),
  makeBuy: text('make_buy').$type<PartMakeBuy>().notNull(),
  type: text('part_type').$type<PartType>().notNull(),
  /** List / standard unit price, € (`price`). */
  listPriceEur: eur('list_price_eur').notNull(),
  /** Manufacturer / preferred supplier (`mfr`); null when the New part form left it empty. */
  manufacturerId: uuid('manufacturer_id').references(() => suppliers.id),
  /** Manufacturer reference, or Keystone drawing number for manufactured parts (`mfrRef`). */
  manufacturerRef: text('manufacturer_ref'),
  /** Customs (HS) code ("8504.40"); null = not applicable (prototype "n/a"). */
  hsCode: text('hs_code'),
  /** Export restriction text (EN source, `restr`); null = "None". */
  exportRestriction: text('export_restriction'),
  /** Export-control family of the restriction (null = none). */
  exportControl: text('export_control').$type<ExportControl>(),
  status: text('status').$type<PartStatus>().notNull(),
  /**
   * R-102 (E-1a, E-1b): engineering's qualification. `hs_not_applicable` = an explicit "no customs code" (null `hs_code` alone
   * also means "not filled in"); `export_reviewed` = the export restriction was confirmed, "None" included (a null
   * `export_restriction` alone also means "not checked"; false on the rows that existed before); who validated the part and
   * when (null for the seed's Validated parts).
   */
  hsNotApplicable: boolean('hs_not_applicable').notNull().default(false),
  exportReviewed: boolean('export_reviewed').notNull().default(false),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  validatedByPersonId: uuid('validated_by_person_id').references(() => persons.id),
  /** Current revision letter / index; null = "—" (software, no revision). */
  revision: text('revision'),
  /** Lead time in weeks; null = none ("—", prototype 0). */
  leadWeeks: integer('lead_weeks'),
  /** Wear part (PU) / spare part (PR); null = neither. */
  wearSpare: text('wear_spare').$type<WearSpare>(),
  /** Unit of measure (New part form); the seed parts are pieces. */
  unit: text('unit').$type<PartUnit>().notNull().default('pc'),
  /** Catalogue order (PARTS order; parts created in Keystone are appended). */
  position: integer('position').notNull(),
  createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
  ...timestamps,
});

/** Registered equivalents (`PARTS.equiv`), one row per direction as the catalogue lists them. */
export const partEquivalents = pgTable(
  'part_equivalents',
  {
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    equivalentPartId: uuid('equivalent_part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.partId, t.equivalentPartId] })],
);

/** Last purchase price (LAST_PRICE 3428, 15 parts); `lastPrice(p)` falls back to the list price. */
export const partLastPrices = pgTable('part_last_prices', {
  partId: uuid('part_id').primaryKey().references(() => parts.id, { onDelete: 'cascade' }),
  unitPriceEur: eur('unit_price_eur').notNull(),
  /** Unknown for the seed. */
  purchasedOn: date('purchased_on', { mode: 'string' }),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Product structure (TREE 3421): child × quantity per parent assembly, in drawing order. */
export const assemblyLinks = pgTable(
  'assembly_links',
  {
    id: id(),
    parentPartId: uuid('parent_part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    childPartId: uuid('child_part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    quantity: num('quantity').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.parentPartId, t.childPartId)],
);

/** Recommended wear & spare parts of a system (SPARE_LISTS 3399): quantity per system; recommended = × systems in the project. */
export const spareListLines = pgTable(
  'spare_list_lines',
  {
    id: id(),
    /** The system (assembly) the list belongs to. */
    systemPartId: uuid('system_part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    partId: uuid('part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<WearSpare>().notNull(),
    qtyPerSystem: num('qty_per_system').notNull(),
    /** Replacement interval / note ("24 months · 8 000 km travel"); null when none. */
    note: text('note'),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.systemPartId, t.partId)],
);
