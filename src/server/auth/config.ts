// Authentication configuration (R-038, DELIVERY-7-PLAN §1). Read from the environment at call time (no module state),
// so the proxy, the auth routes and the tests see the same values. No `server-only` import: the proxy uses this file.
//
//   KEYSTONE_AUTH                 demo (default) | entra
//   KEYSTONE_SESSION_SECRET       ≥ 32 characters; encrypts the session and sign-in cookies (entra)
//   KEYSTONE_SESSION_HOURS        session lifetime in hours (default 12, 1–168)
//   ENTRA_TENANT_ID               directory (tenant) id — a GUID; or ENTRA_ISSUER for another authority
//   ENTRA_ISSUER                  optional; default https://login.microsoftonline.com/<tenant>/v2.0
//   ENTRA_CLIENT_ID               application (client) id of the Keystone app registration
//   ENTRA_CLIENT_SECRET           its client secret
//   ENTRA_REDIRECT_URI            https://<host>/api/auth/callback (registered as a Web redirect URI)
//   ENTRA_POST_LOGOUT_REDIRECT_URI optional; default <origin of the redirect URI>/sign-in?signedOut=1
//   ENTRA_GROUP_ROLES             optional JSON { "<group object id>": "pm" | ["pm", "englead"] }
import { AuthConfigError, parseGroupRoleMap, type GroupRoleMap } from '@/domain/auth';

export { AuthConfigError };

export type AuthMode = 'demo' | 'entra';

type Env = Record<string, string | undefined>;

const env = (): Env => process.env;

/**
 * `demo` keeps the "View as" persona cookie exactly as before (development, tests, demonstrations); `entra` requires a
 * Microsoft Entra ID session. Any other value is a configuration error (fail closed rather than fall back to demo).
 */
export function authMode(e: Env = env()): AuthMode {
  const v = (e.KEYSTONE_AUTH ?? '').trim().toLowerCase();
  if (!v || v === 'demo') return 'demo';
  if (v === 'entra') return 'entra';
  throw new AuthConfigError(`KEYSTONE_AUTH must be "demo" or "entra" (got "${e.KEYSTONE_AUTH}")`);
}

export const isEntraMode = (e: Env = env()) => authMode(e) === 'entra';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MIN_SECRET_LENGTH = 32;
const DEFAULT_SESSION_HOURS = 12;

export interface SessionConfig {
  secret: string;
  /** Seconds. */
  maxAge: number;
  /** Cookies are Secure (https deployments); then the session cookie takes the `__Host-` prefix. */
  secure: boolean;
  /** Session cookie name: `__Host-ks-session` over https, `ks-session` on http://localhost. */
  cookieName: string;
  /** Short-lived sign-in transaction cookie (state, nonce, PKCE verifier, return path). */
  txCookieName: string;
}

export interface EntraConfig {
  issuer: string;
  /** Tenant GUID when known (checked against the token `tid`). */
  tenantId: string | null;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  groupRoles: GroupRoleMap;
  session: SessionConfig;
}

function httpsOrLocal(name: string, value: string): URL {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new AuthConfigError(`${name} is not a valid URL`);
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new AuthConfigError(`${name} must use https (http only for localhost)`);
  return u;
}

/** Session cookie settings (needed by the proxy on every request; cheap). */
export function sessionConfig(e: Env = env()): SessionConfig {
  const secret = e.KEYSTONE_SESSION_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) throw new AuthConfigError(`KEYSTONE_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  const hours = e.KEYSTONE_SESSION_HOURS ? Number(e.KEYSTONE_SESSION_HOURS) : DEFAULT_SESSION_HOURS;
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new AuthConfigError('KEYSTONE_SESSION_HOURS must be between 1 and 168');
  const redirect = e.ENTRA_REDIRECT_URI ? httpsOrLocal('ENTRA_REDIRECT_URI', e.ENTRA_REDIRECT_URI) : null;
  const secure = !redirect || redirect.protocol === 'https:';
  return {
    secret,
    maxAge: Math.round(hours * 3600),
    secure,
    cookieName: secure ? '__Host-ks-session' : 'ks-session',
    txCookieName: secure ? '__Host-ks-signin' : 'ks-signin',
  };
}

/** Full Entra ID configuration; throws AuthConfigError naming the first missing or invalid variable. */
export function entraConfig(e: Env = env()): EntraConfig {
  const need = (k: string) => {
    const v = e[k]?.trim();
    if (!v) throw new AuthConfigError(`${k} is required when KEYSTONE_AUTH=entra`);
    return v;
  };
  const tenant = e.ENTRA_TENANT_ID?.trim() || null;
  if (tenant && !GUID_RE.test(tenant)) throw new AuthConfigError('ENTRA_TENANT_ID must be the directory (tenant) id, a GUID');
  let issuer = e.ENTRA_ISSUER?.trim() || null;
  if (!issuer) {
    if (!tenant) throw new AuthConfigError('ENTRA_TENANT_ID (or ENTRA_ISSUER) is required when KEYSTONE_AUTH=entra');
    issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  }
  httpsOrLocal('ENTRA_ISSUER', issuer);
  const redirectUri = need('ENTRA_REDIRECT_URI');
  const redirect = httpsOrLocal('ENTRA_REDIRECT_URI', redirectUri);
  const postLogout = e.ENTRA_POST_LOGOUT_REDIRECT_URI?.trim() || `${redirect.origin}/sign-in?signedOut=1`;
  httpsOrLocal('ENTRA_POST_LOGOUT_REDIRECT_URI', postLogout);
  return {
    issuer: issuer.replace(/\/+$/, ''),
    tenantId: tenant ? tenant.toLowerCase() : null,
    clientId: need('ENTRA_CLIENT_ID'),
    clientSecret: need('ENTRA_CLIENT_SECRET'),
    redirectUri,
    postLogoutRedirectUri: postLogout,
    groupRoles: parseGroupRoleMap(e.ENTRA_GROUP_ROLES),
    session: sessionConfig(e),
  };
}
