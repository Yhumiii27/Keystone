// R-084 (owner answers 17 Oct 2026, third round): load of people and demand by trade from the schedules' assignments; the
// activities that declare no resource at all. Owner answers 18 Oct 2026 (fourth round): external crews out of the load plan, the
// owner's 2 h/d whenever no EPC2i labour is assigned, the J-15 list of activities without an assignment.
import { describe, expect, it } from 'vitest';
import { builtinCalendars } from './calendar';
import {
  UNASSIGNED_ALERT_DAYS, isExternalLabour, isInternalLabour, isLabour, isMilestone, loadPctOfHours, needsWork, planningLoad, sumHours, tradeOfAssignment, tradeOfOwner,
  unassignedActivitiesAt, undeclaredActivities, type PlanActivity, type PlanAssignment,
} from './planning-load';

const std = builtinCalendars().standard_5x8;
const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];
const act = (over: Partial<PlanActivity> & Pick<PlanActivity, 'code'>): PlanActivity => ({
  project: 'HLT-026', name: over.code, start: '2026-09-21', finish: '2026-10-02', durationDays: 10, percentComplete: 0, owner: null, ownerTrade: null, calendar: std, ...over,
});
const asg = (over: Partial<PlanAssignment> & Pick<PlanAssignment, 'activity' | 'resource'>): PlanAssignment => ({
  project: 'HLT-026', person: null, department: null, units: 1, hoursPerDay: 8, plannedHours: null, ...over,
});

describe('rules', () => {
  it('a milestone or a complete activity needs no work', () => {
    expect([isMilestone({ durationDays: 0 }), isMilestone({ durationDays: 1 })]).toEqual([true, false]);
    expect([needsWork({ durationDays: 5, percentComplete: 99 }), needsWork({ durationDays: 5, percentComplete: 100 }), needsWork({ durationDays: 0, percentComplete: 0 })]).toEqual([true, false, false]);
  });

  it('trade of unnamed work: the assignment department, else the resource it names, else Other; an owner: their department, else Other', () => {
    expect(tradeOfAssignment({ department: 'MEP', resource: 'Electricians' })).toEqual({ trade: 'MEP', kind: 'department' });
    expect(tradeOfAssignment({ department: null, resource: ' Steel erection crew ' })).toEqual({ trade: 'Steel erection crew', kind: 'resource' });
    expect(tradeOfAssignment({ department: null, resource: '  ' })).toEqual({ trade: 'Other', kind: 'other' });
    expect(tradeOfOwner({ ownerTrade: 'Quality' })).toEqual({ trade: 'Quality', kind: 'department' });
    expect(tradeOfOwner({ ownerTrade: null })).toEqual({ trade: 'Other', kind: 'other' });
  });

  it('load % on the 40 h week, rounded', () => {
    expect([loadPctOfHours(40), loadPctOfHours(52), loadPctOfHours(18), loadPctOfHours(0), loadPctOfHours(10, 0)]).toEqual([100, 130, 45, 0, 0]);
    expect(sumHours([40, 40.1, 0.2])).toBe(80.3);
  });
});

describe('planningLoad', () => {
  it('per person and per week: units × h/d on the working days of the activity inside each week, every project summed', () => {
    const acts = [
      act({ code: 'A', start: '2026-09-21', finish: '2026-10-02' }), // 2 full weeks
      act({ project: 'NDC-031', code: 'B', start: '2026-09-30', finish: '2026-10-07' }), // Wed 30 Sep – Wed 7 Oct
    ];
    const l = planningLoad(acts, [
      asg({ activity: 'A', resource: 'Julien Wagner', person: 'jw', units: 1, hoursPerDay: 8 }),
      asg({ project: 'NDC-031', activity: 'B', resource: 'Julien Wagner', person: 'jw', units: 1, hoursPerDay: 4 }),
    ], WEEKS, 2);
    expect(l.weeks).toEqual(WEEKS);
    // Week of 28 Sep: 40 h on A + Wed–Fri 3 × 4 h on B = 52 h (130 %); week of 5 Oct: Mon–Wed 3 × 4 h = 12 h.
    expect(l.people.jw).toEqual([40, 52, 12, 0]);
    expect(l.people.jw.map((h) => loadPctOfHours(h))).toEqual([100, 130, 30, 0]);
    expect(l.personProjects.jw).toEqual({ 'HLT-026': [40, 40, 0, 0], 'NDC-031': [0, 12, 12, 0] });
    expect(l.trades).toEqual([]);
  });

  it('planned hours spread evenly when the rate is unknown; equipment and material add nothing', () => {
    const l = planningLoad([act({ code: 'A' })], [
      asg({ activity: 'A', resource: 'Hélène Sauvage', person: 'hs', units: null, hoursPerDay: null, plannedHours: 50 }),
      asg({ activity: 'A', resource: 'Mobile crane 250 t', units: 1, hoursPerDay: null }),
      asg({ activity: 'A', resource: 'Structural steel', units: null, hoursPerDay: null }),
    ], WEEKS, 2);
    expect(l.people.hs).toEqual([25, 25, 0, 0]);
    expect(l.trades).toEqual([]);
  });

  it('unnamed EPC2i assignments count against their department, not against a person; external crews are left out (18 Oct)', () => {
    const l = planningLoad([act({ code: 'A' }), act({ project: 'NDC-031', code: 'C', start: '2026-10-05', finish: '2026-10-09' })], [
      // « Les équipes externes ne rentrent pas dans le plan de charge »: no department → external, no demand anywhere.
      asg({ activity: 'A', resource: 'Steel erection crew', units: 6, hoursPerDay: 10 }),
      asg({ activity: 'A', resource: 'Electricians', department: 'MEP', units: 2, hoursPerDay: 8 }),
      asg({ project: 'NDC-031', activity: 'C', resource: 'Cable pullers', department: 'MEP', units: 1, hoursPerDay: 8 }),
    ], WEEKS, 2);
    expect(l.people).toEqual({});
    expect(l.trades.map((t) => [t.trade, t.kind, t.hours, t.unnamedH, t.ownersH])).toEqual([
      ['MEP', 'department', [80, 80, 40, 0], [80, 80, 40, 0], [0, 0, 0, 0]],
    ]);
    expect(l.trades[0].byProject).toEqual({ 'HLT-026': [80, 80, 0, 0], 'NDC-031': [0, 0, 40, 0] });
  });

  it('an activity whose only resource is its owner: 2 h per working day on the owner\'s trade, not on the owner', () => {
    const acts = [
      act({ code: 'O1', owner: 'dr', ownerTrade: 'Controls & planning' }),
      act({ code: 'O2', owner: 'ra', ownerTrade: null, start: '2026-10-05', finish: '2026-10-06' }),
      // Equipment only (or an external crew only): no EPC2i labour, so the owner's 2 h/d count (owner answer 18 Oct 2026).
      act({ code: 'O3', owner: 'dr', ownerTrade: 'Controls & planning' }),
      // An owner of an activity with EPC2i labour assigned adds nothing (the assignment is the declared resource).
      act({ code: 'O6', owner: 'dr', ownerTrade: 'Controls & planning' }),
      // A complete activity or a milestone adds nothing.
      act({ code: 'O4', owner: 'dr', ownerTrade: 'Controls & planning', percentComplete: 100 }),
      act({ code: 'O5', owner: 'dr', ownerTrade: 'Controls & planning', durationDays: 0 }),
    ];
    const l = planningLoad(acts, [
      asg({ activity: 'O3', resource: 'Mobile crane', hoursPerDay: null }),
      asg({ activity: 'O6', resource: 'Planners', department: 'Controls & planning', units: 1, hoursPerDay: 1 }),
    ], WEEKS, 2);
    expect(l.people).toEqual({});
    // O1 + O3 at 2 h/d, O6's own 1 h/d (not its owner's share).
    expect(l.trades.map((t) => [t.trade, t.kind, t.hours, t.ownersH])).toEqual([
      ['Controls & planning', 'department', [25, 25, 0, 0], [20, 20, 0, 0]],
      ['Other', 'other', [0, 0, 4, 0], [0, 0, 4, 0]],
    ]);
  });

  it('a complete activity puts no load on its assignee; an undated one neither; a public holiday is not worked', () => {
    const l = planningLoad([
      act({ code: 'D', percentComplete: 100 }),
      act({ code: 'U', start: null, finish: null }),
      act({ code: 'H', start: '2026-11-09', finish: '2026-11-13', calendar: { isWorkDay: (d: string) => d !== '2026-11-11' && std.isWorkDay(d) } }),
    ], [
      asg({ activity: 'D', resource: 'P', person: 'p' }), asg({ activity: 'U', resource: 'P', person: 'p' }), asg({ activity: 'H', resource: 'P', person: 'p' }),
    ], ['2026-11-09'], 2);
    // 11 Nov (Armistice) off in the activity's calendar: 4 working days.
    expect(l.people.p).toEqual([32]);
  });
});

describe('undeclaredActivities (owner answer B: an alert)', () => {
  it('needs work, no assignment and no owner', () => {
    const acts = [
      act({ code: 'NONE' }),
      act({ code: 'OWNED', owner: 'dr' }),
      act({ code: 'ASSIGNED' }),
      act({ code: 'EQUIP' }),
      act({ code: 'DONE', percentComplete: 100 }),
      act({ code: 'MILESTONE', durationDays: 0 }),
      act({ project: 'NDC-031', code: 'NONE' }),
    ];
    const out = undeclaredActivities(acts, [
      { project: 'HLT-026', activity: 'ASSIGNED' },
      // Equipment only is a declaration too (the work is declared, its labour is not counted in hours).
      { project: 'HLT-026', activity: 'EQUIP' },
      { project: 'HLT-026', activity: 'NONE-OTHER' },
    ]);
    expect(out.map((a) => `${a.project} ${a.code}`)).toEqual(['HLT-026 NONE', 'NDC-031 NONE']);
  });
});

describe('external labour (owner answer 18 Oct 2026: « Les équipes externes ne rentrent pas dans le plan de charge »)', () => {
  it('labour carries hours; external = unnamed without a department, or a person with an external rate role', () => {
    const q = { units: 1, hoursPerDay: 8, plannedHours: null };
    expect([isLabour(q), isLabour({ units: 1, hoursPerDay: null, plannedHours: null }), isLabour({ units: null, hoursPerDay: null, plannedHours: 40 })]).toEqual([true, false, true]);
    expect(isExternalLabour({ ...q, person: null, department: null })).toBe(true);
    expect(isExternalLabour({ ...q, person: null, department: 'MEP' })).toBe(false);
    expect(isExternalLabour({ ...q, person: 'jw', department: null })).toBe(false);
    expect(isExternalLabour({ ...q, person: 'ct', department: null, personExternal: true })).toBe(true);
    // Equipment and material are neither.
    expect([isExternalLabour({ units: 1, hoursPerDay: null, plannedHours: null, person: null, department: null }), isInternalLabour({ units: 1, hoursPerDay: null, plannedHours: null, person: null, department: null })]).toEqual([false, false]);
  });

  it('an external person or crew puts no load anywhere: no person row, no trade, no unmet demand', () => {
    const l = planningLoad([act({ code: 'A', owner: 'ao', ownerTrade: 'Site operations' })], [
      asg({ activity: 'A', resource: 'Contractor', person: 'ct', personExternal: true }),
      asg({ activity: 'A', resource: 'Steel erection crew', units: 6, hoursPerDay: 10 }),
    ], WEEKS, 2);
    expect(l.people).toEqual({});
    // Only the owner's coordination share: no EPC2i labour on the activity.
    expect(l.trades.map((t) => [t.trade, t.hours, t.unnamedH])).toEqual([['Site operations', [10, 10, 0, 0], [0, 0, 0, 0]]]);
  });
});

describe('unassignedActivitiesAt (owner answer 18 Oct 2026: « à 15 jours d’une activité sans affectation préviens le chef de projet »)', () => {
  it('needs work, an owner, no labour assignment, starting within 15 calendar days of today or started', () => {
    const today = '2026-09-25';
    const acts = [
      act({ code: 'J15', owner: 'dr', start: '2026-10-10' }), // 25 Sep + 15 = 10 Oct: included
      act({ code: 'J16', owner: 'dr', start: '2026-10-11' }),
      act({ code: 'STARTED', owner: 'dr', start: '2026-09-01' }),
      act({ code: 'LATE', owner: 'dr', start: '2026-08-01', finish: '2026-09-01', percentComplete: 90 }),
      act({ code: 'STAFFED', owner: 'dr', start: '2026-10-01' }),
      act({ code: 'CREW', owner: 'dr', start: '2026-10-01' }),
      act({ code: 'EQUIP', owner: 'dr', start: '2026-10-01' }),
      act({ code: 'NOOWNER', start: '2026-10-01' }),
      act({ code: 'DONE', owner: 'dr', start: '2026-10-01', percentComplete: 100 }),
      act({ code: 'MS', owner: 'dr', start: '2026-10-01', durationDays: 0 }),
      act({ code: 'UNDATED', owner: 'dr', start: null, finish: null }),
    ];
    const out = unassignedActivitiesAt(acts, [
      { project: 'HLT-026', activity: 'STAFFED', units: 1, hoursPerDay: 8, plannedHours: null },
      // An external crew is an assignment: the work is staffed (by a subcontractor) — no warning.
      { project: 'HLT-026', activity: 'CREW', units: 6, hoursPerDay: 10, plannedHours: null },
      // Equipment only: no one assigned to the work — warned.
      { project: 'HLT-026', activity: 'EQUIP', units: 1, hoursPerDay: null, plannedHours: null },
    ], today);
    expect(UNASSIGNED_ALERT_DAYS).toBe(15);
    expect(out.map((a) => a.code)).toEqual(['J15', 'STARTED', 'LATE', 'EQUIP']);
    expect(unassignedActivitiesAt(acts, [], '2026-09-26').map((a) => a.code)).toContain('J16');
  });
});
