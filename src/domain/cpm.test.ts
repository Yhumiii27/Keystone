import { describe, expect, it } from 'vitest';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar, type CalendarDef } from './calendar';
import {
  CpmCycleError, CpmInputError, changedActivities, detectCycle, remainingDuration, schedule, topologicalOrder,
  type CpmActivityInput, type CpmInput, type CpmLinkInput,
} from './cpm';

// Mon–Fri without public holidays keeps textbook arithmetic readable. 5 Jan 2026 is a Monday.
const MF: CalendarDef = { code: 'mf', name: 'Mon–Fri', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidaySet: null, useSettingsHolidays: false };
const cals = () => ({
  mf: new WorkCalendar(MF),
  std: new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8),
  site: new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.site_6x10),
  cont: new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.continuous_24h),
});
const A = (id: string, duration: number, extra: Partial<CpmActivityInput> = {}): CpmActivityInput => ({ id, duration, ...extra });
const L = (pred: string, succ: string, type: CpmLinkInput['type'] = 'FS', lag = 0): CpmLinkInput => ({ pred, succ, type, lag });
const run = (activities: CpmActivityInput[], links: CpmLinkInput[], extra: Partial<CpmInput> = {}) =>
  schedule({ dataDate: '2026-01-05', projectCalendar: 'mf', calendars: cals(), activities, links, ...extra });
const dates = (r: ReturnType<typeof run>, id: string) => [r.activities[id].start, r.activities[id].finish];

describe('textbook network (FS)', () => {
  const r = run([A('A', 3), A('B', 2), A('C', 4), A('D', 2)], [L('A', 'B'), L('A', 'C'), L('B', 'D'), L('C', 'D')]);
  it('forward pass', () => {
    expect(dates(r, 'A')).toEqual(['2026-01-05', '2026-01-07']);
    expect(dates(r, 'B')).toEqual(['2026-01-08', '2026-01-09']);
    expect(dates(r, 'C')).toEqual(['2026-01-08', '2026-01-13']);
    expect(dates(r, 'D')).toEqual(['2026-01-14', '2026-01-15']);
    expect([r.projectStart, r.projectFinish]).toEqual(['2026-01-05', '2026-01-15']);
  });
  it('backward pass, floats and critical path', () => {
    expect([r.activities.B.lateStart, r.activities.B.lateFinish]).toEqual(['2026-01-12', '2026-01-13']);
    expect(Object.values(r.activities).map((a) => [a.id, a.totalFloat, a.freeFloat, a.critical])).toEqual([
      ['A', 0, 0, true], ['B', 2, 2, false], ['C', 0, 0, true], ['D', 0, 0, true],
    ]);
    expect(r.order).toEqual(['A', 'B', 'C', 'D']);
    expect(r.criticalPath).toEqual(['A', 'C', 'D']);
  });
  it('driving predecessors', () => {
    expect(r.activities.D.drivingPredecessors).toEqual(['C']);
    expect(r.activities.B.drivingPredecessors).toEqual(['A']);
    expect(r.drivingLinks).toEqual(['A>B', 'A>C', 'C>D']);
  });
  it('is deterministic: a second run changes nothing', () => {
    const again = run([A('A', 3), A('B', 2), A('C', 4), A('D', 2)], [L('A', 'B'), L('A', 'C'), L('B', 'D'), L('C', 'D')]);
    expect(again).toEqual(r);
    expect(changedActivities(r.activities, again)).toEqual([]);
    const longer = run([A('A', 3), A('B', 5), A('C', 4), A('D', 2)], [L('A', 'B'), L('A', 'C'), L('B', 'D'), L('C', 'D')]);
    expect(changedActivities(r.activities, longer)).toEqual(['B', 'C', 'D']);
  });
});

describe('link types and lags', () => {
  it('SS with lag', () => {
    const r = run([A('A', 10), A('B', 5)], [L('A', 'B', 'SS', 3)]);
    expect(dates(r, 'B')).toEqual(['2026-01-08', '2026-01-14']);
    expect(r.activities.B.drivingPredecessors).toEqual(['A']);
  });
  it('FF with lag', () => {
    const r = run([A('A', 5), A('B', 3)], [L('A', 'B', 'FF', 2)]);
    expect(dates(r, 'B')).toEqual(['2026-01-09', '2026-01-13']);
    expect(r.activities.B.drivingPredecessors).toEqual(['A']);
  });
  it('SF with lag', () => {
    const r = run([A('A', 5), A('B', 2)], [L('A', 'B', 'SF', 5)]);
    expect(dates(r, 'B')).toEqual(['2026-01-08', '2026-01-09']);
  });
  it('negative lag (lead)', () => {
    const r = run([A('A', 5), A('B', 3)], [L('A', 'B', 'FS', -2)]);
    expect(dates(r, 'B')).toEqual(['2026-01-08', '2026-01-12']);
  });
  it('a lead never schedules before the data date', () => {
    const r = run([A('A', 2), A('B', 3)], [L('A', 'B', 'FS', -10)]);
    expect(dates(r, 'B')).toEqual(['2026-01-05', '2026-01-07']);
    expect(r.activities.B.drivingPredecessors).toEqual([]);
  });
  it('the latest predecessor drives (several link types)', () => {
    const r = run([A('A', 5), A('B', 8), A('C', 4)], [L('A', 'C', 'FS', 0), L('B', 'C', 'FF', 0)]);
    // FS from A → start 12 Jan; FF from B (finish 14 Jan) → finish ≥ 14 Jan; start 12 Jan + 4 days = finish 15 Jan wins.
    expect(dates(r, 'C')).toEqual(['2026-01-12', '2026-01-15']);
    expect(r.activities.C.drivingPredecessors).toEqual(['A']);
  });
  it('milestones are dated at the start of the next working day', () => {
    const r = run([A('A', 5), A('M', 0), A('B', 2)], [L('A', 'M'), L('M', 'B')]);
    expect(dates(r, 'M')).toEqual(['2026-01-12', '2026-01-12']);
    expect(dates(r, 'B')).toEqual(['2026-01-12', '2026-01-13']);
    expect(r.activities.M.totalFloat).toBe(0);
  });
});

describe('constraints', () => {
  it('SNET (also on a weekend date)', () => {
    expect(dates(run([A('A', 2, { constraint: { type: 'SNET', date: '2026-01-14' } })], []), 'A')).toEqual(['2026-01-14', '2026-01-15']);
    expect(dates(run([A('A', 2, { constraint: { type: 'SNET', date: '2026-01-10' } })], []), 'A')).toEqual(['2026-01-12', '2026-01-13']);
  });
  it('FNLT missed → negative float and violation', () => {
    const r = run([A('A', 5), A('B', 5, { constraint: { type: 'FNLT', date: '2026-01-14' } })], [L('A', 'B')]);
    expect(dates(r, 'B')).toEqual(['2026-01-12', '2026-01-16']);
    expect(r.activities.B.violation).toEqual({ type: 'FNLT', date: '2026-01-14', days: 2 });
    expect([r.activities.A.totalFloat, r.activities.B.totalFloat]).toEqual([-2, -2]);
    expect(r.criticalPath).toEqual(['A', 'B']);
  });
  it('FNLT met → positive float', () => {
    const r = run([A('A', 5, { constraint: { type: 'FNLT', date: '2026-01-16' } })], [], { mustFinishBy: '2026-01-30' });
    expect(r.activities.A.totalFloat).toBe(5);
    expect(r.activities.A.violation).toBeNull();
  });
  it('SNLT', () => {
    const r = run([A('A', 5), A('B', 2, { constraint: { type: 'SNLT', date: '2026-01-09' } })], [L('A', 'B')]);
    expect(r.activities.B.violation).toEqual({ type: 'SNLT', date: '2026-01-09', days: 1 });
    expect(r.activities.B.totalFloat).toBe(-1);
  });
  it('FNET', () => {
    expect(dates(run([A('A', 2, { constraint: { type: 'FNET', date: '2026-01-09' } })], []), 'A')).toEqual(['2026-01-08', '2026-01-09']);
  });
  it('MSO overrides logic and reports the conflict', () => {
    const r = run([A('A', 5), A('B', 2, { constraint: { type: 'MSO', date: '2026-01-07' } })], [L('A', 'B')]);
    expect(dates(r, 'B')).toEqual(['2026-01-07', '2026-01-08']);
    expect(r.activities.B.violation).toEqual({ type: 'MSO', date: '2026-01-07', days: 3 });
  });
  it('MFO later than logic: no violation, float upstream', () => {
    const r = run([A('A', 5), A('B', 2, { constraint: { type: 'MFO', date: '2026-01-20' } })], [L('A', 'B')]);
    expect(dates(r, 'B')).toEqual(['2026-01-19', '2026-01-20']);
    expect(r.activities.B.violation).toBeNull();
    expect([r.activities.A.totalFloat, r.activities.B.totalFloat]).toEqual([5, 0]);
  });
  it('ASAP or null = no constraint', () => {
    expect(dates(run([A('A', 2, { constraint: { type: 'ASAP' } })], []), 'A')).toEqual(['2026-01-05', '2026-01-06']);
  });
  it('project deadline (must finish by)', () => {
    expect(run([A('A', 5)], [], { mustFinishBy: '2026-01-16' }).activities.A.totalFloat).toBe(5);
    expect(run([A('A', 5)], [], { mustFinishBy: '2026-01-07' }).activities.A.totalFloat).toBe(-2);
  });
  it('project start', () => {
    expect(dates(run([A('A', 2)], [], { projectStart: '2026-02-02' }), 'A')).toEqual(['2026-02-02', '2026-02-03']);
  });
});

describe('progress at the data date', () => {
  const acts = [
    A('A', 5, { actualStart: '2026-01-05', actualFinish: '2026-01-09', percentComplete: 100 }),
    A('B', 10, { actualStart: '2026-01-12', percentComplete: 30 }),
    A('C', 3),
  ];
  const r = run(acts, [L('A', 'B'), L('B', 'C')], { dataDate: '2026-01-14' });
  it('keeps actuals, schedules the remaining work from the data date', () => {
    expect(r.activities.A).toMatchObject({ state: 'complete', start: '2026-01-05', finish: '2026-01-09', totalFloat: null, freeFloat: null, critical: false });
    expect(r.activities.B).toMatchObject({ state: 'in_progress', start: '2026-01-12', remainingStart: '2026-01-14', remaining: 7, finish: '2026-01-22', totalFloat: 0 });
    expect(dates(r, 'C')).toEqual(['2026-01-23', '2026-01-27']);
    expect(r.criticalPath).toEqual(['B', 'C']);
  });
  it('remaining duration entered by the user wins over % complete', () => {
    const r2 = run([A('B', 10, { actualStart: '2026-01-12', percentComplete: 30, remaining: 2 })], [], { dataDate: '2026-01-14' });
    expect(dates(r2, 'B')).toEqual(['2026-01-12', '2026-01-15']);
  });
  it('unstarted work never starts before the data date', () => {
    const r2 = run([A('C', 3)], [], { dataDate: '2026-01-14' });
    expect(dates(r2, 'C')).toEqual(['2026-01-14', '2026-01-16']);
  });

  const outOfSequence = [A('P', 10, { actualStart: '2026-01-05', percentComplete: 50 }), A('S', 6, { actualStart: '2026-01-12', percentComplete: 50 })];
  it('retained logic: an unfinished predecessor still drives the remaining work', () => {
    const r2 = run(outOfSequence, [L('P', 'S')], { dataDate: '2026-01-14' });
    expect(dates(r2, 'P')).toEqual(['2026-01-05', '2026-01-20']);
    expect(r2.activities.S).toMatchObject({ start: '2026-01-12', remainingStart: '2026-01-21', finish: '2026-01-23', drivingPredecessors: ['P'] });
  });
  it('progress override: the remaining work ignores its predecessors', () => {
    const r2 = run(outOfSequence, [L('P', 'S')], { dataDate: '2026-01-14', options: { progressMode: 'override' } });
    expect(r2.activities.S).toMatchObject({ start: '2026-01-12', remainingStart: '2026-01-14', finish: '2026-01-16', drivingPredecessors: [] });
  });
  it('remaining duration rounding', () => {
    expect(remainingDuration({ duration: 40, percentComplete: 72 })).toBe(11);
    expect(remainingDuration({ duration: 40, percentComplete: 72 }, 'ceil')).toBe(12);
    expect(remainingDuration({ duration: 40, percentComplete: 72 }, 'floor')).toBe(11);
    expect(remainingDuration({ duration: 40, percentComplete: 100 })).toBe(0);
    expect(remainingDuration({ duration: 40, percentComplete: 10, remaining: 3 })).toBe(3);
  });

  it('Harbor Line A1250 / A1260 (Standard calendar, data date 25 Sep 2026)', () => {
    const r2 = schedule({
      dataDate: '2026-09-25', projectCalendar: 'std', calendars: cals(),
      activities: [
        A('A1240', 30, { actualStart: '2026-07-20', actualFinish: '2026-08-28', percentComplete: 100 }),
        A('A1250', 40, { actualStart: '2026-08-17', percentComplete: 72 }),
        A('A1260', 25),
      ],
      links: [L('A1240', 'A1250'), L('A1250', 'A1260', 'FS', -5)],
    });
    expect(dates(r2, 'A1250')).toEqual(['2026-08-17', '2026-10-09']); // prototype "17 Aug A" → "09 Oct"
    expect(dates(r2, 'A1260')).toEqual(['2026-10-05', '2026-11-06']); // prototype "05 Oct" → "06 Nov"
  });
});

describe('calendars', () => {
  it('French holidays are skipped (Easter Monday)', () => {
    const r = run([A('A', 3, { calendar: 'std' })], [], { dataDate: '2026-04-02' });
    expect(dates(r, 'A')).toEqual(['2026-04-02', '2026-04-07']);
  });
  it('Standard → Chantier: the site successor starts on Saturday', () => {
    const r = run([A('A', 5, { calendar: 'std' }), A('B', 2, { calendar: 'site' })], [L('A', 'B')], { dataDate: '2026-09-21' });
    expect(dates(r, 'A')).toEqual(['2026-09-21', '2026-09-25']);
    expect(dates(r, 'B')).toEqual(['2026-09-26', '2026-09-28']);
  });
  it('Chantier → Standard: the office successor starts on Monday', () => {
    const r = run([A('A', 6, { calendar: 'site' }), A('B', 1, { calendar: 'std' })], [L('A', 'B')], { dataDate: '2026-09-21' });
    expect(dates(r, 'A')).toEqual(['2026-09-21', '2026-09-26']);
    expect(dates(r, 'B')).toEqual(['2026-09-28', '2026-09-28']);
    expect(r.activities.A.totalFloat).toBe(0);
  });
  it('lags count on the predecessor calendar by default, or on the successor calendar', () => {
    const acts = [A('A', 1, { calendar: 'cont' }), A('B', 1, { calendar: 'std' })];
    const links = [L('A', 'B', 'FS', 2)];
    expect(dates(run(acts, links, { dataDate: '2026-09-25' }), 'B')).toEqual(['2026-09-28', '2026-09-28']);
    expect(dates(run(acts, links, { dataDate: '2026-09-25', options: { lagCalendar: 'successor' } }), 'B')).toEqual(['2026-09-30', '2026-09-30']);
  });
  it('Continu works weekends and holidays', () => {
    expect(dates(run([A('A', 3, { calendar: 'cont' })], [], { dataDate: '2026-12-24' }), 'A')).toEqual(['2026-12-24', '2026-12-26']);
  });
});

describe('cycles and input errors', () => {
  it('detects a cycle', () => {
    const acts = [A('A', 1), A('B', 1), A('C', 1), A('D', 1)];
    const links = [L('A', 'B'), L('B', 'C'), L('C', 'A'), L('D', 'A')];
    expect(() => run(acts, links)).toThrow(CpmCycleError);
    try {
      run(acts, links);
    } catch (e) {
      expect((e as CpmCycleError).cycle).toEqual(['A', 'B', 'C', 'A']);
    }
    expect(detectCycle(['A', 'B', 'C'], [L('A', 'B'), L('B', 'C')])).toBeNull();
    expect(detectCycle(['A', 'B'], [L('A', 'B'), L('B', 'A', 'SS')])).toEqual(['A', 'B', 'A']);
  });
  it('topological order keeps input order among independent activities', () => {
    expect(topologicalOrder(['C', 'B', 'A'], [L('A', 'C')])).toEqual({ order: ['B', 'A', 'C'] });
  });
  it('reports invalid input', () => {
    try {
      run(
        [A('A', 1), A('A', 2), A('B', -1, { calendar: 'nope' }), A('C', 1, { constraint: { type: 'XYZ', date: '2026-01-05' } }), A('D', 1, { constraint: { type: 'SNET' } })],
        [L('A', 'Z'), L('B', 'B'), L('A', 'C'), L('A', 'C', 'SS')],
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CpmInputError);
      expect((e as CpmInputError).issues).toEqual([
        'Duplicate activity A',
        'B: duration must be a number ≥ 0',
        'B: unknown calendar "nope"',
        'C: unknown constraint "XYZ"',
        'D: constraint SNET needs a date',
        'Unknown successor Z',
        'B cannot be its own predecessor',
        'Duplicate link A → C',
      ]);
    }
    expect(() => schedule({ dataDate: '25 Sep', projectCalendar: 'mf', calendars: cals(), activities: [], links: [] })).toThrow(CpmInputError);
    expect(() => schedule({ dataDate: '2026-09-25', projectCalendar: 'x', calendars: cals(), activities: [], links: [] })).toThrow(/Unknown project calendar/);
  });
});

describe('scale', () => {
  it('schedules 2 000 chained activities quickly', () => {
    const n = 2000;
    const acts = Array.from({ length: n }, (_, i) => A(`A${i}`, 1 + (i % 5), { calendar: i % 3 === 0 ? 'site' : 'std' }));
    const links = acts.slice(1).map((a, i) => L(`A${i}`, a.id, (['FS', 'SS', 'FF'] as const)[i % 3], i % 4));
    const t0 = Date.now();
    const r = schedule({ dataDate: '2026-01-05', projectCalendar: 'std', calendars: cals(), activities: acts, links });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.order).toHaveLength(n);
    expect(r.activities.A1999.critical).toBe(true);
  });
});
