// Golden values of the Home builders (docs/spec/00 §8.8, docs/spec/03 §1.2) on the prototype seed.
import { describe, expect, it } from 'vitest';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { money, ratio } from '@/lib/format';
import { makeT } from '@/i18n/translate';
import { overviewMetrics, portfolioKpis, portfolioTotals, type EvmInput } from './portfolio';
import {
  bomShortfall, changeRequestStatus, directorHome, ecoStatus, evmAtDate, homeHref, procurementHome, renderTxt, skillCoverage, teamLoad, workSummary,
  type Eco, type Part, type PersonLoad, type ResourceRequest, type Todo,
} from './home';

const people: PersonLoad[] = (PROTO.PEOPLE as [string, string, number[]][]).map(([name, role, loads]) => ({ name, role, loads }));

describe('director KPIs (Overview tiles 1–4)', () => {
  const rows = (PROTO.PROJECTS as EvmInput[]).map((p) => ({ ...p, metrics: overviewMetrics(p) }));
  const view = (lang: 'en' | 'fr') =>
    directorHome({
      lang, persona: { name: 'Marie Lefebvre', title: 'Portfolio director' }, project: { code: 'HLT-026', name: 'Harbor Line Terminal Expansion', shortCode: 'HLT' },
      portfolioKpis: portfolioKpis(portfolioTotals(rows), lang), alerts: [], changeRequests: [], purchaseOrders: [], ecos: [], requests: [],
    });
  it('reproduces €13.23M · €7.43M · €13.50M (−€270k) · CPI 0.96', () => {
    expect(view('en').kpis).toEqual([
      { label: 'Total budget', value: '€13.23M', sub: '6 active projects', lo: false },
      { label: 'Actual cost', value: '€7.43M', sub: '56% of budget spent', lo: false },
      { label: 'Forecast (EAC)', value: '€13.50M', sub: '−€270k vs budget', lo: true },
      { label: 'Cost perf. (CPI)', value: '0.96', sub: 'Earned per $1 spent', lo: true },
    ]);
    expect(view('fr').kpis.map((k) => k.value)).toEqual(['13,23 M€', '7,43 M€', '13,50 M€', '0.96']);
    expect(view('fr').kpis[2].sub).toBe('−270 k€ vs budget');
  });
  it('greets the persona and shows empty approval rows as "None"', () => {
    const v = view('en');
    expect([v.greeting, v.sub]).toEqual(['Good morning, Marie', 'Portfolio director · Friday 25 Sep 2026']);
    expect(v.right.rows.map((r) => [r.sub, r.tag])).toEqual([['None', '0'], ['None', '0'], ['None', '0'], ['Department heads · 0 open', '0']]);
  });
});

describe('EVM at the data date (PM KPIs, HLT-026)', () => {
  const pd = PROTO_GEN.projectData['HLT-026'];
  const e = evmAtDate({ bac: pd.BAC, pv: pd.PV, ev: pd.EV, ac: pd.AC });
  it('SPI 0.90 · CPI 0.92 · EAC €5.24M', () => {
    expect(ratio(e.spi)).toBe('0.90');
    expect(Math.round(e.spi * 100)).toBe(90);
    expect(ratio(e.cpi)).toBe('0.92');
    expect(money(e.eac, 'en')).toBe('€5.24M');
    expect(pd.floatText).toBe('−27 days');
    expect(Math.round((e.ev / pd.BAC) * 100)).toBe(64);
  });
});

describe('derived statuses', () => {
  it('change request status follows its chain', () => {
    expect(changeRequestStatus({ status: 'in_review', chain: { pm: 'ok', director: 'pending', client: 'pending', ccb: 'pending' } })).toBe('in_review');
    expect(changeRequestStatus({ status: 'in_review', chain: { pm: 'ok', director: 'ok', client: 'na', ccb: 'ok' } })).toBe('approved');
    expect(changeRequestStatus({ status: 'in_review', chain: { pm: 'ok', client: 'rejected' } })).toBe('rejected');
    expect(changeRequestStatus({ status: 'rejected', chain: {} })).toBe('rejected');
  });
  it('ECO effective status (seed)', () => {
    expect((PROTO.ECOS as Eco[]).map((e) => [e.id, ecoStatus(e)])).toEqual([
      ['ECO-2026-014', 'Released'], ['ECO-2026-015', 'In approval'], ['ECO-2026-016', 'Impact analysis'],
      ['ECO-2026-017', 'Draft'], ['ECO-2026-012', 'Released'], ['ECO-2026-011', 'Rejected'],
    ]);
  });
});

describe('resources, work and skills', () => {
  it('team utilization 83 % · 3 people over-allocated', () => expect(teamLoad(people)).toEqual({ utilization: 83, over: 3 }));
  it('My work of Hélène Sauvage: 2 due today, 1 overdue, 2 next week, 15 h logged, 45 % load', () => {
    const w = workSummary(PROTO.TODOS as Todo[], 'Hélène Sauvage', people);
    expect([w.dueToday, w.overdue, w.nextWeek, w.logged, w.load, w.open.length]).toEqual([2, 1, 2, 15, 45, 7]);
  });
  it('8 single-expert skill families', () => {
    const c = skillCoverage(PROTO.SKILLS, people, PROTO.SKILL_LV);
    expect(c.filter((x) => x.gap).map((x) => x.name)).toEqual([
      'Structural', 'Electrical / HV', 'MEP', 'Automation & controls', 'Civil & site', 'Procurement', 'Quality / QA-QC', 'Software / IT',
    ]);
  });
  it('Harbor Line BOM shortfall: 15 articles, steel plate 192 to order', () => {
    const s = bomShortfall(PROTO.PARTS as Part[], PROTO_GEN.genPOs['HLT-026'], 'HLT');
    expect(s.length).toBe(15);
    expect([s[0].part.ref, s[0].need]).toEqual(['KS-PLT-S355', 192]);
  });
});

describe('rendering helpers', () => {
  it('fills templates and translates string parameters', () => {
    const x = { tpl: 'Work completed · {name}', p: { name: 'Harbor Line Terminal Expansion' } };
    expect(renderTxt(x, makeT('en'))).toBe('Work completed · Harbor Line Terminal Expansion');
    expect(renderTxt(x, makeT('fr'))).toBe('Travail réalisé · Extension du terminal Harbor Line');
    expect(renderTxt({ tpl: 'of 40 h · {pct}%', p: { pct: 38 } }, makeT('fr'))).toBe('sur 40 h · 38 %');
  });
  it('FR keeps dynamic sentences translated outside the seed state', () => {
    const fr = (x: Parameters<typeof renderTxt>[0]) => renderTxt(x, makeT('fr'));
    // "Next: {milestone}" — the prototype dictionary only knows "Next: Structure topped out".
    expect(fr({ tpl: 'Next: {name}', p: { name: 'Structure topped out' } })).toBe('Prochain : structure hors d’eau');
    expect(fr({ tpl: 'Next: {name}', p: { name: 'Cranes operational' } })).toBe('Prochain : grues opérationnelles');
    expect(fr({ tpl: 'Next: {name}', p: { name: 'PV modules complete' } })).toBe('Prochain : modules PV terminés');
    expect(renderTxt({ tpl: 'Next: {name}', p: { name: 'Cranes operational' } }, makeT('en'))).toBe('Next: Cranes operational');
    // `|lc` leaves acronyms alone.
    expect(renderTxt({ tpl: '{x|lc}', p: { x: 'SAT complete' } }, makeT('en'))).toBe('SAT complete');
  });
  it('procurement shortfall quantities are grouped per language', () => {
    const part: Part = { ref: 'PV-MOD-550', name: 'PV module 550 Wp', mfr: 'Acme', mb: 'Purchased', price: 1, status: 'Validated', usage: { WSA: 6200 } };
    const view = (lang: 'en' | 'fr') =>
      procurementHome({
        lang, persona: { name: 'Fabien Bertrand', title: 'Procurement & stock' }, project: { code: 'WSA-044', name: 'Westfield Solar Array', shortCode: 'WSA' },
        purchaseOrders: [], parts: [part], ecos: [], activityPct: {},
      }).right.rows[0].tag;
    expect(renderTxt(view('en'), makeT('en'))).toBe('6,200 to order');
    expect(renderTxt(view('fr'), makeT('fr'))).toBe('6 200 à commander');
  });
  it('director: one pending resource request reads in the singular in FR', () => {
    const req = (PROTO.REQUESTS as ResourceRequest[]).find((r) => r.status === 'pending')!;
    const v = directorHome({
      lang: 'fr', persona: { name: 'Marie Lefebvre', title: 'Portfolio director' }, project: { code: 'HLT-026', name: 'Harbor Line Terminal Expansion', shortCode: 'HLT' },
      portfolioKpis: [], alerts: [], changeRequests: [], purchaseOrders: [], ecos: [], requests: [req],
    });
    expect(renderTxt(v.right.rows[3].sub, makeT('fr'))).toBe('Chefs de service · 1 ouverte');
  });
  it('maps selections to URLs', () => {
    expect(homeHref('changes', { code: 'HLT-026', params: { cr: 'CR-008' } })).toBe('/projects/HLT-026/changes?cr=CR-008');
    expect(homeHref('task', { taskId: 'T-2318' })).toBe('/my/tasks/T-2318');
    expect(homeHref('eco')).toBe('/reference/eco');
  });
});
