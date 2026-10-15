import 'server-only';
// OpenID Connect authorization-code flow with PKCE against Microsoft Entra ID (R-038, I-2a), on fetch + WebCrypto
// (no third-party library): discovery (OpenID Connect Discovery 1.0), the authorization request (code, S256 PKCE, state,
// nonce), the token request (confidential client, client_secret_post + code_verifier) and the ID token checks of OpenID
// Connect Core §3.1.3.7: RS256 signature against the tenant JWKS, iss, aud/azp, exp/nbf/iat with 5 min clock skew,
// nonce, and the tenant id. Metadata and keys are cached for an hour; an unknown `kid` refreshes the keys once (key
// rollover). The ID token only ever comes from the token endpoint (back channel, TLS), so a refresh cannot be forced by a
// third party.
import type { EntraConfig } from './config';
import { JwtError, verifyRs256, type Jwk } from './crypto';

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export class OidcError extends Error {
  constructor(
    message: string,
    /** 'provider' = the identity provider is unreachable or answered badly; 'token' = the ID token failed a check. */
    readonly kind: 'provider' | 'token',
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;
const CACHE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 300;

interface Cached<T> {
  value: T;
  at: number;
}
const metaCache = new Map<string, Cached<OidcMetadata>>();
const jwksCache = new Map<string, Cached<Jwk[]>>();

/** Forgets cached metadata and keys (tests; configuration change). */
export function clearOidcCache(): void {
  metaCache.clear();
  jwksCache.clear();
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', ...init?.headers } });
  } catch (e) {
    throw new OidcError(`identity provider unreachable (${url}): ${e instanceof Error ? e.message : e}`, 'provider');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body && typeof body === 'object' ? (body as Record<string, unknown>).error : undefined;
    throw new OidcError(`identity provider answered ${res.status}${typeof err === 'string' ? ` (${err})` : ''} for ${new URL(url).pathname}`, 'provider');
  }
  if (!body || typeof body !== 'object') throw new OidcError(`identity provider sent no JSON for ${new URL(url).pathname}`, 'provider');
  return body;
}

const isHttpsUrl = (v: unknown, issuer: string): v is string => {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    // https, or the same origin as a local (http://localhost) issuer used in development.
    return u.protocol === 'https:' || u.origin === new URL(issuer).origin;
  } catch {
    return false;
  }
};

/** The tenant's OpenID configuration; its `issuer` must be exactly the configured one (no mix-up between tenants). */
export async function discover(cfg: Pick<EntraConfig, 'issuer'>): Promise<OidcMetadata> {
  const hit = metaCache.get(cfg.issuer);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const m = (await getJson(`${cfg.issuer}/.well-known/openid-configuration`)) as Partial<OidcMetadata>;
  if (m.issuer !== cfg.issuer) throw new OidcError(`discovery issuer ${String(m.issuer)} differs from the configured ${cfg.issuer}`, 'provider');
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const)
    if (!isHttpsUrl(m[k], cfg.issuer)) throw new OidcError(`discovery document has no valid ${k}`, 'provider');
  const value: OidcMetadata = {
    issuer: m.issuer, authorization_endpoint: m.authorization_endpoint!, token_endpoint: m.token_endpoint!, jwks_uri: m.jwks_uri!,
    end_session_endpoint: isHttpsUrl(m.end_session_endpoint, cfg.issuer) ? m.end_session_endpoint : undefined,
  };
  metaCache.set(cfg.issuer, { value, at: Date.now() });
  return value;
}

async function jwks(uri: string, refresh = false): Promise<Jwk[]> {
  const hit = jwksCache.get(uri);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return hit.value;
  const body = (await getJson(uri)) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new OidcError('JWKS has no keys', 'provider');
  const keys = body.keys.filter((k): k is Jwk => !!k && typeof k === 'object');
  jwksCache.set(uri, { value: keys, at: Date.now() });
  return keys;
}

/** Scopes: the ID token with the user's name and e-mail (`profile`, `email`). */
export const SCOPES = 'openid profile email';

/** URL of the Microsoft sign-in page for this request. */
export function authorizationUrl(meta: OidcMetadata, cfg: Pick<EntraConfig, 'clientId' | 'redirectUri'>, p: { state: string; nonce: string; codeChallenge: string }): string {
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', p.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/** Exchanges the authorization code for tokens and returns the ID token (the only token Keystone uses). */
export async function exchangeCode(meta: OidcMetadata, cfg: Pick<EntraConfig, 'clientId' | 'clientSecret' | 'redirectUri'>, code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri,
    code_verifier: verifier, scope: SCOPES,
  });
  const res = (await getJson(meta.token_endpoint, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } })) as { id_token?: unknown };
  if (typeof res.id_token !== 'string' || !res.id_token) throw new OidcError('token response has no id_token', 'provider');
  return res.id_token;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Checks an ID token (signature and claims) and returns its claims. */
export async function verifyIdToken(
  meta: OidcMetadata,
  cfg: Pick<EntraConfig, 'clientId' | 'tenantId'>,
  idToken: string,
  expected: { nonce: string },
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Record<string, unknown>> {
  let decoded;
  try {
    try {
      decoded = await verifyRs256(idToken, await jwks(meta.jwks_uri));
    } catch (e) {
      if (!(e instanceof JwtError) || e.message !== 'unknown key') throw e;
      decoded = await verifyRs256(idToken, await jwks(meta.jwks_uri, true)); // signing-key rollover
    }
  } catch (e) {
    if (e instanceof OidcError) throw e;
    throw new OidcError(`ID token rejected: ${e instanceof Error ? e.message : e}`, 'token');
  }
  const c = decoded.payload;
  const fail = (why: string): never => {
    throw new OidcError(`ID token rejected: ${why}`, 'token');
  };
  if (c.iss !== meta.issuer) fail('issuer');
  const aud = c.aud;
  if (Array.isArray(aud) ? !aud.includes(cfg.clientId) : aud !== cfg.clientId) fail('audience');
  if (Array.isArray(aud) && aud.length > 1 && c.azp !== cfg.clientId) fail('authorized party');
  const exp = num(c.exp);
  const iat = num(c.iat);
  const nbf = c.nbf === undefined ? null : num(c.nbf);
  if (exp === null || exp + CLOCK_SKEW_SEC <= nowSec) fail('expired');
  if (iat === null || iat - CLOCK_SKEW_SEC > nowSec) fail('issued in the future');
  if (c.nbf !== undefined && (nbf === null || nbf - CLOCK_SKEW_SEC > nowSec)) fail('not yet valid');
  if (typeof c.nonce !== 'string' || c.nonce !== expected.nonce) fail('nonce');
  if (cfg.tenantId && typeof c.tid === 'string' && c.tid.toLowerCase() !== cfg.tenantId) fail('tenant');
  return c;
}

/** Microsoft sign-out URL (ends the Entra session too), back to `postLogoutRedirectUri`; null when the tenant has none. */
export function endSessionUrl(meta: OidcMetadata, cfg: Pick<EntraConfig, 'clientId' | 'postLogoutRedirectUri'>): string | null {
  if (!meta.end_session_endpoint) return null;
  const u = new URL(meta.end_session_endpoint);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('post_logout_redirect_uri', cfg.postLogoutRedirectUri);
  return u.toString();
}
