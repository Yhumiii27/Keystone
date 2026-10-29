// R-010 — the connectors' shared refresh slots: one claim per key and interval, atomic between concurrent claimers, given back
// after a failed refresh; not used on PGlite (one process owns the database).
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { claimRefresh, mayRefresh, releaseRefresh, sharedRefreshSlots } from './refresh-claims';

describe('connector refresh slots', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the first claimer of a key refreshes; the others wait for the interval', async () => {
    const db = await getDb();
    expect(await claimRefresh('vigie-ecos', 60_000, db)).toBe(true);
    expect(await claimRefresh('vigie-ecos', 60_000, db)).toBe(false);
    expect(await claimRefresh('vigie-quality', 60_000, db)).toBe(true); // another key
    expect(await claimRefresh('vigie-ecos', 0, db)).toBe(true); // interval elapsed
  });

  it('a failed refresh gives the slot back: the next read retries at once', async () => {
    const db = await getDb();
    expect(await claimRefresh('cursus-go-no-go:HLT-026', 60_000, db)).toBe(true);
    await releaseRefresh('cursus-go-no-go:HLT-026', db);
    expect(await claimRefresh('cursus-go-no-go:HLT-026', 60_000, db)).toBe(true);
  });

  it('claims sent at once: exactly one wins', async () => {
    const db = await getDb();
    const r = await Promise.all(Array.from({ length: 6 }, () => claimRefresh('cursus-go-no-go:NDC-031', 60_000, db)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('on PGlite the per-process throttle decides (the slot is not consulted)', async () => {
    expect(sharedRefreshSlots()).toBe(false);
    expect(await mayRefresh('vigie-ecos', 60_000)).toBe(true);
  });
});
