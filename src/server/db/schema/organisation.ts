// Organisation and reference data (docs/spec/11 §3.1): persons, users (one per person, R-039), departments, zones,
// countries, cities, clients.
import { sql } from 'drizzle-orm';
import { boolean, char, check, date, doublePrecision, integer, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { ZoneCode } from '../codes';
import { id, num, timestamps } from './_common';
import { rateRoles } from './resources';

/** Client organisations (CLIENT_CODES 3167 + clients cited by projects). */
export const clients = pgTable(
  'clients',
  {
    id: id(),
    name: text('name').notNull().unique(),
    /** Registered 3-letter code (HAV…); null for clients never registered (new code proposed by clientCode3). */
    code3: text('code3').unique(),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
    /**
     * R-190 (Arche K-05): the client is a group subsidiary (internal client) — it follows its projects in the CAPEX application,
     * never in the client portal (R-179, I-2b). Set by the director (Contract screen) or at the order of a subsidiary's need.
     */
    isInternal: boolean('is_internal').notNull().default(false),
    /**
     * R-190: the subsidiary's code as Arche (pub_capex.filiale_code, "SAI") and Matrix (pub_filiales.code, D21) know it; one client
     * per subsidiary; only on an internal client; null when not known yet.
     */
    subsidiaryCode: text('subsidiary_code').unique('clients_subsidiary_code_unique'),
  },
  (t) => [
    check('clients_subsidiary_code_check', sql`${t.subsidiaryCode} ~ '^[A-Z]{3}$'`),
    check('clients_subsidiary_internal_check', sql`${t.subsidiaryCode} is null or ${t.isInternal}`),
  ],
);

/** Departments (DEPTS 3268). */
export const departments = pgTable(
  'departments',
  {
    id: id(),
    name: text('name').notNull().unique(),
    headPersonId: uuid('head_person_id').references((): AnyPgColumn => persons.id),
    /** "Head of engineering" (EN source string). */
    headTitle: text('head_title'),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
    /**
     * Share D15 (Matrix): the unit of matrix.pub_organigramme (service, or department without service) this department stands
     * for ("ENG-MEC"); null until mapped. Keystone's departments become a cache refreshed from that view.
     */
    orgCode: text('org_code').unique('departments_org_code_unique'),
  },
  (t) => [check('departments_org_code_check', sql`${t.orgCode} ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$'`)],
);

/**
 * Staff and external contacts (PEOPLE, OWN, PERSONAS, DEPTS heads, zone managers, ENG_DISC leads, DOC_WHO and
 * the project managers cited by projects). Some are only known by their short name ("S. Perrin").
 */
export const persons = pgTable('persons', {
  id: id(),
  /** "Julien Wagner"; null when the prototype only knows the short form. */
  fullName: text('full_name'),
  /** "J. Wagner" — unique; how projects, bars and records cite people. */
  shortName: text('short_name').notNull().unique(),
  /** "JW" (display; not unique). */
  initials: text('initials').notNull(),
  /** Planner owner key (`OWN` 3195, activities' `o`): set for the 9 schedulable owners. */
  ownerCode: text('owner_code').unique(),
  /** EN source string: "Structural engineer". */
  jobTitle: text('job_title'),
  departmentId: uuid('department_id').references((): AnyPgColumn => departments.id),
  /** External contacts: their organisation. */
  clientId: uuid('client_id').references(() => clients.id),
  email: text('email'),
  /** R-027 (NEW-CURSUS-2): Cursus employee id ("EMP-0018"), the key of the staff directory import; null until imported. */
  matricule: text('matricule').unique(),
  /** R-027: the Cursus team as received when no department has exactly that name (kept as text, never invented). */
  directoryTeam: text('directory_team'),
  /** R-027: last staff-directory import that matched or created this person. */
  directorySyncedAt: timestamp('directory_synced_at', { withTimezone: true }),
  isContractRole: boolean('is_contract_role').notNull().default(false),
  /**
   * R-083 (A-10, R-4a): the person's role on the rate grid — how their hours are valued (rate in force on the date worked).
   * Seeded by exact job title; null = "not valued" (production has no source yet: open question until R-027).
   */
  rateRoleId: uuid('rate_role_id').references((): AnyPgColumn => rateRoles.id, { onDelete: 'set null' }),
  /** Position in the shared resource pool (PEOPLE 3123 order: allocations, skills, leave); null = not in the pool. */
  resourcePoolPosition: integer('resource_pool_position'),
  sortOrder: integer('sort_order').notNull(),
  ...timestamps,
});

/**
 * User accounts — one row per person (R-039). Real users are created at their first Microsoft Entra ID sign-in (R-038):
 * the token e-mail designates the person, the token roles (app roles or mapped groups) give `roles`. The 8 "View as"
 * personas (PERSONAS 3747) are seeded as users too, with their persona role, for the demo mode (KEYSTONE_AUTH=demo).
 */
export const users = pgTable('users', {
  id: id(),
  /**
   * Demo mode: the "View as" persona this user stands for (RoleKey; one user per persona role). Null for real users.
   * The database column keeps its historical name `role`.
   */
  personaRole: text('role').unique(),
  /** Every Keystone role held (RoleKey[], priority order); refreshed from the token at each sign-in. */
  roles: text('roles').array().notNull().default([]),
  personId: uuid('person_id').notNull().unique().references(() => persons.id),
  /** Entra ID object id (`oid` claim) — the stable link to the Microsoft account, set at the first sign-in. */
  entraObjectId: text('entra_object_id').unique(),
  /** Sign-in e-mail (lower case) of the last sign-in; the persona e-mail for the demo users. */
  email: text('email'),
  /** Title under the user's name, EN source string ("Client — Port authority", the job title). */
  title: text('title').notNull(),
  /** Department of the user (copied from the person at each sign-in; the staff directory stays the source). */
  departmentId: uuid('department_id').references(() => departments.id),
  /** Client organisation of an external user (replaces the CLIENT_ORG constant). */
  clientId: uuid('client_id').references(() => clients.id),
  isExternal: boolean('is_external').notNull().default(false),
  active: boolean('active').notNull().default(true),
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull(),
  ...timestamps,
});

/** Department capacity over the 8-week resource window (ROLES 3132). */
export const departmentCapacities = pgTable('department_capacities', {
  id: id(),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  weeks: integer('weeks').notNull(),
  capacityH: num('capacity_h').notNull(),
  demandH: num('demand_h').notNull(),
  /** ROLES order (Engineering, Site operations, MEP, Controls & planning, Quality). */
  position: integer('position').notNull(),
});

/** Zones (ZONES 3170, ZONE_BOUNDS 3172). */
export const zones = pgTable('zones', {
  code: text('code').$type<ZoneCode>().primaryKey(),
  /** EN source string ("Europe & North America"). */
  label: text('label').notNull(),
  managerPersonId: uuid('manager_person_id').references(() => persons.id),
  boundsW: doublePrecision('bounds_w').notNull(),
  boundsN: doublePrecision('bounds_n').notNull(),
  boundsE: doublePrecision('bounds_e').notNull(),
  boundsS: doublePrecision('bounds_s').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

/** Countries → zone (COUNTRY_ZONE 3171). */
export const countries = pgTable(
  'countries',
  {
    name: text('name').primaryKey(),
    zoneCode: text('zone_code').$type<ZoneCode>().notNull().references(() => zones.code),
    sortOrder: integer('sort_order').notNull(),
    /**
     * Share D17 (Matrix): ISO 3166-1 alpha-2 code ("FR"), the key of matrix.pays. Written by both seeds; null only for a country
     * added without one (no screen adds countries today).
     */
    iso2: char('iso2', { length: 2 }).unique('countries_iso2_unique'),
  },
  (t) => [check('countries_iso2_check', sql`${t.iso2} ~ '^[A-Z]{2}$'`)],
);

/** Cities used to resolve free-text sites (CITY_COUNTRY 3174, zoneOfSite). */
export const cities = pgTable('cities', {
  name: text('name').primaryKey(),
  countryName: text('country_name').notNull().references(() => countries.name),
});
