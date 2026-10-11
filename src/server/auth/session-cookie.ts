// Entra-mode cookies (R-038): the session (who is signed in, the active role) and the short-lived sign-in transaction
// (state, nonce, PKCE verifier, return path). Both are sealed (encrypted + authenticated) with KEYSTONE_SESSION_SECRET
// and HTTP-only. The session is stateless; getViewer() re-reads the user from the database on every request, so a
// deactivated user or a removed role takes effect at once. No `server-only` import: the proxy reads the session.
import type { RoleKey } from '@/config/screens';
import type { SessionConfig } from './config';
import { seal, unseal } from './crypto';

export interface SessionData {
  v: 1;
  /** users.id */
  uid: string;
  /** Entra object id the user signed in with (re-checked against users.entra_object_id). */
  oid: string;
  /** Active role (one of the user's roles; re-checked against the database). */
  role: RoleKey;
  /** Issued at / expires at (epoch seconds). */
  iat: number;
  exp: number;
}

export interface SignInTransaction {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

/** Ten minutes to complete the Microsoft sign-in. */
export const SIGN_IN_TTL = 600;

const nowSec = () => Math.floor(Date.now() / 1000);

export async function sealSession(cfg: SessionConfig, s: { uid: string; oid: string; role: RoleKey; iat?: number }): Promise<{ value: string; data: SessionData }> {
  const iat = s.iat ?? nowSec();
  const data: SessionData = { v: 1, uid: s.uid, oid: s.oid, role: s.role, iat, exp: iat + cfg.maxAge };
  return { value: await seal({ ...data }, cfg.secret, 'session'), data };
}

/** The session in a cookie value, or null (missing, tampered with, expired, other version). */
export async function readSession(cfg: SessionConfig, value: string | undefined | null): Promise<SessionData | null> {
  const s = await unseal<SessionData>(value, cfg.secret, 'session');
  if (!s || s.v !== 1 || typeof s.uid !== 'string' || typeof s.oid !== 'string' || typeof s.role !== 'string' || typeof s.iat !== 'number') return null;
  return s;
}

export async function sealSignIn(cfg: SessionConfig, t: Omit<SignInTransaction, 'exp'>): Promise<string> {
  return seal({ ...t, exp: nowSec() + SIGN_IN_TTL }, cfg.secret, 'signin');
}

export async function readSignIn(cfg: SessionConfig, value: string | undefined | null): Promise<SignInTransaction | null> {
  const t = await unseal<SignInTransaction>(value, cfg.secret, 'signin');
  if (!t || typeof t.state !== 'string' || typeof t.nonce !== 'string' || typeof t.verifier !== 'string' || typeof t.returnTo !== 'string') return null;
  return t;
}

/** Cookie attributes (HTTP-only, SameSite=Lax so the redirect back from Microsoft carries the sign-in cookie). */
export function cookieOptions(cfg: SessionConfig, maxAge: number) {
  return { httpOnly: true, secure: cfg.secure, sameSite: 'lax' as const, path: '/', maxAge };
}
