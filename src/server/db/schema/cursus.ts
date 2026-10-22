// Cursus mirror (user decision): Cursus — the group's HR / training application — owns individual site clearances and
// the people Go / No Go per site. Keystone keeps a read-only copy of the approvals it receives (SITE_DOCS 3574 shape:
// visa, vaccinations, clearances & badges, verdict, received) and an outbox of what it sends to Cursus (reminders,
// travel requests). Passports, visa files, vaccination records and medical data stay in Cursus: only approvals, their
// confirmation and dates are stored here (10 §3.4.f). Written only by the Cursus connector (src/server/integrations/cursus).
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  CursusClearance, CursusEventStatus, CursusRequestKind, CursusSyncStatus, CursusTaskPushStatus, CursusVaccination, CursusVerdict, CursusVisa,
} from '../codes';
import { id } from './_common';
import { persons } from './organisation';

/** Individual go / no go of the people mobilised on a project's site, as Cursus reports it. */
export const cursusClearances = pgTable(
  'cursus_clearances',
  {
    id: id(),
    /** Keystone project code ("HLT-026"). */
    projectCode: text('project_code').notNull(),
    /** Cursus's id of the site ("K-2614") when known. */
    chantierId: text('chantier_id'),
    /**
     * Cursus employee id ("EMP-0018"); null for the prototype seed (names only). Matricule ↔ Keystone person: persons.matricule
     * (R-027, NEW-CURSUS-2 'a'); the Site links the person to Cursus by it (R-032, NEW-CURSUS-3 'a').
     */
    matricule: text('matricule'),
    /** Display name; the Keystone person when the name resolves. */
    personName: text('person_name').notNull(),
    personId: uuid('person_id').references(() => persons.id),
    visa: text('visa').$type<CursusVisa>().notNull(),
    vaccination: text('vaccination').$type<CursusVaccination>().notNull(),
    clearance: text('clearance').$type<CursusClearance>().notNull(),
    /** "HT B2V expires 30 Nov 2026" / "Badge ISPS pending" (Cursus's reason text, no personal data). */
    clearanceNote: text('clearance_note').notNull(),
    verdict: text('verdict').$type<CursusVerdict>().notNull(),
    /** Reason codes Cursus gives with the verdict ("HABILITATION", "FORMALITES_VOYAGE"…). */
    reasonCodes: text('reason_codes').array().notNull().default([]),
    /** When Cursus issued this verdict ("26 Sep 07:00"). */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    position: integer('position').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique().on(t.projectCode, t.personName)],
);

/** Outbox towards Cursus: "Remind in Cursus" on a person's pending approvals, travel requests (POST /demandes). */
export const cursusRequests = pgTable('cursus_requests', {
  id: id(),
  projectCode: text('project_code').notNull(),
  kind: text('kind').$type<CursusRequestKind>().notNull(),
  /** The person concerned (clearance row's name and matricule). */
  personName: text('person_name').notNull(),
  matricule: text('matricule'),
  clearanceId: uuid('clearance_id').references(() => cursusClearances.id, { onDelete: 'set null' }),
  /** Travel request: { destination, depart, retour } (ISO dates) per Cursus's contract. */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  actorName: text('actor_name').notNull(),
  actorPersonId: uuid('actor_person_id').references(() => persons.id),
  actorRole: text('actor_role').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  /** Business date of the request (status-date time model). */
  requestedOn: date('requested_on', { mode: 'string' }).notNull(),
  syncStatus: text('sync_status').$type<CursusSyncStatus>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  /** Cursus's acknowledgement ("demandesKeystone" id). */
  cursusRef: text('cursus_ref'),
  /** Set while a delivery is in flight (R-010: two deliveries never send the same request); cleared by the result. */
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
});

/** Cursus synchronisations (mock: the seed's "26 Sep 07:00"; HTTP: each go-no-go refresh). */
export const cursusSyncRuns = pgTable('cursus_sync_runs', {
  id: id(),
  projectCode: text('project_code').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
  /** People received. */
  volume: integer('volume').notNull(),
  mode: text('mode').$type<'mock' | 'http'>().notNull(),
  ok: boolean('ok').notNull().default(true),
  error: text('error'),
});

/**
 * Inbox of the events Cursus pushes to POST /api/integrations/cursus/events (R-029, NEW-CURSUS-7 "a"; contract in
 * docs/integrations/cursus-contract.md). One row per accepted event: the event id is the idempotency key (a repeated id is
 * answered as a duplicate and stored once); an event with a replacement key (validated hours of a person's week, an absence)
 * replaces the previous one of that key. Kept 13 months (job "cursus-events-purge"). Unresolved events (a matricule no
 * person carries yet) stay for replay. Minimised (R-173): an absence keeps its dates and simple type, never its reason.
 */
export const cursusEvents = pgTable(
  'cursus_events',
  {
    id: id(),
    /** Cursus's event id. */
    eventId: text('event_id').notNull().unique(),
    /** "heures.validees", "absence.validee", "verdict.modifie", "demande.decision"… */
    type: text('type').notNull(),
    /** When Cursus emitted it (`emis_le`). */
    emittedAt: timestamp('emitted_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    /** Replacement key: "<matricule>|<semaine>" (hours), the absence id or "<matricule>|<start>|<end>" (absence); null when none. */
    replaceKey: text('replace_key'),
    /** Person concerned when the event names one (Cursus employee id). */
    matricule: text('matricule'),
    /** The event's data as stored (minimised for absences: dates and Leave / Absence only). */
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<CursusEventStatus>().notNull(),
    /** Why the event is unresolved, ignored or in error (EN, no personal data). */
    note: text('note'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('cursus_events_replace_idx').on(t.type, t.replaceKey), index('cursus_events_status_idx').on(t.status), index('cursus_events_received_idx').on(t.receivedAt)],
);

/**
 * R-180: the snapshots of Keystone's planned tasks sent to Cursus (`PUT /api/integrations/keystone/v1/instantane`, section
 * `taches`, after `PUT …/v1/projets/{code}` for the projects they cite; rules src/domain/cursus-tasks.ts, push
 * src/server/integrations/cursus/tasks.ts). One row per push (nightly job "cursus-tasks", "Sync now" of the Cursus connector);
 * the body is kept on the latest row only (the mock connector's record of what would be sent). Rows older than 90 days are
 * removed by the next push.
 */
export const cursusTaskPushes = pgTable(
  'cursus_task_pushes',
  {
    id: id(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    /** 'job' (nightly) or 'sync' ("Sync now"). */
    trigger: text('trigger').$type<'job' | 'sync'>().notNull(),
    mode: text('mode').$type<'mock' | 'http'>().notNull(),
    status: text('status').$type<CursusTaskPushStatus>().notNull(),
    /** `depuis` of the snapshot (Cursus deletes only the absent tasks that end on or after it). */
    since: date('since', { mode: 'string' }).notNull(),
    projects: integer('projects').notNull().default(0),
    tasks: integer('tasks').notNull().default(0),
    /** Distinct matricules of the tasks. */
    persons: integer('persons').notNull().default(0),
    /** Persons with planned work but no matricule (no proposal in Cursus). */
    withoutMatricule: integer('without_matricule').notNull().default(0),
    /** Tasks Cursus refused (400 VALIDATION on their fields, e.g. a matricule Cursus does not know): left out of the snapshot sent. */
    rejected: integer('rejected').notNull().default(0),
    /** The snapshot `{ depuis, projets, taches }`; null once a newer push exists. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    /** Cursus's `bilan`, and the refused tasks `{ id, champ, message }` (no personal data beyond the matricule-free ids). */
    result: jsonb('result').$type<Record<string, unknown>>(),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Set while a delivery is in flight (R-010: two deliveries never send the same push); cleared by the result. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [index('cursus_task_pushes_requested_idx').on(t.requestedAt), index('cursus_task_pushes_status_idx').on(t.status)],
);
