// Generates src/features/pid/pid.golden.json: the prototype's own render values for the P&ID — tags, overlay & process
// validation screen (docs/spec/09 §6, template 2472–2534, logic 4762–4782) in English (`renderValsEN`) and French
// (`renderVals`, i.e. `deepTr` over the English values): KPI tiles, status chips, scope segments, validation steps, the
// tag register (default, per status chip, per scope, searches, combinations), the overlay table, every tag drawer,
// mapping overrides (`pidOv`: map, unlink, everything linked), the nav badge, the empty state of a project without a
// P&ID, plus the template labels of the screen and the header / form strings with their prototype French.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own intrinsics (deepTr only walks
// plain objects of its own realm) and a minimal component base class.
//   npx tsx scripts/proto-golden-pid.ts
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
    '\n;globalThis.__C = Component; globalThis.__trFR = trFR; globalThis.__AF = AF; globalThis.__AF_RESULT = AF_RESULT; globalThis.__FL = typeof FL !== "undefined" ? FL : null;',
  ctx,
);

type Lang = 'en' | 'fr';
const plain = (v: any) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'pid', ...state };
  return c;
}
const render = (state: any, lang: Lang) => {
  const c = make(state);
  c.state = { ...c.state, lang };
  return c.renderVals();
};

const ROW_KEYS = [
  'tag', 'desc', 'kind', 'scope', 'scopeClass', 'ref', 'refText', 'partName', 'status', 'tagClass', 'actText', 'plcText', 'plcTag', 'plcPlain', 'plcClass',
  'fbWarn', 'fbText', 'fbColor', 'tagColor', 'hasPart',
];
const rows = (v: any) => plain(v.pidList).map((r: any) => pick(r, ROW_KEYS));
const tags = (v: any) => plain(v.pidList).map((r: any) => r.tag);
const kpis = (v: any) => plain(v.pidKpis).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const chips = (v: any) => plain(v.pidChips).map((c: any) => pick(c, ['label', 'count', 'bg', 'border', 'color']));
const navBadge = (v: any) => {
  const n = plain(v.navEng ?? []).find((x: any) => x.id === 'pid');
  return n ? n.badge : null;
};

function drawer(v: any) {
  const d = plain(v.pidTag);
  return {
    ...pick(d, ['tag', 'desc', 'kind', 'scope', 'scopeClass', 'status', 'tagClass', 'isClient', 'fbWarn', 'canMap', 'hasPart', 'notInBom']),
    meta: d.meta.map((m: any) => [m.k, m.v]),
    candidates: d.candidates.map((c: any) => pick(c, ['ref', 'name', 'status', 'tagClass'])),
  };
}

const STATUSES = ['Linked', 'Unmapped', 'Not in BOM', 'Part not validated', 'Part outdated', 'Part obsolete', 'Client'];
const SCOPES = ['Keystone', 'Overlay', 'Client'];
const SEARCHES = ['lt', 'LT-1', 'process plc', 'safety', 'missing', 'el-plc', 'vfd', 'run status', 'tank', '—', 'local', 'zzz', 'Bus'];

function build(lang: Lang) {
  const v = render({}, lang);
  const out: any = {
    kpis: kpis(v),
    chips: chips(v),
    scopeSeg: plain(v.pidScopeSeg).map((o: any) => pick(o, ['label', 'color', 'shadow', 'bl'])),
    steps: plain(v.pidSteps).map((s: any) => pick(s, ['label', 'who', 'date', 'dot', 'color', 'state', 'tagClass'])),
    rows: rows(v),
    overlay: plain(v.overlay).map((r: any) => pick(r, ['tag', 'desc', 'scope', 'scopeClass', 'refText', 'status', 'tagClass'])),
    noPid: v.noPid,
    isPidProj: v.isPidProj,
    pidNotProj: v.pidNotProj,
    navBadge: navBadge(v),
    pidDoc: pick(plain(v.pidDoc ?? {}), ['doc', 'rev']),
    filters: {} as any,
    scopes: {} as any,
    searches: {} as any,
    combos: {} as any,
    drawers: {} as any,
    overrides: {} as any,
  };
  for (const s of STATUSES) {
    const f = render({ pidFilter: s }, lang);
    out.filters[s] = { tags: tags(f), chips: chips(f) };
  }
  for (const s of SCOPES) {
    const f = render({ pidScope: s }, lang);
    out.scopes[s] = { tags: tags(f), seg: plain(f.pidScopeSeg).map((o: any) => pick(o, ['label', 'color', 'shadow', 'bl'])) };
  }
  for (const q of SEARCHES) out.searches[q] = tags(render({ pidQ: q }, lang));
  out.combos['Unmapped|Overlay'] = tags(render({ pidFilter: 'Unmapped', pidScope: 'Overlay' }, lang));
  out.combos['Linked|Keystone|vfd'] = tags(render({ pidFilter: 'Linked', pidScope: 'Keystone', pidQ: 'vfd' }, lang));
  out.combos['Client|Keystone'] = tags(render({ pidFilter: 'Client', pidScope: 'Keystone' }, lang));
  out.combos['Part outdated|zzz'] = { tags: tags(render({ pidFilter: 'Part outdated', pidQ: 'zzz' }, lang)), noPid: render({ pidFilter: 'Part outdated', pidQ: 'zzz' }, lang).noPid };
  out.selectedTagColor = plain(render({ pidTag: 'XV-111' }, lang).pidList).map((r: any) => r.tagColor);
  for (const r of out.rows) out.drawers[r.tag] = drawer(render({ pidTag: r.tag }, lang));

  // Mapping overrides (`pidOv`, the tag drawer's pick / Unlink).
  const scenario = (ov: Record<string, string>, tag?: string) => {
    const s = render({ pidOv: ov, ...(tag ? { pidTag: tag } : {}) }, lang);
    return { kpis: kpis(s), chips: chips(s), rows: plain(s.pidList).map((r: any) => pick(r, ['tag', 'refText', 'partName', 'status', 'tagClass', 'hasPart'])), navBadge: navBadge(s), drawer: tag ? drawer(s) : null };
  };
  out.overrides.mapTT102 = scenario({ 'TT-102': 'EL-SWG-11KV' }, 'TT-102');
  out.overrides.unlinkLT101 = scenario({ 'LT-101': '' }, 'LT-101');
  out.overrides.mapNotValidated = scenario({ 'XV-111': 'CTL-WIND-SN' }, 'XV-111');
  // Every Keystone-scope tag not Linked → its first Validated candidate: coverage 100 %, no badge.
  const base = render({}, lang);
  const ov: Record<string, string> = {};
  for (const r of plain(base.pidList)) {
    if (r.scope === 'Client' || r.status === 'Linked') continue;
    const d = plain(render({ pidTag: r.tag }, 'en').pidTag);
    const c = d.candidates.find((x: any) => x.status === 'Validated');
    if (c) ov[r.tag] = c.ref;
  }
  out.overrides.allLinkedMap = ov;
  out.overrides.allLinked = scenario(ov);

  // A project without a P&ID (isPidProj false): empty state, no badge.
  const nd = render({ project: 'NDC-031' }, lang);
  out.otherProject = { isPidProj: nd.isPidProj, pidNotProj: nd.pidNotProj, navBadge: navBadge(nd) };
  return out;
}

/** Template labels of the screen (template 2472–2534, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(2471, 2534).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

/** Header, filter-label, form and data strings used by the screen and their prototype French. */
function extraLabels() {
  const af = ctx.__AF.pid;
  const set = [
    'P&ID — tags, overlay & process validation', 'P&ID validation', 'Import P&ID tags', 'Project engineering', 'Status', 'Scope', 'All', 'All scopes', 'Keystone',
    'Overlay (surcouche)', 'Client', 'Overlay', 'Instrument', 'Equipment', 'Process PLC', 'Safety PLC', 'Local', 'Missing', 'Done', 'In progress', 'To do',
    'Reference', 'Part', 'Activity', 'PLC', 'State feedback', 'Sheet', 'Linked', 'Unmapped', 'Unknown ref', 'Not in BOM', 'Part not validated', 'Part outdated',
    'Part obsolete', 'Overlay — Keystone sensor on client equipment', 'Client-supplied equipment (free issue)', 'Keystone supply', 'Client scope — free issue',
    'Validated', 'Not validated', 'Outdated', 'Obsolete', 'Under review', 'Released', 'P&ID', 'Tags in our scope', 'Linked to a BOM reference', 'Unmapped tags',
    'Reference issues', 'Blocks release for construction', 'Not in BOM · outdated · not validated',
    af.title, af.submit, ...af.fields.map((f: any) => f[1]), ...af.fields.filter((f: any) => Array.isArray(f[3])).flatMap((f: any) => f[3]), ctx.__AF_RESULT.pid,
    '27 tags · rev E imported · 3 new · 1 updated',
  ];
  return Object.fromEntries([...new Set(set)].map((s) => [s, ctx.__trFR(s)]));
}

const out = { en: build('en'), fr: build('fr'), af: plain(ctx.__AF.pid), afResult: ctx.__AF_RESULT.pid, labels: labels(), extra: extraLabels() };
const target = path.join(root, 'src/features/pid/pid.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
