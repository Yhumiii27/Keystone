// R-013: the business clock of the server — the real clock by default on every database (owner, 17 Oct 2026), KEYSTONE_CLOCK,
// the test override. The test run itself pins KEYSTONE_CLOCK to the demo data set's date (vitest.config.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_TODAY_ISO, REAL_CLOCK, todayOf } from '@/domain/clock';
import { businessNow, businessToday, clockSetting, setClockForTests } from './clock';

afterEach(() => {
  vi.unstubAllEnvs();
  setClockForTests(null);
});

describe('business clock (server)', () => {
  it('the test run is pinned to the demo data set date, Fri 25 Sep 2026', async () => {
    expect(await businessToday()).toBe(DEMO_TODAY_ISO);
    expect((await businessNow()).toISOString().slice(0, 10)).toBe(DEMO_TODAY_ISO);
  });

  it('unset: the real clock, whatever the database holds', async () => {
    vi.stubEnv('KEYSTONE_CLOCK', '');
    expect(await clockSetting()).toEqual(REAL_CLOCK);
    expect(await businessToday()).toBe(todayOf(REAL_CLOCK));
  });

  it('KEYSTONE_CLOCK: "real" or a pinned date', async () => {
    vi.stubEnv('KEYSTONE_CLOCK', 'real');
    expect(await businessToday()).toBe(todayOf(REAL_CLOCK));
    vi.stubEnv('KEYSTONE_CLOCK', '2027-03-01');
    expect(await businessToday()).toBe('2027-03-01');
  });

  it('the test override wins over everything', async () => {
    vi.stubEnv('KEYSTONE_CLOCK', 'real');
    setClockForTests({ kind: 'fixed', iso: '2028-02-29' });
    expect(await businessToday()).toBe('2028-02-29');
  });
});
