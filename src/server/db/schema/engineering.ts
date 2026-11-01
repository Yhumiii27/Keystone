// Project engineering register and P&ID validation (docs/spec/11 §3.9 Engineering register, PidSheet / PidTag /
// PidValidationStep; screens 09 §6–8). Keystone owns them. The engineering deliverables are Codex index records
// (`documents` with service = discipline and their recipients): their statuses are shared with the Documents screen.
import { boolean, date, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  BomScope, CheckSeverity, CheckStatus, Discipline, DocRecipient, DrawingState, ImportDeltaKind, OutputState, PidRole, PidTagKind, PlcType, StepState,
} from '../codes';
import { id, timestamps } from './_common';
import { documents } from './documents';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';

// ── Engineering register ───────────────────────────────────────────────────────────────────────────────

/** Disciplines and their referents (ENG_DISC 3736): Process, Mechanical, Electrical, Automation. */
export const engDisciplines = pgTable('eng_disciplines', {
  code: text('code').$type<Discipline>().primaryKey(),
  /** Phosphor class ("ph ph-flow-arrow"). */
  icon: text('icon').notNull(),
  leadName: text('lead_name').notNull(),
  leadPersonId: uuid('lead_person_id').references(() => persons.id),
  /** Business tools ("TIA Portal · EcoStruxure"). */
  tools: text('tools').notNull(),
  position: integer('position').notNull(),
});

/**
 * Documents a discipline consumes (ENG_INPUTS 3739, HLT-026 × 12): the revision in use and whether the referent
 * confirmed it. Internal documents are Codex records; external ones (the client's BOD-CLI-026) carry their provider.
 * The state (up to date / to confirm / outdated) is derived from the provider document's latest released revision.
 */
export const engInputs = pgTable(
  'eng_inputs',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    consumer: text('consumer').$type<Discipline>().notNull(),
    documentNumber: text('document_number').notNull(),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** External provider ("client") for documents outside the Codex index; null for internal documents. */
    providerParty: text('provider_party').$type<DocRecipient>(),
    /** Title of an external document ("Client basis of design"); internal ones read the Codex title. */
    externalTitle: text('external_title'),
    revisionInUse: text('revision_in_use').notNull(),
    acknowledged: boolean('acknowledged').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedByPersonId: uuid('acknowledged_by_person_id').references(() => persons.id),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.consumer, t.documentNumber)],
);

/** Consistency rules between disciplines (ENG_RULES 3740): "process-elec" → "Process ↔ Electrical", "revision". */
export const engConsistencyRules = pgTable('eng_consistency_rules', {
  pair: text('pair').primaryKey(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
});

/** Inconsistencies detected at each import (ENG_CHECKS 3741, HLT-026 × 10, C-01…C-10). */
export const engChecks = pgTable(
  'eng_checks',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    rulePair: text('rule_pair').notNull().references(() => engConsistencyRules.pair),
    severity: text('severity').$type<CheckSeverity>().notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    /** Discipline that owns the resolution. */
    owner: text('owner').$type<Discipline>().notNull(),
    status: text('status').$type<CheckStatus>().notNull(),
    /** "Resolved in Keystone", "Sent back to tool · closes on next import", "Closed by import of rev D"; '' when none. */
    resolutionNote: text('resolution_note').notNull().default(''),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByName: text('resolved_by_name'),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);

/** Lists Keystone generates for the next service (ENG_OUTPUTS 3742, HLT-026 × 6). Blocked → Ready is derived. */
export const engOutputs = pgTable(
  'eng_outputs',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    discipline: text('discipline').$type<Discipline>().notNull(),
    name: text('name').notNull(),
    recipients: text('recipients').array().$type<DocRecipient[]>().notNull(),
    source: text('source').notNull(),
    /** State recorded for the list (seed); "Blocked" shows Ready once the discipline has no open blocking check. */
    state: text('state').$type<OutputState>().notNull(),
    /** Last generation ("Generated today · xlsx"). */
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    generatedFormat: text('generated_format'),
    generatedByName: text('generated_by_name'),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.number)],
);

/** Recent changes & impact (ENG_CHANGES 3743, HLT-026 × 4) and the changes recorded by imports in Keystone. */
export const engChanges = pgTable('eng_changes', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  changedOn: date('changed_on', { mode: 'string' }).notNull(),
  text: text('text').notNull(),
  recipients: text('recipients').array().$type<DocRecipient[]>().notNull(),
  /** Newest first (seed order); entries added in Keystone get a lower value. */
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('eng_changes_project_id_idx').on(t.projectId)]);

/** Source tools of the import wizard (ENG_TOOLS 3744): "TIA Portal — PLC tag table" · Automation. */
export const engImportTools = pgTable('eng_import_tools', {
  position: integer('position').primaryKey(),
  label: text('label').notNull(),
  discipline: text('discipline').$type<Discipline>().notNull(),
});

/** Column mapping of the import wizard (ENG_MAP 3745): source column → Keystone field. */
export const engColumnMappings = pgTable('eng_column_mappings', {
  position: integer('position').primaryKey(),
  sourceColumn: text('source_column').notNull(),
  targetField: text('target_field').notNull(),
});

/** Staged deltas the import wizard shows before importing (ENG_DELTAS 3746, the prototype's static check step). */
export const engImportDeltas = pgTable('eng_import_deltas', {
  position: integer('position').primaryKey(),
  kind: text('kind').$type<ImportDeltaKind>().notNull(),
  label: text('label').notNull(),
});

/** Imports run with the wizard ("Import · freeze this revision as input"). */
export const engImports = pgTable('eng_imports', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  consumer: text('consumer').$type<Discipline>().notNull(),
  documentNumber: text('document_number').notNull(),
  revision: text('revision').notNull(),
  toolPosition: integer('tool_position').notNull(),
  fileName: text('file_name').notNull(),
  rows: integer('rows').notNull(),
  importedByName: text('imported_by_name').notNull(),
  importedByPersonId: uuid('imported_by_person_id').references(() => persons.id),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull(),
});

// ── P&ID validation ────────────────────────────────────────────────────────────────────────────────────

/**
 * P&ID sheet under validation (PID 3583, HLT-026): the Codex record it belongs to and the revision the tags were
 * extracted from (rev C, Under review — Codex has rev D released, 11 §7 #10, OPEN QUESTION A-9).
 */
export const pidSheets = pgTable('pid_sheets', {
  id: id(),
  projectId: uuid('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  documentNumber: text('document_number').notNull(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  revision: text('revision').notNull(),
  issuedOn: date('issued_on', { mode: 'string' }).notNull(),
  sheetCount: integer('sheet_count').notNull(),
  authorName: text('author_name').notNull(),
  authorPersonId: uuid('author_person_id').references(() => persons.id),
  checkerName: text('checker_name').notNull(),
  checkerPersonId: uuid('checker_person_id').references(() => persons.id),
  status: text('status').$type<DrawingState>().notNull(),
  ...timestamps,
});

/** Tags of the P&ID (PID_TAGS 3585, 24) and their mapping to a project BOM reference (`pidOv`). Status is derived. */
export const pidTags = pgTable(
  'pid_tags',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    description: text('description').notNull(),
    kind: text('kind').$type<PidTagKind>().notNull(),
    scope: text('scope').$type<BomScope>().notNull(),
    /** Mapped catalogue reference; null = unmapped (or unlinked). */
    partRef: text('part_ref'),
    /** "Client scope — free issue"; '' when none. */
    note: text('note').notNull(),
    activityCode: text('activity_code').notNull(),
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    /** P / S / L; null = not wired to a PLC. */
    plcType: text('plc_type').$type<PlcType>(),
    /** State feedback wired to the PLC ("VFD-110 · Run status"); '' = none. */
    stateFeedback: text('state_feedback').notNull(),
    role: text('role').$type<PidRole>().notNull(),
    /** Sheet of the drawing the tag sits on (1 + index % 4 in the prototype). */
    sheet: integer('sheet').notNull(),
    mappedAt: timestamp('mapped_at', { withTimezone: true }),
    mappedByName: text('mapped_by_name'),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.tag)],
);

/** Process validation steps (PID_STEPS 3611): tags extracted → mapping → overlay agreed → review → released for construction. */
export const pidValidationSteps = pgTable(
  'pid_validation_steps',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    state: text('state').$type<StepState>().notNull(),
    /** Done date; null = "—". */
    dateOn: date('date_on', { mode: 'string' }),
    /** "P. Noguès", "R. Aubert · N. Bensaïd", "Quality · Engineering". */
    who: text('who').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.position] })],
);
