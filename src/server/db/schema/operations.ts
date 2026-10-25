// Project operations (docs/spec/11 §3.7): the interface register (07 §2.5), the inspection & test plan and the punch
// lists (07 §2.4, 10 §3.6), commissioning and the handover dossier (07 §2.6), lessons learned, the closure checklist and
// the customer-satisfaction survey (07 §2.7). Keystone owns all of them.
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  ClosureItemStatus, CommissioningCellStatus, CommissioningStep, HandoverItemStatus, InterfaceStatus, ItpPointType, ItpResult, ItpStage, KeystoneSide, LessonStatus,
  LessonTheme, MachineTypeCode, PunchCategory, PunchOwnerParty, PunchRegister, PunchSource, PunchStatus,
} from '../codes';
import { id, num, timestamps } from './_common';
import { documents } from './documents';
import { persons } from './organisation';
import { machineTypes, projectEquipments, projects } from './portfolio';

/**
 * Interfaces owed by the client or third parties (INTERFACES 3719: HLT-026 × 7). The stored status is open /
 * received / frozen; "Late" is derived (open and needed before the prototype's now, PG_NOW).
 */
export const projectInterfaces = pgTable(
  'project_interfaces',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "IF-02" (per project; added interfaces IF-10…). */
    number: text('number').notNull(),
    title: text('title').notNull(),
    keystoneSide: text('keystone_side').$type<KeystoneSide>().notNull(),
    /** "Client · port authority", "Navis · third party". */
    otherParty: text('other_party').notNull(),
    dataExpected: text('data_expected').notNull(),
    /** "15 Oct" → 2026-10-15 (2026 assumed, as the prototype). */
    neededBy: date('needed_by', { mode: 'string' }).notNull(),
    /** The date it was received: "Mark received" stamps it with the confirmed received date (Q-4 a, R-116); rows received before delivery 8 keep null. */
    providedOn: date('provided_on', { mode: 'string' }),
    status: text('status').$type<InterfaceStatus>().notNull(),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    ownerName: text('owner_name').notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);

// ── Inspection & test plan, punch lists (07 §2.4, 10 §3.6) ─────────────────────────────────────────────

/**
 * An ITP (ITP 3717: HLT-026 only), built from the machine-type template (ITP_TEMPLATES 3716). R-185 (choice 4): one plan per
 * equipment line of the project (`equipment_id`, unique; the line's type) — plans of before R-185 were attached to the
 * project's first line (custom migration `itp_plans_equipment_backfill`). A project without equipment line (no machine type)
 * keeps at most one plan without line (partial unique index).
 */
export const itpPlans = pgTable(
  'itp_plans',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** R-185: the equipment line the plan inspects; null only for a project without equipment line. */
    equipmentId: uuid('equipment_id').references(() => projectEquipments.id, { onDelete: 'cascade' }),
    /** Template the plan was built from ("EMP"). */
    machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code),
    ...timestamps,
  },
  (t) => [
    unique('itp_plans_equipment_id_unique').on(t.equipmentId),
    uniqueIndex('itp_plans_project_without_equipment_idx').on(t.projectId).where(sql`${t.equipmentId} is null`),
    index('itp_plans_project_id_idx').on(t.projectId),
  ],
);

/**
 * R-057 (E-9 'a': a machine type's changes apply to projects created afterwards): the ITP systems of a plan, copied from its
 * machine type (else AUTRE's) when the plan is created — the groups of the plan, the "Add inspection" and "Plan SAT"
 * systems. Editing the machine type's systems later leaves existing plans as they are. Plans that existed before delivery 8
 * were frozen with their type's systems of that day (custom migration `itp_plan_systems_backfill`).
 */
export const itpPlanSystems = pgTable(
  'itp_plan_systems',
  {
    planId: uuid('plan_id').notNull().references(() => itpPlans.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.position] }), unique().on(t.planId, t.name)],
);

/** Inspections and tests of a plan ("I-03 Paint thickness (DFT)"); results are read-only (OPEN QUESTION Q-6). */
export const itpInspections = pgTable(
  'itp_inspections',
  {
    id: id(),
    planId: uuid('plan_id').notNull().references(() => itpPlans.id, { onDelete: 'cascade' }),
    /** "I-03"; inspections added in Keystone continue at I-20 (the prototype's `added.itp` numbering). */
    number: text('number').notNull(),
    /** System of the machine-type template ("Structure"). */
    system: text('system').notNull(),
    name: text('name').notNull(),
    pointType: text('point_type').$type<ItpPointType>().notNull(),
    stage: text('stage').$type<ItpStage>().notNull(),
    /** Standard / reference ("ISO 12944 · C5"); '' when none. */
    reference: text('reference').notNull(),
    /** Planned or actual date ("24 Sep"); null when the form left it empty. */
    plannedOn: date('planned_on', { mode: 'string' }),
    result: text('result').$type<ItpResult>().notNull(),
    /** Record document ("REC-HLT-007", "NCR-HLT-031" — free reference, resolved in the Codex index when it exists). */
    recordRef: text('record_ref'),
    recordDocumentId: uuid('record_document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Line added beyond the machine-type template (the seed's `custom: 2`: I-12, I-13; every line added in Keystone). */
    isCustom: boolean('is_custom').notNull().default(false),
    position: integer('position').notNull(),
    // ── Result recorded in Keystone (R-112, Q-6a: quality and the engineering lead) ──
    /** Date of the inspection whose result is recorded; null while not recorded in Keystone (the seed's results). */
    resultOn: date('result_on', { mode: 'string' }),
    /** Inspector as recorded (full name of the person, or a third-party inspector as typed). */
    inspectorName: text('inspector_name'),
    inspectorPersonId: uuid('inspector_person_id').references(() => persons.id),
    /** Client representative present at a witness / hold point (Q-6a); null otherwise. */
    clientWitness: text('client_witness'),
    resultComment: text('result_comment'),
    /** Who recorded the result in Keystone, and when. */
    resultRecordedByName: text('result_recorded_by_name'),
    resultRecordedAt: timestamp('result_recorded_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique().on(t.planId, t.number)],
);

/**
 * Punch items (réserves) — R-117 (A-6 'a'): ONE list per project, numbered over the whole project (P-01…; items added in
 * Keystone continue at P-10 in the demo). Each item carries its origin (`register`: 'itp' = raised by an inspection — the
 * prototype's PUNCH 3718 —, 'site' = raised on site — SITE_PUNCH 3581), a category A/B/C, an owner (a person and / or a
 * party: Client or Keystone), an optional NCR (Vigie's number) and an optional source inspection. The two prototype lists
 * clashed on numbers (11 §7 #4): the Site items of a project were renumbered after its ITP items (custom migration
 * `punch_unified_renumber`, before the unique key below replaced (project, register, number)).
 */
export const punchItems = pgTable(
  'punch_items',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** Origin of the item (R-117): 'itp' Inspection, 'site' Site (codes.ts `punchOrigin`). */
    register: text('register').$type<PunchRegister>().notNull(),
    /** "P-04", unique in the project (R-117); items added in Keystone continue at P-10 (demo floor). */
    number: text('number').notNull(),
    description: text('description').notNull(),
    /** System / location ("Structure · access"; its first word matches a commissioning system, "Blocking A"); '' when none. */
    location: text('location').notNull(),
    /** A blocking, B before SAT, C cosmetic (Site items raised before R-117: B). */
    category: text('category').$type<PunchCategory>(),
    /** How it was raised; the seed's "ITP I-03" is stored as `itp` + the inspection. Null for the Site items of the seed. */
    source: text('source').$type<PunchSource>(),
    sourceInspectionId: uuid('source_inspection_id').references(() => itpInspections.id, { onDelete: 'set null' }),
    /**
     * R-185: the equipment line concerned — the source inspection's plan's line when raised from an inspection, else chosen when
     * the item is added; null = common to the project (or not said).
     */
    equipmentId: uuid('equipment_id').references(() => projectEquipments.id, { onDelete: 'set null' }),
    /** The NCR it comes from ("NCR-029", Vigie's number); never shown to the client (P-10b). */
    ncrNumber: text('ncr_number'),
    /** Owner person ("L. Fabre"); null when only a party owns it. */
    ownerName: text('owner_name'),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    /** Responsible party: the client or Keystone (ITP items raised before R-117: Keystone). */
    ownerParty: text('owner_party').$type<PunchOwnerParty>(),
    dueOn: date('due_on', { mode: 'string' }),
    status: text('status').$type<PunchStatus>().notNull(),
    closedOn: date('closed_on', { mode: 'string' }),
    position: integer('position').notNull(),
    ...timestamps,
  },
  // K-11 (Arche, R-193): the incremental read of pub_reserves (`maj_le > …`, maj_le = updated_at) reaches this index through the
  // security_barrier view; docs/delivery-9/notes-share-views.md § 8.
  (t) => [unique().on(t.projectId, t.number), index('punch_items_updated_at_idx').on(t.updatedAt)],
);

// ── Commissioning & handover dossier (07 §2.6) ─────────────────────────────────────────────────────────

/** Systems commissioned on a project (COMMISSIONING.systems 3721: HLT-026 × 6). */
export const commissioningSystems = pgTable(
  'commissioning_systems',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** R-185: the equipment line commissioned; null = common to the project (a system of the whole installation). */
    equipmentId: uuid('equipment_id').references(() => projectEquipments.id, { onDelete: 'set null' }),
    /** Unique in the project, whatever the line (the SAT plans and "Blocking A" name the system). */
    name: text('name').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.name)],
);

/** One cell of the commissioning grid: a system × step with its status and date or blocking reference ("Blocked · IF-02"). */
export const commissioningSteps = pgTable(
  'commissioning_steps',
  {
    systemId: uuid('system_id').notNull().references(() => commissioningSystems.id, { onDelete: 'cascade' }),
    step: text('step').$type<CommissioningStep>().notNull(),
    status: text('status').$type<CommissioningCellStatus>().notNull(),
    /** Done / planned date ("12 Sep", "14 Jan" — no year in the prototype: read as 2026, see the DAL note). */
    dateOn: date('date_on', { mode: 'string' }),
    /** What blocks the step: an interface ("IF-02") or a punch item. */
    blockingRef: text('blocking_ref'),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.systemId, t.step)],
);

/** SAT plans recorded with "Plan SAT" (AF.commissioning: system, date, client witnesses, prerequisites). */
export const satPlans = pgTable('sat_plans', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  systemName: text('system_name').notNull(),
  plannedOn: date('planned_on', { mode: 'string' }).notNull(),
  clientWitnesses: text('client_witnesses').notNull(),
  prerequisites: text('prerequisites').notNull(),
  plannedByName: text('planned_by_name').notNull(),
  plannedByPersonId: uuid('planned_by_person_id').references(() => persons.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Handover dossier (DOE) items (COMMISSIONING.dossier: HLT-026 × 8) with their Codex document type and document. */
export const handoverItems = pgTable(
  'handover_items',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    item: text('item').notNull(),
    /** Codex document type code ("MAN", "LST", "REC", "COC", "RPT", "CTR"). */
    documentTypeCode: text('document_type_code').notNull(),
    /** Linked document ("MAN-HLT-015"); null when none yet. */
    documentRef: text('document_ref'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    status: text('status').$type<HandoverItemStatus>().notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.position)],
);

// ── Lessons learned, closure, satisfaction (07 §2.7) ───────────────────────────────────────────────────

/** Lessons learned (LESSONS 3732: HLT-026 × 4; lessons recorded in Keystone continue at LL-10). */
export const lessonsLearned = pgTable(
  'lessons_learned',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    theme: text('theme').$type<LessonTheme>().notNull(),
    whatHappened: text('what_happened').notNull(),
    /** '—' when not given (the form's default). */
    impact: text('impact').notNull(),
    recommendation: text('recommendation').notNull(),
    /** Template or procedure it feeds ("ITP template EMP", "Purchasing procedure PRO-QMS-021"). */
    appliesTo: text('applies_to').notNull(),
    status: text('status').$type<LessonStatus>().notNull(),
    raisedByName: text('raised_by_name'),
    raisedByPersonId: uuid('raised_by_person_id').references(() => persons.id),
    position: integer('position').notNull(),
    ...timestamps,
  },
  // Matrix D22 (K-11 pattern): pub_rex.maj_le = updated_at, read incrementally by Matrix's unified REX.
  (t) => [unique().on(t.projectId, t.number), index('lessons_learned_updated_at_idx').on(t.updatedAt)],
);

/** Project closure checklist (CLOSURE 3733: HLT-026 × 10). */
export const closureItems = pgTable(
  'closure_items',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    item: text('item').notNull(),
    /** "R. Aubert". */
    ownerName: text('owner_name').notNull(),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    status: text('status').$type<ClosureItemStatus>().notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.position)],
);

/** Customer-satisfaction survey (SATISFACTION 3734: HLT-026 × 5 criteria, 0–5 by 0.5). */
export const satisfactionScores = pgTable(
  'satisfaction_scores',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    criterion: text('criterion').notNull(),
    score: num('score').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.criterion)],
);
