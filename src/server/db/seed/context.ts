// Seed loader context: ids generated client-side so every foreign key resolves in one pass.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { activities, persons, projects } from '../schema';
import type { Tx } from '../types';

export const newId = (): string => randomUUID();

export interface SeedCtx {
  /** Person id by short name ("R. Aubert"), full name ("Romain Aubert") and planner owner code ("RA"). */
  personByShort: Map<string, string>;
  personByFull: Map<string, string>;
  personByOwner: Map<string, string>;
  clientByName: Map<string, string>;
  departmentByName: Map<string, string>;
  projectByCode: Map<string, string>;
  /** `${stage}|${position}` → stage deliverable definition id. */
  stageDeliverable: Map<string, string>;
  /** project code → WBS code → node id. */
  wbs: Map<string, Map<string, string>>;
  /** project code → activity code → activity id. */
  activity: Map<string, Map<string, string>>;
  /** project code → CR number → change request id. */
  changeRequest: Map<string, Map<string, string>>;
  /** User id by role key (personas). */
  userByRole: Map<string, string>;
  /** project code → risk number → risk id. */
  risk: Map<string, Map<string, string>>;
  /** Task id by number ("T-2314"). */
  task: Map<string, string>;
  /** Codex document id by number ("PID-HLT-026"). */
  document: Map<string, string>;
  /** Supplier / manufacturer id by name ("Halvorsen Cranes"). */
  supplierByName: Map<string, string>;
  /** Storage location id by name ("Entrepôt central — Lyon"). */
  locationByName: Map<string, string>;
  /** Catalogue part id by reference ("EL-VFD-200"). */
  partByRef: Map<string, string>;
  /** Purchase order id by number ("PO-1052"). */
  purchaseOrder: Map<string, string>;
  /** Goods receipt id by number ("BL-2026-0498"). */
  receipt: Map<string, string>;
}

export function newCtx(): SeedCtx {
  return {
    personByShort: new Map(),
    personByFull: new Map(),
    personByOwner: new Map(),
    clientByName: new Map(),
    departmentByName: new Map(),
    projectByCode: new Map(),
    stageDeliverable: new Map(),
    wbs: new Map(),
    activity: new Map(),
    changeRequest: new Map(),
    userByRole: new Map(),
    risk: new Map(),
    task: new Map(),
    document: new Map(),
    supplierByName: new Map(),
    locationByName: new Map(),
    partByRef: new Map(),
    purchaseOrder: new Map(),
    receipt: new Map(),
  };
}

/**
 * Context rebuilt from an existing database (people, projects, activities) — for module seeders that run on a database
 * seeded before them (see seedIfEmpty's backfill).
 */
export async function ctxFromDb(tx: Tx): Promise<SeedCtx> {
  const ctx = newCtx();
  for (const p of await tx.select({ id: persons.id, full: persons.fullName, short: persons.shortName }).from(persons)) {
    ctx.personByShort.set(p.short, p.id);
    if (p.full) ctx.personByFull.set(p.full, p.id);
  }
  for (const p of await tx.select({ id: projects.id, code: projects.code }).from(projects)) ctx.projectByCode.set(p.code, p.id);
  for (const a of await tx.select({ id: activities.id, code: activities.code, project: projects.code }).from(activities).innerJoin(projects, eq(projects.id, activities.projectId))) {
    if (!ctx.activity.has(a.project)) ctx.activity.set(a.project, new Map());
    ctx.activity.get(a.project)!.set(a.code, a.id);
  }
  return ctx;
}

/** Map lookup that fails loudly (seed data must be consistent). */
export function must<K, V>(m: Map<K, V>, k: K, what: string): V {
  const v = m.get(k);
  if (v === undefined) throw new Error(`Seed: unknown ${what} "${String(k)}"`);
  return v;
}

/** Person id by short or full name. */
export function personId(ctx: SeedCtx, name: string): string {
  return ctx.personByShort.get(name) ?? must(ctx.personByFull, name, 'person');
}

/** Person id by short or full name, or null for people the organisation does not know ("K. Lindqvist (Nordvolt)"). */
export function personIdOrNull(ctx: SeedCtx, name: string | null | undefined): string | null {
  if (!name) return null;
  return ctx.personByShort.get(name) ?? ctx.personByFull.get(name) ?? null;
}

/** Project code by its 3-letter short code ("HLT" → "HLT-026"), among the projects of the seed. */
export function projectCodeOfShort(ctx: SeedCtx, short: string): string {
  for (const code of ctx.projectByCode.keys()) if (code.slice(0, 3) === short && ctx.activity.has(code)) return code;
  for (const code of ctx.projectByCode.keys()) if (code.slice(0, 3) === short) return code;
  throw new Error(`Seed: unknown project short code "${short}"`);
}
