// Golden values reproduced from the prototype's own logic (design lines 3866–3882 resources, 4400–4403 leave)
// run on PEOPLE / ROLES / DEPT_OF / projectData(code).team / CATS / LEAVE / LEAVE_DAYS / HOLIDAYS — see
// docs/spec/06 §1.6 (reference tables) and §4.
import { describe, expect, it } from 'vitest';
import { shade } from '@/components/app/tones';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import {
  availableHours, capacityBar, laborShare, loadBand, overAllocatedCount, peopleAboveByWeek, personAvailability, personLoad,
  projectDepartmentDemand, teamAvailability, teamUtilization, unmetDemand, weeksUnderTeamCapacity, type LoadBand,
} from './resources';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;
const PEOPLE = P.PEOPLE as [string, string, number[]][];
const DEPT_OF = P.DEPT_OF as Record<string, string>;

/** The prototype's `people` list of Resources / Project resources (PEOPLE order, filtered on the team). */
const peopleOf = (team?: string[]) =>
  PEOPLE.filter(([n]) => !team || team.includes(n)).map(([name, , loads]) => ({ name, department: DEPT_OF[name] ?? null, ...personLoad(loads) }));

describe('loadBand / shade()', () => {
  it('bands follow the shade() thresholds (>115 · >100 · ≥90 · ≥60)', () => {
    const cases: [number, LoadBand][] = [[0, 'under'], [59, 'under'], [60, 'moderate'], [89, 'moderate'], [90, 'nominal'], [100, 'nominal'], [101, 'stretched'], [115, 'stretched'], [116, 'over'], [130, 'over']];
    for (const [v, b] of cases) expect([v, loadBand(v)]).toEqual([v, b]);
    // one colour per band
    const bg: Record<LoadBand, string> = { under: 'var(--color-neutral-900)', moderate: 'var(--color-accent-900)', nominal: 'var(--color-accent-800)', stretched: 'var(--color-accent-600)', over: 'var(--color-accent-400)' };
    for (const [v] of cases) expect(shade(v).bg).toBe(bg[loadBand(v)]);
  });
});

describe('person loads (Resources heatmap, 06 §1.6 reference table)', () => {
  it('averages, "Avg" text and attention flags', () => {
    const rows = peopleOf().map((p) => [p.name, p.avgPct, p.avgAlert, p.overAllocated]);
    expect(rows).toEqual([
      ['Amélie Ollivier', 101, true, true],
      ['Julien Wagner', 99, false, true],
      ['Pauline Noguès', 98, false, true],
      ['Thomas Kerbrat', 65, false, false],
      ['Léa Marchand', 73, false, false], // 72.5 → JS round 73
      ['Damien Roux', 87, false, false],
      ['Hélène Sauvage', 79, false, false], // 110 is not > 110
      ['Fabien Bertrand', 64, false, false],
    ]);
  });

  it('portfolio KPIs: utilization 83 %, 3 over-allocated', () => {
    const people = peopleOf();
    expect(teamUtilization(people)).toBe(83);
    expect(overAllocatedCount(people)).toBe(3);
    expect(teamUtilization([])).toBe(0);
  });

  it('people above 100 % by week: 0 1 2 3 2 0 1 0 (What-if "People above 100%" = 3)', () => {
    expect(peopleAboveByWeek(peopleOf())).toEqual([0, 1, 2, 3, 2, 0, 1, 0]);
  });

  it('Julien Wagner cells: 90 100 130 125 110 100 80 60 → bands', () => {
    expect(personLoad([90, 100, 130, 125, 110, 100, 80, 60]).bands).toEqual(['nominal', 'nominal', 'over', 'over', 'stretched', 'nominal', 'moderate', 'moderate']);
  });
});

describe('capacity vs demand', () => {
  it('ROLES bars: Engineering 1110 / 960 over, Controls 560 / 640 under; the larger sits at 90.9 %', () => {
    const roles = (P.ROLES as [string, number, number][]).map(([name, capacityH, demandH]) => ({ name, capacityH, demandH }));
    const bars = roles.map((r) => {
      const b = capacityBar(r);
      return [r.name, b.over, Math.round(b.demand * 1000) / 10, Math.round(b.capacity * 1000) / 10];
    });
    expect(bars).toEqual([
      ['Engineering', true, 90.9, 78.6],
      ['Site operations', true, 90.9, 84.3],
      ['MEP', true, 90.9, 85.6],
      ['Controls & planning', false, 79.5, 90.9],
      ['Quality', true, 90.9, 78.6],
    ]);
    // the portfolio constant (240 h) differs from Σ max(0, dem − cap) = 280 h (06 OQ1)
    expect(unmetDemand(roles)).toBe(280);
  });

  it('project departments: 320 h per person, demand round(avg% × 3.2), first-appearance order', () => {
    const hlt = projectDepartmentDemand(peopleOf(G.projectData['HLT-026'].team));
    expect(hlt).toEqual([
      { name: 'Site operations', capacityH: 640, demandH: 323 + 208 },
      { name: 'Engineering', capacityH: 320, demandH: 317 },
      { name: 'MEP', capacityH: 320, demandH: 314 },
      { name: 'Controls & planning', capacityH: 960, demandH: 234 + 278 + 205 },
      { name: 'Quality', capacityH: 320, demandH: 253 },
    ]);
    expect(projectDepartmentDemand([{ department: null, avgPct: 50 }])).toEqual([{ name: 'Other', capacityH: 320, demandH: 160 }]);
  });

  it('Project resources per project (06 §1.6 table): team, load, over-allocated, unmet demand, labour share', () => {
    const out = Object.fromEntries(
      ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'].map((code) => {
        const pd = G.projectData[code];
        const people = peopleOf(pd.team);
        const labor = (pd.CATS as [string, number, number][]).find((c) => /labor|staff/i.test(c[0]))!;
        return [code, [people.length, teamUtilization(people), overAllocatedCount(people), unmetDemand(projectDepartmentDemand(people)), labor[2], laborShare({ budget: labor[1], actual: labor[2] })]];
      }),
    );
    expect(out).toEqual({
      'HLT-026': [8, 83, 3, 0, 1420, 77],
      'NDC-031': [4, 80, 1, 0, 340, 49],
      'RCF-019': [3, 93, 2, 3, 430, 90],
      'ERP-202': [2, 80, 0, 0, 162, 43],
      'WSA-044': [4, 82, 2, 0, 160, 26],
      'MSR-012': [3, 77, 0, 0, 160, 89],
    });
  });

  it('labour share without a budget is null', () => {
    expect(laborShare({ budget: 0, actual: 10 })).toBeNull();
  });
});

describe('availability from leave (Leave & working calendar, 35 h basis)', () => {
  const LEAVE = P.LEAVE as Record<string, Record<string, string>>;
  const LEAVE_DAYS = P.LEAVE_DAYS as Record<string, number>;
  const HOLIDAYS = P.HOLIDAYS as Record<string, string>;
  const rows = PEOPLE.map(([n]) =>
    personAvailability(Array.from({ length: 8 }, (_, i) => ({ days: LEAVE[n]?.[i] ? LEAVE_DAYS[LEAVE[n][i]] : 0, holidays: HOLIDAYS[i] ? 1 : 0 }))),
  );

  it('weekly hours = max(0, 5 − leave − holidays) × 7', () => {
    expect([availableHours(0), availableHours(1, 1), availableHours(5, 1), availableHours(2)]).toEqual([35, 21, 0, 21]);
    expect(rows[0].hours).toEqual([35, 35, 0, 0, 35, 35, 28, 35]); // Amélie Ollivier: CP weeks 2–3, Armistice week 6
    expect(rows[7].hours).toEqual([35, 35, 35, 35, 35, 35, 0, 0]); // Fabien Bertrand: CP + holiday cannot go negative
  });

  it('per person: availability %, leave days, low flag', () => {
    expect(rows.map((r) => [r.pct, r.leaveDays, r.low])).toEqual([
      [73, 10, false], [95, 1, false], [78, 8, false], [73, 10, false], [93, 2, false], [98, 0, false], [93, 2, false], [75, 10, false],
    ]);
  });

  it('team KPIs: availability 85 %, 43 leave days, 0 weeks under 60 % capacity', () => {
    expect(teamAvailability(rows)).toBe(85);
    expect(rows.reduce((a, r) => a + r.leaveDays, 0)).toBe(43);
    expect(weeksUnderTeamCapacity(rows)).toBe(0);
    expect(weeksUnderTeamCapacity(rows, 0.7)).toBe(1); // week 6 (Armistice): 189 h / 280 h
  });
});
