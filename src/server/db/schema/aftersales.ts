// Installed base and after-sales (docs/spec/11 §3.7 Machine / MachineConfiguration / MachinePartRevision, WarrantyClaim /
// Intervention; screens 07 §2.8–2.9, part record "Installed base" 09 §2.2). Keystone owns them. The ECO pins of the
// as-maintained configuration come from the Vigie ECO mirror (effectivity targets of type machine), never from here.
import { date, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ClaimCoverage, ClaimStatus, InterventionStatus, InterventionType, MachineTypeCode, NcrSeverity, WarrantyStatus } from '../codes';
import { id, keur, num, timestamps } from './_common';
import { clients, persons } from './organisation';
import { machineTypes, projectEquipments, projects } from './portfolio';

/**
 * Machines in service (FLEET 3729: 8; machines added in Keystone continue at MCH-050). The zone is derived from the
 * site's city (cities → countries → zones), else the delivering project's zone, else Europe & North America.
 */
export const machines = pgTable('machines', {
  id: id(),
  /** "MCH-041". */
  number: text('number').notNull().unique(),
  machineTypeCode: text('machine_type_code').$type<MachineTypeCode>().notNull().references(() => machineTypes.code),
  name: text('name').notNull(),
  /** Client as the installed base names it ("Tanger Med port authority"); the client organisation when registered. */
  clientName: text('client_name').notNull(),
  clientId: uuid('client_id').references(() => clients.id),
  /** "Le Havre · quay 2" (city before " · "). */
  siteText: text('site_text').notNull(),
  /** Delivering project ("QFR-015"); null = "—". */
  projectCode: text('project_code'),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** R-185: the delivering project's equipment line (its type is the machine's); null when unknown or the line was removed. */
  equipmentId: uuid('equipment_id').references(() => projectEquipments.id, { onDelete: 'set null' }),
  /** Delivery = warranty start; null = "—". */
  deliveredOn: date('delivered_on', { mode: 'string' }),
  warrantyEndOn: date('warranty_end_on', { mode: 'string' }),
  warrantyStatus: text('warranty_status').$type<WarrantyStatus>().notNull(),
  /** Extended warranty end ("Extended → 4 Jun 2027"). */
  extendedUntil: date('extended_until', { mode: 'string' }),
  /** As-maintained configuration generation ("Gen 2", AS_MAINT 3722); null when no configuration is recorded. */
  generation: text('generation'),
  position: integer('position').notNull(),
  ...timestamps,
});

/** As-maintained configuration: the revision of each tracked part fitted on a machine (AS_MAINT 3722: 6 machines). */
export const machinePartRevisions = pgTable(
  'machine_part_revisions',
  {
    machineId: uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
    /** Catalogue reference ("ASM-RMG-250"). */
    partRef: text('part_ref').notNull(),
    revision: text('revision').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.machineId, t.partRef)],
);

/** Warranty claims (CLAIMS 3730: 8; claims opened in Keystone continue at WC-020). */
export const warrantyClaims = pgTable('warranty_claims', {
  id: id(),
  /** "WC-013". */
  number: text('number').notNull().unique(),
  machineId: uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
  issue: text('issue').notNull(),
  /** Description given when the claim was opened; null for the seed. */
  description: text('description'),
  severity: text('severity').$type<NcrSeverity>().notNull(),
  reportedOn: date('reported_on', { mode: 'string' }).notNull(),
  status: text('status').$type<ClaimStatus>().notNull(),
  coverage: text('coverage').$type<ClaimCoverage>().notNull(),
  /** Warranty / chargeable cost, k€. */
  costKeur: keur('cost_keur').notNull(),
  /** Design ECO the claim is linked to ("ECO-031"; a Vigie ECO, free reference). */
  ecoNumber: text('eco_number'),
  ownerName: text('owner_name').notNull(),
  ownerPersonId: uuid('owner_person_id').references(() => persons.id),
  /** "Replace brake disc · intervention 8 Oct"; '—' when none. */
  nextStep: text('next_step').notNull(),
  /** Diagnosis entered by after-sales (R-143, Q-8; required to mark the claim Diagnosed); null for the seed. */
  diagnosis: text('diagnosis'),
  /** Closure date (R-143). */
  closedOn: date('closed_on', { mode: 'string' }),
  position: integer('position').notNull(),
  ...timestamps,
});

/** Field interventions (INTERVENTIONS 3731: 6). The seed's type text "Corrective · WC-014" is split into type + claim. */
export const interventions = pgTable('interventions', {
  id: id(),
  /** "IV-082". */
  number: text('number').notNull().unique(),
  machineId: uuid('machine_id').notNull().references(() => machines.id, { onDelete: 'cascade' }),
  claimId: uuid('claim_id').references(() => warrantyClaims.id, { onDelete: 'set null' }),
  type: text('intervention_type').$type<InterventionType>().notNull(),
  /** Rest of the type text: "annual check", "(chargeable)"; null when none. */
  typeDetail: text('type_detail'),
  scheduledOn: date('scheduled_on', { mode: 'string' }).notNull(),
  /** "T. Kerbrat + J. Wagner". */
  technicians: text('technicians').notNull(),
  /** Duration in days ("0.5 day" → 0.5). */
  durationDays: num('duration_days').notNull(),
  status: text('status').$type<InterventionStatus>().notNull(),
  position: integer('position').notNull(),
  // ── Closure in Keystone (R-143) and the configuration update it brings (R-144, E-8) ──
  /** Date the intervention was done; null while planned (and for the seed). */
  doneOn: date('done_on', { mode: 'string' }),
  /** What was done (intervention report). */
  report: text('report'),
  /** Part replaced or upgraded on the machine and the revision fitted: updates the as-maintained configuration. */
  partRef: text('part_ref'),
  partRevision: text('part_revision'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
