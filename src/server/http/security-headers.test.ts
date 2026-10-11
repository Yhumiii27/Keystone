// R-008 — security headers: the per-request Content-Security-Policy built by the proxy (nonce on the response and on the
// request headers Next.js reads while rendering), and the static headers next.config.ts puts on every response.
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import nextConfig from '../../../next.config';
import { config as proxyConfig, proxy } from '@/proxy';
import { HSTS_VALUE, PERMISSIONS_POLICY, buildCsp, isHttpsRequest, newNonce, staticSecurityHeaders } from './security-headers';

const directives = (csp: string) => new Map(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)] as const));

describe('Content-Security-Policy', () => {
  it('production over HTTP: nonce + strict-dynamic scripts, no eval, no framing, no plugins, no upgrade', () => {
    const csp = buildCsp({ nonce: 'abc123==', dev: false, https: false });
    const d = directives(csp);
    expect(d.get('script-src')).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
    expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.has('upgrade-insecure-requests')).toBe(false);
    expect(csp).not.toContain('unsafe-eval');
  });

  it('development allows eval (React dev stacks); HTTPS adds upgrade-insecure-requests', () => {
    expect(directives(buildCsp({ nonce: 'n', dev: true, https: false })).get('script-src')).toContain("'unsafe-eval'");
    const https = buildCsp({ nonce: 'n', dev: false, https: true });
    expect(https.endsWith('upgrade-insecure-requests')).toBe(true);
  });

  it('nonces are 128-bit base64 values, fresh each time', () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });

  it('HTTPS is read from X-Forwarded-Proto (TLS proxy) first, else from the URL', () => {
    expect(isHttpsRequest('http://keystone.local/', 'https')).toBe(true);
    expect(isHttpsRequest('http://keystone.local/', 'https, http')).toBe(true);
    expect(isHttpsRequest('https://keystone.local/', 'http')).toBe(false);
    expect(isHttpsRequest('https://keystone.local/', null)).toBe(true);
    expect(isHttpsRequest('http://127.0.0.1:3315/', null)).toBe(false);
    expect(isHttpsRequest('not a url', null)).toBe(false);
  });
});

describe('proxy (src/proxy.ts)', () => {
  it('sets the CSP on the response and on the request headers (with x-nonce), a new nonce per request', async () => {
    const a = await proxy(new NextRequest('http://127.0.0.1:3315/projects/HLT-026/plan'));
    const b = await proxy(new NextRequest('http://127.0.0.1:3315/projects/HLT-026/plan'));
    const csp = a.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    // NextResponse.next({ request: { headers } }) forwards the request headers as x-middleware-request-* entries.
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(b.headers.get('content-security-policy')).not.toBe(csp);
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('behind a TLS proxy the policy upgrades insecure requests; static assets are not matched', async () => {
    const r = await proxy(new NextRequest('http://keystone.internal/', { headers: { 'x-forwarded-proto': 'https' } }));
    expect(r.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
    expect(proxyConfig.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico).*)']);
  });
});

describe('static headers (next.config.ts)', () => {
  it('every path: nosniff, DENY framing, strict referrer, closed permissions, COOP; no X-Powered-By', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    const h = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]));
    expect(h).toEqual({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': PERMISSIONS_POLICY,
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('HSTS in production only', () => {
    expect(staticSecurityHeaders(true).find((h) => h.key === 'Strict-Transport-Security')?.value).toBe(HSTS_VALUE);
    expect(staticSecurityHeaders(false).some((h) => h.key === 'Strict-Transport-Security')).toBe(false);
    expect(PERMISSIONS_POLICY).toContain('microphone=()');
  });
});
