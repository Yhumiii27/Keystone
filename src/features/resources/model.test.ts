// Resources / Project resources and What-if view models: the strings and colours of the prototype (docs/spec/06
// §1.4–§1.6, 05 §4.4) in English and French, built from the prototype constants. Chapter 4: unmet demand and peak weeks are
// computed (A-12), the suggestions and the what-if levers come from the engine (S-7, fixture src/domain/whatif.test-fixture.ts).
import { describe, expect, it } from 'vitest';
import { LO, OK } from '@/components/app/tones';
import { makeT } from '@/i18n/translate';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import { initials } from '@/lib/format';
import { autoLevel, evaluateScenario, leverEffects, leverSetKey, prepareWhatIf, WHATIF_PRIORITIES, type WhatIfPriority, type WhatIfResult } from '@/domain/whatif';
import { EX_A, EX_B, OT_A, RELIEF, SHIFT, WEEKS as WEEK_STARTS, whatIfFixture } from '@/domain/whatif.test-fixture';
import { peakWeeksText, resourcesView, weekLabel, type ResourcesInput, type SuggestionInput } from './model';
import {
  applyMessage, copyNote, costText, floatDaysText, leverData, leverEffectText, leverText, overWeeksText, reduceScenarios, resultOf, scenarioTitle, sideEffectText,
  suggestionMessage, whatIfView, type WhatIfData,
} from './whatif-model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;
const en = makeT('en');
const fr = makeT('fr');
const WEEKS = ['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9', 'Nov 16'];

// What-if model of the fixture network (levers, single effects, auto-level) — also the source of the suggestions.
const M = prepareWhatIf(whatIfFixture());
const EFFECTS = leverEffects(M);
const AUTO = Object.fromEntries(WHATIF_PRIORITIES.map((p) => [p, autoLevel(M.levers, EFFECTS, p)])) as Record<WhatIfPriority, string[]>;
const SUGGESTIONS: SuggestionInput[] = [EX_A, RELIEF].map((code) => {
  const { effect, ...lever } = leverData(M.levers.find((l) => l.code === code)!, EFFECTS[code]);
  return { projectCode: 'HLT-026', projectLabel: 'Harbor Line', lever, effect, currentPeakPct: M.current.peakPct, requested: code === EX_A ? 'RQ-045' : null, canApply: true };
});

const people = (team?: string[]) =>
  (P.PEOPLE as [string, string, number[]][])
    .filter(([n]) => !team || team.includes(n))
    .map(([name, jobTitle, loads]) => ({ name, initials: initials(name), jobTitle, department: P.DEPT_OF[name] ?? null, loads }));
const portfolio: ResourcesInput = {
  scope: 'portfolio',
  weeks: WEEKS,
  weekStarts: WEEK_STARTS,
  people: people(),
  departments: (P.ROLES as [string, number, number][]).map(([name, capacityH, demandH]) => ({ name, capacityH, demandH })),
  labor: { budget: 1850, actual: 1420 },
  openRequests: 4,
  suggestions: SUGGESTIONS,
};
const project = (code: string): ResourcesInput => {
  const pd = G.projectData[code];
  const labor = (pd.CATS as [string, number, number][]).find((c) => /labor|staff/i.test(c[0]))!;
  return { ...portfolio, scope: 'project', people: people(pd.team), departments: [], labor: { budget: labor[1], actual: labor[2] }, openRequests: code === 'HLT-026' ? 4 : 0, suggestions: code === 'HLT-026' ? SUGGESTIONS : null };
};

describe('resourcesView — Resources (portfolio)', () => {
  it('KPI tiles (EN)', () => {
    const v = resourcesView(portfolio, en, 'en');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Team utilization', '83%', 'Target 85–95%', OK],
      // A-12: computed — someone above 110 % in ISO weeks 42–44 (prototype constant "41–43"); Σ max(0, dem − cap) = 280 h
      // (prototype constant 240 h), Engineering short the most.
      ['Over-allocated', '3 people', 'Peak weeks 42–44', LO],
      ['Unmet demand', '280 h', 'Mostly engineering', LO],
      ['Labor cost to date', '€1.42M', '77% of labor budget', OK],
      ['Open requests', '4', 'Across all projects', OK],
    ]);
  });

  it('KPI tiles (FR)', () => {
    const v = resourcesView(portfolio, fr, 'fr');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Taux d’occupation', '83%', 'Cible 85–95 %'],
      ['Surchargés', '3 personnes', 'Pointe semaines 42–44'],
      ['Demande non couverte', '280 h', 'Surtout ingénierie'],
      ['Main-d’œuvre à date', '1,42 M€', '77 % du budget main-d’œuvre'],
      ['Demandes ouvertes', '4', 'Tous projets'],
    ]);
  });

  it('heatmap rows: cells with shade() colours, Avg text and colour, My work link', () => {
    const v = resourcesView(portfolio, en, 'en');
    expect(v.weeks).toEqual(WEEKS);
    expect(v.people.map((p) => [p.name, p.role, p.initials, p.avgText, p.avgColor])).toEqual([
      ['Amélie Ollivier', 'Site lead', 'AO', '101%', LO],
      ['Julien Wagner', 'Structural engineer', 'JW', '99%', OK],
      ['Pauline Noguès', 'MEP lead', 'PN', '98%', OK],
      ['Thomas Kerbrat', 'Crane operations', 'TK', '65%', OK],
      ['Léa Marchand', 'Cost controller', 'LM', '73%', OK],
      ['Damien Roux', 'Planner', 'DR', '87%', OK],
      ['Hélène Sauvage', 'QA / QC', 'HS', '79%', OK],
      ['Fabien Bertrand', 'Procurement', 'FB', '64%', OK],
    ]);
    const julien = v.people[1];
    expect(julien.href).toBe('/my/tasks?person=Julien%20Wagner');
    expect(julien.cells[2]).toEqual({ v: 130, bg: 'var(--color-accent-400)', fg: 'var(--color-bg)' });
    expect(julien.cells[4]).toEqual({ v: 110, bg: 'var(--color-accent-600)', fg: 'var(--color-accent-100)' });
    expect(julien.cells[7]).toEqual({ v: 60, bg: 'var(--color-accent-900)', fg: 'var(--color-neutral-300)' });
    expect(v.people[6].cells[0]).toEqual({ v: 40, bg: 'var(--color-neutral-900)', fg: 'var(--color-neutral-400)' });
  });

  it('capacity vs demand bars (ROLES order) and suggestions', () => {
    const v = resourcesView(portfolio, en, 'en');
    expect(v.roles.map((r) => [r.name, r.text, r.color])).toEqual([
      ['Engineering', '1110 / 960 h', LO],
      ['Site operations', '690 / 640 h', LO],
      ['MEP', '510 / 480 h', LO],
      ['Controls & planning', '560 / 640 h', 'var(--color-neutral-300)'],
      ['Quality', '370 / 320 h', LO],
    ]);
    // R-3 / S-7: the suggestions are what-if levers (the prototype listed three static sentences).
    expect(v.suggestions).toEqual([
      { projectCode: 'HLT-026', leverCode: EX_A, title: 'Extra resource A · Crew 4 → 5', hint: 'A · Erection', impact: 'Harbor Line · +2 d · −€1k', requested: 'Requested · RQ-045', canApply: true },
      { projectCode: 'HLT-026', leverCode: RELIEF, title: 'Contract MEP lead relieves Paula on A', hint: 'A · Erection', impact: 'Harbor Line · +€1k · load −36 h', requested: null, canApply: true },
    ]);
  });

  it('portfolio: no department over capacity; nobody above 110 %', () => {
    const calm = resourcesView({ ...portfolio, departments: [{ name: 'MEP', capacityH: 480, demandH: 400 }], people: people(['Léa Marchand']) }, en, 'en');
    expect(calm.kpis.slice(1, 3).map((k) => [k.value, k.sub, k.color])).toEqual([['0 people', 'No week above 110%', OK], ['0 h', 'No department over capacity', OK]]);
    expect(peakWeeksText([{ loads: [0, 0, 0, 120] }], WEEK_STARTS, 'fr')).toBe('Pointe semaine 43');
    expect(resourcesView({ ...portfolio, departments: [{ name: 'Site operations', capacityH: 100, demandH: 130 }] }, fr, 'fr').kpis[2].sub).toBe('Surtout exploitation chantier');
  });

  it('French: week labels day first, job titles, departments and suggestions translated', () => {
    const v = resourcesView(portfolio, fr, 'fr');
    expect(v.weeks).toEqual(['28 sept.', '5 oct.', '12 oct.', '19 oct.', '26 oct.', '2 nov.', '9 nov.', '16 nov.']);
    expect(v.people.map((p) => p.role)).toEqual(['Chef de chantier', 'Ingénieur structure', 'Responsable CVC-élec', 'Exploitation grues', 'Contrôleur de coûts', 'Planificateur', 'QA / QC', 'Achats']);
    expect(v.roles.map((r) => r.name)).toEqual(['Ingénierie', 'Exploitation chantier', 'CVC-élec', 'Contrôle et planification', 'Qualité']);
    expect(v.suggestions?.map((g) => [g.title, g.impact, g.requested])).toEqual([
      ['Ressource supplémentaire A · Crew 4 → 5', 'Harbor Line · +2 j · −1 k€', 'Demandée · RQ-045'],
      ['Responsable CVC-élec intérimaire soulage Paula sur A', 'Harbor Line · +1 k€ · charge −36 h', null],
    ]);
    expect(weekLabel('Sep 28', en, 'en')).toBe('Sep 28');
  });
});

describe('resourcesView — Project resources (06 §1.6 per-project table)', () => {
  // A-12: the peak weeks are the ISO weeks in which a team member is above 110 % (prototype constant "Peak weeks 41–43");
  // "Unmet demand" takes the attention colour only when above 0 h (always LO in the prototype).
  it.each([
    ['HLT-026', '83%', '8 people assigned', '3 people', LO, 'Peak weeks 42–44', '0 h', OK, '€1.42M', '77% of labor budget', '4', true],
    ['NDC-031', '80%', '4 people assigned', '1 person', LO, 'Peak week 44', '0 h', OK, '€340k', '49% of labor budget', '0', false],
    ['RCF-019', '93%', '3 people assigned', '2 people', LO, 'Peak weeks 42–44', '3 h', LO, '€430k', '90% of labor budget', '0', false],
    ['ERP-202', '80%', '2 people assigned', '0 people', OK, 'No week above 110%', '0 h', OK, '€162k', '43% of labor budget', '0', false],
    ['WSA-044', '82%', '4 people assigned', '2 people', LO, 'Peak weeks 42–44', '0 h', OK, '€160k', '26% of labor budget', '0', false],
    ['MSR-012', '77%', '3 people assigned', '0 people', OK, 'No week above 110%', '0 h', OK, '€160k', '89% of labor budget', '0', false],
  ])('%s', (code, load, assigned, over, overColor, peakWeeks, unmet, unmetColor, labor, share, open, sugg) => {
    const v = resourcesView(project(code), en, 'en');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Project team load', load, assigned],
      ['Over-allocated', over, peakWeeks],
      ['Unmet demand', unmet, 'Next 8 weeks, by department'],
      ['Labor cost to date', labor, share],
      ['Open requests', open, 'Awaiting department approval'],
    ]);
    expect([v.kpis[1].color, v.kpis[2].color]).toEqual([overColor, unmetColor]);
    expect(!!v.suggestions).toBe(sugg);
  });

  it('RCF-019 departments: PEOPLE order, 320 h per person; Site operations 323 / 320 h over', () => {
    const v = resourcesView(project('RCF-019'), en, 'en');
    expect(v.people.map((p) => p.name)).toEqual(['Amélie Ollivier', 'Pauline Noguès', 'Hélène Sauvage']);
    expect(v.roles.map((r) => [r.name, r.text, r.color])).toEqual([
      ['Site operations', '323 / 320 h', LO],
      ['MEP', '314 / 320 h', 'var(--color-neutral-300)'],
      ['Quality', '253 / 320 h', 'var(--color-neutral-300)'],
    ]);
  });

  it('singular and empty team (FR)', () => {
    const one = resourcesView({ ...project('ERP-202'), people: people(['Damien Roux']) }, fr, 'fr');
    expect(one.kpis[0].sub).toBe('1 personne affectée');
    expect(one.kpis[1].value).toBe('0 personnes');
    const none = resourcesView({ ...project('ERP-202'), people: [], labor: null }, fr, 'fr');
    expect(none.kpis.map((k) => [k.value, k.sub])).toEqual([
      ['0%', '0 personnes affectées'],
      ['0 personnes', 'Aucune semaine au-dessus de 110 %'],
      ['0 h', '8 prochaines semaines, par service'],
      ['—', ''],
      ['0', 'En attente d’approbation du service'],
    ]);
    expect(none.roles).toEqual([]);
  });
});

// ── What-if (chapter 4, S-7) ──────────────────────────────────────────────────────────────────────────

const results: Record<string, WhatIfResult> = { '': M.current };
const put = (codes: string[]) => (results[leverSetKey(codes)] = evaluateScenario(M, codes));
put([OT_A, EX_A]);
put([RELIEF]);
const WI: WhatIfData = {
  projectCode: 'HLT-026',
  dataDate: '2026-09-25',
  weeks: WEEKS,
  weekStarts: WEEK_STARTS,
  levers: M.levers.map((l) => leverData(l, EFFECTS[l.code])),
  auto: AUTO,
  current: M.current,
  results,
  plan: { forecastFinish: '2027-01-14', floatDays: -27 },
  baseline: { code: 'BL1', finish: '2026-12-18' },
  peak: { pct: 130, person: 'Julien Wagner', weekStart: '2026-10-12' },
  overByWeek: [0, 1, 2, 3, 2, 0, 1, 0],
  scenarios: [
    { name: 'A', priority: 'date', levers: { [OT_A]: true, [EX_A]: true }, selected: false, applied: true, requests: { draft: 2, sent: 0 }, hypotheses: null },
    { name: 'B', priority: 'people', levers: { [RELIEF]: true }, selected: true, applied: false, requests: { draft: 0, sent: 0 }, hypotheses: 'No overtime' },
  ],
  error: null,
};

describe('whatIfView', () => {
  it('KPI tiles (EN): "Baseline finish" shows the displayed baseline (S-7; the prototype showed the forecast), weeks computed (A-12)', () => {
    expect(whatIfView(WI, en, 'en').kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Baseline finish', '18 Dec 2026', 'BL1 · forecast 14 Jan 2027 · float −27 d', LO],
      ['Peak load', '130%', 'Julien Wagner · week of 12 Oct', LO],
      // 3 people above 100 % in w/c 19 Oct only (ISO week 43); the prototype said "Weeks 41–43".
      ['People above 100%', '3', 'Week 43', LO],
      ['Scenarios', '2', 'Compared side by side · PM sets the priority', OK],
    ]);
  });

  it('KPI tiles (FR)', () => {
    expect(whatIfView(WI, fr, 'fr').kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Fin de référence', '18 déc. 2026', 'BL1 · prévision 14 janv. 2027 · marge −27 j'],
      ['Charge de pointe', '130%', 'Julien Wagner · semaine du 12 oct.'],
      ['Personnes au-dessus de 100 %', '3', 'Semaine 43'],
      ['Scénarios', '2', 'Comparés côte à côte · le chef de projet fixe la priorité'],
    ]);
  });

  it('side by side: the current plan recalculated, then each scenario (engine results)', () => {
    const v = whatIfView(WI, en, 'en');
    expect(v.columns).toEqual(['Current plan', 'Scenario A', 'Scenario B']);
    expect(v.compare.map((r) => [r.key, ...r.values.map((x) => x.value)])).toEqual([
      ['Forecast finish', '29 Oct 2026', '26 Oct 2026', '29 Oct 2026'],
      ['Critical-path float', '+0 days', '+0 days', '+0 days'],
      ['Cost impact (EAC)', '—', '+<€1k', '+€1k'],
      ['Peak load', '120%', '140%', '120%'],
      ['People above 100%', '1', '1', '1'],
      // S-7 (recommended option of DELIVERY-6-PLAN §3.3): the team hours each lever set frees (−) or adds (+) over the horizon.
      ['Load change (h)', '0', '−24', '−36'],
      ['Side effects', 'None', 'Ben above 100% · week of 5 Oct', 'None'],
    ]);
    expect(v.compare[3].values.map((x) => x.color)).toEqual([LO, LO, LO]);
    expect(v.note).toBe(
      'Effects are computed by the CPM engine on a copy of the plan at the data date (25 Sep 2026): the plan itself changes only at the next Reschedule. Requests are created as drafts until you send them from Resource requests.',
    );
  });

  it('scenario card: derived levers with their single effects, bars, applied tag', () => {
    const [a, b] = whatIfView(WI, en, 'en').scenarios;
    expect(a.levers.map((l) => [l.label, l.on, l.effect, l.title])).toEqual([
      ['Overtime A · Crew 10 → 12 h/d', true, '+1 d · +€2k · peak −5 pts', 'A · Erection'],
      ['Extra resource A · Crew 4 → 5', true, '+2 d · −€1k', 'A · Erection'],
      ['Contract MEP lead relieves Paula on A', false, '+€1k · load −36 h', 'A · Erection'],
      ['Overtime B · Ben 8 → 10 h/d', false, '+2 d · +<€1k', 'B · Inspection'],
      ['Cleo joins Ben on B', false, '+5 d', 'B · Inspection'],
      ['Shift D by 5 d · frees Paula', false, 'no effect', 'D · Cabling'],
    ]);
    expect(a.bars.map((x) => x.label)).toEqual(['28', '5', '12', '19', '26', '2', '9', '16']);
    expect(a.bars.slice(0, 3)).toEqual([
      { label: '28', height: '64.3%', bg: 'var(--color-neutral-700)' },
      { label: '5', height: '100%', bg: 'var(--color-accent-400)' },
      { label: '12', height: '75%', bg: 'var(--color-accent-600)' },
    ]);
    expect([a.applied, a.appliedText, a.pending, b.selected, b.hypotheses]).toEqual([true, '2 draft requests · 0 sent', false, true, 'No overtime']);
  });

  it('French scenario card', () => {
    const a = whatIfView(WI, fr, 'fr').scenarios[0];
    expect(a.title).toBe('Scénario A');
    expect(a.levers.map((l) => [l.label, l.effect])).toEqual([
      ['Heures sup. A · Crew 10 → 12 h/j', '+1 j · +2 k€ · pointe −5 pts'],
      ['Ressource supplémentaire A · Crew 4 → 5', '+2 j · −1 k€'],
      ['Responsable CVC-élec intérimaire soulage Paula sur A', '+1 k€ · charge −36 h'],
      ['Heures sup. B · Ben 8 → 10 h/j', '+2 j · +< 1 k€'],
      ['Cleo rejoint Ben sur B', '+5 j'],
      ['Décaler D de 5 j · libère Paula', 'sans effet'],
    ]);
    expect(a.results.map((r) => [r.key, r.value])).toEqual([
      ['Fin prévisionnelle', '26 oct. 2026'],
      ['Marge du chemin critique', '+0 jours'],
      ['Impact coût (EAC)', '+< 1 k€'],
      ['Charge de pointe', '140%'],
      ['Personnes au-dessus de 100 %', '1'],
      ['Variation de charge (h)', '−24'],
      ['Effets de bord', 'Ben au-dessus de 100 % · semaine du 5 oct.'],
    ]);
    expect(a.appliedText).toBe('2 demande(s) en brouillon · 0 envoyée(s)');
    expect(scenarioTitle('Nuit', fr)).toBe('Scénario Nuit');
    expect([scenarioTitle('Scenario C', en), scenarioTitle('scénario D', fr)]).toEqual(['Scenario C', 'scénario D']);
  });

  it('reducer mirrors the Server Functions: toggle, priority (levers kept), auto-level (derived set), select', () => {
    let s = reduceScenarios(WI.scenarios, { type: 'toggle', name: 'A', lever: SHIFT }, WI);
    expect(Object.keys(s[0].levers).filter((k) => s[0].levers[k])).toEqual([OT_A, EX_A, SHIFT]);
    s = reduceScenarios(s, { type: 'priority', name: 'A', priority: 'budget' }, WI);
    expect([s[0].priority, s[0].levers[SHIFT]]).toEqual(['budget', true]);
    s = reduceScenarios(s, { type: 'auto', name: 'A' }, WI);
    expect(Object.keys(s[0].levers).filter((k) => s[0].levers[k])).toEqual([EX_A, EX_B]);
    s = reduceScenarios(s, { type: 'select', name: 'A' }, WI);
    expect(s.map((x) => x.selected)).toEqual([true, false]);
  });

  it('an optimistic lever set without a computed result keeps the saved result, flagged pending', () => {
    const toggled = reduceScenarios(WI.scenarios, { type: 'toggle', name: 'A', lever: SHIFT }, WI);
    const v = whatIfView({ ...WI, scenarios: toggled }, en, 'en', WI.scenarios);
    expect([v.scenarios[0].pending, v.scenarios[0].results[0].value]).toEqual([true, '26 Oct 2026']);
    expect(resultOf(WI, { levers: {} })).toEqual({ result: M.current, pending: false });
  });

  it('texts: float, cost, side effects, weeks, toasts', () => {
    expect([floatDaysText(-1, en), floatDaysText(1, fr), floatDaysText(0, en), floatDaysText(-16, fr)]).toEqual(['−1 day', '+1 jour', '+0 days', '−16 jours']);
    expect([costText(0, 'en'), costText(0.4, 'en'), costText(-0.3, 'fr'), costText(4.5, 'en'), costText(-1.3, 'fr')]).toEqual(['—', '+<€1k', '−< 1 k€', '+€5k', '−1 k€']);
    expect(sideEffectText({ kind: 'critical', activity: 'A1520' }, 'fr')).toBe('A1520 devient critique');
    expect(sideEffectText({ kind: 'violation', activity: 'A1320', constraint: 'SNLT' }, 'en')).toBe('A1320 misses its SNLT');
    expect([overWeeksText([0, 2, 2, 0], WEEK_STARTS, 'en'), overWeeksText([0, 0], WEEK_STARTS, 'fr')]).toEqual(['Weeks 41–42', 'Aucune semaine au-dessus de 100 %']);
    expect(copyNote('2026-09-25', 'fr')).toContain('date d’état (25 sept. 2026)');
    expect(leverText({ kind: 'extra_resource', activity: 'A1250', resource: 'Julien Wagner', person: 'Julien Wagner', from: 1, to: 2, helper: { kind: 'external', name: 'Contract structural engineer' }, driving: false }, fr, 'fr')).toBe(
      'Ingénieur structure intérimaire soulage Julien Wagner sur A1250',
    );
    expect(leverEffectText({ ...M.current }, M.current, en, 'en')).toBe('no effect');
    expect(applyMessage({ created: ['RQ-045', 'RQ-046'], skipped: 0, shifts: 1 }, 'Scenario A', 'en')).toBe(
      'Scenario A selected · 2 draft requests created (RQ-045, RQ-046) — send them from Resource requests · 1 shift to enter in the plan before the next Reschedule',
    );
    expect(applyMessage({ created: [], skipped: 2, shifts: 0 }, 'Scénario A', 'fr')).toBe('Scénario A retenu · ses demandes existent déjà');
    expect(applyMessage({ created: [], skipped: 0, shifts: 0 }, 'Scenario B', 'en')).toBe('Scenario B selected · no lever needs a resource request');
    expect([suggestionMessage('RQ-047', 'en'), suggestionMessage(null, 'fr')]).toEqual(['Draft request RQ-047 created — send it from Resource requests', 'Ce levier est déjà demandé']);
  });

  it('no forecast, no baseline, no peak, nobody above 100 %: dashes', () => {
    const v = whatIfView({ ...WI, plan: { forecastFinish: null, floatDays: null }, baseline: null, peak: null, overByWeek: [0, 0] }, en, 'en');
    expect(v.kpis.map((k) => [k.value, k.sub])).toEqual([
      ['—', 'forecast —'],
      ['—', ''],
      ['0', 'No week above 100%'],
      ['2', 'Compared side by side · PM sets the priority'],
    ]);
  });
});
