// Generates src/features/quality/quality.golden.json: the prototype's own render values for the Quality — NCR &
// deliverables screen (docs/spec/07 §2.3, template 1883–1971, logic 4612–4644) in English (`renderValsEN`) and French
// (`renderVals`, i.e. `deepTr` over the English values): the register switch, the NCR KPI tiles / severity chips / log
// rows / drawers, the deliverables KPI tiles / status chips / register rows (per viewer: the client accepts) / drawers,
// every filter, the selection colour, the states after the prototype's own row actions (Start, To internal review,
// Submit to client, Accept, Reject — the handlers are called, then the screen is rendered again) and the NCR
// verification / deliverable acceptance items of My approvals, plus the template labels with their prototype French.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-quality.ts
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
const plain = (v: any) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'mapRef' || typeof x === 'function' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const DATA = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];
const EV = { stopPropagation() {} };

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'quality', ...state };
  return c;
}
const valsOf = (c: any, lang: Lang) => {
  c.state = { ...c.state, lang };
  return c.renderVals();
};
const render = (state: any, lang: Lang) => valsOf(make(state), lang);

const kpis = (ks: any[]) => plain(ks).map((k: any) => ({ ...pick(k, ['label', 'sub', 'color']), value: String(k.value) }));
const chips = (xs: any[]) => plain(xs).map((c: any) => ({ label: c.label, count: Number(c.count) }));
const NCR_ROW = ['id', 'title', 'raised', 'date', 'sev', 'sevClass', 'src', 'actText', 'owner', 'due', 'costText', 'status', 'tagClass', 'canAdvance', 'nextLabel', 'idColor'];
const ncrRows = (rs: any[]) => plain(rs).map((r: any) => ({ ...pick(r, NCR_ROW), steps: r.steps.map((s: any) => s.bg) }));
const DLV_ROW = ['id', 'title', 'type', 'wbs', 'due', 'rev', 'acc', 'status', 'tagClass', 'canStart', 'nextLabel', 'canSubmit', 'canAccept', 'idColor'];
const dlvRows = (rs: any[]) => plain(rs).map((r: any) => ({ ...pick(r, DLV_ROW), raci: r.raciCells.map((c: any) => pick(c, ['k', 'who', 'ini'])) }));

function ncrDrawer(v: any) {
  const n = plain(v.ncr);
  return {
    ...pick(n, ['id', 'title', 'sev', 'sevClass', 'status', 'tagClass', 'src', 'iso', 'root', 'action', 'canAdvance', 'nextLabel', 'hasAct', 'hasPart', 'hasEco', 'ecoId']),
    steps: n.steps.map((s: any) => pick(s, ['label', 'dot', 'color', 'line'])),
    meta: n.meta.map((m: any) => pick(m, ['k', 'v'])),
    sevSeg: n.sevSeg.map((o: any) => ({ label: o.label, on: o.shadow !== 'none' })),
  };
}

function dlvDrawer(v: any) {
  const d = plain(v.dlv);
  return {
    ...pick(d, ['id', 'title', 'type', 'status', 'tagClass', 'hint', 'canSubmit', 'canAccept', 'slotId']),
    steps: d.steps.map((s: any) => pick(s, ['label', 'dot', 'color', 'line'])),
    raci: d.raci.map((r: any) => pick(r, ['k', 'l', 'who', 'ini'])),
    meta: d.meta.map((m: any) => pick(m, ['k', 'v'])),
  };
}

/** Deliverables screen after the prototype's row actions on `id` (handlers called in turn, screen rendered again). */
function afterRow(lang: Lang, role: string, id: string, handlers: ('start' | 'submit' | 'accept' | 'reject')[]) {
  const c = make({ qTab: 'dlv', role });
  for (const h of handlers) valsOf(c, 'en').dlvRows.find((r: any) => r.id === id)[h](EV);
  const v = valsOf(c, lang);
  return { kpis: kpis(v.dlvKpis), chips: chips(v.dlvChips), row: dlvRows(v.dlvRows).find((r: any) => r.id === id) };
}

function build(lang: Lang) {
  const out: any = { projects: {}, ncrFilters: {}, dlvFilters: {}, ncrDrawers: {}, dlvDrawers: {}, after: {} };
  const v0 = render({}, lang);
  out.qSeg = plain(v0.qSeg).map((o: any) => ({ label: o.label, on: o.shadow !== 'none' }));
  out.qSegDlv = plain(render({ qTab: 'dlv' }, lang).qSeg).map((o: any) => ({ label: o.label, on: o.shadow !== 'none' }));
  out.flags = { qIsNcr: v0.qIsNcr, qIsDlv: v0.qIsDlv, noNcr: v0.noNcr, showNcr: v0.showNcr };
  for (const code of DATA) {
    const v = render({ project: code }, lang);
    const d = render({ project: code, qTab: 'dlv' }, lang);
    const dc = render({ project: code, qTab: 'dlv', role: 'client' }, lang);
    out.projects[code] = {
      ncr: { kpis: kpis(v.ncrKpis), chips: chips(v.ncrChips), rows: ncrRows(v.ncrRows), empty: v.noNcr },
      dlv: { kpis: kpis(d.dlvKpis), chips: chips(d.dlvChips), rows: dlvRows(d.dlvRows), clientRows: dlvRows(dc.dlvRows), empty: d.noDlv },
    };
  }
  for (const f of ['Minor', 'Major', 'Critical']) {
    const v = render({ ncrFilter: f }, lang);
    out.ncrFilters[f] = { rows: plain(v.ncrRows).map((r: any) => r.id), chips: chips(v.ncrChips), empty: v.noNcr };
  }
  for (const f of ['Planned', 'In progress', 'Internal review', 'Submitted', 'Accepted', 'Rejected']) {
    const v = render({ qTab: 'dlv', dlvFilter: f }, lang);
    out.dlvFilters[f] = { rows: plain(v.dlvRows).map((r: any) => r.id), chips: chips(v.dlvChips), empty: v.noDlv };
  }
  out.ncrSelected = plain(render({ ncr: 'NCR-029' }, lang).ncrRows).map((r: any) => r.idColor);
  out.dlvSelected = plain(render({ qTab: 'dlv', dlv: 'D-015' }, lang).dlvRows).map((r: any) => r.idColor);
  for (const r of out.projects['HLT-026'].ncr.rows) out.ncrDrawers[r.id] = ncrDrawer(render({ ncr: r.id }, lang));
  for (const r of out.projects['NDC-031'].ncr.rows) out.ncrDrawers[`NDC-031:${r.id}`] = ncrDrawer(render({ project: 'NDC-031', ncr: r.id }, lang));
  for (const r of out.projects['HLT-026'].dlv.rows) {
    out.dlvDrawers[r.id] = {
      pm: dlvDrawer(render({ qTab: 'dlv', dlv: r.id, role: 'pm' }, lang)),
      client: dlvDrawer(render({ qTab: 'dlv', dlv: r.id, role: 'client' }, lang)),
    };
  }
  for (const r of out.projects['NDC-031'].dlv.rows) out.dlvDrawers[`NDC-031:${r.id}`] = { pm: dlvDrawer(render({ project: 'NDC-031', qTab: 'dlv', dlv: r.id, role: 'pm' }, lang)) };
  // Row actions (HLT-026): Start D-018 (Planned → In progress); To internal review on D-017 (In progress), then Submit
  // to client; the client accepts D-014 and rejects D-016.
  out.after.start = afterRow(lang, 'pm', 'D-018', ['start']);
  out.after.review = afterRow(lang, 'pm', 'D-017', ['start']);
  out.after.submit = afterRow(lang, 'pm', 'D-017', ['start', 'submit']);
  out.after.accept = afterRow(lang, 'client', 'D-014', ['accept']);
  out.after.reject = afterRow(lang, 'client', 'D-016', ['reject']);
  // My approvals items of the two kinds (apprItems 4727 / 4730), and the NCR verification item of an NCR in Verification.
  // Kinds are filtered on the English render (the French one translates them), the French values read at the same index.
  const items = (state: any) => {
    const en = plain(render({ screen: 'myapprovals', ...state }, 'en').myApprovals);
    const tr = plain(render({ screen: 'myapprovals', ...state }, lang).myApprovals);
    return en.flatMap((i: any, ix: number) => (i.kind === 'NCR verification' || i.kind === 'Deliverable acceptance' ? [pick(tr[ix], ['kind', 'id', 'title', 'sub', 'when', 'who'])] : []));
  };
  out.approvals = {};
  for (const role of ['quality', 'client', 'pm']) out.approvals[role] = items({ role });
  out.approvals.qualityVerification = items({ role: 'quality', ncrOv: { 'NCR-026': { status: 'Verification' } } });
  return out;
}

/** Template labels of the screen (template 1883–1971, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(1882, 1971).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

/** Header, filter-label, flow and form strings of the screen (titles, FL.*, AF.quality, crumbs) and their prototype French. */
function extraLabels() {
  const set = [
    'Quality — NCR & deliverables', 'Quality & deliverables', 'New NCR', 'Register', 'Severity', 'Status', 'All', 'Minor', 'Major', 'Critical',
    'Open', 'Containment', 'Root cause', 'Corrective action', 'Verification', 'Closed',
    'Planned', 'In progress', 'Internal review', 'Submitted', 'Accepted', 'Rejected', 'Start', 'To internal review', 'Raise NCR', 'Project · Control · ISO 9001',
    'Site inspection', 'Goods receipt', 'Survey', 'Workshop', 'Client', 'Audit', 'NCR verification', 'Deliverable acceptance', 'comments issued',
  ];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

const out = { en: build('en'), fr: build('fr'), labels: labels(), extra: extraLabels() };
const target = path.join(root, 'src/features/quality/quality.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
