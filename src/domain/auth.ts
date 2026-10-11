// Sign-in rules (R-038 Microsoft Entra ID, R-039 real users) — pure, shared by the proxy, the auth routes and the DAL.
// Decisions: I-2a (Entra ID for every EPC2i application), I-2b (no client access at launch: IT simply opens no client
// account), DELIVERY-7-PLAN §1 (roles come from Entra ID — app roles in the token, or group ids mapped by IT in
// configuration —, the person from the token e-mail matched to `persons`; no user-administration screen, D-7a).
import type { RoleKey } from '@/config/screens';

/**
 * Keystone roles from the broadest workspace to the narrowest. A user holding several roles starts in the first one
 * they hold (the "highest") and may switch to another in the account menu.
 */
export const ROLE_PRIORITY: readonly RoleKey[] = ['director', 'pm', 'depthead', 'englead', 'quality', 'procurement', 'member', 'client'];

/** Role names shown in the account menu (EN source strings, translated through t()). */
export const ROLE_LABEL: Record<RoleKey, string> = {
  director: 'Portfolio director',
  pm: 'Project manager',
  depthead: 'Head of department',
  member: 'Team member',
  englead: 'Engineering lead',
  quality: 'Quality manager',
  procurement: 'Procurement & stock',
  client: 'Client',
};

export const isRoleKey = (v: unknown): v is RoleKey => typeof v === 'string' && (ROLE_PRIORITY as readonly string[]).includes(v);

/** Distinct known roles in priority order (unknown values dropped). */
export function sortRoles(roles: Iterable<unknown>): RoleKey[] {
  const held = new Set<string>();
  for (const r of roles) if (isRoleKey(r)) held.add(r);
  return ROLE_PRIORITY.filter((r) => held.has(r));
}

/** Active role: `preferred` when the user holds it, else the highest role held; null when the user holds none. */
export function activeRoleOf(roles: readonly string[], preferred?: string | null): RoleKey | null {
  const held = sortRoles(roles);
  if (preferred && isRoleKey(preferred) && held.includes(preferred)) return preferred;
  return held[0] ?? null;
}

/**
 * An Entra app-role value → Keystone role. IT may name the app roles after the role keys (`pm`) or prefix them with the
 * application (`Keystone.PM`); the match ignores case. Unknown values → null.
 */
export function roleOfAppRole(value: unknown): RoleKey | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/^keystone[._:-]/, '');
  return isRoleKey(v) ? v : null;
}

/** Group object id (lower case) → the Keystone roles it grants. */
export type GroupRoleMap = Record<string, RoleKey[]>;

export class AuthConfigError extends Error {}

/**
 * Parses ENTRA_GROUP_ROLES: a JSON object `{ "<group object id>": "pm" | ["pm", "englead"] }`. Empty → no mapping.
 * A malformed value throws (fail closed: a typo must not silently grant or drop roles).
 */
export function parseGroupRoleMap(json: string | undefined | null): GroupRoleMap {
  if (!json || !json.trim()) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new AuthConfigError('ENTRA_GROUP_ROLES is not valid JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AuthConfigError('ENTRA_GROUP_ROLES must be a JSON object { groupId: role }');
  const out: GroupRoleMap = {};
  for (const [group, value] of Object.entries(raw as Record<string, unknown>)) {
    const values = Array.isArray(value) ? value : [value];
    const roles = values.map(roleOfAppRole);
    if (!group.trim() || !values.length || roles.some((r) => r === null)) throw new AuthConfigError(`ENTRA_GROUP_ROLES: invalid role for group ${group}`);
    out[group.trim().toLowerCase()] = sortRoles(roles);
  }
  return out;
}

/** The claims Keystone reads from an Entra ID token (v2.0 ID token). */
export interface IdentityClaims {
  /** Entra object id of the user — the stable link to the Microsoft account. */
  oid?: unknown;
  sub?: unknown;
  tid?: unknown;
  email?: unknown;
  preferred_username?: unknown;
  upn?: unknown;
  name?: unknown;
  /** App roles assigned to the user (or their groups) on the Keystone enterprise application. */
  roles?: unknown;
  /** Group object ids (when the app registration emits group claims). */
  groups?: unknown;
  /** Optional claim "email domain owner verified": false when the `email` claim is not verified by its domain owner. */
  xms_edov?: unknown;
}

/** Keystone roles granted by a token: its app roles plus the roles of its mapped groups. Unknown values are ignored. */
export function rolesFromClaims(claims: IdentityClaims, groupMap: GroupRoleMap = {}): RoleKey[] {
  const out: RoleKey[] = [];
  if (Array.isArray(claims.roles)) for (const r of claims.roles) {
    const k = roleOfAppRole(r);
    if (k) out.push(k);
  }
  if (Array.isArray(claims.groups)) for (const g of claims.groups) if (typeof g === 'string') out.push(...(groupMap[g.trim().toLowerCase()] ?? []));
  return sortRoles(out);
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** A normalised e-mail address (trimmed, lower case) or null when the value is not shaped like one. */
export function normaliseEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

/**
 * The e-mail that identifies the person: `email`, else `preferred_username`, else `upn` (Entra UPNs are addresses). An
 * `email` the token marks as unverified (`xms_edov: false`) is not used. Only tokens of the EPC2i tenant reach this
 * (issuer and tenant are checked), and the person is then bound to the Microsoft object id, not to the e-mail.
 */
export function emailFromClaims(claims: IdentityClaims): string | null {
  const email = claims.xms_edov === false || claims.xms_edov === 'false' ? null : normaliseEmail(claims.email);
  return email ?? normaliseEmail(claims.preferred_username) ?? normaliseEmail(claims.upn);
}

/** Why a sign-in is refused (the code is shown on the sign-in page through SIGN_IN_ERROR). */
export type SignInRefusal =
  | 'no_email' // the token carries no usable e-mail
  | 'unknown_user' // no person has this e-mail
  | 'ambiguous_user' // several persons share it
  | 'no_role' // the token grants no Keystone role
  | 'inactive' // the user account is deactivated
  | 'no_organisation' // a client user whose person belongs to no client organisation
  | 'account_mismatch'; // the person is already linked to another Microsoft account

/** Refusal reasons as written in the audit trail ("Sign-in refused · Unknown e-mail", EN source strings). */
export const SIGN_IN_REFUSAL_LABEL: Record<SignInRefusal, string> = {
  no_email: 'No e-mail in the token',
  unknown_user: 'Unknown e-mail',
  ambiguous_user: 'E-mail shared by several people',
  no_role: 'No Keystone role',
  inactive: 'Account deactivated',
  no_organisation: 'No client organisation',
  account_mismatch: 'Linked to another Microsoft account',
};

/** Errors of the sign-in flow that are not identity refusals. */
export type SignInFailure = 'expired' | 'state' | 'provider' | 'token' | 'config' | 'session' | 'failed';

export type SignInError = SignInRefusal | SignInFailure;

/** Sign-in page message per error code (EN source strings). */
export const SIGN_IN_ERROR: Record<SignInError, string> = {
  no_email: 'Your Microsoft account did not provide an e-mail address.',
  unknown_user: 'Your e-mail address is not registered in Keystone. Ask IT to add you to the staff directory.',
  ambiguous_user: 'Several people share your e-mail address in Keystone. Ask IT to correct the staff directory.',
  no_role: 'No Keystone role is assigned to your account. Ask IT to assign you a role.',
  inactive: 'Your Keystone account is deactivated.',
  no_organisation: 'Your client account is not attached to any organisation.',
  account_mismatch: 'This person is already linked to another Microsoft account.',
  expired: 'The sign-in took too long. Please try again.',
  state: 'The sign-in could not be verified. Please try again.',
  provider: 'Microsoft sign-in was cancelled or refused.',
  token: 'The Microsoft sign-in response could not be verified.',
  config: 'Sign-in is not configured. Contact IT.',
  session: 'Your session has ended. Please sign in again.',
  failed: 'The sign-in failed. Please try again.',
};

export const isSignInError = (v: unknown): v is SignInError => typeof v === 'string' && Object.hasOwn(SIGN_IN_ERROR, v);

/** The person a token e-mail designates, as the sign-in sees it. */
export interface SignInPerson {
  personId: string;
  /** Client organisation name of the person (external contacts), null for EPC2i staff. */
  organisation: string | null;
}

/** The user row already linked to the person or to the Microsoft account, if any. */
export interface SignInUser {
  userId: string;
  personId: string;
  entraObjectId: string | null;
  active: boolean;
  organisation: string | null;
}

export type SignInDecision =
  | { ok: true; personId: string; userId: string | null; roles: RoleKey[]; organisation: string | null }
  | { ok: false; reason: SignInRefusal };

/**
 * Who signs in. `byObjectId` = the user already linked to this Microsoft account (stable even when the e-mail changes);
 * otherwise the person matched by e-mail (`persons`) and their user row if any. Roles come from the token only.
 */
export function decideSignIn(input: {
  oid: string;
  email: string | null;
  roles: RoleKey[];
  byObjectId: SignInUser | null;
  persons: SignInPerson[];
  userOfPerson: SignInUser | null;
}): SignInDecision {
  const { byObjectId, roles } = input;
  let personId: string;
  let user: SignInUser | null;
  let organisation: string | null;
  if (byObjectId) {
    personId = byObjectId.personId;
    user = byObjectId;
    organisation = byObjectId.organisation;
  } else {
    if (!input.email) return { ok: false, reason: 'no_email' };
    if (!input.persons.length) return { ok: false, reason: 'unknown_user' };
    if (input.persons.length > 1) return { ok: false, reason: 'ambiguous_user' };
    personId = input.persons[0].personId;
    user = input.userOfPerson;
    if (user && user.entraObjectId && user.entraObjectId !== input.oid) return { ok: false, reason: 'account_mismatch' };
    organisation = input.persons[0].organisation ?? user?.organisation ?? null;
  }
  if (user && !user.active) return { ok: false, reason: 'inactive' };
  if (!roles.length) return { ok: false, reason: 'no_role' };
  if (roles.includes('client') && !organisation) return { ok: false, reason: 'no_organisation' };
  return { ok: true, personId, userId: user?.userId ?? null, roles, organisation };
}

/**
 * Title under the user's name (EN source string): a client user reads "Client — <organisation>" (as the prototype's
 * client persona), staff their job title, else the name of their highest role.
 */
export function userTitle(jobTitle: string | null | undefined, roles: readonly RoleKey[], organisation: string | null): string {
  const top = sortRoles(roles)[0];
  if (top === 'client' && organisation) return `Client — ${organisation}`;
  if (jobTitle && jobTitle.trim()) return jobTitle.trim();
  return top ? ROLE_LABEL[top] : 'Team member';
}

/** Where to land after sign-in: a same-origin absolute path only (no scheme, no "//host", no control characters). */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '/';
  if (raw === '/sign-in' || raw.startsWith('/sign-in?') || raw.startsWith('/api/auth/')) return '/';
  return raw;
}

/** Refusal of "View as" outside the demo mode, and of the role switch outside the Entra mode (EN source strings). */
export const VIEW_AS_REFUSED = 'View as is only available in demo mode';
export const ROLE_SWITCH_REFUSED = 'You do not hold this role';
export const ROLE_SWITCH_DEMO = 'Use View as to change persona in demo mode';

/** Sign-in routes and page. */
export const AUTH_PATHS = {
  signIn: '/api/auth/sign-in',
  callback: '/api/auth/callback',
  signOut: '/api/auth/sign-out',
  page: '/sign-in',
} as const;

/** Health probe(s), reachable without a session (load balancer, monitoring). */
export const HEALTH_PATHS = ['/api/health'] as const;

const STATIC_FILE_RE = /\.(?:ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|css|js|map|txt|webmanifest)$/i;

/**
 * Paths served without a session in Entra mode: the sign-in page and routes, health probes, Next's build assets and
 * static files of /public. Everything else needs a session (the proxy redirects, getViewer() re-checks).
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === AUTH_PATHS.page || pathname.startsWith('/api/auth/')) return true;
  if (HEALTH_PATHS.some((h) => pathname === h || pathname.startsWith(h + '/'))) return true;
  if (pathname.startsWith('/_next/')) return true;
  // Static files: a single path segment with a file extension (public/ is flat: favicon.ico, *.svg).
  return /^\/[^/]+$/.test(pathname) && STATIC_FILE_RE.test(pathname);
}
