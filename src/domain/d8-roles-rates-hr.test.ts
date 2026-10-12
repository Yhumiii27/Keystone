// Delivery 8, lot roles-rates-hr: the pure rules of R-044 (Finance role, P-4, P-12 c, C-9), R-139 ("View as client", P-11),
// R-083 (dated rate grid and one valuation of hours, A-10, R-4a), R-178 (reference multipliers), R-087 (skills, R-5b) and
// R-088 (hours-variance threshold, R-6b).
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { PERSONAS, PERSONA_BY_ROLE } from '@/config/personas';
import { ROLE_SCREENS, canSee } from '@/config/role-screens';
import type { RoleKey } from '@/config/screens';
import { ROLE_LABEL } from './auth';
import {
  HOURS_VARIANCE_DEFAULT, canEditRates, canSeeRates, gridOn, hoursKpis, hoursVariance, isHoursVariancePct, liveTaskCost, multiplierAt, parseEffectiveDate,
  parseHoursVarianceInput, rateAt, rateChangeText, skillCoverage, skillKpis, taskLaborCost, usableHoursVariance, versionAt, type RateGrid,
} from './hr';
import { canSeeMargins } from './portfolio-finance';
import { RATE_GRID_START, RATE_MULTIPLIER_DEFAULTS } from './rate-defaults';
import {
  canEditContract, canPreviewClientView, canSetBudgetRate, financeReadOnly, projectAccess, type ProjectFacts, type RightsViewer,
} from './rights';
import { fallbackSettingsDefaults, parseSettingsDefaults } from './settings-defaults';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
const ROLES = PERSONAS.map((p) => p.role);
const viewerOf = (role: RoleKey): RightsViewer => {
  const p = PERSONA_BY_ROLE[role];
  return { role, personId: null, short: p.short, name: p.name, organisation: p.organisation };
};

describe('R-044 · the Finance role and persona', () => {
  it('nine personas; Léa Marchand, Cost controller, Controls & planning; label and priority', () => {
    expect(PERSONAS).toHaveLength(9);
    expect(PERSONA_BY_ROLE.finance).toMatchObject({ name: 'Léa Marchand', title: 'Cost controller', short: 'L. Marchand', email: 'lea.marchand@epc2i.fr', department: 'Controls & planning', organisation: null });
    expect(ROLE_LABEL.finance).toBe('Finance');
  });

  it('workspace: home, my projects, documents, overview, cash, contract, billing, budget, hours, rates, plan, my work, leave, meetings — no Prioritisation', () => {
    const finance = ROLE_SCREENS.finance!;
    expect([...finance].sort()).toEqual(
      ['billing', 'budget', 'cash', 'contract', 'docs', 'home', 'hours', 'leave', 'meetings', 'mywork', 'myprojects', 'overview', 'plan', 'rates', 'task'].sort(),
    );
    expect(canSee('finance', 'portfolio')).toBe(false);
    expect(canSee('finance', 'myapprovals')).toBe(false);
    expect(canSee('finance', 'task')).toBe(true);
    // P-4: procurement no longer has the Contract screen.
    expect(canSee('procurement', 'contract')).toBe(false);
    expect(ROLES.filter((r) => canSee(r, 'contract'))).toEqual(['director', 'pm', 'finance']);
  });

  it('P-4: canEditContract — the director, Finance on every project, a lead whose workspace has the Contract', () => {
    const lead = { lead: true };
    const notLead = { lead: false };
    expect(ROLES.filter((r) => canEditContract(r, notLead))).toEqual(['director', 'finance']);
    expect(ROLES.filter((r) => canEditContract(r, lead))).toEqual(['director', 'pm', 'finance']);
    // A member-role deputy (lead on the project) gets no editing: Contract is not in a member's workspace.
    expect(canEditContract('member', lead)).toBe(false);
    expect(canEditContract('client', lead)).toBe(false);
  });

  it('P-4 on the seed teams: the PM of record and a deputy edit, a PM-role team member or a PM off the team reads; Finance everywhere', () => {
    const facts: ProjectFacts = {
      client: 'Port authority', pm: 'R. Aubert', pmPersonId: null,
      team: [
        { personId: 'x1', short: 'J. Wagner', name: 'Julien Wagner', role: 'deputy', primary: false },
        { personId: 'x2', short: 'F. Bertrand', name: 'Fabien Bertrand', role: 'team', primary: false },
      ],
    };
    const edits = (v: RightsViewer) => canEditContract(v.role, projectAccess(v, facts));
    expect(edits(viewerOf('pm'))).toBe(true); // PM of record
    expect(edits(viewerOf('member'))).toBe(false); // deputy, role member
    expect(edits({ ...viewerOf('pm'), short: 'J. Wagner', name: 'Julien Wagner' })).toBe(true); // a PM-role deputy
    expect(edits({ ...viewerOf('pm'), short: 'F. Bertrand', name: 'Fabien Bertrand' })).toBe(false); // PM role, plain team member
    expect(edits({ ...viewerOf('pm'), short: 'X. Other', name: 'Other PM' })).toBe(false); // PM off the team
    expect(edits(viewerOf('finance'))).toBe(true); // Finance, not on the team
    expect(edits(viewerOf('procurement'))).toBe(false);
  });

  it('Finance reads Budget, Hours and Billing (even on its teams); the budget rate (C-9), margins and rates', () => {
    expect((['budget', 'hours', 'billing', 'contract', 'plan', 'meetings'] as const).filter((s) => financeReadOnly('finance', s))).toEqual(['budget', 'hours', 'billing']);
    expect(ROLES.filter((r) => financeReadOnly(r, 'budget'))).toEqual(['finance']);
    expect(ROLES.filter(canSetBudgetRate)).toEqual(['director', 'finance']);
    expect(ROLES.filter(canSeeMargins)).toEqual(['director', 'pm', 'finance']);
    expect(ROLES.filter(canSeeRates)).toEqual(['director', 'pm', 'finance']);
    // P-12 (c): the director and Finance edit the grid; the PMs read it.
    expect(ROLES.filter(canEditRates)).toEqual(['director', 'finance']);
  });
});

describe('R-139 · "View as client" (P-11 a)', () => {
  it('the director and the project leads (PM of record, co-PM, deputy); never the client', () => {
    expect(ROLES.filter((r) => canPreviewClientView(r, { lead: false }))).toEqual(['director']);
    expect(ROLES.filter((r) => canPreviewClientView(r, { lead: true }))).toEqual(ROLES.filter((r) => r !== 'client'));
    const facts: ProjectFacts = { client: 'Port authority', pm: 'R. Aubert', pmPersonId: null, team: [{ personId: 'x', short: 'J. Wagner', name: 'Julien Wagner', role: 'deputy', primary: false }] };
    const sees = (v: RightsViewer) => canPreviewClientView(v.role, projectAccess(v, facts));
    expect([sees(viewerOf('director')), sees(viewerOf('pm')), sees(viewerOf('member')), sees(viewerOf('quality')), sees(viewerOf('client'))]).toEqual([true, true, true, false, false]);
    expect(sees({ ...viewerOf('pm'), short: 'X. Other', name: 'Other PM' })).toBe(false);
  });
});

const GRID: RateGrid = {
  roles: [
    { id: 'r1', role: 'Planner', isExternal: false, costCenter: null, grade: null, versions: [{ effectiveFrom: '2026-01-01', value: 74 }, { effectiveFrom: '2026-11-01', value: 78 }] },
    { id: 'r2', role: 'Contractor — structural (external)', isExternal: true, costCenter: null, grade: null, versions: [{ effectiveFrom: '2026-01-01', value: 118 }] },
    { id: 'r3', role: 'Inspector', isExternal: false, costCenter: null, grade: null, versions: [] },
  ],
  multipliers: [{ key: 'sat', label: 'Saturday', versions: [{ effectiveFrom: '2026-01-01', value: 1.5 }, { effectiveFrom: '2027-01-01', value: 1.6 }] }],
};

describe('R-083 · dated rate grid (A-10, R-4a)', () => {
  it('the version in force: the latest one on or before the date; none before the first (not valued)', () => {
    expect(versionAt(GRID.roles[0].versions, '2026-10-31')?.value).toBe(74);
    expect(versionAt(GRID.roles[0].versions, '2026-11-01')?.value).toBe(78);
    expect(versionAt(GRID.roles[0].versions, '2025-12-31')).toBeNull();
    // order-independent
    expect(versionAt([...GRID.roles[0].versions].reverse(), '2027-01-01')?.value).toBe(78);
  });

  it('rateAt by id or name, multiplierAt; unknown or unversioned → null; the grid on a date', () => {
    expect([rateAt(GRID, 'r1', '2026-09-25'), rateAt(GRID, 'Planner', '2026-12-01'), rateAt(GRID, 'r3', '2026-09-25'), rateAt(GRID, 'nobody', '2026-09-25'), rateAt(GRID, null, '2026-09-25')])
      .toEqual([74, 78, null, null, null]);
    expect([multiplierAt(GRID, 'sat', '2026-12-31'), multiplierAt(GRID, 'sat', '2027-01-01'), multiplierAt(GRID, 'sun', '2027-01-01')]).toEqual([1.5, 1.6, null]);
    expect(gridOn(GRID, '2026-11-15')).toEqual({
      roles: [{ role: 'Planner', baseRateEur: 78 }, { role: 'Contractor — structural (external)', baseRateEur: 118 }, { role: 'Inspector', baseRateEur: 0 }],
      multipliers: [{ key: 'sat', label: 'Saturday', factor: 1.5 }],
    });
  });

  it('effective dates: real ISO days 2000–2099 only', () => {
    expect([parseEffectiveDate('2026-11-01'), parseEffectiveDate('2026-02-30'), parseEffectiveDate('1 Nov 2026'), parseEffectiveDate('1999-12-31'), parseEffectiveDate(20261101), parseEffectiveDate(null)])
      .toEqual(['2026-11-01', null, null, null, null, null]);
  });

  it('audit line "Planner base: 74 → 78 €/h from 1 Nov 2026", backdating said', () => {
    expect(rateChangeText('Planner base', 74, 78, '€/h', '1 Nov 2026', false)).toBe('Planner base: 74 → 78 €/h from 1 Nov 2026');
    expect(rateChangeText('Saturday multiplier', 1.5, 1.6, '×', '1 Jan 2027', false)).toBe('Saturday multiplier: ×1.5 → ×1.6 from 1 Jan 2027');
    expect(rateChangeText('Inspector base', null, 70, '€/h', '1 Sep 2026', true)).toBe('Inspector base: — → 70 €/h from 1 Sep 2026 (backdated)');
  });

  it('task cost: each entry at its person’s rate on its date, the rest at today’s rate; "rate missing" without a rate', () => {
    // T-2314 on the seed: 6 h logged, entries 2.5 h + 3.5 h at QA / QC 60 €/h.
    expect(taskLaborCost({ loggedH: 6, entries: [{ hours: 2.5, rateEur: 60 }, { hours: 3.5, rateEur: 60 }], restRateEur: 60 })).toEqual({ cost: 360, rate: 60, missing: false });
    // Logged hours without entries (T-2302: 4.5 h, none) → today's rate.
    expect(taskLaborCost({ loggedH: 4.5, entries: [], restRateEur: 60 })).toEqual({ cost: 270, rate: 60, missing: false });
    // A rate change within the task: no single €/h, the sum of the parts.
    expect(taskLaborCost({ loggedH: 10, entries: [{ hours: 4, rateEur: 74 }, { hours: 4, rateEur: 78 }], restRateEur: 78 })).toEqual({ cost: 4 * 74 + 6 * 78, rate: null, missing: false });
    // An entry by a person without a grid role, or the assignee without one.
    expect(taskLaborCost({ loggedH: 3, entries: [{ hours: 3, rateEur: null }], restRateEur: 60 })).toEqual({ cost: null, rate: null, missing: true });
    expect(taskLaborCost({ loggedH: 2, entries: [], restRateEur: null })).toEqual({ cost: null, rate: null, missing: true });
    // Nothing logged: 0 at today's rate; entries above the stored total are not double-counted.
    expect(taskLaborCost({ loggedH: 0, entries: [], restRateEur: 60 })).toEqual({ cost: 0, rate: 60, missing: false });
    expect(taskLaborCost({ loggedH: 2, entries: [{ hours: 3, rateEur: 60 }], restRateEur: 60 })).toEqual({ cost: 180, rate: 60, missing: false });
  });

  it('task cost while the sheet is open: hours logged since are valued at today’s rate', () => {
    const note = { cost: 360, rate: 60, missing: false, todayRate: 60 };
    expect(liveTaskCost(note, 0)).toEqual({ cost: 360, rate: 60, missing: false });
    expect(liveTaskCost(note, 1.5)).toEqual({ cost: 450, rate: 60, missing: false });
    expect(liveTaskCost({ ...note, todayRate: 65 }, 1)).toEqual({ cost: 425, rate: null, missing: false });
    expect(liveTaskCost({ ...note, todayRate: null }, 1)).toEqual({ cost: null, rate: null, missing: true });
    expect(liveTaskCost({ cost: 0, rate: null, missing: false, todayRate: 74 }, 2)).toEqual({ cost: 148, rate: 74, missing: false });
  });
});

describe('R-178 · reference multipliers (A-10 placeholders)', () => {
  it('one shared constant = the prototype’s MULTS (keys, labels, factors); first versions from 1 Jan 2026', () => {
    expect(RATE_MULTIPLIER_DEFAULTS.map((m) => [m.key, m.label, m.factor])).toEqual(P.MULTS);
    expect(RATE_GRID_START).toBe('2026-01-01');
  });
});

describe('R-087 · one 1–5 scale, two indicators (R-5a, R-5b)', () => {
  it('no expert / single expert are told apart; the gap flag (< 2 experts) is kept', () => {
    const people = [{ name: 'A', levels: [5, 4, 3, 0] }, { name: 'B', levels: [4, 2, 3, 1] }];
    const cov = skillCoverage(['S1', 'S2', 'S3', 'S4'], people);
    expect(cov.map((c) => [c.experts, c.gap, c.noExpert, c.singleExpert, c.text])).toEqual([
      [2, false, false, false, '2 experts · 2 at level ≥3'],
      [1, true, false, true, '1 expert · 1 at level ≥3'],
      [0, true, true, false, 'No expert · 2 at level ≥3'],
      [0, true, true, false, 'No expert · 0 at level ≥3'],
    ]);
    expect(skillKpis(cov, 1)).toEqual({ families: 4, noExpert: 2, singleExpert: 1, certifications: 1 });
  });
});

describe('R-088 · hours-variance threshold (R-6b)', () => {
  it('stored setting: an integer 1–50, else the default 10 (missing rows of databases seeded earlier)', () => {
    expect(HOURS_VARIANCE_DEFAULT).toBe(10);
    expect([usableHoursVariance({ pct: 7 }), usableHoursVariance(null), usableHoursVariance({ pct: 0 }), usableHoursVariance({ pct: 7.5 }), usableHoursVariance({ pct: '7' }), usableHoursVariance({ pct: 51 })])
      .toEqual([7, 10, 10, 10, 10, 10]);
    expect([isHoursVariancePct(1), isHoursVariancePct(50), isHoursVariancePct(0), isHoursVariancePct(51)]).toEqual([true, true, false, false]);
    expect([parseHoursVarianceInput('7'), parseHoursVarianceInput(' 12 '), parseHoursVarianceInput(12), parseHoursVarianceInput('7.5'), parseHoursVarianceInput('0'), parseHoursVarianceInput('51'), parseHoursVarianceInput(''), parseHoursVarianceInput('1e1'), parseHoursVarianceInput(null)])
      .toEqual([7, 12, 12, null, null, null, null, null, null]);
  });

  it('inclusive boundaries both ways at 10 % (integer arithmetic)', () => {
    expect([hoursVariance(100, 110).tone, hoursVariance(100, 109.99).tone, hoursVariance(100, 90).tone, hoursVariance(100, 90.01).tone]).toEqual(['over', 'ok', 'under', 'ok']);
    // 110 h planned → 121 h declared is exactly +10 %: flagged, bar in accent-700 (110 × 1.1 = 121.00000000000001 in floats).
    expect(hoursVariance(110, 121)).toMatchObject({ tone: 'over', barOver: true });
    expect(hoursVariance(110, 120)).toMatchObject({ tone: 'ok', barOver: false });
  });

  it('a non-default threshold: 7 % of 100 h', () => {
    expect([hoursVariance(100, 107, 7).tone, hoursVariance(100, 106, 7).tone, hoursVariance(100, 93, 7).tone, hoursVariance(100, 94, 7).tone]).toEqual(['over', 'ok', 'under', 'ok']);
  });

  it('every threshold 1–50 % on every plan 1–200 h: the exact boundary is flagged, one hour less is not', () => {
    const bad: string[] = [];
    for (let pct = 1; pct <= 50; pct++)
      for (let p = 1; p <= 200; p++) {
        const d = (p * pct) / 100;
        if (hoursVariance(p, p + d, pct).tone !== 'over' || hoursVariance(p, p - d, pct).tone !== 'under') bad.push(`${pct}% on ${p} h`);
        if (Number.isInteger(d) && d >= 1 && (hoursVariance(p, p + d - 1, pct).tone !== 'ok' || hoursVariance(p, p - d + 1, pct).tone !== 'ok')) bad.push(`${pct}% on ${p} h (inside)`);
      }
    expect(bad).toEqual([]);
  });

  it('no variance is ok (0 / 0 included); a plan of 0 with hours declared is over', () => {
    expect(hoursVariance(0, 0)).toMatchObject({ tone: 'ok', barOver: false, varText: '0 h' });
    expect(hoursVariance(50, 50, 1)).toMatchObject({ tone: 'ok', barOver: false });
    expect(hoursVariance(0, 2)).toMatchObject({ tone: 'over', barOver: true });
  });

  it('the Variance KPI follows the same threshold, both ways (the prototype flagged over 5 % only)', () => {
    const k = (p: number, d: number, pct?: number) => hoursKpis({ lines: [{ plannedH: p, declaredH: d }], unassigned: [], thresholdPct: pct }).varianceLo;
    expect([k(100, 106), k(100, 110), k(100, 90), k(100, 95), k(100, 95, 5)]).toEqual([false, true, true, false, true]);
  });

  it('Settings defaults: the optional hours threshold — absent (documents stored before delivery 8) or valid', () => {
    const base = { lists: [], locations: [], health: { risk: 0.97, off: 0.9 } };
    expect(parseSettingsDefaults(base)).toEqual(base);
    expect(parseSettingsDefaults({ ...base, hours: { pct: 7 } })).toEqual({ ...base, hours: { pct: 7 } });
    expect(parseSettingsDefaults({ ...base, hours: { pct: 70 } })).toBeNull();
    expect(parseSettingsDefaults({ ...base, hours: null })).toBeNull();
    expect(fallbackSettingsDefaults([]).hours).toEqual({ pct: 10 });
  });
});
