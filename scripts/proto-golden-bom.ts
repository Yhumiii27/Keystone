// Generates src/features/bom/bom.golden.json: the prototype's own render values for the Project BOM screen (docs/spec/09
// §1, template 1167–1311, logic 4175–4266) in English (`renderValsEN`) and French (`renderVals`, i.e. `deepTr` over the
// English values): the KPI tiles, view segment, flat list (filters, sorts, counts), assembly tree (folding, node drawer),
// where-used, compare revisions and the PU/PR list per system and kind, for every project of the register, plus the
// template labels of the screen and their prototype French. The prototype logic (design file lines 3096–5239) runs in
// a node:vm sandbox with its own intrinsics (deepTr only walks plain objects of its own realm).
//   npx tsx scripts/proto-golden-bom.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { applyE2a } from './proto-e2a';
import { applyE2b } from './proto-e2b';

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
    applyE2b(applyE2a(lines)).slice(3095, 5239).join('\n') +
    '\n;globalThis.__C = Component; globalThis.__trFR = trFR;',
  ctx,
);

type Lang = 'en' | 'fr';
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'bom', ...state };
  return c;
}
const valsOf = (c: any, lang: Lang) => {
  c.state = { ...c.state, lang };
  return c.renderVals();
};
const render = (state: any, lang: Lang) => valsOf(make(state), lang);

const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const VIEWS = ['flat', 'tree', 'used', 'compare', 'spares'];
const ROW_KEYS = ['ref', 'name', 'type', 'mb', 'pu', 'puClass', 'mfr', 'mfrRef', 'price', 'qty', 'total', 'status', 'tagClass', 'restr', 'restrColor', 'used', 'hasEco', 'eco', 'refColor'];
const TREE_KEYS = ['ref', 'name', 'pad', 'has', 'caret', 'qty', 'ext', 'mb', 'pu', 'puClass', 'rev', 'status', 'tagClass', 'unit', 'total', 'nameColor', 'bg'];
const SPARE_KEYS = ['ref', 'name', 'kind', 'tagClass', 'qPer', 'qTotal', 'note', 'price', 'total', 'lead', 'status', 'statusClass', 'stock', 'stockText', 'stockColor', 'frozen', 'pinned', 'pinnedText', 'refColor'];
const kpis = (ks: any[]) => plain(ks).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const opts = (os: any[]) => plain(os).map((o: any) => pick(o, ['key', 'label']));
const segs = (os: any[]) => plain(os).map((o: any) => pick(o, ['label', 'color']));
const flatRows = (v: any) => plain(v.bomRows).map((r: any) => pick(r, ROW_KEYS));

function flat(v: any) {
  return {
    kpis: kpis(v.bomKpis), viewSeg: segs(v.bomViewSeg), count: v.bomCountText, title: v.bomTitle, typeOpts: opts(v.bomTypeOpts), mfrOpts: opts(v.bomMfrOpts),
    hasFilter: v.bomHasFilter, clearLabel: v.bomClearLabel, rows: flatRows(v), hasTree: v.bomHasTree, noTree: v.bomNoTree,
    sortIco: plain(v.bomSortIco), sortCol: plain(v.bomSortCol), FL: pick(plain(v.FL), ['view', 'type', 'system', 'kind']),
  };
}

function build(lang: Lang) {
  const out: any = {};
  out.projects = {};
  for (const code of PROJECTS) {
    const v = render({ project: code }, lang);
    out.projects[code] = { ...flat(v), noTreeByView: Object.fromEntries(VIEWS.map((view) => [view, render({ project: code, bomView: view }, lang).bomNoTree])) };
  }
  // Flat-list filters, searches and sorts (HLT-026).
  out.filters = {} as any;
  const F: [string, any][] = [
    ['q:vfd', { bomQ: 'vfd' }], ['q:ABB', { bomQ: 'ABB' }], ['q:dwg-st', { bomQ: 'dwg-st' }], ['q:zzz', { bomQ: 'zzz' }],
    ['type:Electrical', { bomType: 'Electrical' }], ['type:Assembly', { bomType: 'Assembly' }], ['mfr:ABB', { bomMfr: 'ABB' }],
    ['mfr:Siemens+type:Electronics', { bomMfr: 'Siemens', bomType: 'Electronics' }], ['q:steel+type:Structural', { bomQ: 'steel', bomType: 'Structural' }],
  ];
  for (const [k, st] of F) {
    const v = render(st, lang);
    out.filters[k] = { count: v.bomCountText, title: v.bomTitle, hasFilter: v.bomHasFilter, refs: plain(v.bomRows).map((r: any) => r.ref) };
  }
  out.sorts = {} as any;
  for (const key of ['ref', 'name', 'type', 'total', 'status']) {
    for (const dir of [1, -1]) {
      const v = render({ bomSort: key, bomSortDir: dir }, lang);
      out.sorts[`${key}:${dir}`] = { refs: plain(v.bomRows).map((r: any) => r.ref), ico: plain(v.bomSortIco), col: plain(v.bomSortCol) };
    }
  }
  // Sort click semantics: first click on another column asc (total: desc), on the active column flips.
  {
    const clicks: any = {};
    for (const key of ['ref', 'name', 'type', 'total', 'status']) {
      const c = make({});
      valsOf(c, 'en').bomSortBy[key]();
      const once = { sort: c.state.bomSort, dir: c.state.bomSortDir };
      valsOf(c, 'en').bomSortBy[key]();
      clicks[key] = { once, twice: { sort: c.state.bomSort, dir: c.state.bomSortDir } };
    }
    out.sortClicks = clicks;
  }
  // Selected part (ref colour).
  out.selected = flatRows(render({ part: 'EL-VFD-200' }, lang)).filter((r: any) => r.refColor !== 'var(--color-neutral-300)').map((r: any) => r.ref);

  // Assembly tree.
  const tv = render({ bomView: 'tree' }, lang);
  out.tree = plain(tv.treeRows).map((r: any) => pick(r, TREE_KEYS));
  out.treeFolded = plain(render({ bomView: 'tree', bomClosed: { 'ASM-STR-100': true, 'ASM-DRV-700': true } }, lang).treeRows).map((r: any) => pick(r, ['ref', 'caret']));
  out.treeSelected = plain(render({ bomView: 'tree', bomNode: 'ASM-BOG-300' }, lang).treeRows).filter((r: any) => r.bg !== 'transparent').map((r: any) => r.ref);
  out.nodes = {};
  for (const r of out.tree) {
    const v = render({ bomView: 'tree', bomNode: r.ref }, lang);
    out.nodes[r.ref] = pick(plain(v.node), ['ref', 'name', 'status', 'tagClass', 'isAsm', 'ident', 'cost', 'parents']);
  }

  // Where-used.
  out.used = {};
  for (const q of ['', 'CR-BRG-SKF', 'EL-VFD-200', 'FD-DET-OPT', 'FD-DET-OPT2', 'EL-TRF-2MVA', 'KS-STL-0450', 'ASM-BOG-300', 'vfd', 'drive', 'zzz', ' el-plc-s7 ']) {
    out.used[q || '(default)'] = plain(render({ bomView: 'used', bomUsedQ: q }, lang).used);
  }
  out.usedOther = {};
  for (const code of ['NDC-031', 'EWA-051']) out.usedOther[code] = plain(render({ project: code, bomView: 'used', bomUsedQ: 'EL-VFD-200' }, lang).used);

  // Compare revisions.
  const cv = render({ bomView: 'compare' }, lang);
  out.compare = { hasCmp: cv.hasCmp, cmp: plain(cv.cmp) };

  // PU/PR list.
  out.spares = {};
  for (const sys of ['ASM-RMG-250', 'ASM-BOG-300', 'ASM-HST-400', 'ASM-DRV-700', 'ASM-CTL-800']) {
    for (const kind of [null, 'PU', 'PR']) {
      const v = render({ bomView: 'spares', spareSys: sys, spareFilter: kind }, lang);
      out.spares[`${sys}:${kind ?? 'all'}`] = {
        kpis: kpis(v.spKpis), sysName: v.spSysName, seg: segs(v.spSeg), chips: plain(v.spChips).map((c: any) => pick(c, ['label', 'bg', 'border', 'color'])),
        noSpares: v.noSpares, rows: plain(v.spareRows).map((r: any) => pick(r, SPARE_KEYS)),
      };
    }
  }
  out.sparesSelected = plain(render({ bomView: 'spares', part: 'HST-MOT-160' }, lang).spareRows).filter((r: any) => r.refColor !== 'var(--color-neutral-300)').map((r: any) => r.ref);
  return out;
}

/** Template labels of the screen (template 1167–1311, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(1166, 1311).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

/** Add article form (AF.bom) and its result toast, EN and the prototype French. */
function addForm() {
  const af = plain(vm.runInContext('AF.bom', ctx));
  const result = vm.runInContext('AF_RESULT.bom', ctx);
  const tr = (s: string) => ctx.__trFR(s);
  return {
    af, result,
    fr: { title: tr(af.title), submit: tr(af.submit), labels: af.fields.map((f: any) => tr(f[1])), scope: af.fields[3][3].map(tr), result: tr(result) },
  };
}

const out = { en: build('en'), fr: build('fr'), labels: labels(), form: addForm() };
const target = path.join(root, 'src/features/bom/bom.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
