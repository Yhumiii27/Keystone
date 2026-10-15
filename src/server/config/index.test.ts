// R-007: the server configuration follows process.env (tests stub variables) and fails fast in production.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, assertValidConfig, configResult, getConfig } from './index';
import { envFilesOf, loadEnvFiles } from './env-files';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getConfig / assertValidConfig', () => {
  it('re-reads the environment when a variable changes', () => {
    vi.stubEnv('VIGIE_API_URL', '');
    expect(getConfig().vigie.apiUrl).toBeNull();
    vi.stubEnv('VIGIE_API_URL', 'http://vigie.test');
    expect(getConfig().vigie.apiUrl).toBe('http://vigie.test');
    expect(configResult()).toBe(configResult());
  });

  it('throws a ConfigError listing every issue in production (strict), only reports them otherwise', () => {
    vi.stubEnv('LOG_LEVEL', 'loud');
    vi.stubEnv('KEYSTONE_SEED', 'staging');
    expect(assertValidConfig().errors.map((e) => e.variable)).toEqual(['KEYSTONE_SEED', 'LOG_LEVEL']);
    expect(() => assertValidConfig({ strict: true })).toThrow(ConfigError);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      assertValidConfig();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).message).toBe('Invalid configuration: KEYSTONE_SEED must be "demo" or "production"; LOG_LEVEL must be one of debug, info, warn, error, silent');
      expect((e as ConfigError).issues).toHaveLength(2);
    }
  });

  it('production refuses the Cursus demo key without echoing it', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CURSUS_API_URL', 'https://cursus.example');
    vi.stubEnv('CURSUS_API_KEY', 'demo-keystone');
    expect(() => assertValidConfig()).toThrow('CURSUS_API_KEY is the Cursus demo key, refused in production');
    expect(getConfig().cursus.apiKey).toBeNull();
  });
});

describe('.env files for scripts (npm run db:migrate)', () => {
  it('reads the files Next reads, in its precedence, without overwriting the environment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-env-'));
    try {
      expect(envFilesOf(dir, 'production').map((f) => path.basename(f))).toEqual(['.env.production.local', '.env.local', '.env.production', '.env']);
      expect(envFilesOf(dir, 'test').map((f) => path.basename(f))).toEqual(['.env.test.local', '.env.test', '.env']);
      expect(envFilesOf(dir, undefined).map((f) => path.basename(f))).toEqual(['.env.development.local', '.env.local', '.env.development', '.env']);
      fs.writeFileSync(path.join(dir, '.env'), 'KS_T_A=from-env\nKS_T_B=from-env\nKS_T_C=from-env\n');
      fs.writeFileSync(path.join(dir, '.env.local'), 'KS_T_A=from-local\n');
      vi.stubEnv('KS_T_C', 'from-shell');
      vi.stubEnv('KS_T_A', undefined as unknown as string);
      vi.stubEnv('KS_T_B', undefined as unknown as string);
      const loaded = loadEnvFiles(dir, 'development');
      expect(loaded.map((f) => path.basename(f))).toEqual(['.env.local', '.env']);
      expect([process.env.KS_T_A, process.env.KS_T_B, process.env.KS_T_C]).toEqual(['from-local', 'from-env', 'from-shell']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
