// Week view, split by project (owner answer 17 Oct 2026, second round: « la répartition projet est à tirer des affectations
// projets »): the spreading rule of a schedule assignment over a week, the hours per project and person, and the cell text.
import { describe, expect, it } from 'vitest';
import { builtinCalendars } from './calendar';
import { assignmentHoursInWeek, weekLoad, weekProjectHours, weekSplitText, type WeekAssignment } from './load-week';

const cals = builtinCalendars();
const office = cals.standard_5x8;
const site = cals.site_6x10;
const asg = (o: Partial<WeekAssignment>): WeekAssignment => ({
  project: 'HLT-026', person: 'Julien Wagner', start: '2026-08-17', finish: '2026-10-09', units: 1, hoursPerDay: 8, plannedHours: 400, calendar: office, ...o,
});

describe('assignmentHoursInWeek', () => {
  it('units × h/d over the activity working days that fall in the week (A1250, 17 Aug – 9 Oct 2026)', () => {
    expect(assignmentHoursInWeek(asg({}), '2026-08-10')).toBe(0); // before the start
    expect(assignmentHoursInWeek(asg({}), '2026-08-17')).toBe(40);
    expect(assignmentHoursInWeek(asg({}), '2026-10-05')).toBe(40); // finishes Friday 9 Oct
    expect(assignmentHoursInWeek(asg({}), '2026-10-12')).toBe(0); // after the finish
    expect(assignmentHoursInWeek(asg({ start: '2026-09-23', finish: '2026-09-29' }), '2026-09-21')).toBe(24); // Wed–Fri
    expect(assignmentHoursInWeek(asg({ units: 6, hoursPerDay: 10 }), '2026-09-28')).toBe(300);
  });

  it('public holidays and non-working days are not loaded; a 6-day site calendar counts its Saturday', () => {
    expect(assignmentHoursInWeek(asg({ start: '2026-11-02', finish: '2026-11-20' }), '2026-11-09')).toBe(32); // Armistice, Wed 11 Nov
    expect(assignmentHoursInWeek(asg({ start: '2026-11-02', finish: '2026-11-20', calendar: site, hoursPerDay: 10 }), '2026-11-09')).toBe(50); // Mon, Tue, Thu–Sat
  });

  it('without a rate, the planned hours spread evenly over the activity working days', () => {
    // 17 Aug – 9 Oct = 40 working days; 400 h → 10 h a day.
    expect(assignmentHoursInWeek(asg({ units: null, hoursPerDay: null }), '2026-09-21')).toBe(50);
    expect(assignmentHoursInWeek(asg({ units: null, hoursPerDay: null, plannedHours: 100, start: '2026-09-21', finish: '2026-09-30' }), '2026-09-28')).toBe(37.5); // 3 of 8 days
  });

  it('nothing for an undated activity, inverted dates, or an assignment counted neither in rate nor in hours', () => {
    expect(assignmentHoursInWeek(asg({ start: null }), '2026-09-21')).toBe(0);
    expect(assignmentHoursInWeek(asg({ finish: null }), '2026-09-21')).toBe(0);
    expect(assignmentHoursInWeek(asg({ start: '2026-09-25', finish: '2026-09-21' }), '2026-09-21')).toBe(0);
    expect(assignmentHoursInWeek(asg({ units: 1, hoursPerDay: null, plannedHours: null }), '2026-09-21')).toBe(0);
    expect(assignmentHoursInWeek(asg({ start: '2026-09-26', finish: '2026-09-27' }), '2026-09-21')).toBe(0); // a weekend only
  });
});

describe('weekProjectHours and the cell text', () => {
  it('sums per person and project, largest first, zeros left out', () => {
    const rows = [
      asg({}),
      asg({ project: 'NDC-031', start: '2026-09-21', finish: '2026-09-22' }),
      asg({ project: 'NDC-031', start: '2026-09-24', finish: '2026-09-24', hoursPerDay: 4 }),
      asg({ project: 'ERP-202', start: '2027-01-04', finish: '2027-01-08' }),
      asg({ person: 'Léa Marchand', project: 'NDC-031', units: 2, hoursPerDay: 4 }),
    ];
    expect(weekProjectHours(rows, '2026-09-21')).toEqual({
      'Julien Wagner': [{ code: 'HLT-026', hours: 40 }, { code: 'NDC-031', hours: 20 }],
      'Léa Marchand': [{ code: 'NDC-031', hours: 40 }],
    });
    expect(weekProjectHours(rows, '2026-12-28')).toEqual({});
  });

  it('the load not covered is "not assigned", assignments above it "assigned beyond the load"', () => {
    expect(weekSplitText(weekLoad(130, [{ code: 'HLT-026', hours: 40 }]), 'en')).toBe('HLT-026 40 h · 12 h not assigned');
    expect(weekSplitText(weekLoad(130, [{ code: 'HLT-026', hours: 40 }]), 'fr')).toBe('HLT-026 40 h · 12 h non affectées');
    expect(weekSplitText(weekLoad(90, [{ code: 'HLT-026', hours: 40 }]), 'en')).toBe('HLT-026 40 h · 4 h assigned beyond the load');
    expect(weekSplitText(weekLoad(0, [{ code: 'HLT-026', hours: 40 }]), 'fr')).toBe('HLT-026 40 h · 40 h affectées au-delà de la charge');
    expect(weekSplitText(weekLoad(100, [{ code: 'NDC-031', hours: 12.5 }, { code: 'HLT-026', hours: 24 }]), 'fr')).toBe('HLT-026 24 h · NDC-031 12,5 h · 3,5 h non affectées');
    expect(weekSplitText(weekLoad(100, [{ code: 'HLT-026', hours: 40 }]), 'en')).toBe('HLT-026 40 h');
    // No assignment: nothing to split (the cell shows "—"), whatever the load.
    expect(weekLoad(130, [])).toMatchObject({ notAssignedH: 0, beyondH: 0 });
    expect(weekSplitText(weekLoad(130, []), 'en')).toBe('');
  });
});
