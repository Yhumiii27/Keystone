// Golden values reproduced from the prototype's own logic (design lines 4381–4404, 5008–5018) run on its constants
// RATE_ROLES, MULTS, SKILLS, SKILL_LV, CERTS, PEOPLE, LEAVE, LEAVE_DAYS, HOLIDAYS and HOURS — see docs/spec/06 §2–§5.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import {
  abbreviatedName, canSeeRates, eurRate, filterBySkill, hoursKpis, hoursVariance, leaveCell, leaveKpis, leaveRow, levelDots, levelTone,
  multipliedRates, multiplierHint, parseHoursView, parseRateInput, parseSkillFilter, premiumText, rateKpis, skillCoverage, skillKpis,
  type LeaveWeekInput,
} from './hr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;

const roles = (P.RATE_ROLES as [string, number][]).map(([role, baseRateEur]) => ({ role, baseRateEur }));
const mults = (P.MULTS as [string, string, number][]).map(([key, label, factor]) => ({ key, label, factor }));
const people = (P.PEOPLE as [string, string, number[]][]).map(([name]) => ({ name, levels: P.SKILL_LV[name] as number[] }));

describe('rate cards (06 §2)', () => {
  it('eur(): fr-FR, 0–2 decimals, " €" whatever the language', () => {
    expect(eurRate(115)).toBe('115 €');
    expect(eurRate(106.25)).toBe('106,25 €');
    expect(eurRate(119.6)).toBe('119,6 €');
    expect(eurRate(92 * 0.35)).toBe('32,2 €');
    expect(eurRate(72.33333)).toBe('72,33 €');
    expect(eurRate(1234.5)).toBe('1 234,5 €');
    expect(eurRate(0)).toBe('0 €');
  });

  it('multiplied rates table (Overtime, Saturday, Sun/holiday, Night, On-call) = spec §2.4c', () => {
    const table = roles.map((r) => [r.role, r.baseRateEur, ...multipliedRates(r.baseRateEur, mults).map(eurRate)]);
    expect(table).toEqual([
      ['Project manager', 92, '115 €', '138 €', '184 €', '119,6 €', '32,2 €'],
      ['Structural engineer', 85, '106,25 €', '127,5 €', '170 €', '110,5 €', '29,75 €'],
      ['MEP lead', 82, '102,5 €', '123 €', '164 €', '106,6 €', '28,7 €'],
      ['Planner', 74, '92,5 €', '111 €', '148 €', '96,2 €', '25,9 €'],
      ['Cost controller', 70, '87,5 €', '105 €', '140 €', '91 €', '24,5 €'],
      ['Site lead', 68, '85 €', '102 €', '136 €', '88,4 €', '23,8 €'],
      ['Crane operations', 62, '77,5 €', '93 €', '124 €', '80,6 €', '21,7 €'],
      ['QA / QC', 60, '75 €', '90 €', '120 €', '78 €', '21 €'],
      ['Procurement', 58, '72,5 €', '87 €', '116 €', '75,4 €', '20,3 €'],
      ['Contractor — structural (external)', 118, '147,5 €', '177 €', '236 €', '153,4 €', '41,3 €'],
    ]);
  });

  it('KPIs: average internal rate 72,33 €/h over 9 roles, contractor premium +39%, weekend ×2', () => {
    const k = rateKpis(roles, mults);
    expect(eurRate(k.avgInternalRate) + '/h').toBe('72,33 €/h');
    expect(k.internalCount).toBe(9);
    expect(premiumText(k.contractorPremiumPct!)).toBe('+39%');
    expect('×' + k.weekendMultiplier).toBe('×2');
    // live recompute: Structural engineer 85 → 100 (premium +18%), Sunday ×2 → ×2.5
    const k2 = rateKpis(roles.map((r) => (r.role === 'Structural engineer' ? { ...r, baseRateEur: 100 } : r)), mults.map((m) => (m.key === 'sun' ? { ...m, factor: 2.5 } : m)));
    expect(premiumText(k2.contractorPremiumPct!)).toBe('+18%');
    expect(eurRate(k2.avgInternalRate)).toBe('74 €');
    expect(k2.weekendMultiplier).toBe(2.5);
    // a missing reference role → no premium (prototype would print +Infinity / -100%)
    expect(rateKpis(roles.filter((r) => r.role !== 'Structural engineer'), mults).contractorPremiumPct).toBeNull();
  });

  it('setRate / setMult parsing: parseFloat, NaN → 0', () => {
    expect(parseRateInput('85.5')).toBe(85.5);
    expect(parseRateInput('')).toBe(0);
    expect(parseRateInput('abc')).toBe(0);
    expect(parseRateInput('12abc')).toBe(12);
  });

  it('visibility: director and pm only; multiplier hints', () => {
    expect(['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'].filter(canSeeRates)).toEqual(['director', 'pm']);
    expect(mults.map((m) => multiplierHint(m.key))).toEqual(['× base rate', '× base rate', '× base rate', '× base rate', '× base, per hour on call']);
  });
});

describe('skills matrix (06 §3)', () => {
  const cov = skillCoverage(P.SKILLS, people);

  it('coverage table = spec §3.4d (experts ≥4, able ≥3, gap under 2)', () => {
    expect(cov.map((c) => [c.name, c.experts, c.able, c.gap])).toEqual([
      ['Structural', 1, 1, true],
      ['Electrical / HV', 1, 1, true],
      ['MEP', 1, 1, true],
      ['Automation & controls', 0, 1, true],
      ['Crane & lifting', 2, 3, false],
      ['Civil & site', 1, 3, true],
      ['Planning & cost control', 2, 2, false],
      ['Procurement', 1, 2, true],
      ['Quality / QA-QC', 1, 2, true],
      ['Software / IT', 0, 2, true],
    ]);
    expect(cov[0].text).toBe('1 expert · 1 at level ≥3');
    expect(cov[3].text).toBe('0 experts · 1 at level ≥3');
    expect(cov[4].text).toBe('2 experts · 3 at level ≥3');
  });

  it('KPIs: 10 families, 8 single-expert skills, 5 certifications', () => {
    expect(skillKpis(cov, Object.keys(P.CERTS).length)).toEqual({ families: 10, singleExpert: 8, certifications: 5 });
  });

  it('filter: people at level ≥3 on the chosen skill', () => {
    expect(filterBySkill(people, null)).toHaveLength(8);
    expect(filterBySkill(people, 4).map((p) => p.name)).toEqual(['Amélie Ollivier', 'Julien Wagner', 'Thomas Kerbrat']);
    expect(filterBySkill(people, 0).map((p) => p.name)).toEqual(['Julien Wagner']);
    // every skill has at least one person at level ≥3 with the seed data
    expect(P.SKILLS.every((_: string, i: number) => filterBySkill(people, i).length > 0)).toBe(true);
    expect([parseSkillFilter('4', 10), parseSkillFilter('10', 10), parseSkillFilter('x', 10), parseSkillFilter(undefined, 10)]).toEqual([4, null, null, null]);
  });

  it('lvColor and dots', () => {
    expect([0, 1, 2, 3, 4, 5].map(levelTone)).toEqual(['none', 'neutral-800', 'accent-800', 'accent-600', 'accent-400', 'accent-400']);
    expect(levelDots(3)).toEqual([true, true, true, false, false]);
    expect(levelDots(0)).toEqual([false, false, false, false, false]);
  });
});

describe('leave & working calendar (06 §4)', () => {
  // NEW-CURSUS-4 (R-031, R-173): the prototype's CP / RTT weeks are Leave, its Sick / Training weeks Absence — the reason of
  // an absence is never kept; the days (and so the hours and KPIs) are the prototype's.
  const SIMPLE: Record<string, string> = { CP: 'Leave', RTT: 'Leave', Sick: 'Absence', Training: 'Absence' };
  const weeksOf = (name: string): LeaveWeekInput[] =>
    Array.from({ length: 8 }, (_, i) => {
      const t = (P.LEAVE[name] ?? {})[i] ?? null;
      return { type: t ? SIMPLE[t] : null, days: t ? P.LEAVE_DAYS[t] : 0, holidays: P.HOLIDAYS[i] ? 1 : 0 };
    });
  const rows = (P.PEOPLE as [string][]).map(([n]) => [n, leaveRow(weeksOf(n))] as const);

  it('rows: week hours, leave days and availability = spec §4.4 table', () => {
    expect(rows.map(([n, r]) => [n, r.cells.map((c) => c.hours).join(' '), r.days, r.availPct])).toEqual([
      ['Amélie Ollivier', '35 35 0 0 35 35 28 35', 10, 73],
      ['Julien Wagner', '35 35 35 35 35 35 21 35', 1, 95],
      ['Pauline Noguès', '14 35 35 35 35 0 28 35', 8, 78],
      ['Thomas Kerbrat', '35 35 35 35 0 0 28 35', 10, 73],
      ['Léa Marchand', '35 28 35 35 35 35 28 28', 2, 93],
      ['Damien Roux', '35 35 35 35 35 35 28 35', 0, 98],
      ['Hélène Sauvage', '35 35 35 21 35 35 28 35', 2, 93],
      ['Fabien Bertrand', '35 35 35 35 35 35 0 0', 10, 75],
    ]);
    expect(rows.some(([, r]) => r.lo)).toBe(false);
  });

  it('cells: labels and tones (leave wins over the holiday label, both deducted)', () => {
    const am = rows[0][1].cells;
    // NEW-CURSUS-4: "Leave" / "Absence" instead of the prototype's CP, RTT, Sick, Training; an absence takes the former
    // sick-leave look (tone "absence"), whatever its reason (training included).
    expect(am.map((c) => c.label)).toEqual(['', '', 'Leave', 'Leave', '', '', 'Hol.', '']);
    expect(am.map((c) => c.tone)).toEqual(['none', 'none', 'leave', 'leave', 'none', 'none', 'holiday', 'none']);
    expect(rows[6][1].cells[3]).toEqual({ label: 'Absence', tone: 'absence', hours: 21 });
    expect(rows[2][1].cells[0]).toEqual({ label: 'Absence', tone: 'absence', hours: 14 });
    expect(leaveCell({ type: 'Leave', days: 1, holidays: 1 })).toEqual({ label: 'Leave', tone: 'leave', hours: 21 });
    expect(rows[7][1].cells[6]).toEqual({ label: 'Leave', tone: 'leave', hours: 0 });
  });

  it('KPIs: team availability 85 %, 43 leave days, 0 weeks under 60 %', () => {
    expect(leaveKpis(rows.map(([, r]) => r), 8)).toEqual({ teamAvailabilityPct: 85, leaveDays: 43, weeksUnder60: 0 });
    // under-capacity week: everybody on CP in week 0
    const allOff = leaveRow([{ type: 'Leave', days: 5, holidays: 0 }, { type: null, days: 0, holidays: 0 }]);
    expect(allOff.lo).toBe(true);
    expect(leaveKpis([allOff, allOff], 2).weeksUnder60).toBe(1);
  });
});

describe('hours — Lucca reconciliation (06 §5)', () => {
  const H = P.HOURS['HLT-026'];
  const lines = (H.lines as [string, string, number, number][]).map(([res, wp, plannedH, declaredH]) => ({ res, wp, plannedH, declaredH }));
  const groupBy = (key: (l: (typeof lines)[number]) => string) => {
    const out = new Map<string, { p: number; d: number }>();
    for (const l of lines) {
      const g = out.get(key(l)) ?? { p: 0, d: 0 };
      g.p += l.plannedH;
      g.d += l.declaredH;
      out.set(key(l), g);
    }
    return [...out].map(([k, g]) => {
      const v = hoursVariance(g.p, g.d);
      return [k, g.p, g.d, v.varText, v.tone, v.barPct, v.barOver];
    });
  };

  it('by resource = spec §5.4 table', () => {
    expect(groupBy((l) => l.res)).toEqual([
      ['Julien Wagner', 280, 303, '+23 h', 'ok', 100, false],
      ['Amélie Ollivier', 100, 90, '-10 h', 'under', 90, false],
      ['Thomas Kerbrat', 96, 88, '-8 h', 'under', 92, false],
      ['Pauline Noguès', 110, 97, '-13 h', 'under', 88, false],
      ['Hélène Sauvage', 100, 115, '+15 h', 'over', 100, true],
      ['Damien Roux', 30, 28, '-2 h', 'under', 93, false],
      ['Léa Marchand', 24, 31, '+7 h', 'over', 100, true],
    ]);
  });

  it('by work package = spec §5.4 table', () => {
    expect(groupBy((l) => l.wp).map((g) => g.slice(0, 5))).toEqual([
      ['1.3 · Foundations', 160, 184, '+24 h', 'over'],
      ['1.4 · Steel structure', 220, 234, '+14 h', 'ok'],
      ['1.2 · Site preparation', 80, 76, '-4 h', 'under'],
      ['1.7 · Paving & yard', 20, 14, '-6 h', 'under'],
      ['1.5 · Crane installation', 96, 88, '-8 h', 'under'],
      ['1.6 · MEP systems', 110, 97, '-13 h', 'under'],
      ['1.1 · Design & permits', 54, 59, '+5 h', 'ok'],
    ]);
  });

  it('line variance edge cases: exactly +10 % is not flagged; zero plan', () => {
    expect(hoursVariance(100, 110).tone).toBe('ok');
    expect(hoursVariance(100, 111).tone).toBe('over');
    expect(hoursVariance(100, 100).varText).toBe('0 h');
    expect(hoursVariance(0, 5)).toMatchObject({ varText: '+5 h', tone: 'over', barPct: 100, barOver: true });
  });

  it('KPIs: 779 h declared · 740 h planned · +12 h (2 % · ≈ 1 k€) · 27 h to assign on 2 lines', () => {
    const k = hoursKpis({ lines, unassigned: (H.unassigned as [string, number, string][]).map(([, hours]) => ({ hours })) });
    expect(k).toEqual({
      declaredTotalH: 779, plannedH: 740, matchedDeclaredH: 752, lineCount: 10, varianceH: 12, variancePct: 2, varianceCostK: 1, varianceLo: false,
      toAssignH: 27, toAssignCount: 2,
    });
    // after assigning one line, the Lucca total is unchanged and "To assign" drops
    const k2 = hoursKpis({ lines, unassigned: [{ hours: 9 }], unassignedTotalH: 27 });
    expect([k2.declaredTotalH, k2.toAssignH, k2.toAssignCount]).toEqual([779, 9, 1]);
    expect(hoursKpis({ lines: [], unassigned: [] }).variancePct).toBe(0);
  });

  it('helpers: view parsing, abbreviated names', () => {
    expect([parseHoursView('wp'), parseHoursView('unassigned'), parseHoursView('x'), parseHoursView(undefined)]).toEqual(['wp', 'unassigned', 'resource', 'resource']);
    expect(abbreviatedName('Julien Wagner')).toBe('J. Wagner');
    expect(abbreviatedName('Hélène Sauvage')).toBe('H. Sauvage');
  });
});
