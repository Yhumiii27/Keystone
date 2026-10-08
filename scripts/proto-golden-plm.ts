// Generates src/features/plm/plm.golden.json: the prototype's own render values for the PLM — parts catalogue screen
// (KPIs, filter options, rows under every filter / sort the screen offers, count line) and the shared part record
// drawer (every part of the catalogue), in English (`renderValsEN`) and French (`renderVals`, i.e. `deepTr` over the
// English values), for the director on HLT-026. Also the template labels of both (template 2535–2613) with the
// prototype's French. The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own
// intrinsics (deepTr only walks plain objects of its own realm) and a minimal component base class.
//   npx tsx scripts/proto-golden-plm.ts
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
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'plm', ...state, plm: { ...c.state.plm, ...(state.plm ?? {}) } };
  return c;
}
const valsOf = (c: any, lang: Lang) => {
  c.state = { ...c.state, lang };
  return c.renderVals();
};
const render = (state: any, lang: Lang) => valsOf(make(state), lang);

const ROW_KEYS = ['ref', 'name', 'type', 'mb', 'pu', 'puClass', 'mfr', 'mfrRef', 'price', 'lead', 'status', 'tagClass', 'hasEco', 'eco', 'restr', 'restrColor', 'usedCount'];
const opts = (xs: any[]) => plain(xs).map((o: any) => pick(o, ['key', 'label']));

function catalogue(v: any) {
  return {
    kpis: plain(v.plmKpis).map((k: any) => pick(k, ['label', 'value', 'sub', 'color'])),
    count: v.plmCount,
    typeOpts: opts(v.plmTypeOpts),
    statusOpts: opts(v.plmStatusOpts),
    puOpts: opts(v.plmPuOpts),
    mbOpts: opts(v.plmMbOpts),
    restr: pick(plain(v.restrChip), ['label', 'bg', 'border', 'color']),
    hasFilter: v.plmHasFilter,
    clearLabel: v.plmClearLabel,
    sortIco: plain(v.plmSortIco),
    sortCol: plain(v.plmSortCol),
    rows: plain(v.plmRows).map((r: any) => pick(r, ROW_KEYS)),
  };
}
const refsOf = (v: any) => plain(v.plmRows).map((r: any) => r.ref);

function drawer(v: any) {
  const p = plain(v.part);
  return {
    ref: p.ref, name: p.name, status: p.status, tagClass: p.tagClass, warn: p.warn, hasWarn: p.hasWarn,
    ident: p.ident, comm: p.comm,
    equiv: p.equiv.map((e: any) => pick(e, ['ref', 'name', 'status', 'tagClass'])), noEquiv: p.noEquiv,
    spares: p.spares.map((s: any) => pick(s, ['ref', 'name', 'kind', 'tagClass', 'qty'])), hasSpares: p.hasSpares,
    projects: p.projects.map((x: any) => pick(x, ['code', 'name', 'qty', 'status', 'tagClass'])), noProjects: p.noProjects,
    fleetUse: p.fleetUse.map((m: any) => pick(m, ['id', 'name', 'gen', 'revText', 'state', 'eco', 'hasEco', 'tagClass'])), noFleetUse: p.noFleetUse,
    ecoList: p.ecoList.map((e: any) => pick(e, ['id', 'title', 'status', 'tagClass'])), hasEcoList: p.hasEcoList,
    docs: plain(v.partDocs).map((d: any) => pick(d, ['id', 'rev', 'title', 'typeLabel', 'status', 'stClass'])),
  };
}

const TYPES = ['Structural', 'Heavy equipment', 'Electrical', 'HVAC', 'Fire & safety', 'Architectural', 'Medical', 'Mechanical', 'Electronics', 'IT hardware', 'Assembly', 'Consumable', 'Software'];
const STATUSES = ['Validated', 'Not validated', 'Outdated', 'Obsolete'];
const QUERIES = ['abb', 'crane', 'acs880', 'dwg-', 'ks-', 'zzz', 'Siemens', 'HMI'];

function build(lang: Lang) {
  const out: any = {};
  out.default = catalogue(render({}, lang));
  out.filters = {
    type: Object.fromEntries(TYPES.map((type) => [type, refsOf(render({ plm: { type } }, lang))])),
    status: Object.fromEntries(STATUSES.map((status) => [status, refsOf(render({ plm: { status } }, lang))])),
    pu: Object.fromEntries(['PU', 'PR', 'none'].map((pu) => [pu, refsOf(render({ plm: { pu } }, lang))])),
    mb: Object.fromEntries(['Manufactured', 'Purchased'].map((mb) => [mb, refsOf(render({ plm: { mb } }, lang))])),
    restricted: refsOf(render({ plm: { restricted: true } }, lang)),
    q: Object.fromEntries(QUERIES.map((q) => [q, refsOf(render({ plm: { q } }, lang))])),
    combined: catalogue(render({ plm: { type: 'Electrical', status: 'Validated', restricted: true, q: 'a' } }, lang)),
    empty: catalogue(render({ plm: { q: 'zzz' } }, lang)),
  };
  // Sorts: first click on each key from the default (ref asc), then the second click (flip).
  out.sorts = {} as any;
  for (const key of ['ref', 'name', 'type', 'price', 'status']) {
    const c = make({});
    valsOf(c, 'en').plmSortBy[key]();
    const once = valsOf(c, lang);
    const s1 = { sort: c.state.plm.sort, dir: c.state.plm.dir, rows: refsOf(once), ico: plain(once.plmSortIco), col: plain(once.plmSortCol) };
    valsOf(c, 'en').plmSortBy[key]();
    const twice = valsOf(c, lang);
    out.sorts[key] = { first: s1, second: { sort: c.state.plm.sort, dir: c.state.plm.dir, rows: refsOf(twice), ico: plain(twice.plmSortIco) } };
  }
  out.selected = pick(plain(render({ part: 'EL-VFD-200' }, lang).plmRows.find((r: any) => r.ref === 'EL-VFD-200')), ['ref', 'refColor']);
  const refs = refsOf(render({}, lang));
  out.drawers = Object.fromEntries(refs.map((ref: string) => [ref, drawer(render({ part: ref }, lang))]));
  return out;
}

/** Template labels of the screen and the drawer (template 2535–2613, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(2534, 2613).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

const out = { en: build('en'), fr: build('fr'), labels: labels() };
const target = path.join(root, 'src/features/plm/plm.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
