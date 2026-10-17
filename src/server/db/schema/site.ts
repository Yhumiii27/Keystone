// Site (chantier) — readiness, mobilisation and daily execution (docs/spec/11 §3.11; screen 10 §3). Keystone owns the
// site sheet, equipment, client prerequisites, rotation plan, collisions, mission costs and daily reports. Individual
// clearances and the people Go / No Go belong to Cursus (cursus.ts mirror); the site HSE register to Vigie (vigie.ts);
// the site punch list is a register of `punch_items` (operations.ts).
import { boolean, date, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { CollisionKind, ConfirmStatus, EquipmentSource, HseIncident, Weather } from '../codes';
import { id, keur, num, timestamps } from './_common';
import { risks } from './control';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';

/**
 * Site sheet of a project (SITE 3573: HLT-026 only in the seed). D-3 'a' (R-118): the project's leads create it with
 * "Prepare the site" from the Études stage and fill it in Keystone; values are typed text (the seed's are authored in French,
 * "Lun–Sam 7h–19h…"). `cursusChantierId` is the site's id in Cursus ("K-2614"), used by the HTTP Cursus connector — D-3 'a'
 * says the sheet carries it, but Cursus has no site-creation endpoint yet (R-028, NEW-CURSUS-1): null until Cursus creates
 * the site ("Cursus site: not created yet").
 */
export const siteSheets = pgTable('site_sheets', {
  id: id(),
  projectId: uuid('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  siteName: text('site_name').notNull(),
  country: text('country').notNull(),
  timeZone: text('time_zone').notNull(),
  language: text('language').notNull(),
  currency: text('currency').notNull(),
  clientContact: text('client_contact').notNull(),
  workingHours: text('working_hours').notNull(),
  localHolidays: text('local_holidays').notNull(),
  accessConstraints: text('access_constraints').notNull(),
  startOn: date('start_on', { mode: 'string' }).notNull(),
  endOn: date('end_on', { mode: 'string' }).notNull(),
  doneDays: integer('done_days').notNull(),
  planDays: integer('plan_days').notNull(),
  /** Planned man-days on site ("Man-days planned 168"). */
  manDaysPlanned: integer('man_days_planned').notNull(),
  cursusChantierId: text('cursus_chantier_id'),
  ...timestamps,
});

/** Equipment on site (SITE_EQUIP 3575: shipped with the machine, rented locally, provided by the client). */
export const siteEquipment = pgTable(
  'site_equipment',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    source: text('source').$type<EquipmentSource>().notNull(),
    status: text('status').$type<Exclude<ConfirmStatus, 'signed'>>().notNull(),
    note: text('note').notNull(),
    confirmedOn: date('confirmed_on', { mode: 'string' }),
    confirmedByPersonId: uuid('confirmed_by_person_id').references(() => persons.id),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.position)],
);

/** Client prerequisites (SITE_PREREQ 3576): dated and signed by the client, each one conditions a site activity. */
export const sitePrerequisites = pgTable(
  'site_prerequisites',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Activity it conditions ("A1320"). */
    activityCode: text('activity_code').notNull(),
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    neededBy: date('needed_by', { mode: 'string' }).notNull(),
    status: text('status').$type<ConfirmStatus>().notNull(),
    /** Evidence ("12 Sep · N. Bensaïd", "Demande déposée 20 Sep"). */
    evidence: text('evidence').notNull(),
    confirmedOn: date('confirmed_on', { mode: 'string' }),
    signedOn: date('signed_on', { mode: 'string' }),
    position: integer('position').notNull(),
    /**
     * R-121 (D-4 'a'): the need date the J-15 alert was sent for (null = never alerted) and when — one alert per need date
     * (src/domain/prerequisite-alerts.ts). Written by the daily job only; not part of the line's stamp.
     */
    alertedNeededBy: date('alerted_needed_by', { mode: 'string' }),
    alertedAt: timestamp('alerted_at', { withTimezone: true }),
    /** R-121: the risk a lead raised from this prerequisite ("Raise as a risk"); null until then. */
    riskId: uuid('risk_id').references(() => risks.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.position)],
);

/** Site team rotation plan (SITE_ROTATION 3577): who, role on site, mission dates, lodging, travel, rotation. */
export const siteRotations = pgTable(
  'site_rotations',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "Amélie Ollivier", or a contractor crew ("Contractant — 2 monteurs"). */
    personName: text('person_name').notNull(),
    personId: uuid('person_id').references(() => persons.id),
    roleOnSite: text('role_on_site').notNull(),
    /** Mission start / end (the prototype's "Issued by" / "Recipients" headers showed these dates, 10 OQ8). */
    fromOn: date('from_on', { mode: 'string' }).notNull(),
    toOn: date('to_on', { mode: 'string' }).notNull(),
    lodging: text('lodging').notNull(),
    travel: text('travel').notNull(),
    rotationNo: integer('rotation_no').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.position)],
);

/**
 * Collisions of the site team as the prototype listed them (SITE_COLLISIONS 3578: load, certificate, document, leave). R-119
 * (D-6b 'a'): the conflicts are now computed from the rotation plan, the resource pool, Cursus and the absences
 * (src/domain/site.ts `siteConflicts`); this table is no longer read and is kept until the owner confirms its deletion.
 */
export const siteCollisions = pgTable(
  'site_collisions',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    personName: text('person_name').notNull(),
    personId: uuid('person_id').references(() => persons.id),
    description: text('description').notNull(),
    kind: text('kind').$type<CollisionKind>().notNull(),
    proposedFix: text('proposed_fix').notNull(),
    /** Collisions are not cleared by "Resolve" in the prototype (10 OQ10); a resolved collision keeps its row. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.position)],
);

/**
 * R-119 (D-6b 'a': "le conflit disparaît quand sa cause disparaît ; le chef de service peut aussi le marquer « arbitré », avec un
 * commentaire"): a computed site-team conflict marked arbitrated. `conflictKey` names the conflict and its cause (kind,
 * person, and what causes it — weeks, dates, Cursus state — never the load percentage), so the arbitration lasts while the
 * cause is unchanged and a new or changed cause is open again. Who may arbitrate: src/domain/site.ts `canArbitrateConflict`.
 */
export const siteConflictArbitrations = pgTable(
  'site_conflict_arbitrations',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    conflictKey: text('conflict_key').notNull(),
    /** Person of the conflict as the rotation plan names them ("Julien Wagner", "Contractant — 2 monteurs"). */
    personName: text('person_name').notNull(),
    kind: text('kind').$type<CollisionKind>().notNull(),
    /** Why it is accepted (required). */
    comment: text('comment').notNull(),
    arbitratedByName: text('arbitrated_by_name').notNull(),
    arbitratedByPersonId: uuid('arbitrated_by_person_id').references(() => persons.id),
    arbitratedAt: timestamp('arbitrated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.conflictKey)],
);

/** Mission cost lines charged to the Site work package (SITE_COSTS 3579), k€. */
export const missionCostLines = pgTable(
  'mission_cost_lines',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    budgetKeur: keur('budget_keur').notNull(),
    actualKeur: keur('actual_keur').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.projectId, t.position)],
);

/**
 * Daily site reports (SITE_REPORTS 3580 + reports saved with the "Daily report" form). Numbered per project
 * (DR-001…) in date order; `linkRef` points to an NCR ("NCR-029") or nothing.
 */
export const dailyReports = pgTable(
  'daily_reports',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    reportOn: date('report_on', { mode: 'string' }).notNull(),
    /** Activity label as reported ("Préparation") and the activity when it is one of the plan. */
    activityLabel: text('activity_label').notNull(),
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    /** % complete reported; null = "—". */
    percentComplete: num('percent_complete'),
    text: text('text').notNull(),
    linkRef: text('link_ref'),
    authorName: text('author_name').notNull(),
    authorPersonId: uuid('author_person_id').references(() => persons.id),
    weather: text('weather').$type<Weather>(),
    headcount: integer('headcount'),
    hseIncident: text('hse_incident').$type<HseIncident>(),
    /** Saved from the form in Keystone (the two seed reports were filled on mobile). */
    fromForm: boolean('from_form').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number)],
);
