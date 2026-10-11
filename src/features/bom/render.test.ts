// Static render of the Project BOM body (every display, EN and FR) from the seeded in-memory database: the islands
// render without a Next runtime, the template's structure and labels are there (sortable headers with their carets,
// the open-ECO tag links, the "Lead time" column, the muted total of assemblies, the no-tree notice), and edit-only
// controls follow `canEdit`.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/HLT-026/bom',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({ addBomArticleAction: vi.fn() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getBomScreen } from '@/server/dal/bom-screen';
import { BomBody } from './bom-view';
import { parseBomState } from './links';
import { bomScreenView } from './model';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function render(sp: Record<string, string>, lang: Lang, code = 'HLT-026', canEdit = true): Promise<string> {
  const state = parseBomState(sp);
  const data = (await getBomScreen(code, { view: state.view, used: state.used, system: state.sys }))!;
  const view = bomScreenView(code, state, data, { canEdit, canRaiseEco: canEdit }, makeT(lang), lang);
  return renderToStaticMarkup(h(I18nProvider, { lang, children: h(BomBody, { view, canEdit }) as ReactElement }));
}

describe('Project BOM render', () => {
  it('flat list (EN): KPI tiles, Display segment, filters, sortable headers, ECO tag links, muted assembly totals', async () => {
    const html = await render({}, 'en');
    // E-2a (R-103): €7.02M at the ordered / last purchase / catalogue price (€7.05M at the catalogue price before Delivery 7).
    for (const s of ['Articles', '€7.02M', 'Display', 'Flat list', 'Assembly tree', 'Where-used', 'Compare revisions', 'PU/PR list', 'Roll-ups use the ordered price, else the last purchase price, else the catalogue price',
      'Search reference, article, manufacturer ref', 'All types · 35', 'All suppliers · 35', '35 / 35 articles', 'Bill of materials · 35 articles', 'Click an article for its full record',
      'Also used in', 'Restrictions']) expect(html, s).toContain(s);
    expect(html).toContain('href="/reference/eco?eco=ECO-2026-015"');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('title="Valued through its components — not added to the BOM value"');
    expect(html).not.toContain('Clear filters');
  });

  it('flat list with filters (FR): "Effacer les filtres", French count and labels', async () => {
    const html = await render({ q: 'abb' }, 'fr');
    for (const s of ['Effacer les filtres', '2 / 35 article(s)', 'Valeur nomenclature', 'Fabriqué / acheté', 'Aussi utilisé dans']) expect(html, s).toContain(s);
  });

  it('assembly tree, where-used and compare (EN and FR)', async () => {
    const tree = await render({ view: 'tree' }, 'en');
    // E-2a (R-103): a crane rolls up to €720,396 (€713,996 at the last purchase price before Delivery 7); each unit cost says its basis.
    for (const s of ['Assembly tree', 'Reference · article', 'Extended cost', 'ASM-RMG-250', '€720,396', 'Roll-up of components', 'Ordered price', 'aria-expanded="true"', 'Fold ASM-RMG-250']) expect(tree, s).toContain(s);
    const used = await render({ view: 'used', used: 'EL-TRF-2MVA' }, 'fr');
    for (const s of ['Cas d’emploi', 'Chemins d’assemblage', 'PO-1063', 'Nordvolt · HLT-026', 'Équivalents :']) expect(used, s).toContain(s);
    const cmp = await render({ view: 'compare' }, 'fr');
    for (const s of ['ASM-RMG-250 · rév. B → rév. C', '12 sept. 2026 · ECO-2026-014', 'Rév. B', 'par grue']) expect(cmp, s).toContain(s);
  });

  it('PU/PR list: "Lead time" column (was "Discipline lead"), stock, pinned link, actions follow canEdit', async () => {
    const html = await render({ view: 'spares' }, 'en');
    for (const s of ['Recommended wear &amp; spare parts — Gantry crane 250 t — complete', 'Lead time', '16 in stock', 'None in stock', 'Keep for the installed base · 2 machines · ECO-2026-014',
      'Create spares purchase order', 'Export list', 'Complete system', 'Wear parts (PU)']) expect(html, s).toContain(s);
    expect(html).not.toContain('Discipline lead');
    const ro = await render({ view: 'spares' }, 'en', 'HLT-026', false);
    expect(ro).not.toContain('Create spares purchase order');
    expect(ro).toContain('Export list');
    const fr = await render({ view: 'spares' }, 'fr');
    for (const s of ['Délai d’approvisionnement', '16 en stock', 'Aucun en stock', 'Système complet']) expect(fr, s).toContain(s);
  });

  it('projects without a BOM: empty flat list and the no-tree notice', async () => {
    expect(await render({}, 'en', 'EWA-051')).toContain('No article is registered in this project’s BOM yet');
    const html = await render({ view: 'spares' }, 'fr', 'NDC-031');
    expect(html).toContain('Aucun assemblage multiniveau n’est enregistré pour ce projet — la liste à plat est la nomenclature complète.');
  });
});
