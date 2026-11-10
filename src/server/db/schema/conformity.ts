// R-160 (P2, owner's answer D9-32, 10 Nov 2026): CE conformity of the machines a project supplies — Machinery Regulation (EU)
// 2023/1230, applicable from 20 Jan 2027. One file per equipment line (R-185), the reference checklists of Settings. Documents
// live in Codex: Keystone keeps their references only. Rules: src/domain/ce-conformity.ts; DAL: src/server/dal/ce-conformity.ts.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, rowVersion, timestamps } from './_common';
import { projectEquipments, projects } from './portfolio';

/**
 * Settings › CE conformity checklists: the essential health and safety requirements (Annex III headings, number and short title)
 * and the technical-file headings (Annex IV). "Remove" deactivates (a file keeps its answer); seeded by the migration
 * `ce_conformity_defaults` (both seeds), the content to be validated by QHSE.
 */
export const ceChecklistItems = pgTable(
  'ce_checklist_items',
  {
    id: id(),
    kind: text('kind').$type<'ehsr' | 'techfile'>().notNull(),
    /** Annex III number ("1.3") or the technical-file key ("risk_assessment"). */
    code: text('code').notNull(),
    /** Short title (EN source string for a default entry, typed text for an added one). */
    title: text('title').notNull(),
    position: integer('position').notNull(),
    active: boolean('active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('ce_checklist_items_kind_code_unique').on(t.kind, t.code), check('ce_checklist_items_kind_check', sql`${t.kind} in ('ehsr', 'techfile')`)],
);

/** The CE file of one equipment line (all its units share the design, hence the file). Created at the first save. */
export const ceFiles = pgTable(
  'ce_files',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    equipmentId: uuid('equipment_id').notNull().references(() => projectEquipments.id, { onDelete: 'cascade' }),
    regime: text('regime').$type<'machinery' | 'partly_completed'>(),
    category: text('category').$type<'not_listed' | 'annex_i_a' | 'annex_i_b'>(),
    route: text('route').$type<'module_a' | 'module_b_c' | 'module_h' | 'module_g'>(),
    /** Codex references ("RPT-HLT-040"): text, no foreign key (the documents live in Codex). */
    riskAssessmentRef: text('risk_assessment_ref'),
    standards: jsonb('standards').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    instructionsRef: text('instructions_ref'),
    declarationSignatory: text('declaration_signatory'),
    declarationOn: date('declaration_on', { mode: 'string' }),
    declarationRef: text('declaration_ref'),
    ceMarkingOn: date('ce_marking_on', { mode: 'string' }),
    /** Requirement code → 'applies' | 'met' | 'na' (absent = not assessed). */
    ehsr: jsonb('ehsr').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    /** Technical-file key → { status, deliverable ("D-021"), codexRef }. */
    techFile: jsonb('tech_file').$type<Record<string, { status: string; deliverable: string | null; codexRef: string | null }>>().notNull().default(sql`'{}'::jsonb`),
    version: rowVersion(),
    ...timestamps,
  },
  (t) => [
    unique('ce_files_equipment_unique').on(t.equipmentId),
    index('ce_files_project_id_idx').on(t.projectId),
    check('ce_files_regime_check', sql`${t.regime} is null or ${t.regime} in ('machinery', 'partly_completed')`),
    check('ce_files_category_check', sql`${t.category} is null or ${t.category} in ('not_listed', 'annex_i_a', 'annex_i_b')`),
    check('ce_files_route_check', sql`${t.route} is null or ${t.route} in ('module_a', 'module_b_c', 'module_h', 'module_g')`),
    check('ce_files_partly_completed_check', sql`${t.regime} is distinct from 'partly_completed' or (${t.route} is null and ${t.ceMarkingOn} is null)`),
  ],
);
