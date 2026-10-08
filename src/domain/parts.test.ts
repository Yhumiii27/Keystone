// Golden values of the PLM catalogue and part record logic, reproduced from the prototype's own logic (design lines
// 4176–4304 run in node:vm by scripts/proto-golden-plm.ts on PARTS, renderValsEN, director): KPIs, filter options,
// filtered and sorted rows, the sort cycle, and the part record's Identification / Commercial & export rows for every
// part. Deliberate deviations are asserted explicitly (lead time "1 wk").
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import GOLDEN from '@/features/plm/plm.golden.json';
import { moneyEur } from '@/lib/format';
import { partMakeBuy, partStatus, partType } from '@/server/db/codes';
import {
  DEFAULT_PLM_SORT, clearPlmFilter, commercialLines, committedValueEur, diffChangeText, diffKindTone, diffLineRefs, hasPlmFilter, identificationLines,
  leadLongText, leadShortText, nextPlmSort, parentChains, parsePlmState, partStatusNote, partStatusTone, plmCountText, plmKpis, plmOptions, plmParams,
  plmRows, restrictionCell, revisionEventsOf, stockOnHandByRef, stockSummary, totalQuantity, usedCountText, wearSpareTone,
  type PartFacts, type PlmSortKey, type PlmState,
} from './parts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
const G = GOLDEN.en;

type ProtoPart = {
  ref: string; name: string; mb: string; type: string; price: number; mfr: string; mfrRef: string; equiv: string[]; hs: string; restr: string;
  status: string; rev: string; lead: number; usage: Record<string, number>; pu: string;
};
const SHORT_TO_CODE: Record<string, string> = { HLT: 'HLT-026', NDC: 'NDC-031', RCF: 'RCF-019', ERP: 'ERP-202', WSA: 'WSA-044', MSR: 'MSR-012' };

/** The prototype's PARTS as the seed stores them. */
const PARTS: PartFacts[] = (P.PARTS as ProtoPart[]).map((p) => ({
  ref: p.ref, name: p.name, makeBuy: partMakeBuy.code(p.mb), type: partType.code(p.type), status: partStatus.code(p.status), listPriceEur: p.price,
  manufacturer: p.mfr || null, manufacturerRef: p.mfrRef || null, hsCode: p.hs === 'n/a' ? null : p.hs, exportRestriction: p.restr === 'None' ? null : p.restr,
  revision: p.rev === '—' ? null : p.rev, leadWeeks: p.lead || null, wearSpare: p.pu === 'PU' || p.pu === 'PR' ? p.pu : null,
  usage: Object.entries(p.usage).filter(([, q]) => q > 0).map(([k, q]) => ({ projectCode: SHORT_TO_CODE[k], shortCode: k, quantity: q })),
}));
const BY_REF = new Map(PARTS.map((p) => [p.ref, p]));

const state = (s: Partial<PlmState['filter']> = {}, sort = DEFAULT_PLM_SORT): PlmState => ({ filter: { ...parsePlmState({}).filter, ...s }, sort });
const refs = (s: PlmState) => plmRows(PARTS, s).map((p) => p.ref);
const money = (v: number) => moneyEur(v, 'en');
const qty = (n: number) => n.toLocaleString('en-US');
/** The prototype's "1 wks" (corrected to "1 wk", 00 §7.16 spirit: singular). */
const leadFix = (s: string) => s.replace(/^1 wks$/, '1 wk');

describe('PLM catalogue (plmRows / plmKpis / plm*Opts 4267–4288)', () => {
  it('KPI tiles: 54 · 87% · 2 outdated in use · 13 export-restricted · 9 wks', () => {
    const k = plmKpis(PARTS);
    expect(k.map(({ label, value, sub }) => ({ label, value, sub }))).toEqual(G.default.kpis.map((x) => ({ label: x.label, value: String(x.value), sub: x.sub })));
    expect(k.map((x) => x.alert)).toEqual(G.default.kpis.map((x) => x.color === 'var(--color-accent-300)'));
  });

  it('filter options and their counts over the whole catalogue', () => {
    const o = plmOptions(PARTS);
    const lab = (xs: { label: string }[]) => xs.map((x) => x.label);
    expect(lab(o.types)).toEqual(G.default.typeOpts.map((x) => x.label));
    expect(o.types.map((x) => (x.value ? partType.label(x.value) : ''))).toEqual(G.default.typeOpts.map((x) => x.key));
    expect(lab(o.statuses)).toEqual(G.default.statusOpts.map((x) => x.label));
    expect(o.statuses.map((x) => (x.value ? partStatus.label(x.value) : ''))).toEqual(G.default.statusOpts.map((x) => x.key));
    expect(lab(o.pu)).toEqual(G.default.puOpts.map((x) => x.label));
    expect(o.pu.map((x) => x.value)).toEqual(G.default.puOpts.map((x) => x.key));
    expect(lab(o.mb)).toEqual(G.default.mbOpts.map((x) => x.label));
    expect(o.mb.map((x) => (x.value ? partMakeBuy.label(x.value) : ''))).toEqual(G.default.mbOpts.map((x) => x.key));
  });

  it('default rows (ref ascending), the count line and the row texts', () => {
    const rows = plmRows(PARTS, state());
    expect(rows.map((p) => p.ref)).toEqual(G.default.rows.map((r) => r.ref));
    expect(plmCountText(rows.length, PARTS.length)).toBe(G.default.count);
    expect(rows.map((p) => leadShortText(p.leadWeeks))).toEqual(G.default.rows.map((r) => leadFix(r.lead)));
    expect(rows.map((p) => usedCountText(p.usage.length))).toEqual(G.default.rows.map((r) => r.usedCount));
    expect(rows.map((p) => restrictionCell(p))).toEqual(G.default.rows.map((r) => r.restr));
    expect(rows.map((p) => money(p.listPriceEur))).toEqual(G.default.rows.map((r) => r.price));
    expect(rows.map((p) => `tag tag-${partStatusTone(p.status)}`)).toEqual(G.default.rows.map((r) => r.tagClass));
    expect(rows.map((p) => `tag tag-${wearSpareTone(p.wearSpare)}`)).toEqual(G.default.rows.map((r) => r.puClass));
    expect(rows.map((p) => p.wearSpare ?? '—')).toEqual(G.default.rows.map((r) => r.pu));
    expect(rows.map((p) => [p.manufacturer, p.manufacturerRef])).toEqual(G.default.rows.map((r) => [r.mfr, r.mfrRef]));
    // the only part with a one-week lead time is the deliberate "1 wk" fix
    expect(G.default.rows.filter((r) => r.lead === '1 wks').length).toBe(1);
  });

  it('each filter alone: type, status, PU/PR, make / buy, export-restricted, search', () => {
    for (const [label, expected] of Object.entries(G.filters.type)) expect(refs(state({ type: partType.code(label) })), label).toEqual(expected);
    for (const [label, expected] of Object.entries(G.filters.status)) expect(refs(state({ status: partStatus.code(label) })), label).toEqual(expected);
    for (const [pu, expected] of Object.entries(G.filters.pu)) expect(refs(state({ pu: pu as 'PU' | 'PR' | 'none' })), pu).toEqual(expected);
    for (const [label, expected] of Object.entries(G.filters.mb)) expect(refs(state({ mb: partMakeBuy.code(label) })), label).toEqual(expected);
    expect(refs(state({ restricted: true }))).toEqual(G.filters.restricted);
    for (const [q, expected] of Object.entries(G.filters.q)) expect(refs(state({ q })), q).toEqual(expected);
  });

  it('combined filters and the empty result', () => {
    const s = state({ type: 'electrical', status: 'validated', restricted: true, q: 'a' });
    const rows = plmRows(PARTS, s);
    expect(rows.map((p) => p.ref)).toEqual(G.filters.combined.rows.map((r) => r.ref));
    expect(plmCountText(rows.length, PARTS.length)).toBe(G.filters.combined.count);
    expect(hasPlmFilter(s.filter)).toBe(G.filters.combined.hasFilter);
    expect(plmCountText(plmRows(PARTS, state({ q: 'zzz' })).length, PARTS.length)).toBe(G.filters.empty.count);
    expect(hasPlmFilter(state().filter)).toBe(G.default.hasFilter);
    expect(clearPlmFilter({ ...s, sort: { key: 'price', dir: -1 } })).toEqual({ filter: state().filter, sort: { key: 'price', dir: -1 } });
  });

  it('sort cycle: a column starts ascending (price descending), a second click flips it; the rows follow', () => {
    for (const key of ['ref', 'name', 'type', 'price', 'status'] as PlmSortKey[]) {
      const g = G.sorts[key as keyof typeof G.sorts];
      const first = nextPlmSort(DEFAULT_PLM_SORT, key);
      expect([first.key, first.dir], key).toEqual([g.first.sort, g.first.dir]);
      expect(refs(state({}, first)), key).toEqual(g.first.rows);
      const second = nextPlmSort(first, key);
      expect([second.key, second.dir], key).toEqual([g.second.sort, g.second.dir]);
      expect(refs(state({}, second)), key).toEqual(g.second.rows);
    }
  });

  it('URL state round-trip; unknown values fall back to the defaults', () => {
    const s = parsePlmState({ q: 'abb', type: 'electrical', status: 'not_validated', pu: 'none', mb: 'purchased', restr: '1', sort: 'price', dir: 'desc' });
    expect(s).toEqual({ filter: { q: 'abb', type: 'electrical', status: 'not_validated', pu: 'none', mb: 'purchased', restricted: true }, sort: { key: 'price', dir: -1 } });
    expect(parsePlmState(plmParams(s))).toEqual(s);
    expect(plmParams(state())).toEqual({});
    expect(parsePlmState({ type: 'Electrical', status: 'Validated', pu: 'pu', mb: 'Manufactured', restr: 'true', sort: 'mfr', dir: 'up' })).toEqual(state());
  });
});

describe('part record (partVals 4293–4304)', () => {
  it('Identification and Commercial & export rows of every part (prototype money$, thousands, None / n/a)', () => {
    for (const p of PARTS) {
      const g = G.drawers[p.ref as keyof typeof G.drawers];
      expect(identificationLines(p).map((l) => ({ k: l.k, v: l.v })), p.ref).toEqual(g.ident.map((x) => ({ k: x.k, v: x.v === '1 weeks' ? '1 week' : x.v })));
      const comm = commercialLines(p, money, qty);
      expect(comm.map((l) => ({ k: l.k, v: l.v })), p.ref).toEqual(g.comm.map((x) => ({ k: x.k, v: x.v })));
      expect(comm.map((l) => l.alert), p.ref).toEqual(g.comm.map((x) => x.color === 'var(--color-accent-300)'));
      expect(partStatusNote(p.status) ?? '', p.ref).toBe(g.warn);
      expect(`tag tag-${partStatusTone(p.status)}`).toBe(g.tagClass);
    }
  });

  it('total quantity and committed value (list price × Σ usage)', () => {
    const vfd = BY_REF.get('EL-VFD-200')!;
    expect([totalQuantity(vfd), committedValueEur(vfd)]).toEqual([6, 85_200]);
    const pv = BY_REF.get('PV-MOD-550')!;
    expect([totalQuantity(pv), qty(totalQuantity(pv))]).toEqual([6200, '6,200']);
    const alt = BY_REF.get('KS-STL-0450B')!;
    expect([totalQuantity(alt), committedValueEur(alt)]).toEqual([0, 0]);
  });

  it('lead time texts, singular forms (the prototype wrote "1 wks" / "1 weeks" for KS-WLD-CONS)', () => {
    expect(G.drawers['KS-WLD-CONS'].ident.at(-1)!.v).toBe('1 weeks');
    expect([leadShortText(9), leadShortText(1), leadShortText(null), leadShortText(0)]).toEqual(['9 wks', '1 wk', '—', '—']);
    expect([leadLongText(9), leadLongText(1), leadLongText(null)]).toEqual(['9 weeks', '1 week', '—']);
    expect([usedCountText(0), usedCountText(1), usedCountText(3)]).toEqual(['—', '1 project', '3 projects']);
  });
});

describe('stock of a part (STOCK_BY_REF fixed, 09 OQ1)', () => {
  type StockRow = { ref: string; loc: string; onHand: number; reserved: number; min: number };
  const STOCK: StockRow[] = P.STOCK0;

  it('Σ on hand per reference across every location — the prototype always found 0', () => {
    const by = stockOnHandByRef(STOCK.map((s) => ({ ref: s.ref, onHand: s.onHand, reserved: s.reserved, minQty: s.min })));
    expect(by['CR-BRG-SKF']).toBe(16);
    expect(by['EL-CBL-XLPE']).toBe(60);
    expect(by['KS-STL-0450']).toBe(20);
    // The prototype's spare list (STOCK_BY_REF) shows "None in stock" for every line, CR-BRG-SKF included.
    expect(GOLDEN.en.drawers['CR-BRG-SKF']).toBeDefined();
  });

  it('summary of the positions of one part', () => {
    const rows = STOCK.filter((s) => s.ref === 'CR-BRG-SKF').map((s) => ({ onHand: s.onHand, reserved: s.reserved, minQty: s.min }));
    expect(stockSummary(rows)).toEqual({ locations: 2, onHand: 16, reserved: 4, available: 12, belowMin: 0 });
    expect(stockSummary([{ onHand: 3, reserved: 0, minQty: 8 }, { onHand: 0, reserved: 0, minQty: 0 }])).toMatchObject({ belowMin: 1, available: 3 });
    expect(stockSummary([])).toEqual({ locations: 0, onHand: 0, reserved: 0, available: 0, belowMin: 0 });
  });
});

describe('revisions (REV_DIFF 3427) and where-used in the structure (TREE 3421)', () => {
  type Diff = { from: string; to: string; date: string; eco: string; rows: [string, string, string, string, string][] };
  const DIFFS = Object.entries(P.REV_DIFF as Record<string, Diff>).map(([assemblyRef, d]) => ({
    assemblyRef, fromRevision: d.from, toRevision: d.to, date: '2026-09-12', ecoNumber: d.eco,
    lines: d.rows.map(([path, name, a, b, kind]) => ({ path, name, qtyFrom: a === '—' ? null : +a, qtyTo: b === '—' ? null : +b, kind: kind.toLowerCase() as 'quantity' | 'substitution' | 'added' })),
  }));

  it('the assembly compared lists every line; a component lists its own lines; others none', () => {
    const asm = revisionEventsOf('ASM-RMG-250', DIFFS);
    expect(asm).toHaveLength(1);
    expect(asm[0]).toMatchObject({ isAssembly: true, fromRevision: 'B', toRevision: 'C', ecoNumber: 'ECO-2026-014' });
    expect(asm[0].lines).toHaveLength(5);
    expect(revisionEventsOf('EL-VFD-200', DIFFS)[0].lines.map((l) => [l.kind, diffChangeText(l)])).toEqual([['quantity', '2 → 3']]);
    expect(revisionEventsOf('EL-HMI-10', DIFFS)[0].lines.map((l) => l.kind)).toEqual(['substitution']);
    expect(revisionEventsOf('EL-HMI-15', DIFFS)[0].lines.map((l) => l.name)).toEqual(['Operator HMI 10″ → 15″']);
    expect(revisionEventsOf('CTL-WIND-SN', DIFFS)[0].lines.map((l) => diffChangeText(l))).toEqual(['— → 1']);
    expect(revisionEventsOf('ASM-DRV-700', DIFFS)).toEqual([]);
    expect(revisionEventsOf('KS-STL-0450', DIFFS)).toEqual([]);
  });

  it('line refs and kind tones (cmpVals 4266)', () => {
    expect(diffLineRefs('ASM-DRV-700 / EL-HMI-10 → EL-HMI-15')).toEqual({ parent: 'ASM-DRV-700', from: 'EL-HMI-10', to: 'EL-HMI-15' });
    expect(diffLineRefs('ASM-STR-100 / KS-PLT-S355')).toEqual({ parent: 'ASM-STR-100', from: 'KS-PLT-S355', to: 'KS-PLT-S355' });
    expect([diffKindTone('added'), diffKindTone('substitution'), diffKindTone('quantity')]).toEqual(['accent', 'outline', 'neutral']);
  });

  it('assembly chains above a part (the BOM node drawer "Used in" paths)', () => {
    type Node = { ref: string; q: number; c?: Node[] };
    const links: { parent: string; child: string }[] = [];
    const walk = (n: Node) => (n.c ?? []).forEach((c) => (links.push({ parent: n.ref, child: c.ref }), walk(c)));
    walk(P.TREE as Node);
    expect(parentChains('EL-VFD-200', links)).toEqual([['ASM-RMG-250', 'ASM-ELE-600', 'ASM-DRV-700']]);
    expect(parentChains('ASM-RMG-250', links)).toEqual([]);
    expect(parentChains('CR-BRG-SKF', links).map((c) => c.join(' › '))).toEqual(['ASM-RMG-250 › ASM-STR-100 › ASM-BOG-300']);
    expect(parentChains('NOPE', links)).toEqual([]);
  });
});
