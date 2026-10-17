// Stock & storages view models from the seeded in-memory database, in EN and FR, compared with the prototype's own
// render values (src/features/stock/stock.golden.json, scripts/proto-golden-stock.ts: renderVals() for the director,
// EN and FR — deepTr applied), then the same screen after a sequence of movements written through the DAL.
// Deliberate deviations asserted inline: dates without the zero padding ("1 Sep"), FR movement type "Transfert" (the
// prototype used the verb "Transférer"), FR "where" texts and scrap warning fully translated, both site stores named
// in full among the transfer destinations.
import { beforeAll, describe, expect, it } from 'vitest';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { installedBasePins } from '@/server/dal/eco';
import { applyStockMovement, getStockPosition, getX3StockSync, listStock, listStockMovements } from '@/server/dal/stock';
import { listStorageLocations } from '@/server/dal/suppliers';
import GOLDEN from './stock.golden.json';
import { stockHref, type StockUrlState } from './links';
import { stockDrawerView, stockScreenView } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const S0: StockUrlState = { loc: null, q: '', stock: null, part: null };
/** Prototype dates are partly zero-padded ("01 Sep", "01 sept."); the rebuild formats every date the same way. */
const day = (s: string) => s.replace(/(^|· )0(\d)/g, '$1$2');
const FR_MOVE: Record<string, string> = { Transférer: 'Transfert' };
const FR_WHERE: Record<string, string> = { 'QC failed · BL-2026-0533': 'QC non conforme · BL-2026-0533' };
/**
 * R-148 (NEW-D1-2): a part name is shown as typed — in French its exact dictionary entry or the stored name, never the
 * prototype's partial translation ("Stainless mounting bracket · rev 2" was shown half translated as "… · rév. 2").
 */
const nameFix = (lang: Lang, protoFr: string) => (lang === 'fr' ? protoFr.replace(/ · rév\. 2$/, ' · rev 2') : protoFr);

async function screen(lang: Lang, state: Partial<StockUrlState> = {}) {
  const [rows, locations, sync, moves, pins] = await Promise.all([listStock(), listStorageLocations(), getX3StockSync(), listStockMovements({ limit: 8 }), installedBasePins()]);
  return { rows, locations, pins, view: stockScreenView({ year: 2026, rows, locations, sync, moves, pins, state: { ...S0, ...state } }, makeT(lang), lang) };
}
const goldenMoves = (ms: any[], lang: Lang) =>
  ms.map((m) => ({ type: lang === 'fr' ? (FR_MOVE[m.type] ?? m.type) : m.type, ref: m.ref, qty: String(m.qty), where: lang === 'fr' ? (FR_WHERE[m.where] ?? m.where) : m.where, who: m.who, when: m.when }));
const viewMoves = (ms: any[]) => ms.map((m) => ({ type: m.type, ref: m.ref, qty: m.qty, where: m.where, who: m.who, when: m.when }));
const viewRows = (rows: any[]) =>
  rows.map((r) => ({
    ref: r.ref, name: r.name, loc: r.location, locType: r.locationType, onHand: r.onHand, reserved: r.reserved, avail: r.available, availColor: r.availableColor,
    min: r.min, below: r.belowMin, value: r.value, source: r.source, srcClass: `tag tag-${r.sourceTone}`, last: r.last, pinned: !!r.pinned, pinnedText: r.pinned ?? '',
  }));
const goldenRows = (rows: any[], lang: Lang) =>
  rows.map((r0) => (E4_UNPINNED.has(r0.ref) ? { ...r0, pinned: false, pinnedText: '' } : r0)).map((r) => ({
    ref: r.ref, name: nameFix(lang, r.name), loc: r.loc, locType: r.locType, onHand: r.onHand, reserved: r.reserved, avail: r.avail, availColor: r.availColor, min: r.min,
    below: !!r.below, value: r.value, source: r.source, srcClass: r.srcClass, last: day(r.last), pinned: r.pinned, pinnedText: r.pinnedText,
  }));

// E-4 = a (R-110): only the parts a machine actually carries are kept for the installed base. On the seed, the machines pinned by
// ECO-2026-014 / -015 carry neither EL-HMI-15 nor FD-DET-OPT2: the prototype pinned them (09 OQ21), the goldens keep its values.
const E4_UNPINNED = new Set(['EL-HMI-15', 'FD-DET-OPT2']);

describe('Stock & storages view model (seed)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it.each(['en', 'fr'] as const)('%s: KPI tiles, chips, rows and recent movements equal the prototype', async (lang) => {
    const g = G[lang];
    const { view } = await screen(lang);
    expect(view.kpis).toEqual(g.kpis.map((k: any) => ({ ...k, value: String(k.value) })));
    expect(view.chips.map((c) => [c.label, c.count])).toEqual(g.chips.map((c: any) => [c.label, c.count]));
    expect(view.chipValue).toBe('');
    expect(viewRows(view.rows)).toEqual(goldenRows(g.rows, lang));
    expect(view.rows.every((r) => !r.selected)).toBe(true);
    expect(viewMoves(view.moves)).toEqual(goldenMoves(g.moves, lang));
    expect(view.empty).toBeNull();
  });

  it('location chips and search keep the other URL state; filtered rows equal the prototype', async () => {
    const { view: all, rows } = await screen('en');
    const index = (refs: { id: string }[]) => refs.map((r) => rows.findIndex((x) => x.id === r.id));
    for (const [loc, g] of Object.entries(G.en.byLocation) as [string, any][]) {
      const { view } = await screen('en', { loc, q: '' });
      expect(index(view.rows)).toEqual(g.rows);
      expect(view.chipValue).toBe(loc);
    }
    for (const [q, g] of Object.entries(G.en.search)) expect(index((await screen('en', { q })).view.rows)).toEqual(g);
    expect(index((await screen('en', { loc: 'Entrepôt central — Lyon', q: 'fd' })).view.rows)).toEqual(G.en.searchInLocation);
    // French: the name is shown as typed (R-148), so the stored text is what matches; the prototype's partial
    // translation ("rév. 2") no longer exists.
    expect((await screen('fr', { q: 'rév. 2' })).view.rows).toEqual([]);
    expect((await screen('fr', { q: 'rev 2' })).view.rows.map((r) => r.ref)).toEqual(['SG-BRK-SS2']);
    expect((await screen('en', { q: 'rév. 2' })).view.rows).toEqual([]);
    const none = await screen('fr', { q: 'zzz' });
    expect([none.view.rows.length, none.view.empty]).toEqual([0, 'Aucune ligne de stock ne correspond']);
    // Chip links keep the search and the open line, drop the part drawer; a row link toggles the drawer.
    const st = await screen('en', { q: 'cable', stock: rows[6].id, part: 'X' });
    expect(st.view.chips[1].href).toBe(stockHref({ loc: 'Entrepôt central — Lyon', q: 'cable', stock: rows[6].id }));
    expect(st.view.rows.find((r) => r.selected)!.href).toBe(stockHref({ q: 'cable' }));
    expect(all.rows[0].href).toBe(`/purchasing/stock?stock=${rows[0].id}`);
    expect(all.chips[0].href).toBe('/purchasing/stock');
  });

  it.each(['en', 'fr'] as const)('%s: the stock-line drawer of every row equals stockSel', async (lang) => {
    const t = makeT(lang);
    const { rows, locations, pins } = await screen(lang);
    for (const [i, r] of rows.entries()) {
      const g = G[lang].drawers[String(i)];
      const d = stockDrawerView({ year: 2026, detail: (await getStockPosition(r.id))!, locations, pins, state: { ...S0, stock: r.id } }, t, lang);
      expect([d.header, d.name, d.locationType, d.source, `tag tag-${d.sourceTone}`]).toEqual([`${g.ref} · ${g.loc}`, nameFix(lang, g.name), g.locType, g.source, g.srcClass]);
      expect(d.meta).toEqual(g.meta.map((m: any) => ({ k: m.k, v: day(String(m.v)) })));
      expect(d.ops.map((o) => o.label)).toEqual(g.opSeg.map((o: any) => o.label));
      expect(viewMoves(d.moves).map(({ when, type, qty, where, who }) => ({ when, type, qty, where, who }))).toEqual(
        goldenMoves(g.moves.map((m: any) => ({ ...m, ref: r.ref })), lang).map(({ when, type, qty, where, who }) => ({ when, type, qty, where, who })),
      );
      // Destinations: the prototype's short labels, except the two site stores written in full (08 OQ16).
      expect(d.targets.map((o) => (o.label.startsWith('Magasin chantier') ? 'Magasin chantier' : o.label))).toEqual(g.targets.map((o: any) => o.label));
      expect(d.closeHref).toBe('/purchasing/stock');
      expect(d.partHref).toBe(stockHref({ part: r.ref }));
    }
    // Quantity labels per operation, scrap warning of a pinned part (FD-DET-OPT, row 10).
    const pinned = stockDrawerView({ year: 2026, detail: (await getStockPosition(rows[10].id))!, locations, pins, state: S0 }, t, lang);
    // "Release reservation" (R-099) only for who may release it (here nobody: the view gets no right).
    expect(pinned.ops.map((o) => o.qtyLabel)).toEqual(['adjust', 'transfer', 'reserve', 'issue', 'return', 'scrap'].map((op) => G[lang].drawerOps[op].qtyLabel));
    const releasable = stockDrawerView({ year: 2026, detail: (await getStockPosition(rows[10].id))!, locations, pins, state: S0, canRelease: true, projectCode: 'MSR-012' }, t, lang);
    expect(releasable.ops.map((o) => o.value)).toEqual(['adjust', 'transfer', 'reserve', 'release', 'issue', 'return', 'scrap']);
    expect(releasable.reservedForOther).toEqual({ project: 'HLT-026', qty: 180 });
    expect(pinned.scrapWarning!.ecoHref).toBe('/reference/eco?eco=ECO-2026-015');
    expect(pinned.scrapWarning!.text).toBe(
      lang === 'en'
        ? G.en.drawerOps.scrap.scrapWarnText
        : 'Révision épinglée en service — À conserver pour le parc · 1 machine · ECO-2026-015. Le rebut est autorisé, mais le SAV doit d’abord confirmer la couverture en pièces de rechange.',
    );
    expect(G.fr.drawerOps.scrap.scrapWarnText).toMatch(/Scrapping is allowed/); // the prototype's half-English French
    const plain = stockDrawerView({ year: 2026, detail: (await getStockPosition(rows[0].id))!, locations, pins, state: S0 }, t, lang);
    expect(plain.scrapWarning).toBeNull();
  });
});

describe('Stock & storages after movements (DAL writes, the viewer as author)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the prototype sequence (adjust, transfer, reserve, issue, return, scrap) gives the same lines, movements and KPIs', async () => {
    const rows = await listStock();
    const id = (i: number) => rows[i].id;
    const who = { name: 'Marie Lefebvre', role: 'director' }; // the stock DAL re-checks the actor's rights (R-041)
    await applyStockMovement(id(0), { op: 'adjust', qty: 7 }, who);
    await applyStockMovement(id(4), { op: 'transfer', qty: 2, targetLocation: 'Magasin chantier — Marseille' }, who);
    await applyStockMovement(id(6), { op: 'reserve', qty: 4, projectCode: 'HLT-026' }, who);
    // SC-5a (R-098): the issue names its activity — the prototype's "→ HLT activity" reads "→ A1250 Steel erection — Bays 3–4".
    await applyStockMovement(id(6), { op: 'issue', qty: 6, projectCode: 'HLT-026', activityCode: 'A1250' }, who);
    await applyStockMovement(id(17), { op: 'return', qty: 3, projectCode: 'HLT-026' }, who);
    await applyStockMovement(id(12), { op: 'scrap', qty: 1 }, who);
    const g = JSON.parse(JSON.stringify(G.ops.sequence).replaceAll(' → HLT activity', ' → A1250 Steel erection — Bays 3–4'));
    const { view } = await screen('en');
    expect(viewRows(view.rows).map((r) => ({ ref: r.ref, loc: r.loc, onHand: r.onHand, reserved: r.reserved, avail: r.avail, source: r.source, last: r.last }))).toEqual(
      goldenRows(g.rows, 'en').map((r) => ({ ref: r.ref, loc: r.loc, onHand: r.onHand, reserved: r.reserved, avail: r.avail, source: r.source, last: r.last })),
    );
    expect(viewMoves(view.moves)).toEqual(goldenMoves(g.moves, 'en'));
    expect(view.kpis.filter((k) => k.label !== 'X3 import').map((k) => [k.value, k.sub])).toEqual(
      g.kpis.filter((k: any) => k.label !== 'X3 import').map((k: any) => [String(k.value), k.sub]),
    );
    // French: "Ajustement", "· inventaire", "Sortie", "→ activité HLT".
    const fr = await screen('fr');
    expect(viewMoves(fr.view.moves).slice(0, 3).map((m) => [m.type, m.where])).toEqual([
      ['Rebut', 'Entrepôt central — Lyon · reprise / rebut'],
      ['Retour', 'HLT → Magasin chantier — Marseille'],
      ['Sortie', 'Entrepôt central — Lyon → A1250 Steel erection — Bays 3–4'],
    ]);
    expect(viewMoves(fr.view.moves)[5]).toMatchObject({ type: 'Ajustement', where: 'Entrepôt central — Lyon · inventaire', when: '25 sept. 16:15' });
  });
});
