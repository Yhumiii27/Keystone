// R-031 (NEW-CURSUS-4 "a"): an absence received from Cursus is split per week with the week's working days lost (weekdays
// inside the absence minus the public holidays of Settings); its replacement key; the overlap helper R-119 uses.
import { describe, expect, it } from 'vitest';
import { LEAVE_TYPE_ROWS, absenceKey, absenceOverlapsRotation, absenceWeeks, isIsoDate, mondayOf } from './absences';

const NONE = new Set<string>();

describe('absenceWeeks', () => {
  it('one week, Monday to Friday: 5 days; a weekend alone: nothing', () => {
    expect(absenceWeeks('2026-10-12', '2026-10-16', NONE)).toEqual([{ weekStart: '2026-10-12', startDate: '2026-10-12', endDate: '2026-10-16', days: 5 }]);
    expect(absenceWeeks('2026-10-17', '2026-10-18', NONE)).toEqual([]);
  });

  it('over two weeks from a Wednesday, with 11 Nov (a Wednesday) as a public holiday', () => {
    expect(absenceWeeks('2026-11-04', '2026-11-13', new Set(['2026-11-11']))).toEqual([
      { weekStart: '2026-11-02', startDate: '2026-11-04', endDate: '2026-11-08', days: 3 },
      { weekStart: '2026-11-09', startDate: '2026-11-09', endDate: '2026-11-13', days: 4 },
    ]);
  });

  it('refuses impossible dates, an end before the start, and an absence of more than 400 days', () => {
    expect(() => absenceWeeks('2026-02-30', '2026-03-02', NONE)).toThrow('Invalid absence dates');
    expect(() => absenceWeeks('2026-10-14', '2026-10-12', NONE)).toThrow('ends before it starts');
    expect(() => absenceWeeks('2026-01-01', '2027-03-01', NONE)).toThrow('too long');
  });

  it('dates and Mondays', () => {
    expect([isIsoDate('2026-10-12'), isIsoDate('2026-13-01'), isIsoDate('12/10/2026'), isIsoDate(42)]).toEqual([true, false, false, false]);
    expect([mondayOf('2026-10-12'), mondayOf('2026-10-18'), mondayOf('2026-10-14')]).toEqual(['2026-10-12', '2026-10-12', '2026-10-12']);
  });
});

describe('keys and types', () => {
  it('the Cursus id when given, else matricule + dates', () => {
    expect(absenceKey({ id: 'ABS-1', matricule: 'EMP-1', start: '2026-10-12', end: '2026-10-13' })).toBe('cursus:ABS-1');
    expect(absenceKey({ id: ' ', matricule: 'EMP-1', start: '2026-10-12', end: '2026-10-13' })).toBe('EMP-1|2026-10-12|2026-10-13');
  });

  it('two types only (NEW-CURSUS-4, R-173)', () => {
    expect(LEAVE_TYPE_ROWS.map((t) => [t.code, t.label])).toEqual([['leave', 'Leave'], ['absence', 'Absence']]);
  });

  it('absenceOverlapsRotation (inclusive dates)', () => {
    const rot = { from: '2026-10-19', to: '2026-11-13' };
    expect(absenceOverlapsRotation({ start: '2026-10-12', end: '2026-10-19' }, rot)).toBe(true);
    expect(absenceOverlapsRotation({ start: '2026-11-13', end: '2026-11-20' }, rot)).toBe(true);
    expect(absenceOverlapsRotation({ start: '2026-10-12', end: '2026-10-18' }, rot)).toBe(false);
  });
});
