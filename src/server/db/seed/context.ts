// Seed loader context: ids generated client-side so every foreign key resolves in one pass.
import { randomUUID } from 'node:crypto';

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
  };
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

/** Project code by its 3-letter short code ("HLT" → "HLT-026"), among the projects of the seed. */
export function projectCodeOfShort(ctx: SeedCtx, short: string): string {
  for (const code of ctx.projectByCode.keys()) if (code.slice(0, 3) === short && ctx.activity.has(code)) return code;
  for (const code of ctx.projectByCode.keys()) if (code.slice(0, 3) === short) return code;
  throw new Error(`Seed: unknown project short code "${short}"`);
}
