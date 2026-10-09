import { describe, expect, it } from 'vitest';
import { dateOf } from '@/lib/format';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar } from './calendar';
import {
  activityDateText, actualsFromProgress, barOf, critPackagesText, endMonthOf, finishVariance, floatDaysText, floatShortText, longDateText, midMonthOf,
  milestoneStatusOf, milestoneWbs, monthIndex, projectFloat, rollUpMilestone, rollUpPackage, shortDateText, slipWorkDays, startMonthOf,
  type RollupActivity,
} from './schedule-rollup';

const std = new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8);

describe('display dates and Gantt months', () => {
  it('prototype text forms', () => {
    expect([activityDateText('2026-10-05'), activityDateText('2027-01-14')]).toEqual(['05 Oct', '14 Jan ’27']);
    expect([shortDateText('2026-04-01'), shortDateText('2027-01-13')]).toEqual(['1 Apr', '13 Jan ’27']);
    expect(longDateText('2027-01-18')).toBe('18 Jan 2027');
  });
  it('mIdx convention; the data date of the seed is tNow 8.8', () => {
    expect(monthIndex('2026-09-25')).toBeCloseTo(8.8, 10);
    expect(startMonthOf('2026-09-25', 0)).toBe(8.8);
    expect(endMonthOf('2026-09-25', 3)).toBe(5.8333);
  });
  it('a milestone month reads its own day back through dateOf (days 1–30)', () => {
    for (const iso of ['2026-03-01', '2026-04-15', '2026-11-30', '2027-01-18']) expect(dateOf(midMonthOf(iso, 0))).toBe(shortDateText(iso));
  });
});

describe('working-day variance (S-8)', () => {
  it('A1250: 9 Oct vs BL1 31 Aug is 29 working days late (the prototype counted 39 calendar days)', () => {
    expect(slipWorkDays(std, '2026-08-31', '2026-10-09')).toBe(29);
    expect(finishVariance(std, '2026-08-31', '2026-10-09')).toBe(-29);
    expect(finishVariance(std, '2026-10-16', '2026-10-16')).toBe(0);
  });
  it('public holidays are not working days (Armistice 11 Nov 2026)', () => {
    expect(slipWorkDays(std, '2026-11-10', '2026-11-12')).toBe(1);
  });
});

describe('progress → actual dates (P6 rule at Reschedule)', () => {
  const base = { startActual: false, finishActual: false, startDate: '2026-10-05', finishDate: '2026-11-06' };
  it('0 % is not started, even with a recorded start', () => {
    expect(actualsFromProgress({ ...base, pct: 0, startActual: true }, '2026-09-25')).toMatchObject({ startActual: false, finishActual: false });
  });
  it('started: actual start = planned start, at the latest the data date', () => {
    expect(actualsFromProgress({ ...base, pct: 40 }, '2026-09-25')).toEqual({ ...base, pct: 40, startActual: true, startDate: '2026-09-25' });
    expect(actualsFromProgress({ ...base, pct: 40, startDate: '2026-09-01' }, '2026-09-25').startDate).toBe('2026-09-01');
    expect(actualsFromProgress({ ...base, pct: 40, startDate: null }, '2026-09-25').startDate).toBe('2026-09-25');
  });
  it('100 %: finished at the planned finish, at the latest the data date; recorded actuals kept', () => {
    expect(actualsFromProgress({ ...base, pct: 100, startDate: '2026-09-01', finishDate: '2026-09-20' }, '2026-09-25')).toEqual({
      pct: 100, startActual: true, finishActual: true, startDate: '2026-09-01', finishDate: '2026-09-20',
    });
    expect(actualsFromProgress({ ...base, pct: 100 }, '2026-09-25')).toMatchObject({ startDate: '2026-09-25', finishDate: '2026-09-25' });
    const done = { pct: 100, startActual: true, finishActual: true, startDate: '2026-01-05', finishDate: '2026-03-06' };
    expect(actualsFromProgress(done, '2026-09-25')).toEqual(done);
  });
  it('reopened below 100 % loses its actual finish', () => {
    expect(actualsFromProgress({ pct: 80, startActual: true, finishActual: true, startDate: '2026-08-17', finishDate: '2026-09-01' }, '2026-09-25')).toMatchObject({
      startActual: true, finishActual: false, startDate: '2026-08-17',
    });
  });
});

describe('work-package roll-up (A-7)', () => {
  const A = (code: string, start: string, finish: string, budget: number, pct: number, critical = false): RollupActivity => ({
    code, wbs: '1.4', start, finish, budget, pct, critical, complete: pct === 100,
  });
  const kids = [A('A1230', '2026-05-18', '2026-08-14', 380, 100), A('A1240', '2026-07-20', '2026-08-28', 260, 100), A('A1250', '2026-08-17', '2026-10-09', 280, 72, true), A('A1260', '2026-10-05', '2026-11-06', 105, 0, true)];
  const bl: Record<string, { start: string; finish: string }> = { A1230: { start: '2026-05-04', finish: '2026-07-31' }, A1260: { start: '2026-08-21', finish: '2026-09-25' } };
  const r = rollUpPackage('1.4', kids, (c) => bl[c]);
  it('earliest start, latest finish, budget-weighted %, critical, last activity', () => {
    expect(r).toEqual({
      wbs: '1.4', start: '2026-05-18', finish: '2026-11-06', baselineStart: '2026-05-04', baselineFinish: '2026-09-25', pct: 82, critical: true, count: 4, lastActivity: 'A1260',
    });
  });
  it('bar geometry in months from the project start, slip in working days', () => {
    expect(barOf(r, 0, std)).toEqual({ forecastStart: 4.5667, forecastEnd: 10.2, baselineStart: 4.1, baselineEnd: 8.8333, pct: 82, critical: true, slipDays: 30 });
    expect(barOf(rollUpPackage('1.9', [], () => undefined), 0, std)).toBeNull();
  });
  it('without baseline dates the baseline bar is the forecast and there is no slip', () => {
    const b = barOf(rollUpPackage('1.4', kids, () => undefined), 0, std)!;
    expect([b.baselineStart, b.baselineEnd, b.slipDays]).toEqual([b.forecastStart, b.forecastEnd, null]);
  });
  it('a complete critical child does not make the package critical', () => {
    expect(rollUpPackage('1.3', [{ ...kids[0], critical: true }], () => undefined).critical).toBe(false);
  });
});

describe('milestones (A-7)', () => {
  const pk = [{ code: '1.1', name: 'Design & permits' }, { code: '1.4', name: 'Steel structure' }, { code: '1.8', name: 'Commissioning & handover' }];
  it('anchor work package: "<package> complete", else the HLT-026 table', () => {
    expect(milestoneWbs('Steel structure complete', pk)).toBe('1.4');
    expect(milestoneWbs('Handover', pk)).toBe('1.8');
    expect(milestoneWbs('Permits approved', pk)).toBe('1.1');
    expect(milestoneWbs('Cranes operational', pk)).toBeNull();
    expect(milestoneWbs('Something else', pk)).toBeNull();
  });
  it('status rule', () => {
    expect(milestoneStatusOf({ complete: true, slipDays: 30, daysToBaseline: -10 })).toBe('done');
    expect(milestoneStatusOf({ complete: false, slipDays: 9, daysToBaseline: 100 })).toBe('late');
    expect(milestoneStatusOf({ complete: false, slipDays: 8, daysToBaseline: 100 })).toBe('at_risk');
    expect(milestoneStatusOf({ complete: false, slipDays: 0, daysToBaseline: 42 })).toBe('at_risk');
    expect(milestoneStatusOf({ complete: false, slipDays: 0, daysToBaseline: 43 })).toBe('on_track');
    expect(milestoneStatusOf({ complete: false, slipDays: null, daysToBaseline: null })).toBe('on_track');
  });
  it('Handover after the HLT-026 Reschedule: 18 Jan 2027 vs 18 Dec 2026 → late by 19 working days', () => {
    const m = rollUpMilestone({ finish: '2027-01-18', complete: false, baselineFinish: '2026-12-18' }, 0, '2026-09-25', std);
    expect(m).toEqual({ forecastMonth: 12.5867, baselineMonth: 11.5867, status: 'late', slipDays: 19, onTime: false });
    expect([dateOf(m.forecastMonth), dateOf(m.baselineMonth!)]).toEqual(['18 Jan ’27', '18 Dec']);
  });
});

describe('header texts', () => {
  it('prototype forms', () => {
    expect([floatDaysText(-27), floatDaysText(2), floatDaysText(0)]).toEqual(['−27 days', '+2 days', '0 days']);
    expect([floatShortText(-19), floatShortText(11)]).toEqual(['−19 d', '+11 d']);
    expect(critPackagesText(3, 8)).toBe('3 of 8 packages critical');
  });
  it('project float = lowest float of the unfinished activities', () => {
    expect(projectFloat([null, -19, 1, 61])).toBe(-19);
    expect(projectFloat([null, null])).toBe(0);
  });
});
