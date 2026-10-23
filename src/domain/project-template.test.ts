import { describe, expect, it } from 'vitest';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar } from './calendar';
import {
  TEMPLATE_ACTIVITY_DAYS, WIZARD_REQUIRED, defaultPlannedFinish, defaultPlannedStart, holidaysText, instantiateTemplate, monthOfIso, plannedWindowError, shareDays, templateActivitiesText, templatePlanShape, templateWbsText,
  wizardSiteError, wizardWindowError, workingTimeText,
} from './project-template';

const std = new WorkCalendar(BUILTIN_CALENDAR_BY_CODE.standard_5x8);

describe('machine-type template instantiation (A-2 / L-3)', () => {
  it('describes what is created', () => {
    expect([templateWbsText(6), templateActivitiesText(6), templateWbsText(1), templateActivitiesText(1), templateWbsText(0), templateActivitiesText(0)])
      .toEqual(['6 phases · 6 work packages', '6 activities · 5 links', '1 phase · 1 work package', '1 activity · 0 links', 'Empty', 'None']);
  });

  it('default planned window from the business date (R-013): the prototype\'s 11 Jan → 30 Sep 2027 on 25 Sep 2026', () => {
    expect([defaultPlannedStart('2026-09-25'), defaultPlannedFinish('2026-09-25')]).toEqual(['2027-01-11', '2027-09-30']);
    // Later dates move the window: start the Monday after today + 15 weeks, finish the end of the month a year later.
    expect([defaultPlannedStart('2026-12-14'), defaultPlannedFinish('2026-12-14'), defaultPlannedFinish('2027-02-03')]).toEqual(['2027-04-05', '2027-12-31', '2028-02-29']);
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

// R-185 (choice 2 of 23 Oct 2026): phases common to the project + lots specific to an equipment generated per line.
describe('lots per equipment line (R-185)', () => {
  const EMP = [
    { name: 'Études', perEquipment: false }, { name: 'Fabrication', perEquipment: true }, { name: 'Montage', perEquipment: true },
    { name: 'Essais', perEquipment: false }, { name: 'Réception', perEquipment: false },
  ];
  const line = (ref: string, label: string, phases: string[]) => ({ ref, label, phases });

  it('one line: the plan before R-185 (same packages, activities, dates and links), its lots marked with the line', () => {
    const before = instantiateTemplate({ phases: EMP.map((p) => p.name), start: '2027-01-11', finish: '2027-03-05', calendar: std, budgetKeur: 500 });
    const after = instantiateTemplate({
      phases: EMP, equipments: [line('EQ-01', 'EQ-01 · EMP', ['Fabrication', 'Montage'])], start: '2027-01-11', finish: '2027-03-05', calendar: std, budgetKeur: 500,
    });
    const strip = <T extends { equipment?: string }>(xs: T[]) => xs.map((x) => { const y = { ...x }; delete y.equipment; return y; });
    expect(strip(after.packages)).toEqual(before.packages);
    expect(strip(after.activities)).toEqual(before.activities);
    expect(after.links).toEqual(before.links);
    expect(after.packages.map((p) => p.equipment ?? null)).toEqual([null, 'EQ-01', 'EQ-01', null, null]);
    expect(after.activities.map((a) => a.equipment ?? null)).toEqual([null, 'EQ-01', 'EQ-01', null, null]);
  });

  it('several lines: one lot per line and phase of ITS type, the lines in parallel, chained inside each line', () => {
    const plan = instantiateTemplate({
      phases: EMP,
      equipments: [line('EQ-01', 'EQ-01 · EMP', ['Fabrication', 'Montage']), line('EQ-02', 'EQ-02 · 3 × MEMU', ['Modules', 'Assemblage', 'Essais plateforme'])],
      start: '2027-01-11', finish: null, calendar: std, budgetKeur: 800,
    });
    expect(plan.packages.map((p) => [p.code, p.name, p.equipment ?? null])).toEqual([
      ['1.1', 'Études', null],
      ['1.2', 'Fabrication — EQ-01 · EMP', 'EQ-01'],
      ['1.3', 'Montage — EQ-01 · EMP', 'EQ-01'],
      ['1.4', 'Modules — EQ-02 · 3 × MEMU', 'EQ-02'],
      ['1.5', 'Assemblage — EQ-02 · 3 × MEMU', 'EQ-02'],
      ['1.6', 'Essais plateforme — EQ-02 · 3 × MEMU', 'EQ-02'],
      ['1.7', 'Essais', null],
      ['1.8', 'Réception', null],
    ]);
    const a = Object.fromEntries(plan.activities.map((x) => [x.wbs, x]));
    // The lines start together after the common phase; the block lasts its longest line (3 slots); Essais waits for both lines.
    expect(a['1.2'].startDate).toBe(a['1.4'].startDate);
    expect(a['1.3'].startDate).toBe(a['1.5'].startDate);
    expect(a['1.7'].startDate > a['1.6'].finishDate).toBe(true);
    expect(plan.activities.every((x) => x.durationDays === TEMPLATE_ACTIVITY_DAYS)).toBe(true);
    expect(plan.activities.map((x) => x.code)).toEqual(['A1010', 'A1020', 'A1030', 'A1040', 'A1050', 'A1060', 'A1070', 'A1080']);
    expect(plan.links.map((l) => `${l.predecessor}>${l.successor}`)).toEqual([
      'A1010>A1020', 'A1020>A1030', 'A1010>A1040', 'A1040>A1050', 'A1050>A1060', 'A1030>A1070', 'A1060>A1070', 'A1070>A1080',
    ]);
    expect(plan.activities.reduce((s, x) => s + x.budgetKeur, 0)).toBe(800);
    expect(templatePlanShape({ phases: EMP, equipments: [line('EQ-01', '', ['Fabrication', 'Montage']), line('EQ-02', '', ['Modules', 'Assemblage', 'Essais plateforme'])] }))
      .toEqual({ packages: 8, activities: 8, links: 8 });
    expect([templateWbsText(5, 8), templateActivitiesText(5, { activities: 8, links: 8 })]).toEqual(['5 phases · 8 work packages', '8 activities · 8 links']);
  });

  it('a planned window is shared between the time slots (a block counts its longest line)', () => {
    const plan = instantiateTemplate({
      phases: EMP, equipments: [line('EQ-01', 'a', ['Fabrication', 'Montage']), line('EQ-02', 'b', ['Modules'])], start: '2027-01-11', finish: '2027-03-05', calendar: std, budgetKeur: 0,
    });
    // 40 working days over 5 slots (Études, 2 block slots, Essais, Réception): 8 each.
    expect(plan.activities.map((x) => x.durationDays)).toEqual([8, 8, 8, 8, 8, 8]);
    expect([plan.startDate, plan.finishDate]).toEqual(['2027-01-11', '2027-03-05']);
  });

  it('a main type without lots per equipment: the block of the other lines comes after its phases; lines without lots add nothing', () => {
    const rnd = [{ name: 'Exploration' }, { name: 'Bilan' }];
    const plan = instantiateTemplate({
      phases: rnd, equipments: [line('EQ-01', 'EQ-01 · R&D', []), line('EQ-02', 'EQ-02 · EMP', ['Fabrication'])], start: '2027-01-11', finish: null, calendar: std, budgetKeur: 0,
    });
    expect(plan.packages.map((p) => [p.name, p.equipment ?? null])).toEqual([['Exploration', null], ['Bilan', null], ['Fabrication — EQ-02 · EMP', 'EQ-02']]);
    expect(plan.links.map((l) => `${l.predecessor}>${l.successor}`)).toEqual(['A1010>A1020', 'A1020>A1030']);
    expect(instantiateTemplate({ phases: rnd, equipments: [line('EQ-01', '', [])], start: '2027-01-11', finish: null, calendar: std, budgetKeur: 0 }).packages).toHaveLength(2);
  });
});
