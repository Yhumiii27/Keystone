// Static render of the Home body (docs/spec/03 §1.1, template 163–195): greeting, 4 KPI tiles at 170px, two queue cards
// with linked rows, tags and the "Nothing waiting" empty state, rendered through t() in FR and EN.
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getHomeView } from '@/server/dal/home';
import { HomeScreen } from './home-screen';

async function html(role: RoleKey, lang: Lang, projectCode = 'HLT-026') {
  const p = PERSONA_BY_ROLE[role];
  const view = await getHomeView({ role, persona: { name: p.name, title: p.title }, projectCode, zone: null, lang });
  return renderToStaticMarkup(h(HomeScreen, { view, t: makeT(lang) }));
}

describe('Home screen render', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('director (FR): greeting, KPI tiles, cards and linked rows', async () => {
    const out = await html('director', 'fr');
    expect(out).toContain('Bonjour, Marie');
    expect(out).toContain('Directrice de portefeuille · vendredi 25 sept. 2026');
    expect(out).toContain('--kpi-min:170px');
    expect(out.match(/class="card elev-sm [^"]*tile/g)).toHaveLength(4);
    expect(out).toContain('13,23 M€');
    expect(out).toContain('--kpi-color:var(--color-accent-300)');
    expect(out).toContain('Points d’attention');
    expect(out).toContain('Approbations sur le portefeuille');
    expect(out).toContain('href="/projects/HLT-026/changes?cr=CR-008"');
    expect(out).toContain('class="tag tag-accent');
    expect(out).not.toContain('Rien en attente');
  });

  it('PM on a project without planning data: em-dash KPIs and the empty state', async () => {
    const out = await html('pm', 'en', 'ALP-021');
    expect(out).toContain('Good morning, Romain');
    expect(out.match(/>—</g)).toHaveLength(4);
    expect(out.match(/Nothing waiting/g)).toHaveLength(2);
  });

  it('every role renders in both languages', async () => {
    for (const role of ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as RoleKey[])
      for (const lang of ['fr', 'en'] as Lang[]) expect(await html(role, lang)).toContain(lang === 'fr' ? 'Bonjour, ' : 'Good morning, ');
  });
});
