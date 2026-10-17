// R-085 (owner decision R-7 a): the load window — 8 weeks from the Monday of the business date's week, `?week=` parsing,
// navigation bounds and links.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from './clock';
import {
  LOAD_WINDOW_MAX_OFFSET_WEEKS, LOAD_WINDOW_WEEKS, currentWeekStart, isPastWindow, loadViewWeeks, loadWindow, loadWindowBounds, loadWindowHref, parseLoadViewParam,
  parseLoadWeekParam, stepWindowStart, weekStartsFrom, windowOffsetWeeks, workingDaysOf,
} from './load-window';
import { HOURS_PER_PERSON_WEEK, hoursOfLoad, leaveWeekDays, weekLoad } from './load-week';

describe('load window (R-085)', () => {
  it('the current window starts on the Monday of the business date week, weekends included', () => {
    expect(DEMO_TODAY_ISO).toBe('2026-09-25');
    expect(['2026-09-21', '2026-09-23', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map(currentWeekStart))
      .toEqual(['2026-09-21', '2026-09-21', '2026-09-21', '2026-09-21', '2026-09-21', '2026-09-28']);
    const w = loadWindow(DEMO_TODAY_ISO, null, '8w');
    expect(w).toMatchObject({ start: '2026-09-21', current: '2026-09-21', isCurrent: true, prev: '2026-09-14', next: '2026-09-28' });
    expect(w.weeks).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(w.weeks).toHaveLength(LOAD_WINDOW_WEEKS);
    expect(windowOffsetWeeks(w)).toBe(0);
  });

  it('follows the business date (no frozen window) and crosses years', () => {
    expect(loadWindow('2027-01-01', null, '8w').weeks).toEqual(weekStartsFrom('2026-12-28', 8));
    expect(loadWindow('2027-01-01', null, '8w').weeks.at(-1)).toBe('2027-02-15');
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
    expect(loadWindow(DEMO_TODAY_ISO, 'garbage', '8w')).toMatchObject({ start: '2026-09-21', isCurrent: true });
    expect(loadWindow(DEMO_TODAY_ISO, '2030-01-07', '8w')).toMatchObject({ start: '2026-09-21', isCurrent: true });
  });

  it('previous / following slide one week and stop at the bounds (one year either side)', () => {
    const next = loadWindow(DEMO_TODAY_ISO, '2026-09-28', '8w');
    expect(next).toMatchObject({ start: '2026-09-28', isCurrent: false, prev: '2026-09-21', next: '2026-10-05' });
    expect(next.weeks.at(-1)).toBe('2026-11-16');
    expect(windowOffsetWeeks(next)).toBe(1);
    const { min, max } = loadWindowBounds(DEMO_TODAY_ISO);
    expect(loadWindow(DEMO_TODAY_ISO, min, '8w')).toMatchObject({ start: min, prev: null, next: '2025-09-29' });
    expect(loadWindow(DEMO_TODAY_ISO, max, '8w')).toMatchObject({ start: max, prev: '2027-09-13', next: null });
    expect(windowOffsetWeeks(loadWindow(DEMO_TODAY_ISO, min, '8w'))).toBe(-LOAD_WINDOW_MAX_OFFSET_WEEKS);
  });

  it('links drop ?week= for the current window and keep the other params', () => {
    expect(loadWindowHref('/resources', '2026-09-21', '2026-09-21')).toBe('/resources');
    expect(loadWindowHref('/resources', '2026-09-28', '2026-09-21')).toBe('/resources?week=2026-09-28');
    expect(loadWindowHref('/resources/what', '2026-09-14', '2026-09-21', { project: 'HLT-026', week: '2020-01-06', empty: '' })).toBe('/resources/what?project=HLT-026&week=2026-09-14');
    expect(loadWindowHref('/resources/leave', '2026-09-21', '2026-09-21', { tab: 'x' })).toBe('/resources/leave?tab=x');
  });
});

// Owner answers 17 Oct 2026: "Il faut les deux : une vision à la semaine et une vision à 8 semaines" — the view switch, the
// one-week and 8-week steps, and the past horizon of the what-if.
describe('load views (owner answers 17 Oct 2026)', () => {
  it('?view= parsing: week, else the 8-week view', () => {
    expect([parseLoadViewParam('week'), parseLoadViewParam(' week '), parseLoadViewParam('8w'), parseLoadViewParam(['week', '8w'])]).toEqual(['week', 'week', '8w', 'week']);
    for (const bad of [undefined, null, '', 'Week', 'month', 8, ['day']]) expect(parseLoadViewParam(bad)).toBe('8w');
    expect([loadViewWeeks('week'), loadViewWeeks('8w')]).toEqual([1, LOAD_WINDOW_WEEKS]);
  });

  it('the week view: one week, one-week steps, no page step; the 8-week view adds ±8-week pages', () => {
    const wk = loadWindow(DEMO_TODAY_ISO, '2026-10-07', 'week');
    expect(wk).toMatchObject({ view: 'week', start: '2026-10-05', weeks: ['2026-10-05'], end: '2026-10-11', isCurrent: false, prev: '2026-09-28', next: '2026-10-12', prevPage: null, nextPage: null });
    const cur = loadWindow(DEMO_TODAY_ISO, null, '8w');
    expect(cur).toMatchObject({ view: '8w', end: '2026-11-15', prev: '2026-09-14', next: '2026-09-28', prevPage: '2026-07-27', nextPage: '2026-11-16' });
    expect(loadWindow(DEMO_TODAY_ISO, '2026-11-16', '8w').weeks[0]).toBe('2026-11-16');
  });

  it('page steps are clamped to the ±52-week bounds, then disabled at the bound', () => {
    const { min, max } = loadWindowBounds(DEMO_TODAY_ISO);
    expect([min, max]).toEqual(['2025-09-22', '2027-09-20']);
    expect(stepWindowStart('2025-10-06', -8, { min, max })).toBe(min);
    expect(stepWindowStart(min, -8, { min, max })).toBeNull();
    expect(stepWindowStart('2027-09-06', 8, { min, max })).toBe(max);
    expect(stepWindowStart(max, 1, { min, max })).toBeNull();
    expect(loadWindow(DEMO_TODAY_ISO, '2025-10-06', '8w')).toMatchObject({ prevPage: min, prev: '2025-09-29' });
    expect(loadWindow(DEMO_TODAY_ISO, max, '8w')).toMatchObject({ nextPage: null, next: null, prevPage: '2027-07-26' });
    expect(loadWindow(DEMO_TODAY_ISO, max, 'week')).toMatchObject({ weeks: [max], next: null, prev: '2027-09-13' });
  });

  it('links carry ?view=week (the 8-week view none) and drop a stale view / week', () => {
    expect(loadWindowHref('/resources', '2026-09-21', '2026-09-21', {}, 'week')).toBe('/resources?view=week');
    expect(loadWindowHref('/resources', '2026-10-05', '2026-09-21', { view: 'week' }, '8w')).toBe('/resources?week=2026-10-05');
    expect(loadWindowHref('/resources/leave', '2026-10-05', '2026-09-21', { tab: 'x' }, 'week')).toBe('/resources/leave?tab=x&view=week&week=2026-10-05');
  });

  it('a window entirely before the business date is past; the current one and one ending today are not', () => {
    expect(isPastWindow(loadWindow(DEMO_TODAY_ISO, null, '8w'), DEMO_TODAY_ISO)).toBe(false);
    expect(isPastWindow(loadWindow(DEMO_TODAY_ISO, '2026-07-27', '8w'), DEMO_TODAY_ISO)).toBe(true); // 27 Jul – 20 Sep
    expect(isPastWindow(loadWindow(DEMO_TODAY_ISO, '2026-07-27', '8w'), '2026-09-20')).toBe(false);
    expect(isPastWindow(loadWindow(DEMO_TODAY_ISO, '2026-08-03', '8w'), DEMO_TODAY_ISO)).toBe(false); // ends 27 Sep
    expect(workingDaysOf('2026-11-09')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });
});

describe('week detail rules (owner answers 17 Oct 2026)', () => {
  it('a weekly load: hours on the 40 h week, hours above capacity, over-allocation above 110 %, split by project', () => {
    expect(HOURS_PER_PERSON_WEEK).toBe(40);
    expect([hoursOfLoad(90), hoursOfLoad(130), hoursOfLoad(91)]).toEqual([36, 52, 36.4]);
    expect(weekLoad(130, [])).toMatchObject({ pct: 130, hours: 52, capacityH: 40, overH: 12, overAllocated: true, band: 'over', projects: [], unsplitPct: 0 });
    expect(weekLoad(110, [])).toMatchObject({ overH: 4, overAllocated: false });
    expect(weekLoad(80, [])).toMatchObject({ hours: 32, overH: 0, overAllocated: false });
    expect(weekLoad(100, [{ code: 'NDC-031', pct: 30 }, { code: 'HLT-026', pct: 60 }, { code: 'ERP-202', pct: 0 }])).toMatchObject({
      projects: [{ code: 'HLT-026', pct: 60, hours: 24 }, { code: 'NDC-031', pct: 30, hours: 12 }], unsplitPct: 10,
    });
  });

  it('leave day by day: a holiday is never an absence day, Leave wins over Absence', () => {
    const days = workingDaysOf('2026-11-09');
    const hol = new Set(['2026-11-11']);
    expect(leaveWeekDays([{ type: 'leave', start: '2026-11-09', end: '2026-11-13' }], days, hol))
      .toEqual({ days: ['leave', 'leave', 'holiday', 'leave', 'leave'], daysOff: 4, holidays: 1, availH: 0 });
    expect(leaveWeekDays([{ type: 'absence', start: '2026-11-10', end: '2026-11-12' }, { type: 'leave', start: '2026-11-12', end: '2026-11-12' }], days, hol))
      .toEqual({ days: ['worked', 'absence', 'holiday', 'leave', 'worked'], daysOff: 2, holidays: 1, availH: 14 });
    expect(leaveWeekDays([], days, new Set())).toEqual({ days: ['worked', 'worked', 'worked', 'worked', 'worked'], daysOff: 0, holidays: 0, availH: 35 });
  });
});
