// Golden tests of the Project BOM rules (src/domain/bom.ts) fed with the prototype's own data (PARTS, TREE, LAST_PRICE,
// SPARE_LISTS, REV_DIFF, ECOS, genPOs) and compared with the prototype's render values (src/features/bom/bom.golden.json,
// scripts/proto-golden-bom.ts; shortfall: src/server/dal/delivery4.golden.json, scripts/proto-golden-d4.ts). EN
// formatting as the prototype's renderValsEN. Deliberate fixes are asserted explicitly: the BOM value counts each
// article once (09 OQ6) — the prototype's double-counted figure stays reachable as `listValueEur`.
import { describe, expect, it } from 'vitest';
import { money, moneyEur } from '@/lib/format';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import d4 from '@/server/dal/delivery4.golden.json';
import golden from '@/features/bom/bom.golden.json';
import {
  BOM_SORT_KEYS, DEFAULT_BOM_SORT, assemblyPaths, assemblyRows, bomLineTotal, bomShortfall, bomSummary, bomSupplierOptions, bomTypeOptions, buildAssembly,
  diffCostDelta, diffNewRef, filterBomLines, filterSpares, groupBySupplier, isValuedByComponents, leafCount, nextBomSort, nodeCost, orderedQtyByRef,
  parseNewBomLine, parseQuantity, pathQuantity, resolvePartQuery, rollupCost, sortBomLines, spareShortfall, spareSummary, systemQuantity,
  visibleAssemblyRows, type AssemblyLink, type BomSortKey,
} from './bom';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const EN = G.en;
const $ = (v: number) => moneyEur(v, 'en');
const n = (v: number) => v.toLocaleString('en-US');
const P: any[] = PROTO.PARTS;
const byRef = new Map(P.map((p) => [p.ref, p]));
const lastPrice = (ref: string) => (PROTO.LAST_PRICE[ref] ?? byRef.get(ref)?.price ?? 0) as number;
const STATUS_CODE: Record<string, any> = { Validated: 'validated', 'Not validated': 'not_validated', Outdated: 'outdated', Obsolete: 'obsolete' };

/** Parent → children links of the prototype TREE. */
const links = new Map<string, AssemblyLink[]>();
(function collect(nd: any) {
  if (nd.c?.length) links.set(nd.ref, nd.c.map((c: any) => ({ ref: c.ref, q: c.q })));
  (nd.c ?? []).forEach(collect);
})(PROTO.TREE);
const childrenOf = (ref: string) => links.get(ref) ?? [];
const root = buildAssembly(PROTO.TREE.ref, PROTO.TREE.q, childrenOf);

const p3 = (code: string) => code.slice(0, 3);
/** Flat-list items of a project from PARTS (`bomParts` 4206), with the English labels the prototype filters / sorts on. */
function items(code: string) {
  return P.filter((p) => p.usage[p3(code)] > 0).map((p) => ({
    ref: p.ref, name: p.name, type: p.type, typeLabel: p.type, manufacturer: p.mfr, manufacturerRef: p.mfrRef, listPriceEur: p.price,
    quantity: p.usage[p3(code)], statusLabel: p.status, status: STATUS_CODE[p.status], exportRestriction: p.restr === 'None' ? null : p.restr,
  }));
}
const DATA = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];

describe('flat list (bomRows, bomKpis, filters, sorts)', () => {
  it.each(DATA)('%s: default rows, totals, option lists and KPI figures', (code) => {
    const g = EN.projects[code];
    const its = items(code);
    const rows = sortBomLines(filterBomLines(its, {}), DEFAULT_BOM_SORT);
    expect(rows.map((r) => [r.ref, n(r.quantity), $(r.listPriceEur), $(bomLineTotal(r))])).toEqual(g.rows.map((r: any) => [r.ref, r.qty, r.price, r.total]));
    expect([{ label: `All types · ${its.length}` }, ...bomTypeOptions(its).map((o) => ({ label: `${o.label} · ${o.count}` }))]).toEqual(g.typeOpts.map((o: any) => ({ label: o.label })));
    expect([`All suppliers · ${its.length}`, ...bomSupplierOptions(its).map((o) => `${o.label} · ${o.count}`)]).toEqual(g.mfrOpts.map((o: any) => o.label));
    const inBom = new Set(its.map((i) => i.ref));
    const s = bomSummary(its.map((i) => ({ ...i, valuedByComponents: isValuedByComponents(i.ref, childrenOf, inBom) })));
    expect([s.articles, `${n(s.units)} units in total`, money(s.listValueEur / 1000, 'en'), s.notValidated, s.outdatedOrObsolete, s.exportRestricted])
      .toEqual([g.kpis[0].value, g.kpis[0].sub, g.kpis[1].value, g.kpis[2].value, g.kpis[3].value, g.kpis[4].value]);
  });

  it('BOM value counts each article once (09 OQ6): HLT-026 €7.05M instead of the prototype\'s €14.05M', () => {
    const its = items('HLT-026');
    const inBom = new Set(its.map((i) => i.ref));
    const flags = its.map((i) => ({ ...i, valuedByComponents: isValuedByComponents(i.ref, childrenOf, inBom) }));
    expect(flags.filter((f) => f.valuedByComponents).map((f) => f.ref)).toEqual(['ASM-RMG-250', 'ASM-STR-100', 'ASM-GIR-200', 'ASM-BOG-300', 'ASM-HST-400', 'ASM-ELE-600', 'ASM-DRV-700', 'ASM-CTL-800']);
    const s = bomSummary(flags);
    expect([money(s.listValueEur / 1000, 'en'), money(s.valueEur / 1000, 'en'), s.valueEur]).toEqual(['€14.05M', '€7.05M', 7_053_360]);
    // Projects without assemblies: both figures agree.
    const ndc = items('NDC-031');
    const sn = bomSummary(ndc.map((i) => ({ ...i, valuedByComponents: isValuedByComponents(i.ref, childrenOf, new Set(ndc.map((x) => x.ref))) })));
    expect(sn.valueEur).toBe(sn.listValueEur);
  });

  it('filters (type, supplier, search over ref · name · manufacturer · manufacturer ref) reproduce the prototype', () => {
    const its = items('HLT-026');
    const F: Record<string, any> = {
      'q:vfd': { q: 'vfd' }, 'q:ABB': { q: 'ABB' }, 'q:dwg-st': { q: 'dwg-st' }, 'q:zzz': { q: 'zzz' }, 'type:Electrical': { type: 'Electrical' }, 'type:Assembly': { type: 'Assembly' },
      'mfr:ABB': { mfr: 'ABB' }, 'mfr:Siemens+type:Electronics': { mfr: 'Siemens', type: 'Electronics' }, 'q:steel+type:Structural': { q: 'steel', type: 'Structural' },
    };
    for (const [k, f] of Object.entries(F)) {
      const rows = sortBomLines(filterBomLines(its, f), DEFAULT_BOM_SORT);
      expect([rows.map((r) => r.ref), `${rows.length} / ${its.length} articles`], k).toEqual([EN.filters[k].refs, EN.filters[k].count]);
    }
    expect(filterBomLines(its, { q: '  VFD ' }).map((r) => r.ref)).toEqual(['EL-VFD-200']); // trimmed (the prototype did not trim)
  });

  it('sorts: every column in both directions; header clicks (same column flips, Total starts descending)', () => {
    const its = items('HLT-026');
    for (const key of BOM_SORT_KEYS) {
      for (const dir of [1, -1]) {
        const rows = sortBomLines(its, { key, dir: dir === 1 ? 'asc' : 'desc' });
        expect(rows.map((r) => r.ref), `${key}:${dir}`).toEqual(EN.sorts[`${key}:${dir}`].refs);
      }
    }
    for (const key of BOM_SORT_KEYS) {
      const once = nextBomSort(DEFAULT_BOM_SORT, key);
      const twice = nextBomSort(once, key);
      const g = G.en.sortClicks?.[key] ?? G.sortClicks?.[key];
      const toDir = (d: number) => (d === 1 ? 'asc' : 'desc');
      expect([once, twice]).toEqual([{ key: g.once.sort as BomSortKey, dir: toDir(g.once.dir) }, { key: g.twice.sort as BomSortKey, dir: toDir(g.twice.dir) }]);
    }
  });
});

describe('assembly tree (treeRows, nodeVals)', () => {
  it('rows: depth, quantity, extended, roll-up at last purchase price, extended cost', () => {
    const rows = assemblyRows(root, lastPrice);
    expect(rows.map((r) => ({ ref: r.ref, pad: `${r.depth * 18 + 6}px`, has: r.hasChildren, qty: r.qty, ext: n(r.extended), unit: $(r.unitCostEur), total: $(r.extendedCostEur) })))
      .toEqual(EN.tree.map((r: any) => ({ ref: r.ref, pad: r.pad, has: r.has, qty: r.qty, ext: r.ext, unit: r.unit, total: r.total })));
    expect([$(rollupCost(root, lastPrice)), $(rollupCost(root, lastPrice) * root.q)]).toEqual(['€713,996', '€1,427,992']);
  });

  it('folding hides the whole subtree of a folded assembly', () => {
    const rows = visibleAssemblyRows(assemblyRows(root, lastPrice), new Set(['ASM-STR-100', 'ASM-DRV-700']));
    expect(rows.map((r) => r.ref)).toEqual(EN.treeFolded.map((r: any) => r.ref));
  });

  it('node drawer: components, costed roll-up (delta, per project), used-in paths', () => {
    for (const r of assemblyRows(root, lastPrice)) {
      const g = EN.nodes[r.ref];
      const part = byRef.get(r.ref);
      const c = nodeCost(root, r.ref, part.price, lastPrice)!;
      expect(g.ident[5].v).toBe(r.hasChildren ? `${r.leafCount} parts · ${r.childCount} direct children` : 'Leaf part');
      expect(g.cost.map((x: any) => [x.k, x.v, x.color])).toEqual([
        ['Rolled-up cost (last purchase)', $(c.unitCostEur), 'var(--color-text)'], ['List / standard price', $(c.listPriceEur), 'var(--color-text)'],
        ['Delta', (c.deltaEur >= 0 ? '+' : '−') + $(Math.abs(c.deltaEur)), c.overList ? 'var(--color-accent-300)' : 'var(--color-text)'],
        [`Per project (× ${c.perProjectQty})`, $(c.perProjectCostEur), 'var(--color-text)'],
      ]);
      expect(assemblyPaths(root, r.ref).map((p) => p.slice(0, -1).map((x) => x.ref).join(' › ') || 'Top level')).toEqual(g.parents);
    }
    expect([leafCount(root), EN.nodes[root.ref].ident[5].v]).toEqual([21, '21 parts · 4 direct children']);
  });
});

describe('where-used, compare revisions, PU/PR list', () => {
  it('where-used: part resolution (default CR-BRG-SKF) and assembly paths with Π q per project', () => {
    for (const [q, g] of Object.entries(EN.used as Record<string, any>)) {
      const part = resolvePartQuery(P, q === '(default)' ? '' : q)!;
      expect(part.ref, q).toBe(g.ref);
      const paths = assemblyPaths(root, part.ref).map((p) => ({ chain: p.slice(0, -1).map((x) => `${x.ref} ×${x.q}`).join('  ›  '), qty: `${n(pathQuantity(p))} per project`, leaf: part.ref }));
      expect(paths, q).toEqual(g.rows);
    }
  });

  it('compare revisions: new part of a line, quantity × last price deltas, "+€19,180 per crane"', () => {
    const rd = PROTO.REV_DIFF[root.ref];
    const toN = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
    const deltas = rd.rows.map(([path, , a, b]: string[]) => diffCostDelta(toN(a), toN(b), byRef.has(diffNewRef(path)) ? lastPrice(diffNewRef(path)) : null));
    expect(deltas.map((d: number) => (d ? (d > 0 ? '+' : '−') + $(Math.abs(d)) : '—'))).toEqual(EN.compare.cmp.rows.map((r: any) => r.delta));
    const t = deltas.reduce((s: number, d: number) => s + d, 0);
    expect(`${t >= 0 ? '+' : '−'}${$(Math.abs(t))} per crane`).toBe(EN.compare.cmp.total);
    expect(diffNewRef('ASM-DRV-700 / EL-HMI-10 → EL-HMI-15')).toBe('EL-HMI-15');
  });

  it('PU/PR: system quantity, rows and KPIs per system and kind (stock as the prototype read it: 0)', () => {
    const frozen = new Set((PROTO.ECOS as any[]).filter((e) => !['Released', 'Rejected'].includes(e.status)).flatMap((e) => e.parts));
    for (const [key, g] of Object.entries(EN.spares as Record<string, any>)) {
      const [sys, k] = key.split(':');
      const qty = systemQuantity(root, sys);
      const all = (PROTO.SPARE_LISTS[sys] as any[]).map(([ref, kind, q, note]) => ({
        ref, kind, q, note, recommendedQty: q * qty, inStock: 0, leadWeeks: byRef.get(ref)?.lead ?? null, underChange: frozen.has(ref), totalEur: lastPrice(ref) * q * qty,
      }));
      const rows = filterSpares(all, k === 'all' ? null : (k as 'PU' | 'PR'));
      expect(rows.map((r) => [r.ref, r.kind, r.q, r.recommendedQty, $(lastPrice(r.ref)), $(r.totalEur), r.underChange]), key)
        .toEqual(g.rows.map((r: any) => [r.ref, r.kind, r.qPer, r.qTotal, r.price, r.total, r.frozen]));
      const s = spareSummary(rows);
      expect([s.lines, `${s.wear} wear · ${s.spare} spare`, money(s.valueEur / 1000, 'en'), `At last purchase price · × ${qty} ${qty > 1 ? 'systems' : 'system'}`, s.notInStock, s.longLead, s.underChange], key)
        .toEqual([g.kpis[0].value, g.kpis[0].sub, g.kpis[1].value, g.kpis[1].sub, g.kpis[2].value, g.kpis[3].value, g.kpis[4].value]);
    }
    expect([systemQuantity(root, 'ASM-RMG-250'), systemQuantity(root, 'ASM-BOG-300'), systemQuantity(root, 'ASM-DRV-700')]).toEqual([2, 8, 2]);
  });

  it('PU/PR "Not in stock" with the real stock (the fix of STOCK_BY_REF): a line counts when on hand < recommended', () => {
    const base = { kind: 'PU' as const, leadWeeks: 3, underChange: false, totalEur: 0 };
    expect(spareSummary([{ ...base, recommendedQty: 16, inStock: 16 }, { ...base, recommendedQty: 8, inStock: 2 }, { ...base, recommendedQty: 4, inStock: 0 }]).notInStock).toBe(2);
    expect(spareShortfall([
      { ref: 'CR-BRG-SKF', recommendedQty: 16, inStock: 16, lastPriceEur: 598, supplier: 'SKF' },
      { ref: 'HST-ROP-28', recommendedQty: 4, inStock: 2, lastPriceEur: 9200, supplier: 'Teufelberger' },
    ])).toEqual([{ ref: 'HST-ROP-28', supplier: 'Teufelberger', need: 2, unitPriceEur: 9200, valueEur: 18400 }]);
  });
});

describe('still-to-order shortfall (feeds the draft purchase orders)', () => {
  const D4 = d4 as any;
  it.each(DATA)('%s: purchased BOM articles ordered less than their BOM quantity (shortfall 4328)', (code) => {
    const lines = P.filter((p) => p.usage[p3(code)] > 0).map((p) => ({ ref: p.ref, name: p.name, makeBuy: p.mb === 'Purchased' ? 'purchased' : 'manufactured', quantity: p.usage[p3(code)], listPriceEur: p.price, supplier: p.mfr }) as const);
    const ordered = orderedQtyByRef((PROTO_GEN.genPOs[code] as any[]).map((o) => ({ cancelled: o.status === 'Cancelled', lines: o.lines.map(([ref, qty]: [string, number]) => ({ ref, qty })) })));
    const sf = bomShortfall(lines, ordered);
    const g = D4.orders[code];
    expect(sf.lines.map((l) => [l.ref, n(l.need), l.need])).toEqual(g.shortfall);
    expect(`${money(sf.valueEur / 1000, 'en')} still to commit at list price`).toBe(g.shortfallSub);
  });

  it('HLT-026: one draft per supplier, first-appearance order (createDrafts 4330)', () => {
    const lines = P.filter((p) => p.usage.HLT > 0).map((p) => ({ ref: p.ref, name: p.name, makeBuy: p.mb === 'Purchased' ? 'purchased' : 'manufactured', quantity: p.usage.HLT, listPriceEur: p.price, supplier: p.mfr }) as const);
    const ordered = orderedQtyByRef((PROTO_GEN.genPOs['HLT-026'] as any[]).map((o) => ({ cancelled: o.status === 'Cancelled', lines: o.lines.map(([ref, qty]: [string, number]) => ({ ref, qty })) })));
    const groups = groupBySupplier(bomShortfall(lines, ordered).lines);
    expect(groups.map((g) => [g.supplier, g.lines.map((l) => [l.ref, l.need, 0])])).toEqual((d4 as any).ordersAfterDrafts.drafts.map((x: any) => [x.supplier, x.lines]));
  });

  it('cancelled orders do not count; drafts do', () => {
    expect(orderedQtyByRef([{ cancelled: true, lines: [{ ref: 'A', qty: 5 }] }, { cancelled: false, lines: [{ ref: 'A', qty: 2 }, { ref: 'B', qty: 1 }] }])).toEqual({ A: 2, B: 1 });
    const sf = bomShortfall([{ ref: 'A', name: 'a', makeBuy: 'purchased', quantity: 4, listPriceEur: 10, supplier: 'S' }, { ref: 'M', name: 'm', makeBuy: 'manufactured', quantity: 4, listPriceEur: 10, supplier: 'K' }], { A: 1 });
    expect([sf.lines.map((l) => [l.ref, l.orderedQty, l.need, l.valueEur]), sf.valueEur]).toEqual([[['A', 1, 3, 30]], 30]);
  });
});

describe('Add article form (AF.bom)', () => {
  const ctx = { catalogue: new Set(['ME-GBX-90', 'EL-VFD-200']), inBom: new Set(['EL-VFD-200']), activities: ['A1250', 'A1320'] };
  it('parses a valid article (reference upper-cased, French decimal comma, default activity and scope)', () => {
    expect(parseNewBomLine({ ref: ' me-gbx-90 ', qty: '2,5', act: 'A1320', scope: 'overlay', note: ' Spare ' }, ctx)).toEqual({ ok: true, value: { ref: 'ME-GBX-90', quantity: 2.5, activityCode: 'A1320', scope: 'overlay', note: 'Spare' } });
    expect(parseNewBomLine({ ref: 'ME-GBX-90' }, ctx)).toEqual({ ok: true, value: { ref: 'ME-GBX-90', quantity: 1, activityCode: 'A1250', scope: 'keystone', note: null } });
    expect(parseNewBomLine({ ref: 'ME-GBX-90' }, { ...ctx, activities: [] })).toMatchObject({ ok: true, value: { activityCode: null } });
  });
  it('refuses a missing / unknown / duplicate reference, a bad quantity, activity or scope', () => {
    const err = (v: Record<string, string>) => {
      const r = parseNewBomLine(v, ctx);
      return r.ok ? null : r.error;
    };
    expect([
      err({ ref: ' ' }), err({ ref: 'NOPE-1' }), err({ ref: 'EL-VFD-200' }), err({ ref: 'ME-GBX-90', qty: '0' }), err({ ref: 'ME-GBX-90', qty: '-2' }), err({ ref: 'ME-GBX-90', qty: 'abc' }),
      err({ ref: 'ME-GBX-90', act: 'A9999' }), err({ ref: 'ME-GBX-90', scope: 'Client' }), err({ ref: 'ME-GBX-90', note: 'x'.repeat(501) }),
    ]).toEqual([
      'The article reference is required', 'Unknown article reference', 'This article is already in the project BOM', 'Invalid quantity', 'Invalid quantity', 'Invalid quantity',
      'Unknown activity', 'Invalid scope', 'The note is too long',
    ]);
    expect([parseQuantity('1 000'), parseQuantity('3.'), parseQuantity('1e3')]).toEqual([1000, NaN, NaN]);
  });
  it('the prototype form: fields, select options and result text', () => {
    expect(G.form.af.fields.map((f: any[]) => f[0])).toEqual(['ref', 'qty', 'act', 'scope', 'note']);
    expect(G.form.result).toBe('Article added to the project BOM');
  });
});
