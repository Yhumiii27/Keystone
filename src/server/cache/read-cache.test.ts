// R-017: the in-process read caches (./read-cache.ts) — `versionedRead` is exact (a write anywhere, committed, makes the next read
// compute again), `ttlRead` is dropped by this process's writes and after its TTL, values are handed out as copies, errors are
// not cached, and a new database handle empties them.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { closeDatabase, openDatabase } from '@/server/db/open';
import { appSettings } from '@/server/db/schema';
import { bumpWriteGeneration, isWriteStatement, writeGeneration } from '@/server/db/write-generation';
import { clearReadCache, dataVersion, ttlRead, versionedRead } from './read-cache';

beforeAll(async () => {
  setDb(await openDatabase(undefined, undefined, { seed: 'production' }));
}, 120_000);

afterAll(async () => {
  await closeDatabase(await getDb());
});

const counter = () => {
  let n = 0;
  return { next: async () => ({ n: ++n, list: [1, 2, 3] }), get calls() { return n; } };
};

describe('versionedRead', () => {
  it('serves the cached value while the database is unchanged, and computes again after a committed write', async () => {
    clearReadCache();
    const c = counter();
    expect((await versionedRead('t1', c.next)).n).toBe(1);
    expect((await versionedRead('t1', c.next)).n).toBe(1);
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: 'r017.test', value: { a: 1 } }).onConflictDoNothing();
    });
    expect((await versionedRead('t1', c.next)).n).toBe(2);
    // A write outside a transaction (autocommit) moves the version too.
    await db.update(appSettings).set({ value: { a: 2 } }).where(eq(appSettings.key, 'r017.test'));
    expect((await versionedRead('t1', c.next)).n).toBe(3);
    expect(c.calls).toBe(3);
  });

  it('does not move on reads', async () => {
    const before = await dataVersion();
    await (await getDb()).execute(sql`select count(*) from app_settings`);
    expect(await dataVersion()).toBe(before);
  });

  it('hands out copies: a caller changing its value never changes the cache', async () => {
    clearReadCache();
    const c = counter();
    const first = await versionedRead('t2', c.next);
    first.list.push(99);
    expect((await versionedRead('t2', c.next)).list).toEqual([1, 2, 3]);
  });

  it('shares a large list frozen instead of copying it (`shared`)', async () => {
    clearReadCache();
    const c = counter();
    const a = await versionedRead('t5', c.next, { shared: true });
    const b = await versionedRead('t5', c.next, { shared: true });
    expect(b).toBe(a);
    expect(Object.isFrozen(a.list)).toBe(true);
    expect(() => a.list.push(4)).toThrow(TypeError);
  });

  it('does not cache an error', async () => {
    clearReadCache();
    let fail = true;
    const f = async () => {
      if (fail) throw new Error('boom');
      return 7;
    };
    await expect(versionedRead('t3', f)).rejects.toThrow('boom');
    fail = false;
    expect(await versionedRead('t3', f)).toBe(7);
  });

  it('is off with KEYSTONE_READ_CACHE=off', async () => {
    clearReadCache();
    vi.stubEnv('KEYSTONE_READ_CACHE', 'off');
    try {
      const c = counter();
      await versionedRead('t4', c.next);
      await versionedRead('t4', c.next);
      expect(c.calls).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('ttlRead', () => {
  it('serves the value for its TTL, unless this process writes', async () => {
    clearReadCache();
    const c = counter();
    expect((await ttlRead('b1', 60_000, c.next)).n).toBe(1);
    expect((await ttlRead('b1', 60_000, c.next)).n).toBe(1);
    bumpWriteGeneration();
    expect((await ttlRead('b1', 60_000, c.next)).n).toBe(2);
    // A committed transaction moves the generation.
    const g = writeGeneration();
    await (await getDb()).transaction(async (tx) => {
      await tx.update(appSettings).set({ value: { a: 3 } }).where(eq(appSettings.key, 'r017.test'));
    });
    expect(writeGeneration()).toBeGreaterThan(g);
    expect((await ttlRead('b1', 60_000, c.next)).n).toBe(3);
  });

  it('computes again once the TTL is over', async () => {
    clearReadCache();
    const c = counter();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await ttlRead('b2', 1_000, c.next);
      vi.setSystemTime(Date.now() + 1_500);
      await ttlRead('b2', 1_000, c.next);
      expect(c.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the entries of different keys apart (one per viewer)', async () => {
    clearReadCache();
    const a = await ttlRead('viewer|a', 60_000, async () => 'a');
    const b = await ttlRead('viewer|b', 60_000, async () => 'b');
    expect([a, b]).toEqual(['a', 'b']);
  });
});

describe('isWriteStatement', () => {
  it('recognises the write statements Drizzle and the raw SQL send', () => {
    expect(isWriteStatement('insert into "tasks" ("id") values ($1)')).toBe(true);
    expect(isWriteStatement('update "tasks" set "status" = $1 where "tasks"."id" = $2')).toBe(true);
    expect(isWriteStatement('delete from "tasks" where "tasks"."id" = $1')).toBe(true);
    expect(isWriteStatement('with i as (insert into ks_x select 1 returning 1) select count(*) from i')).toBe(true);
    expect(isWriteStatement('select "updated_at", "id" from "tasks" where "tasks"."status" = $1')).toBe(false);
    expect(isWriteStatement('select pg_current_snapshot()::text as v')).toBe(false);
  });
});
