// R-002 / R-011: getDb() opens the database the configuration names — here PGlite in KEYSTONE_DATA_DIR — seeds a new one
// with KEYSTONE_SEED, and warns when an existing database holds another data set than KEYSTONE_SEED asks for.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from './client';
import { closeDatabase } from './open';
import { readSeedRecord } from './seed/mode';

const g = globalThis as unknown as { __ksDb?: Promise<unknown> };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-client-'));

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('getDb (PGlite from the configuration)', () => {
  it('opens KEYSTONE_DATA_DIR/pg, seeds it with KEYSTONE_SEED, then keeps its data set', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => void lines.push(l));
    vi.spyOn(console, 'warn').mockImplementation((l: string) => void lines.push(l));
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('KEYSTONE_DATA_DIR', dir);
    vi.stubEnv('KEYSTONE_SEED', 'production');
    g.__ksDb = undefined;
    const db = await getDb();
    expect(fs.existsSync(path.join(dir, 'pg', 'PG_VERSION'))).toBe(true);
    expect(await readSeedRecord(db)).toMatchObject({ mode: 'production' });
    expect(await getDb()).toBe(db);
    await closeDatabase(db);

    // Reopened with another KEYSTONE_SEED: the database keeps its data set, and the log says so.
    vi.stubEnv('KEYSTONE_SEED', 'demo');
    g.__ksDb = undefined;
    const again = await getDb();
    expect(await readSeedRecord(again)).toMatchObject({ mode: 'production' });
    const warn = lines.map((l) => JSON.parse(l)).find((l) => l.level === 'warn');
    expect(warn).toMatchObject({ msg: 'The database holds the production data set; KEYSTONE_SEED=demo only applies to a new database', seed: 'production' });
    await closeDatabase(again);
    g.__ksDb = undefined;
  }, 120_000);
});
