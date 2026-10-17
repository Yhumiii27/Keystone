// R-085 (owner decision R-7 a): the load window — 8 weeks from the Monday of the business date's week, `?week=` parsing,
// navigation bounds and links.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from './clock';
import {
  LOAD_WINDOW_MAX_OFFSET_WEEKS, LOAD_WINDOW_WEEKS, currentWeekStart, loadWindow, loadWindowBounds, loadWindowHref, parseLoadWeekParam, weekStartsFrom, windowOffsetWeeks,
} from './load-window';

describe('load window (R-085)', () => {
  it('the current window starts on the Monday of the business date week, weekends included', () => {
    expect(DEMO_TODAY_ISO).toBe('2026-09-25');
    expect(['2026-09-21', '2026-09-23', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map(currentWeekStart))
      .toEqual(['2026-09-21', '2026-09-21', '2026-09-21', '2026-09-21', '2026-09-21', '2026-09-28']);
    const w = loadWindow(DEMO_TODAY_ISO, null);
    expect(w).toMatchObject({ start: '2026-09-21', current: '2026-09-21', isCurrent: true, prev: '2026-09-14', next: '2026-09-28' });
    expect(w.weeks).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(w.weeks).toHaveLength(LOAD_WINDOW_WEEKS);
    expect(windowOffsetWeeks(w)).toBe(0);
  });

  it('follows the business date (no frozen window) and crosses years', () => {
    expect(loadWindow('2027-01-01', null).weeks).toEqual(weekStartsFrom('2026-12-28', 8));
    expect(loadWindow('2027-01-01', null).weeks.at(-1)).toBe('2027-02-15');
    expect(weekStartsFrom('2026-09-21', 0)).toEqual([]);
  });

  it('?week= is read as its Monday; malformed, impossible or out-of-bounds values give the current window', () => {
    expect(parseLoadWeekParam('2026-09-28', DEMO_TODAY_ISO)).toBe('2026-09-28');
    expect(parseLoadWeekParam(' 2026-10-01 ', DEMO_TODAY_ISO)).toBe('2026-09-28');
    expect(parseLoadWeekParam(['2026-08-31', '2026-10-05'], DEMO_TODAY_ISO)).toBe('2026-08-31');
    for (const bad of [undefined, null, 42, '', 'next', '2026-13-01', '2026-02-30', '28/09/2026', '2026-9-28', '2027-09-27', '2025-09-15'])
      expect(parseLoadWeekParam(bad, DEMO_TODAY_ISO)).toBeNull();
    const { min, max } = loadWindowBounds(DEMO_TODAY_ISO);
    expect([min, max]).toEqual(['2025-09-22', '2027-09-20']);
    expect([parseLoadWeekParam(min, DEMO_TODAY_ISO), parseLoadWeekParam(max, DEMO_TODAY_ISO)]).toEqual([min, max]);
    expect(loadWindow(DEMO_TODAY_ISO, 'garbage')).toMatchObject({ start: '2026-09-21', isCurrent: true });
    expect(loadWindow(DEMO_TODAY_ISO, '2030-01-07')).toMatchObject({ start: '2026-09-21', isCurrent: true });
  });

  it('previous / following slide one week and stop at the bounds (one year either side)', () => {
    const next = loadWindow(DEMO_TODAY_ISO, '2026-09-28');
    expect(next).toMatchObject({ start: '2026-09-28', isCurrent: false, prev: '2026-09-21', next: '2026-10-05' });
    expect(next.weeks.at(-1)).toBe('2026-11-16');
    expect(windowOffsetWeeks(next)).toBe(1);
    const { min, max } = loadWindowBounds(DEMO_TODAY_ISO);
    expect(loadWindow(DEMO_TODAY_ISO, min)).toMatchObject({ start: min, prev: null, next: '2025-09-29' });
    expect(loadWindow(DEMO_TODAY_ISO, max)).toMatchObject({ start: max, prev: '2027-09-13', next: null });
    expect(windowOffsetWeeks(loadWindow(DEMO_TODAY_ISO, min))).toBe(-LOAD_WINDOW_MAX_OFFSET_WEEKS);
  });

  it('links drop ?week= for the current window and keep the other params', () => {
    expect(loadWindowHref('/resources', '2026-09-21', '2026-09-21')).toBe('/resources');
    expect(loadWindowHref('/resources', '2026-09-28', '2026-09-21')).toBe('/resources?week=2026-09-28');
    expect(loadWindowHref('/resources/what', '2026-09-14', '2026-09-21', { project: 'HLT-026', week: '2020-01-06', empty: '' })).toBe('/resources/what?project=HLT-026&week=2026-09-14');
    expect(loadWindowHref('/resources/leave', '2026-09-21', '2026-09-21', { tab: 'x' })).toBe('/resources/leave?tab=x');
  });
});
