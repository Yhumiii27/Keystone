import { describe, expect, it } from 'vitest';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar } from './calendar';
import {
  TEMPLATE_ACTIVITY_DAYS, WIZARD_REQUIRED, holidaysText, instantiateTemplate, monthOfIso, plannedWindowError, shareDays, templateActivitiesText, templateWbsText,
  wizardSiteError, wizardWindowError, workingTimeText,
} from './project-template';

const std = new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8);

describe('machine-type template instantiation (A-2 / L-3)', () => {
  it('describes what is created', () => {
    expect([templateWbsText(6), templateActivitiesText(6), templateWbsText(1), templateActivitiesText(1), templateWbsText(0), templateActivitiesText(0)])
      .toEqual(['6 phases · 6 work packages', '6 activities · 5 links', '1 phase · 1 work package', '1 activity · 0 links', 'Empty', 'None']);
  });

  it('validates the planned window', () => {
    expect(plannedWindowError('2027-01-11', '2027-09-30')).toBeNull();
    expect(plannedWindowError('2027-01-11', '2027-01-11')).toBe('The planned finish must be after the planned start');
    expect(plannedWindowError('2027-02-30', '2027-09-30')).toBe('Enter the planned start and finish dates');
    expect(plannedWindowError(undefined, '2027-09-30')).toBe('Enter the planned start and finish dates');
    expect(plannedWindowError('2027-01-11', '2045-01-01')).toBe('The planned window is too long');
    expect(monthOfIso('2027-01-11')).toEqual({ text: 'Jan 2027', month: 12 });
    expect(monthOfIso('2027-09-30')).toEqual({ text: 'Sep 2027', month: 20 });
  });

  it('L-3b: required name, client, PM, type, start and location; the planned finish is optional', () => {
    expect(WIZARD_REQUIRED).toEqual({ name: true, client: true, pm: true, type: true, start: true, location: true, finish: false });
    expect(wizardWindowError('2027-01-11', '')).toBeNull();
    expect(wizardWindowError('2027-01-11', null)).toBeNull();
    expect(wizardWindowError('', '')).toBe('Enter the planned start date');
    expect(wizardWindowError('2027-01-11', '2027-01-01')).toBe('The planned finish must be after the planned start');
    const countries = ['France', 'Morocco'];
    expect(wizardSiteError('Le Havre', 'France', countries)).toBeNull();
    expect(wizardSiteError('  ', 'France', countries)).toBe('Enter the site city');
    expect(wizardSiteError('x'.repeat(121), 'France', countries)).toBe('The site city is too long');
    expect(wizardSiteError('Lyon', 'Atlantis', countries)).toBe('Choose the site country among the proposed countries');
  });

  it('L-3b: without a planned finish, each template activity lasts TEMPLATE_ACTIVITY_DAYS and the plan gives the finish', () => {
    const plan = instantiateTemplate({ phases: ['A', 'B'], start: '2027-01-11', finish: null, calendar: std, budgetKeur: 0 });
    expect(plan.activities.map((a) => a.durationDays)).toEqual([TEMPLATE_ACTIVITY_DAYS, TEMPLATE_ACTIVITY_DAYS]);
    // 60 working days from Mon 11 Jan 2027: 12 weeks to Fri 2 Apr, plus Easter Monday 29 Mar: Mon 5 Apr.
    expect([plan.startDate, plan.finishDate]).toEqual(['2027-01-11', '2027-04-05']);
  });

  it('shares the working days evenly (remainder first, at least 1)', () => {
    expect(shareDays(10, 3)).toEqual([4, 3, 3]);
    expect(shareDays(2, 4)).toEqual([1, 1, 1, 1]);
    expect(shareDays(5, 0)).toEqual([]);
  });

  it('chains one activity per phase finish-to-start across the planned window', () => {
    const plan = instantiateTemplate({ phases: ['Études', 'Fabrication', ' ', 'Essais'], start: '2027-01-11', finish: '2027-03-05', calendar: std, budgetKeur: 300 });
    expect(plan.packages).toEqual([{ code: '1.1', name: 'Études' }, { code: '1.2', name: 'Fabrication' }, { code: '1.3', name: 'Essais' }]);
    expect(plan.activities.map((a) => [a.code, a.wbs, a.name, a.durationDays, a.startDate, a.finishDate, a.budgetKeur])).toEqual([
      ['A1010', '1.1', 'Études', 14, '2027-01-11', '2027-01-28', 100],
      ['A1020', '1.2', 'Fabrication', 13, '2027-01-29', '2027-02-16', 100],
      ['A1030', '1.3', 'Essais', 13, '2027-02-17', '2027-03-05', 100],
    ]);
    expect(plan.links).toEqual([
      { predecessor: 'A1010', successor: 'A1020', type: 'FS', lagDays: 0 },
      { predecessor: 'A1020', successor: 'A1030', type: 'FS', lagDays: 0 },
    ]);
    expect([plan.startDate, plan.finishDate]).toEqual(['2027-01-11', '2027-03-05']);
    // 40 working days from 11 Jan to 5 Mar 2027 on the Standard calendar.
    expect(std.durationOf('2027-01-11', '2027-03-05')).toBe(40);
  });

  it('starts on a working day and skips French public holidays', () => {
    const plan = instantiateTemplate({ phases: ['A', 'B'], start: '2027-05-01', finish: '2027-05-31', calendar: std, budgetKeur: 0 });
    // 1 May 2027 is a Saturday (and Labour Day): the first activity starts Monday 3 May.
    expect(plan.activities[0].startDate).toBe('2027-05-03');
    expect(plan.activities.every((a) => std.isWorkDay(a.startDate) && std.isWorkDay(a.finishDate))).toBe(true);
    expect(instantiateTemplate({ phases: [], start: '2027-01-11', finish: '2027-09-30', calendar: std, budgetKeur: 10 })).toEqual({ packages: [], activities: [], links: [], startDate: null, finishDate: null });
  });

  it('states the real working time and holidays of the calendar', () => {
    expect(['standard_5x8', 'site_6x10', 'continuous_24h'].map((c) => workingTimeText(BUILTIN_CALENDAR_BY_CODE[c])))
      .toEqual(['Mon–Fri · 8 h a day', 'Mon–Sat · 10 h a day', '7 days · 24 h a day']);
    expect([holidaysText(BUILTIN_CALENDAR_BY_CODE.standard_5x8), holidaysText(BUILTIN_CALENDAR_BY_CODE.continuous_24h)])
      .toEqual(['French public holidays + Settings holidays', 'Holidays are worked']);
  });
});
