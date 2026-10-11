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
