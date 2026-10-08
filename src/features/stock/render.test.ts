// Static render of the Stock & storages body (KPI tiles, location chips, search, "Stock by location", "Recent
// movements") from the seeded in-memory database, in EN and FR: the template labels (template 1658–1693 and their
// prototype French), the chip links, the row cells and the empty state.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/purchasing/stock', useSearchParams: () => new URLSearchParams() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { installedBasePins } from '@/server/dal/eco';
import { getX3StockSync, listStock, listStockMovements } from '@/server/dal/stock';
import { listStorageLocations } from '@/server/dal/suppliers';
import GOLDEN from './stock.golden.json';
import { stockScreenView } from './model';
import { StockBody } from './stock-view';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '’').replace(/\s+/g, ' ');

async function body(lang: Lang, q = '') {
  const [rows, locations, sync, moves, pins] = await Promise.all([listStock(), listStorageLocations(), getX3StockSync(), listStockMovements({ limit: 8 }), installedBasePins()]);
  const t = makeT(lang);
  const view = stockScreenView({ rows, locations, sync, moves, pins, state: { loc: null, q, stock: null, part: null } }, t, lang);
  return html(h(StockBody, { view, t }), lang);
}

describe('Stock & storages body', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it.each(['en', 'fr'] as const)('%s: template labels, chips, rows and movements', async (lang) => {
    const out = await body(lang);
    const plain = text(out);
    const labels = ['Search article or location', 'Stock by location', 'Reference', 'Article', 'Location', 'On hand', 'Reserved', 'Available', 'Min', 'Value', 'Source', 'Last movement', 'Recent movements'];
    for (const l of labels) expect(out).toContain(lang === 'en' ? l : G.labels[l]);
    expect(plain).toContain(lang === 'en' ? 'Imported from Sage X3 · local changes are flagged until pushed back' : G.labels['Imported from Sage X3 · local changes are flagged until pushed back']);
    // KPI tiles, location chips (links), 18 rows, 5 movements, the pinned and below-minimum markers.
    for (const k of G[lang].kpis) expect(plain).toContain(`${k.label} ${k.value} ${k.sub}`);
    expect(out.match(/href="\/purchasing\/stock[^"]*"[^>]*>/g)!.length).toBeGreaterThanOrEqual(7);
    expect(out).toContain('href="/purchasing/stock?loc=Entrep%C3%B4t+central+%E2%80%94+Lyon"');
    expect(out.match(/<tr tabindex="0"/g)!.length).toBe(18);
    expect(out.match(/class="tag tag-accent"/g)!.length).toBe(3);
    expect(plain).toContain(lang === 'en' ? 'Keep for the installed base · 1 machine · ECO-2026-015' : 'À conserver pour le parc · 1 machine · ECO-2026-015');
    expect(out).toContain(`aria-label="${lang === 'en' ? 'Below minimum' : 'Sous le minimum'}"`);
    expect(plain).toContain(lang === 'en' ? 'Transfer · CR-BRG-SKF × 4' : 'Transfert · CR-BRG-SKF × 4');
    expect(plain).toContain(lang === 'en' ? 'Fabien Bertrand · 25 Sep 14:10' : 'Fabien Bertrand · 25 sept. 14:10');
    expect(plain).not.toContain(lang === 'en' ? 'No stock line matches' : 'Aucune ligne de stock ne correspond');
  });

  it('empty search: "No stock line matches" under the table', async () => {
    const out = await body('en', 'zzz');
    expect(out).not.toContain('<tr tabindex="0"');
    expect(text(out)).toContain('No stock line matches');
  });
});
