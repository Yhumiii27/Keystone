// Project engineering data around the catalogue (docs/spec/11 §3.9 ProjectBomLine, ProjectAssemblyRoot, RevisionDiff,
// Drawing; screens 09 §1 BOM, §5 Drawings): project BOM lines, the assembly configured per project, revision
// comparisons and the drawings mirrored from the SolidWorks PDM vault. ECOs are owned by Vigie (see vigie.ts): rows
// here cite them by their number only.
import { boolean, date, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { BomScope, DrawingState, RevisionDiffKind, VaultSyncScope, VaultSyncSource } from '../codes';
import { id, num, timestamps } from './_common';
import { parts } from './catalogue';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';

/**
 * Project BOM lines (`PARTS.usage {p3: qty}` 3343; Add article form AF.bom). One line per part and project; the
 * quantity is the total in the project (assemblies and their components are both listed, as the prototype does —
 * valuations must not add both, 09 OQ6).
 */
export const projectBomLines = pgTable(
  'project_bom_lines',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    partId: uuid('part_id').notNull().references(() => parts.id),
    quantity: num('quantity').notNull(),
    /** Activity that installs / needs the article (Add article form); null for the seed lines. */
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    scope: text('scope').$type<BomScope>().notNull().default('keystone'),
    note: text('note'),
    /** PARTS order for the seed; lines added in Keystone are appended. */
    position: integer('position').notNull(),
    addedByPersonId: uuid('added_by_person_id').references(() => persons.id),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.partId)],
);

/** Multi-level structure configured for a project (`TREES = {HLT: TREE}` 3426): root assembly × quantity. */
export const projectAssemblyRoots = pgTable(
  'project_assembly_roots',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    rootPartId: uuid('root_part_id').notNull().references(() => parts.id),
    quantity: num('quantity').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.rootPartId)],
);

/** Revision comparison of an assembly (REV_DIFF 3427: ASM-RMG-250 rev B → C, 12 Sep 2026, ECO-2026-014). */
export const revisionDiffs = pgTable(
  'revision_diffs',
  {
    id: id(),
    assemblyPartId: uuid('assembly_part_id').notNull().references(() => parts.id, { onDelete: 'cascade' }),
    fromRevision: text('from_revision').notNull(),
    toRevision: text('to_revision').notNull(),
    diffDate: date('diff_date', { mode: 'string' }).notNull(),
    /** ECO that explains it — a Vigie ECO number ("ECO-2026-014"). */
    ecoNumber: text('eco_number'),
  },
  (t) => [unique().on(t.assemblyPartId, t.fromRevision, t.toRevision)],
);

/** Lines of a revision comparison ("ASM-DRV-700 / EL-VFD-200" 2 → 3, Quantity). */
export const revisionDiffLines = pgTable('revision_diff_lines', {
  id: id(),
  diffId: uuid('diff_id').notNull().references(() => revisionDiffs.id, { onDelete: 'cascade' }),
  /** "parent / child" or "parent / old → new" (the new part is the last ref). */
  path: text('path').notNull(),
  /** EN data text ("Operator HMI 10″ → 15″"). */
  name: text('name').notNull(),
  /** Quantity before / after; null = "—" (line added or removed). */
  qtyFrom: num('qty_from'),
  qtyTo: num('qty_to'),
  kind: text('kind').$type<RevisionDiffKind>().notNull(),
  position: integer('position').notNull(),
});

/**
 * Drawings of the SolidWorks PDM vault linked to catalogue parts (DRAWINGS 3439, 13 rows) — a read-only mirror:
 * revisions and states change in the vault (OPEN QUESTION E-7 for the sync contract).
 */
export const drawings = pgTable('drawings', {
  id: id(),
  /** "DWG-AS-9000". */
  number: text('number').notNull().unique(),
  title: text('title').notNull(),
  partId: uuid('part_id').references(() => parts.id),
  revision: text('revision').notNull(),
  state: text('state').$type<DrawingState>().notNull(),
  /** Vault folder ("Cranes/RMG-250/"). */
  vaultPath: text('vault_path').notNull(),
  /** Last check-in: who (as the vault names them) and when. */
  checkedInByName: text('checked_in_by_name').notNull(),
  checkedInByPersonId: uuid('checked_in_by_person_id').references(() => persons.id),
  checkedInOn: date('checked_in_on', { mode: 'string' }).notNull(),
  /** Vigie ECO driving the revision ("ECO-2026-014"); null = none. */
  ecoNumber: text('eco_number'),
  /** "SLDDRW · PDF · DXF". */
  formats: text('formats').notNull(),
  /** PDM document id, preview and deep link (unknown until the connector exists, E-7). */
  pdmId: text('pdm_id'),
  previewRef: text('preview_ref'),
  pdmUrl: text('pdm_url'),
  position: integer('position').notNull(),
  ...timestamps,
});

/**
 * Revision history of a drawing as the vault reports it. The prototype synthesises A…current (A–D only, `dwgVals`
 * 4378): the current revision carries the check-in date and the ECO, older ones are "Superseded".
 */
export const drawingRevisions = pgTable(
  'drawing_revisions',
  {
    drawingId: uuid('drawing_id').notNull().references(() => drawings.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    isCurrent: boolean('is_current').notNull(),
    /** Check-in date (current revision; unknown for the superseded ones of the seed). */
    checkedInOn: date('checked_in_on', { mode: 'string' }),
    ecoNumber: text('eco_number'),
  },
  (t) => [primaryKey({ columns: [t.drawingId, t.revision] })],
);

/** PDM vault synchronisations ("Last vault sync 07:40", "Drawings in vault 1 248"; Sync vault form AF.drawings). */
export const pdmVaultSyncs = pgTable('pdm_vault_syncs', {
  id: id(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
  /** Drawings in the whole vault at that sync (beyond the ones linked to catalogue parts). */
  drawingsInVault: integer('drawings_in_vault').notNull(),
  /** Drawings changed by the sync. */
  drawingsUpdated: integer('drawings_updated').notNull(),
  source: text('source').$type<VaultSyncSource>(),
  scope: text('scope').$type<VaultSyncScope>(),
  /** Project of a "Current project" sync. */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
});
