// Generates src/features/eco/eco.golden.json: the prototype's own render values for the Engineering change orders
// screen (KPI tiles per persona, status chips, rows, the ECO drawer per persona) and the Drawings — PDM vault screen
// (KPI tiles, state chips, rows, search, the drawing drawer), in English (`renderValsEN`) and French (`renderVals`,
// i.e. `deepTr` over the English values), plus the template labels of both screens with their prototype French.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own intrinsics (deepTr only
// walks plain objects of its own realm) and a minimal component base class. Default state (no override).
//   npx tsx scripts/proto-golden-eco.ts
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
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c;
}
const render = (state: any, lang: Lang) => {
  const c = make(state);
  c.state = { ...c.state, lang };
  return c.renderVals();
};

const kpis = (ks: any[]) => plain(ks).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const chips = (xs: any[]) => plain(xs).map((c: any) => pick(c, ['label', 'count']));
const ROW_KEYS = ['id', 'title', 'type', 'status', 'tagClass', 'parts', 'projects', 'by', 'date', 'cost', 'sched', 'hasPend', 'pendText', 'lockIcon', 'canStart', 'canSubmit', 'needInterch'];
const TARGET_KEYS = ['name', 'sub', 'l1', 'l2', 'l3', 'revText', 'label', 'tagClass', 'note', 'hasNote', 'decider', 'canDecide'];

function ecoDrawer(v: any) {
  const e = plain(v.eco);
  return {
    ...pick(e, ['id', 'title', 'type', 'status', 'tagClass', 'by', 'revText', 'canSetInterch', 'interchLabel', 'interchTag', 'interchHint', 'pendText', 'pendTag', 'isLocked',
      'projCount', 'mchCount', 'noMachines', 'hasRetrofit', 'hasPinned', 'pinnedList', 'roleHint']),
    steps: e.steps.map((s: any) => pick(s, ['label', 'dot', 'color', 'line'])),
    impact: e.impact,
    parts: e.parts.map((p: any) => pick(p, ['ref', 'name', 'status', 'tagClass'])),
    dispProjects: e.dispProjects.map((t: any) => ({ ...pick(t, TARGET_KEYS), opts: t.opts.map((o: any) => o.label) })),
    dispMachines: e.dispMachines.map((t: any) => ({ ...pick(t, TARGET_KEYS), opts: t.opts.map((o: any) => o.label) })),
    approvers: e.approvers.map((a: any) => pick(a, ['label', 'who', 'state', 'tagClass', 'canAct'])),
  };
}

function build(lang: Lang) {
  const out: any = { eco: { byRole: {}, filters: {}, drawers: {} }, drawings: {} };
  for (const role of ROLES) {
    const v = render({ screen: 'eco', role }, lang);
    out.eco.byRole[role] = { kpis: kpis(v.ecoKpis) };
  }
  const v = render({ screen: 'eco' }, lang);
  out.eco.chips = chips(v.ecoChips);
  out.eco.rows = plain(v.ecoRows).map((r: any) => ({ ...pick(r, ROW_KEYS), approvals: r.approvals.map((a: any) => pick(a, ['label', 'dot'])) }));
  out.eco.noEcos = v.noEcos;
  for (const f of ['Draft', 'Impact analysis', 'In approval', 'Released', 'Rejected']) {
    const fv = render({ screen: 'eco', ecoFilter: f }, lang);
    out.eco.filters[f] = { rows: plain(fv.ecoRows).map((r: any) => r.id), chips: chips(fv.ecoChips).map((c: any) => c.count) };
  }
  out.eco.selectedIdColor = plain(render({ screen: 'eco', eco: 'ECO-2026-015' }, lang).ecoRows).map((r: any) => r.idColor);
  for (const r of out.eco.rows) {
    out.eco.drawers[r.id] = Object.fromEntries(['director', 'pm', 'englead', 'quality', 'procurement'].map((role) => [role, ecoDrawer(render({ screen: 'eco', eco: r.id, role }, lang))]));
  }

  const dw = render({ screen: 'drawings' }, lang);
  out.drawings = {
    kpis: kpis(dw.dwgKpis),
    chips: chips(dw.dwgChips),
    rows: plain(dw.dwgRows).map((r: any) => pick(r, ['no', 'title', 'part', 'partName', 'rev', 'state', 'tagClass', 'path', 'by', 'date', 'eco', 'noColor'])),
    noDwgs: dw.noDwgs,
    filters: Object.fromEntries(['Released', 'WIP', 'Under review', 'Obsolete'].map((s) => [s, plain(render({ screen: 'drawings', dwgState: s }, lang).dwgRows).map((r: any) => r.no)])),
    search: Object.fromEntries(['rmg', 'DWG-MC', 'bracket', 'sg-brk', 'zzz', 'HOIST'].map((q) => [q, plain(render({ screen: 'drawings', dwgQ: q }, lang).dwgRows).map((r: any) => r.no)])),
    searchReleased: plain(render({ screen: 'drawings', dwgQ: 'bracket', dwgState: 'Released' }, lang).dwgRows).map((r: any) => r.no),
    drawers: {} as any,
  };
  for (const r of out.drawings.rows) {
    const d = plain(render({ screen: 'drawings', dwg: r.no }, lang).dwg);
    out.drawings.drawers[r.no] = pick(d, ['no', 'title', 'rev', 'state', 'tagClass', 'meta', 'hist', 'hasEco']);
  }
  return out;
}

/** Template labels of the two screens (template 1312–1419, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(1311, 1419).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

/** Header, filter-label and form strings used by the screens (FL.*, AF.eco, AF.drawings, AF_RESULT, crumbs) and their prototype French. */
function extraLabels() {
  const set = [
    'Engineering change orders', 'Drawings — PDM vault', 'New ECO', 'Sync vault', 'Status', 'State', 'Synchronise', 'Source', 'Scope', 'SolidWorks 3DX vault', 'SeeElectrical',
    'Both', 'Current project', 'All projects', 'Vault synchronised · 6 drawings updated', 'Technical reference · all projects', 'Technical reference · SolidWorks PDM',
    'Draft', 'Impact analysis', 'In approval', 'Released', 'Rejected', 'WIP', 'Under review', 'Obsolete', 'All', 'Open in PDM',
  ];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

const out = { en: build('en'), fr: build('fr'), labels: labels(), extra: extraLabels() };
const target = path.join(root, 'src/features/eco/eco.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
