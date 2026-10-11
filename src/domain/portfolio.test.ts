// Golden values of the Portfolio overview and My projects (docs/spec/03 §2.2 and §4 seed values), computed
// from the prototype data set exactly as the prototype does.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { DEMO_CLIENT_ORG, PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { money } from '@/lib/format';
import {
  EXECUTION_STAGES, activeProjectsHint, fiscalYearLabel, inExecution, myProjectsModel, overviewMetrics, portfolioKpis, portfolioTotals, projectIndicators,
  type MyProjectsViewer, type ScheduleSummary,
} from './portfolio';

type Proj = { code: string; name: string; pm: string; client: string; finish: string; budget: number; actual: number; progress: number; spi: number };
const POOL: Proj[] = (PROTO_GEN.initialProjects as Proj[]).filter((p) => PROTO_GEN.projectData[p.code]);

const SCHED: Record<string, ScheduleSummary & { team: string[] }> = Object.fromEntries(
  POOL.map((p) => {
    const pd = PROTO_GEN.projectData[p.code];
    return [p.code, {
      start: pd.start, floatDays: pd.floatDays, finishText: pd.finishText, baselineText: pd.baselineText, team: pd.team,
      milestones: (pd.MILES as [string, number, number, string][]).map(([name, , forecastMonth, statusLabel]) => ({ name, forecastMonth, statusLabel })),
    }];
  }),
);

describe('Portfolio overview (spec §4)', () => {
  const rows = POOL.map((p) => ({ ...p, metrics: overviewMetrics(p) }));

  it('reproduces the "Active projects" seed rows', () => {
    const view = rows.map((r) => [
      r.code, r.metrics.health, r.metrics.progressPct, r.metrics.spentPct, r.metrics.cpi.toFixed(2), r.metrics.spi.toFixed(2),
      money(r.metrics.eac, 'en'), money(r.metrics.variance, 'en', { signed: true }),
    ]);
    expect(view).toEqual([
      ['HLT-026', 'at_risk', '64%', '70%', '0.91', '0.90', '€5.25M', '−€450k'],
      ['NDC-031', 'on_track', '51%', '49%', '1.05', '0.98', '€2.00M', '+€100k'],
      ['RCF-019', 'off_track', '82%', '90%', '0.91', '0.84', '€1.48M', '−€126k'],
      ['ERP-202', 'on_track', '45%', '43%', '1.05', '1.01', '€911k', '+€49k'],
      ['WSA-044', 'on_track', '27%', '26%', '1.04', '1.06', '€3.26M', '+€141k'],
      ['MSR-012', 'at_risk', '91%', '89%', '1.03', '0.95', '€604k', '+€16k'],
    ]);
  });

  it('reproduces the KPI tiles (EN and FR)', () => {
    const t = portfolioTotals(rows);
    expect(portfolioKpis(t, 'en').map((k) => [k.label, k.value, k.sub, k.alert])).toEqual([
      ['Total budget', '€13.23M', '6 active projects', false],
      ['Actual cost', '€7.43M', '56% of budget spent', false],
      ['Forecast (EAC)', '€13.50M', '−€270k vs budget', true],
      ['Cost perf. (CPI)', '0.96', 'Earned per $1 spent', true],
      ['Schedule perf. (SPI)', '0.96', 'Weighted by budget', true],
      ['Projects at risk', '3 of 6', '1 off track', true],
    ]);
    expect(portfolioKpis(t, 'fr').slice(0, 3).map((k) => [k.value, k.sub])).toEqual([
      ['13,23 M€', '6 active projects'],
      ['7,43 M€', '56% of budget spent'],
      ['13,50 M€', '−270 k€ vs budget'],
    ]);
  });

  it('sizes the bars from the rounded percentages, like the prototype', () => {
    const m = overviewMetrics({ budget: 1000, actual: 1063, progress: 0.644, spi: 1 });
    expect([m.progressPct, m.progressBar, m.spentPct, m.spentBar]).toEqual(['64%', 0.64, '106%', 1.06]);
    // No actuals yet: CPI 1 and EAC = budget instead of the prototype's division by zero.
    expect(overviewMetrics({ budget: 500, actual: 0, progress: 0, spi: null })).toMatchObject({ cpi: 1, spi: 1, eac: 500, variance: 0, spentBar: 0 });
  });

  it('handles a single project and an empty zone', () => {
    const one = portfolioTotals(rows.slice(1, 2));
    expect(portfolioKpis(one, 'en').map((k) => k.sub)[0]).toBe('1 active project');
    expect(portfolioKpis(one, 'en')[5]).toMatchObject({ value: '0 of 1', alert: false });
    const none = portfolioTotals([]);
    expect(portfolioKpis(none, 'en').map((k) => k.value)).toEqual(['€0k', '€0k', '€0k', '1.00', '1.00', '0 of 0']);
    expect([activeProjectsHint(6), activeProjectsHint(1)]).toEqual(['6 projects · FY2026', '1 project · FY2026']);
    // R-129: the fiscal year comes from the data date (was a fixed "FY2026").
    expect([activeProjectsHint(4, '2027-02-26'), fiscalYearLabel('2027-02-26'), fiscalYearLabel()]).toEqual(['4 projects · FY2027', 'FY2027', 'FY2026']);
    expect([makeT('fr')('6 projects · FY2026'), makeT('fr')(activeProjectsHint(6, '2027-01-05')), makeT('fr')('FY2027 · 17 projects')]).toEqual([
      '6 projets · exercice 2026', '6 projets · Exercice 2027', 'Exercice 2027 · 17 projets',
    ]);
  });

  it('A-3: the population is the execution group, Études → Mise en service', () => {
    expect([...EXECUTION_STAGES]).toEqual(['etudes', 'approvisionnements', 'fabrication_assemblage', 'fat', 'expedition', 'chantier', 'mise_en_service_sat']);
    expect(['initiative', 'aps', 'apd', 'etudes', 'mise_en_service_sat', 'garantie', 'clos', 'annule'].map((stage) => inExecution({ stage: stage as never }))).toEqual([
      false, false, false, true, true, false, false, false,
    ]);
  });
});

describe('pvExtra indicators (spec §5.5)', () => {
  it('next milestone and forecast finish per project', () => {
    const view = POOL.map((p) => {
      const x = projectIndicators(p, SCHED[p.code], true, 'en');
      return [p.code, x.spiText, x.cpiText, x.finishForecast, x.finishTint, x.msName, x.msLine, x.msTint];
    });
    expect(view).toEqual([
      ['HLT-026', '0.90', '0.91', '14 Jan 2027', 'lo', 'Structure topped out', '23 Oct · Late', 'lo'],
      ['NDC-031', '0.98', '1.05', '5 Apr 2027', 'lo', 'Power upgrade — UPS & switchgear complete', '5 Nov · At risk', 'lo'],
      ['RCF-019', '0.84', '0.91', '27 Dec 2026', 'lo', 'Fire systems complete', '27 Oct · Late', 'lo'],
      ['ERP-202', '1.01', '1.05', '1 Mar 2027', 'n300', 'Procurement module complete', '15 Nov · At risk', 'lo'],
      ['WSA-044', '1.06', '1.04', '1 Jul 2027', 'n300', 'Civil & access roads complete', '1 Dec · On track', 'n400'],
      ['MSR-012', '0.95', '1.03', '9 Nov 2026', 'lo', 'Acceptance & handover complete', '9 Nov 2026 · At risk', 'lo'],
    ]);
  });

  it('HLT attention list and money columns', () => {
    const x = projectIndicators(POOL[0], SCHED['HLT-026'], true, 'en');
    expect(x.attention).toEqual(['SPI 0.90', 'CPI 0.91', 'Structure topped out · Late', '27 d slip']);
    expect([x.floatText, x.spentText, x.earnedText, x.eacText, x.vacText, x.spentPct, x.spentTint]).toEqual(['−27 d', '€3.36M', '€3.07M', '€5.25M', '−€450k', '70%', 'lo']);
  });

  it('A-13: CPI / SPI colours and attention items follow the Settings "At risk below" threshold', () => {
    const p = { budget: 1000, actual: 500, progress: 0.48, spi: 0.96, finish: 'Dec 2026' };
    // CPI = 480 / 500 = 0.96, SPI 0.96: below the default 0.97 → attention and LO tints.
    expect(projectIndicators(p, null, true, 'en')).toMatchObject({ spiTint: 'lo', cpiTint: 'lo' });
    expect(projectIndicators(p, null, true, 'en').attention.slice(0, 2)).toEqual(['SPI 0.96', 'CPI 0.96']);
    // The director lowers "At risk below" to 0.95: 0.96 is no longer an attention value.
    const th = { risk: 0.95, off: 0.9 };
    const x = projectIndicators(p, null, true, 'en', th);
    expect([x.spiTint, x.cpiTint, x.attention.filter((a) => /^(SPI|CPI) /.test(a))]).toEqual(['ok', 'ok', []]);
    expect(overviewMetrics(p)).toMatchObject({ cpiAlert: true, spiAlert: true });
    expect(overviewMetrics(p, th)).toMatchObject({ cpiAlert: false, spiAlert: false });
    const totals = portfolioTotals([{ ...p, metrics: overviewMetrics(p, th) }]);
    expect(portfolioKpis(totals, 'en').filter((k) => k.key === 'cpi' || k.key === 'spi').map((k) => k.alert)).toEqual([true, true]);
    expect(portfolioKpis(totals, 'en', th).filter((k) => k.key === 'cpi' || k.key === 'spi').map((k) => k.alert)).toEqual([false, false]);
    // The display clamp is the health rule's [0.70, 1.25] (clampHealthCpi).
    expect(projectIndicators({ ...p, actual: 100 }, null, true, 'en').cpiText).toBe('1.25');
  });

  it('dash values when the project has no health, and fallbacks without planning data', () => {
    const p = { budget: 2200, actual: 0, progress: 0, spi: 1, finish: 'Nov 2027' };
    expect(projectIndicators(p, null, false, 'en')).toMatchObject({ spiText: '—', cpiText: '—', msName: '—', msLine: '', finishForecast: '—', spentPct: '0%' });
    const q = { budget: 3800, actual: 410, progress: 0.11, spi: 0.9, finish: 'Dec 2026' };
    // No schedule: float = round((spi − 1) × 180) = −18 d, forecast = finish month + 1 + 18/30.
    expect(projectIndicators(q, null, true, 'en')).toMatchObject({ floatDays: -18, floatText: '−18 d', finishForecast: '17 Jan ’27', msName: '—', msDate: '' });
    expect(projectIndicators({ ...q, finish: '—' }, null, true, 'en')).toMatchObject({ finishForecast: 'finish not planned', finishPlanned: 'finish not planned', floatText: '—' });
  });
});

describe('My projects (spec §2.2)', () => {
  const deptOf = PROTO.DEPT_OF as Record<string, string>;
  const todos = PROTO.TODOS as { person: string; status: string; project: string }[];
  const viewer = (role: RoleKey): MyProjectsViewer => {
    const p = PERSONA_BY_ROLE[role];
    return { role, name: p.name, short: p.short, clientOrg: DEMO_CLIENT_ORG, dept: role === 'depthead' ? 'Engineering' : null };
  };
  const model = (role: RoleKey, pending = 0) =>
    myProjectsModel(viewer(role), POOL, SCHED, { deptOf, todos }, { personaTitle: PERSONA_BY_ROLE[role].title, pendingDecisions: pending, lang: 'en' });

  it('director: six cards and the seed KPIs', () => {
    const m = model('director', 5);
    expect(m.fallback).toBe(false);
    expect(m.cards.map((c) => [c.project.code, c.myRole, c.readOnly])).toEqual(POOL.map((p) => [p.code, 'Portfolio director', false]));
    expect(m.kpis.map((k) => [k.label, k.value, k.sub, k.alert])).toEqual([
      ['My projects', '6', 'Portfolio director', false],
      ['At risk', '3', '1 off track', true],
      ['My open tasks', '0', 'Nothing assigned', false],
      ['Pending decisions', '5', 'In my approvals', true],
    ]);
    const hlt = m.cards[0];
    expect([hlt.health, hlt.progressPct, hlt.ind.spiText, hlt.ind.cpiText, hlt.ind.finishForecast, hlt.ind.msName, hlt.ind.msLine, hlt.myOpen])
      .toEqual(['at_risk', '64%', '0.90', '0.91', '14 Jan 2027', 'Structure topped out', '23 Oct · Late', 0]);
  });

  it('role per persona (first match wins) and fallback', () => {
    const roles = (r: RoleKey) => {
      const m = model(r);
      return [m.fallback, m.cards.map((c) => `${c.project.code}:${c.myRole}${c.readOnly ? ':ro' : ''}`)];
    };
    expect(roles('pm')).toEqual([false, ['HLT-026:Project manager']]);
    expect(roles('depthead')).toEqual([false, ['HLT-026:Department involved:ro']]);
    expect(roles('member')).toEqual([false, ['HLT-026:Team member:ro']]);
    expect(roles('procurement')).toEqual([false, ['HLT-026:Team member:ro', 'NDC-031:Team member:ro', 'WSA-044:Team member:ro', 'MSR-012:Team member:ro']]);
    expect(roles('client')).toEqual([false, ['HLT-026:Client']]);
    for (const r of ['englead', 'quality'] as const) expect(roles(r)).toEqual([true, POOL.map((p) => `${p.code}::ro`)]);
  });

  it('open tasks and KPI subs for the member and the fallback', () => {
    const m = model('member');
    expect(m.cards[0].myOpen).toBe(4);
    expect(m.kpis.map((k) => [k.value, k.sub])).toEqual([['1', 'Structural engineer'], ['1', '0 off track'], ['4', 'Across my projects'], ['0', 'In my approvals']]);
    expect(model('englead').kpis[0]).toMatchObject({ value: '6', sub: 'Whole portfolio' });
    const proc = model('procurement', 5);
    expect(proc.kpis.map((k) => k.value)).toEqual(['4', '2', '2', '5']);
  });
});
