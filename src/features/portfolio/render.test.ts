// Static render smoke test of the Portfolio overview and My projects bodies (FR, seeded in-memory database).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/portfolio/overview', useRouter: () => ({ push() {}, prefetch() {}, refresh() {} }) }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getMyProjects, getPortfolioOverview } from '@/server/dal/portfolio';
import { MyProjectsBody } from './my-projects';
import { OverviewBody } from './overview';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('portfolio screens render', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('overview in French', async () => {
    const data = await getPortfolioOverview(null, 'fr');
    const html = renderToStaticMarkup(h(OverviewBody, { data, zoneSelected: false, t: makeT('fr'), lang: 'fr' }));
    const txt = text(html);
    // Delivery 7: A-3 (R-129) the projects in execution (prototype 13,23 M€ · 56 % · −270 k€); R-130 the alerts computed by
    // rules (the prototype's fixed "Main-d’œuvre prévue +160 k€").
    for (const s of [
      'Budget total', '13,63 M€', '6 projets actifs', '51 % du budget dépensé', '−338 k€ vs budget', 'Perf. coût (CPI)', '3 sur 6', '1 hors trajectoire',
      'Projets actifs', '6 projets · exercice 2026', 'Dépensé vs acquis', 'Écart',
      '#026 · Extension du terminal Harbor Line', 'R. Aubert · échéance déc. 2026', 'À risque', '5,25 M€', '−450 k€',
      'Budget dépensé', 'Travail acquis', 'Points d’attention', 'Aménagement de la Clinique Pasteur Lyon — hors trajectoire',
      'Prévision 5,25 M€ pour un budget de 4,80 M€ (+450 k€) · CPI 0,91.', '3 personnes au-delà de 110 %',
      'Ouvrir le planning', 'Ouvrir le budget', 'Rééquilibrer', 'Ouvrir mes approbations',
    ])
      expect(txt).toContain(s);
    expect(html).toContain('href="/projects/HLT-026/schedule"');
    expect(html).toContain('href="/projects/HLT-026/budget"');
    expect(html).toContain('href="/projects/RCF-019/schedule"');
    expect(html).toContain('href="/resources"');
    expect(html).toContain('href="/my/approvals"');
    expect(txt).not.toContain('Aucun projet dans cette zone');
  });

  it('overview with an empty zone shows the notice', async () => {
    const data = { ...(await getPortfolioOverview('apac', 'en')), rows: [] };
    const txt = text(renderToStaticMarkup(h(OverviewBody, { data, zoneSelected: true, t: makeT('en'), lang: 'en' })));
    expect(txt).toContain('No project in this zone for this view');
    expect(txt).toContain('0 projects · FY2026');
  });

  it('my projects in French (director) and fallback notice (quality)', async () => {
    const t = makeT('fr');
    const d = renderToStaticMarkup(h(MyProjectsBody, { data: await getMyProjects(PERSONA_BY_ROLE.director, 'HLT-026', 'fr'), t }));
    const txt = text(d);
    for (const s of [
      'Mes projets', 'Directrice de portefeuille', 'Décisions en attente', 'Dans mes approbations',
      '#026 · Extension du terminal Harbor Line', 'HAV004 · R. Aubert · Autorité portuaire', 'Fabrication & Assemblage',
      '64%', '0.90', '0.91', '14 janv. 2027', 'Structure hors d’eau', '23 oct. · En retard', 'Ouvrir le projet', '#032 · Migration ERP — Phase 2',
    ])
      expect(txt).toContain(s);
    expect(d).toContain('href="/projects/HLT-026/plan"');
    expect(txt).not.toContain('Aucun projet ne vous est affecté');
    const q = text(renderToStaticMarkup(h(MyProjectsBody, { data: await getMyProjects(PERSONA_BY_ROLE.quality, 'HLT-026', 'fr'), t })));
    expect(q).toContain('Aucun projet ne vous est affecté — tout le portefeuille est affiché.');
    expect(q).toContain('Tout le portefeuille');
    expect(q).toContain('Consultation');
  });
});
