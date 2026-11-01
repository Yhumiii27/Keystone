// R-051 (owner answer P-7d, "Suppléant déclaré par l'approbateur pour une période"): pure rules of approval delegations.
// An approver declares a substitute and a period (first and last business day, both included); while it runs, the approver's
// items of My approvals also reach the substitute, who decides them on the approver's behalf (audit and activity name the
// substitute "on behalf of" the approver), and the approver keeps them too.
// - No chaining: a substitute receives the approver's OWN items only, never the items the approver receives as a substitute.
// - Refused: oneself, a client or external user, an inactive account, an approver who is a client, an end before the start
//   or before today, a period longer than DELEGATION_MAX_DAYS, a period that overlaps another delegation of the same approver
//   (cancelled ones excepted).
// - The approver cancels their own delegations; the portfolio director sees and cancels every delegation.
// Décisions prises sans demander (docs/delivery-9/notes-r051-r064.md): the period is at most one year; a delegation may start
// in the future; the substitute cannot cancel it (they tell the approver or the director).
import type { RoleKey } from '@/config/screens';

/** Longest period of one delegation, in days (both ends included). */
export const DELEGATION_MAX_DAYS = 366;
/** Longest note / cancellation reason. */
export const DELEGATION_NOTE_MAX = 500;

export interface DelegationPeriod {
  startsOn: string;
  endsOn: string;
  cancelledAt: string | null;
}

export type DelegationState = 'upcoming' | 'active' | 'ended' | 'cancelled';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** State of a delegation on the business date `today`. */
export function delegationState(d: DelegationPeriod, today: string): DelegationState {
  if (d.cancelledAt) return 'cancelled';
  if (today < d.startsOn) return 'upcoming';
  if (today > d.endsOn) return 'ended';
  return 'active';
}

/** The delegation routes items on `today`. */
export const isDelegationActive = (d: DelegationPeriod, today: string) => delegationState(d, today) === 'active';

/** Two periods share at least one day. */
export const periodsOverlap = (a: { startsOn: string; endsOn: string }, b: { startsOn: string; endsOn: string }) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/** A user that may stand in or delegate: an active internal account (never a client or an external user). */
export interface DelegationUser {
  userId: string;
  active: boolean;
  roles: readonly RoleKey[];
  external: boolean;
}

/** Internal account: not external, not a client organisation's user, at least one non-client role. */
export const isInternalUser = (u: Pick<DelegationUser, 'roles' | 'external'>) => !u.external && u.roles.some((r) => r !== 'client');

/** EN source messages of the refusals (shown with toast showEn / t()). */
export const DELEGATION_ERRORS = {
  dates: 'Enter a valid start and end date',
  order: 'The end date is before the start date',
  past: 'The period is already over',
  long: 'A delegation lasts one year at most',
  self: 'You cannot delegate to yourself',
  external: 'The substitute must be an internal user',
  inactive: 'The substitute’s account is not active',
  approver: 'Only internal users can delegate their approvals',
  overlap: 'You already have a delegation over these dates',
} as const;

export type DelegationError = keyof typeof DELEGATION_ERRORS;

export interface NewDelegation {
  startsOn: unknown;
  endsOn: unknown;
}

/**
 * The first refusal of a new delegation, or null when it may be recorded. `existing` = the approver's other delegations (any
 * state: cancelled and ended ones never overlap).
 */
export function delegationError(
  input: NewDelegation,
  ctx: { today: string; approver: DelegationUser; substitute: DelegationUser | null; existing: readonly DelegationPeriod[] },
): DelegationError | null {
  if (!isInternalUser(ctx.approver)) return 'approver';
  if (!validIso(input.startsOn) || !validIso(input.endsOn)) return 'dates';
  const period = { startsOn: input.startsOn, endsOn: input.endsOn };
  if (period.endsOn < period.startsOn) return 'order';
  if (period.endsOn < ctx.today) return 'past';
  if (dayCount(period.startsOn, period.endsOn) > DELEGATION_MAX_DAYS) return 'long';
  if (!ctx.substitute) return 'external';
  if (ctx.substitute.userId === ctx.approver.userId) return 'self';
  if (!isInternalUser(ctx.substitute)) return 'external';
  if (!ctx.substitute.active) return 'inactive';
  if (ctx.existing.some((d) => !d.cancelledAt && d.endsOn >= ctx.today && periodsOverlap(d, period))) return 'overlap';
  return null;
}

/** Who may cancel: the approver (their own, not cancelled, not ended) or the portfolio director (any). */
export function canCancelDelegation(d: DelegationPeriod & { approverUserId: string }, viewer: { userId: string | null; role: RoleKey }, today: string): boolean {
  const state = delegationState(d, today);
  if (state === 'cancelled' || state === 'ended') return false;
  return viewer.role === 'director' || (!!viewer.userId && viewer.userId === d.approverUserId);
}

/** Identity of an inbox decision (kind fields only), to match a delegated row against the approver's own queue. */
export function decisionKey(d: unknown): string {
  if (!d || typeof d !== 'object') return '';
  const o = d as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => k !== 'fromLabel').sort();
  return JSON.stringify(keys.map((k) => [k, o[k]]));
}

// ── My approvals card (shapes the server sends to the Delegation card) ──────────────────────────────

export interface DelegationCandidate {
  userId: string;
  name: string;
  /** EN source title. */
  title: string;
}

export interface DelegationView {
  id: string;
  approverName: string;
  substituteName: string;
  /** "25 Sep 2026" (shown through t()). */
  from: string;
  to: string;
  startsOn: string;
  endsOn: string;
  state: DelegationState;
  note: string | null;
  canCancel: boolean;
}

export interface DelegationPanel {
  /** The viewer may declare a substitute (internal user with My approvals in their workspace). */
  canDeclare: boolean;
  /** The viewer's own delegations still to come or running. */
  mine: DelegationView[];
  /** The approvers the viewer stands in for today (banner). */
  standingIn: DelegationView[];
  /** The substitute's upcoming delegations (they know before it starts). */
  upcomingFor: DelegationView[];
  /** Portfolio director: every delegation still to come or running (null for anybody else). */
  all: DelegationView[] | null;
  /** Who can stand in (the viewer excepted). */
  candidates: DelegationCandidate[];
  /** Business date (the date fields' minimum). */
  today: string;
}

