// What-if levelling engine (chapter 4, S-7): levers derived from the data, effects computed by the CPM engine on a copy of
// the plan. Golden values on a small hand-checked network (Standard 5d · 8h calendar, data date Fri 25 Sep 2026):
//   A (in progress, 20 d at 50 % → 10 d left: 25 Sep → 8 Oct) → B (10 d: 9 → 22 Oct) → C (5 d: 23 → 29 Oct), A → D (5 d,
//   total float 10). A: crew 4 × 10 h/d (driving) + Paula 8 h/d (MEP, overloaded); B: Ben 8 h/d (Quality); D owned by Paula.
// The prototype's static LEVERS / AUTO (05 §4.4) are replaced (docs: DELIVERY-6, questionnaire S-7).
import { describe, expect, it } from 'vitest';
import { builtinCalendars } from './calendar';
import { EX_A, EX_B, OT_A, OT_B, RELIEF, SHIFT, WEEKS, whatIfFixture } from './whatif.test-fixture';
import {
  autoLevel, contractRoleOf, drivingIndex, evaluateScenario, externalRateFor, leverCode, leverEffects, leverLabel, leverSetKey, legacyLeverSet, overtimeTarget,
  prepareWhatIf, rankLevers, scaledRemaining, scenarioRequests, weeklyHours, WHATIF_RULES,
} from './whatif';

const ctx = whatIfFixture;

describe('rules and helpers', () => {
  it('overtime target: up to 10 h/d, else +2 h, never above 12', () => {
    expect([overtimeTarget(8), overtimeTarget(9), overtimeTarget(10), overtimeTarget(11), overtimeTarget(12)]).toEqual([10, 10, 12, 12, null]);
    expect(WHATIF_RULES).toMatchObject({ normalHoursPerDay: 8, overtimeHoursPerDay: 10, maxHoursPerDay: 12, extraUnits: 1, shiftMaxDays: 5, ownerHoursPerDay: 2, weekHours: 40 });
  });

  it('remaining duration scales with units × hours/day, rounded up', () => {
    expect([scaledRemaining(10, 40, 48), scaledRemaining(10, 4, 5), scaledRemaining(11, 60, 84), scaledRemaining(5, 1, 0)]).toEqual([9, 8, 8, 5]);
    expect(drivingIndex([{ units: 1, hoursPerDay: 8 }, { units: 6, hoursPerDay: 10 }, { units: 60, hoursPerDay: 1 }])).toBe(1);
    expect(drivingIndex([])).toBe(-1);
  });

  it('contract role and external rate from the rate card (a shared word of ≥ 5 letters, else internal × 1.4)', () => {
    const rates = { internal: {}, external: [{ role: 'Contractor — structural (external)', rateEur: 118 }], overtimeFactor: 1.25 };
    expect([contractRoleOf('Structural engineer', 'Julien Wagner'), contractRoleOf('QA / QC', 'x'), contractRoleOf(null, 'Welder')]).toEqual([
      'Contract structural engineer', 'Contract QA / QC', 'Contract welder',
    ]);
    expect([externalRateFor(rates, 'Structural engineer', 85), externalRateFor(rates, 'MEP lead', 80), externalRateFor(rates, null, null)]).toEqual([118, 112, 84]);
  });

  it('weekly hours of a span on the calendar (holidays and weekends skipped, outside the horizon ignored)', () => {
    const cal = builtinCalendars().standard_5x8;
    expect(weeklyHours(cal, '2026-09-25', '2026-10-08', 8, WEEKS)).toEqual([40, 32, 0, 0, 0, 0, 0, 0]);
    // 11 Nov (Armistice) is not worked.
    expect(weeklyHours(cal, '2026-11-09', '2026-11-13', 10, WEEKS)).toEqual([0, 0, 0, 0, 0, 0, 40, 0]);
    expect(weeklyHours(cal, null, '2026-10-08', 8, WEEKS)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('codes, set keys and EN labels', () => {
    expect([leverCode('overtime', 'A1250', 'Steel erection crew'), leverCode('extra_resource', 'A1', 'Hélène Sauvage'), leverCode('shift', 'A1520', 'x')]).toEqual([
      'overtime:A1250:steel-erection-crew', 'extra_resource:A1:helene-sauvage', 'shift:A1520',
    ]);
    expect([leverSetKey(['b', 'a', 'b']), leverSetKey([])]).toEqual(['a|b', '']);
  });
});

describe('levers derived from the data', () => {
  const m = prepareWhatIf(ctx());

  it('current plan: A 25 Sep → 8 Oct, B 9 → 22 Oct, C → 29 Oct (critical), D float 10', () => {
    expect(m.error).toBeNull();
    const a = m.base!.activities;
    expect([a.A.finish, a.B.remainingStart, a.C.finish, a.D.totalFloat, m.base!.projectFinish]).toEqual(['2026-10-08', '2026-10-09', '2026-10-29', 10, '2026-10-29']);
    expect(m.current).toMatchObject({ finish: '2026-10-29', floatDays: 0, daysGained: 0, costKeur: 0, peakPct: 120, overPeople: 1, bars: [90, 110, 120, 100, 80, 80, 80, 80] });
  });

  it('critical A: overtime and one more unit on the driving crew, relief of Paula (MEP overloaded → contractor); critical B: Ben 8 → 10 h/d, a colleague (Cleo); D: shift 5 d within float', () => {
    expect(m.levers.map((l) => [l.code, l.from, l.to, l.driving, l.helper && [l.helper.kind, l.helper.name, l.helper.rateEur]])).toEqual([
      [OT_A, 10, 12, true, null],
      [EX_A, 4, 5, true, ['same', 'Crew', 60]],
      [RELIEF, 1, 2, false, ['external', 'Contract MEP lead', 112]],
      [OT_B, 8, 10, true, null],
      [EX_B, 1, 2, true, ['internal', 'Cleo', 60]],
      [SHIFT, 0, 5, false, null],
    ]);
    expect(m.levers.map(leverLabel)).toEqual([
      'Overtime 10 → 12 h/d — Crew (A)', 'Extra resource 4 → 5 — Crew (A)', 'Contract MEP lead relieves Paula (A)', 'Overtime 8 → 10 h/d — Ben (B)',
      'Cleo joins Ben (B)', 'Shift D by 5 d — frees Paula',
    ]);
  });

  it('no lever without assignments nor overloaded people; a colleague over 100 % is not proposed (contractor instead)', () => {
    expect(prepareWhatIf(ctx({ assignments: [], people: [] })).levers).toEqual([]);
    const busy = prepareWhatIf(ctx({ people: ctx().people.map((p) => (p.name === 'Cleo' ? { ...p, loads: p.loads.map(() => 10) } : p)) }));
    expect(busy.levers.find((l) => l.code === EX_B)?.helper).toEqual({ kind: 'external', name: 'Contract QA / QC', rateEur: 84 });
  });

  it('a cycle in the plan: no lever, the error is reported', () => {
    const net = ctx().network;
    const bad = prepareWhatIf(ctx({ network: { ...net, links: [...net.links, { pred: 'C', succ: 'A', type: 'FS', lag: 0 }] } }));
    expect([bad.error, bad.levers, bad.current.finish]).toEqual(['Circular logic: A → B → C → A', [], null]);
  });
});

describe('effects (each lever alone vs the current plan)', () => {
  const m = prepareWhatIf(ctx());
  const e = leverEffects(m);
  const pick = (k: string) => [e[k].finish, e[k].daysGained, e[k].costKeur, e[k].peakPct, e[k].overPeople, e[k].loadDeltaH, e[k].overloadDeltaH, e[k].overWeeksDelta];

  it('overtime on A: 9 d instead of 10 → +1 d; cost +2.2 k€ (crew 432 h vs 400 h at 60 €/h + premium hours × 25 %, Paula one day less)', () => {
    // Crew: 4 × 12 × 9 × 60 + 4 × 4 × 9 × 15 = 28 080 vs 4 × 10 × 10 × 60 + 4 × 2 × 10 × 15 = 25 200; Paula 9 vs 10 days × 8 h × 80.
    expect(pick(OT_A)).toEqual(['2026-10-28', 1, 2.2, 115, 1, -8, -8, -1]);
  });

  it('one more crew unit on A: 8 d → +2 d; cost −1.3 k€ (same crew hours, Paula two days less); B starts earlier: Ben above 100 % w/c 5 Oct', () => {
    expect(pick(EX_A)).toEqual(['2026-10-27', 2, -1.3, 120, 1, -16, -16, 0]);
    expect(e[EX_A].sideEffects).toEqual([{ kind: 'overload', person: 'Ben', weekStart: '2026-10-05' }]);
  });

  it('contractor relieving Paula on A: no day gained, +1.3 k€ (40 h × (112 − 80)), Paula −50 / −40 pts in weeks 1–2', () => {
    expect(pick(RELIEF)).toEqual(['2026-10-29', 0, 1.3, 120, 1, -36, -36, -1]);
    expect(e[RELIEF].bars).toEqual([80, 80, 120, 100, 80, 80, 80, 80]);
  });

  it('Ben at 10 h/d (+2 d, +0.2 k€ premium) and Cleo joining Ben (5 d → +5 d, no cost)', () => {
    expect(pick(OT_B)).toEqual(['2026-10-27', 2, 0.2, 120, 2, 0, 0, 1]);
    expect(pick(EX_B)).toEqual(['2026-10-22', 5, 0, 120, 1, 0, 0, 0]);
  });

  it('shift D by 5 d: SNET 16 Oct, finish unchanged; Paula’s 2 h/d owner share moves to w/c 19 Oct (above 100 % there)', () => {
    expect(pick(SHIFT)).toEqual(['2026-10-29', 0, 0, 120, 1, 0, 0, 1]);
    expect(e[SHIFT].bars).toEqual([90, 105, 105, 120, 80, 80, 80, 80]);
    expect(e[SHIFT].sideEffects).toEqual([{ kind: 'overload', person: 'Paula', weekStart: '2026-10-19' }]);
  });

  it('levers combine through the engine (not by adding effects)', () => {
    const r = evaluateScenario(m, [OT_A, EX_A]);
    // A: ⌈10 × 40 / (5 × 12)⌉ = 7 d → +3 d. Cost: crew + helper 420 h at 60 €/h + 140 premium hours × 15 € = 31 780 €
    // with Paula's 7 days, vs 31 600 € → +0.2 k€ (the single effects add up to +0.9 k€).
    expect([r.finish, r.daysGained, r.costKeur]).toEqual(['2026-10-26', 3, 0.2]);
    expect(evaluateScenario(m, [])).toEqual(m.current);
    expect(evaluateScenario(m, ['unknown'])).toEqual(m.current);
  });
});

describe('auto-level, legacy mapping, ranking and requests', () => {
  const m = prepareWhatIf(ctx());
  const e = leverEffects(m);

  it('date → every lever gaining days; budget → no cost and a gain; people → relief without overtime nor new overload', () => {
    expect(autoLevel(m.levers, e, 'date')).toEqual([OT_A, EX_A, OT_B, EX_B]);
    expect(autoLevel(m.levers, e, 'budget')).toEqual([EX_A, EX_B]);
    expect(autoLevel(m.levers, e, 'people')).toEqual([RELIEF]);
  });

  it('seed scenarios A / B: contractor → extra resources (not colleagues), overtime → overtime, delay → shifts, move → colleagues, split → none', () => {
    expect(legacyLeverSet(m.levers, ['contractor', 'overtime'])).toEqual([OT_A, EX_A, RELIEF, OT_B]);
    expect(legacyLeverSet(m.levers, ['delay', 'move'])).toEqual([EX_B, SHIFT]);
    expect(legacyLeverSet(m.levers, ['split'])).toEqual([]);
  });

  it('suggestions rank: most days gained, then most relief, then cheapest', () => {
    const rows = m.levers.map((lever) => ({ lever, effect: e[lever.code] }));
    expect(rankLevers(rows).map((r) => r.lever.code)).toEqual([EX_B, EX_A, OT_B, OT_A, RELIEF, SHIFT]);
  });

  it('requests of a lever set follow the scenario schedule (shifts need none)', () => {
    expect(scenarioRequests(m, [OT_A, EX_A, RELIEF, EX_B, SHIFT]).map((r) => [r.title, r.person, r.contractRole, r.hours, r.start, r.due, r.priority])).toEqual([
      ['Overtime 10 → 12 h/d — Crew', null, 'Crew', 56, '2026-09-25', '2026-10-05', 'high'],
      ['Extra resource 4 → 5 — Crew', null, 'Crew', 84, '2026-09-25', '2026-10-05', 'high'],
      ['Contract MEP lead — relieve Paula', null, 'Contract MEP lead', 28, '2026-09-25', '2026-10-05', 'high'],
      ['Help Ben — B Inspection', 'Cleo', null, 40, '2026-10-06', '2026-10-12', 'high'],
    ]);
    expect(scenarioRequests(m, [SHIFT])).toEqual([]);
  });
});
