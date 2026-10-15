// Delivery 7 (R-039) backfill of a database seeded before migration 0007: the demo persona users get their roles
// ([persona role]), their sign-in e-mail and their person's department; the persona persons get their e-mail when they
// have none. Idempotent: only users with a persona role and no roles yet are touched.
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { PERSONA_BY_ROLE, isRole } from '@/config/personas';
import { persons, users } from '../schema';
import type { DB, Tx } from '../types';

/** Persona users still without roles (seeded before migration 0007). */
export async function demoUsersToBackfill(q: DB | Tx): Promise<number> {
  const [{ n }] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(isNotNull(users.personaRole), sql`cardinality(${users.roles}) = 0`));
  return n;
}

export async function backfillDemoUsers(tx: Tx): Promise<void> {
  const rows = await tx.select({ id: users.id, role: users.personaRole, personId: users.personId, roles: users.roles }).from(users).where(isNotNull(users.personaRole));
  for (const u of rows) {
    if (!isRole(u.role) || u.roles.length) continue;
    const persona = PERSONA_BY_ROLE[u.role];
    const [p] = await tx.select({ departmentId: persons.departmentId, email: persons.email }).from(persons).where(eq(persons.id, u.personId));
    await tx.update(users).set({ roles: [u.role], email: persona.email, departmentId: p?.departmentId ?? null }).where(eq(users.id, u.id));
    if (p && !p.email && persona.email) await tx.update(persons).set({ email: persona.email }).where(eq(persons.id, u.personId));
  }
}

// ── Delivery 8 (R-044): the Finance persona's user ─────────────────────────────────────────────────────────────────

/**
 * The demo user of the Finance persona (Léa Marchand, "Cost controller", Controls & planning — src/config/personas.ts), created
 * apart from the prototype's PERSONAS (which has no Finance persona): on a fresh demo seed after the persona users, and once on
 * a demo database seeded earlier (users.role is plain text: no migration). Idempotent: nothing happens when the persona user
 * exists, when the person is missing, or when the person already has a user (a real account signed in with Entra ID).
 * Returns the new user's id, null when nothing was created.
 */
export async function seedFinanceUser(tx: Tx): Promise<string | null> {
  const persona = PERSONA_BY_ROLE.finance;
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.personaRole, 'finance'));
  if (existing) return null;
  const [p] = await tx.select({ id: persons.id, departmentId: persons.departmentId, email: persons.email }).from(persons).where(eq(persons.fullName, persona.name));
  if (!p) return null;
  const [own] = await tx.select({ id: users.id }).from(users).where(eq(users.personId, p.id));
  if (own) return null;
  const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${users.sortOrder}), 0)::int` }).from(users);
  const [u] = await tx
    .insert(users)
    .values({ personaRole: 'finance', roles: ['finance'], personId: p.id, title: persona.title, email: persona.email, departmentId: p.departmentId, sortOrder: pos + 1 })
    .returning({ id: users.id });
  if (!p.email && persona.email) await tx.update(persons).set({ email: persona.email }).where(eq(persons.id, p.id));
  return u.id;
}

/** The Finance persona's user is missing on this (demo) database. */
export async function financeUserToBackfill(q: DB | Tx): Promise<boolean> {
  const [u] = await q.select({ id: users.id }).from(users).where(eq(users.personaRole, 'finance'));
  return !u;
}
