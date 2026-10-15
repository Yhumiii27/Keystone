// Golden values reproduced from the prototype's own logic (design lines 4469–4492 run in node:vm by
// scripts/proto-golden-stock.ts → src/features/stock/stock.golden.json, renderValsEN, director, HLT-026): KPI figures,
// location chips, filters, row cells, drawer labels, every operation of `applyOp` (one by one and as a sequence) and
// `importX3`. The rules the rebuild settles differently (08 OQ13–16, SC-5) are asserted explicitly.
import { describe, expect, it } from 'vitest';
import { money, moneyEur } from '@/lib/format';
import { stampText, stockMoveInstant, stockMovementType, stockOperation, type LocationType, locationType } from '@/server/db/codes';
import PROTO from '@/server/prototype/prototype-data.json';
import GOLDEN from '@/features/stock/stock.golden.json';
import {
  PROTOTYPE_STOCK_OPS, STOCK_OPS, availableQty, filterStockLines, isActivityCode, isBelowMin, lineStockOps, lineValueEur, locationChipCounts, locationShortLabel,
  matchesStockQuery, movementValueEur, parseLocationFilter, parseMovementInput, pinnedText, planStockMovement, planX3Import, quantityLabel, reservedForOthers,
  reservedText, scrapWarningText, stockBadge, stockFigures, transferTargetOptions, type MovementRequest, type StockLineFacts, type X3PositionState,
} from './stock';

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = PROTO as any;
const G = GOLDEN as any;
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';

const LOCS: [string, string][] = P.SETTINGS0.locations;
const LOC_NAMES = LOCS.map((l) => l[0]);
const typeOf = (loc: string) => locationType.code(LOCS.find((l) => l[0] === loc)![1]) as LocationType;
const part = (ref: string) => P.PARTS.find((p: any) => p.ref === ref);
const unitCost = (ref: string) => P.LAST_PRICE[ref] ?? part(ref).price;
const CODE: Record<string, string> = { HLT: 'HLT-026', MSR: 'MSR-012', NDC: 'NDC-031' };
const SHORT = Object.fromEntries(Object.entries(CODE).map(([s, c]) => [c, s]));
const n = (v: number) => v.toLocaleString('en-US');

/** A mutable stock model (STOCK0 + Keystone movements), the shape the data layer stores. */
interface Line { ref: string; loc: string; onHand: number; reserved: number; reservedFor: string | null; min: number; source: 'x3' | 'local'; last: string }
const seed = (): Line[] =>
  (P.STOCK0 as any[]).map((r) => ({ ref: r.ref, loc: r.loc, onHand: r.onHand, reserved: r.reserved, reservedFor: r.proj ? CODE[r.proj] : null, min: r.min, source: r.source === 'X3' ? 'x3' : 'local', last: r.last }));
const facts = (l: Line): StockLineFacts => ({
  ref: l.ref, name: part(l.ref).name, location: l.loc, locationType: typeOf(l.loc), onHand: l.onHand, reserved: l.reserved, minQty: l.min, unitCostEur: unitCost(l.ref), source: l.source,
});

/** Applies one movement to the model as the data layer does; returns the move row (MOVES0 shape) or the refusal. */
function apply(stock: Line[], moves: any[], row: number, req: MovementRequest, who = 'Marie Lefebvre'): string | null {
  const l = stock[row];
  const dest = req.op === 'transfer' ? stock.find((x) => x.ref === l.ref && x.loc === req.target) : undefined;
  const r = planStockMovement(
    { location: l.loc, onHand: l.onHand, reserved: l.reserved, reservedFor: l.reservedFor },
    { ...req, targetReservedFor: dest && dest.reserved > 0 ? dest.reservedFor : null },
    LOC_NAMES,
  );
  if (!r.ok) return r.error;
  const p = r.value;
  Object.assign(l, { onHand: p.onHand, reserved: p.reserved, reservedFor: p.reservedFor, source: 'local', last: '25 Sep' });
  if (p.transferTo) {
    let t = stock.find((x) => x.ref === l.ref && x.loc === p.transferTo);
    if (!t) stock.push((t = { ref: l.ref, loc: p.transferTo, onHand: 0, reserved: 0, reservedFor: null, min: 0, source: 'local', last: '25 Sep' }));
    Object.assign(t, { onHand: t.onHand + p.qty, reserved: t.reserved + p.transferReserved, reservedFor: p.transferReserved ? p.transferReservedFor : t.reservedFor, source: 'local', last: '25 Sep' });
  }
  moves.unshift({ when: stampText(stockMoveInstant(moves.length)), type: stockMovementType.label(p.type), ref: l.ref, qty: p.qty, where: p.whereText, who });
  return null;
}
const moves0 = () => (P.MOVES0 as any[]).map(([when, type, ref, qty, where, who]) => ({ when, type, ref, qty, where, who }));
const HLT = { code: 'HLT-026', short: 'HLT' };
/**
 * SC-5a = a (Delivery 7, R-098): an issue names its activity. The prototype's issues read "→ HLT activity"; the same
 * issues named to A1250 read "→ A1250 Steel erection" — every other value of the golden is unchanged.
 */
const ACT = { code: 'A1250', name: 'Steel erection' };
const withAct = (g: any): any => JSON.parse(JSON.stringify(g).replaceAll(' → HLT activity', ' → A1250 Steel erection'));

/** Row cells as the prototype renders them (stockRows), from the model. */
const cells = (l: Line) => ({
  ref: l.ref, onHand: n(l.onHand), reserved: reservedText(l.reserved, l.reservedFor ? SHORT[l.reservedFor] : null, n), avail: n(availableQty(l)),
  source: l.source === 'x3' ? 'X3' : 'Local',
});
const goldenCells = (rows: any[]) => rows.map((r) => ({ ref: r.ref, onHand: r.onHand, reserved: r.reserved, avail: r.avail, source: r.source }));

describe('stock lines, KPIs, chips and filters (stockRows / stockKpis / stockLocChips 4471–4477)', () => {
  const stock = seed();
  const lines = stock.map(facts);

  it('KPI figures reproduce stockKpis (value, below min, quarantine, X3 lines, local changes)', () => {
    const f = stockFigures(lines, LOC_NAMES.length);
    expect([
      [money(f.valueEur / 1000, 'en'), `${f.lines} lines · ${f.locations} locations`, f.belowMin ? LO : OK],
      [f.belowMin, 'Reorder or transfer'],
      [f.quarantineQty, 'Awaiting quality decision'],
      ['07:15', `Today · ${f.x3Lines} lines from Sage X3`],
      [f.localLines, 'To push back to X3', f.localLines ? LO : OK],
    ]).toEqual([
      [G.en.kpis[0].value, G.en.kpis[0].sub, G.en.kpis[1].color],
      [G.en.kpis[1].value, G.en.kpis[1].sub],
      [G.en.kpis[2].value, G.en.kpis[2].sub],
      [G.en.kpis[3].value, G.en.kpis[3].sub],
      [G.en.kpis[4].value, G.en.kpis[4].sub, G.en.kpis[4].color],
    ]);
    expect(money(f.valueEur / 1000, 'fr')).toBe(G.fr.kpis[0].value);
    expect(stockBadge(lines)).toBe('1');
    expect(stockBadge([])).toBe('');
  });

  it('row cells reproduce stockRows (available, min, below-min warning, value)', () => {
    expect(lines.map((l, i) => ({
      ref: l.ref, name: l.name, loc: l.location, locType: locationType.label(l.locationType), onHand: n(l.onHand),
      reserved: reservedText(l.reserved, stock[i].reservedFor ? SHORT[stock[i].reservedFor!] : null, n), avail: n(availableQty(l)), availColor: availableQty(l) < 0 ? LO : OK,
      min: l.minQty ? String(l.minQty) : '—', below: isBelowMin(l), value: moneyEur(lineValueEur(l), 'en'), source: l.source === 'x3' ? 'X3' : 'Local',
      srcClass: l.source === 'x3' ? 'tag tag-neutral' : 'tag tag-accent',
    }))).toEqual(G.en.rows.map((r: any) => ({ ...pick(r, ['ref', 'name', 'loc', 'locType', 'onHand', 'reserved', 'avail', 'availColor', 'min', 'value', 'source', 'srcClass']), below: !!r.below })));
    expect(lines.map((l) => moneyEur(lineValueEur(l), 'fr'))).toEqual(G.fr.rows.map((r: any) => r.value));
  });

  it('location chips: All locations then each configured location with its line count', () => {
    expect(locationChipCounts(lines, LOC_NAMES).map((c) => [c.location ?? 'All locations', String(c.count)])).toEqual(G.en.chips.map((c: any) => [c.label, c.count]));
  });

  it('location chip and search filters reproduce the prototype rows', () => {
    const idx = (xs: StockLineFacts[]) => xs.map((x) => lines.indexOf(x));
    for (const loc of LOC_NAMES) expect(idx(filterStockLines(lines, { location: loc, q: '' }))).toEqual(G.en.byLocation[loc].rows);
    for (const [q, rows] of Object.entries(G.en.search)) expect(idx(filterStockLines(lines, { location: null, q }))).toEqual(rows);
    expect(idx(filterStockLines(lines, { location: 'Entrepôt central — Lyon', q: 'fd' }))).toEqual(G.en.searchInLocation);
    expect(filterStockLines(lines, { location: null, q: 'zzz' })).toEqual([]);
    expect(matchesStockQuery(lines[0], '   ')).toBe(true);
    expect(parseLocationFilter('Zone quarantaine QC — Lyon', LOC_NAMES)).toBe('Zone quarantaine QC — Lyon');
    expect(parseLocationFilter('Magasin chantier — Lyon', LOC_NAMES)).toBeNull();
    expect(parseLocationFilter(undefined, LOC_NAMES)).toBeNull();
  });
});

describe('stock-line drawer (stockSel 4488–4490)', () => {
  it('operation labels, quantity label per operation, reserved text', () => {
    expect(PROTOTYPE_STOCK_OPS.map((o) => stockOperation.label(o))).toEqual(G.en.drawerOps.adjust.opSeg.map((o: any) => o.label));
    for (const op of PROTOTYPE_STOCK_OPS) expect(quantityLabel(op)).toBe(G.en.drawerOps[op].qtyLabel);
    // R-099 (NEW-D4-2 / SC-5b): "Release reservation" after "Reserve for project", offered on a reserved line only.
    expect(STOCK_OPS.map((o) => stockOperation.label(o))).toEqual(['Adjust (count)', 'Transfer', 'Reserve for project', 'Release reservation', 'Issue to activity', 'Return to stock', 'Scrap / rework']);
    expect(lineStockOps(0)).toEqual(PROTOTYPE_STOCK_OPS);
    expect(lineStockOps(4)).toEqual(STOCK_OPS);
    expect(quantityLabel('release')).toBe('Quantity');
    expect(reservedText(4, 'HLT')).toBe('4 · HLT');
    expect(reservedText(0, 'HLT')).toBe('—');
  });

  it('transfer destinations: every other configured location; shared short names are written in full (08 OQ16)', () => {
    const stock = seed();
    for (const [i, l] of stock.entries()) {
      const opts = transferTargetOptions(LOC_NAMES, l.loc);
      expect(opts.map((o) => locationShortLabel(o.name))).toEqual(G.en.drawers[String(i)].targets.map((t: any) => t.label));
      // Deliberate: both site stores are named in full instead of "Magasin chantier" twice.
      expect(opts.map((o) => o.label)).toEqual(opts.map((o) => (o.name.startsWith('Magasin chantier') ? o.name : locationShortLabel(o.name))));
    }
  });

  it('installed-base pin texts and the scrap warning (pinnedText 4199)', () => {
    const pin = pinnedText({ machines: 1, ecos: ['ECO-2026-015'] });
    expect(G.en.rows.filter((r: any) => r.pinned).map((r: any) => [r.ref, r.pinnedText])).toEqual([
      ['FD-DET-OPT', pin],
      ['FD-DET-OPT2', pinnedText({ machines: 2, ecos: ['ECO-2026-014', 'ECO-2026-015'] })],
    ]);
    expect(scrapWarningText(pin)).toBe(G.en.drawerOps.scrap.scrapWarnText);
    expect(G.en.drawerOps.scrap.scrapWarn).toBe(true);
    expect(pinnedText({ machines: 2, ecos: ['ECO-2026-015', 'ECO-2026-016'] })).toBe('Keep for the installed base · 2 machines · ECO-2026-015, ECO-2026-016');
    expect(pinnedText(null)).toBe('');
  });
});

describe('movements (applyOp 4479–4487)', () => {
  const run = (ops: [number, MovementRequest][]) => {
    const stock = seed();
    const moves = moves0();
    for (const [row, req] of ops) expect(apply(stock, moves, row, req)).toBeNull();
    return { stock, moves };
  };
  const check = (g: any, r: { stock: Line[]; moves: any[] }) => {
    expect(r.stock.map(cells)).toEqual(goldenCells(g.rows));
    expect(r.moves.slice(0, 8)).toEqual(g.moves); // the card lists 8
    const f = stockFigures(r.stock.map(facts), LOC_NAMES.length);
    expect([money(f.valueEur / 1000, 'en'), f.belowMin, f.quarantineQty, f.localLines]).toEqual([g.kpis[0].value, g.kpis[1].value, g.kpis[2].value, g.kpis[4].value]);
  };

  it('each operation reproduces the prototype (line, move row, KPIs)', () => {
    check(G.ops.adjust, run([[0, { op: 'adjust', qty: 5 }]]));
    check(G.ops.transferExisting, run([[4, { op: 'transfer', qty: 3, target: 'Atelier mécanique — Lyon' }]]));
    check(G.ops.transferNew, run([[9, { op: 'transfer', qty: 20, target: 'Magasin chantier — Le Havre' }]]));
    check(G.ops.reserve, run([[9, { op: 'reserve', qty: 30, project: HLT }]]));
    check(withAct(G.ops.issue), run([[6, { op: 'issue', qty: 10, project: HLT, activity: ACT }]]));
    check(G.ops.return, run([[7, { op: 'return', qty: 5, project: HLT }]]));
    check(G.ops.scrap, run([[10, { op: 'scrap', qty: 5 }]]));
  });

  it('a sequence of six movements (stamps 16:15 → 16:20, the viewer as author)', () => {
    check(withAct(G.ops.sequence), run([
      [0, { op: 'adjust', qty: 7 }], [4, { op: 'transfer', qty: 2, target: 'Magasin chantier — Marseille' }], [6, { op: 'reserve', qty: 4, project: HLT }],
      [6, { op: 'issue', qty: 6, project: HLT, activity: ACT }], [17, { op: 'return', qty: 3, project: HLT }], [12, { op: 'scrap', qty: 1 }],
    ]));
  });

  it('the reservation project follows the current project (PM on NDC-031: "· NDC")', () => {
    const stock = seed();
    const moves = moves0();
    expect(apply(stock, moves, 9, { op: 'reserve', qty: 5, project: { code: 'NDC-031', short: 'NDC' } }, 'Romain Aubert')).toBeNull();
    expect(moves.slice(0, 8)).toEqual(G.ops.pmOnNdc.moves);
    expect(stock.map(cells)).toEqual(goldenCells(G.ops.pmOnNdc.rows));
  });

  it('an issue to a named activity records it ("→ A1250 Steel erection", as the X3 seed movement)', () => {
    const r = planStockMovement({ location: 'Magasin chantier — Le Havre', onHand: 14, reserved: 14, reservedFor: 'HLT-026' }, { op: 'issue', qty: 6, project: HLT, activity: { code: 'A1250', name: 'Steel erection' } }, LOC_NAMES);
    expect(r.ok && [r.value.whereText, r.value.onHand, r.value.reserved, r.value.reservedFor]).toEqual([P.MOVES0[2][4], 8, 8, 'HLT-026']);
  });

  describe('rules the rebuild settles (08 OQ13–14, SC-5)', () => {
    it('a count to 0 is recorded (the prototype ignored it) and releases the reservation', () => {
      expect(G.ops.adjustZero.moves).toEqual(moves0()); // prototype: nothing happens
      const { stock, moves } = run([[0, { op: 'adjust', qty: 0 }]]);
      expect([stock[0].onHand, stock[0].reserved, stock[0].reservedFor, moves[0].where]).toEqual([0, 0, null, 'Entrepôt central — Lyon · counted']);
    });

    it('no movement takes more than the quantity on hand (the prototype went to −3)', () => {
      expect(G.ops.issueBeyondOnHand.rows[0].onHand).toBe('-3');
      const stock = seed();
      expect(apply(stock, [], 0, { op: 'issue', qty: 9, project: HLT, activity: ACT })).toBe('Only 6 on hand at Entrepôt central — Lyon');
      expect(apply(stock, [], 0, { op: 'scrap', qty: 7 })).toBe('Only 6 on hand at Entrepôt central — Lyon');
      expect(apply(stock, [], 0, { op: 'transfer', qty: 7, target: 'Atelier mécanique — Lyon' })).toBe('Only 6 on hand at Entrepôt central — Lyon');
      expect(apply(stock, [], 0, { op: 'reserve', qty: 3, project: HLT })).toBe('Only 2 available at Entrepôt central — Lyon');
      expect(apply(stock, [], 0, { op: 'issue', qty: 6, project: HLT, activity: ACT })).toBeNull();
      expect([stock[0].onHand, stock[0].reserved, stock[0].reservedFor]).toEqual([0, 0, null]);
    });

    it('a reservation belongs to one project (the prototype re-labelled MSR’s 120 as HLT)', () => {
      expect(G.ops.reserveOtherProject.rows[13].reserved).toBe('125 · HLT');
      expect(apply(seed(), [], 13, { op: 'reserve', qty: 5, project: HLT })).toBe('This line is already reserved for another project');
      const stock = seed();
      expect(apply(stock, [], 13, { op: 'reserve', qty: 5, project: { code: 'MSR-012', short: 'MSR' } })).toBeNull();
      expect(cells(stock[13]).reserved).toBe('125 · MSR');
    });

    it('an issue never takes another project’s reservation (the prototype took MSR’s for HLT) — R-099, NEW-D4-2 / SC-5b', () => {
      expect(G.ops.issueOtherProject.rows[13].reserved).toBe('110 · MSR');
      const stock = seed();
      // SG-BRK-SS2 140 on hand, 120 reserved for MSR: HLT may take the 20 free units only.
      expect(apply(stock, [], 13, { op: 'issue', qty: 10, project: HLT, activity: ACT })).toBeNull();
      expect([stock[13].onHand, cells(stock[13]).reserved]).toEqual([130, '120 · MSR']);
      expect(apply(stock, [], 13, { op: 'issue', qty: 11, project: HLT, activity: ACT })).toBe('120 reserved for MSR-012 — its project manager must release them first');
      expect(apply(stock, [], 13, { op: 'scrap', qty: 11 })).toBe('120 reserved for MSR-012 — its project manager must release them first');
      expect(apply(stock, [], 13, { op: 'issue', qty: 10, project: HLT, activity: ACT })).toBeNull();
      expect([stock[13].onHand, cells(stock[13]).reserved]).toEqual([120, '120 · MSR']);
      // The director's override takes reserved units: MSR's reservation drops by what is taken (recorded in the plan).
      const pos = { location: 'Atelier mécanique — Lyon', onHand: 120, reserved: 120, reservedFor: 'MSR-012' };
      const r = planStockMovement(pos, { op: 'issue', qty: 110, project: HLT, activity: ACT, override: true }, LOC_NAMES);
      expect(r.ok && [r.value.onHand, r.value.reserved, r.value.reservedFor, r.value.overrideTaken, r.value.overrideFrom]).toEqual([10, 10, 'MSR-012', 110, 'MSR-012']);
      const sc = planStockMovement(pos, { op: 'scrap', qty: 120, override: true }, LOC_NAMES);
      expect(sc.ok && [sc.value.onHand, sc.value.reserved, sc.value.reservedFor, sc.value.overrideTaken]).toEqual([0, 0, null, 120]);
      // The reserving project's own issue consumes its reservation (MSR on its line), no override needed.
      const own = planStockMovement(pos, { op: 'issue', qty: 30, project: { code: 'MSR-012', short: 'MSR' }, activity: ACT }, LOC_NAMES);
      expect(own.ok && [own.value.onHand, own.value.reserved, own.value.overrideTaken]).toEqual([90, 90, 0]);
    });

    it('an issue names its activity (SC-5a, R-098); a return may credit one', () => {
      const pos = { location: 'Entrepôt central — Lyon', onHand: 6, reserved: 4, reservedFor: 'HLT-026' };
      expect(planStockMovement(pos, { op: 'issue', qty: 1, project: HLT }, LOC_NAMES)).toEqual({ ok: false, error: 'Choose the activity the parts are issued to' });
      const r = planStockMovement(pos, { op: 'issue', qty: 2, project: HLT, activity: ACT }, LOC_NAMES);
      expect(r.ok && [r.value.whereText, r.value.onHand, r.value.reserved, r.value.projectCode, r.value.overrideTaken]).toEqual(['Entrepôt central — Lyon → A1250 Steel erection', 4, 2, 'HLT-026', 0]);
      const back = planStockMovement(pos, { op: 'return', qty: 2, project: HLT, activity: ACT }, LOC_NAMES);
      expect(back.ok && [back.value.whereText, back.value.onHand]).toEqual(['HLT A1250 → Entrepôt central — Lyon', 8]);
      expect(movementValueEur(6, 412.5)).toBe(2475);
      expect(movementValueEur(3, 0.333)).toBe(1);
      expect(movementValueEur(7, 1.115)).toBe(7.81);
      expect([isActivityCode('A1250'), isActivityCode('WP-1.4_a'), isActivityCode(''), isActivityCode('A 1'), isActivityCode('x'.repeat(41)), isActivityCode(12)]).toEqual([true, true, false, false, false, false]);
    });

    it('"Release reservation" gives units back to the free stock — the reserving project only (R-099)', () => {
      const pos = { location: 'Atelier mécanique — Lyon', onHand: 140, reserved: 120, reservedFor: 'MSR-012' };
      const MSR = { code: 'MSR-012', short: 'MSR' };
      const r = planStockMovement(pos, { op: 'release', qty: 50, project: MSR }, LOC_NAMES);
      expect(r.ok && [r.value.onHand, r.value.reserved, r.value.reservedFor, r.value.projectCode, r.value.whereText]).toEqual([140, 70, 'MSR-012', 'MSR-012', 'Atelier mécanique — Lyon · MSR released']);
      const all = planStockMovement(pos, { op: 'release', qty: 120, project: MSR }, LOC_NAMES);
      expect(all.ok && [all.value.reserved, all.value.reservedFor]).toEqual([0, null]);
      expect(planStockMovement(pos, { op: 'release', qty: 121, project: MSR }, LOC_NAMES)).toEqual({ ok: false, error: 'Only 120 reserved at Atelier mécanique — Lyon' });
      expect(planStockMovement(pos, { op: 'release', qty: 1, project: HLT }, LOC_NAMES)).toEqual({ ok: false, error: 'This line holds no reservation for this project' });
      expect(planStockMovement(pos, { op: 'release', qty: 1 }, LOC_NAMES)).toEqual({ ok: false, error: 'A project is required' });
      expect(planStockMovement({ ...pos, reserved: 0, reservedFor: null }, { op: 'release', qty: 1, project: MSR }, LOC_NAMES)).toEqual({ ok: false, error: 'This line holds no reservation for this project' });
    });

    it('units held for another project: none for its own project or an unowned (X3) reservation', () => {
      expect(reservedForOthers({ reserved: 120, reservedFor: 'MSR-012' }, 'HLT-026')).toBe(120);
      expect(reservedForOthers({ reserved: 120, reservedFor: 'MSR-012' }, 'MSR-012')).toBe(0);
      expect(reservedForOthers({ reserved: 120, reservedFor: 'MSR-012' }, null)).toBe(120);
      expect(reservedForOthers({ reserved: 5, reservedFor: null }, null)).toBe(0);
      expect(reservedForOthers({ reserved: 0, reservedFor: 'MSR-012' }, 'HLT-026')).toBe(0);
    });

    it('a transfer needs another configured destination (the prototype silently did nothing)', () => {
      expect(G.ops.transferNoTarget.moves).toEqual(moves0());
      expect(G.ops.transferSameLocation.moves).toEqual(moves0());
      const stock = seed();
      expect(apply(stock, [], 0, { op: 'transfer', qty: 2 })).toBe('Choose a destination');
      expect(apply(stock, [], 0, { op: 'transfer', qty: 2, target: 'Entrepôt central — Lyon' })).toBe('The destination is the current location');
      expect(apply(stock, [], 0, { op: 'transfer', qty: 2, target: 'Magasin chantier — Lyon' })).toBe('Choose a destination');
    });

    it('a transfer of reserved goods moves their reservation (the prototype left it behind: available −6 / −4)', () => {
      // KS-STL-0450 Le Havre 14 / 14 HLT: 6 to the central warehouse (6 / 4 HLT).
      const g = G.ops.transferReserved;
      expect([g.rows[1].reserved, g.rows[1].avail, g.rows[0].reserved]).toEqual(['14 · HLT', '-6', '4 · HLT']);
      const { stock, moves } = run([[1, { op: 'transfer', qty: 6, target: 'Entrepôt central — Lyon' }]]);
      expect([cells(stock[1]), cells(stock[0])]).toEqual([
        { ref: 'KS-STL-0450', onHand: '8', reserved: '8 · HLT', avail: '0', source: 'Local' },
        { ref: 'KS-STL-0450', onHand: '12', reserved: '10 · HLT', avail: '2', source: 'Local' },
      ]);
      expect(moves.slice(0, 8)).toEqual(g.moves);
      // EL-CBL-XLPE central 40 / 24 HLT (16 free): 20 to the consignment stock — only the 4 reserved ones carry it.
      const h = G.ops.transferPartlyReserved;
      expect([h.rows[6].reserved, h.rows[6].avail, h.rows[7].reserved]).toEqual(['24 · HLT', '-4', '—']);
      const two = run([[6, { op: 'transfer', qty: 20, target: 'Consignation — Nordvolt' }]]);
      expect([cells(two.stock[6]), cells(two.stock[7])]).toEqual([
        { ref: 'EL-CBL-XLPE', onHand: '20', reserved: '20 · HLT', avail: '0', source: 'Local' },
        { ref: 'EL-CBL-XLPE', onHand: '40', reserved: '4 · HLT', avail: '36', source: 'Local' },
      ]);
      expect(two.moves.slice(0, 8)).toEqual(h.moves);
      // A carried reservation never mixes two projects; free goods may go anywhere.
      const pos = { location: 'Entrepôt central — Lyon', onHand: 40, reserved: 24, reservedFor: 'HLT-026' };
      const req = { op: 'transfer' as const, target: 'Consignation — Nordvolt', targetReservedFor: 'NDC-031' };
      expect(planStockMovement(pos, { ...req, qty: 17 }, LOC_NAMES)).toEqual({ ok: false, error: 'The destination is reserved for another project' });
      const free = planStockMovement(pos, { ...req, qty: 16 }, LOC_NAMES);
      expect(free.ok && [free.value.onHand, free.value.reserved, free.value.transferReserved, free.value.transferReservedFor]).toEqual([24, 24, 0, null]);
      const same = planStockMovement(pos, { ...req, qty: 40, targetReservedFor: 'HLT-026' }, LOC_NAMES);
      expect(same.ok && [same.value.onHand, same.value.reserved, same.value.reservedFor, same.value.transferReserved, same.value.transferReservedFor]).toEqual([0, 0, null, 24, 'HLT-026']);
    });

    it('reserve, issue and return need a project; quantities are whole and positive', () => {
      const pos = { location: 'Entrepôt central — Lyon', onHand: 6, reserved: 4, reservedFor: 'HLT-026' };
      for (const op of ['reserve', 'release', 'issue', 'return'] as const) expect(planStockMovement(pos, { op, qty: 1 }, LOC_NAMES)).toEqual({ ok: false, error: 'A project is required' });
      for (const qty of [0, -1, 1.5, Number.NaN]) expect(planStockMovement(pos, { op: 'scrap', qty }, LOC_NAMES)).toEqual({ ok: false, error: 'Invalid quantity' });
      expect(planStockMovement(pos, { op: 'adjust', qty: -1 }, LOC_NAMES)).toEqual({ ok: false, error: 'Invalid quantity' });
      expect(planStockMovement(pos, { op: 'melt' as never, qty: 1 }, LOC_NAMES)).toEqual({ ok: false, error: 'Invalid movement' });
      // A count below the reservation caps it.
      const r = planStockMovement(pos, { op: 'adjust', qty: 3 }, LOC_NAMES);
      expect(r.ok && [r.value.onHand, r.value.reserved, r.value.reservedFor, r.value.projectCode]).toEqual([3, 3, 'HLT-026', null]);
    });
  });

  it('parses the drawer input (digits only; 0 only for a count; a destination for a transfer)', () => {
    expect(parseMovementInput({ op: 'adjust', qty: '0' })).toEqual({ ok: true, value: { op: 'adjust', qty: 0, target: null } });
    expect(parseMovementInput({ op: 'issue', qty: ' 12 ', target: 'X' })).toEqual({ ok: true, value: { op: 'issue', qty: 12, target: null } });
    expect(parseMovementInput({ op: 'transfer', qty: '3', target: 'Atelier mécanique — Lyon' })).toEqual({ ok: true, value: { op: 'transfer', qty: 3, target: 'Atelier mécanique — Lyon' } });
    expect(parseMovementInput({ op: 'transfer', qty: '3', target: '' })).toEqual({ ok: false, error: 'Choose a destination' });
    expect(parseMovementInput({ op: 'scrap', qty: '0' })).toEqual({ ok: false, error: 'Enter a quantity above 0' });
    for (const qty of ['', '-2', '1.5', '1e3', 'abc', '12345678', null, {}]) expect(parseMovementInput({ op: 'scrap', qty })).toEqual({ ok: false, error: 'Enter a whole quantity' });
    expect(parseMovementInput({ op: 'drop', qty: '1' })).toEqual({ ok: false, error: 'Invalid movement' });
  });
});

describe('Import from X3 (importX3 4492, merged)', () => {
  const snapshot = (P.STOCK0 as any[]).map((r) => ({ ref: r.ref, location: r.loc, onHand: r.onHand, reserved: r.reserved, reservedFor: r.proj ? CODE[r.proj] : null, minQty: r.min, lastMovementOn: r.last }));
  const state = (stock: Line[], pushed: number[] = []): X3PositionState[] =>
    stock.map((l, i) => ({ id: String(i), ref: l.ref, location: l.loc, onHand: l.onHand, reserved: l.reserved, reservedFor: l.reservedFor, minQty: l.min, lastMovementOn: l.last, source: l.source, pushedFromKeystone: pushed.includes(i) }));

  it('X3 lines take the snapshot values, local lines are kept (the prototype discarded them)', () => {
    const stock = seed();
    expect(apply(stock, [], 0, { op: 'adjust', qty: 5 })).toBeNull();
    expect(apply(stock, [], 9, { op: 'reserve', qty: 30, project: HLT })).toBeNull();
    expect(stock.map(cells)).toEqual(goldenCells(G.importX3.before));
    // An X3 line that drifted from the snapshot is reset.
    stock[2].onHand = 170;
    const plan = planX3Import(state(stock), snapshot);
    expect(plan).toEqual({ update: [{ id: '2', line: snapshot[2] }], create: [], keptLocal: 5 });
    for (const u of plan.update) Object.assign(stock[Number(u.id)], { onHand: u.line.onHand, reserved: u.line.reserved, reservedFor: u.line.reservedFor });
    // Prototype: every line back to STOCK0 (rows 0 and 9 lose their changes) and the drawer closed.
    expect(goldenCells(G.importX3.after)).toEqual(seed().map(cells));
    expect(G.importX3.stockRowAfter).toBeNull();
    expect(G.importX3.moves.length).toBe(7);
    expect(stock.map(cells)).toEqual(goldenCells(G.importX3.after).map((c, i) => ([0, 9].includes(i) ? cells(stock[i]) : c)));
    expect([cells(stock[0]).onHand, cells(stock[9]).reserved]).toEqual(['5', '30 · HLT']);
  });

  it('a missing snapshot line is created; lines pushed by Keystone after the snapshot keep their values', () => {
    const stock = seed();
    const gone = stock.splice(17, 1);
    stock[1] = { ...stock[1], onHand: 10, source: 'x3' };
    const plan = planX3Import(state(stock, [1]), snapshot);
    expect(plan.create).toEqual([snapshot[17]]);
    expect(plan.update).toEqual([]);
    expect(gone[0].ref).toBe('MD-GAS-OUT');
  });
});

function pick(o: any, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
