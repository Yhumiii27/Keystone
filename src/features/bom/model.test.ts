// Project BOM screen model vs the prototype's own render values (bom.golden.json, scripts/proto-golden-bom.ts), on an
// in-memory database migrated and seeded from the prototype, in English and French, for every project and display.
// Deliberate deviations are applied to the expected values explicitly (see DEVIATIONS below and docs/spec/00 §7.16):
// - BOM value counts each article once (09 OQ6): HLT-026 €7.05M (the prototype €14.05M);
// - PU/PR stock is Σ on hand (the prototype always read 0): "16 in stock", "Not in stock" 10 of 12;
// - quantities in French use the French format ("2 042"; the prototype used the browser locale);
// - French the prototype left in English: "32 par projet", "32 unités", "+19 180 € par grue", "Plan / réf.",
//   restriction texts (translated through the PLM dictionary entries); singular forms ("1 week", "1 semaine");
// - projects without data (EWA-051) show an empty BOM instead of Harbor Line's.
import { beforeAll, describe, expect, it } from 'vitest';
import { LO } from '@/components/app/tones';
import { makeT, type Lang } from '@/i18n/translate';
import { partType } from '@/server/db/codes';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getBomScreen } from '@/server/dal/bom-screen';
import golden from './bom.golden.json';
import { bomHref, parseBomState } from './links';
import { bomScreenView, type BomScreenView } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const LANGS: Lang[] = ['en', 'fr'];
const DATA = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];
const NNBSP = ' ';
/** French number format of the rebuild ("2,042" → "2 042" with a narrow no-break space). */
const frNum = (s: string, lang: Lang) => (lang === 'fr' && typeof s === 'string' ? s.replace(/(\d),(\d{3})/g, `$1${NNBSP}$2`) : s);

async function screen(code: string, sp: Record<string, string>, lang: Lang, canEdit = true, canRaiseEco = canEdit): Promise<BomScreenView> {
  const state = parseBomState(sp);
  const data = await getBomScreen(code, { view: state.view, used: state.used, system: state.sys });
  return bomScreenView(code, state, data!, { canEdit, canRaiseEco }, makeT(lang), lang);
}
const kpis = (v: BomScreenView['kpis']) => v.map((k) => ({ label: k.label, value: k.value, sub: k.sub, color: k.color }));
const gKpis = (ks: any[], lang: Lang) => ks.map((k) => ({ label: k.label, value: String(k.value), sub: frNum(k.sub, lang), color: k.color }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe.each(LANGS)('Project BOM screen model (%s)', (lang) => {
  const g = G[lang];

  it.each(DATA)('%s: KPI tiles (BOM value without double count), Display segment, flat list header', async (code) => {
    const v = await screen(code, {}, lang);
    const p = g.projects[code];
    const expected = gKpis(p.kpis, lang);
    // 09 OQ6: each article once (the prototype added assemblies and their components, €14.01M at E-2a prices); E-2a (R-103):
    // ordered price, else last purchase, else catalogue — €7.02M (€7.05M at list price before Delivery 7).
    if (code === 'HLT-026') expected[1].value = lang === 'fr' ? '7,02 M€' : '€7.02M';
    expect(kpis(v.kpis)).toEqual(expected);
    expect(v.views.map((o) => [o.label, o.active])).toEqual(p.viewSeg.map((o: any) => [o.label, o.color === 'var(--color-accent)']));
    expect(v.displayLabel).toBe(p.FL.view);
    const f = v.flat!;
    expect([f.count, f.title, f.clearHref, f.clearLabel]).toEqual([p.count, p.title, null, p.clearLabel]);
    expect(f.typeOptions.map((o) => o.label)).toEqual(p.typeOpts.map((o: any) => o.label));
    expect(f.supplierOptions.map((o) => o.label)).toEqual(p.mfrOpts.map((o: any) => o.label));
    expect(f.typeOptions.slice(1).map((o) => partType.label(o.value))).toEqual(p.typeOpts.slice(1).map((o: any) => o.key));
  });

  it.each(DATA)('%s: flat rows (default sort) reproduce bomRows', async (code) => {
    const v = await screen(code, {}, lang);
    const rows = v.flat!.rows.map((r) => ({
      ref: r.ref, name: r.name, type: r.type, mb: r.makeBuy, pu: r.pu.label, puClass: r.pu.cls, mfr: r.sub, price: r.price, qty: r.qty, total: r.total, status: r.status.label,
      tagClass: r.status.cls, restrColor: r.restricted ? LO : 'var(--color-neutral-500)', used: r.alsoUsedIn, hasEco: !!r.eco, eco: r.eco?.number ?? '',
    }));
    expect(rows).toEqual(g.projects[code].rows.map((r: any) => ({
      ref: r.ref, name: r.name, type: r.type, mb: r.mb, pu: r.pu, puClass: r.puClass, mfr: `${r.mfr} · ${r.mfrRef}`, price: r.price, qty: frNum(r.qty, lang), total: r.total,
      status: r.status, tagClass: r.tagClass, restrColor: r.restrColor, used: r.used, hasEco: r.hasEco, eco: r.eco,
    })));
    // Restriction texts: English as the prototype; French through the dictionary (the prototype left them in English).
    const en = G.en.projects[code].rows;
    v.flat!.rows.forEach((r, i) => expect(r.restriction).toBe(lang === 'en' ? en[i].restr : makeT('fr')(en[i].restr)));
    expect(v.flat!.rows.every((r) => !r.eco || r.eco.href === `/reference/eco?eco=${r.eco.number}`)).toBe(true);
  });

  it('HLT-026: assemblies valued through their components are flagged (total muted, not added to the BOM value)', async () => {
    const v = await screen('HLT-026', {}, lang);
    expect(v.flat!.rows.filter((r) => r.totalNote).map((r) => r.ref)).toEqual(['ASM-BOG-300', 'ASM-CTL-800', 'ASM-DRV-700', 'ASM-ELE-600', 'ASM-GIR-200', 'ASM-HST-400', 'ASM-RMG-250', 'ASM-STR-100']);
  });

  it('filters, searches and sorts reproduce the prototype (type in the URL as a code)', async () => {
    const TYPE: Record<string, string> = { Electrical: 'electrical', Assembly: 'assembly', Electronics: 'electronics', Structural: 'structural' };
    const F: Record<string, Record<string, string>> = {
      'q:vfd': { q: 'vfd' }, 'q:ABB': { q: 'ABB' }, 'q:dwg-st': { q: 'dwg-st' }, 'q:zzz': { q: 'zzz' }, 'type:Electrical': { type: TYPE.Electrical }, 'type:Assembly': { type: TYPE.Assembly },
      'mfr:ABB': { mfr: 'ABB' }, 'mfr:Siemens+type:Electronics': { mfr: 'Siemens', type: TYPE.Electronics }, 'q:steel+type:Structural': { q: 'steel', type: TYPE.Structural },
    };
    for (const [k, sp] of Object.entries(F)) {
      const f = (await screen('HLT-026', sp, lang)).flat!;
      expect([f.rows.map((r) => r.ref), f.count, f.title, !!f.clearHref], k).toEqual([g.filters[k].refs, g.filters[k].count, g.filters[k].title, g.filters[k].hasFilter]);
    }
    for (const key of ['ref', 'name', 'type', 'total', 'status']) {
      for (const dir of [1, -1]) {
        const f = (await screen('HLT-026', { sort: key, dir: dir === 1 ? 'asc' : 'desc' }, lang)).flat!;
        const gs = g.sorts[`${key}:${dir}`];
        expect(f.rows.map((r) => r.ref), `${key}:${dir}`).toEqual(gs.refs);
        expect(f.headers.map((h) => (h.dir === 'asc' ? 'ph ph-caret-up' : h.dir === 'desc' ? 'ph ph-caret-down' : 'ph ph-caret-up-down'))).toEqual(['ref', 'name', 'type', 'total', 'status'].map((k) => gs.ico[k]));
      }
    }
    const zzz = (await screen('HLT-026', { q: 'zzz' }, lang)).flat!;
    expect(zzz.empty).toBe(makeT(lang)('No article matches'));
  });

  it('selected part: reference in accent-300 (flat and PU/PR), toggled by a second click', async () => {
    const f = (await screen('HLT-026', { part: 'EL-VFD-200' }, lang)).flat!;
    expect(f.rows.filter((r) => r.selected).map((r) => r.ref)).toEqual(g.selected);
    expect(f.rows.find((r) => r.ref === 'EL-VFD-200')!.href).toBe('/projects/HLT-026/bom');
    expect(f.rows.find((r) => r.ref === 'EL-PLC-S7')!.href).toBe('/projects/HLT-026/bom?part=EL-PLC-S7');
    const sp = (await screen('HLT-026', { view: 'spares', part: 'HST-MOT-160' }, lang)).spares!;
    expect(sp.rows.filter((r) => r.selected).map((r) => r.ref)).toEqual(g.sparesSelected);
  });

  it('assembly tree rows and the selected node reproduce treeRows', async () => {
    const v = await screen('HLT-026', { view: 'tree', node: 'ASM-BOG-300' }, lang);
    expect(v.tree!.rows.map((r) => ({
      ref: r.ref, name: r.name, pad: `${r.depth * 18 + 6}px`, has: r.hasChildren, qty: r.qty, ext: r.ext, mb: r.makeBuy, pu: r.pu.label, puClass: r.pu.cls, rev: r.rev,
      status: r.status.label, tagClass: r.status.cls, unit: r.unit, total: r.total,
    }))).toEqual(g.tree.map((r: any) => ({
      ref: r.ref, name: r.name, pad: r.pad, has: r.has, qty: String(r.qty), ext: frNum(r.ext, lang), mb: r.mb, pu: r.pu, puClass: r.puClass, rev: r.rev, status: r.status,
      tagClass: r.tagClass, unit: r.unit, total: r.total,
    })));
    expect(v.tree!.rows.filter((r) => r.selected).map((r) => r.ref)).toEqual(g.treeSelected);
    const label = (en: string) => (lang === 'fr' ? G.labels[en] : en);
    expect([v.tree!.title, v.tree!.hint, v.flat, v.noTree]).toEqual([label('Assembly tree'), label('Click a line for its detail · caret to fold'), null, null]);
  });

  it('node drawers reproduce nodeVals (identification, costed roll-up, used in); Raise ECO opens Vigie', async () => {
    const tr = makeT(lang);
    for (const ref of Object.keys(g.nodes)) {
      const n = (await screen('HLT-026', { view: 'tree', node: ref }, lang)).node!;
      const e = g.nodes[ref];
      // Deliberate: "Plan / réf." (prototype "Plan / ref."), singular "1 week" / "1 semaine" (prototype "1 weeks").
      const ident = e.ident.map((x: any) => ({ k: x.k === 'Plan / ref.' ? 'Plan / réf.' : x.k, v: x.v === '1 weeks' ? '1 week' : x.v === '1 semaines' ? '1 semaine' : x.v }));
      expect([n.ref, n.name, n.status.label, n.status.cls]).toEqual([e.ref, e.name, e.status, e.tagClass]);
      expect(n.ident.map((x) => ({ k: x.k, v: x.v }))).toEqual(ident);
      expect(n.cost.map((x) => ({ k: x.k, v: x.v, color: x.color ?? 'var(--color-text)' }))).toEqual(e.cost);
      expect(n.parents).toEqual(e.parents);
      expect([n.partHref, n.drawingsHref, n.closeHref]).toEqual([`/projects/HLT-026/bom?part=${ref}`, `/reference/drawings?q=${ref}`, '/projects/HLT-026/bom?view=tree']);
      expect(n.raiseEco).toEqual({
        href: `http://localhost:3200/modifications-techniques/nouvelle?part=${ref}&project=HLT-026&source=keystone`, label: tr('Raise ECO'),
        title: tr('Opens Vigie’s new ECO form, prefilled with this part'), target: '_blank', rel: 'noopener noreferrer',
      });
    }
    // Raise ECO follows the ECO screen access (as the part drawer), not the BOM edit right: a read-only project keeps it.
    const ro = (await screen('HLT-026', { view: 'tree', node: 'ASM-BOG-300' }, lang, false, true)).node!;
    expect(ro.raiseEco?.label).toBe(tr('Raise ECO'));
    expect((await screen('HLT-026', { view: 'tree', node: 'ASM-BOG-300' }, lang, false, false)).node!.raiseEco).toBeNull();
    if (lang === 'fr') expect(ro.raiseEco!.title).toBe('Ouvre le formulaire de nouvel ECO de Vigie, prérempli avec cet article');
    expect((await screen('HLT-026', { view: 'tree', node: 'NOPE' }, lang)).node).toBeNull();
  });

  it('where-used reproduces usedVals (paths, projects, purchase orders, default CR-BRG-SKF)', async () => {
    for (const [q, e] of Object.entries(g.used as Record<string, any>)) {
      const w = (await screen('HLT-026', q === '(default)' ? { view: 'used' } : { view: 'used', used: q }, lang)).used!;
      expect([w.part.ref, w.part.name, w.part.status.label, w.part.status.cls, w.part.equivalents], q).toEqual([e.ref, e.name, e.status, e.tagClass, e.equiv]);
      const perProject = (s: string) => (lang === 'fr' ? s.replace(' per project', ' par projet') : s);
      expect(w.paths, q).toEqual(e.rows.map((r: any) => ({ chain: r.chain, qty: perProject(frNum(r.qty, lang)) })));
      expect(w.noPaths === null, q).toBe(!e.none);
      const units = (s: string) => (lang === 'fr' ? s.replace(/ units?$/, (m) => (m === ' unit' ? ' unité' : ' unités')) : s);
      expect(w.projects.map((p) => ({ name: p.name, qty: p.qty, status: p.stage.label, tagClass: p.stage.cls })), q)
        .toEqual(e.projects.map((p: any) => ({ name: p.name, qty: units(frNum(p.qty, lang)), status: p.status, tagClass: p.tagClass })));
      expect(w.orders.map((o) => ({ id: o.number, text: o.text, status: o.status })), q).toEqual(e.pos.map((o: any) => ({ id: o.id, text: `${o.supplier} · ${o.project}`, status: o.status })));
      expect(w.noOrders === null, q).toBe(!e.noPos);
    }
    // Projects without a structure: the part's projects and orders, no assembly path, and the "no tree" notice.
    const ndc = await screen('NDC-031', { view: 'used', used: 'EL-VFD-200' }, lang);
    expect([ndc.used!.part.ref, ndc.used!.paths.length, ndc.used!.projects.length, !!ndc.noTree]).toEqual(['EL-VFD-200', 0, g.usedOther['NDC-031'].projects.length, true]);
  });

  it('compare revisions reproduces cmpVals', async () => {
    const c = (await screen('HLT-026', { view: 'compare' }, lang)).compare!;
    const e = g.compare.cmp;
    expect([c.title, c.sub]).toEqual([e.title, e.sub]);
    expect(c.total).toBe(lang === 'fr' ? e.total.replace(' per crane', ' par grue') : e.total);
    expect(c.rows.map((r) => ({ line: r.line, name: r.name, a: r.a, b: r.b, kind: r.kind.label, tagClass: r.kind.cls, delta: r.delta })))
      .toEqual(e.rows.map((r: any) => ({ line: r.line, name: r.name, a: r.a, b: r.b, kind: r.kind, tagClass: r.tagClass, delta: r.delta })));
    expect([c.labels.from, c.labels.to]).toEqual(lang === 'fr' ? ['Rév. B', 'Rév. C'] : ['Rev B', 'Rev C']);
  });

  it('PU/PR lists reproduce spKpis / spareRows per system and kind, with the real stock', async () => {
    const STOCK: Record<string, number> = { 'CR-BRG-SKF': 16, 'HST-ROP-28': 2, 'FD-DET-OPT2': 60 };
    const tr = makeT(lang);
    for (const [key, e] of Object.entries(g.spares as Record<string, any>)) {
      const [sys, kind] = key.split(':');
      const sp: Record<string, string> = { view: 'spares' };
      if (sys !== 'ASM-RMG-250') sp.sys = sys;
      if (kind !== 'all') sp.kind = kind;
      const s = (await screen('HLT-026', sp, lang)).spares!;
      const rows = e.rows.map((r: any) => {
        const stock = STOCK[r.ref] ?? 0;
        return {
          ref: r.ref, name: r.name, kind: r.kind, tagClass: r.tagClass, qPer: String(r.qPer), qTotal: String(r.qTotal), note: r.note, price: r.price, total: r.total, lead: r.lead,
          status: r.status, statusClass: r.statusClass, stock: stock ? (lang === 'fr' ? `${stock} en stock` : `${stock} in stock`) : r.stockText, short: stock < r.qTotal,
          pinned: r.pinned ? r.pinnedText : null,
        };
      });
      expect(s.rows.map((r) => ({
        ref: r.ref, name: r.name, kind: r.kind.label, tagClass: r.kind.cls, qPer: r.qPer, qTotal: r.qTotal, note: r.note, price: r.price, total: r.total, lead: r.lead,
        status: r.status.label, statusClass: r.status.cls, stock: r.stock, short: r.stockShort, pinned: r.pinned?.text ?? null,
      })), key).toEqual(rows);
      const expected = gKpis(e.kpis, lang);
      const notInStock = rows.filter((r: any) => r.short).length;
      expected[2] = { ...expected[2], value: String(notInStock), color: notInStock ? LO : 'var(--color-text)' };
      expect(kpis(s.kpis), key).toEqual(expected);
      expect(s.systems.map((o) => [o.label, o.active]), key).toEqual(e.seg.map((o: any) => [o.label, o.color === 'var(--color-accent)']));
      expect(s.kinds.map((o) => [o.label, o.active]), key).toEqual(e.chips.map((c: any) => [c.label, c.bg === 'var(--color-accent-900)']));
      expect(s.title, key).toBe(`${tr('Recommended wear & spare parts')} — ${e.sysName}`);
      expect(s.empty === null, key).toBe(!e.noSpares);
      expect(s.rows.filter((r) => r.pinned).every((r) => r.pinned!.href === '/reference/eco?eco=ECO-2026-014'), key).toBe(true);
    }
    const all = (await screen('HLT-026', { view: 'spares' }, lang)).spares!;
    expect([all.kpis[2].value, all.labels.lead]).toEqual(['10', tr('Lead time')]); // "Not in stock" 10 of 12; header was "Discipline lead"
  });

  it('displays without a multi-level structure show the notice (bomNoTree)', async () => {
    for (const code of [...DATA, 'EWA-051']) {
      for (const view of ['flat', 'tree', 'used', 'compare', 'spares']) {
        const v = await screen(code, { view }, lang);
        const expected = code === 'EWA-051' ? view !== 'flat' : g.projects[code].noTreeByView[view];
        expect(!!v.noTree, `${code} ${view}`).toBe(expected);
      }
    }
  });
});

describe('projects without data (no Harbor Line fallback, 00 §7.16)', () => {
  it('EWA-051: empty BOM, zero KPIs, empty-state message', async () => {
    const v = await screen('EWA-051', {}, 'en');
    expect(G.en.projects['EWA-051'].kpis[0].value).toBe(35); // the prototype showed Harbor Line's BOM
    expect(kpis(v.kpis).map((k) => [k.value, k.sub])).toEqual([['0', '0 units in total'], ['€0k', 'Ordered, else last purchase, else catalogue price'], ['0', 'Blocked for purchasing'], ['0', 'Replace before ordering'], ['0', 'Lines needing customs review']]);
    expect([v.flat!.rows.length, v.flat!.count, v.flat!.title, v.flat!.empty]).toEqual([0, '0 / 0 articles', 'Bill of materials · 0 articles', 'No article is registered in this project’s BOM yet']);
    const fr = await screen('EWA-051', {}, 'fr');
    expect(fr.flat!.empty).toBe('Aucun article n’est encore enregistré dans la nomenclature de ce projet');
  });
});

describe('URL state', () => {
  it('parses and rebuilds the state; unknown values fall back to the defaults', () => {
    const s = parseBomState({ view: 'spares', q: 'vfd', type: 'electrical', mfr: 'ABB', sort: 'total', dir: 'desc', part: 'EL-VFD-200', node: 'ASM-BOG-300', used: 'skf', sys: 'ASM-BOG-300', kind: 'PU' });
    expect(bomHref('HLT-026', s)).toBe('/projects/HLT-026/bom?view=spares&q=vfd&type=electrical&mfr=ABB&sort=total&dir=desc&used=skf&sys=ASM-BOG-300&kind=PU&node=ASM-BOG-300&part=EL-VFD-200');
    const bad = parseBomState({ view: 'folders', sort: 'mfr', dir: 'up', kind: 'XX', part: '<script>', type: 'a b' });
    expect([bad.view, bad.sort, bad.kind, bad.part, bad.type]).toEqual(['flat', { key: 'ref', dir: 'asc' }, null, null, null]);
    expect(bomHref('HLT-026', parseBomState({}))).toBe('/projects/HLT-026/bom');
  });

  it('view segment keeps the filters and closes the drawers; sort headers follow the click rule', async () => {
    const v = await screen('HLT-026', { q: 'abb', part: 'EL-VFD-200', sort: 'total', dir: 'desc' }, 'en');
    expect(v.views.find((o) => o.value === 'tree')!.href).toBe('/projects/HLT-026/bom?view=tree&q=abb&sort=total&dir=desc');
    expect(v.flat!.headers.map((h) => h.href)).toEqual([
      '/projects/HLT-026/bom?q=abb', '/projects/HLT-026/bom?q=abb&sort=name&dir=asc', '/projects/HLT-026/bom?q=abb&sort=type&dir=asc',
      '/projects/HLT-026/bom?q=abb&sort=total&dir=asc', '/projects/HLT-026/bom?q=abb&sort=status&dir=asc',
    ]);
    expect(v.flat!.clearHref).toBe('/projects/HLT-026/bom?sort=total&dir=desc');
  });
});

describe('template labels', () => {
  it('every label of the template (1167–1311) has the prototype French; "Discipline lead" is replaced by "Lead time"', () => {
    const fr = makeT('fr');
    for (const [en, f] of Object.entries(G.labels as Record<string, string>)) {
      if (en === 'Discipline lead') continue; // 09 OQ2: the column shows the lead time
      expect(fr(en), en).toBe(f);
    }
    expect([G.labels['Discipline lead'], fr('Lead time')]).toEqual(['Référent', 'Délai d’approvisionnement']);
  });

  it('Add article form: the prototype fields, French labels and result', () => {
    const fr = makeT('fr');
    const af = G.form.af;
    expect([fr(af.title), fr(af.submit), af.fields.map((f: any[]) => fr(f[1])), af.fields[3][3].map(fr), fr(G.form.result)])
      .toEqual([G.form.fr.title, G.form.fr.submit, G.form.fr.labels, G.form.fr.scope, G.form.fr.result]);
  });
});

describe('stale filters', () => {
  it('a type or supplier the BOM does not have falls back to "All"', async () => {
    const f = (await screen('NDC-031', { type: 'assembly', mfr: 'SKF' }, 'en')).flat!;
    expect([f.rows.length, f.typeOptions[0].active, f.supplierOptions[0].active, f.clearHref]).toEqual([8, true, true, null]);
  });

  it('a PU/PR system outside the segment (an assembly without a list, an unknown ref) falls back to the complete system', async () => {
    for (const sys of ['ASM-STR-100', 'NOPE-1']) {
      const s = (await screen('HLT-026', { view: 'spares', sys, kind: 'PU' }, 'en')).spares!;
      expect([s.systems.find((o) => o.active)?.value, s.title, s.rows.length, s.kinds[0].href, s.rows[0].href], sys).toEqual([
        'ASM-RMG-250', 'Recommended wear & spare parts — Gantry crane 250 t — complete', 4, '/projects/HLT-026/bom?view=spares',
        '/projects/HLT-026/bom?view=spares&kind=PU&part=CR-WHL-630',
      ]);
    }
  });
});
