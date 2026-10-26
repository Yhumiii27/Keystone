// Cost control (docs/spec/11 §3.5, docs/spec/04 §1.8): cost categories, work-package budgets, commercial
// offer quotes, cost streams and the monthly EVM series (PV / EV / AC) of projectData().
import { index, integer, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { CostType } from '../codes';
import { id, keur, timestamps } from './_common';
import { wbsNodes } from './planning';
import { projects } from './portfolio';

/** Cost categories (HCAT_ROWS 3192 + HCATS 3112 / generated CAT_ROWS + CATS, same order). */
export const costCategories = pgTable(
  'cost_categories',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "C01". */
    code: text('code').notNull(),
    name: text('name').notNull(),
    costType: text('cost_type').$type<CostType>().notNull(),
    budgetKeur: keur('budget_keur').notNull(),
    actualKeur: keur('actual_keur').notNull(),
    committedKeur: keur('committed_keur').notNull(),
    forecastKeur: keur('forecast_keur').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.code)],
);

/**
 * Budget per work package (HWPS 3194 / generated WPS): original, approved changes, actual, EAC. The last row
 * ("—", "Contingency (unallocated)") has no WBS node.
 */
export const wpBudgets = pgTable('wp_budgets', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  wbsNodeId: uuid('wbs_node_id').references(() => wbsNodes.id),
  /** "1.4" or "—". */
  wbsCode: text('wbs_code').notNull(),
  name: text('name').notNull(),
  originalKeur: keur('original_keur').notNull(),
  changesKeur: keur('changes_keur').notNull(),
  actualKeur: keur('actual_keur').notNull(),
  eacKeur: keur('eac_keur').notNull(),
  position: integer('position').notNull(),
  ...timestamps,
}, (t) => [index('wp_budgets_project_id_idx').on(t.projectId)]);

/** Commercial-offer supplier quotes (HLT_OFFER 3097 / generated OFFER). Months index chartMonths. */
export const offerQuotes = pgTable('offer_quotes', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  /** "Structural steel — columns, beams, purlins". */
  system: text('system').notNull(),
  /** "Keystone Steelworks" (free text until the supplier register is linked). */
  supplierName: text('supplier_name').notNull(),
  amountKeur: keur('amount_keur').notNull(),
  /** Display terms "30 / 60 / 10" (deposit / delivery / acceptance %, positional as parsed by offerPoints). */
  terms: text('terms').notNull(),
  depositPct: integer('deposit_pct'),
  deliveryPct: integer('delivery_pct'),
  acceptancePct: integer('acceptance_pct'),
  orderMonth: integer('order_month').notNull(),
  deliveryMonth: integer('delivery_month').notNull(),
  acceptanceMonth: integer('acceptance_month'),
  leadWeeks: integer('lead_weeks').notNull(),
}, (t) => [index('offer_quotes_project_id_idx').on(t.projectId)]);

/** Other cost streams (HLT_STREAMS 3098 / generated STREAMS): name + basis; monthly values when known. */
export const costStreams = pgTable('cost_streams', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  basis: text('basis').notNull(),
}, (t) => [index('cost_streams_project_id_idx').on(t.projectId)]);

export const costStreamPeriods = pgTable(
  'cost_stream_periods',
  {
    streamId: uuid('stream_id').notNull().references(() => costStreams.id, { onDelete: 'cascade' }),
    /** Month index from the project start (chartMonths). */
    monthIndex: integer('month_index').notNull(),
    amountKeur: keur('amount_keur').notNull(),
  },
  (t) => [primaryKey({ columns: [t.streamId, t.monthIndex] })],
);

/**
 * Cumulative EVM series by month (HPV/HEV/HAC 3100–3103 / generated PV, EV, AC). PV covers 12 months;
 * EV and AC stop at the data date (null afterwards).
 */
export const evmPeriods = pgTable(
  'evm_periods',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** Month index from the project start (chartMonths). */
    monthIndex: integer('month_index').notNull(),
    pvKeur: keur('pv_keur').notNull(),
    evKeur: keur('ev_keur'),
    acKeur: keur('ac_keur'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.monthIndex] })],
);
