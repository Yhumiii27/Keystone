// Generates src/features/stock/stock.golden.json: the prototype's own render values for the Stock & storages screen
// (docs/spec/08 §4, template 1658–1714, logic 4469–4492) in English (`renderValsEN`) and French (`renderVals`, i.e.
// `deepTr` over the English values), for the director on HLT-026: KPI tiles, location chips, stock rows, recent
// movements, location and search filters, the stock-line drawer of every row (per operation), and the effects of
// `applyOp` (each of the six operations, a sequence, edge cases) and of `importX3`.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own intrinsics (deepTr only
// walks plain objects of its own realm) and a minimal component base class.
//   npx tsx scripts/proto-golden-stock.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
const ctx: any = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  window: { addEventListener() {}, removeEventListener() {} },
  React: { createRef: () => ({ current: null }) },
};
vm.createContext(ctx);
vm.runInContext(
  `class DCLogic { constructor(p) { this.props = p || {}; } setState(p) { const u = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...u }; } }\n` +
    lines.slice(3095, 5239).join('\n') +
    '\n;globalThis.__C = Component; globalThis.__trFR = trFR;',
  ctx,
);

type Lang = 'en' | 'fr';
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'stock', ...state };
  return c;
}
const valsOf = (c: any, lang: Lang) => {
  c.state = { ...c.state, lang };
  return c.renderVals();
};
const render = (state: any, lang: Lang) => valsOf(make(state), lang);

const ROW_KEYS = ['i', 'ref', 'name', 'loc', 'locType', 'onHand', 'reserved', 'avail', 'availColor', 'min', 'below', 'value', 'source', 'srcClass', 'last', 'pinned', 'pinnedText', 'idColor'];
const rowsOf = (v: any) => plain(v.stockRows).map((r: any) => pick(r, ROW_KEYS));
const chipsOf = (v: any) => plain(v.stockLocChips).map((c: any) => pick(c, ['label', 'count', 'bg', 'border', 'color']));
const kpisOf = (v: any) => plain(v.stockKpis).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const segOf = (xs: any[]) => plain(xs).map((o: any) => pick(o, ['label', 'color', 'shadow', 'bl']));

function drawer(v: any) {
  const d = plain(v.stockSel);
  return {
    ref: d.ref, name: d.name, loc: d.loc, locType: d.locType, source: d.source, srcClass: d.srcClass, meta: d.meta,
    opSeg: segOf(v.stockSel.opSeg), needsTarget: d.needsTarget, targets: segOf(v.stockSel.targets), qtyLabel: d.qtyLabel,
    scrapWarn: d.scrapWarn, scrapWarnText: d.scrapWarnText, moves: d.moves,
  };
}

/** Screen state after a sequence of operations: [row, op, qty, target?] applied with `applyOp`. */
function after(ops: [number, string, string, string?][], extra: any = {}, lang: Lang = 'en') {
  const c = make(extra);
  for (const [row, op, qty, target] of ops) {
    c.setState({ stockRow: row, stockOp: op, stockQty: qty, stockTarget: target ?? null });
    valsOf(c, 'en').stockSel.apply();
  }
  const v = valsOf(c, lang);
  return { rows: rowsOf(v), moves: plain(v.moveRows), kpis: kpisOf(v), chips: chipsOf(v).map((x: any) => [x.label, x.count]) };
}

const LOCS = ['Entrepôt central — Lyon', 'Atelier mécanique — Lyon', 'Magasin chantier — Le Havre', 'Magasin chantier — Marseille', 'Consignation — Nordvolt', 'Zone quarantaine QC — Lyon'];
const OPS = ['adjust', 'transfer', 'reserve', 'issue', 'return', 'scrap'];

function build(lang: Lang) {
  const out: any = {};
  const v = render({}, lang);
  out.crumb = v.crumb;
  out.title = v.title;
  out.kpis = kpisOf(v);
  out.chips = chipsOf(v);
  out.rows = rowsOf(v);
  out.moves = plain(v.moveRows);
  out.noStock = v.noStock;
  out.byLocation = Object.fromEntries(LOCS.map((l) => [l, { rows: rowsOf(render({ stockLoc: l }, lang)).map((r: any) => r.i), chips: chipsOf(render({ stockLoc: l }, lang)).map((c: any) => c.bg) }]));
  out.search = Object.fromEntries(['cable', 'LYON', 'fd-det', 'Magasin chantier', 'havre', 'Bearing', 'zzz'].map((q) => [q, rowsOf(render({ stockQ: q }, lang)).map((r: any) => r.i)]));
  out.searchInLocation = rowsOf(render({ stockQ: 'fd', stockLoc: 'Entrepôt central — Lyon' }, lang)).map((r: any) => r.i);
  out.noMatch = render({ stockQ: 'zzz' }, lang).noStock;
  out.drawers = Object.fromEntries(out.rows.map((r: any) => [String(r.i), drawer(render({ stockRow: r.i }, lang))]));
  // Per-operation drawer state (labels, destination, scrap warning) on a pinned line (FD-DET-OPT, row 10).
  out.drawerOps = Object.fromEntries(OPS.map((op) => [op, drawer(render({ stockRow: 10, stockOp: op }, lang))]));
  out.drawerTransferTarget = drawer(render({ stockRow: 0, stockOp: 'transfer', stockTarget: 'Atelier mécanique — Lyon' }, lang));
  out.selectedRow = rowsOf(render({ stockRow: 3 }, lang))[3].idColor;
  return out;
}

const out: any = { en: build('en'), fr: build('fr') };

// ── applyOp (EN; who = the director, Marie Lefebvre; project HLT-026 → "HLT") ──
out.ops = {
  adjust: after([[0, 'adjust', '5']]),
  transferExisting: after([[4, 'transfer', '3', 'Atelier mécanique — Lyon']]),
  transferNew: after([[9, 'transfer', '20', 'Magasin chantier — Le Havre']]),
  reserve: after([[9, 'reserve', '30']]),
  issue: after([[6, 'issue', '10']]),
  return: after([[7, 'return', '5']]),
  scrap: after([[10, 'scrap', '5']]),
  sequence: after([[0, 'adjust', '7'], [4, 'transfer', '2', 'Magasin chantier — Marseille'], [6, 'reserve', '4'], [6, 'issue', '6'], [17, 'return', '3'], [12, 'scrap', '1']]),
  // Edge cases the rebuild settles differently (docs/spec/08 OQ13–15, 00 §10 SC-5).
  adjustZero: after([[0, 'adjust', '0']]),
  issueBeyondOnHand: after([[0, 'issue', '9']]),
  reserveOtherProject: after([[13, 'reserve', '5']]),
  issueOtherProject: after([[13, 'issue', '10']]),
  transferNoTarget: after([[0, 'transfer', '2']]),
  transferSameLocation: after([[0, 'transfer', '2', 'Entrepôt central — Lyon']]),
  // Reserved goods transferred: the prototype leaves the reservation behind (available −6); the rebuild moves it.
  transferReserved: after([[1, 'transfer', '6', 'Entrepôt central — Lyon']]),
  transferPartlyReserved: after([[6, 'transfer', '20', 'Consignation — Nordvolt']]),
  pmOnNdc: after([[9, 'reserve', '5']], { role: 'pm', project: 'NDC-031' }),
  frSequence: after([[0, 'adjust', '7'], [9, 'issue', '4']], {}, 'fr'),
};

// ── importX3: the seed snapshot replaces every line (the rebuild keeps the local ones) ──
{
  const c = make();
  for (const [row, op, qty] of [[0, 'adjust', '5'], [9, 'reserve', '30']] as [number, string, string][]) {
    c.setState({ stockRow: row, stockOp: op, stockQty: qty, stockTarget: null });
    valsOf(c, 'en').stockSel.apply();
  }
  const before = rowsOf(valsOf(c, 'en'));
  c.setState({ stockRow: 3 });
  // importX3 is reached through the header primary button (`primary.stock` → `primaryOnClick`).
  const v0 = valsOf(c, 'en');
  v0.primaryOnClick();
  const v1 = valsOf(c, 'en');
  out.importX3 = {
    before,
    after: rowsOf(v1),
    moves: plain(v1.moveRows),
    stockRowAfter: c.state.stockRow ?? null,
    kpisAfter: kpisOf(v1).filter((k: any) => k.label !== 'X3 import'),
    primaryAction: v0.primaryAction,
  };
}

/** Template labels of the screen (template 1658–1714, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(1657, 1714).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  const extra = [
    'Stock & storages', 'Import from X3', 'All locations', 'Location', 'Adjust (count)', 'Transfer', 'Reserve for project', 'Issue to activity',
    'Return to stock', 'Scrap / rework', 'Counted quantity', 'Quantity', 'On hand', 'Reserved', 'Available', 'Minimum level', 'Unit cost (last purchase)',
    'Last movement', 'Stock value', 'Below minimum', 'In quarantine', 'X3 import', 'Local changes', 'Reorder or transfer', 'Awaiting quality decision',
    'To push back to X3', 'Central warehouse', 'Workshop', 'Site store', 'Consignment at supplier', 'Quarantine (QC hold)',
    'Adjust', 'Reserve', 'Issue', 'Return', 'Scrap', 'Receipt',
  ];
  return Object.fromEntries([...set, ...extra].map((s) => [s, ctx.__trFR(s)]));
}
out.labels = labels();

const target = path.join(root, 'src/features/stock/stock.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
