// Integration: Portfolio overview and My projects read from a seeded in-memory database (docs/spec/03 §2, §4).
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getMyProjects, getPortfolioOverview } from './portfolio';

describe('portfolio DAL', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('overview: the six projects in execution (A-3), seed KPIs, alerts by rules (R-130)', async () => {
    const ov = await getPortfolioOverview(null, 'en');
    // A-3: the execution group (Études → Mise en service), live — WSA-044 (APD) leaves, PRS-038 (Approvisionnements, no
    // planning data yet) enters. The prototype listed the six projects with planning data.
    expect(ov.rows.map((r) => [r.code, r.metrics.health])).toEqual([
      ['HLT-026', 'at_risk'], ['NDC-031', 'on_track'], ['RCF-019', 'off_track'], ['ERP-202', 'on_track'], ['MSR-012', 'at_risk'], ['PRS-038', 'on_track'],
    ]);
    // A-3 values (prototype: €13.23M · €7.43M, 56 % · €13.50M, −€270k · 0.96 · 0.96 · 3 of 6).
    expect(ov.kpis.map((k) => [k.value, k.sub])).toEqual([
      ['€13.63M', '6 active projects'], ['€6.96M', '51% of budget spent'], ['€13.97M', '−€338k vs budget'],
      ['0.96', 'Earned per $1 spent'], ['0.94', 'Weighted by budget'], ['3 of 6', '1 off track'],
    ]);
    // R-130 (NEW-D1-1): computed alerts, worst first — RCF-019 off track, the critical-path slips (worst float first), the
    // HLT-026 cost overrun, the over-allocated pool, an approval waiting more than 5 days (the prototype's four fixed texts).
    expect(ov.alerts.map((a) => [a.key, a.target])).toEqual([
      ['off-RCF-019', { screen: 'schedule', code: 'RCF-019' }], ['slip-RCF-019', { screen: 'schedule', code: 'RCF-019' }],
      ['slip-HLT-026', { screen: 'schedule', code: 'HLT-026' }], ['slip-MSR-012', { screen: 'schedule', code: 'MSR-012' }],
      ['slip-NDC-031', { screen: 'schedule', code: 'NDC-031' }], ['cost-HLT-026', { screen: 'budget', code: 'HLT-026' }],
      ['people', { screen: 'resources' }], ['approvals', { screen: 'myapprovals' }],
    ]);
    expect(ov.alerts[2]).toMatchObject({
      title: 'Harbor Line Terminal Expansion — critical path slip',
      detail: 'Critical path −27 d · forecast finish 14 Jan 2027 (baseline 18 Dec 2026) · 2 milestones late: Structure topped out, Cranes operational.',
    });
    expect(ov.alerts[5].detail).toBe('Forecast €5.25M vs budget €4.80M (+€450k) · CPI 0.91.');
    expect(ov.alerts[6]).toMatchObject({ title: '3 people over 110%', detail: 'Weeks 42–44 · Amélie Ollivier, Julien Wagner, Pauline Noguès.' });
    expect(ov.alerts[7]).toMatchObject({ title: '1 approval waiting more than 5 days', detail: 'Oldest: INV-HC-7781 · Halvorsen Cranes · €1,286,400 · since 10 Sep 2026 (15 d).' });
    const fr = await getPortfolioOverview(null, 'fr');
    expect([fr.alerts[0].title, fr.alerts[0].detail]).toEqual([
      'Aménagement de la Clinique Pasteur Lyon — hors trajectoire', 'SPI 0,84 · CPI 0,91 — sous le seuil « hors trajectoire » 0,90.',
    ]);
    expect(ov.rows[0]).toMatchObject({ displayId: '#026', pm: 'R. Aubert', finish: 'Dec 2026' });
  });

  it('overview: zone filter on rows and alerts', async () => {
    const afr = await getPortfolioOverview('afr', 'en');
    expect(afr.rows.map((r) => r.code)).toEqual(['NDC-031']);
    expect(afr.alerts.map((a) => a.key)).toEqual(['slip-NDC-031', 'people', 'approvals']);
    const euna = await getPortfolioOverview('euna', 'en');
    expect(euna.rows.map((r) => r.code)).toEqual(['HLT-026', 'RCF-019', 'ERP-202', 'MSR-012', 'PRS-038']);
    expect(euna.alerts.map((a) => a.key)).toEqual(['off-RCF-019', 'slip-RCF-019', 'slip-HLT-026', 'slip-MSR-012', 'cost-HLT-026', 'people', 'approvals']);
    // WSA-044 (APD) is in the pipeline, not in the overview (A-3).
    expect((await getPortfolioOverview('apac', 'en')).rows).toEqual([]);
  });

  it('my projects: director seed and department head', async () => {
    const d = await getMyProjects(PERSONA_BY_ROLE.director, 'HLT-026', 'en');
    // A-3: the same population as the Overview (PRS-038 in, WSA-044 out).
    expect(d.kpis.map((k) => k.value)).toEqual(['6', '3', '0', '5']);
    expect(d.cards.map((c) => c.project.code)).toEqual(['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'MSR-012', 'PRS-038']);
    expect(d.cards[0]).toMatchObject({ myRole: 'Portfolio director', progressPct: '64%', ind: { finishForecast: '14 Jan 2027', msLine: '23 Oct · Late' } });
    const h = await getMyProjects(PERSONA_BY_ROLE.depthead, 'HLT-026', 'en');
    expect(h.cards.map((c) => [c.project.code, c.myRole])).toEqual([['HLT-026', 'Department involved']]);
    expect(h.kpis[3]).toMatchObject({ value: '2', alert: true });
    const pm = await getMyProjects(PERSONA_BY_ROLE.pm, 'HLT-026', 'en');
    expect(pm.cards.map((c) => [c.project.code, c.myRole, c.readOnly])).toEqual([['HLT-026', 'Project manager', false], ['PRS-038', 'Project manager', false]]);
    const q = await getMyProjects(PERSONA_BY_ROLE.quality, 'HLT-026', 'en');
    expect([q.fallback, q.cards.length, q.cards.every((c) => c.readOnly && c.myRole === '')]).toEqual([true, 6, true]);
  });
});
