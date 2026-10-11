import 'server-only';
// Write-side helpers shared by the DAL writers (server functions call the DAL, never this file directly):
// lookups by business key, business numbering (RQ-045, T-2341, R-21, CR-011…) and the append-only audit trail
// and activity feed (docs/spec/11 §0 "Every state change also writes an AuditEntry", §3.12).
import { and, eq, or } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { nextBusinessNumber, type ActivityKind } from './codes';
import { activityEvents, auditEntries, persons, projects, users } from './schema';
import { demoFloor } from './seed/mode';
import type { DB, Tx } from './types';

export { demoFloor } from './seed/mode';

type Q = DB | Tx;

/** Person by full name ("Julien Wagner") or short name ("J. Wagner"); null when unknown. */
export async function findPerson(q: Q, name: string | null | undefined): Promise<{ id: string; fullName: string | null; shortName: string } | null> {
  if (!name) return null;
  const [p] = await q
    .select({ id: persons.id, fullName: persons.fullName, shortName: persons.shortName })
    .from(persons)
    .where(or(eq(persons.fullName, name), eq(persons.shortName, name)));
  return p ?? null;
}

/** Person by name; throws when unknown (writers must not invent people). */
export async function requirePerson(q: Q, name: string): Promise<{ id: string; fullName: string | null; shortName: string }> {
  const p = await findPerson(q, name);
  if (!p) throw new Error(`Unknown person "${name}"`);
  return p;
}

/** Person of the demo user standing for a role (the "View as" persona; R-039: real users carry `roles` instead). */
export async function personOfRole(q: Q, role: string): Promise<{ userId: string; personId: string; fullName: string | null; shortName: string } | null> {
  const [r] = await q
    .select({ userId: users.id, personId: persons.id, fullName: persons.fullName, shortName: persons.shortName })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(eq(users.personaRole, role));
  return r ?? null;
}

/** Project id and BAC by code; throws when unknown. */
export async function requireProject(q: Q, code: string): Promise<{ id: string; code: string; budgetKeur: number; shortCode: string }> {
  const [p] = await q
    .select({ id: projects.id, code: projects.code, budgetKeur: projects.budgetKeur, shortCode: projects.shortCode })
    .from(projects)
    .where(eq(projects.code, code));
  if (!p) throw new Error(`Unknown project ${code}`);
  return p;
}

/**
 * Next "PREFIX-nnn" number over every row of `column` (global sequence, as in the prototype — OPEN QUESTION Q-7):
 * max(existing, floor) + 1, where `floor` (the prototype's continuation number) applies to a demo database only (R-011,
 * seed/mode.ts demoFloor). Call inside the writing transaction: it runs SERIALIZABLE (src/server/db/transactions.ts), so two
 * concurrent writers never get the same number — one of them is run again (R-010).
 */
export async function nextNumber(q: Q, table: PgTable, column: PgColumn, prefix: string, pad: number, floor = 0): Promise<string> {
  const rows = (await q.select({ n: column }).from(table)) as { n: string }[];
  return nextBusinessNumber(rows.map((r) => r.n), prefix, pad, await demoFloor(q, floor));
}

export interface AuditInput {
  /** Actor display name (person full name, or a system: "System", "Lucca"…). */
  actorName: string;
  actorPersonId?: string | null;
  /** "CR-008", "Request RQ-045", "Rate card". */
  objectRef: string;
  /** "status: Draft → In review". */
  change: string;
  /** "Change control", "Approvals", "Settings"… */
  area: string;
  entityType?: string | null;
  entityId?: string | null;
  projectId?: string | null;
  occurredAt?: Date;
}

/** Appends one audit row (AUDIT shape: when, who, object, change, area). */
export async function writeAudit(q: Q, e: AuditInput): Promise<void> {
  await q.insert(auditEntries).values({
    occurredAt: e.occurredAt ?? new Date(), actorName: e.actorName, actorPersonId: e.actorPersonId ?? null, objectRef: e.objectRef,
    change: e.change, area: e.area, entityType: e.entityType ?? null, entityId: e.entityId ?? null, projectId: e.projectId ?? null,
  });
}

export interface ActivityInput {
  actorName: string;
  actorPersonId?: string | null;
  /** EN source sentence: "Submitted CR-008 for review · +85 k€ · −12 d". */
  text: string;
  kind: ActivityKind;
  projectId?: string | null;
  occurredAt?: Date;
}

/** Appends one activity-feed event (ACTIVITY shape: when, who, what, kind). */
export async function recordActivity(q: Q, e: ActivityInput): Promise<void> {
  await q.insert(activityEvents).values({
    occurredAt: e.occurredAt ?? new Date(), actorName: e.actorName, actorPersonId: e.actorPersonId ?? null, text: e.text, kind: e.kind,
    projectId: e.projectId ?? null,
  });
}

/**
 * The person behind an actor name and the roles of their user account (R-039: every role held; a demo persona holds
 * its own): writers that apply a role rule (RFQ award, purchase-order approval) check it server-side. Unknown names get
 * no person and no role.
 */
export async function actorOf(q: Q, name: string): Promise<{ personId: string | null; name: string; roles: string[] }> {
  const p = await findPerson(q, name);
  if (!p) return { personId: null, name, roles: [] };
  const roles = (await q.select({ roles: users.roles }).from(users).where(and(eq(users.personId, p.id), eq(users.active, true)))).flatMap((r) => r.roles);
  return { personId: p.id, name: nameOf(p), roles };
}

/** Display name of a person row (full name when known). */
export const nameOf = (p: { fullName: string | null; shortName: string }) => p.fullName ?? p.shortName;
