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
    // planning data yet) enters. The prototype listed the six projects with planning data. Health from the R-073 figures (lot
    // cost-control, computed from the activities): HLT-026 At risk → Off track, NDC-031 On track → At risk, RCF-019 Off track →
    // At risk, MSR-012 At risk → On track; PRS-038 has no activity budget and keeps its own figures.
    expect(ov.rows.map((r) => [r.code, r.metrics.health])).toEqual([
      ['HLT-026', 'off_track'], ['NDC-031', 'at_risk'], ['RCF-019', 'at_risk'], ['ERP-202', 'on_track'], ['MSR-012', 'on_track'], ['PRS-038', 'on_track'],
    ]);
    // A-3 + R-073: the six projects in execution with the computed actual cost, progress and SPI (prototype: €13.23M · €7.43M,
    // 56 % · €13.50M, −€270k · 0.96 · 0.96 · 3 of 6; A-3 on the prototype's figures: €6.96M, 51 % · €13.97M, −€338k · 0.96 ·
    // 0.94). Actual cost −€220k (NDC-031 −136, RCF-019 −134, ERP-202 +47, MSR-012 +3).
    expect(ov.kpis.map((k) => [k.value, k.sub])).toEqual([
      ['€13.63M', '6 active projects'], ['€6.74M', '49% of budget spent'], ['€13.88M', '−€245k vs budget'],
      ['0.97', 'Earned per $1 spent'], ['0.92', 'Weighted by budget'], ['3 of 6', '1 off track'],
    ]);
    // R-130 (NEW-D1-1) on the R-073 figures: computed alerts, worst first — HLT-026 off track (SPI 0.82 ≤ CPI 0.89: the schedule),
    // the critical-path slips (worst float first), the RCF-019 cost overrun (HLT-026, off track, shows its CPI in its own alert),
    // the over-allocated pool, an approval waiting more than 5 days (the prototype's four fixed texts). On the prototype's
    // figures it was RCF-019 off track and an HLT-026 cost overrun.
    expect(ov.alerts.map((a) => [a.key, a.target])).toEqual([
      ['off-HLT-026', { screen: 'schedule', code: 'HLT-026' }], ['slip-RCF-019', { screen: 'schedule', code: 'RCF-019' }],
      ['slip-HLT-026', { screen: 'schedule', code: 'HLT-026' }], ['slip-MSR-012', { screen: 'schedule', code: 'MSR-012' }],
      ['slip-NDC-031', { screen: 'schedule', code: 'NDC-031' }], ['cost-RCF-019', { screen: 'budget', code: 'RCF-019' }],
      // R-084 + named demo assignments (owner answer 18 Oct 2026): the over-allocated pool as on the seeded rows.
      ['people', { screen: 'resources' }], ['approvals', { screen: 'myapprovals' }],
    ]);
    expect(ov.alerts[2]).toMatchObject({
      title: 'Harbor Line Terminal Expansion — critical path slip',
      detail: 'Critical path −27 d · forecast finish 14 Jan 2027 (baseline 18 Dec 2026) · 2 milestones late: Structure topped out, Cranes operational.',
    });
    expect(ov.alerts[5].detail).toBe('Forecast €1.40M vs budget €1.35M (+€46k) · CPI 0.97.');
    expect(ov.alerts[6]).toMatchObject({ title: '3 people over 110%', detail: 'Weeks 42–44 · Amélie Ollivier, Julien Wagner, Pauline Noguès.' });
    expect(ov.alerts[7]).toMatchObject({ title: '1 approval waiting more than 5 days', detail: 'Oldest: INV-HC-7781 · Halvorsen Cranes · €1,286,400 · since 10 Sep 2026 (15 d).' });
    const fr = await getPortfolioOverview(null, 'fr');
    expect([fr.alerts[0].title, fr.alerts[0].detail]).toEqual([
      'Extension du terminal Harbor Line — hors trajectoire', 'SPI 0,82 · CPI 0,89 — sous le seuil « hors trajectoire » 0,90.',
    ]);
    expect(ov.rows[0]).toMatchObject({ displayId: '#026', pm: 'R. Aubert', finish: 'Dec 2026' });
  });

  it('overview: zone filter on rows and alerts', async () => {
    const afr = await getPortfolioOverview('afr', 'en');
    expect(afr.rows.map((r) => r.code)).toEqual(['NDC-031']);
    expect(afr.alerts.map((a) => a.key)).toEqual(['slip-NDC-031', 'people', 'approvals']); // R-084 + named demo assignments: the over-allocation alert (portfolio-wide)
    const euna = await getPortfolioOverview('euna', 'en');
    expect(euna.rows.map((r) => r.code)).toEqual(['HLT-026', 'RCF-019', 'ERP-202', 'MSR-012', 'PRS-038']);
    expect(euna.alerts.map((a) => a.key)).toEqual(['off-HLT-026', 'slip-RCF-019', 'slip-HLT-026', 'slip-MSR-012', 'cost-RCF-019', 'people', 'approvals']);
    // WSA-044 (APD) is in the pipeline, not in the overview (A-3).
    expect((await getPortfolioOverview('apac', 'en')).rows).toEqual([]);
  });

  it('my projects: director seed and department head', async () => {
    const d = await getMyProjects(PERSONA_BY_ROLE.director, 'HLT-026', 'en');
    // A-3: the same population as the Overview (PRS-038 in, WSA-044 out).
    expect(d.kpis.map((k) => k.value)).toEqual(['6', '3', '0', '5']);
    expect(d.cards.map((c) => c.project.code)).toEqual(['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'MSR-012', 'PRS-038']);
    // R-073: HLT-026's progress computed from its activities (64 % → 63 %).
    expect(d.cards[0]).toMatchObject({ myRole: 'Portfolio director', progressPct: '63%', ind: { finishForecast: '14 Jan 2027', msLine: '23 Oct · Late' } });
    const h = await getMyProjects(PERSONA_BY_ROLE.depthead, 'HLT-026', 'en');
    expect(h.cards.map((c) => [c.project.code, c.myRole])).toEqual([['HLT-026', 'Department involved']]);
    expect(h.kpis[3]).toMatchObject({ value: '2', alert: true });
    const pm = await getMyProjects(PERSONA_BY_ROLE.pm, 'HLT-026', 'en');
    expect(pm.cards.map((c) => [c.project.code, c.myRole, c.readOnly])).toEqual([['HLT-026', 'Project manager', false], ['PRS-038', 'Project manager', false]]);
    // R-041 (P-2): the quality manager is a referent of Harbor Line (seeded named team) — was: no project, the fallback.
    const q = await getMyProjects(PERSONA_BY_ROLE.quality, 'HLT-026', 'en');
    expect([q.fallback, q.cards.map((c) => [c.project.code, c.myRole, c.readOnly])]).toEqual([false, [['HLT-026', 'Referent', false]]]);
    const nobody = await getMyProjects({ ...PERSONA_BY_ROLE.quality, name: 'Zoé Martin', short: 'Z. Martin', personId: null }, 'HLT-026', 'en');
    expect([nobody.fallback, nobody.cards.length, nobody.cards.every((c) => c.readOnly && c.myRole === '')]).toEqual([true, 6, true]);
  });
});
