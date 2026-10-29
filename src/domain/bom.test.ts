// Golden tests of the Project BOM rules (src/domain/bom.ts) fed with the prototype's own data (PARTS, TREE, LAST_PRICE,
// SPARE_LISTS, REV_DIFF, ECOS, genPOs) and compared with the prototype's render values (src/features/bom/bom.golden.json,
// scripts/proto-golden-bom.ts; shortfall: src/server/dal/delivery4.golden.json, scripts/proto-golden-d4.ts). EN
// formatting as the prototype's renderValsEN. Deliberate fixes are asserted explicitly: the BOM value counts each
// article once (09 OQ6) — the prototype's double-counted figure stays reachable as `listValueEur`.
import { describe, expect, it } from 'vitest';
import { money, moneyEur } from '@/lib/format';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { dataText } from '@/i18n/data-text';
import d4 from '@/server/dal/delivery4.golden.json';
import golden from '@/features/bom/bom.golden.json';
import {
  BOM_SORT_KEYS, DEFAULT_BOM_SORT, assemblyPaths, assemblyRows, bomLineTotal, bomShortfall, bomSummary, bomSupplierOptions, bomTypeOptions, bomUnitPrice, buildAssembly,
  diffCostDelta, diffNewRef, diffOldRef, filterBomLines, filterSpares, groupBySupplier, isValuedByComponents, leafCount, nextBomSort, nodeCost, orderedQtyByRef,
  defaultWhereUsedRef, parseNewBomLine, parseQuantity, pathQuantity, resolvePartQuery, rollupCost, sortBomLines, spareShortfall, spareSummary, systemQuantity,
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
/**
 * E-2a = a (Delivery 7, R-103): the BOM is valued at the project's ordered price (its orders Ordered, Partially received
 * or Received — the seed's lines carry the catalogue price), else the last purchase price, else the catalogue price.
 * The goldens are generated with the same rule applied to the prototype logic (scripts/proto-e2a.ts).
 */
const orderedRefs = (code: string) =>
  new Set((PROTO_GEN.genPOs[code] as any[] ?? []).filter((o) => ['Ordered', 'Partially received', 'Received'].includes(o.status)).flatMap((o) => o.lines.map((l: any[]) => l[0] as string)));
const e2aOf = (code: string) => {
  const ordered = orderedRefs(code);
  return (ref: string): number => {
    const p = byRef.get(ref);
    if (!p) return 0;
    return bomUnitPrice({ orderedEur: ordered.has(ref) ? p.price : null, lastPurchaseEur: PROTO.LAST_PRICE[ref] ?? null, listPriceEur: p.price }).unitEur;
  };
};
const e2aHlt = e2aOf('HLT-026');
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
  const e2a = e2aOf(code);
  return P.filter((p) => p.usage[p3(code)] > 0).map((p) => ({
    ref: p.ref, name: p.name, type: p.type, typeLabel: p.type, manufacturer: p.mfr, manufacturerRef: p.mfrRef, listPriceEur: p.price, unitPriceEur: e2a(p.ref),
    quantity: p.usage[p3(code)], statusLabel: p.status, status: STATUS_CODE[p.status], exportRestriction: p.restr === 'None' ? null : p.restr,
  }));
}
const DATA = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];

describe('flat list (bomRows, bomKpis, filters, sorts)', () => {
  it.each(DATA)('%s: default rows, totals, option lists and KPI figures', (code) => {
    const g = EN.projects[code];
    const its = items(code);
    const rows = sortBomLines(filterBomLines(its, {}), DEFAULT_BOM_SORT);
    expect(rows.map((r) => [r.ref, n(r.quantity), $(r.unitPriceEur), $(bomLineTotal(r))])).toEqual(g.rows.map((r: any) => [r.ref, r.qty, r.price, r.total]));
    expect([{ label: `All types · ${its.length}` }, ...bomTypeOptions(its).map((o) => ({ label: `${o.label} · ${o.count}` }))]).toEqual(g.typeOpts.map((o: any) => ({ label: o.label })));
    expect([`All suppliers · ${its.length}`, ...bomSupplierOptions(its).map((o) => `${o.label} · ${o.count}`)]).toEqual(g.mfrOpts.map((o: any) => o.label));
    const inBom = new Set(its.map((i) => i.ref));
    const s = bomSummary(its.map((i) => ({ ...i, valuedByComponents: isValuedByComponents(i.ref, childrenOf, inBom) })));
    // The prototype's BOM value adds every line (09 OQ6) — here at the E-2a prices.
    const protoValue = its.reduce((a, i) => a + bomLineTotal(i), 0);
    expect([s.articles, `${n(s.units)} units in total`, money(protoValue / 1000, 'en'), s.notValidated, s.outdatedOrObsolete, s.exportRestricted])
      .toEqual([g.kpis[0].value, g.kpis[0].sub, g.kpis[1].value, g.kpis[2].value, g.kpis[3].value, g.kpis[4].value]);
  });

  it('BOM value counts each article once (09 OQ6): HLT-026 €7.02M at E-2a prices instead of the prototype\'s €14.05M', () => {
    const its = items('HLT-026');
    const inBom = new Set(its.map((i) => i.ref));
    const flags = its.map((i) => ({ ...i, valuedByComponents: isValuedByComponents(i.ref, childrenOf, inBom) }));
    expect(flags.filter((f) => f.valuedByComponents).map((f) => f.ref)).toEqual(['ASM-RMG-250', 'ASM-STR-100', 'ASM-GIR-200', 'ASM-BOG-300', 'ASM-HST-400', 'ASM-ELE-600', 'ASM-DRV-700', 'ASM-CTL-800']);
    const s = bomSummary(flags);
    // E-2a (R-103): €7.02M at the ordered / last purchase / catalogue price (€7.05M at the catalogue price, Delivery 4–6).
    expect([money(s.listValueEur / 1000, 'en'), money(s.valueEur / 1000, 'en'), s.valueEur]).toEqual(['€14.05M', '€7.02M', 7_019_976]);
    expect(bomSummary(flags.map((f) => ({ ...f, unitPriceEur: undefined }))).valueEur).toBe(7_053_360); // at the catalogue price (Delivery 4–6)
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

  it('R-157: the search also reads the displayed (French) article name and ignores accents', () => {
    const its = items('HLT-026');
    const fr = (l: { name: string }) => dataText(l.name, 'fr');
    const line = its.find((l) => fr(l) !== l.name && fr(l).split(/\s+/).some((w) => w.length > 4 && !l.name.toLowerCase().includes(w.toLowerCase())))!;
    expect(line).toBeDefined();
    const word = fr(line).split(/\s+/).find((w) => w.length > 4 && !line.name.toLowerCase().includes(w.toLowerCase()))!;
    expect(filterBomLines(its, { q: word }).map((r) => r.ref)).not.toContain(line.ref); // the English name alone misses it
    expect(filterBomLines(its, { q: word }, fr).map((r) => r.ref)).toContain(line.ref);
    // Case and accents are folded: "ÉLECTRIQUE" finds "électrique", "cable" finds "Câble".
    const folded = word.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
    expect(filterBomLines(its, { q: folded }, fr).map((r) => r.ref)).toContain(line.ref);
    expect(filterBomLines([{ ...line, name: 'Câble blindé' }], { q: 'cable blinde' }).length).toBe(1);
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
  it('rows: depth, quantity, extended, roll-up at the E-2a price (R-103), extended cost', () => {
    const rows = assemblyRows(root, e2aHlt);
    expect(rows.map((r) => ({ ref: r.ref, pad: `${r.depth * 18 + 6}px`, has: r.hasChildren, qty: r.qty, ext: n(r.extended), unit: $(r.unitCostEur), total: $(r.extendedCostEur) })))
      .toEqual(EN.tree.map((r: any) => ({ ref: r.ref, pad: r.pad, has: r.has, qty: r.qty, ext: r.ext, unit: r.unit, total: r.total })));
    // E-2a: the ordered leaves of HLT-026 are valued at their order price — €720,396 a crane (€713,996 at last purchase price).
    expect([$(rollupCost(root, e2aHlt)), $(rollupCost(root, e2aHlt) * root.q)]).toEqual(['€720,396', '€1,440,792']);
    expect($(rollupCost(root, lastPrice))).toBe('€713,996');
  });

  it('folding hides the whole subtree of a folded assembly', () => {
    const rows = visibleAssemblyRows(assemblyRows(root, e2aHlt), new Set(['ASM-STR-100', 'ASM-DRV-700']));
    expect(rows.map((r) => r.ref)).toEqual(EN.treeFolded.map((r: any) => r.ref));
  });

  it('node drawer: components, costed roll-up (delta, per project), used-in paths', () => {
    const ordered = orderedRefs('HLT-026');
    for (const r of assemblyRows(root, e2aHlt)) {
      const g = EN.nodes[r.ref];
      const part = byRef.get(r.ref);
      const c = nodeCost(root, r.ref, part.price, e2aHlt)!;
      expect(g.ident[5].v).toBe(r.hasChildren ? `${r.leafCount} parts · ${r.childCount} direct children` : 'Leaf part');
      // E-2a (R-103): "Rolled-up cost" and its price basis.
      const basis = r.hasChildren ? 'Roll-up of components' : ordered.has(r.ref) ? 'Ordered price' : PROTO.LAST_PRICE[r.ref] != null ? 'Last purchase price' : 'Catalogue price';
      expect(g.cost.map((x: any) => [x.k, x.v, x.color])).toEqual([
        ['Rolled-up cost', $(c.unitCostEur), 'var(--color-text)'], ['Price basis', basis, 'var(--color-text)'], ['List / standard price', $(c.listPriceEur), 'var(--color-text)'],
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
    // R-169 (A-12): the fallback part is the project's part used by the most projects (EL-TRF-2MVA on HLT-026) instead of
    // the prototype's constant CR-BRG-SKF; the fallback cases are compared with the prototype's values for that part.
    const fallback = defaultWhereUsedRef(P.map((p) => ({ ref: p.ref, usage: Object.keys(p.usage ?? {}).map((k) => ({ projectCode: k })) })), 'HLT');
    expect(fallback).toBe('EL-TRF-2MVA');
    for (const [q, g0] of Object.entries(EN.used as Record<string, any>)) {
      const g = g0.ref === 'CR-BRG-SKF' && q !== 'CR-BRG-SKF' ? EN.used['EL-TRF-2MVA'] : g0;
      const part = resolvePartQuery(P, q === '(default)' ? '' : q, fallback)!;
      expect(part.ref, q).toBe(g.ref);
      const paths = assemblyPaths(root, part.ref).map((p) => ({ chain: p.slice(0, -1).map((x) => `${x.ref} ×${x.q}`).join('  ›  '), qty: `${n(pathQuantity(p))} per project`, leaf: part.ref }));
      expect(paths, q).toEqual(g.rows);
    }
  });

  // E-2b (R-104): a substitution costs new qty × new price − old qty × old price (both E-2a); the golden is regenerated with the
  // E-2b patch (scripts/proto-e2b.ts): EL-HMI-10 → EL-HMI-15 "—" → "+€750", FD-DET-OPT → FD-DET-OPT2 "—" → "+€12", total +€19,942.
  it('compare revisions: old and new part of a line, E-2b deltas at the E-2a prices (R-103, R-104), "+€19,942 per crane"', () => {
    const rd = PROTO.REV_DIFF[root.ref];
    const toN = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
    const price = (ref: string) => (byRef.has(ref) ? e2aHlt(ref) : null);
    const deltas = rd.rows.map(([path, , a, b]: string[]) => diffCostDelta(toN(a), toN(b), price(diffNewRef(path)), price(diffOldRef(path))));
    expect(deltas.map((d: number) => (d ? (d > 0 ? '+' : '−') + $(Math.abs(d)) : '—'))).toEqual(EN.compare.cmp.rows.map((r: any) => r.delta));
    const t = deltas.reduce((s: number, d: number) => s + d, 0);
    expect(`${t >= 0 ? '+' : '−'}${$(Math.abs(t))} per crane`).toBe(EN.compare.cmp.total);
    expect(diffNewRef('ASM-DRV-700 / EL-HMI-10 → EL-HMI-15')).toBe('EL-HMI-15');
    expect(diffOldRef('ASM-DRV-700 / EL-HMI-10 → EL-HMI-15')).toBe('EL-HMI-10');
    expect(diffOldRef('ASM-RMG-250 / EL-VFD-200')).toBe('EL-VFD-200');
  });

  it('E-2b cost delta: substitution, quantity and added lines; an unknown price keeps the quantity-only rule (R-104)', () => {
    expect(diffCostDelta(1, 1, 2950, 2200)).toBe(750); // substitution at equal quantity
    expect(diffCostDelta(2, 3, 3000, 2000)).toBe(5000); // substitution whose quantity changes too (default beyond E-2b)
    expect(diffCostDelta(2, 3, 13600, 13600)).toBe(13600); // quantity line: same part
    expect(diffCostDelta(null, 1, 860, 860)).toBe(860); // added line
    expect(diffCostDelta(1, 1, 2950, null)).toBe(0); // old price unknown: never the whole new price
    expect(diffCostDelta(2, 3, 100)).toBe(100); // no old price given: quantity-only rule
    expect(diffCostDelta(1, 2, null, 50)).toBe(0); // new price unknown
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
