import 'server-only';
// Bell notifications addressed to persons (X-6a; delivery 8 defaults, docs/DELIVERY-8-PLAN.md §2 "Notification channel"):
// Keystone's bell, and the e-mail each person chose (R-036, X-6b: createNotification), sent AFTER the writer's transaction commits (createNotification opens its own
// transaction; R-010 transactions may run twice), to the active user accounts of the persons named, never to the actor.
// Clients are left to the bell's read-time filter (dal/shell.ts notificationsFor). Titles are fixed English templates
// (translated by t() in the bell); typed text stays in the sub-line (fieldsText, R-148). A failure is the caller's to log
// (logError) and never undoes the write that caused it.
import { and, arrayOverlaps, eq, inArray, or } from 'drizzle-orm';
import { LEAD_TEAM_ROLES } from '@/domain/rights';
import type { NotificationKind } from '@/server/db/codes';
import { getDb } from '@/server/db/client';
import { persons, projectMembers, projects, users } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { createNotification } from './notifications';

type Q = DB | Tx;

/** The person behind an actor: the signed-in user's person, else the person of that name (demo personas). */
export async function actorPersonIdOf(q: Q, actor: { name: string; short?: string | null; personId?: string | null }): Promise<string | null> {
  if (actor.personId) return actor.personId;
  const [p] = await q.select({ id: persons.id }).from(persons).where(or(eq(persons.fullName, actor.name), eq(persons.shortName, actor.short ?? actor.name)));
  return p?.id ?? null;
}

/** Persons that have an active user account (only they can be notified). */
export async function activePersonIds(q: Q): Promise<Set<string>> {
  const rows = await q.select({ p: users.personId }).from(users).where(eq(users.active, true));
  return new Set(rows.map((r) => r.p));
}

/** Persons whose active user account holds one of the roles (procurement users, directors…). */
export async function personIdsWithRoles(q: Q, roles: readonly string[]): Promise<string[]> {
  if (!roles.length) return [];
  const rows = await q.select({ p: users.personId }).from(users).where(and(eq(users.active, true), arrayOverlaps(users.roles, [...roles])));
  return [...new Set(rows.map((r) => r.p))];
}

/** The project's leads (R-041): the PM of record, co-PMs and deputies of its named team. */
export async function projectLeadIds(q: Q, projectCode: string): Promise<string[]> {
  const [p] = await q.select({ id: projects.id, pm: projects.pmPersonId }).from(projects).where(eq(projects.code, projectCode));
  if (!p) return [];
  const team = await q.select({ id: projectMembers.personId }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, p.id), inArray(projectMembers.projectRole, [...LEAD_TEAM_ROLES])));
  return [...new Set([...(p.pm ? [p.pm] : []), ...team.map((t) => t.id)])];
}

/** The project's referents (team role "referent") whose active user account holds one of the roles (quality, englead…). */
export async function projectReferentIds(q: Q, projectCode: string, roles: readonly string[]): Promise<string[]> {
  if (!roles.length) return [];
  const rows = await q
    .select({ id: projectMembers.personId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(users, eq(users.personId, projectMembers.personId))
    .where(and(eq(projects.code, projectCode), eq(projectMembers.projectRole, 'referent'), eq(users.active, true), arrayOverlaps(users.roles, [...roles])));
  return [...new Set(rows.map((r) => r.id))];
}

export interface PersonNotice {
  kind: NotificationKind;
  /** Fixed EN template (no typed text: the bell translates it with t()). */
  title: string;
  /** Fields joined with " · " (typed text shown as typed, fieldsText). */
  sub: string;
  screen: string;
  params?: Record<string, unknown>;
  projectCode?: string | null;
}

/**
 * One bell notification to the active user accounts of `personIds`, the actor removed. Returns the recipients actually
 * addressed (empty: nothing sent). Call it after the write has committed.
 */
export async function notifyPersonIds(notice: PersonNotice, personIds: readonly string[], actorPersonId: string | null): Promise<string[]> {
  const db = await getDb();
  const ids = [...new Set(personIds)].filter((id) => id && id !== actorPersonId);
  if (!ids.length) return [];
  const accounts = await db.select({ p: users.personId, roles: users.roles }).from(users).where(and(eq(users.active, true), inArray(users.personId, ids)));
  if (!accounts.length) return [];
  const to = [...new Set(accounts.map((a) => a.p))];
  await createNotification({ ...notice, params: notice.params ?? {}, audience: [...new Set(accounts.flatMap((a) => a.roles))], toPersonIds: to });
  return to;
}
