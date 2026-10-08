import 'server-only';
// People & organisation DAL (docs/spec/11 §3.1): persons, owners (OWN), departments, zones, countries, clients,
// users (personas).
import { asc, eq, isNotNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { cache } from 'react';
import { getDb } from '@/server/db/client';
import type { ZoneCode } from '@/server/db/codes';
import { clients, countries, departmentCapacities, departments, persons, users, zones } from '@/server/db/schema';

export interface PersonRow {
  id: string;
  /** Full name when known, else the short name. */
  name: string;
  fullName: string | null;
  /** "J. Wagner". */
  shortName: string;
  initials: string;
  /** Planner owner key ("JW") for the 9 OWN persons. */
  ownerCode: string | null;
  /** EN source string ("Structural engineer"). */
  jobTitle: string | null;
  department: string | null;
  /** Organisation of external contacts ("Port authority"). */
  client: string | null;
}

const personCols = {
  p: persons,
  department: departments.name,
  client: clients.name,
};

function toPerson(r: { p: typeof persons.$inferSelect; department: string | null; client: string | null }): PersonRow {
  const p = r.p;
  return {
    id: p.id, name: p.fullName ?? p.shortName, fullName: p.fullName, shortName: p.shortName, initials: p.initials,
    ownerCode: p.ownerCode, jobTitle: p.jobTitle, department: r.department, client: r.client,
  };
}

/** Every person, in seed order (OWN first). Memoised per request. */
export const listPeople = cache(async (): Promise<PersonRow[]> => {
  const db = await getDb();
  const rows = await db
    .select(personCols)
    .from(persons)
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .leftJoin(clients, eq(clients.id, persons.clientId))
    .orderBy(asc(persons.sortOrder));
  return rows.map(toPerson);
});

/** Person by full name ("Julien Wagner") or short name ("J. Wagner"). */
export async function getPersonByName(name: string): Promise<PersonRow | null> {
  const db = await getDb();
  const [r] = await db
    .select(personCols)
    .from(persons)
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .leftJoin(clients, eq(clients.id, persons.clientId))
    .where(or(eq(persons.fullName, name), eq(persons.shortName, name)));
  return r ? toPerson(r) : null;
}

/** Person by planner owner key ("JW"). */
export async function getPersonByOwnerCode(code: string): Promise<PersonRow | null> {
  return (await listPeople()).find((p) => p.ownerCode === code) ?? null;
}

/** The planner owners (OWN 3195) in prototype order: the owner select of the Plan screen. */
export async function listOwners(): Promise<PersonRow[]> {
  return (await listPeople()).filter((p) => p.ownerCode != null);
}

/** OWN-shaped map: { RA: ['Romain Aubert', 'Project manager'], … }. */
export async function getOwnerDirectory(): Promise<Record<string, [string, string]>> {
  return Object.fromEntries((await listOwners()).map((p) => [p.ownerCode!, [p.name, p.jobTitle ?? '']]));
}

export interface DepartmentRow {
  name: string;
  head: string | null;
  headShort: string | null;
  /** EN source string ("Head of engineering"). */
  headTitle: string | null;
}

/** Departments (DEPTS order). */
export async function listDepartments(): Promise<DepartmentRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ name: departments.name, head: persons.fullName, headShort: persons.shortName, headTitle: departments.headTitle })
    .from(departments)
    .leftJoin(persons, eq(persons.id, departments.headPersonId))
    .orderBy(asc(departments.sortOrder));
  return rows;
}

export interface DepartmentCapacityRow {
  department: string;
  /** Monday of the first week (ISO) and number of weeks of the window. */
  periodStart: string;
  weeks: number;
  capacityH: number;
  demandH: number;
}

/** Department capacity vs committed demand over the 8-week window (ROLES order). */
export async function listDepartmentCapacities(): Promise<DepartmentCapacityRow[]> {
  const db = await getDb();
  return db
    .select({
      department: departments.name, periodStart: departmentCapacities.periodStart, weeks: departmentCapacities.weeks,
      capacityH: departmentCapacities.capacityH, demandH: departmentCapacities.demandH,
    })
    .from(departmentCapacities)
    .innerJoin(departments, eq(departments.id, departmentCapacities.departmentId))
    .orderBy(asc(departmentCapacities.position));
}

export interface ZoneRow {
  code: ZoneCode;
  /** EN source string. */
  label: string;
  manager: string | null;
  /** [west, north, east, south]. */
  bounds: [number, number, number, number];
}

export async function listZones(): Promise<ZoneRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ z: zones, manager: persons.fullName })
    .from(zones)
    .leftJoin(persons, eq(persons.id, zones.managerPersonId))
    .orderBy(asc(zones.sortOrder));
  return rows.map(({ z, manager }) => ({ code: z.code, label: z.label, manager, bounds: [z.boundsW, z.boundsN, z.boundsE, z.boundsS] }));
}

/** Country → zone (COUNTRY_ZONE). */
export async function getCountryZones(): Promise<Record<string, ZoneCode>> {
  const db = await getDb();
  const rows = await db.select().from(countries).orderBy(asc(countries.sortOrder));
  return Object.fromEntries(rows.map((c) => [c.name, c.zoneCode]));
}

export interface ClientRow {
  name: string;
  /** Registered 3-letter code; null when none was registered. */
  code3: string | null;
}

export async function listClients(): Promise<ClientRow[]> {
  const db = await getDb();
  return db.select({ name: clients.name, code3: clients.code3 }).from(clients).orderBy(asc(clients.sortOrder));
}

/** Registered client codes (CLIENT_CODES shape). */
export async function getClientCodes(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.select({ name: clients.name, code3: clients.code3 }).from(clients).where(isNotNull(clients.code3)).orderBy(asc(clients.sortOrder));
  return Object.fromEntries(rows.map((r) => [r.name, r.code3!]));
}

export interface UserRow {
  role: string;
  name: string;
  shortName: string;
  /** Persona title, EN source string. */
  title: string;
  client: string | null;
}

/** Signed-in users = the "View as" personas. */
export async function listUsers(): Promise<UserRow[]> {
  const db = await getDb();
  const userClient = alias(clients, 'user_client');
  const rows = await db
    .select({ role: users.role, fullName: persons.fullName, shortName: persons.shortName, title: users.title, client: userClient.name })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .leftJoin(userClient, eq(userClient.id, users.clientId))
    .orderBy(asc(users.sortOrder));
  return rows.map((r) => ({ role: r.role, name: r.fullName ?? r.shortName, shortName: r.shortName, title: r.title, client: r.client }));
}
