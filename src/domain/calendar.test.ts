import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CALENDARS, BUILTIN_CALENDAR_BY_CODE, WorkCalendar, addCalendarDays, builtinCalendars, calendarDaysBetween, daysForHours, easterSunday,
  frenchPublicHolidays, holidaysOf, isIsoDate, isoWeekday,
} from './calendar';

const std = () => new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8);
const site = () => new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.site_6x10);
const cont = () => new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.continuous_24h);

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('25 Sep')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it('adds calendar days and weekdays', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(calendarDaysBetween('2026-12-18', '2027-01-14')).toBe(27);
    expect(isoWeekday('2026-09-25')).toBe(5);
    expect(isoWeekday('2026-09-27')).toBe(7);
  });
});

describe('public holidays (metropolitan France)', () => {
  it.each([
    [2000, '2000-04-23'], [2024, '2024-03-31'], [2025, '2025-04-20'], [2026, '2026-04-05'], [2027, '2027-03-28'], [2038, '2038-04-25'], [2049, '2049-04-18'],
  ])('Easter %i is %s', (y, d) => expect(easterSunday(y)).toBe(d));

  it('2026 = the Settings list (SETTINGS0.holidays)', () => {
    expect(frenchPublicHolidays(2026).map((h) => [h.date, h.name])).toEqual([
      ['2026-01-01', 'Jour de l’an'], ['2026-04-06', 'Lundi de Pâques'], ['2026-05-01', 'Fête du travail'], ['2026-05-08', 'Victoire 1945'],
      ['2026-05-14', 'Ascension'], ['2026-05-25', 'Lundi de Pentecôte'], ['2026-07-14', 'Fête nationale'], ['2026-08-15', 'Assomption'],
      ['2026-11-01', 'Toussaint'], ['2026-11-11', 'Armistice'], ['2026-12-25', 'Noël'],
    ]);
  });
  it('2027 moves the Easter-based days', () => {
    const h = Object.fromEntries(frenchPublicHolidays(2027).map((x) => [x.name, x.date]));
    expect([h['Lundi de Pâques'], h.Ascension, h['Lundi de Pentecôte']]).toEqual(['2027-03-29', '2027-05-06', '2027-05-17']);
  });
  it('unknown or no set → none', () => {
    expect(holidaysOf(null, 2026)).toEqual([]);
    expect(holidaysOf('XX', 2026)).toEqual([]);
    expect(holidaysOf('FR', 2026)).toHaveLength(11);
  });
});

describe('built-in calendars (S-2)', () => {
  it('has the four default calendars', () => {
    expect(BUILTIN_CALENDARS.map((c) => [c.code, c.name, c.workDays.length, c.hoursPerDay, c.holidaySet])).toEqual([
      ['standard_5x8', 'Standard 5d · 8h', 5, 8, 'FR'],
      ['standard_5x8_workshop', 'Atelier 5d · 8h', 5, 8, 'FR'],
      ['site_6x10', 'Chantier 6d · 10h', 6, 10, 'FR'],
      ['continuous_24h', 'Continu 24h / 7d', 7, 24, null],
    ]);
    expect(Object.keys(builtinCalendars())).toEqual(BUILTIN_CALENDARS.map((c) => c.code));
  });

  it('Standard: Monday–Friday, French holidays off', () => {
    const c = std();
    expect(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map((d) => c.isWorkDay(d))).toEqual([true, false, false, true]);
    expect(c.isWorkDay('2026-04-06')).toBe(false); // Easter Monday
    expect(c.isWorkDay('2026-05-14')).toBe(false); // Ascension (Thursday)
    expect(c.isWorkDay('2026-11-11')).toBe(false);
    expect(c.isWorkDay('2026-11-12')).toBe(true);
  });

  it('Chantier: Saturday worked, Sunday and holidays off', () => {
    const c = site();
    expect(['2026-09-26', '2026-09-27', '2026-08-15', '2026-07-14'].map((d) => c.isWorkDay(d))).toEqual([true, false, false, false]);
  });

  it('Continu: every day, public holidays worked', () => {
    const c = cont();
    expect(['2026-09-26', '2026-09-27', '2026-12-25', '2026-01-01'].every((d) => c.isWorkDay(d))).toBe(true);
    expect(c.hoursPerDay).toBe(24);
  });

  it('lists the holidays of a year on a calendar', () => {
    expect(std().holidays(2026)).toHaveLength(11);
    expect(cont().holidays(2026)).toHaveLength(0);
  });
});

describe('working-day arithmetic', () => {
  it('ordinal and dateOf are inverse on working days', () => {
    const c = std();
    for (const d of ['2026-01-02', '2026-04-07', '2026-09-25', '2027-01-14']) expect(c.dateOf(c.ordinal(d))).toBe(d);
    expect(c.ordinal('2026-09-28') - c.ordinal('2026-09-25')).toBe(1);
  });

  it('next / previous working day', () => {
    const c = std();
    expect(c.nextWorkDay('2026-09-26')).toBe('2026-09-28');
    expect(c.nextWorkDay('2026-09-25')).toBe('2026-09-25');
    expect(c.previousWorkDay('2026-09-27')).toBe('2026-09-25');
    expect(c.previousWorkDay('2026-04-06')).toBe('2026-04-03');
    expect(c.nextWorkDay('2026-04-04')).toBe('2026-04-07');
  });

  it('adds working days across weekends and holidays (both directions)', () => {
    const c = std();
    expect(c.addWorkDays('2026-04-03', 1)).toBe('2026-04-07');
    expect(c.addWorkDays('2026-04-07', -1)).toBe('2026-04-03');
    expect(c.addWorkDays('2026-09-25', 5)).toBe('2026-10-02');
    expect(c.addWorkDays('2026-12-24', 1)).toBe('2026-12-28');
    expect(c.addWorkDays('2026-09-26', 0)).toBe('2026-09-28');
  });

  it('durations are inclusive working days', () => {
    const c = std();
    expect(c.durationOf('2026-01-05', '2026-03-06')).toBe(45); // A1010 Detailed design
    expect(c.durationOf('2026-03-09', '2026-04-17')).toBe(29); // Easter Monday inside
    expect(c.durationOf('2026-09-25', '2026-09-25')).toBe(1);
    expect(c.durationOf('2026-09-26', '2026-09-27')).toBe(0);
    expect(c.durationOf('2026-10-02', '2026-09-25')).toBe(0);
    expect(c.workDaysBetween('2026-12-18', '2027-01-14')).toBe(17); // 25 Dec and 1 Jan are holidays
  });

  it('finishOf / startOf', () => {
    const c = std();
    expect(c.finishOf('2026-08-17', 40)).toBe('2026-10-09'); // A1250 Steel erection — Bays 3–4
    expect(c.startOf('2026-10-09', 40)).toBe('2026-08-17');
    expect(c.finishOf('2026-09-26', 1)).toBe('2026-09-28');
    expect(c.finishOf('2026-09-25', 0)).toBe('2026-09-25');
    const s = site();
    expect(s.finishOf('2026-09-24', 3)).toBe('2026-09-26'); // Thu, Fri, Sat
    expect(cont().finishOf('2026-12-24', 3)).toBe('2026-12-26');
  });

  it('boundaries: start at 00:00 of a working day, end at 00:00 of the next day', () => {
    const c = std();
    const b = c.finishBoundary('2026-09-25');
    expect(c.endInstant(b)).toBe('2026-09-26');
    expect(c.startInstant(b)).toBe('2026-09-28');
    expect(c.startBoundary('2026-09-26')).toBe(c.startBoundary('2026-09-28'));
    expect(c.finishBoundary('2026-09-26')).toBe(c.finishBoundary('2026-09-25'));
  });

  it('works across years from 1990 to 2200 and refuses earlier dates', () => {
    const c = std();
    expect(c.isWorkDay('2099-12-31')).toBe(true);
    expect(c.dateOf(c.ordinal('2150-06-03'))).toBe('2150-06-03');
    expect(() => c.ordinal('1989-12-31')).toThrow(RangeError);
    expect(() => c.dateOf(-1)).toThrow(RangeError);
  });
});

describe('exceptions and Settings holidays', () => {
  it('exceptional working Saturday and extra closure', () => {
    const c = new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8, {
      exceptions: [{ date: '2026-09-26', working: true }, { date: '2026-09-28', working: false, name: 'Fermeture' }],
    });
    expect(c.isWorkDay('2026-09-26')).toBe(true);
    expect(c.isWorkDay('2026-09-28')).toBe(false);
    expect(c.addWorkDays('2026-09-25', 2)).toBe('2026-09-29');
    expect(c.holidays(2026).some((h) => h.date === '2026-09-28' && h.name === 'Fermeture')).toBe(true);
  });
  it('an exceptional working day overrides a public holiday', () => {
    const c = new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8, { exceptions: [{ date: '2026-11-11', working: true }] });
    expect(c.isWorkDay('2026-11-11')).toBe(true);
  });
  it('Settings holidays apply to calendars that use them, not to Continu', () => {
    const opts = { settingsHolidays: ['2026-12-24', 'not a date'] };
    expect(new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8, opts).isWorkDay('2026-12-24')).toBe(false);
    expect(new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.site_6x10, opts).isWorkDay('2026-12-24')).toBe(false);
    expect(new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.continuous_24h, opts).isWorkDay('2026-12-24')).toBe(true);
  });
  it('refuses a calendar without working day or with bad hours', () => {
    expect(() => new WorkCalendar({ code: 'x', name: 'x', workDays: [], hoursPerDay: 8, holidaySet: null, useSettingsHolidays: false })).toThrow(RangeError);
    expect(() => new WorkCalendar({ code: 'x', name: 'x', workDays: [1], hoursPerDay: 0, holidaySet: null, useSettingsHolidays: false })).toThrow(RangeError);
  });
});

describe('hours', () => {
  it('days for hours rounds up', () => {
    expect(daysForHours(80, 8)).toBe(10);
    expect(daysForHours(81, 8)).toBe(11);
    expect(daysForHours(80, 10)).toBe(8);
    expect(daysForHours(10, 0)).toBe(0);
  });
});
