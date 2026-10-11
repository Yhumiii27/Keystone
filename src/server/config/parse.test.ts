// R-007: the configuration schema — defaults, invalid values, production requirements, secrets kept out of messages.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_VARIABLES, DEMO_CURSUS_API_KEY, formatIssues, parseConfig, redactUrl } from './parse';

const cwd = '/srv/keystone';
const parse = (env: Record<string, string | undefined>) => parseConfig(env, { cwd });
const vars = (issues: { variable: string }[]) => issues.map((i) => i.variable);

describe('parseConfig', () => {
  it('defaults: development, PGlite in ./.data/pg, demo seed, info logs, pretty format, Cursus demo key, mocks', () => {
    const r = parse({});
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.config).toMatchObject({
      env: 'development', production: false, dataDir: path.join(cwd, '.data'), database: { driver: 'pglite', dir: path.join(cwd, '.data', 'pg') },
      seed: 'demo', seedExplicit: false, log: { level: 'info', format: 'pretty' },
      cursus: { apiUrl: null, apiKey: DEMO_CURSUS_API_KEY }, vigie: { apiUrl: null, apiKey: null },
      ai: { anthropicApiKeySet: false, enabled: false, model: null, fallbacks: true },
      secrets: [],
    });
  });

  it('blank values count as unset (a blank line of a .env file switches nothing on)', () => {
    const r = parse({ DATABASE_URL: '  ', CURSUS_API_URL: '', KEYSTONE_SEED: ' ', LOG_LEVEL: '' });
    expect(r.errors).toEqual([]);
    expect(r.config.database.driver).toBe('pglite');
    expect(r.config.cursus.apiUrl).toBeNull();
    expect(r.config.seedExplicit).toBe(false);
  });

  it('DATABASE_URL selects PostgreSQL with the pool size; the data dir is resolved against the working directory', () => {
    const r = parse({ DATABASE_URL: 'postgresql://ks:s3cret-pw@db:5432/keystone?sslmode=require', DATABASE_POOL_MAX: '25', KEYSTONE_DATA_DIR: 'var/data' });
    expect(r.errors).toEqual([]);
    expect(r.config.database).toEqual({ driver: 'postgres', url: 'postgresql://ks:s3cret-pw@db:5432/keystone?sslmode=require', poolMax: 25 });
    expect(r.config.dataDir).toBe(path.join(cwd, 'var/data'));
    // The database password is a secret the logger masks.
    expect(r.config.secrets).toContain('s3cret-pw');
    expect(parse({ DATABASE_URL: 'postgres://db/keystone' }).config.database).toEqual({ driver: 'postgres', url: 'postgres://db/keystone', poolMax: 10 });
    expect(parse({ DATABASE_POOL_MAX: '5' }).warnings.map((w) => w.variable)).toEqual(['DATABASE_POOL_MAX']);
  });

  it('invalid values are errors naming the variable, never its value; the variable falls back to its default', () => {
    const r = parse({
      DATABASE_URL: 'mysql://root:hunter22@db/x', DATABASE_POOL_MAX: '0', KEYSTONE_SEED: 'prod', LOG_LEVEL: 'verbose', LOG_FORMAT: 'xml',
      NEXT_PUBLIC_CODEX_URL: 'codex.local', CURSUS_API_URL: 'ftp://cursus', VIGIE_API_URL: 'not a url', KEYSTONE_AI: 'maybe', KEYSTONE_AI_MODEL: 'bad model!',
    });
    expect(vars(r.errors)).toEqual([
      'DATABASE_URL', 'DATABASE_POOL_MAX', 'KEYSTONE_SEED', 'LOG_LEVEL', 'LOG_FORMAT', 'NEXT_PUBLIC_CODEX_URL', 'CURSUS_API_URL', 'VIGIE_API_URL', 'KEYSTONE_AI',
      'KEYSTONE_AI_MODEL',
    ]);
    const text = formatIssues(r.errors).join('\n');
    expect(text).not.toContain('hunter22');
    expect(text).not.toContain('mysql');
    expect(text).toContain('DATABASE_URL must be a postgres:// or postgresql:// URL');
    expect(text).toContain('KEYSTONE_SEED must be "demo" or "production"');
    expect(r.config.database.driver).toBe('pglite');
    expect(r.config.seed).toBe('demo');
    expect(r.config.log.level).toBe('info');
    expect(r.config.cursus.apiUrl).toBeNull();
  });

  it('KEYSTONE_SEED=production is explicit; values are trimmed and case-folded where documented', () => {
    expect(parse({ KEYSTONE_SEED: 'production' }).config).toMatchObject({ seed: 'production', seedExplicit: true });
    expect(parse({ KEYSTONE_AI: 'OFF', ANTHROPIC_API_KEY: 'sk-ant-xxxxxxxx' }).config.ai).toMatchObject({ anthropicApiKeySet: true, enabled: false });
    expect(parse({ CURSUS_API_URL: 'http://localhost:3210/ ' }).config.cursus.apiUrl).toBe('http://localhost:3210');
  });

  it('production: JSON logs; the Cursus demo key is refused and CURSUS_API_URL needs a key', () => {
    const base = { NODE_ENV: 'production', NEXT_PUBLIC_CODEX_URL: 'https://codex', NEXT_PUBLIC_CURSUS_URL: 'https://cursus', NEXT_PUBLIC_VIGIE_URL: 'https://vigie' };
    expect(parse(base)).toMatchObject({ errors: [], warnings: [], config: { production: true, log: { format: 'json' }, cursus: { apiKey: null } } });
    expect(vars(parse({ ...base, CURSUS_API_URL: 'https://cursus/api' }).errors)).toEqual(['CURSUS_API_KEY']);
    const demo = parse({ ...base, CURSUS_API_URL: 'https://cursus/api', CURSUS_API_KEY: DEMO_CURSUS_API_KEY });
    expect(formatIssues(demo.errors)).toEqual(['CURSUS_API_KEY is the Cursus demo key, refused in production']);
    expect(demo.config.cursus.apiKey).toBeNull();
    const ok = parse({ ...base, CURSUS_API_URL: 'https://cursus/api', KEYSTONE_API_KEY: 'k-123456789' });
    expect(ok.errors).toEqual([]);
    expect(ok.config.cursus.apiKey).toBe('k-123456789');
    expect(ok.config.secrets).toEqual(['k-123456789']);
    // Outside production the demo key stays the default (local Cursus).
    expect(parse({ CURSUS_API_URL: 'http://localhost:3210' }).config.cursus.apiKey).toBe(DEMO_CURSUS_API_KEY);
  });

  it('production warnings: links to localhost, Vigie without a key (V-3)', () => {
    const r = parse({ NODE_ENV: 'production', VIGIE_API_URL: 'https://vigie/api' });
    expect(r.errors).toEqual([]);
    expect(vars(r.warnings)).toEqual(['VIGIE_API_KEY', 'NEXT_PUBLIC_CODEX_URL', 'NEXT_PUBLIC_CURSUS_URL', 'NEXT_PUBLIC_VIGIE_URL']);
    expect(parse({ NODE_ENV: 'production', VIGIE_API_URL: 'https://vigie/api', VIGIE_API_KEY: 'v-key-123' }).config.vigie).toEqual({ apiUrl: 'https://vigie/api', apiKey: 'v-key-123' });
  });

  it('an unknown NODE_ENV is a warning (development assumed), not an error', () => {
    const r = parse({ NODE_ENV: 'staging' });
    expect(r.errors).toEqual([]);
    expect(vars(r.warnings)).toEqual(['NODE_ENV']);
    expect(r.config.env).toBe('development');
  });

  it('collects the secrets the logger must mask (short values ignored)', () => {
    const r = parse({ ANTHROPIC_API_KEY: 'sk-ant-abcdef', CURSUS_API_KEY: 'cursus-key', VIGIE_API_KEY: 'abc', DATABASE_URL: 'postgresql://u:pw-123@h/db' });
    expect(r.config.secrets.sort()).toEqual(['cursus-key', 'pw-123', 'sk-ant-abcdef']);
  });

  it('lists every variable it reads (cache key of the server configuration)', () => {
    expect(CONFIG_VARIABLES).toEqual(expect.arrayContaining(['DATABASE_URL', 'KEYSTONE_SEED', 'LOG_LEVEL', 'CURSUS_API_KEY', 'VIGIE_API_KEY', 'KEYSTONE_DATA_DIR']));
  });
});

describe('redactUrl', () => {
  it('masks the password of a database URL', () => {
    expect(redactUrl('postgresql://keystone:s3cret@db:5432/ks')).toBe('postgresql://keystone:***@db:5432/ks');
    expect(redactUrl('postgresql://db/ks')).toBe('postgresql://db/ks');
    expect(redactUrl('nope')).toBe('[invalid URL]');
  });
});
