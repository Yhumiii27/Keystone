// Vigie ECO mirror (user decision, overrides docs/spec/09 §4 and 11 §3.9 Eco): engineering change orders are managed
// in Vigie, the group's QHSE application. Keystone keeps a read-only copy of the ECOs that concern its parts and
// projects (refreshed by the connector, src/server/integrations/vigie) and an outbox of the progress its users record
// (their approval-key decision, step advancement) until Vigie acknowledges it. Creation, editing, dispositions,
// interchangeability, effectivity, release and the workflow itself happen in Vigie's database, never here: no
// Keystone writer touches the mirror tables except the connector's refresh.
import { boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type {
  EcoApproverKey, EcoDecision, EcoDisposition, EcoProgressKind, EcoStatus, EcoTargetType, EcoType, Interchangeability, VigieSyncStatus,
} from '../codes';
import { eur, id } from './_common';
import { persons } from './organisation';

/** ECOs as Vigie reports them (seed: the prototype's ECOS 3432 with their derived status, 6 rows). */
export const vigieEcos = pgTable('vigie_ecos', {
  id: id(),
  /** Vigie's business id ("ECO-2026-015") — the key of every exchange and deep link. */
  number: text('number').notNull().unique(),
  title: text('title').notNull(),
  type: text('eco_type').$type<EcoType>().notNull(),
  /** Status computed by Vigie (release is automatic there once approvals, interchangeability and dispositions are set). */
  status: text('status').$type<EcoStatus>().notNull(),
  /** Read-only: decided in Vigie (null = not assessed). */
  interchangeability: text('interchangeability').$type<Interchangeability>(),
  /** Revision / identifier before and after ("B" → "C", "CD-200" → "CD-210"). */
  fromRevision: text('from_revision').notNull(),
  toRevision: text('to_revision').notNull(),
  costEur: eur('cost_eur').notNull(),
  /** Schedule delta in days (negative = gain). */
  scheduleDays: integer('schedule_days').notNull(),
  /** "Stock to scrap / rework" text of the impact analysis. */
  stockImpact: text('stock_impact').notNull(),
  /** "Documents to update" (references as Vigie lists them). */
  documentRefs: text('document_refs').array().notNull().default([]),
  /** Raised by (as Vigie names them) and when. */
  requestedByName: text('requested_by_name').notNull(),
  requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
  raisedOn: date('raised_on', { mode: 'string' }).notNull(),
  /** Effectivity targets still without a disposition (Vigie's count). */
  pendingDispositions: integer('pending_dispositions').notNull(),
  /** All approvals given but release blocked by interchangeability or dispositions (Vigie's flag). */
  locked: boolean('locked').notNull(),
  /** Vigie list order. */
  position: integer('position').notNull(),
  /** Last change in Vigie, when Vigie reports it. */
  vigieUpdatedAt: timestamp('vigie_updated_at', { withTimezone: true }),
  /** Last refresh of this row from Vigie. */
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
});

/** Approval keys of an ECO and their state in Vigie (englead, quality, pm). */
export const vigieEcoApprovals = pgTable(
  'vigie_eco_approvals',
  {
    ecoId: uuid('eco_id').notNull().references(() => vigieEcos.id, { onDelete: 'cascade' }),
    key: text('approval_key').$type<EcoApproverKey>().notNull(),
    decision: text('decision').$type<EcoDecision>().notNull(),
    /** Who is expected to decide, as Vigie names them ("Antoine Girard"; PMs of the impacted projects "R. Aubert, C. Moreau"). */
    approverText: text('approver_text').notNull(),
    decidedByName: text('decided_by_name'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.ecoId, t.key] })],
);

/** Parts an ECO affects, by catalogue reference (`parts[]`). */
export const vigieEcoParts = pgTable(
  'vigie_eco_parts',
  {
    ecoId: uuid('eco_id').notNull().references(() => vigieEcos.id, { onDelete: 'cascade' }),
    partRef: text('part_ref').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ecoId, t.partRef] })],
);

/** Projects an ECO is declared for, by Keystone project code (`projects[]` 3-letter keys resolved: HLT → HLT-026). */
export const vigieEcoProjects = pgTable(
  'vigie_eco_projects',
  {
    ecoId: uuid('eco_id').notNull().references(() => vigieEcos.id, { onDelete: 'cascade' }),
    projectCode: text('project_code').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ecoId, t.projectCode] })],
);

/**
 * Effectivity as Vigie reports it (read-only): every target — project BOM or machine of the installed base — with
 * its disposition (null = pending). Keystone reads it for the stock and PU/PR "keep for the installed base" warnings,
 * the part record and the ECO list; dispositions are decided in Vigie.
 */
export const vigieEcoEffectivity = pgTable(
  'vigie_eco_effectivity',
  {
    ecoId: uuid('eco_id').notNull().references(() => vigieEcos.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<EcoTargetType>().notNull(),
    /** Project code ("HLT-026") or machine id ("MCH-029"). */
    targetRef: text('target_ref').notNull(),
    /** Display name Vigie gives ("Gantry crane 40 t — quay 1", "Harbor Line"). */
    label: text('label').notNull(),
    disposition: text('disposition').$type<EcoDisposition>(),
    /** Default applied by Vigie (open-BOM project → update; machine of a non-interchangeable ECO → pinned). */
    isAutomatic: boolean('is_automatic').notNull(),
    note: text('note'),
    /** Machine targets: the ECO part fitted and its revision ("ASM-RMG-250" rev "B"). */
    fittedPartRef: text('fitted_part_ref'),
    fittedRevision: text('fitted_revision'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ecoId, t.targetType, t.targetRef] })],
);

/**
 * Outbox of the progress recorded in Keystone on a Vigie ECO: the viewer's decision on their approval key, or a step
 * advancement. Each entry stays "pending sync with Vigie" until the connector delivers it; Vigie then updates the
 * ECO and the next refresh brings the result into the mirror.
 */
export const vigieEcoProgress = pgTable('vigie_eco_progress', {
  id: id(),
  ecoId: uuid('eco_id').notNull().references(() => vigieEcos.id, { onDelete: 'cascade' }),
  /** ECO number at the time of recording (the outbox payload does not depend on the mirror row). */
  ecoNumber: text('eco_number').notNull(),
  kind: text('kind').$type<EcoProgressKind>().notNull(),
  /** Approval: the key and the decision. */
  approvalKey: text('approval_key').$type<EcoApproverKey>(),
  decision: text('decision').$type<Exclude<EcoDecision, 'pending'>>(),
  /** Step: the status requested ("impact_analysis", "in_approval"). */
  targetStatus: text('target_status').$type<EcoStatus>(),
  /** Status of the ECO in the mirror when the progress was recorded. */
  fromStatus: text('from_status').$type<EcoStatus>().notNull(),
  comment: text('comment'),
  /** The viewer who recorded it. */
  actorName: text('actor_name').notNull(),
  actorPersonId: uuid('actor_person_id').references(() => persons.id),
  actorRole: text('actor_role').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  syncStatus: text('sync_status').$type<VigieSyncStatus>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  /** Vigie's acknowledgement id. */
  vigieRef: text('vigie_ref'),
});
