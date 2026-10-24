// Portfolio and projects (docs/spec/11 §3.2): projects, sites, members, lifecycle reference (stages, gates,
// transitions, stage deliverables), deliverable checks, stage history, machine types and project templates.
import { sql } from 'drizzle-orm';
import { boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { CalendarCode, CostType, MachineTypeCode, StageCode, StageGroup, TransitionMode, ValidationStatus, ZoneCode } from '../codes';
import { id, keur, months, num, timestamps } from './_common';
import { clients, countries, persons, zones } from './organisation';

// ── Lifecycle reference ────────────────────────────────────────────────────────────────────────────────

/** Lifecycle stages (STATUSES 3136, LIFE 3148, GATES 3147, ST_SHORT 3905). */
export const lifecycleStages = pgTable('lifecycle_stages', {
  code: text('code').$type<StageCode>().primaryKey(),
  /** Prototype value, French domain label in both languages: "Fabrication & Assemblage". */
  label: text('label').notNull().unique(),
  shortLabel: text('short_label').notNull(),
  /** Position in STAGE_ORDER (1–12); null for 'annule'. */
  seq: integer('seq'),
  sortOrder: integer('sort_order').notNull(),
  group: text('stage_group').$type<StageGroup>().notNull(),
  /** LIFE (French): "Montage et raccordements sur site". */
  description: text('description').notNull(),
  /** GATES (French) — entry gate shown in the "Move to" menu; null for Initiative. */
  entryGate: text('entry_gate'),
});

/** Allowed transitions (TRANS 3146): next stage in order, or 'annule'; none from Clos / Annulé. */
export const lifecycleTransitions = pgTable(
  'lifecycle_transitions',
  {
    fromStage: text('from_stage').$type<StageCode>().notNull().references(() => lifecycleStages.code),
    toStage: text('to_stage').$type<StageCode>().notNull().references(() => lifecycleStages.code),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromStage, t.toStage] })],
);

/** Exit deliverables of each stage (STAGE_DELIVS 3140, French labels). */
export const stageDeliverableDefs = pgTable(
  'stage_deliverable_defs',
  {
    id: id(),
    stage: text('stage').$type<StageCode>().notNull().references(() => lifecycleStages.code),
    /** Index in STAGE_DELIVS[stage] (0-based). */
    position: integer('position').notNull(),
    label: text('label').notNull(),
  },
  (t) => [unique().on(t.stage, t.position)],
);

// ── Machine types and project templates ────────────────────────────────────────────────────────────────

/** Machine types (MACHINE_TYPES 3166) with the REX payment pattern (REX_FIN 3101). */
export const machineTypes = pgTable('machine_types', {
  code: text('code').$type<MachineTypeCode>().primaryKey(),
  /** Display code: EMP, MEMU, SPUR, AUTRE, R&D. */
  label: text('label').notNull().unique(),
  depositPct: num('deposit_pct').notNull(),
  deliveryPct: num('delivery_pct').notNull(),
  acceptancePct: num('acceptance_pct').notNull(),
  isStandard: boolean('is_standard').notNull().default(true),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull(),
  /**
   * Machine types screen (09 §9): editable label (null = the display code, as MT_ALL), description (French, from the
   * template) and default calendar. The aggregate's phases, cost categories and ITP systems are the tables below.
   */
  name: text('name'),
  description: text('description'),
  calendar: text('calendar').$type<CalendarCode>(),
  ...timestamps,
});

/** Standard phases of a machine type (NP_TEMPLATES[mt].phases; edited on the Machine types screen). */
export const machineTypePhases = pgTable(
  'machine_type_phases',
  {
    machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    /**
     * R-185: a lot specific to an equipment (fabrication, assembly, workshop tests…) — the wizard generates it once per equipment
     * line of the type; false = a phase common to the project (studies, purchasing, site…). Standard phases: PER_EQUIPMENT_PHASES
     * (src/domain/project-equipment.ts), set by the seed and by migration 0042 on existing databases.
     */
    perEquipment: boolean('per_equipment').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.machineTypeCode, t.position] })],
);

/** Reference cost categories of a machine type, k€ (NP_TEMPLATES[mt].cats). */
export const machineTypeCostCategories = pgTable(
  'machine_type_cost_categories',
  {
    machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    costType: text('cost_type').$type<CostType>().notNull(),
    budgetKeur: keur('budget_keur').notNull(),
  },
  (t) => [primaryKey({ columns: [t.machineTypeCode, t.position] })],
);

/** ITP inspection systems of a machine type (ITP_TEMPLATES 3716) — the systems of a project's inspection plan. */
export const machineTypeItpSystems = pgTable(
  'machine_type_itp_systems',
  {
    machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.machineTypeCode, t.position] })],
);

/** REX references of a machine type (REX_FIN[mt].refs). */
export const rexReferences = pgTable('rex_references', {
  id: id(),
  machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code),
  position: integer('position').notNull(),
  analyticCode: text('analytic_code').notNull(),
  projectName: text('project_name').notNull(),
  year: text('year').notNull(),
  pattern: text('pattern').notNull(),
});

/**
 * R-186 (AC-4, K-01): the machine catalogue published to the subsidiaries — one row per catalogue code and version
 * ("EMP-40T" v1, v2…), each built on a machine type (its reference budget and ITP template stay on the type). Rules:
 * src/domain/machine-catalogue.ts. A published or retired version is frozen (trigger `machine_catalogue_entries_frozen`,
 * migration 0046): only published → retired, `retired_at` and `updated_at` may change, and it is never deleted. Published to
 * the CAPEX application by the view pub_catalogue_machines (0046; drafts never), `maj_le` = `updated_at` (indexed, K-11).
 */
export const machineCatalogueEntries = pgTable('machine_catalogue_entries', {
  id: id(),
  /** "EMP-40T" — the same machine type for every version of a code. */
  code: text('code').notNull(),
  version: integer('version').notNull(),
  machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code),
  /** Typed text (dataText): variant, label, description. */
  variant: text('variant'),
  label: text('label').notNull(),
  description: text('description'),
  /** K-01 shape, published as is: `[{ code, libelle, prix_indicatif_keur }]`. */
  options: jsonb('options').$type<{ code: string; libelle: string; prix_indicatif_keur: number | null }[]>().notNull().default(sql`'[]'::jsonb`),
  nominalCapacity: num('nominal_capacity'),
  capacityUnit: text('capacity_unit'),
  /** Indicative price, estimate class E50, k€. */
  indicativePriceKeur: keur('indicative_price_keur'),
  leadTimeWeeks: integer('lead_time_weeks'),
  /** 'draft' | 'published' | 'retired'. */
  status: text('status').$type<'draft' | 'published' | 'retired'>().notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  ...timestamps,
}, (t) => [
  unique('machine_catalogue_entries_code_version_unique').on(t.code, t.version),
  uniqueIndex('machine_catalogue_entries_one_draft_idx').on(t.code).where(sql`${t.status} = 'draft'`),
  uniqueIndex('machine_catalogue_entries_one_published_idx').on(t.code).where(sql`${t.status} = 'published'`),
  index('machine_catalogue_entries_updated_at_idx').on(t.updatedAt),
  check('machine_catalogue_entries_code_check', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{1,29}$'`),
  check('machine_catalogue_entries_version_check', sql`${t.version} >= 1`),
  check('machine_catalogue_entries_status_check', sql`${t.status} in ('draft', 'published', 'retired')`),
  check('machine_catalogue_entries_options_check', sql`jsonb_typeof(${t.options}) = 'array'`),
  check('machine_catalogue_entries_published_check', sql`${t.status} = 'draft' or (${t.publishedAt} is not null and ${t.indicativePriceKeur} is not null and ${t.leadTimeWeeks} is not null)`),
]);

/** New-project templates (NP_TEMPLATES 3179, incl. 'blank'; NP_TEMPLATES_OLD is ignored). French data. */
export const projectTemplates = pgTable('project_templates', {
  /** 'blank' or the machine type code ('rnd' for R&D). */
  code: text('code').primaryKey(),
  machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().references(() => machineTypes.code),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** "6 phases · 14 lots" / "Vide". */
  wbsSummary: text('wbs_summary').notNull(),
  /** "38 activités · 52 liens" / "Aucune". */
  activitiesSummary: text('activities_summary').notNull(),
  calendar: text('calendar').$type<CalendarCode>().notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const projectTemplatePhases = pgTable(
  'project_template_phases',
  {
    templateCode: text('template_code').notNull().references(() => projectTemplates.code),
    position: integer('position').notNull(),
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateCode, t.position] })],
);

export const projectTemplateCostCategories = pgTable(
  'project_template_cost_categories',
  {
    templateCode: text('template_code').notNull().references(() => projectTemplates.code),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    costType: text('cost_type').$type<CostType>().notNull(),
    budgetKeur: keur('budget_keur').notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateCode, t.position] })],
);

// ── Projects ───────────────────────────────────────────────────────────────────────────────────────────

/** Projects (PROJECTS/META/STAGE_OF + EXTRA via initialProjects 3163, PROJ_ID 3168). */
export const projects = pgTable('projects', {
  id: id(),
  /** "HLT-026". */
  code: text('code').notNull().unique(),
  /** "#026" (PROJ_ID.id); null for projects without an identity record. */
  number: text('number').unique(),
  /** "HLT" (P3NAME / projectData().p3). */
  shortCode: text('short_code').notNull(),
  name: text('name').notNull(),
  /** Short display name (PROJ_NAMES 3263: "Harbor Line") used by tasks and requests; null when none. */
  shortName: text('short_name'),
  clientId: uuid('client_id').references(() => clients.id),
  pmPersonId: uuid('pm_person_id').references(() => persons.id),
  stage: text('stage').$type<StageCode>().notNull().references(() => lifecycleStages.code),
  /** Business area '1'..'4'. */
  das: text('das'),
  machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().references(() => machineTypes.code),
  /** "HAV004" — shared with Lucca and Sage X3. */
  analyticCode: text('analytic_code').unique(),
  /** Month-precision display strings as in the prototype: "Jan 2026", "—". */
  startText: text('start_text').notNull(),
  finishText: text('finish_text').notNull(),
  /** Month index since Jan 2026 (mIdx), null for "—". */
  startMonth: months('start_month'),
  finishMonth: months('finish_month'),
  /** BAC (prototype `budget`). */
  budgetKeur: keur('budget_keur').notNull(),
  actualKeur: keur('actual_keur').notNull(),
  /** Physical progress 0–1. */
  progress: num('progress').notNull(),
  spi: num('spi'),
  /** Wizard-created, cleared at the first stage change. */
  isNew: boolean('is_new').notNull().default(false),
  /** Project currency ("EUR", "USD"…); null = EUR. Contracts and purchase orders are in EUR or in this currency (C-9). */
  currency: text('currency'),
  /**
   * C-9 (R-075): budget rate of the project currency — euros per unit (1 USD = 0.92 €), set by the portfolio director; null for
   * a EUR project or until set. Budget, cash flow and portfolio finance consolidate the project's amounts in euros at this rate.
   */
  budgetRate: num('budget_rate'),
  calendar: text('calendar').$type<CalendarCode>(),
  contingencyPct: num('contingency_pct'),
  templateCode: text('template_code').references(() => projectTemplates.code),
  /** Register order (state.projects order; new projects are prepended with a lower value). */
  sortOrder: integer('sort_order').notNull(),
  // ── Chapter 4 ──
  /** Project data date (S-1, S-4): remaining work is scheduled from it. Null = the business date (projectDataDate, domain/ch4-defaults; R-013). */
  dataDate: date('data_date', { mode: 'string' }),
  /** Baseline shown by Plan / Schedule (S-3: "BL1"); null = DEFAULT_DISPLAYED_BASELINE (domain/ch4-defaults). */
  displayedBaselineCode: text('displayed_baseline_code'),
  /** Planned start / finish chosen in the New project wizard (L-3); null for the seed (month texts above). */
  plannedStartDate: date('planned_start_date', { mode: 'string' }),
  plannedFinishDate: date('planned_finish_date', { mode: 'string' }),
  ...timestamps,
  /**
   * Share D02 (Matrix): client project, or internal project (Cursus's non-project codes INT-PROD… ECOLE become internal
   * projects). Every project Keystone creates today is a client project.
   */
  kind: text('kind').$type<'client' | 'internal'>().notNull().default('client'),
  /**
   * R-190 (Arche K-05): the subsidiary CAPEX the project delivers ("CPX-SAI-2026-01", Arche's code N-9) and the first machine
   * need at its origin ("CPX-SAI-2026-01/B01"); null for a project without CAPEX. Set by the project's leads on the Contract
   * screen; published at the end of pub_projets. A cross-schema reference: text, no foreign key (sharing convention).
   */
  capexCode: text('capex_code'),
  besoinRef: text('besoin_ref'),
}, (t) => [
  check('projects_kind_check', sql`${t.kind} in ('client', 'internal')`),
  check('projects_capex_code_check', sql`${t.capexCode} ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}$'`),
  check('projects_besoin_ref_check', sql`${t.besoinRef} is null or (${t.capexCode} is not null and ${t.besoinRef} ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}/B[0-9]{2,}$' and starts_with(${t.besoinRef}, ${t.capexCode} || '/'))`),
]);

/**
 * R-185 (AC-5, framing docs/delivery-9/cadrage-r185-r186.md, validated 23 Oct 2026): the equipment a project supplies — one line
 * per machine type × quantity ("1 × EMP", "3 × MEMU"), numbered EQ-01, EQ-02… per project. The machines delivered (serial
 * numbers) stay in the installed base (`machines`). The first line (lowest position) gives the project's main type,
 * `projects.machine_type_code`, kept in sync by the DAL writers (src/server/dal/project-equipment.ts).
 */
export const projectEquipments = pgTable('project_equipments', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** "EQ-01" — unique per project, never reused after a removal. */
  ref: text('ref').notNull(),
  machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code),
  quantity: integer('quantity').notNull().default(1),
  /** Free text typed by the PM ("Portique 40 t quai 4"); null = none. Shown as typed (dataText). */
  label: text('label'),
  /** Display order (0 = the main line). */
  position: integer('position').notNull(),
  /** Target capacity (value + unit, "40" "t"), optional. */
  capacityValue: num('capacity_value'),
  capacityUnit: text('capacity_unit'),
  /** Options chosen for the line (typed text for now; catalogue option codes with R-186). */
  options: jsonb('options').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Arche machine need at the origin of the line ("CPX-SAI-2026-01/B01"); a cross-schema reference: text, no foreign key. */
  besoinRef: text('besoin_ref'),
  /**
   * R-186: the catalogue entry chosen for the line — code ("EMP-40T") and version, both or neither (a published version of the
   * line's machine type when chosen; a retired one stays on the lines that chose it).
   */
  catalogueVersion: integer('catalogue_version'),
  catalogueCode: text('catalogue_code'),
  ...timestamps,
}, (t) => [
  foreignKey({ name: 'project_equipments_catalogue_fk', columns: [t.catalogueCode, t.catalogueVersion], foreignColumns: [machineCatalogueEntries.code, machineCatalogueEntries.version] }),
  check('project_equipments_catalogue_check', sql`(${t.catalogueCode} is null) = (${t.catalogueVersion} is null)`),
  unique('project_equipments_project_ref_unique').on(t.projectId, t.ref),
  check('project_equipments_ref_check', sql`${t.ref} ~ '^EQ-[0-9]{2,}$'`),
  check('project_equipments_quantity_check', sql`${t.quantity} >= 1`),
  check('project_equipments_besoin_ref_check', sql`${t.besoinRef} is null or ${t.besoinRef} ~ '^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}/B[0-9]{2,}$'`),
  check('project_equipments_options_check', sql`jsonb_typeof(${t.options}) = 'array'`),
]);

/** Project site (GEO 3169). Zone = zoneOverride ?? country zone. */
export const projectSites = pgTable('project_sites', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  city: text('city').notNull(),
  countryName: text('country_name').notNull().references(() => countries.name),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  zoneOverride: text('zone_override').$type<ZoneCode>().references(() => zones.code),
});

/** Project team (DEFS[code].team). */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull().references(() => persons.id),
    projectRole: text('project_role').notNull().default('team'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.personId] })],
);

/** Ticked stage deliverables (STAGE_DONE_DEFAULT 3141). Absent row = not done. */
export const stageDeliverableChecks = pgTable(
  'stage_deliverable_checks',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    deliverableId: uuid('deliverable_id').notNull().references(() => stageDeliverableDefs.id),
    done: boolean('done').notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneByPersonId: uuid('done_by_person_id').references(() => persons.id),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.deliverableId] })],
);

/** Stage history (STAGE_HISTORY 3142): one row per stage entered, auto or forced. */
export const stageTransitions = pgTable(
  'stage_transitions',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** Chronological position (1-based). */
    seq: integer('seq').notNull(),
    fromStage: text('from_stage').$type<StageCode>().references(() => lifecycleStages.code),
    toStage: text('to_stage').$type<StageCode>().notNull().references(() => lifecycleStages.code),
    effectiveOn: date('effective_on', { mode: 'string' }).notNull(),
    mode: text('mode').$type<TransitionMode>().notNull(),
    /** Mandatory when forced; null for auto moves. */
    reason: text('reason'),
    /** Snapshot of unticked deliverables when forcing. */
    missingDeliverables: text('missing_deliverables').array(),
    requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
    /** Forced moves only (OPEN QUESTION L-1; informational in the prototype). */
    validationStatus: text('validation_status').$type<ValidationStatus>(),
    validatedByPersonId: uuid('validated_by_person_id').references(() => persons.id),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    /** Chapter 4 (L-1): the portfolio director's comment on the approval / rejection of a forced move. */
    decisionComment: text('decision_comment'),
    /** Chapter 4 (L-1): on a 'revert' row, the forced transition it reverts. */
    revertsTransitionId: uuid('reverts_transition_id').references((): AnyPgColumn => stageTransitions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.seq)],
);
