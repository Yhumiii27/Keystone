// Resources / Project resources and What-if view models: the strings and colours of the prototype (docs/spec/06
// §1.4–§1.6, 05 §4.4) in English and French, built from the prototype constants.
import { describe, expect, it } from 'vitest';
import { LO, OK } from '@/components/app/tones';
import { makeT } from '@/i18n/translate';
import PROTO from '@/server/prototype/prototype-data.json';
import GEN from '@/server/prototype/prototype-generated.json';
import { initials } from '@/lib/format';
import { resourcesView, weekLabel, type ResourcesInput } from './model';
import { floatDaysText, leverEffectText, reduceScenarios, scenarioTitle, whatIfView, type WhatIfData } from './whatif-model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = GEN as any;
const en = makeT('en');
const fr = makeT('fr');
const WEEKS = ['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9', 'Nov 16'];

const people = (team?: string[]) =>
  (P.PEOPLE as [string, string, number[]][])
    .filter(([n]) => !team || team.includes(n))
    .map(([name, jobTitle, loads]) => ({ name, initials: initials(name), jobTitle, department: P.DEPT_OF[name] ?? null, loads }));
const portfolio: ResourcesInput = {
  scope: 'portfolio',
  weeks: WEEKS,
  people: people(),
  departments: (P.ROLES as [string, number, number][]).map(([name, capacityH, demandH]) => ({ name, capacityH, demandH })),
  labor: { budget: 1850, actual: 1420 },
  openRequests: 4,
  showSuggestions: true,
};
const project = (code: string): ResourcesInput => {
  const pd = G.projectData[code];
  const labor = (pd.CATS as [string, number, number][]).find((c) => /labor|staff/i.test(c[0]))!;
  return { ...portfolio, scope: 'project', people: people(pd.team), departments: [], labor: { budget: labor[1], actual: labor[2] }, openRequests: code === 'HLT-026' ? 4 : 0, showSuggestions: code === 'HLT-026' };
};

describe('resourcesView — Resources (portfolio)', () => {
  it('KPI tiles (EN)', () => {
    const v = resourcesView(portfolio, en, 'en');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Team utilization', '83%', 'Target 85–95%', OK],
      ['Over-allocated', '3 people', 'Peak weeks 41–43', LO],
      ['Unmet demand', '240 h', 'Mostly engineering', LO],
      ['Labor cost to date', '€1.42M', '77% of labor budget', OK],
      ['Open requests', '4', 'Across all projects', OK],
    ]);
  });

  it('KPI tiles (FR)', () => {
    const v = resourcesView(portfolio, fr, 'fr');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Taux d’occupation', '83%', 'Cible 85–95 %'],
      ['Surchargés', '3 personnes', 'Pointe semaines 41–43'],
      ['Demande non couverte', '240 h', 'Surtout ingénierie'],
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
    expect(v.suggestions).toEqual([
      { title: 'Move steel QA checks from Julien Wagner to Hélène Sauvage in weeks 41–42', impact: 'Julien 130% → 105% · no cost' },
      { title: 'Bring in a contract structural engineer for 3 weeks', impact: 'Recovers ~12 days float · +€18k' },
      { title: 'Shift paving prep 1 week later to free Amélie Ollivier', impact: 'Site lead 120% → 100% · off critical path' },
    ]);
  });

  it('French: week labels day first, job titles, departments and suggestions translated', () => {
    const v = resourcesView(portfolio, fr, 'fr');
    expect(v.weeks).toEqual(['28 sept.', '5 oct.', '12 oct.', '19 oct.', '26 oct.', '2 nov.', '9 nov.', '16 nov.']);
    expect(v.people.map((p) => p.role)).toEqual(['Chef de chantier', 'Ingénieur structure', 'Responsable CVC-élec', 'Exploitation grues', 'Contrôleur de coûts', 'Planificateur', 'QA / QC', 'Achats']);
    expect(v.roles.map((r) => r.name)).toEqual(['Ingénierie', 'Exploitation chantier', 'CVC-élec', 'Contrôle et planification', 'Qualité']);
    expect(v.suggestions?.[1]).toEqual({ title: 'Faire appel à un ingénieur structure en prestation pendant 3 semaines', impact: 'Récupère ~12 jours de marge · +18 k€' });
    expect(weekLabel('Sep 28', en, 'en')).toBe('Sep 28');
  });
});

describe('resourcesView — Project resources (06 §1.6 per-project table)', () => {
  it.each([
    ['HLT-026', '83%', '8 people assigned', '3 people', LO, '0 h', '€1.42M', '77% of labor budget', '4', true],
    ['NDC-031', '80%', '4 people assigned', '1 person', LO, '0 h', '€340k', '49% of labor budget', '0', false],
    ['RCF-019', '93%', '3 people assigned', '2 people', LO, '3 h', '€430k', '90% of labor budget', '0', false],
    ['ERP-202', '80%', '2 people assigned', '0 people', OK, '0 h', '€162k', '43% of labor budget', '0', false],
    ['WSA-044', '82%', '4 people assigned', '2 people', LO, '0 h', '€160k', '26% of labor budget', '0', false],
    ['MSR-012', '77%', '3 people assigned', '0 people', OK, '0 h', '€160k', '89% of labor budget', '0', false],
  ])('%s', (code, load, assigned, over, overColor, unmet, labor, share, open, sugg) => {
    const v = resourcesView(project(code), en, 'en');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Project team load', load, assigned],
      ['Over-allocated', over, 'Peak weeks 41–43'],
      ['Unmet demand', unmet, 'Next 8 weeks, by department'],
      ['Labor cost to date', labor, share],
      ['Open requests', open, 'Awaiting department approval'],
    ]);
    expect(v.kpis[1].color).toBe(overColor);
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
      ['0 personnes', 'Pointe semaines 41–43'],
      ['0 h', '8 prochaines semaines, par service'],
      ['—', ''],
      ['0', 'En attente d’approbation du service'],
    ]);
    expect(none.roles).toEqual([]);
  });
});

// ── What-if ────────────────────────────────────────────────────────────────────────────────────────────

const LEVERS = (P.LEVERS as [string, string, { float: number; cost: number; peak: number; over: number; side?: string }][]).map(([code, label, fx]) => ({
  code, label, floatDays: fx.float, costKeur: fx.cost, peakPts: fx.peak, overPeople: fx.over, sideEffect: fx.side ?? null,
}));
const WI: WhatIfData = {
  projectCode: 'HLT-026',
  levers: LEVERS,
  auto: P.AUTO,
  weeks: WEEKS,
  base: { floatDays: -27, forecastFinish: '2027-01-14', peakPct: 130, overPeople: 3, baseLoad: [100, 110, 130, 125, 110, 100, 80, 60] },
  baseline: { code: 'BL1', finish: '2026-12-18' },
  peak: { pct: 130, person: 'Julien Wagner', weekStart: '2026-10-12' },
  scenarios: [
    { name: 'A', priority: 'date', levers: { contractor: true, overtime: true }, selected: false },
    { name: 'B', priority: 'people', levers: { delay: true, move: true }, selected: false },
  ],
};

describe('whatIfView', () => {
  it('KPI tiles (EN): the first tile is labelled "Forecast finish" (prototype defect "Baseline finish", 00 §7.16)', () => {
    expect(whatIfView(WI, en, 'en').kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Forecast finish', '14 Jan 2027', 'BL1 18 Dec 2026 · float −27 d', LO],
      ['Peak load', '130%', 'Julien Wagner · week of 12 Oct', LO],
      ['People above 100%', '3', 'Weeks 41–43', LO],
      ['Scenarios', '2', 'Compared side by side · PM sets the priority', OK],
    ]);
  });

  it('KPI tiles (FR)', () => {
    expect(whatIfView(WI, fr, 'fr').kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Fin prévisionnelle', '14 janv. 2027', 'BL1 18 déc. 2026 · marge −27 j'],
      ['Charge de pointe', '130%', 'Julien Wagner · semaine du 12 oct.'],
      ['Personnes au-dessus de 100 %', '3', 'Semaines 41–43'],
      ['Scénarios', '2', 'Comparés côte à côte · le chef de projet fixe la priorité'],
    ]);
  });

  it('scenario A and B results (05 §4.4 default results) and side-by-side rows', () => {
    const v = whatIfView(WI, en, 'en');
    expect(v.scenarios.map((s) => s.title)).toEqual(['Scenario A', 'Scenario B']);
    expect(v.compare.map((r) => [r.key, ...r.values.map((x) => x.value)])).toEqual([
      ['Forecast finish', '25 Dec 2026', '8 Jan 2027'],
      ['Critical-path float', '−7 days', '−21 days'],
      ['Cost impact (EAC)', '+€27k', '—'],
      ['Peak load', '120%', '105%'],
      ['People above 100%', '2', '1'],
      ['Side effects', 'None', 'Westfield SPI −0.02'],
    ]);
    expect(v.compare.map((r) => r.values.map((x) => x.color))).toEqual([
      [LO, LO], [LO, LO], [LO, OK], [LO, OK], [LO, LO], ['var(--color-neutral-300)', 'var(--color-neutral-300)'],
    ]);
  });

  it('scenario card: levers, effect texts, bars', () => {
    const a = whatIfView(WI, en, 'en').scenarios[0];
    expect(a.levers.map((l) => [l.label, l.on, l.effect])).toEqual([
      ['Delay non-critical activities', false, 'peak −15 pts'],
      ['Add contractor / temp (3 weeks)', true, '+12 d · +€18k · peak −20 pts'],
      ['Authorise overtime (steel crew)', true, '+8 d · +€9k · peak +10 pts'],
      ['Split steel structure activity', false, '+4 d · +€2k · peak −5 pts'],
      ['Move 1 engineer from Westfield Solar', false, '+6 d · peak −10 pts'],
    ]);
    expect(a.bars.map((b) => b.label)).toEqual(['28', '5', '12', '19', '26', '2', '9', '16']);
    expect(a.bars[2]).toEqual({ label: '12', height: `${120 / 1.4}%`, bg: 'var(--color-accent-400)' });
    expect(a.bars[3].bg).toBe('var(--color-accent-600)');
    expect(a.bars[0].bg).toBe('var(--color-neutral-700)');
  });

  it('French scenario card', () => {
    const b = whatIfView(WI, fr, 'fr').scenarios[1];
    expect(b.title).toBe('Scénario B');
    expect(b.levers.map((l) => [l.label, l.effect])).toEqual([
      ['Décaler les activités non critiques', 'pointe −15 pts'],
      ['Ajouter un prestataire (3 semaines)', '+12 j · +18 k€ · pointe −20 pts'],
      ['Autoriser les heures sup. (équipe charpente)', '+8 j · +9 k€ · pointe +10 pts'],
      ['Scinder l’activité charpente', '+4 j · +2 k€ · pointe −5 pts'],
      ['Déplacer 1 ingénieur de Westfield Solar', '+6 j · pointe −10 pts'],
    ]);
    expect(b.results.map((r) => [r.key, r.value])).toEqual([
      ['Fin prévisionnelle', '8 janv. 2027'],
      ['Marge du chemin critique', '−21 jours'],
      ['Impact coût (EAC)', '—'],
      ['Charge de pointe', '105%'],
      ['Personnes au-dessus de 100 %', '1'],
      ['Effets de bord', 'Westfield SPI −0.02'],
    ]);
    expect(scenarioTitle('Nuit', fr)).toBe('Scénario Nuit');
    expect([scenarioTitle('Scenario C', en), scenarioTitle('scénario D', fr)]).toEqual(['Scenario C', 'scénario D']);
    expect(leverEffectText({ code: 'x', floatDays: 0, costKeur: 0, peakPts: 0, overPeople: 0 }, en, 'en')).toBe('');
  });

  it('reducer mirrors the Server Functions: toggle, priority (levers kept), auto-level, select', () => {
    let s = reduceScenarios(WI.scenarios, { type: 'toggle', name: 'A', lever: 'split' }, WI);
    expect(s[0].levers).toEqual({ contractor: true, overtime: true, split: true });
    s = reduceScenarios(s, { type: 'priority', name: 'A', priority: 'budget' }, WI);
    expect([s[0].priority, s[0].levers.split]).toEqual(['budget', true]);
    s = reduceScenarios(s, { type: 'auto', name: 'A' }, WI);
    expect(s[0].levers).toEqual({ delay: true, contractor: false, overtime: false, split: true, move: true });
    s = reduceScenarios(s, { type: 'select', name: 'B' }, WI);
    expect(s.map((x) => x.selected)).toEqual([false, true]);
    expect(whatIfView({ ...WI, scenarios: s }, en, 'en').scenarios[0].results[0].value).toBe('4 Jan 2027'); // delay + split + move: +10 d
  });

  it('critical-path float of ±1 day is singular (contractor + overtime + move: −27 + 26)', () => {
    const one = { ...WI, scenarios: [{ name: 'A', priority: 'date' as const, levers: { contractor: true, overtime: true, move: true }, selected: false }] };
    expect(whatIfView(one, en, 'en').scenarios[0].results[1].value).toBe('−1 day');
    expect(whatIfView(one, fr, 'fr').scenarios[0].results[1].value).toBe('−1 jour');
    expect(floatDaysText(1, fr)).toBe('+1 jour');
    expect([floatDaysText(0, en), floatDaysText(3, en)]).toEqual(['+0 days', '+3 days']);
  });

  it('no forecast, no baseline, no peak: dashes', () => {
    const v = whatIfView({ ...WI, base: { ...WI.base, forecastFinish: null, overPeople: 0 }, baseline: null, peak: null }, en, 'en');
    expect(v.kpis.map((k) => [k.value, k.sub])).toEqual([
      ['—', 'float −27 d'],
      ['—', ''],
      ['0', 'Weeks 41–43'],
      ['2', 'Compared side by side · PM sets the priority'],
    ]);
    expect(v.scenarios[0].results[0].value).toBe('—');
  });
});
