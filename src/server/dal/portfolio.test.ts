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

  it('overview: six planned projects, seed KPIs, four alerts', async () => {
    const ov = await getPortfolioOverview(null, 'en');
    expect(ov.rows.map((r) => [r.code, r.metrics.health])).toEqual([
      ['HLT-026', 'at_risk'], ['NDC-031', 'on_track'], ['RCF-019', 'off_track'], ['ERP-202', 'on_track'], ['WSA-044', 'on_track'], ['MSR-012', 'at_risk'],
    ]);
    expect(ov.kpis.map((k) => [k.value, k.sub])).toEqual([
      ['€13.23M', '6 active projects'], ['€7.43M', '56% of budget spent'], ['€13.50M', '−€270k vs budget'],
      ['0.96', 'Earned per $1 spent'], ['0.96', 'Weighted by budget'], ['3 of 6', '1 off track'],
    ]);
    expect(ov.alerts).toHaveLength(4);
    expect(ov.rows[0]).toMatchObject({ displayId: '#026', pm: 'R. Aubert', finish: 'Dec 2026' });
  });

  it('overview: zone filter on rows and alerts', async () => {
    const afr = await getPortfolioOverview('afr', 'en');
    expect(afr.rows.map((r) => r.code)).toEqual(['NDC-031']);
    expect(afr.alerts.map((a) => a.key)).toEqual(['people']);
    const euna = await getPortfolioOverview('euna', 'en');
    expect(euna.rows.map((r) => r.code)).toEqual(['HLT-026', 'RCF-019', 'ERP-202', 'MSR-012']);
    expect(euna.alerts).toHaveLength(4);
  });

  it('my projects: director seed and department head', async () => {
    const d = await getMyProjects(PERSONA_BY_ROLE.director, 'HLT-026', 'en');
    expect(d.kpis.map((k) => k.value)).toEqual(['6', '3', '0', '5']);
    expect(d.cards[0]).toMatchObject({ myRole: 'Portfolio director', progressPct: '64%', ind: { finishForecast: '14 Jan 2027', msLine: '23 Oct · Late' } });
    const h = await getMyProjects(PERSONA_BY_ROLE.depthead, 'HLT-026', 'en');
    expect(h.cards.map((c) => [c.project.code, c.myRole])).toEqual([['HLT-026', 'Department involved']]);
    expect(h.kpis[3]).toMatchObject({ value: '2', alert: true });
    const pm = await getMyProjects(PERSONA_BY_ROLE.pm, 'HLT-026', 'en');
    expect(pm.cards.map((c) => [c.project.code, c.myRole, c.readOnly])).toEqual([['HLT-026', 'Project manager', false]]);
    // R-041 (P-2): the quality manager is a referent of Harbor Line (seeded named team) — was: no project, the fallback.
    const q = await getMyProjects(PERSONA_BY_ROLE.quality, 'HLT-026', 'en');
    expect([q.fallback, q.cards.map((c) => [c.project.code, c.myRole, c.readOnly])]).toEqual([false, [['HLT-026', 'Referent', false]]]);
    const nobody = await getMyProjects({ ...PERSONA_BY_ROLE.quality, name: 'Zoé Martin', short: 'Z. Martin', personId: null }, 'HLT-026', 'en');
    expect([nobody.fallback, nobody.cards.length, nobody.cards.every((c) => c.readOnly && c.myRole === '')]).toEqual([true, 6, true]);
  });
});
