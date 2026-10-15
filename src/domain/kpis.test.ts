// A-12 (chapter 4): the KPI formulas that replace the prototype's constants — golden values worked out by hand on the
// seed's figures (data date Fri 25 Sep 2026).
import { describe, expect, it } from 'vitest';
import {
  addMonthsIso, averageResponseDays, cashForecast, cashWindow, closedInQuarter, crewSize, demandPerMeur, departmentCapacity,
  dueWithinDays, ecoReleaseDate, eventsOnDay, expectedReceipts, finishOfMonthText, latestVaultSync, leadingCount, loggedInWeek, lowestCumulativePoint,
  monthsBetween, nextWeeksLoad, onTimeDeliveryPct, plannedManDays, plannedSpendOfPv, portfolioMarginPct, projectEacKeur, projectMarginPct, projectValueKeur, quarterKey,
  releasedInMonth, remainingSpend,
  rfqAverageCycleDays, rfqSavingsKeur, standardCalendar, vigieIncidentCount, weekHoursOf, weekMondayOf, type CashProjectInput,
} from './kpis';

const AS_OF = '2026-09-25';

describe('dates', () => {
  it('months, quarters, weeks, register finish texts', () => {
    expect([addMonthsIso(AS_OF, 1), addMonthsIso(AS_OF, 4), addMonthsIso('2026-01-31', -1)]).toEqual(['2026-10-01', '2027-01-01', '2025-12-01']);
    expect([monthsBetween('2026-10-01', '2026-12-31'), monthsBetween('2026-10-01', '2026-09-30')]).toEqual([2, -1]);
    expect([quarterKey(AS_OF), quarterKey('2026-10-01'), quarterKey('2026-07-01')]).toEqual(['2026-Q3', '2026-Q4', '2026-Q3']);
    expect([weekMondayOf(AS_OF), weekMondayOf('2026-09-21'), weekMondayOf('2026-09-27')]).toEqual(['2026-09-21', '2026-09-21', '2026-09-21']);
    expect([finishOfMonthText('Dec 2026'), finishOfMonthText('Feb 2027'), finishOfMonthText('—'), finishOfMonthText(null)]).toEqual(['2026-12-31', '2027-02-28', null, null]);
    expect([leadingCount('1 248 drawings · 13 linked'), leadingCount('0 déclaré'), leadingCount('Token expires'), leadingCount(null)]).toEqual([1248, 0, null, null]);
    expect(weekHoursOf()).toBe(40);
  });
});

describe('portfolio margin (03 OQ8)', () => {
  it('EAC = BAC / clamped CPI (the Projects screen\'s EAC), 1 without actuals', () => {
    expect(projectEacKeur({ budget: 4800, actual: 3360, progress: 0.64 })).toBeCloseTo(5250, 6);
    expect(projectEacKeur({ budget: 2100, actual: 1020, progress: 0.51 })).toBeCloseTo(2000, 6);
    expect(projectEacKeur({ budget: 480, actual: 0, progress: 0 })).toBe(480);
    // CPI 0.2 → clamped to 0.70.
    expect(projectEacKeur({ budget: 700, actual: 350, progress: 0.1 })).toBeCloseTo(1000, 6);
  });
  it('Σ (contract − EAC) / Σ contract over client projects: the seed\'s active projects give 8 % (prototype constant 18 %)', () => {
    const rows = [
      { contractKeur: 5520, eacKeur: projectEacKeur({ budget: 4800, actual: 3360, progress: 0.64 }) }, // HLT-026
      { contractKeur: 2350, eacKeur: projectEacKeur({ budget: 2100, actual: 1020, progress: 0.51 }) }, // NDC-031
      { contractKeur: 1500, eacKeur: projectEacKeur({ budget: 1350, actual: 1210, progress: 0.82 }) }, // RCF-019
      { contractKeur: 0, eacKeur: projectEacKeur({ budget: 960, actual: 410, progress: 0.45 }) }, // ERP-202 internal
      { contractKeur: 720, eacKeur: projectEacKeur({ budget: 620, actual: 550, progress: 0.91 }) }, // MSR-012
    ];
    expect(portfolioMarginPct(rows)).toBe(8);
    expect(portfolioMarginPct([{ contractKeur: 0, eacKeur: 100 }])).toBeNull();
    expect(portfolioMarginPct([])).toBeNull();
  });
});

describe('cash forecast (03 OQ7)', () => {
  const hlt: CashProjectInput = {
    code: 'HLT-026', paymentDays: 45, etcKeur: 1890, finishOn: '2026-12-31',
    milestones: [
      { label: 'M2', amountKeur: 1104, status: 'paid', dueOn: '2026-07-15' },
      { label: 'M3', amountKeur: 1380, status: 'invoiced', dueOn: '2026-09-26', paymentDueOn: '2026-11-10' },
      { label: 'M4', amountKeur: 1104, status: 'planned', dueOn: '2026-12-14' },
      { label: 'M5', amountKeur: 1380, status: 'planned', dueOn: '2027-01-14' },
    ],
  };
  const rcf: CashProjectInput = {
    code: 'RCF-019', paymentDays: 30, etcKeur: 265.6, finishOn: '2026-11-30',
    milestones: [
      { label: 'Partitions', amountKeur: 300, status: 'invoiced', dueOn: null },
      { label: 'Handover', amountKeur: 600, status: 'planned', dueOn: null },
    ],
  };
  it('window = the 6 months after the data date\'s month', () => {
    expect(cashWindow(AS_OF)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01']);
  });
  it('receipts: invoice due date; dated milestone + payment delay; undated ones spread to the finish; invoiced without invoice at data date + delay', () => {
    expect(expectedReceipts(hlt, AS_OF).map((r) => [r.label, r.on])).toEqual([['M3', '2026-11-10'], ['M4', '2027-01-28'], ['M5', '2027-02-28']]);
    expect(expectedReceipts(rcf, AS_OF).map((r) => [r.label, r.on])).toEqual([['Partitions', '2026-10-25'], ['Handover', '2026-12-30']]);
    // A late planned milestone is invoiced at the data date.
    expect(expectedReceipts({ ...hlt, milestones: [{ label: 'M4', amountKeur: 10, status: 'planned', dueOn: '2026-09-01' }] }, AS_OF)[0].on).toBe('2026-11-09');
  });
  it('monthly progress billing: the unbilled contract value invoiced in equal parts at each month end to the finish, + delay', () => {
    const ndc: CashProjectInput = { code: 'NDC-031', paymentDays: 30, etcKeur: 980, finishOn: '2027-03-31', progressBillingKeur: 1460, milestones: [] };
    expect(expectedReceipts(ndc, AS_OF).map((r) => [r.label, Math.round(r.amountKeur), r.on])).toEqual([
      ['Oct', 243, '2026-11-30'], ['Nov', 243, '2026-12-30'], ['Dec', 243, '2027-01-30'], ['Jan', 243, '2027-03-02'], ['Feb', 243, '2027-03-30'], ['Mar', 243, '2027-04-30'],
    ]);
    expect(cashForecast([ndc], AS_OF).map((m) => [m.cashInKeur, m.cashOutKeur])).toEqual([[0, 163], [243, 163], [243, 163], [243, 163], [0, 163], [487, 163]]);
  });
  it('months: cash in by receipt month, ETC spread evenly to the finish month', () => {
    const m = cashForecast([hlt, rcf], AS_OF);
    expect(m.map((x) => [x.month, x.cashInKeur, x.cashOutKeur])).toEqual([
      ['2026-10-01', 300, 763], ['2026-11-01', 1380, 763], ['2026-12-01', 600, 630], ['2027-01-01', 1104, 0], ['2027-02-01', 1380, 0], ['2027-03-01', 0, 0],
    ]);
    const low = lowestCumulativePoint(m)!;
    expect([low.index, low.cumKeur, low.next?.label]).toEqual([0, -463, 'M3']);
  });
  it('a finish already passed puts the ETC in the first month; an unknown finish spreads it over the window; receipts after the window are left out', () => {
    const m = cashForecast([{ code: 'X', paymentDays: 30, etcKeur: 60, finishOn: '2026-08-31', milestones: [{ label: 'Late', amountKeur: 5, status: 'planned', dueOn: '2027-06-01' }] }], AS_OF);
    expect(m.map((x) => x.cashOutKeur)).toEqual([60, 0, 0, 0, 0, 0]);
    expect(m.every((x) => x.cashInKeur === 0)).toBe(true);
    expect(cashForecast([{ code: 'Y', paymentDays: 30, etcKeur: 60, finishOn: null, milestones: [] }], AS_OF).map((x) => x.cashOutKeur)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(lowestCumulativePoint([])).toBeNull();
  });
});

describe('delivery 7: payment rule, PV-curve spend, margin at completion (C-6, C-10a, C-10b)', () => {
  const months = cashWindow(AS_OF);
  it('C-6 (R-076): receipts follow the contract\'s payment rule', () => {
    const p: CashProjectInput = {
      code: 'X', paymentDays: 45, etcKeur: 0, finishOn: null,
      milestones: [
        { label: 'Inv', amountKeur: 10, status: 'invoiced', dueOn: '2026-09-26' },
        { label: 'Plan', amountKeur: 20, status: 'planned', dueOn: '2026-12-14' },
      ],
    };
    // net 45 (default) — invoiced without a stored due date: data date + 45.
    expect(expectedReceipts(p, AS_OF).map((r) => r.on)).toEqual(['2026-11-09', '2027-01-28']);
    expect(expectedReceipts({ ...p, paymentRule: 'days_eom' }, AS_OF).map((r) => r.on)).toEqual(['2026-11-30', '2027-01-31']);
    expect(expectedReceipts({ ...p, paymentRule: 'eom_days' }, AS_OF).map((r) => r.on)).toEqual(['2026-11-14', '2027-02-14']);
  });

  it('C-10a (R-133): planned spend per month from the cumulative PV curve', () => {
    // PV index 0 = Jan 2026 + startMonth.
    expect(plannedSpendOfPv([100, 250, 250, 400], 8)).toEqual([
      { month: '2026-09-01', keur: 100 }, { month: '2026-10-01', keur: 150 }, { month: '2026-11-01', keur: 0 }, { month: '2026-12-01', keur: 150 },
    ]);
    expect(plannedSpendOfPv([], 0)).toEqual([]);
  });

  it('C-10a (R-133): the ETC follows the remaining planned increments (window part only), else evenly to the finish', () => {
    const plannedSpend = [
      { month: '2026-09-01', keur: 500 }, // before the window: ignored
      { month: '2026-10-01', keur: 100 }, { month: '2026-11-01', keur: 300 }, { month: '2026-12-01', keur: 0 }, { month: '2027-05-01', keur: 100 },
    ];
    // Σ ahead = 500 → ETC 1 000 × 100 / 500, × 300 / 500; May ’27 (200) is after the window.
    expect(remainingSpend({ etcKeur: 1000, finishOn: '2027-05-31', plannedSpend }, months)).toEqual([200, 600, 0, 0, 0, 0]);
    // Curve exhausted (all planned before the window) → the chapter-4 even spread to the finish month.
    expect(remainingSpend({ etcKeur: 90, finishOn: '2026-12-31', plannedSpend: [{ month: '2026-08-01', keur: 50 }] }, months)).toEqual([30, 30, 30, 0, 0, 0]);
    expect(remainingSpend({ etcKeur: 0, finishOn: '2026-12-31', plannedSpend }, months)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(remainingSpend({ etcKeur: 10, finishOn: null }, [])).toEqual([]);
    // cashForecast uses it.
    const f = cashForecast([{ code: 'Z', paymentDays: 30, etcKeur: 1000, finishOn: '2027-05-31', plannedSpend, milestones: [] }], AS_OF);
    expect(f.map((m) => m.cashOutKeur)).toEqual([200, 600, 0, 0, 0, 0]);
  });

  it('C-10b (R-132): margin at completion = (contract − EAC) / contract', () => {
    expect([projectMarginPct(5520, 5250), projectMarginPct(1000, 1100), projectMarginPct(0, 100), projectMarginPct(1000, 1000)]).toEqual([5, -10, null, 0]);
  });
});

describe('capacity model (03 OQ9)', () => {
  const pool = [
    { department: 'Engineering', loads: [90, 100, 130, 125, 110, 100, 80, 60] },
    { department: 'Site operations', loads: [100, 110, 120, 120, 100, 90, 90, 80] },
    { department: 'Site operations', loads: [60, 100, 100, 100, 80, 40, 20, 20] },
  ];
  it('capacity = members × 40 h × 8 weeks; committed = Σ load % × 40 h', () => {
    expect(departmentCapacity(pool, 'Engineering')).toEqual({ members: 1, capacityH: 320, committedH: 318 });
    expect(departmentCapacity(pool, 'Site operations')).toEqual({ members: 2, capacityH: 640, committedH: 532 });
    expect(departmentCapacity(pool, 'Quality')).toEqual({ members: 0, capacityH: 0, committedH: 0 });
  });
  it('demand per €1M = committed ÷ portfolio value (contract value, else budget)', () => {
    expect(projectValueKeur(5520, 4800)).toBe(5520);
    expect(projectValueKeur(0, 960)).toBe(960);
    expect(projectValueKeur(undefined, 3800)).toBe(3800);
    expect(demandPerMeur(318, 14850)).toBeCloseTo(21.414, 3);
    expect(demandPerMeur(318, 0)).toBe(0);
  });
});

describe('sourcing and deliveries (08 OQ23)', () => {
  it('savings vs list over the RFQs awarded in the data date\'s quarter; average sent → award cycle', () => {
    const rfqs = [
      { awardedOn: '2026-09-15', sentOn: null, listPriceEur: 9600, awardedUnitPriceEur: 9600, quantity: 4 }, // the seed's RFQ-2026-029
      { awardedOn: '2026-08-20', sentOn: '2026-08-10', listPriceEur: 5200, awardedUnitPriceEur: 4900, quantity: 8 },
      { awardedOn: '2026-06-30', sentOn: '2026-06-20', listPriceEur: 1000, awardedUnitPriceEur: 900, quantity: 10 }, // Q2
      { awardedOn: null, sentOn: '2026-09-20', listPriceEur: 1000, awardedUnitPriceEur: null, quantity: 1 },
    ];
    expect(rfqSavingsKeur(rfqs, AS_OF)).toBe(2.4);
    expect(rfqSavingsKeur(rfqs.slice(0, 1), AS_OF)).toBe(0);
    expect(rfqAverageCycleDays(rfqs)).toBe(10);
    expect(rfqAverageCycleDays(rfqs.slice(0, 1))).toBeNull();
  });
  it('on-time deliveries over the 90 days up to the data date (HLT-026: 4 of 4)', () => {
    const hlt = [
      { receivedOn: '2026-06-30', poExpectedOn: '2026-06-30' }, { receivedOn: '2026-09-02', poExpectedOn: '2026-10-12' },
      { receivedOn: '2026-09-18', poExpectedOn: '2026-10-02' }, { receivedOn: '2026-09-23', poExpectedOn: '2026-10-19' },
      { receivedOn: null, poExpectedOn: '2026-11-06' },
    ];
    expect(onTimeDeliveryPct(hlt, AS_OF)).toBe(100);
    expect(onTimeDeliveryPct([{ receivedOn: '2026-09-10', poExpectedOn: '2026-09-01' }, { receivedOn: '2026-09-11', poExpectedOn: '2026-09-30' }, { receivedOn: '2026-09-12', poExpectedOn: null }], AS_OF)).toBe(50);
    // Received after the data date (generated plans) or before the window: not measured.
    expect(onTimeDeliveryPct([{ receivedOn: '2026-10-16', poExpectedOn: '2026-10-16' }, { receivedOn: '2026-05-12', poExpectedOn: '2026-05-12' }], AS_OF)).toBeNull();
  });
});

describe('resource requests (08 OQ23)', () => {
  it('mean working days from sending to the decision (Fri → Mon = 1); re-sent requests count each round', () => {
    const r = (events: [string, string][]) => ({ events: events.map(([action, date]) => ({ action, date })) });
    const pm = [
      r([['sent', '2026-09-21'], ['approved', '2026-09-21']]), r([['sent', '2026-09-18'], ['approved', '2026-09-21']]), r([['sent', '2026-09-21'], ['rejected', '2026-09-22']]),
      r([['sent', '2026-09-22'], ['reschedule', '2026-09-24']]), r([['sent', '2026-09-22'], ['approved', '2026-09-23']]), r([['sent', '2026-09-23'], ['approved', '2026-09-24']]),
      r([['sent', '2026-09-25']]),
    ];
    expect(averageResponseDays(pm)).toBe(1);
    expect(averageResponseDays([r([['sent', '2026-09-21'], ['approved', '2026-09-21']]), r([['sent', '2026-09-23'], ['approved', '2026-09-24']])])).toBe(0.5);
    expect(averageResponseDays([r([['sent', '2026-09-21'], ['reschedule', '2026-09-23'], ['resent', '2026-09-24'], ['approved', '2026-09-25']])])).toBe(1.5);
    expect(averageResponseDays([r([['sent', '2026-09-25']])])).toBeNull();
  });
});

describe('site (10 OQ7)', () => {
  const rotation = [
    { person: 'Amélie Ollivier', fromOn: '2026-10-19', toOn: '2026-12-18' },
    { person: 'Julien Wagner', fromOn: '2026-10-19', toOn: '2026-11-13' },
    { person: 'Thomas Kerbrat', fromOn: '2026-10-26', toOn: '2026-11-27' },
    { person: 'Pauline Noguès', fromOn: '2026-11-09', toOn: '2026-12-18' },
    { person: 'Hélène Sauvage', fromOn: '2026-11-30', toOn: '2026-12-18' },
    { person: 'Contractant — 2 monteurs', fromOn: '2026-10-26', toOn: '2026-11-27' },
  ];
  it('man-days planned = Σ crew × working days (standard calendar, 11 Nov off): 179 (prototype literal 168)', () => {
    expect([crewSize('Contractant — 2 monteurs'), crewSize('Amélie Ollivier'), crewSize('Team - 3 fitters')]).toEqual([2, 1, 3]);
    expect(plannedManDays(rotation.slice(0, 1))).toBe(44);
    expect(plannedManDays(rotation, standardCalendar())).toBe(179);
  });
  it('HSE incidents = Σ the counts of Vigie\'s registers', () => {
    expect(vigieIncidentCount([{ kind: 'prevention_plan', statusText: 'Signed' }, { kind: 'register', statusText: '0 déclaré' }])).toBe(0);
    expect(vigieIncidentCount([{ kind: 'register', statusText: '2 déclarés' }, { kind: 'register', statusText: '1 déclaré' }, { kind: 'permit', statusText: '3' }])).toBe(3);
  });
});

describe('drawings, change orders, quality, interfaces (09 OQ17–18, 07 OQ6, OQ23)', () => {
  it('vault: the latest run, the count of the latest run reporting one', () => {
    expect(latestVaultSync([{ at: '2026-09-26T05:40:00.000Z', drawingsInVault: 1248 }, { at: '2026-09-25T05:40:00.000Z', drawingsInVault: 1240 }])).toEqual({ at: '2026-09-26T05:40:00.000Z', drawingsInVault: 1248 });
    expect(latestVaultSync([{ at: '2026-10-01T08:00:00.000Z', drawingsInVault: null }, { at: '2026-09-26T05:40:00.000Z', drawingsInVault: 1248 }])).toEqual({ at: '2026-10-01T08:00:00.000Z', drawingsInVault: 1248 });
    expect(latestVaultSync([null, null])).toBeNull();
  });
  it('released this month: the release date is the last approval (Paris date), else the raise date', () => {
    const ecos = [
      { number: 'ECO-2026-014', status: 'released', raisedOn: '2026-09-12', approvals: [{ decidedAt: null }] },
      { number: 'ECO-2026-012', status: 'released', raisedOn: '2026-08-28', approvals: [] },
      { number: 'ECO-2026-013', status: 'released', raisedOn: '2026-08-20', approvals: [{ decidedAt: '2026-08-31T22:30:00.000Z' }, { decidedAt: '2026-08-25T08:00:00.000Z' }] },
      { number: 'ECO-2026-015', status: 'in_approval', raisedOn: '2026-09-19', approvals: [] },
    ];
    expect(ecoReleaseDate(ecos[2])).toBe('2026-09-01');
    expect(releasedInMonth(ecos, AS_OF).map((e) => e.number)).toEqual(['ECO-2026-014', 'ECO-2026-013']);
  });
  it('NCRs closed in the data date\'s quarter (closure date, else the raise date)', () => {
    const ncrs = [
      { status: 'closed', raisedOn: '2026-09-02' }, { status: 'closed', raisedOn: '2026-06-02', closedOn: '2026-07-03' },
      { status: 'closed', raisedOn: '2026-05-02', closedOn: '2026-06-30' }, { status: 'open', raisedOn: '2026-09-02' },
    ];
    expect(closedInQuarter(ncrs, AS_OF)).toBe(2);
    expect(closedInQuarter(ncrs, '2026-10-02')).toBe(0);
  });
  it('interfaces due within 30 days of the data date (HLT-026: IF-02 only; IF-05 is 51 days away)', () => {
    const rows = [
      { status: 'received', neededBy: '2026-07-01' }, { status: 'open', neededBy: '2026-10-15' }, { status: 'frozen', neededBy: '2026-09-22' },
      { status: 'received', neededBy: '2026-10-01' }, { status: 'open', neededBy: '2026-11-15' }, { status: 'late', neededBy: '2026-09-20' },
    ];
    expect(dueWithinDays(rows, AS_OF)).toBe(1);
    expect(dueWithinDays(rows, AS_OF, 60)).toBe(2);
  });
});

describe('My work, Activity & integrations (10 OQ4, OQ18)', () => {
  it('logged this week = time entries Monday → data date', () => {
    const entries = [{ workDate: '2026-09-23', hours: 2.5 }, { workDate: '2026-09-24', hours: 3.5 }, { workDate: '2026-09-18', hours: 8 }, { workDate: '2026-09-28', hours: 4 }];
    expect(loggedInWeek(entries, AS_OF)).toBe(6);
    expect(loggedInWeek([], AS_OF)).toBe(0);
  });
  it('load of the two weeks after the data date', () => {
    const weeks = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];
    expect(nextWeeksLoad(weeks, [10, 40, 50, 60], AS_OF)).toBe(45);
    expect(nextWeeksLoad(weeks.slice(1), [40, 50, 60], AS_OF)).toBe(45);
    expect(nextWeeksLoad(weeks, null, AS_OF)).toBeNull();
    expect(nextWeeksLoad(['2026-09-28'], [40], AS_OF)).toBeNull();
  });
  it('events today = activity events of the data date in Paris', () => {
    expect(eventsOnDay(['2026-09-24T22:30:00.000Z', '2026-09-25T21:59:00.000Z', '2026-09-25T22:00:00.000Z', new Date('2026-09-24T21:00:00.000Z')], AS_OF)).toBe(2);
  });
});
