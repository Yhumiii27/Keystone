// R-009: structured logs — JSON lines in production, levels, error serialisation, and no secret in any line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTED, formatRecord, sanitize, scrub } from './format';
import { log, logError, logRequestError, logWarning } from './index';

const time = new Date('2026-10-11T08:00:00.000Z');

describe('formatRecord / sanitize (pure)', () => {
  it('JSON line: time, level, msg first, then the fields; a field cannot overwrite them', () => {
    const line = formatRecord({ time, level: 'info', msg: 'Database opened', fields: { component: 'db', level: 'x', poolMax: 10 } }, 'json', []);
    expect(JSON.parse(line)).toEqual({ time: '2026-10-11T08:00:00.000Z', level: 'info', msg: 'Database opened', component: 'db', poolMax: 10 });
    expect(line.startsWith('{"time":"2026-10-11T08:00:00.000Z","level":"info","msg":"Database opened"')).toBe(true);
  });

  it('errors: type, message, code, status, digest, stack and cause', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const err = Object.assign(new Error('Vigie GET /api/ecos → 503', { cause }), { status: 503, digest: 'abc123' });
    const out = sanitize({ err }, []) as { err: Record<string, unknown> };
    expect(out.err).toMatchObject({ type: 'Error', message: 'Vigie GET /api/ecos → 503', status: 503, digest: 'abc123', cause: { type: 'Error', message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' } });
    expect(String(out.err.stack)).toContain('Vigie GET /api/ecos');
    const pretty = formatRecord({ time, level: 'error', msg: 'export failed', fields: { where: 'export', err } }, 'pretty', []);
    expect(pretty).toMatch(/^2026-10-11T08:00:00.000Z ERROR export failed \{"where":"export"\}\n {2}Error: Vigie GET/);
  });

  it('no secrets: secret-looking keys, configured secret values, URL credentials and bearer tokens are masked', () => {
    const secrets = ['sk-ant-SECRET', 'pg-pass-42'];
    const fields = {
      password: 'p', apiKey: 'k', 'x-api-key': 'k2', authorization: 'Bearer abc', cookie: 'ks-role=pm', token: 't', CURSUS_API_KEY: 'c', empty: '',
      note: 'called with sk-ant-SECRET', url: 'postgresql://keystone:pg-pass-42@db/ks', other: 'https://user:hunter2@host/x', header: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc',
      nested: { deeper: { secret: 'shh', ok: 1 } }, list: [{ password: 'x' }],
    };
    const out = sanitize(fields, secrets) as Record<string, unknown>;
    expect(out).toMatchObject({
      password: REDACTED, apiKey: REDACTED, 'x-api-key': REDACTED, authorization: REDACTED, cookie: REDACTED, token: REDACTED, CURSUS_API_KEY: REDACTED, empty: '',
      note: `called with ${REDACTED}`, url: `postgresql://keystone:${REDACTED}@db/ks`, other: `https://user:${REDACTED}@host/x`, header: `Bearer ${REDACTED}`,
      nested: { deeper: { secret: REDACTED, ok: 1 } }, list: [{ password: REDACTED }],
    });
    const line = formatRecord({ time, level: 'error', msg: 'failed with sk-ant-SECRET', fields: { err: new Error('auth pg-pass-42 refused') } }, 'json', secrets);
    expect(line).not.toContain('sk-ant-SECRET');
    expect(line).not.toContain('pg-pass-42');
    expect(scrub('nothing to hide', secrets)).toBe('nothing to hide');
  });

  it('bounded: circular references, long strings, long arrays, binary data, functions', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = sanitize({ a, s: 'x'.repeat(5000), arr: Array.from({ length: 60 }, (_, i) => i), buf: new Uint8Array(10), fn: () => 1, d: new Date(0), big: BigInt(10) }, []) as Record<string, unknown>;
    expect((out.a as Record<string, unknown>).self).toBe('[circular]');
    expect(String(out.s)).toMatch(/…\[1000 more\]$/);
    expect((out.arr as unknown[]).length).toBe(51);
    expect(out.buf).toBe('[10 bytes]');
    expect('fn' in out).toBe(false);
    expect(out.d).toBe('1970-01-01T00:00:00.000Z');
    expect(out.big).toBe('10');
  });
});

describe('server logger', () => {
  let out: { level: string; line: string }[];
  beforeEach(() => {
    out = [];
    for (const level of ['debug', 'log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((line: string) => void out.push({ level, line }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('writes JSON lines in production to stdout (info) and stderr (warn, error), filtered by LOG_LEVEL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'warn');
    log.info('hidden');
    log.debug('hidden');
    log.warn('Vigie refresh slow', { component: 'vigie' });
    log.child({ component: 'db' }).error('Pool error', { poolMax: 3 });
    expect(out.map((o) => o.level)).toEqual(['warn', 'error']);
    expect(JSON.parse(out[0].line)).toMatchObject({ level: 'warn', msg: 'Vigie refresh slow', component: 'vigie' });
    expect(JSON.parse(out[1].line)).toMatchObject({ level: 'error', msg: 'Pool error', component: 'db', poolMax: 3 });
    vi.stubEnv('LOG_LEVEL', 'silent');
    log.error('nothing');
    expect(out).toHaveLength(2);
  });

  it('logError / logWarning name the operation and serialise what was caught; the configured secrets are masked', () => {
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-very-secret');
    logError('approveOrderAction', new Error('PO-1100 is not awaiting approval (key sk-ant-very-secret)'), { number: 'PO-1100' });
    logWarning('Cursus go-no-go refresh', 'timeout', { project: 'HLT-026' });
    const [e, w] = out.map((o) => JSON.parse(o.line));
    expect(e).toMatchObject({ level: 'error', msg: 'approveOrderAction failed', where: 'approveOrderAction', number: 'PO-1100', err: { type: 'Error' } });
    expect(e.err.message).toBe(`PO-1100 is not awaiting approval (key ${REDACTED})`);
    expect(w).toMatchObject({ level: 'warn', msg: 'Cursus go-no-go refresh failed', project: 'HLT-026', err: 'timeout' });
    expect(out.map((o) => o.level)).toEqual(['error', 'warn']);
  });

  it('request errors: path without query string, route context, never the headers', () => {
    vi.stubEnv('LOG_FORMAT', 'json');
    logRequestError(Object.assign(new Error('boom'), { digest: 'd1' }), { path: '/api/export/budget?code=HLT-026&token=abc', method: 'GET' }, {
      routePath: '/api/export/[screen]', routeType: 'route', renderSource: undefined,
    });
    const line = JSON.parse(out[0].line);
    expect(line).toMatchObject({ msg: 'Request failed', method: 'GET', path: '/api/export/budget', route: '/api/export/[screen]', routeType: 'route', err: { digest: 'd1' } });
    expect(out[0].line).not.toContain('token=abc');
  });

  it('never throws, even with an invalid configuration', () => {
    vi.stubEnv('LOG_LEVEL', 'nonsense');
    expect(() => log.info('still written')).not.toThrow();
    expect(out.map((o) => o.level)).toEqual(['log']);
  });
});
