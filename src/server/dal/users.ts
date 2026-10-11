import 'server-only';
// Users DAL (R-039): one account per person, linked to the Microsoft Entra ID account (object id), with several roles,
// a department and a client organisation. Sign-in (R-038) creates or refreshes the account from the token — the person
// comes from the e-mail matched to `persons`, the roles from the token — and every sign-in, refusal, sign-out and
// active-role switch is written to the audit trail (area "Sign-in"). Per-user records (notification read state,
// prioritisation weights…) are keyed by users.id through `userIdOf`, which also resolves the demo "View as" personas.
import { and, arrayOverlaps, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { RoleKey } from '@/config/screens';
import { ROLE_LABEL, SIGN_IN_REFUSAL_LABEL, decideSignIn, sortRoles, userTitle, type SignInPerson, type SignInRefusal, type SignInUser } from '@/domain/auth';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { writeAudit } from '@/server/db/helpers';
import { clients, departments, persons, users } from '@/server/db/schema';

type Q = DB | Tx;

/** A viewer (signed-in user or demo persona) or a role standing for its demo persona (tests, demo callers). */
export type UserRef = string | { role: string; userId?: string | null };

/** users.id of a viewer: its own id when signed in, else the demo user of its persona role; null when none. */
export async function userIdOf(q: Q, ref: UserRef): Promise<string | null> {
  if (typeof ref === 'object' && ref.userId) return ref.userId;
  const role = typeof ref === 'string' ? ref : ref.role;
  const [u] = await q.select({ id: users.id }).from(users).where(eq(users.personaRole, role));
  return u?.id ?? null;
}

/** A user account with its person, department and organisation (what the viewer is built from). */
export interface UserAccount {
  userId: string;
  personId: string;
  personaRole: RoleKey | null;
  roles: RoleKey[];
  active: boolean;
  entraObjectId: string | null;
  email: string | null;
  /** EN source string. */
  title: string;
  fullName: string | null;
  shortName: string;
  initials: string;
  department: string | null;
  organisation: string | null;
  lastSignInAt: string | null;
}

const userClient = alias(clients, 'user_client');
const userDept = alias(departments, 'user_dept');

const accountSelect = {
  u: users,
  fullName: persons.fullName,
  shortName: persons.shortName,
  initials: persons.initials,
  department: userDept.name,
  organisation: userClient.name,
};

function toAccount(r: { u: typeof users.$inferSelect; fullName: string | null; shortName: string; initials: string; department: string | null; organisation: string | null }): UserAccount {
  return {
    userId: r.u.id, personId: r.u.personId, personaRole: (r.u.personaRole as RoleKey | null) ?? null, roles: sortRoles(r.u.roles), active: r.u.active,
    entraObjectId: r.u.entraObjectId, email: r.u.email, title: r.u.title, fullName: r.fullName, shortName: r.shortName, initials: r.initials,
    department: r.department, organisation: r.organisation, lastSignInAt: r.u.lastSignInAt?.toISOString() ?? null,
  };
}

function accounts(q: Q) {
  return q
    .select(accountSelect)
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .leftJoin(userDept, eq(userDept.id, users.departmentId))
    .leftJoin(userClient, eq(userClient.id, users.clientId));
}

/** One user account by id (null when unknown). */
export async function getUserAccount(userId: string, q?: Q): Promise<UserAccount | null> {
  const db = q ?? (await getDb());
  const [r] = await accounts(db).where(eq(users.id, userId));
  return r ? toAccount(r) : null;
}

/** Every user account (register order: demo personas first, then by first sign-in). */
export async function listUserAccounts(): Promise<UserAccount[]> {
  const db = await getDb();
  return (await accounts(db).orderBy(asc(users.sortOrder))).map(toAccount);
}

/** Display name of a person row. */
const displayName = (p: { fullName: string | null; shortName: string }) => p.fullName ?? p.shortName;

/** "Portfolio director / Project manager" (the translator handles each segment). */
const rolesText = (roles: readonly RoleKey[]) => roles.map((r) => ROLE_LABEL[r]).join(' / ');

export interface SignInInput {
  /** Entra object id (`oid` claim). */
  oid: string;
  /** Normalised token e-mail (domain/auth emailFromClaims). */
  email: string | null;
  /** Keystone roles granted by the token (domain/auth rolesFromClaims). */
  roles: RoleKey[];
  at?: Date;
}

export type SignInResult = { ok: true; account: UserAccount; created: boolean } | { ok: false; reason: SignInRefusal };

/**
 * Signs a Microsoft account in: finds the person (already linked object id, else the e-mail matched to `persons`),
 * applies the refusal rules (domain/auth decideSignIn), then creates or refreshes the user — roles from the token,
 * department and organisation from the person, last sign-in — in one transaction, with an audit row. A refusal is
 * audited too (actor = the token e-mail).
 */
export async function signInUser(input: SignInInput): Promise<SignInResult> {
  const db = await getDb();
  const at = input.at ?? new Date();
  const roles = sortRoles(input.roles);
  const run = () =>
    db.transaction(async (tx): Promise<SignInResult> => {
      const [linked] = await tx
        .select({ userId: users.id, personId: users.personId, entraObjectId: users.entraObjectId, active: users.active, organisation: userClient.name })
        .from(users)
        .leftJoin(userClient, eq(userClient.id, users.clientId))
        .where(eq(users.entraObjectId, input.oid));
      const matched = input.email
        ? await tx
            .select({ personId: persons.id, organisation: clients.name })
            .from(persons)
            .leftJoin(clients, eq(clients.id, persons.clientId))
            .where(sql`lower(${persons.email}) = ${input.email}`)
        : [];
      let ofPerson: SignInUser | null = null;
      if (!linked && matched.length === 1) {
        const [u] = await tx
          .select({ userId: users.id, personId: users.personId, entraObjectId: users.entraObjectId, active: users.active, organisation: userClient.name })
          .from(users)
          .leftJoin(userClient, eq(userClient.id, users.clientId))
          .where(eq(users.personId, matched[0].personId));
        ofPerson = u ?? null;
      }
      const decision = decideSignIn({
        oid: input.oid, email: input.email, roles, byObjectId: linked ?? null, persons: matched as SignInPerson[], userOfPerson: ofPerson,
      });
      if (!decision.ok) {
        await writeAudit(tx, { actorName: input.email ?? `Entra ${input.oid}`, objectRef: 'Sign-in', change: `Sign-in refused · ${SIGN_IN_REFUSAL_LABEL[decision.reason]}`, area: 'Sign-in', occurredAt: at });
        return decision;
      }
      const [person] = await tx
        .select({ fullName: persons.fullName, shortName: persons.shortName, jobTitle: persons.jobTitle, departmentId: persons.departmentId, clientId: persons.clientId })
        .from(persons)
        .where(eq(persons.id, decision.personId));
      let clientId = person.clientId;
      if (!clientId && decision.userId) [{ clientId }] = await tx.select({ clientId: users.clientId }).from(users).where(eq(users.id, decision.userId));
      const values = {
        roles, entraObjectId: input.oid, ...(input.email ? { email: input.email } : {}), title: userTitle(person.jobTitle, roles, decision.organisation),
        departmentId: person.departmentId, clientId, isExternal: !!clientId || roles.includes('client'), lastSignInAt: at, updatedAt: at,
      };
      let userId = decision.userId;
      let created = false;
      if (userId) {
        await tx.update(users).set(values).where(eq(users.id, userId));
      } else {
        const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${users.sortOrder}), 0)::int` }).from(users);
        const [row] = await tx.insert(users).values({ ...values, personId: decision.personId, sortOrder: max + 1 }).returning({ id: users.id });
        userId = row.id;
        created = true;
      }
      await writeAudit(tx, {
        actorName: displayName(person), actorPersonId: decision.personId, objectRef: 'Sign-in', change: `Signed in · ${rolesText(roles)}`, area: 'Sign-in',
        entityType: 'user', entityId: userId, occurredAt: at,
      });
      return { ok: true, account: (await getUserAccount(userId, tx))!, created };
    });
  try {
    return await run();
  } catch (e) {
    // Two first sign-ins of the same person at once: the second insert hits users_person_id_unique — run again, it
    // now finds the user created by the first one (and applies the object-id check to it).
    if (isUniqueViolation(e, ['users_person_id_unique', 'users_entra_object_id_unique'])) return run();
    throw e;
  }
}

/** A unique-constraint violation on one of `constraints` (the driver error may be wrapped in Drizzle's query error). */
export function isUniqueViolation(e: unknown, constraints: string[]): boolean {
  for (let err = e as { message?: unknown; cause?: unknown; code?: unknown; constraint?: unknown } | undefined, i = 0; err && i < 5; err = err.cause as typeof err, i++) {
    if (typeof err.constraint === 'string' && constraints.includes(err.constraint)) return true;
    if (typeof err.message === 'string' && constraints.some((c) => (err!.message as string).includes(c))) return true;
  }
  return false;
}

/** Audit row of a sign-out. */
export async function recordSignOut(userId: string): Promise<void> {
  const db = await getDb();
  const a = await getUserAccount(userId, db);
  if (!a) return;
  await writeAudit(db, { actorName: displayName(a), actorPersonId: a.personId, objectRef: 'Sign-in', change: 'Signed out', area: 'Sign-in', entityType: 'user', entityId: userId });
}

/** Audit row of an active-role switch ("Active role · Project manager → Portfolio director"). */
export async function recordActiveRole(userId: string, from: RoleKey, to: RoleKey): Promise<void> {
  const db = await getDb();
  const a = await getUserAccount(userId, db);
  if (!a) return;
  await writeAudit(db, {
    actorName: displayName(a), actorPersonId: a.personId, objectRef: 'Sign-in', change: `Active role · ${ROLE_LABEL[from]} → ${ROLE_LABEL[to]}`, area: 'Sign-in',
    entityType: 'user', entityId: userId,
  });
}

/** Active user accounts holding at least one of `roles` (notification audiences). */
export async function userIdsWithRoles(q: Q, roles: readonly string[]): Promise<{ id: string; roles: string[] }[]> {
  if (!roles.length) return [];
  return q.select({ id: users.id, roles: users.roles }).from(users).where(and(eq(users.active, true), arrayOverlaps(users.roles, [...roles])));
}

/** Active user accounts of the given persons. */
export async function userIdsOfPersons(q: Q, personIds: readonly string[]): Promise<{ id: string; personId: string; roles: string[] }[]> {
  if (!personIds.length) return [];
  return q.select({ id: users.id, personId: users.personId, roles: users.roles }).from(users).where(and(eq(users.active, true), inArray(users.personId, [...personIds])));
}
