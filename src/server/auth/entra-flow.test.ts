// Microsoft Entra ID sign-in end to end (R-038/R-039) against the in-process Entra double and an in-memory database —
// no network: the sign-in route (PKCE, state, nonce), the callback (session cookie, user created or refreshed from the
// token, roles from app roles or mapped groups, audit), every refusal (unknown e-mail, no role, client without
// organisation, other Microsoft account, deactivated user, state / expiry / provider / forged token), getViewer() on the
// session, the role switch, "View as" refused, sign-out, and the demo mode left exactly as before.
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { eq } from 'drizzle-orm';
import { setViewAs } from '@/server/actions/preferences';
import { setActiveRole } from '@/server/actions/auth';
import { setDb, getDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { persons, users } from '@/server/db/schema';
import { listAudit } from '@/server/dal/notifications';
import { getViewer } from '@/server/session';
import { ENTRA_ENV, ORIGIN, createMockEntra, setCookies, type MockEntra } from '@/test/mock-entra';
import { clearOidcCache } from './oidc';
import { handleCallback, handleSignIn, handleSignOut } from './routes';

const SESSION = '__Host-ks-session';
const TX = '__Host-ks-signin';
let idp: MockEntra;

const useEntra = (extra: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries({ ...ENTRA_ENV, ...extra })) vi.stubEnv(k, v);
};

/** Sign-in route → Microsoft (the double) → callback, as the browser would. */
async function signIn(claims: Record<string, unknown>, returnTo = '/projects/HLT-026/plan?tab=gantt') {
  const start = await handleSignIn(new NextRequest(`${ORIGIN}/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`));
  const tx = setCookies(start)[TX].value;
  const { code, state } = idp.authorize(start.headers.get('location')!, claims);
  const res = await handleCallback(new NextRequest(`${ORIGIN}/api/auth/callback?code=${code}&state=${state}`, { headers: { cookie: `${TX}=${tx}` } }));
  return { start, res, cookies: setCookies(res), tx };
}

/** Puts the session cookie of a callback response in the jar read by getViewer(). */
const useSession = (r: { cookies: ReturnType<typeof setCookies> }) => jar.set(SESSION, r.cookies[SESSION].value);

const userOf = async (fullName: string) => {
  const db = await getDb();
  const [p] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, fullName));
  const [u] = await db.select().from(users).where(eq(users.personId, p.id));
  return u ?? null;
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

beforeEach(async () => {
  jar.clear();
  clearOidcCache();
  idp = await createMockEntra();
  vi.stubGlobal('fetch', idp.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('demo mode (default)', () => {
  it('keeps the "View as" cookie as the session and answers 404 on the sign-in routes', async () => {
    expect((await getViewer()).role).toBe('director'); // no cookie → director, as before
    jar.set('ks-role', 'pm');
    expect(await getViewer()).toMatchObject({ role: 'pm', name: 'Romain Aubert', roles: ['pm'], personId: null, userId: null });
    jar.set('ks-role', 'client');
    expect(await getViewer()).toMatchObject({ role: 'client', organisation: 'Port authority' });
    expect((await handleSignIn(new NextRequest(`${ORIGIN}/api/auth/sign-in`))).status).toBe(404);
    expect((await handleCallback(new NextRequest(`${ORIGIN}/api/auth/callback?code=x&state=y`))).status).toBe(404);
    expect((await handleSignOut(new NextRequest(`${ORIGIN}/api/auth/sign-out`, { method: 'POST' }))).status).toBe(404);
    expect(idp.calls).toEqual([]);
  });

  it('switches persona with "View as" and refuses the role switch', async () => {
    await expect(setViewAs('quality')).rejects.toThrow('REDIRECT:/');
    expect(jar.get('ks-role')).toBe('quality');
    expect(await setActiveRole('pm')).toEqual({ ok: false, error: 'En mode démonstration, changez de profil avec « Voir en tant que »' });
  });
});

describe('Entra ID sign-in', () => {
  beforeEach(() => useEntra());

  it('starts the authorization-code flow with PKCE, state and nonce in a sealed, HTTP-only cookie', async () => {
    const res = await handleSignIn(new NextRequest(`${ORIGIN}/api/auth/sign-in?returnTo=%2Fportfolio`));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loc.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = setCookies(res)[TX];
    expect(c.value).toMatch(/^v1\./);
    expect(c.value).not.toContain(loc.searchParams.get('state')!);
    expect(c.attrs).toMatch(/httponly/);
    expect(c.attrs).toMatch(/secure/);
    expect(c.attrs).toMatch(/samesite=lax/);
    expect(c.attrs).toMatch(/max-age=600/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('signs a known person in: session cookie, roles from the token, account linked, audit, back to the page', async () => {
    const r = await signIn({ oid: 'oid-romain', preferred_username: 'Romain.Aubert@epc2i.fr', roles: ['Keystone.PM', 'Keystone.Director'] });
    expect(r.res.status).toBe(302);
    expect(r.res.headers.get('location')).toBe(`${ORIGIN}/projects/HLT-026/plan?tab=gantt`);
    expect(r.cookies[SESSION].attrs).toMatch(/httponly/);
    expect(r.cookies[SESSION].attrs).toMatch(/max-age=43200/);
    expect(r.cookies[TX].value).toBe(''); // the sign-in transaction is consumed
    const u = await userOf('Romain Aubert');
    expect(u).toMatchObject({ personaRole: 'pm', roles: ['director', 'pm'], entraObjectId: 'oid-romain', email: 'romain.aubert@epc2i.fr', active: true });
    expect(u!.lastSignInAt).toBeInstanceOf(Date);
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Romain Aubert', object: 'Sign-in', change: 'Signed in · Portfolio director / Project manager', area: 'Sign-in' });

    useSession(r);
    jar.set('ks-role', 'client'); // ignored with Entra ID
    const v = await getViewer();
    expect(v).toMatchObject({ role: 'director', roles: ['director', 'pm'], name: 'Romain Aubert', short: 'R. Aubert', email: 'romain.aubert@epc2i.fr', userId: u!.id, personId: u!.personId, organisation: null });
  });

  it('creates the account of a directory person at the first sign-in, roles from mapped groups', async () => {
    useEntra({ ENTRA_GROUP_ROLES: JSON.stringify({ 'f0f0f0f0-0000-4000-8000-000000000001': 'quality' }) });
    const db = await getDb();
    await db.update(persons).set({ email: 'helene.sauvage@epc2i.fr' }).where(eq(persons.fullName, 'Hélène Sauvage'));
    expect(await userOf('Hélène Sauvage')).toBeNull();
    const r = await signIn({ oid: 'oid-helene', email: 'helene.sauvage@epc2i.fr', groups: ['F0F0F0F0-0000-4000-8000-000000000001', 'unmapped'] }, '/');
    expect(r.res.headers.get('location')).toBe(`${ORIGIN}/`);
    const u = await userOf('Hélène Sauvage');
    expect(u).toMatchObject({ personaRole: null, roles: ['quality'], entraObjectId: 'oid-helene', isExternal: false });
    useSession(r);
    expect(await getViewer()).toMatchObject({ role: 'quality', roles: ['quality'], name: 'Hélène Sauvage', department: 'Quality', organisation: null });
  });

  it('gives a client user their own organisation (no more CLIENT_ORG constant)', async () => {
    const r = await signIn({ oid: 'oid-nadia', email: 'n.bensaid@port-exemple.fr', roles: ['client'] });
    useSession(r);
    expect(await getViewer()).toMatchObject({ role: 'client', organisation: 'Port authority', title: 'Client — Port authority' });
  });

  it('refuses an unknown e-mail, without a session, and audits the attempt', async () => {
    const r = await signIn({ oid: 'oid-x', email: 'nobody@epc2i.fr', roles: ['director'] });
    expect(r.res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=unknown_user`);
    expect(r.cookies[SESSION].value).toBe('');
    expect(r.cookies[SESSION].attrs).toMatch(/max-age=0/);
    expect(r.cookies[SESSION].attrs).toMatch(/secure/); // a __Host- cookie is only deleted by a Secure header
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'nobody@epc2i.fr', change: 'Sign-in refused · Unknown e-mail', area: 'Sign-in' });
  });

  it('refuses tokens without a Keystone role, and client roles without an organisation', async () => {
    expect((await signIn({ oid: 'oid-julien', email: 'julien.wagner@epc2i.fr', roles: ['Other.App'] })).res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=no_role`);
    expect((await signIn({ oid: 'oid-julien', email: 'julien.wagner@epc2i.fr', roles: ['client'] })).res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=no_organisation`);
    expect((await userOf('Julien Wagner'))!.entraObjectId).toBeNull(); // nothing linked by a refused sign-in
  });

  it('keeps a person on the Microsoft account it was first linked to', async () => {
    await signIn({ oid: 'oid-antoine', email: 'antoine.girard@epc2i.fr', roles: ['englead'] });
    const other = await signIn({ oid: 'oid-impostor', email: 'antoine.girard@epc2i.fr', roles: ['director'] });
    expect(other.res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=account_mismatch`);
    // Same account, e-mail changed in Entra: still Antoine (the object id is the link).
    const again = await signIn({ oid: 'oid-antoine', email: 'a.girard@new-domain.fr', roles: ['englead', 'quality'] });
    useSession(again);
    expect(await getViewer()).toMatchObject({ name: 'Antoine Girard', roles: ['englead', 'quality'], email: 'a.girard@new-domain.fr' });
  });

  it('refuses a deactivated user and ends their running session', async () => {
    const r = await signIn({ oid: 'oid-gabriel', email: 'gabriel.comte@epc2i.fr', roles: ['quality'] });
    useSession(r);
    expect((await getViewer()).name).toBe('Gabriel Comte');
    const db = await getDb();
    const u = await userOf('Gabriel Comte');
    await db.update(users).set({ active: false }).where(eq(users.id, u!.id));
    await expect(getViewer()).rejects.toThrow('REDIRECT:/sign-in?error=session');
    expect((await signIn({ oid: 'oid-gabriel', email: 'gabriel.comte@epc2i.fr', roles: ['quality'] })).res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=inactive`);
    await db.update(users).set({ active: true }).where(eq(users.id, u!.id));
  });

  it('ends a session whose roles were all removed', async () => {
    const r = await signIn({ oid: 'oid-fabien', email: 'fabien.bertrand@epc2i.fr', roles: ['procurement'] });
    useSession(r);
    const db = await getDb();
    await db.update(users).set({ roles: [] }).where(eq(users.entraObjectId, 'oid-fabien'));
    await expect(getViewer()).rejects.toThrow('REDIRECT:/sign-in?error=session');
  });

  it('refuses a wrong state, an expired sign-in, a provider error and a forged token', async () => {
    const start = await handleSignIn(new NextRequest(`${ORIGIN}/api/auth/sign-in`));
    const tx = setCookies(start)[TX].value;
    const { code, state } = idp.authorize(start.headers.get('location')!, { oid: 'o', email: 'marie.lefebvre@epc2i.fr', roles: ['director'] });
    const cb = (q: string, cookie?: string) => handleCallback(new NextRequest(`${ORIGIN}/api/auth/callback?${q}`, { headers: cookie ? { cookie } : {} }));
    expect((await cb(`code=${code}&state=forged`, `${TX}=${tx}`)).headers.get('location')).toBe(`${ORIGIN}/sign-in?error=state`);
    expect((await cb(`code=${code}&state=${state}`)).headers.get('location')).toBe(`${ORIGIN}/sign-in?error=expired`);
    expect((await cb(`code=${code}&state=${state}`, `${TX}=tampered`)).headers.get('location')).toBe(`${ORIGIN}/sign-in?error=expired`);
    expect((await cb(`error=access_denied&state=${state}`, `${TX}=${tx}`)).headers.get('location')).toBe(`${ORIGIN}/sign-in?error=provider`);
    const foreign = await idp.foreignKey();
    idp.nextTokenResponse = async () => Response.json({ id_token: await idp.idToken({ oid: 'o', email: 'marie.lefebvre@epc2i.fr', roles: ['director'] }, { key: foreign }) });
    const forged = await cb(`code=${code}&state=${state}`, `${TX}=${tx}`);
    expect(forged.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=token`);
    expect(setCookies(forged)[SESSION]).toBeUndefined();
  });

  it('sends the visitor to the sign-in page when sign-in is not configured', async () => {
    vi.stubEnv('ENTRA_CLIENT_SECRET', '');
    const res = await handleSignIn(new NextRequest(`${ORIGIN}/api/auth/sign-in`));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=config`);
  });

  it('refuses "View as" and switches only to a role the user holds, keeping the session expiry', async () => {
    const r = await signIn({ oid: 'oid-marion', email: 'marion.kerviel@epc2i.fr', roles: ['depthead', 'quality'] });
    useSession(r);
    expect(await setViewAs('director')).toEqual({ ok: false, error: '« Voir en tant que » n’est disponible qu’en mode démonstration' });
    expect(jar.has('ks-role')).toBe(false);
    expect((await getViewer()).role).toBe('depthead');
    expect(await setActiveRole('director')).toEqual({ ok: false, error: 'Vous n’avez pas ce rôle' });
    expect(await setActiveRole('nonsense')).toEqual({ ok: false, error: 'Vous n’avez pas ce rôle' });
    const before = jar.get(SESSION);
    await expect(setActiveRole('quality')).rejects.toThrow('REDIRECT:/');
    expect(jar.get(SESSION)).not.toBe(before);
    expect(await getViewer()).toMatchObject({ role: 'quality', roles: ['depthead', 'quality'], name: 'Marion Kerviel' });
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Marion Kerviel', change: 'Active role · Head of department → Quality manager' });
  });

  it('refuses the role switch without a session', async () => {
    await expect(setActiveRole('pm')).rejects.toThrow('REDIRECT:/sign-in?error=session');
  });

  it('signs out: session cleared, audited, then the Microsoft sign-out; cross-site requests refused', async () => {
    const r = await signIn({ oid: 'oid-marie', email: 'marie.lefebvre@epc2i.fr', roles: ['director'] });
    const post = (headers: Record<string, string>) => handleSignOut(new NextRequest(`${ORIGIN}/api/auth/sign-out`, { method: 'POST', headers }));
    const cookie = `${SESSION}=${r.cookies[SESSION].value}`;
    expect((await post({ cookie, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post({ cookie, origin: 'https://evil.test' })).status).toBe(403);
    const res = await post({ cookie, origin: ORIGIN, 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(new RegExp(`^${idp.endSession}\\?client_id=.+&post_logout_redirect_uri=`));
    expect(setCookies(res)[SESSION]).toMatchObject({ value: '' });
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Marie Lefebvre', change: 'Signed out' });
  });
});
