// R-013: the business clock — settings, pinned and real dates, the working-day offset that replaces the prototype's TODAY.
import { describe, expect, it } from 'vitest';
import { DEMO_CLOCK, DEMO_TODAY_ISO, REAL_CLOCK, businessNowOf, isIsoDate, lastWorkdayOf, monthNowOf, parseClockSetting, todayOf, workdayOffsetOf } from './clock';

describe('business clock', () => {
  it('parses KEYSTONE_CLOCK: "real" or a real calendar date', () => {
    expect(parseClockSetting('real')).toEqual(REAL_CLOCK);
    expect(parseClockSetting(' REAL ')).toEqual(REAL_CLOCK);
    expect(parseClockSetting('2026-09-25')).toEqual(DEMO_CLOCK);
    expect(parseClockSetting('2026-02-30')).toBeNull();
    expect(parseClockSetting('25/09/2026')).toBeNull();
    expect(parseClockSetting('now')).toBeNull();
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
  });

  it('real clock: the Paris date of the instant (late evening UTC is already tomorrow in Paris)', () => {
    expect(todayOf(REAL_CLOCK, new Date('2026-10-16T09:00:00Z'))).toBe('2026-10-16');
    expect(todayOf(REAL_CLOCK, new Date('2026-10-16T22:30:00Z'))).toBe('2026-10-17');
    const at = new Date('2026-10-16T09:00:00Z');
    expect(businessNowOf(REAL_CLOCK, at)).toBe(at);
  });

  it('pinned clock: the date is fixed, the time of day stays real (Paris)', () => {
    expect(todayOf(DEMO_CLOCK, new Date('2030-01-01T12:00:00Z'))).toBe(DEMO_TODAY_ISO);
    // 16 Oct 2026 11:42 in Paris (CEST) → 25 Sep 2026 11:42 Paris = 09:42Z.
    expect(businessNowOf(DEMO_CLOCK, new Date('2026-10-16T09:42:00Z')).toISOString()).toBe('2026-09-25T09:42:00.000Z');
  });

  it('working-day offset: the prototype TODAY = 4 on Fri 25 Sep 2026; a weekend counts as its Friday', () => {
    expect(workdayOffsetOf(DEMO_TODAY_ISO)).toBe(4);
    expect(workdayOffsetOf('2026-09-21')).toBe(0);
    expect(workdayOffsetOf('2026-09-26')).toBe(4);
    expect(workdayOffsetOf('2026-09-27')).toBe(4);
    expect(workdayOffsetOf('2026-10-16')).toBe(19);
    expect(workdayOffsetOf('2026-09-18')).toBe(-1);
    expect(lastWorkdayOf('2026-09-27')).toBe('2026-09-25');
    expect(lastWorkdayOf('2026-09-23')).toBe('2026-09-23');
  });

  it('month index of the date replaces PG_NOW (8.97 ≈ 30 Sep 2026)', () => {
    expect(monthNowOf('2026-09-30')).toBeCloseTo(8.967, 3);
    expect(monthNowOf(DEMO_TODAY_ISO)).toBeCloseTo(8.8, 3);
    expect(monthNowOf('2027-01-01')).toBe(12);
  });
});
