// Organisation seed: clients, departments, persons (unified), users (personas), zones, countries, cities.
import { eq } from 'drizzle-orm';
import { initials, shortName } from '@/lib/format';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { clients, cities, countries, departmentCapacities, departments, persons, users, zones } from '../schema';
import type { Tx } from '../types';
import { must, newId, type SeedCtx } from './context';

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
    full(name, role === 'client' ? { clientName: 'Port authority' } : { jobTitle: title });
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
  const depts = Object.entries(PROTO.DEPTS as Record<string, [string, string]>);
  const deptRows = depts.map(([name, [, title]], i) => ({ id: newId(), name, headTitle: title, sortOrder: i + 1 }));
  for (const d of deptRows) ctx.departmentByName.set(d.name, d.id);
  await tx.insert(departments).values(deptRows);

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

  // Users = personas.
  const userRows = Object.entries(PROTO.PERSONAS as Record<string, [string, string]>).map(([role, [name, title]], i) => ({
    id: newId(), role, personId: must(ctx.personByFull, name, 'person'), title,
    clientId: role === 'client' ? must(ctx.clientByName, 'Port authority', 'client') : null, isExternal: role === 'client', sortOrder: i + 1,
  }));
  for (const u of userRows) ctx.userByRole.set(u.role, u.id);
  await tx.insert(users).values(userRows);

  // Zones, countries, cities.
  await tx.insert(zones).values(
    (PROTO.ZONES as [string, string, string][]).map(([code, label, manager], i) => {
      const [w, n, e, s] = PROTO.ZONE_BOUNDS[code] as number[];
      return { code: code as 'euna' | 'afr' | 'apac', label, managerPersonId: must(ctx.personByFull, manager, 'person'), boundsW: w, boundsN: n, boundsE: e, boundsS: s, sortOrder: i + 1 };
    }),
  );
  await tx.insert(countries).values(
    Object.entries(PROTO.COUNTRY_ZONE as Record<string, 'euna' | 'afr' | 'apac'>).map(([name, zoneCode], i) => ({ name, zoneCode, sortOrder: i + 1 })),
  );
  await tx.insert(cities).values(Object.entries(PROTO.CITY_COUNTRY as Record<string, string>).map(([name, countryName]) => ({ name, countryName })));
}
