// Client portal › Documents — "By category" strip (Delivery 8, L-9 = a, R-138) on the seeded in-memory database: the
// categories come from the documents shared with the client in the Codex index (HLT-026: 6 categories, 7 files), are
// translated, and are a display only (no filter, the table keeps every shared document).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/client', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getClientPortal } from '@/server/dal/client';
import { ClientView } from './client-view';
import { getClientScreen } from './screen';

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = async (code: string, lang: Lang) =>
  renderToStaticMarkup(h(I18nProvider, { lang, children: h(ClientView, { code, view: await getClientScreen(code, 'docs', makeT(lang), lang), can: { decide: true, raise: true }, t: makeT(lang) }) }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('client document categories (DAL)', () => {
  it('HLT-026: 6 categories, 7 files, from the shared documents; the client_document_categories rows are gone', async () => {
    const p = await getClientPortal('HLT-026');
    expect(p.documentCategories.map((c) => [c.key, c.category, c.fileCount])).toEqual([
      ['minutes', 'Meeting minutes', 1], ['hse', 'HSE documents', 1], ['accepted', 'Accepted deliverables', 1], ['eng', 'Engineering', 2],
      ['client', 'Client deliverables', 1], ['purchasing', 'Purchasing', 1],
    ]);
    expect(p.documentCategories.reduce((a, c) => a + c.fileCount, 0)).toBe(7);
    expect(p.documents).toHaveLength(7);
    // Not shown (owner questions): "Contract & amendments" (CTR is not a client deliverable in Codex) and "Monthly progress
    // reports" (no Codex type).
    expect(p.documentCategories.map((c) => c.category)).not.toContain('Contract & amendments');
    expect(p.documentCategories.map((c) => c.category)).not.toContain('Monthly progress reports');
    for (const c of p.documentCategories) expect(c.latestIssuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a project without shared document has no category', async () => {
    expect((await getClientPortal('EWA-051')).documentCategories).toEqual([]);
  });
});

describe('"By category" strip', () => {
  it('EN: title, categories with counts, type labels and last issue, above the full table', async () => {
    const m = await render('HLT-026', 'en');
    const x = text(m);
    for (const s of ['By category', 'Meeting minutes', 'HSE documents', 'Accepted deliverables', 'Engineering 2 files', 'Client deliverables 1 file', 'Purchasing 1 file', 'Last issued'])
      expect(x).toContain(s);
    expect(m.indexOf('By category')).toBeLessThan(m.indexOf('<table'));
    expect(m.match(/<li class="[^"]*docCat\b/g)?.length ?? m.match(/<li /g)?.length).toBe(6);
    // A grouped display only: no filter link or button in the strip.
    const strip = m.slice(m.indexOf('By category'), m.indexOf('<table'));
    expect(strip).not.toContain('<a ');
    expect(strip).not.toContain('<button');
  });

  it('FR: translated through the dictionaries', async () => {
    const x = text(await render('HLT-026', 'fr'));
    for (const s of ['Par catégorie', 'Comptes rendus de réunion', 'Documents HSE', 'Livrables acceptés', 'Ingénierie 2 fichiers', 'Achats 1 fichier', 'Dernière diffusion'])
      expect(x).toContain(s);
  });

  it('no shared document: no strip, the empty line stays', async () => {
    const m = await render('EWA-051', 'en');
    expect(m).not.toContain('By category');
    expect(text(m)).toContain('No document shared with you yet');
  });
});
