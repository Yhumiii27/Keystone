// R-009: GET /api/health — 200 when the database answers and its schema is current; 503 (timeout, error, pending
// migrations) otherwise; no detail an outsider could use; the cause is logged. R-002: pending migrations are detected.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '@/app/api/health/route';
import { setDb } from '@/server/db/client';
import { MIGRATIONS_FOLDER, migrationFiles, pendingMigrations } from '@/server/db/migrations';
import { openDatabase } from '@/server/db/open';
import * as schema from '@/server/db/schema';
import type { DB } from '@/server/db/types';
import { checkHealth } from './health';

let db: DB;
beforeAll(async () => {
  db = await openDatabase();
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  setDb(db);
});

describe('pendingMigrations', () => {
  it('every migration is pending on a database never migrated, none after openDatabase()', async () => {
    const empty = drizzle(new PGlite(), { schema }) as unknown as DB;
    expect((await pendingMigrations(empty)).length).toBe(migrationFiles().length);
    expect(migrationFiles().length).toBeGreaterThanOrEqual(8);
    expect(await pendingMigrations(db)).toEqual([]);
  });

  it('a migration added after the last one applied is pending', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-mig-'));
    try {
      fs.cpSync(MIGRATIONS_FOLDER(), dir, { recursive: true });
      const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8'));
      const last = journal.entries.at(-1);
      journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag: '9999_future' });
      fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
      fs.writeFileSync(path.join(dir, '9999_future.sql'), 'select 1;');
      expect((await pendingMigrations(db, dir)).map((m) => m.folderMillis)).toEqual([last.when + 1000]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('checkHealth and GET /api/health', () => {
  it('ok: 200, JSON, never cached', async () => {
    const r = await checkHealth();
    expect(r).toMatchObject({ status: 'ok', checks: { database: { status: 'ok' } } });
    expect(r.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ status: 'ok', checks: { database: { status: 'ok' } }, time: expect.any(String) });
    expect((await HEAD()).status).toBe(200);
  });

  it('a database with pending migrations is unavailable (503)', async () => {
    setDb(drizzle(new PGlite(), { schema }) as unknown as DB);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'unavailable', checks: { database: { status: 'migrations_pending', pendingMigrations: migrationFiles().length } } });
  });

  it('an unreachable database: 503 without detail; the cause goes to the log', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setDb(Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2')));
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ status: 'unavailable', checks: { database: { status: 'error' } } });
    expect(text).not.toContain('ECONNREFUSED');
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('Health check failed');
  });

  it('a database that does not answer in time: timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setDb(new Promise<DB>(() => {}));
    expect(await checkHealth({ timeoutMs: 30 })).toMatchObject({ status: 'unavailable', checks: { database: { status: 'timeout' } } });
  });
});
