import 'server-only';
// Write-side helpers shared by the DAL writers (server functions call the DAL, never this file directly):
// lookups by business key, business numbering (RQ-045, T-2341, R-21, CR-011…) and the append-only audit trail
// and activity feed (docs/spec/11 §0 "Every state change also writes an AuditEntry", §3.12).
import { eq, or } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { nextBusinessNumber, type ActivityKind } from './codes';
import { activityEvents, auditEntries, persons, projects, users } from './schema';
import type { DB, Tx } from './types';

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

/** Person of the user holding a role (the "View as" persona). */
export async function personOfRole(q: Q, role: string): Promise<{ userId: string; personId: string; fullName: string | null; shortName: string } | null> {
  const [r] = await q
    .select({ userId: users.id, personId: persons.id, fullName: persons.fullName, shortName: persons.shortName })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(eq(users.role, role));
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
 * max(existing, floor) + 1. Call inside the writing transaction.
 */
export async function nextNumber(q: Q, table: PgTable, column: PgColumn, prefix: string, pad: number, floor = 0): Promise<string> {
  const rows = (await q.select({ n: column }).from(table)) as { n: string }[];
  return nextBusinessNumber(rows.map((r) => r.n), prefix, pad, floor);
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

/** Display name of a person row (full name when known). */
export const nameOf = (p: { fullName: string | null; shortName: string }) => p.fullName ?? p.shortName;
