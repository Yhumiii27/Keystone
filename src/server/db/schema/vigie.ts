// Vigie mirrors (user decisions, override docs/spec/09 §4, 07 §2.3.a, 10 §3 and 11 §3.7 Ncr / §3.9 Eco / §3.11 HseItem).
// ECOs (Delivery 4), project non-conformities and the site HSE register are managed in Vigie; Keystone keeps read-only
// copies refreshed by the connector (src/server/integrations/vigie) and outboxes of the progress its users record.
//
// ECO mirror: engineering change orders are managed
// in Vigie, the group's QHSE application. Keystone keeps a read-only copy of the ECOs that concern its parts and
// projects (refreshed by the connector, src/server/integrations/vigie) and an outbox of the progress its users record
// (their approval-key decision, step advancement) until Vigie acknowledges it. Creation, editing, dispositions,
// interchangeability, effectivity, release and the workflow itself happen in Vigie's database, never here: no
// Keystone writer touches the mirror tables except the connector's refresh.
import { boolean, date, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  EcoApproverKey, EcoDecision, EcoDisposition, EcoProgressKind, EcoStatus, EcoTargetType, EcoType, HseItemKind, HseStatus, Interchangeability, NcrProgressKind,
  NcrSeverity, NcrSource, NcrStatus, NcrVerificationDecision, VigieSyncStatus,
} from '../codes';
import { eur, id, keur } from './_common';
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

// ── Non-conformities (NCR) — Vigie mirror (user decision: Vigie owns project NCRs, the 8D, causes and action plans) ──

/**
 * Project NCRs as Vigie reports them (seed: HLT_NCRS 3507 for HLT-026 and the prototype's generated NCR-040 / NCR-041 —
 * HLT_NCRS[1..2] without activity, part or deliverable — for the 5 other projects with data). Read-only: creation,
 * severity, causes, actions, cost and due dates are managed in Vigie; Keystone records the viewer's step decisions in
 * `vigie_ncr_progress`. NCR numbers are unique per project, as the prototype numbered them.
 */
export const vigieNcrs = pgTable(
  'vigie_ncrs',
  {
    id: id(),
    /** Keystone project code ("HLT-026"). */
    projectCode: text('project_code').notNull(),
    /** "NCR-029". */
    number: text('number').notNull(),
    /** Vigie's own record id when known ("EV-2026-130"); the deep link falls back to a search on the number (links.ts). */
    vigieRef: text('vigie_ref'),
    title: text('title').notNull(),
    severity: text('severity').$type<NcrSeverity>().notNull(),
    source: text('source').$type<NcrSource>().notNull(),
    status: text('status').$type<NcrStatus>().notNull(),
    /** Linked activity code ("A1250"), part reference, impacted deliverable ("D-016"), supplier (goods-receipt NCRs). */
    activityCode: text('activity_code'),
    partRef: text('part_ref'),
    deliverableNumber: text('deliverable_number'),
    supplierName: text('supplier_name'),
    raisedByName: text('raised_by_name').notNull(),
    raisedByPersonId: uuid('raised_by_person_id').references(() => persons.id),
    raisedOn: date('raised_on', { mode: 'string' }).notNull(),
    ownerName: text('owner_name').notNull(),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    rootCause: text('root_cause').notNull(),
    /** Containment & corrective action. */
    action: text('action').notNull(),
    /** Action due date; null = "—". */
    dueOn: date('due_on', { mode: 'string' }),
    costKeur: keur('cost_keur').notNull(),
    /** "8.7 Control of nonconforming outputs". */
    isoClause: text('iso_clause').notNull(),
    /** Vigie list order. */
    position: integer('position').notNull(),
    vigieUpdatedAt: timestamp('vigie_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique().on(t.projectCode, t.number)],
);

/**
 * Outbox of the progress recorded in Keystone on a Vigie NCR: a step advancement ("→ Root cause"), or the quality
 * verification (approve → Closed, reject → back to Corrective action). Stays "pending sync with Vigie" until delivered;
 * the NCR's status changes in Keystone only when Vigie reports it.
 */
export const vigieNcrProgress = pgTable('vigie_ncr_progress', {
  id: id(),
  ncrId: uuid('ncr_id').notNull().references(() => vigieNcrs.id, { onDelete: 'cascade' }),
  projectCode: text('project_code').notNull(),
  ncrNumber: text('ncr_number').notNull(),
  kind: text('kind').$type<NcrProgressKind>().notNull(),
  /** Verification only. */
  decision: text('decision').$type<NcrVerificationDecision>(),
  fromStatus: text('from_status').$type<NcrStatus>().notNull(),
  /** Status requested from Vigie. */
  targetStatus: text('target_status').$type<NcrStatus>().notNull(),
  comment: text('comment'),
  actorName: text('actor_name').notNull(),
  actorPersonId: uuid('actor_person_id').references(() => persons.id),
  actorRole: text('actor_role').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  syncStatus: text('sync_status').$type<VigieSyncStatus>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  vigieRef: text('vigie_ref'),
});

// ── Site HSE — Vigie mirror (prevention plans, inductions, permits, near-miss register) ───────────────────

/**
 * Site HSE register as Vigie reports it (SITE_HSE 3582, HLT-026 × 5). Read-only in Keystone: prevention plans and
 * permits are issued and signed in Vigie ("Manage in Vigie"); incidents are declared there ("Report in Vigie").
 */
export const vigieHseItems = pgTable(
  'vigie_hse_items',
  {
    id: id(),
    projectCode: text('project_code').notNull(),
    /** Vigie's id ("PP-2026-013", "PF-2026-030") when known. */
    vigieRef: text('vigie_ref'),
    kind: text('kind').$type<HseItemKind>().notNull(),
    title: text('title').notNull(),
    status: text('status').$type<HseStatus>().notNull(),
    /** Free status text Vigie reports instead of a status ("0 déclaré" on the near-miss register). */
    statusText: text('status_text'),
    /** Signature / validity / planned date; null = "—". */
    dateOn: date('date_on', { mode: 'string' }),
    position: integer('position').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique().on(t.projectCode, t.position)],
);
