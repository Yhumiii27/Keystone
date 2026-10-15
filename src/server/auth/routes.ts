import 'server-only';
// Sign-in, callback and sign-out (R-038) — the Route Handlers of src/app/api/auth/* call these. Entra mode only: in
// demo mode the routes answer 404 (the "View as" cookie is the session). Every redirect goes to the public origin of
// ENTRA_REDIRECT_URI (stable behind a reverse proxy); refusals land on /sign-in?error=<code> (a public page), never back
// on the sign-in route, so a refused account cannot loop through Microsoft.
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_PATHS, activeRoleOf, emailFromClaims, rolesFromClaims, safeReturnTo, type SignInError } from '@/domain/auth';
import { recordSignOut, signInUser } from '@/server/dal/users';
import { authMode, entraConfig, sessionConfig, type EntraConfig, type SessionConfig } from './config';
import { pkceChallenge, randomToken, safeEqual } from './crypto';
import { OidcError, authorizationUrl, discover, endSessionUrl, exchangeCode, verifyIdToken } from './oidc';
import { SIGN_IN_TTL, cookieOptions, readSession, readSignIn, sealSession, sealSignIn } from './session-cookie';

const NO_STORE = { 'Cache-Control': 'no-store' };

const notFound = () => new NextResponse('Not found', { status: 404, headers: NO_STORE });

function redirect(target: string | URL, status = 302): NextResponse {
  const res = NextResponse.redirect(target, status);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Deletes a cookie with the attributes it was set with (a `__Host-` cookie is only removed by a Secure, Path=/ header). */
const clearCookie = (res: NextResponse, cfg: SessionConfig, name: string) => res.cookies.set(name, '', cookieOptions(cfg, 0));

const originOf = (cfg: EntraConfig) => new URL(cfg.redirectUri).origin;
const signInPage = (origin: string, error: SignInError) => new URL(`${AUTH_PATHS.page}?error=${error}`, origin);

/** Entra configuration, or the redirect to the sign-in page saying it is missing (logged for IT). */
function config(req: Request): EntraConfig | NextResponse {
  try {
    return entraConfig();
  } catch (e) {
    console.error('[auth] configuration error:', e instanceof Error ? e.message : e);
    return redirect(signInPage(new URL(req.url).origin, 'config'));
  }
}

/** GET /api/auth/sign-in?returnTo=/path — starts the Microsoft sign-in (state, nonce, PKCE in a sealed cookie). */
export async function handleSignIn(req: NextRequest): Promise<Response> {
  if (authMode() !== 'entra') return notFound();
  const cfg = config(req);
  if (cfg instanceof NextResponse) return cfg;
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('returnTo'));
  let target: string;
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(32);
  try {
    target = authorizationUrl(await discover(cfg), cfg, { state, nonce, codeChallenge: await pkceChallenge(verifier) });
  } catch (e) {
    console.error('[auth] sign-in:', e instanceof Error ? e.message : e);
    return redirect(signInPage(originOf(cfg), 'provider'));
  }
  const res = redirect(target);
  res.cookies.set(cfg.session.txCookieName, await sealSignIn(cfg.session, { state, nonce, verifier, returnTo }), cookieOptions(cfg.session, SIGN_IN_TTL));
  return res;
}

/** GET /api/auth/callback?code&state — completes the sign-in: token, checks, person and roles, session cookie. */
export async function handleCallback(req: NextRequest): Promise<Response> {
  if (authMode() !== 'entra') return notFound();
  const cfg = config(req);
  if (cfg instanceof NextResponse) return cfg;
  const origin = originOf(cfg);
  const p = req.nextUrl.searchParams;
  const fail = (error: SignInError, clearSession = false) => {
    const res = redirect(signInPage(origin, error));
    clearCookie(res, cfg.session, cfg.session.txCookieName);
    if (clearSession) clearCookie(res, cfg.session, cfg.session.cookieName);
    return res;
  };
  const tx = await readSignIn(cfg.session, req.cookies.get(cfg.session.txCookieName)?.value);
  if (!tx) return fail('expired');
  const providerError = p.get('error');
  if (providerError) {
    console.warn('[auth] Microsoft sign-in error:', providerError.slice(0, 100));
    return fail('provider');
  }
  const state = p.get('state');
  const code = p.get('code');
  if (!state || !safeEqual(state, tx.state)) return fail('state');
  if (!code || code.length > 4096) return fail('provider');
  let claims: Record<string, unknown>;
  try {
    const meta = await discover(cfg);
    claims = await verifyIdToken(meta, cfg, await exchangeCode(meta, cfg, code, tx.verifier), { nonce: tx.nonce });
  } catch (e) {
    console.error('[auth] callback:', e instanceof Error ? e.message : e);
    return fail(e instanceof OidcError && e.kind === 'token' ? 'token' : 'provider');
  }
  const oid = typeof claims.oid === 'string' && claims.oid ? claims.oid : null;
  if (!oid) return fail('token');
  let result;
  try {
    result = await signInUser({ oid, email: emailFromClaims(claims), roles: rolesFromClaims(claims, cfg.groupRoles) });
  } catch (e) {
    console.error('[auth] sign-in failed:', e);
    return fail('failed', true);
  }
  if (!result.ok) return fail(result.reason, true);
  const role = activeRoleOf(result.account.roles);
  if (!role) return fail('no_role', true);
  const { value } = await sealSession(cfg.session, { uid: result.account.userId, oid, role });
  const res = redirect(new URL(tx.returnTo, origin));
  res.cookies.set(cfg.session.cookieName, value, cookieOptions(cfg.session, cfg.session.maxAge));
  clearCookie(res, cfg.session, cfg.session.txCookieName);
  return res;
}

/** A cross-site POST (or one from another origin) is refused: only Keystone's own form signs out. */
function sameOrigin(req: NextRequest, origin: string): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
  const o = req.headers.get('origin');
  return !o || o === origin || o === req.nextUrl.origin;
}

/** POST /api/auth/sign-out — ends the Keystone session, then the Microsoft one (end-session endpoint). */
export async function handleSignOut(req: NextRequest): Promise<Response> {
  if (authMode() !== 'entra') return notFound();
  let session: SessionConfig;
  try {
    session = sessionConfig();
  } catch (e) {
    console.error('[auth] configuration error:', e instanceof Error ? e.message : e);
    return new NextResponse('Sign-in is not configured', { status: 500, headers: NO_STORE });
  }
  let cfg: EntraConfig | null = null;
  try {
    cfg = entraConfig();
  } catch {
    cfg = null; // still end the Keystone session
  }
  const origin = cfg ? originOf(cfg) : req.nextUrl.origin;
  if (!sameOrigin(req, origin)) return new NextResponse('Forbidden', { status: 403, headers: NO_STORE });
  const s = await readSession(session, req.cookies.get(session.cookieName)?.value);
  if (s) await recordSignOut(s.uid).catch((e) => console.error('[auth] sign-out audit failed:', e));
  let target: string | URL = new URL(`${AUTH_PATHS.page}?signedOut=1`, origin);
  if (cfg) {
    try {
      target = endSessionUrl(await discover(cfg), cfg) ?? target;
    } catch (e) {
      console.error('[auth] sign-out:', e instanceof Error ? e.message : e);
    }
  }
  const res = redirect(target, 303);
  clearCookie(res, session, session.cookieName);
  return res;
}
