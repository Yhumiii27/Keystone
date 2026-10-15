// R-007 / R-002: the start-up check (instrumentation register) and `npm run db:migrate` on PGlite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '@/server/config';
import { setDb } from '@/server/db/client';
import { runMigrateCommand } from '@/server/db/migrate-command';
import { migrationFiles } from '@/server/db/migrations';
import { openDatabase } from '@/server/db/open';
import type { DB } from '@/server/db/types';
import { registerNodeServer, startServer } from './startup';

let db: DB;
beforeAll(async () => {
  db = await openDatabase();
}, 60_000);

const lines: { level: string; line: string }[] = [];
const capture = () => {
  lines.length = 0;
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((line: string) => void lines.push({ level, line }));
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setDb(db);
});

describe('startServer', () => {
  it('development: an invalid variable is logged, the defaults are used, the server starts', async () => {
    capture();
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('KEYSTONE_SEED', 'sample');
    const cfg = await startServer();
    expect(cfg.seed).toBe('demo');
    const err = lines.find((l) => l.level === 'error')!;
    expect(JSON.parse(err.line)).toMatchObject({ msg: 'Invalid configuration: defaults are used outside production', issues: ['KEYSTONE_SEED must be "demo" or "production"'] });
    expect(lines.some((l) => JSON.parse(l.line).msg === 'Keystone server starting')).toBe(true);
  });

  it('production: an invalid configuration stops the start (ConfigError), before the database is opened', async () => {
    capture();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CURSUS_API_URL', 'https://cursus.example');
    // Reaching the database would reject with this error instead of the ConfigError.
    const unreachable = Promise.reject(new Error('database reached'));
    unreachable.catch(() => null);
    setDb(unreachable);
    await expect(startServer()).rejects.toBeInstanceOf(ConfigError);
  });

  it('production: a valid configuration opens the database before serving; warnings are logged', async () => {
    capture();
    vi.stubEnv('NODE_ENV', 'production');
    const cfg = await startServer();
    expect(cfg.production).toBe(true);
    const warned = lines.filter((l) => l.level === 'warn').map((l) => JSON.parse(l.line).msg);
    expect(warned).toEqual([
      'Configuration: NEXT_PUBLIC_CODEX_URL is not set: links open Codex on localhost',
      'Configuration: NEXT_PUBLIC_CURSUS_URL is not set: links open Cursus on localhost',
      'Configuration: NEXT_PUBLIC_VIGIE_URL is not set: links open Vigie on localhost',
      'Configuration: KEYSTONE_AUTH is not set: demo mode ("View as", no sign-in) — set it to "entra" for real users, or "demo" explicitly',
      // R-175: antivirus on uploads not chosen.
      'Configuration: KEYSTONE_FILE_SCAN is not set: uploaded files are not checked by an antivirus — set it to "clamav", or "off" explicitly',
    ]);
    // The database failing to open stops the start too.
    setDb(Promise.reject(new Error('The database has 1 pending migration: run "npm run db:migrate" before starting Keystone')));
    await expect(startServer()).rejects.toThrow(/pending migration/);
  });
});

describe('registerNodeServer (instrumentation register)', () => {
  it('production: logs the failure as one line and exits with code 1; development: rethrows', async () => {
    capture();
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('KEYSTONE_SEED', 'sample');
    vi.stubEnv('NODE_ENV', 'production');
    const exit = vi.fn((code: number): never => {
      throw new Error(`exit ${code}`);
    });
    await expect(registerNodeServer(exit)).rejects.toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
    const line = JSON.parse(lines.find((l) => l.level === 'error')!.line);
    expect(line).toMatchObject({ msg: 'Keystone start-up failed', component: 'startup', err: { type: 'ConfigError', message: 'Invalid configuration: KEYSTONE_SEED must be "demo" or "production"' } });
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('KEYSTONE_SEED', '');
    setDb(db);
    await expect(registerNodeServer(exit)).resolves.toBeUndefined();
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('npm run db:migrate (PGlite)', () => {
  it('creates, migrates and seeds the data directory; a second run has nothing to do; the configuration is checked strictly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-migrate-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      vi.stubEnv('KEYSTONE_DATA_DIR', dir);
      vi.stubEnv('KEYSTONE_SEED', 'production');
      expect(await runMigrateCommand()).toEqual({ driver: 'pglite', applied: migrationFiles().length, seeded: true, seed: 'production' });
      expect(fs.existsSync(path.join(dir, 'pg', 'PG_VERSION'))).toBe(true);
      vi.stubEnv('KEYSTONE_SEED', 'demo');
      expect(await runMigrateCommand()).toEqual({ driver: 'pglite', applied: 0, seeded: false, seed: 'production' });
      vi.stubEnv('LOG_LEVEL', 'chatty');
      await expect(runMigrateCommand()).rejects.toBeInstanceOf(ConfigError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
