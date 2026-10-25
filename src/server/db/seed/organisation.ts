// Organisation seed: clients, departments, persons (unified), users (personas), zones, countries, cities.
import { eq } from 'drizzle-orm';
import { DEMO_CLIENT_ORG, PERSONAS, PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { initials, shortName } from '@/lib/format';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { clients, cities, countries, departmentCapacities, departments, persons, users, zones } from '../schema';
import type { Tx } from '../types';
import { must, newId, type SeedCtx } from './context';
import { seedFinanceUser, seedLogisticsUser } from './users';

interface PersonDraft {
  id: string;
  fullName: string | null;
  shortName: string;
  ownerCode: string | null;
  jobTitle: string | null;
  departmentName: string | null;
  clientName: string | null;
  /** PEOPLE index + 1 (shared resource pool order). */
  poolPosition: number | null;
}

/**
 * Unifies the prototype's people sources (docs/spec/11 §3.1 Person, §7 #1) in a stable order: OWN, PEOPLE,
 * PERSONAS, department heads, zone managers, discipline leads, DOC_WHO, then the project managers cited by
 * projects. A person is matched by full name, else by short name; later sources only fill missing fields.
 */
export function collectPersons(): PersonDraft[] {
  const list: PersonDraft[] = [];
  const byFull = new Map<string, PersonDraft>();
  const byShort = new Map<string, PersonDraft>();
  const add = (full: string | null, short: string, patch: Partial<Omit<PersonDraft, 'id' | 'fullName' | 'shortName'>> = {}) => {
    let p = (full && byFull.get(full)) || byShort.get(short);
    if (!p) {
      p = { id: newId(), fullName: full, shortName: short, ownerCode: null, jobTitle: null, departmentName: null, clientName: null, poolPosition: null };
      list.push(p);
      byShort.set(short, p);
    }
    if (full && !p.fullName) p.fullName = full;
    if (full) byFull.set(full, p);
    for (const k of ['ownerCode', 'jobTitle', 'departmentName', 'clientName'] as const) if (p[k] == null && patch[k] != null) p[k] = patch[k]!;
    if (p.poolPosition == null && patch.poolPosition != null) p.poolPosition = patch.poolPosition;
  };
  const full = (name: string, patch?: Parameters<typeof add>[2]) => add(name, shortName(name), patch);

  for (const [code, [name, title]] of Object.entries(PROTO.OWN as Record<string, [string, string]>)) full(name, { ownerCode: code, jobTitle: title });
  (PROTO.PEOPLE as [string, string][]).forEach(([name, title], i) => full(name, { jobTitle: title, poolPosition: i + 1 }));
  for (const [name, dept] of Object.entries(PROTO.DEPT_OF as Record<string, string>)) full(name, { departmentName: dept });
  for (const [role, [name, title]] of Object.entries(PROTO.PERSONAS as Record<string, [string, string]>))
    full(name, role === 'client' ? { clientName: DEMO_CLIENT_ORG } : { jobTitle: title });
  for (const [dept, [name, title]] of Object.entries(PROTO.DEPTS as Record<string, [string, string]>)) full(name, { jobTitle: title, departmentName: dept });
  for (const [, , manager] of PROTO.ZONES as [string, string, string][]) full(manager);
  for (const [, , lead] of Object.values(PROTO.ENG_DISC as Record<string, [string, string, string, string]>)) full(lead);
  for (const short of Object.values(PROTO.DOC_WHO as Record<string, string>)) add(null, short);
  for (const p of PROTO_GEN.initialProjects) add(null, p.pm);
  return list;
}

export async function seedOrganisation(tx: Tx, ctx: SeedCtx): Promise<void> {
  // Clients: registered codes first, then clients cited by projects.
  const clientNames: string[] = Object.keys(PROTO.CLIENT_CODES);
  for (const p of PROTO_GEN.initialProjects) if (!clientNames.includes(p.client)) clientNames.push(p.client);
  const clientRows = clientNames.map((name, i) => ({ id: newId(), name, code3: (PROTO.CLIENT_CODES[name] as string) ?? null, sortOrder: i + 1 }));
  for (const c of clientRows) ctx.clientByName.set(c.name, c.id);
  await tx.insert(clients).values(clientRows);

  // Departments (heads set once persons exist).
  await seedDepartments(tx, ctx);
  const depts = Object.entries(PROTO.DEPTS as Record<string, [string, string]>);

  // Persons.
  const drafts = collectPersons();
  await tx.insert(persons).values(
    drafts.map((p, i) => ({
      id: p.id,
      fullName: p.fullName,
      shortName: p.shortName,
      initials: initials(p.fullName ?? p.shortName.replace(/\./g, '')),
      ownerCode: p.ownerCode,
      jobTitle: p.jobTitle,
      departmentId: p.departmentName ? must(ctx.departmentByName, p.departmentName, 'department') : null,
      clientId: p.clientName ? must(ctx.clientByName, p.clientName, 'client') : null,
      // Sign-in e-mails of the demo personas (R-038: Entra ID matches the token e-mail to the person).
      email: PERSONAS.find((x) => x.name === p.fullName)?.email ?? null,
      resourcePoolPosition: p.poolPosition,
      sortOrder: i + 1,
    })),
  );
  for (const p of drafts) {
    ctx.personByShort.set(p.shortName, p.id);
    if (p.fullName) ctx.personByFull.set(p.fullName, p.id);
    if (p.ownerCode) ctx.personByOwner.set(p.ownerCode, p.id);
  }
  for (const [name, [head]] of depts)
    await tx.update(departments).set({ headPersonId: must(ctx.personByFull, head, 'person') }).where(eq(departments.name, name));

  // Department capacity over the 8-week window w/c 28 Sep 2026 (ROLES).
  await tx.insert(departmentCapacities).values(
    (PROTO.ROLES as [string, number, number][]).map(([name, cap, demand], i) => ({
      id: newId(), departmentId: must(ctx.departmentByName, name, 'department'), periodStart: '2026-09-28', weeks: 8, capacityH: cap, demandH: demand, position: i + 1,
    })),
  );

  // Users = the demo personas (R-039: one user per person; real users are added at their first Entra ID sign-in).
  const userRows = Object.entries(PROTO.PERSONAS as Record<string, [string, string]>).map(([role, [name, title]], i) => {
    const draft = drafts.find((p) => p.fullName === name)!;
    return {
      id: newId(), personaRole: role, roles: [role], personId: must(ctx.personByFull, name, 'person'), title, email: PERSONA_BY_ROLE[role as RoleKey].email,
      departmentId: draft.departmentName ? must(ctx.departmentByName, draft.departmentName, 'department') : null,
      clientId: role === 'client' ? must(ctx.clientByName, DEMO_CLIENT_ORG, 'client') : null, isExternal: role === 'client', sortOrder: i + 1,
    };
  });
  for (const u of userRows) ctx.userByRole.set(u.personaRole, u.id);
  await tx.insert(users).values(userRows);
  // R-044: the Finance persona (not in the prototype's PERSONAS) gets its user next.
  const finance = await seedFinanceUser(tx);
  if (finance) ctx.userByRole.set('finance', finance);
  // R-158: the Logistics persona (no prototype person: created with its user).
  const logistics = await seedLogisticsUser(tx);
  if (logistics) ctx.userByRole.set('logistics', logistics);

  // Zones, countries, cities.
  await seedGeography(tx, (manager) => must(ctx.personByFull, manager, 'person'));
}

/** Departments (DEPTS 3268) without their heads — reference data of both seeds (R-011); the demo sets the heads. */
export async function seedDepartments(tx: Tx, ctx: SeedCtx): Promise<void> {
  const deptRows = Object.entries(PROTO.DEPTS as Record<string, [string, string]>).map(([name, [, title]], i) => ({ id: newId(), name, headTitle: title, sortOrder: i + 1 }));
  for (const d of deptRows) ctx.departmentByName.set(d.name, d.id);
  await tx.insert(departments).values(deptRows);
}

/**
 * ISO 3166-1 alpha-2 codes of the prototype's countries (share D17: countries.iso2 is the key of matrix.pays). The same table
 * backfills an existing database (migration 0035_share).
 */
export const COUNTRY_ISO2: Readonly<Record<string, string>> = {
  France: 'FR', 'United Kingdom': 'GB', Netherlands: 'NL', Germany: 'DE', Belgium: 'BE', Spain: 'ES', Italy: 'IT', Canada: 'CA',
  'United States': 'US', Morocco: 'MA', 'Côte d’Ivoire': 'CI', Senegal: 'SN', Kenya: 'KE', 'South Africa': 'ZA', Egypt: 'EG',
  Australia: 'AU', Malaysia: 'MY', Singapore: 'SG', Indonesia: 'ID', Vietnam: 'VN', Japan: 'JP', India: 'IN', Ghana: 'GH',
  Brazil: 'BR', 'Saudi Arabia': 'SA',
};

/**
 * Zones (with their bounds), countries and cities — reference data of both seeds (R-011). `managerOf` resolves the zone
 * manager of the prototype (demo) or returns null (production: no fictitious people).
 */
export async function seedGeography(tx: Tx, managerOf: (name: string) => string | null): Promise<void> {
  await tx.insert(zones).values(
    (PROTO.ZONES as [string, string, string][]).map(([code, label, manager], i) => {
      const [w, n, e, s] = PROTO.ZONE_BOUNDS[code] as number[];
      return { code: code as 'euna' | 'afr' | 'apac', label, managerPersonId: managerOf(manager), boundsW: w, boundsN: n, boundsE: e, boundsS: s, sortOrder: i + 1 };
    }),
  );
  await tx.insert(countries).values(
    Object.entries(PROTO.COUNTRY_ZONE as Record<string, 'euna' | 'afr' | 'apac'>).map(([name, zoneCode], i) => ({ name, zoneCode, sortOrder: i + 1, iso2: COUNTRY_ISO2[name] ?? null })),
  );
  await tx.insert(cities).values(Object.entries(PROTO.CITY_COUNTRY as Record<string, string>).map(([name, countryName]) => ({ name, countryName })));
}
