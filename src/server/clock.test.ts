// R-013: the business clock of the server — automatic by data set, KEYSTONE_CLOCK, the test override, inside a transaction.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO_TODAY_ISO, todayOf, REAL_CLOCK } from '@/domain/clock';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { DB } from '@/server/db/types';
import { businessNow, businessToday, clockSetting, setClockForTests } from './clock';

let demo: DB;
let production: DB;
beforeAll(async () => {
  [demo, production] = await Promise.all([openDatabase(), openDatabase(undefined, undefined, { seed: 'production' })]);
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
  setClockForTests(null);
  setDb(demo);
});

describe('business clock (server)', () => {
  it('automatic: the demo database works at its data set date, Fri 25 Sep 2026', async () => {
    setDb(demo);
    expect(await businessToday()).toBe(DEMO_TODAY_ISO);
    expect((await businessNow()).toISOString().slice(0, 10)).toBe(DEMO_TODAY_ISO);
  });

  it('automatic: a production database works at the real date', async () => {
    setDb(production);
    expect(await clockSetting()).toEqual(REAL_CLOCK);
    expect(await businessToday()).toBe(todayOf(REAL_CLOCK));
  });

  it('KEYSTONE_CLOCK wins over the data set: real on the demo database, a pinned date on production', async () => {
    setDb(demo);
    vi.stubEnv('KEYSTONE_CLOCK', 'real');
    expect(await businessToday()).toBe(todayOf(REAL_CLOCK));
    setDb(production);
    vi.stubEnv('KEYSTONE_CLOCK', '2027-03-01');
    expect(await businessToday()).toBe('2027-03-01');
  });

  it('the test override wins over everything', async () => {
    vi.stubEnv('KEYSTONE_CLOCK', 'real');
    setClockForTests({ kind: 'fixed', iso: '2028-02-29' });
    expect(await businessToday()).toBe('2028-02-29');
  });

  it('resolves inside an open transaction when given the transaction (no PGlite deadlock)', async () => {
    const fresh = await openDatabase(undefined, undefined, { seed: 'production' });
    setDb(fresh);
    const today = await fresh.transaction(async (tx) => businessToday(tx));
    expect(today).toBe(todayOf(REAL_CLOCK));
  }, 120_000);
});
