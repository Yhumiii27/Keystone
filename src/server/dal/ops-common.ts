import 'server-only';
// Shared helpers of the Delivery 5 DAL writers (quality, ITP, commissioning, site, REX, after-sales, client portal,
// engineering, P&ID, machine types, settings, integrations). Writers receive the viewer as `Actor` (persona name +
// role key) and re-check, server-side, that the screen is in the viewer's workspace (`D5_SCREEN_ROLES`); Server
// Functions additionally check the project read-only rule with `getProjectContext(code).canEdit(screen)` before calling.
import { and, eq } from 'drizzle-orm';
import { inWorkspace, type ActivityKind, type D5Screen } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { persons, projects, users } from '@/server/db/schema';
import { leadsProject } from './project-team';
import type { DB, Tx } from '@/server/db/types';

type Q = DB | Tx;

/** The viewer recording a change: full name of the persona ("Romain Aubert") and role key ("pm"). */
export interface Actor {
  name: string;
  role: string;
}

/** Refuses a write on a screen outside the viewer's workspace (the "Outside my workspace · Read-only" rule). */
export function requireWorkspace(screen: D5Screen, actor: Actor, label: string): void {
  if (!inWorkspace(screen, actor.role)) throw new Error(`${label} is outside your workspace`);
}

/** Project row needed by writers; throws on an unknown code. */
export async function projectOf(q: Q, code: string): Promise<{ id: string; code: string; pmPersonId: string | null; clientId: string | null; shortName: string | null; machineTypeCode: string | null }> {
  const [p] = await q
    .select({ id: projects.id, code: projects.code, pmPersonId: projects.pmPersonId, clientId: projects.clientId, shortName: projects.shortName, machineTypeCode: projects.machineTypeCode })
    .from(projects)
    .where(eq(projects.code, code));
  if (!p) throw new Error(`Unknown project ${code}`);
  return p;
}

/** The actor's person (when known) and display name for audit rows. */
export async function whoIs(q: Q, actor: Actor): Promise<{ personId: string | null; who: string; short: string }> {
  const p = await findPerson(q, actor.name);
  return { personId: p?.id ?? null, who: p ? nameOf(p) : actor.name, short: p?.shortName ?? actor.name };
}

/** The actor is a client contact of the project's client organisation (person or user account linked to it). */
export async function isClientContactOf(q: Q, actor: Actor, projectClientId: string | null): Promise<boolean> {
  if (actor.role !== 'client' || !projectClientId) return false;
  const p = await findPerson(q, actor.name);
  if (!p) return false;
  const [person] = await q.select({ c: persons.clientId }).from(persons).where(eq(persons.id, p.id));
  if (person?.c === projectClientId) return true;
  const [u] = await q.select({ c: users.clientId }).from(users).where(and(eq(users.personId, p.id), eq(users.clientId, projectClientId)));
  return !!u;
}

/** The actor leads the project — PM of record, co-PM or deputy (R-041, L-4b) — or is the portfolio director. */
export async function managesProject(q: Q, actor: Actor, project: { id: string }): Promise<boolean> {
  if (actor.role === 'director') return true;
  if (actor.role === 'client') return false;
  const p = await findPerson(q, actor.name);
  return !!p && leadsProject(q, project.id, p.id);
}

/** Audit row + activity event for one change by the actor (activity optional). */
export async function trace(
  q: Q, actor: { personId: string | null; who: string },
  e: { objectRef: string; change: string; area: string; entityType?: string; entityId?: string | null; projectId?: string | null; activity?: { text: string; kind: ActivityKind } },
): Promise<void> {
  await writeAudit(q, {
    actorName: actor.who, actorPersonId: actor.personId, objectRef: e.objectRef, change: e.change, area: e.area, entityType: e.entityType ?? null,
    entityId: e.entityId ?? null, projectId: e.projectId ?? null,
  });
  if (e.activity) await recordActivity(q, { actorName: actor.who, actorPersonId: actor.personId, text: e.activity.text, kind: e.activity.kind, projectId: e.projectId ?? null });
}

/** ISO 'YYYY-MM-DD' of a real calendar day. */
export const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

/** Optional ISO date input: '' / null → null; anything else must be a real date. */
export function optionalDate(v: string | null | undefined, what: string): string | null {
  if (v == null || v.trim() === '') return null;
  if (!isIsoDate(v.trim())) throw new Error(`Invalid ${what}`);
  return v.trim();
}

/** Required non-blank text input (trimmed, bounded). */
export function requiredText(v: string | null | undefined, what: string, max = 500): string {
  const t = (v ?? '').trim();
  if (!t) throw new Error(`${what} is required`);
  if (t.length > max) throw new Error(`${what} is too long`);
  return t;
}

/** Optional text input (trimmed, bounded); '' → null. */
export function optionalText(v: string | null | undefined, what: string, max = 2000): string | null {
  const t = (v ?? '').trim();
  if (t.length > max) throw new Error(`${what} is too long`);
  return t || null;
}

/** Initials as the RACI avatars show them (`initialsOf` 4633: first letter of each word, max 3). */
export const initialsOf = (name: string) => name.split(' ').map((s) => s[0] ?? '').join('').slice(0, 3);
