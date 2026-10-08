// Risk register and Contingency register view models and static render (HLT-026 from the seeded in-memory
// database; FR and EN): KPI tiles, chips, table order and tags, heat-map cells, drawer content, contingency bars and
// draw-downs (docs/spec/07 §2.1, 04 §5.4 golden values).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/risks', useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock('./actions', () => ({ updateRiskAction: vi.fn(), createRiskAction: vi.fn(), recordDrawDownAction: vi.fn() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getContingencyScreen, getRiskScreen } from '@/server/dal/risks-screen';
import type { RiskCategory } from '@/domain/risk';
import { ContingencyView } from './contingency-view';
import { contingencyView, riskRegisterView, risksHref } from './model';
import { RiskRegister } from './risk-register';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function riskView(lang: Lang, q: { filter?: RiskCategory | null; risk?: string | null } = {}, code = 'HLT-026') {
  const d = (await getRiskScreen(code))!;
  const t = makeT(lang);
  return {
    t,
    view: riskRegisterView({ code, risks: d.register.risks, contingency: d.contingency, filter: q.filter ?? null, selected: q.risk ?? null }, t, lang),
  };
}

describe('risk register view model', () => {
  it('KPI tiles (FR): 7 · 5 · 340 k€ (227 % de la provision 150 k€, LO) · 2 · 2 (LO)', async () => {
    const { view } = await riskView('fr');
    expect(view.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Risques ouverts', '7', '1 clos', 'var(--color-text)'],
      ['Critiques / élevés', '5', 'Score ≥ 8 sur 5×5', 'var(--color-accent-300)'],
      ['Exposition (EMV)', '340 k€', '227 % de la provision 150 k€', 'var(--color-accent-300)'],
      ['Sur le chemin critique', '2', 'Risques liés à des activités critiques', 'var(--color-text)'],
      ['En hausse', '2', 'Depuis la dernière revue', 'var(--color-accent-300)'],
    ]);
  });

  it('KPI exposure in EN: €340k · 227% of contingency €150k', async () => {
    const { view } = await riskView('en');
    expect([view.kpis[2].value, view.kpis[2].sub]).toEqual(['€340k', '227% of contingency €150k']);
  });

  it('chips (Settings order, counts incl. closed) and rows sorted by score', async () => {
    const { view } = await riskView('fr');
    expect(view.chips.map((c) => [c.label, c.count])).toEqual([
      ['Tous', 8], ['Technique', 2], ['Fournisseur / livraison', 1], ['HSE (sécurité)', 1], ['Contractuel / client', 1], ['Financier / devise', 1],
      ['Réglementaire / permis', 1], ['Ressources / compétences', 1],
    ]);
    expect(view.chips[2].href).toBe('/projects/HLT-026/risks?filter=supplier_delivery');
    expect(view.rows.map((r) => `${r.id}:${r.score}`)).toEqual(['R-03:16', 'R-11:12', 'R-07:10', 'R-12:10', 'R-09:9', 'R-14:6', 'R-15:6', 'R-05:4']);
    const r03 = view.rows[0];
    expect(r03).toMatchObject({
      title: 'Nouveau retard de livraison acier (capacité aciérie)', category: 'Fournisseur / livraison', p: 4, i: 4, level: 'Critique', levelClass: 'tag tag-accent',
      response: 'Atténuer', owner: 'Fabien Bertrand', emvText: '120 k€', actText: 'A1250 · Steel erection — Bays 3–4', trend: 'up', status: 'Ouverte',
      statusClass: 'tag tag-outline', selected: false, href: '/projects/HLT-026/risks?risk=R-03',
    });
    expect(view.rows.map((r) => r.levelClass)).toEqual(['tag tag-accent', 'tag tag-outline', 'tag tag-outline', 'tag tag-outline', 'tag tag-outline', 'tag tag-neutral', 'tag tag-neutral', 'tag tag-neutral']);
    const r05 = view.rows[7];
    expect([r05.emvText, r05.status, r05.statusClass]).toEqual(['—', 'Clôturée', 'tag tag-neutral']);
    expect(view.rows.find((r) => r.id === 'R-15')!.actText).toBe('—');
    expect(view.empty).toBeNull();
  });

  it('category filter keeps the filter in row links; empty texts', async () => {
    const { view } = await riskView('fr', { filter: 'technical', risk: 'R-07' });
    expect(view.rows.map((r) => r.id)).toEqual(['R-07', 'R-05']);
    expect(view.rows[0]).toMatchObject({ selected: true, href: '/projects/HLT-026/risks?filter=technical' });
    expect(view.rows[1].href).toBe('/projects/HLT-026/risks?filter=technical&risk=R-05');
    expect(view.drawer!.closeHref).toBe('/projects/HLT-026/risks?filter=technical');
    expect((await riskView('fr', { filter: 'hse' }, 'NDC-031')).view.empty).toBe('Aucun risque dans cette catégorie');
    const none = (await riskView('fr', {}, 'EWA-051')).view;
    expect([none.empty, none.rows.length, none.chips.length, none.kpis[0].value, none.kpis[2].value]).toEqual(['Aucun risque enregistré pour ce projet', 0, 1, '0', '0 k€']);
  });

  it('heat map: open risks only', async () => {
    const { view } = await riskView('fr');
    expect(view.matrix.map((r) => r.cells.map((c) => c.ids))).toEqual([
      ['', 'R-07 R-12', '', '', ''],
      ['', '', '', 'R-03', ''],
      ['', 'R-14', 'R-09', 'R-11', ''],
      ['', '', 'R-15', '', ''],
      ['', '', '', '', ''],
    ]);
    expect(view.matrix[0].cells.map((c) => c.level)).toEqual(['medium', 'high', 'critical', 'critical', 'critical']);
  });

  it('drawer of R-03 (FR): header, level tag, assessment, links', async () => {
    const { view } = await riskView('fr', { risk: 'r-03' });
    const d = view.drawer!;
    expect([d.head, d.levelText, d.levelClass, d.title, d.probability, d.impact, d.response, d.status]).toEqual([
      'R-03 · Fournisseur / livraison', 'Critique · 16', 'tag tag-accent', 'Nouveau retard de livraison acier (capacité aciérie)', 4, 4, 'mitigate', 'open',
    ]);
    expect(d.plan).toBe('Seconde aciérie qualifiée · stock tampon de 48 poteaux au Havre');
    expect(d.meta.map((m) => [m.k, m.v])).toEqual([
      ['Responsable', 'Fabien Bertrand'],
      ['Déclencheur', 'L’aciérie confirme un retard > 2 semaines'],
      ['Activité liée', 'A1250 · Steel erection — Bays 3–4'],
      ['EMV (P × impact coût)', '120 k€'],
      ['Tirage sur la provision s’il survient', '150 k€'],
    ]);
    expect([d.activityHref, d.whatifHref, d.closeHref, d.toggleLabel, d.toggleNext]).toEqual([
      '/projects/HLT-026/plan?act=A1250', '/resources/what-if?project=HLT-026', '/projects/HLT-026/risks', 'Clore le risque', 'closed',
    ]);
    const r05 = (await riskView('en', { risk: 'R-05' })).view.drawer!;
    expect([r05.levelText, r05.meta[3].v, r05.meta[4].v, r05.toggleLabel, r05.toggleNext]).toEqual(['Medium · 4', '—', '—', 'Reopen', 'open']);
    const r15 = (await riskView('en', { risk: 'R-15' })).view.drawer!;
    expect([r15.activityHref, r15.meta[2].v]).toEqual([null, '—']);
    // A generated register links to its own project's what-if (empty state there), never Harbor Line's.
    expect((await riskView('en', { risk: 'R-01' }, 'NDC-031')).view.drawer!.whatifHref).toBe('/resources/what-if?project=NDC-031');
    expect((await riskView('en', { risk: 'R-99' })).view.drawer).toBeNull();
  });

  it('risksHref', () => {
    expect([risksHref('HLT-026'), risksHref('HLT-026', { filter: 'hse', risk: 'R-12' })]).toEqual(['/projects/HLT-026/risks', '/projects/HLT-026/risks?filter=hse&risk=R-12']);
  });
});

describe('risk register render (FR)', () => {
  it('KPI tiles, chips, table, heat map and legend', async () => {
    const { view, t } = await riskView('fr');
    const html = renderToStaticMarkup(RiskRegister({ code: 'HLT-026', view, canEdit: true, t }));
    for (const s of [
      'Risques ouverts', '340 k€', '227 % de la provision 150 k€', 'Catégorie', 'Tous',
      'Score = probabilité × impact (1–5) · EMV = probabilité × impact coût · revu chaque semaine avec l’instantané', 'Registre',
      'Cliquer sur un risque pour le noter et modifier sa réponse', 'Activité liée', 'Tendance', 'Carte de chaleur — risques ouverts',
      'Impact ↑ · probabilité →', 'Critique ≥ 15', 'Élevé ≥ 8', 'Moyen ≥ 4', 'R-07 R-12', 'A1250 · Steel erection — Bays 3–4', 'aria-label="En hausse"',
    ])
      expect(html).toContain(s);
    expect(html.match(/class="tag tag-accent[^"]*">Critique</g)?.length).toBe(1);
    expect(html.match(/class="tag tag-outline">Ouverte</g)?.length).toBe(7);
    expect(html.match(/class="tag tag-neutral">Clôturée</g)?.length).toBe(1);
    expect(html.indexOf('R-03')).toBeLessThan(html.indexOf('R-11'));
    expect(html).not.toContain('Aucun risque');
  });
});

describe('contingency register', () => {
  it('HLT-026 view model (FR): KPIs, bars, draw-downs most recent first', async () => {
    const d = (await getContingencyScreen('HLT-026'))!;
    const v = contingencyView(d.contingency, makeT('fr'), 'fr');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual([
      ['Provision initiale', '150 k€', '3 % du budget', 'var(--color-neutral-200)'],
      ['Consommé', '48 k€', '32 % consommé · projet avancé à 64 %', 'var(--color-text)'],
      ['Reste', '102 k€', '3 prélèvements', 'var(--color-text)'],
      ['Exposition (EMV des risques ouverts)', '340 k€', 'dépasse la provision restante', 'var(--color-accent-300)'],
    ]);
    expect([v.usedPct, v.progPct, v.barUsed, v.barExposure, v.barProgress]).toEqual(['32 %', '64 %', '32%', '100%', '64%']);
    expect(v.rows.map((r) => [r.date, r.amount, r.link, r.by])).toEqual([
      ['12 sept.', '12 k€', 'NCR-026', 'R. Aubert'],
      ['30 juil.', '14 k€', 'R-03', 'R. Aubert'],
      ['18 juin', '22 k€', 'CR-004', 'M. Lefebvre'],
    ]);
    expect(v.rows[0].reason).toBe('Reprise de soudure de l’éclissage K-12 — NCR-026');
  });

  it('EN render and a project without a register', async () => {
    const d = (await getContingencyScreen('HLT-026'))!;
    const t = makeT('en');
    const html = renderToStaticMarkup(ContingencyView({ view: contingencyView(d.contingency, t, 'en'), t }));
    for (const s of [
      'Initial provision', '€150k', '3 % of budget', '€48k', '32 % used · project 64 % complete', '€102k', '3 draw-downs', 'Exposure (open risks EMV)', '€340k',
      'exceeds remaining provision', 'Contingency use vs project progress', 'Project progress', 'Exposure (drawn + open risks EMV)', 'Draw-downs',
      '--bar-w:32%', '--bar-w:100%', '--bar-w:64%', 'Re-weld K-12 splice — NCR-026',
    ])
      expect(html).toContain(s);
    expect(html).not.toContain('No draw-down recorded yet');
    const n = (await getContingencyScreen('EWA-051'))!;
    const nv = contingencyView(n.contingency, t, 'en');
    expect(nv.kpis.map((k) => k.sub)).toEqual(['3 % of budget', `0 % used · project ${Math.round(n.contingency.progress * 100)} % complete`, '0 draw-downs', 'covered by remaining provision']);
    expect(renderToStaticMarkup(ContingencyView({ view: nv, t }))).toContain('No draw-down recorded yet');
  });
});
