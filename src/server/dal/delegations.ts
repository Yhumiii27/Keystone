import 'server-only';
// R-051 (owner answer P-7d): approval delegations — an approver declares a substitute for a period (rules: src/domain/
// delegations.ts). Reads for My approvals (the approver's own delegations, the delegations the viewer stands in for, every
// delegation for the portfolio director), the writers (declare, cancel — audited, in the activity feed, the substitute notified
// on the bell after the commit), and the approver's viewer a delegated decision runs as (src/server/delegation-scope.ts).
import { and, asc, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PERSONA_BY_ROLE, type Persona } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { sortRoles } from '@/domain/auth';
import {
  DELEGATION_NOTE_MAX, canCancelDelegation, type DelegationCandidate, type DelegationPanel, type DelegationView, delegationError, delegationState, isDelegationActive, isInternalUser, type DelegationError, type DelegationState,
  type DelegationUser,
} from '@/domain/delegations';
import { authMode } from '@/server/auth/config';
import { viewerOfAccount } from '@/server/auth/viewer';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { displayOfIso } from '@/server/db/codes';
import { recordActivity, writeAudit } from '@/server/db/helpers';
import { approvalDelegations, persons, users } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import { logError } from '@/server/log';
import { notifyPersonIds, type PersonNotice } from './person-notices';
import { getUserAccount, userIdOf } from './users';

type Q = DB | Tx;

export interface DelegationRow {
  id: string;
  approverUserId: string;
  approverName: string;
  substituteUserId: string;
  substituteName: string;
  startsOn: string;
  endsOn: string;
  note: string | null;
  createdByName: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  state: DelegationState;
}

const approverUser = alias(users, 'approver_user');
const substituteUser = alias(users, 'substitute_user');
const approverPerson = alias(persons, 'approver_person');
const substitutePerson = alias(persons, 'substitute_person');

async function select(q: Q, where: SQL | undefined, today: string): Promise<DelegationRow[]> {
  const rows = await q
    .select({
      d: approvalDelegations,
      approverName: approverPerson.fullName, approverShort: approverPerson.shortName,
      substituteName: substitutePerson.fullName, substituteShort: substitutePerson.shortName,
    })
    .from(approvalDelegations)
    .innerJoin(approverUser, eq(approverUser.id, approvalDelegations.approverUserId))
    .innerJoin(approverPerson, eq(approverPerson.id, approverUser.personId))
    .innerJoin(substituteUser, eq(substituteUser.id, approvalDelegations.substituteUserId))
    .innerJoin(substitutePerson, eq(substitutePerson.id, substituteUser.personId))
    .where(where)
    .orderBy(desc(approvalDelegations.startsOn), asc(approvalDelegations.createdAt));
  return rows.map(({ d, ...n }) => {
    const cancelledAt = d.cancelledAt?.toISOString() ?? null;
    return {
      id: d.id, approverUserId: d.approverUserId, approverName: n.approverName ?? n.approverShort, substituteUserId: d.substituteUserId,
      substituteName: n.substituteName ?? n.substituteShort, startsOn: d.startsOn, endsOn: d.endsOn, note: d.note, createdByName: d.createdByName,
      cancelledAt, cancelledByName: d.cancelledByName, cancelReason: d.cancelReason, state: delegationState({ ...d, cancelledAt }, today),
    };
  });
}

/** Delegations declared by `userId` or naming them as substitute (newest period first). */
export async function listDelegationsOf(userId: string, today: string): Promise<DelegationRow[]> {
  const db = await getDb();
  return select(db, or(eq(approvalDelegations.approverUserId, userId), eq(approvalDelegations.substituteUserId, userId)), today);
}

/** Every delegation (portfolio director). */
export async function listAllDelegations(today: string): Promise<DelegationRow[]> {
  return select(await getDb(), undefined, today);
}

/** The delegations `substituteUserId` stands in for on `today` (the approvers whose items reach them). */
export async function activeDelegationsTo(substituteUserId: string, today: string): Promise<DelegationRow[]> {
  const db = await getDb();
  const rows = await select(db, and(eq(approvalDelegations.substituteUserId, substituteUserId), isNull(approvalDelegations.cancelledAt)), today);
  return rows.filter((d) => isDelegationActive(d, today));
}

/** One delegation (null when unknown). */
export async function getDelegation(id: string, today: string): Promise<DelegationRow | null> {
  const [d] = await select(await getDb(), eq(approvalDelegations.id, id), today);
  return d ?? null;
}

/** Who can stand in: active internal accounts (never a client or an external user), the viewer excepted, in register order. */
export async function delegationCandidates(exceptUserId: string | null): Promise<DelegationCandidate[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: users.id, roles: users.roles, external: users.isExternal, clientId: users.clientId, title: users.title, fullName: persons.fullName, shortName: persons.shortName })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(eq(users.active, true))
    .orderBy(asc(users.sortOrder));
  return rows
    .filter((r) => r.id !== exceptUserId && !r.clientId && isInternalUser({ roles: sortRoles(r.roles), external: r.external }))
    .map((r) => ({ userId: r.id, name: r.fullName ?? r.shortName, title: r.title }));
}

async function delegationUser(q: Q, userId: string): Promise<(DelegationUser & { personId: string; name: string }) | null> {
  const [u] = await q
    .select({ id: users.id, active: users.active, roles: users.roles, external: users.isExternal, clientId: users.clientId, personId: users.personId, fullName: persons.fullName, shortName: persons.shortName })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(eq(users.id, userId));
  if (!u) return null;
  return { userId: u.id, active: u.active, roles: sortRoles(u.roles), external: u.external || !!u.clientId, personId: u.personId, name: u.fullName ?? u.shortName };
}

/** The account a viewer acts with (signed-in user, or the demo user of the persona). */
export async function viewerUserId(viewer: Persona): Promise<string | null> {
  return userIdOf(await getDb(), viewer);
}

/**
 * The viewer a delegated decision runs as: the demo persona of a demo user (KEYSTONE_AUTH=demo), else the user's account in
 * their first (highest) role. Null when the account is unknown or inactive.
 */
export async function approverViewerOf(userId: string): Promise<Persona | null> {
  const a = await getUserAccount(userId);
  if (!a || !a.active) return null;
  if (authMode() !== 'entra' && a.personaRole && a.personaRole in PERSONA_BY_ROLE) return PERSONA_BY_ROLE[a.personaRole as RoleKey];
  const role = a.roles[0];
  return role ? viewerOfAccount(a, role) : null;
}

export class DelegationRefused extends Error {
  constructor(readonly code: DelegationError | 'unknown' | 'not_allowed') {
    super(code);
  }
}

/** A courtesy after the commit: a failure is logged, never undoes the write. */
async function notifySafely(notice: PersonNotice, personIds: string[], actorPersonId: string | null): Promise<void> {
  try {
    await notifyPersonIds(notice, personIds, actorPersonId);
  } catch (e) {
    logError('Delegation notification', e);
  }
}

const clean = (s: string | null | undefined) => (s ?? '').trim().slice(0, DELEGATION_NOTE_MAX) || null;

/**
 * Declares a delegation of `approverUserId`'s approvals to `substituteUserId` (rules: `delegationError`, checked inside the
 * transaction against the approver's other delegations). Audited ("My approvals"), in the activity feed; the substitute is
 * notified after the commit. Throws DelegationRefused.
 */
export async function createDelegation(
  input: { approverUserId: string; substituteUserId: string; startsOn: string; endsOn: string; note?: string | null },
  actorName: string,
): Promise<string> {
  const db = await getDb();
  const out = await db.transaction(async (tx) => {
    const today = await businessToday(tx);
    const [approver, substitute] = await Promise.all([delegationUser(tx, input.approverUserId), delegationUser(tx, input.substituteUserId)]);
    if (!approver) throw new DelegationRefused('approver');
    const existing = await tx.select({ startsOn: approvalDelegations.startsOn, endsOn: approvalDelegations.endsOn, cancelledAt: approvalDelegations.cancelledAt })
      .from(approvalDelegations).where(eq(approvalDelegations.approverUserId, approver.userId));
    const error = delegationError(input, {
      today, approver, substitute, existing: existing.map((e) => ({ ...e, cancelledAt: e.cancelledAt?.toISOString() ?? null })),
    });
    if (error) throw new DelegationRefused(error);
    const note = clean(input.note);
    const [row] = await tx.insert(approvalDelegations).values({
      approverUserId: approver.userId, substituteUserId: substitute!.userId, startsOn: input.startsOn, endsOn: input.endsOn, note, createdByName: actorName,
    }).returning({ id: approvalDelegations.id });
    const period = `${input.startsOn} → ${input.endsOn}`;
    await writeAudit(tx, {
      actorName, objectRef: `Delegation ${approver.name} → ${substitute!.name}`, area: 'My approvals', entityType: 'approval_delegations', entityId: row.id,
      change: `delegation: ${period}`, after: { approver: approver.name, substitute: substitute!.name, startsOn: input.startsOn, endsOn: input.endsOn, note },
    });
    await recordActivity(tx, { actorName, kind: 'change', text: `Delegated approvals to ${substitute!.name} · ${period}` });
    return { id: row.id, substitutePersonId: substitute!.personId, approver, period };
  });
  await notifySafely(
    { kind: 'approval', title: 'You stand in for an approver', sub: `${out.approver.name} · ${out.period}`, screen: 'myapprovals' },
    [out.substitutePersonId], out.approver.personId,
  );
  return out.id;
}

/**
 * Cancels a delegation (the approver: their own; the portfolio director: any — `canCancelDelegation`), with an optional reason.
 * Audited, in the activity feed; the substitute (and the approver, when the director cancels) notified. Throws DelegationRefused.
 */
export async function cancelDelegation(id: string, actor: { name: string; userId: string | null; role: RoleKey }, reason?: string | null): Promise<void> {
  const db = await getDb();
  const out = await db.transaction(async (tx) => {
    const today = await businessToday(tx);
    const [d] = await select(tx, eq(approvalDelegations.id, id), today);
    if (!d) throw new DelegationRefused('unknown');
    if (!canCancelDelegation(d, actor, today)) throw new DelegationRefused('not_allowed');
    const why = clean(reason);
    await tx.update(approvalDelegations).set({ cancelledAt: new Date(), cancelledByName: actor.name, cancelReason: why }).where(and(eq(approvalDelegations.id, id), isNull(approvalDelegations.cancelledAt)));
    await writeAudit(tx, {
      actorName: actor.name, objectRef: `Delegation ${d.approverName} → ${d.substituteName}`, area: 'My approvals', entityType: 'approval_delegations', entityId: id,
      change: 'delegation: cancelled', before: { startsOn: d.startsOn, endsOn: d.endsOn }, reason: why,
    });
    await recordActivity(tx, { actorName: actor.name, kind: 'change', text: `Cancelled the delegation of ${d.approverName} to ${d.substituteName}` });
    const people = await tx.select({ id: users.id, personId: users.personId }).from(users).where(inArray(users.id, [d.approverUserId, d.substituteUserId]));
    return { d, people };
  });
  const actorPerson = out.people.find((p) => p.id === actor.userId)?.personId ?? null;
  await notifySafely(
    { kind: 'approval', title: 'Delegation cancelled', sub: `${out.d.approverName} → ${out.d.substituteName} · ${out.d.startsOn} → ${out.d.endsOn}`, screen: 'myapprovals' },
    out.people.map((p) => p.personId), actorPerson,
  );
}

// ── My approvals panel ────────────────────────────────────────────────────────────────────────────────

/** What the Delegation card of My approvals shows the viewer (`canEdit`: My approvals in their workspace). */
export async function getDelegationPanel(viewer: Persona, canEdit: boolean): Promise<DelegationPanel> {
  const today = await businessToday();
  const userId = viewer.role === 'client' ? null : await viewerUserId(viewer);
  const empty: DelegationPanel = { canDeclare: false, mine: [], standingIn: [], upcomingFor: [], all: null, candidates: [], today };
  if (!userId) return empty;
  const live = (d: DelegationRow) => d.state === 'active' || d.state === 'upcoming';
  const view = (d: DelegationRow): DelegationView => ({
    id: d.id, approverName: d.approverName, substituteName: d.substituteName, from: displayOfIso(d.startsOn), to: displayOfIso(d.endsOn), startsOn: d.startsOn,
    endsOn: d.endsOn, state: d.state, note: d.note, canCancel: canEdit && canCancelDelegation(d, { userId, role: viewer.role }, today),
  });
  const [rows, all, candidates] = await Promise.all([
    listDelegationsOf(userId, today),
    viewer.role === 'director' ? listAllDelegations(today) : Promise.resolve(null),
    canEdit ? delegationCandidates(userId) : Promise.resolve([]),
  ]);
  return {
    canDeclare: canEdit,
    mine: rows.filter((d) => d.approverUserId === userId && live(d)).map(view),
    standingIn: rows.filter((d) => d.substituteUserId === userId && d.state === 'active').map(view),
    upcomingFor: rows.filter((d) => d.substituteUserId === userId && d.state === 'upcoming').map(view),
    all: all ? all.filter(live).map(view) : null,
    candidates,
    today,
  };
}
