// R-008 — request guards: the same-origin rule of state-changing Route Handlers and the per-client sliding-window rate limit.
import { afterEach, describe, expect, it } from 'vitest';
import {
  RATE_LIMITS, TOO_MANY_REQUESTS, clientAddress, hitActionRateLimit, hitRateLimit, isSameOriginRequest, rateClient, resetRateLimits, tooManyRequestsResponse,
} from './request-guard';

const req = (headers: Record<string, string>, method = 'POST') => new Request('http://127.0.0.1:3315/api/import', { method, headers });

describe('same origin', () => {
  it('passes Keystone pages, typed URLs and header-less clients', () => {
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315', origin: 'http://127.0.0.1:3315', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315', 'sec-fetch-site': 'none' }, 'GET'))).toBe(true);
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315' }))).toBe(true);
    // Behind the TLS proxy: the public host is in X-Forwarded-Host.
    expect(isSameOriginRequest(req({ host: 'keystone:3000', 'x-forwarded-host': 'keystone.epc2i.fr', origin: 'https://keystone.epc2i.fr' }))).toBe(true);
    expect(isSameOriginRequest(req({ host: 'KEYSTONE.epc2i.fr', origin: 'https://keystone.epc2i.fr' }))).toBe(true);
  });

  it('refuses another site, another host, an opaque origin or a malformed one', () => {
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315', 'sec-fetch-site': 'cross-site' }, 'GET'))).toBe(false);
    expect(isSameOriginRequest(req({ host: 'keystone.epc2i.fr', 'sec-fetch-site': 'same-site' }, 'GET'))).toBe(false);
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315', origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315', origin: 'http://127.0.0.1:3100' }))).toBe(false);
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315', origin: 'null' }))).toBe(false);
    expect(isSameOriginRequest(req({ host: '127.0.0.1:3315', origin: '::not a url' }))).toBe(false);
  });
});

describe('rate limit', () => {
  afterEach(() => resetRateLimits());

  it('allows `limit` requests per window and client, then refuses with the seconds until a slot frees', () => {
    const { limit, windowMs } = RATE_LIMITS.export;
    const t0 = 1_000_000;
    for (let i = 0; i < limit; i++) expect(hitRateLimit('export', 'a', t0 + i * 100)).toEqual({ ok: true });
    expect(hitRateLimit('export', 'a', t0 + limit * 100)).toEqual({ ok: false, retryAfterSec: Math.ceil((windowMs - limit * 100) / 1000) });
    // Other clients and other kinds count on their own.
    expect(hitRateLimit('export', 'b', t0 + limit * 100)).toEqual({ ok: true });
    expect(hitRateLimit('upload', 'a', t0 + limit * 100)).toEqual({ ok: true });
    // The window slides: once the first request is older than the window, one more passes.
    expect(hitRateLimit('export', 'a', t0 + windowMs + 1)).toEqual({ ok: true });
    expect(hitRateLimit('export', 'a', t0 + windowMs + 2).ok).toBe(false);
  });

  it('refused requests are not counted; reset forgets every counter', () => {
    const { limit, windowMs } = RATE_LIMITS.analysis;
    for (let i = 0; i < limit; i++) hitRateLimit('analysis', 'x', 0);
    for (let i = 0; i < 50; i++) expect(hitRateLimit('analysis', 'x', 10).ok).toBe(false);
    expect(hitRateLimit('analysis', 'x', windowMs + 1).ok).toBe(true);
    resetRateLimits();
    expect(hitRateLimit('analysis', 'x', windowMs + 2).ok).toBe(true);
  });

  it('the limits: uploads 30, imports 10, exports 60, analyses 10, browser error reports 20 a minute', () => {
    expect(Object.fromEntries(Object.entries(RATE_LIMITS).map(([k, v]) => [k, [v.limit, v.windowMs]]))).toEqual({
      upload: [30, 60_000], import: [10, 60_000], export: [60, 60_000], analysis: [10, 60_000], report: [20, 60_000],
    });
  });

  it('forgets the oldest clients beyond 5 000 (forged addresses cannot grow memory without bound)', () => {
    for (let i = 0; i < RATE_LIMITS.import.limit; i++) hitRateLimit('import', 'first', 0);
    expect(hitRateLimit('import', 'first', 1).ok).toBe(false);
    for (let i = 0; i < 5000; i++) hitRateLimit('import', `c${i}`, 2);
    expect(hitRateLimit('import', 'first', 3).ok).toBe(true);
  });

  it('client = last X-Forwarded-For hop (or X-Real-IP, else "local") with the viewer', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.2' }))).toBe('10.0.0.2');
    expect(clientAddress(new Headers({ 'x-forwarded-for': ' 198.51.100.4 ' }))).toBe('198.51.100.4');
    expect(clientAddress(new Headers({ 'x-real-ip': '192.0.2.1' }))).toBe('192.0.2.1');
    expect(clientAddress(new Headers())).toBe('local');
    expect(rateClient(new Headers({ 'x-forwarded-for': '::1' }), 'Marie Lefebvre')).toBe('::1|Marie Lefebvre');
  });

  it('Server Functions outside a request count under "local"', async () => {
    for (let i = 0; i < RATE_LIMITS.analysis.limit; i++) expect((await hitActionRateLimit('analysis', 'Romain Aubert')).ok).toBe(true);
    expect((await hitActionRateLimit('analysis', 'Romain Aubert')).ok).toBe(false);
    expect(hitRateLimit('analysis', 'local|Romain Aubert').ok).toBe(false);
  });

  it('429 answers: JSON or text, Retry-After, not cached', async () => {
    const j = tooManyRequestsResponse('json', TOO_MANY_REQUESTS, 12);
    expect([j.status, j.headers.get('retry-after'), j.headers.get('cache-control')]).toEqual([429, '12', 'no-store']);
    expect(await j.json()).toEqual({ ok: false, error: TOO_MANY_REQUESTS });
    const t = tooManyRequestsResponse('text', 'Trop de requêtes', 3);
    expect([t.status, t.headers.get('retry-after'), t.headers.get('content-type'), await t.text()]).toEqual([429, '3', 'text/plain; charset=utf-8', 'Trop de requêtes']);
  });
});
