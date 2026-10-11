// Proxy (R-038): nothing changes in demo mode; with Entra ID, pages without a valid session go to the Microsoft
// sign-in (and come back), API calls and Server Function POSTs get 401, and the sign-in page and routes, the health
// probe and static files stay reachable. Misconfiguration fails closed.
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionConfig } from '@/server/auth/config';
import { sealSession } from '@/server/auth/session-cookie';
import { ENTRA_ENV, ORIGIN } from '@/test/mock-entra';
import { config, proxy } from './proxy';

const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';
const req = (path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers } });
const useEntra = () => {
  for (const [k, v] of Object.entries(ENTRA_ENV)) vi.stubEnv(k, v);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it('lets everything through in demo mode', async () => {
    for (const p of ['/', '/projects/HLT-026/plan', '/api/export/budget']) expect(passes(await proxy(req(p)))).toBe(true);
  });

  it('redirects a page without a session to the Microsoft sign-in, back to the same page', async () => {
    useEntra();
    const res = await proxy(req('/projects/HLT-026/plan?tab=gantt'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/api/auth/sign-in');
    expect(loc.searchParams.get('returnTo')).toBe('/projects/HLT-026/plan?tab=gantt');
  });

  it('answers 401 to API calls and Server Function posts without a session', async () => {
    useEntra();
    expect((await proxy(req('/api/export/budget?format=csv'))).status).toBe(401);
    expect((await proxy(req('/projects/HLT-026/plan', { method: 'POST', headers: { 'next-action': 'abc' } }))).status).toBe(401);
  });

  it('keeps the sign-in page and routes, the health probe and static files public', async () => {
    useEntra();
    for (const p of ['/sign-in?error=session', '/api/auth/sign-in', '/api/auth/callback?code=x', '/api/health', '/favicon.ico', '/next.svg'])
      expect(passes(await proxy(req(p))), p).toBe(true);
  });

  it('lets a valid session through and refuses a forged, expired or "View as" one', async () => {
    useEntra();
    const cfg = sessionConfig();
    const { value } = await sealSession(cfg, { uid: '00000000-0000-4000-8000-000000000001', oid: 'o', role: 'pm' });
    expect(passes(await proxy(req('/', { cookie: `${cfg.cookieName}=${value}` })))).toBe(true);
    const old = await sealSession(cfg, { uid: 'u', oid: 'o', role: 'pm', iat: Math.floor(Date.now() / 1000) - cfg.maxAge - 1 });
    expect((await proxy(req('/', { cookie: `${cfg.cookieName}=${old.value}` }))).status).toBe(307);
    expect((await proxy(req('/', { cookie: `${cfg.cookieName}=v1.forged.value` }))).status).toBe(307);
    expect((await proxy(req('/', { cookie: 'ks-role=director' }))).status).toBe(307);
  });

  it('fails closed when misconfigured', async () => {
    vi.stubEnv('KEYSTONE_AUTH', 'off');
    expect((await proxy(req('/'))).status).toBe(500);
    useEntra();
    vi.stubEnv('KEYSTONE_SESSION_SECRET', 'short');
    const res = await proxy(req('/portfolio'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=config`);
    expect((await proxy(req('/api/export/budget'))).status).toBe(401);
  });

  it('skips only Next build assets and images in its matcher', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/_next/static/chunks/main.js')).toBe(false);
    expect(re.test('/_next/image')).toBe(false);
    expect(re.test('/projects/HLT-026/plan')).toBe(true);
    expect(re.test('/api/auth/sign-in')).toBe(true);
  });
});
