// R-187 (Arche K-02, K-03, K-10): the subsidiaries' CAPEX and machine needs mirrored from the CAPEX application (Arche), and
// Keystone's answers to the needs. Rules: src/domain/capex-needs.ts; connector: src/server/integrations/capex/.
//   capex_mirror, capex_needs   read-only copies of arche.pub_capex and arche.pub_besoins_machines, replaced by each read of the
//                               source (shared PostgreSQL server, or the simulated source of a demo database); never edited in
//                               Keystone. Keys are Arche's (cross-schema references, no foreign key).
//   capex_sync_runs             one row per read of the source (job, "Refresh", "Sync now"): the connector's state.
//   need_answers                Keystone's answers, published to Arche by the view pub_reponses_besoins (0050_capex_needs_share):
//                               one row per answer, the most recent is authoritative; `updated_at` = maj_le (indexed, K-11).
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { EstimateClass } from '../codes';
import { id, keur, num, timestamps } from './_common';
import { persons } from './organisation';
import { projects } from './portfolio';

/** A subsidiary CAPEX as Arche publishes it (pub_capex). The sponsor's and the lead's e-mails are not kept. */
export const capexMirror = pgTable('capex_mirror', {
  /** "CPX-APM-2026-01". */
  code: text('code').primaryKey(),
  subsidiaryCode: text('subsidiary_code'),
  subsidiaryName: text('subsidiary_name'),
  zone: text('zone'),
  site: text('site'),
  countryIso2: text('country_iso2'),
  title: text('title').notNull(),
  investmentType: text('investment_type'),
  status: text('status'),
  phaseCode: text('phase_code'),
  typology: text('typology'),
  sponsorName: text('sponsor_name'),
  leadName: text('lead_name'),
  g1On: date('g1_on', { mode: 'string' }),
  g2On: date('g2_on', { mode: 'string' }),
  g3On: date('g3_on', { mode: 'string' }),
  commissioningOn: date('commissioning_on', { mode: 'string' }),
  /** `maj_le` at the source. */
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
  /** When this copy was last written by a read of the source. */
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A subsidiary's machine need as Arche publishes it (pub_besoins_machines; drafts never). */
export const capexNeeds = pgTable('capex_needs', {
  /** "CPX-APM-2026-01/B01". */
  needRef: text('need_ref').primaryKey(),
  capexCode: text('capex_code').notNull(),
  /** "B01". */
  line: text('line').notNull(),
  /** Catalogue code and version chosen (pub_catalogue_machines), both null for a free need. */
  catalogueCode: text('catalogue_code'),
  catalogueVersion: integer('catalogue_version'),
  /** Typed in Arche (dataText): the free need's label and the comment. */
  freeLabel: text('free_label'),
  quantity: integer('quantity').notNull(),
  /** Codes of the catalogue options chosen. */
  options: jsonb('options').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  targetCapacity: num('target_capacity'),
  capacityUnit: text('capacity_unit'),
  neededOn: date('needed_on', { mode: 'string' }),
  site: text('site'),
  /** 'submitted' | 'withdrawn' | 'ordered'. */
  status: text('status').$type<'submitted' | 'withdrawn' | 'ordered'>().notNull(),
  comment: text('comment'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  /** Date of the CAPEX's G2 (the order). */
  orderedOn: date('ordered_on', { mode: 'string' }),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('capex_needs_capex_code_idx').on(t.capexCode),
  check('capex_needs_status_check', sql`${t.status} in ('submitted', 'withdrawn', 'ordered')`),
  check('capex_needs_quantity_check', sql`${t.quantity} >= 1`),
]);

/** One read of Arche's views: where from, what it brought, and whether it worked (the mirror is kept on a failure). */
export const capexSyncRuns = pgTable('capex_sync_runs', {
  id: id(),
  /** 'server' (arche.pub_ views on the shared server) | 'simulation' (the demo source). */
  source: text('source').$type<'server' | 'simulation'>().notNull(),
  /** 'job' | 'refresh' (the card's button) | 'sync' (Activity & integrations). */
  trigger: text('trigger').notNull(),
  ok: boolean('ok').notNull(),
  capexCount: integer('capex_count').notNull().default(0),
  needCount: integer('need_count').notNull().default(0),
  /** Rows of the source left out because they were malformed. */
  skipped: integer('skipped').notNull().default(0),
  error: text('error'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('capex_sync_runs_synced_at_idx').on(t.syncedAt)]);

/**
 * Keystone's answer to a machine need (K-02, K-03): one row per answer, the most recent (answered_at, then number) is
 * authoritative for Arche. An answer in preparation is edited; a sent one is final (a new answer is a new row) except its status
 * (sent → accepted / lapsed) and the project created at the order (K-10), carried over to the need's later answers.
 */
export const needAnswers = pgTable('need_answers', {
  id: id(),
  /** "RB-001" — never reused. */
  number: text('number').notNull().unique(),
  needRef: text('need_ref').notNull(),
  capexCode: text('capex_code').notNull(),
  /** 'qualification' | 'indicatif' | 'devis' | 'offre_ferme'. */
  nature: text('nature').$type<'qualification' | 'indicatif' | 'devis' | 'offre_ferme'>().notNull(),
  /** 'faisable' | 'a_etudier' | 'refuse'. */
  qualification: text('qualification').$type<'faisable' | 'a_etudier' | 'refuse'>().notNull(),
  /** Typed text (dataText). */
  reason: text('reason'),
  estimateClass: text('estimate_class').$type<EstimateClass>(),
  centralKeur: keur('central_keur'),
  lowKeur: keur('low_keur'),
  highKeur: keur('high_keur'),
  leadTimeWeeks: integer('lead_time_weeks'),
  validUntil: date('valid_until', { mode: 'string' }),
  /** Codex document number of the quote or the offer (Codex hosts the file). */
  documentRef: text('document_ref'),
  /** The EPC2i project created (or completed) at the order, K-10: pub_reponses_besoins.projet_code. */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** 'en_cours' | 'remise' | 'acceptee' | 'caduque'. */
  status: text('status').$type<'en_cours' | 'remise' | 'acceptee' | 'caduque'>().notNull().default('en_cours'),
  /** When the answer was recorded, then when it was sent (repondu_le). */
  answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  answeredByPersonId: uuid('answered_by_person_id').references(() => persons.id, { onDelete: 'set null' }),
  answeredByName: text('answered_by_name').notNull(),
  ...timestamps,
}, (t) => [
  index('need_answers_need_ref_idx').on(t.needRef),
  index('need_answers_updated_at_idx').on(t.updatedAt),
  check('need_answers_number_check', sql`${t.number} ~ '^RB-[0-9]{3,}$'`),
  check('need_answers_nature_check', sql`${t.nature} in ('qualification', 'indicatif', 'devis', 'offre_ferme')`),
  check('need_answers_qualification_check', sql`${t.qualification} in ('faisable', 'a_etudier', 'refuse')`),
  check('need_answers_status_check', sql`${t.status} in ('en_cours', 'remise', 'acceptee', 'caduque')`),
  check('need_answers_class_check', sql`${t.estimateClass} is null or ${t.estimateClass} in ('E50', 'E30', 'E10')`),
  // K-03: a firm offer is E10; a priced answer has its class and its range; a qualification has neither.
  check('need_answers_firm_offer_check', sql`${t.nature} <> 'offre_ferme' or ${t.estimateClass} = 'E10'`),
  check('need_answers_priced_check', sql`(${t.nature} = 'qualification' and ${t.centralKeur} is null and ${t.estimateClass} is null) or (${t.nature} <> 'qualification' and ${t.centralKeur} is not null and ${t.estimateClass} is not null and ${t.lowKeur} is not null and ${t.highKeur} is not null)`),
]);
