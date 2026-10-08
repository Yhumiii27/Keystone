// Generates src/features/docs/docs.golden.json: the prototype's own render values for the Documents — Codex index
// screen, the document record drawer, the "Deposit in Codex" dialog and the Document types register, in English
// (`renderValsEN`) and French (`renderVals`, i.e. `deepTr` over the English values), for the director on HLT-026
// unless stated otherwise. The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own
// intrinsics (deepTr only walks plain objects of its own realm) and a minimal component base class.
//   npx tsx scripts/proto-golden-docs.ts
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

/** A component in a given state; `act(c)` may call handlers (approve…) before the final render. */
function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'docs', ...state, dv: { ...c.state.dv, ...(state.dv ?? {}) } };
  return c;
}
const valsOf = (c: any, lang: Lang) => {
  c.state = { ...c.state, lang };
  return c.renderVals();
};
const render = (state: any, lang: Lang) => valsOf(make(state), lang);

const ROW_KEYS = ['id', 'title', 'typeLabel', 'svcLabel', 'proj', 'rev', 'status', 'stClass', 'conf', 'confClass', 'tags', 'isNew'];
const chipKeys = (xs: any[]) => plain(xs).map((x: any) => pick(x, ['label', 'count']));

function vault(v: any) {
  return {
    kpis: plain(v.dvKpis).map((k: any) => pick(k, ['label', 'value', 'sub', 'color'])),
    scope: plain(v.dvScope).map((o: any) => o.label),
    views: chipKeys(v.dvViews),
    fam: chipKeys(v.dvFam),
    st: chipKeys(v.dvSt),
    count: v.dvCount,
    sync: v.codexSync,
    list: plain(v.dvList).map((d: any) => pick(d, ROW_KEYS)),
  };
}

function drawer(v: any) {
  const d = plain(v.doc);
  return {
    id: d.id, revText: d.revText, title: d.title, conf: d.conf, confClass: d.confClass, status: d.status, stClass: d.stClass,
    canApprove: d.canApprove, approveLabel: d.approveLabel, obsNote: d.obsNote, meta: d.meta, tagList: d.tagList,
    revs: d.revs.map((r: any) => pick(r, ['rev', 'note', 'date', 'by', 'versions', 'status', 'stClass', 'color'])),
    appr: d.appr.map((a: any) => pick(a, ['role', 'who', 'state', 'when', 'dot', 'color'])),
    dist: d.dist.map((x: any) => pick(x, ['to', 'rev', 'date', 'ack', 'cls'])),
    dl: d.dl.map((x: any) => x.text),
    links: d.links.map((l: any) => pick(l, ['kind', 'id', 'hasOpen'])),
  };
}

function deposit(v: any) {
  const d = plain(v.dep);
  return { detected: d.detected, ctxText: d.ctxText, number: d.number, meta: d.meta, types: d.types.map((t: any) => pick(t, ['code', 'label'])), steps: d.steps.map((s: any) => s.label) };
}

const DRAWERS = ['PID-HLT-026', 'RPT-HLT-014', 'PHO-HLT-011', 'PRO-QMS-001', 'CTR-HLT-002', 'REC-HLT-009', 'GA-HLT-026', 'FDS-HLT-026', 'PID-NDC-031'];
const VIEWS = ['bpe', 'audit', 'client', 'pending', 'obsolete'];

function build(lang: Lang) {
  const out: any = {};
  out.hlt = vault(render({}, lang));
  out.all = vault(render({ dv: { scope: 'all' } }, lang));
  out.ndc = vault(render({ project: 'NDC-031' }, lang));
  out.ewa = vault(render({ project: 'EWA-051' }, lang));
  out.views = Object.fromEntries(VIEWS.map((view) => [view, plain(render({ dv: { view } }, lang).dvList).map((d: any) => d.id)]));
  out.allViews = Object.fromEntries(VIEWS.map((view) => [view, plain(render({ dv: { scope: 'all', view } }, lang).dvList).map((d: any) => d.id)]));
  out.filters = {
    famQuality: plain(render({ dv: { fam: 'quality' } }, lang).dvList).map((d: any) => d.id),
    stDraft: plain(render({ dv: { st: 'Draft' } }, lang).dvList).map((d: any) => d.id),
    auditPurchasing: plain(render({ dv: { view: 'audit', fam: 'purchasing' } }, lang).dvList).map((d: any) => d.id),
    qNordvolt: plain(render({ dv: { q: 'nordvolt' } }, lang).dvList).map((d: any) => d.id),
    qComte: plain(render({ dv: { q: 'g. comte' } }, lang).dvList).map((d: any) => d.id),
    qCertificate: plain(render({ dv: { q: 'material certificate' } }, lang).dvList).map((d: any) => d.id),
    noMatch: render({ dv: { q: 'zzz' } }, lang).dvCount,
  };
  out.selection = {
    one: render({ dv: { sel: { 'PID-HLT-026': true } } }, lang).selText,
    three: render({ dv: { sel: { 'PID-HLT-026': true, 'GA-HLT-026': true, 'PFD-HLT-026': true } } }, lang).selText,
  };
  out.drawers = Object.fromEntries(DRAWERS.map((id) => [id, drawer(render({ dv: { scope: 'all', open: id } }, lang))]));

  // RPT-HLT-014 (rev A, Author → Quality manager → Project manager): one approval, then the release.
  const c1 = make({ dv: { open: 'RPT-HLT-014' } });
  valsOf(c1, 'en').doc.approve();
  out.approvedOnce = drawer(valsOf(c1, lang));
  valsOf(c1, 'en').doc.approve();
  out.released = { drawer: drawer(valsOf(c1, lang)), kpis: vault(valsOf(c1, lang)).kpis };
  // A rev D document proposed for release: the release withdraws rev C ("Withdrawal" note).
  const c2 = make({ dv: { open: 'PID-HLT-026' }, engOv: { ...new ctx.__C({}).state.engOv, docs: { 'PID-HLT-026': 'Release proposed' } } });
  out.pidProposed = drawer(valsOf(c2, lang));
  valsOf(c2, 'en').doc.approve();
  valsOf(c2, 'en').doc.approve();
  out.pidReleased = drawer(valsOf(c2, lang));

  // Deposit dialog: default draft, a new revision from the drawer, the PLM part context, other types / projects.
  const dep0 = new ctx.__C({}).state.dv.dep;
  out.deposit = {
    default: deposit(render({ dv: { dep: { ...dep0, open: true } } }, lang)),
    revision: deposit(render({ dv: { dep: { ...dep0, open: true, type: 'PID', proj: 'HLT-026', link: 'D-016', part: '', ctx: 'PID-HLT-026 · new revision E' } } }, lang)),
    part: deposit(render({ dv: { dep: { ...dep0, open: true, type: 'CER', link: '', part: 'EL-VFD-200' } } }, lang)),
    rptEmpty: deposit(render({ dv: { dep: { ...dep0, open: true, type: 'RPT', link: '', part: '' } } }, lang)),
    ndcPv: deposit(render({ dv: { dep: { ...dep0, open: true, type: 'PV', proj: 'NDC-031' } } }, lang)),
    qmsRec: deposit(render({ dv: { dep: { ...dep0, open: true, type: 'REC', proj: 'QMS' } } }, lang)),
  };
  // finish(): the new record (title literal, author short name of the persona, tags, links).
  const c3 = make({ role: 'pm', dv: { dep: { ...dep0, open: true } } });
  valsOf(c3, 'en').dep.handoff();
  const after = valsOf(c3, lang);
  out.afterDeposit = { open: after.doc ? after.doc.id : null, row: pick(plain(after.dvList[0]), ROW_KEYS), sync: after.codexSync, drawer: drawer(after) };

  out.doctypes = plain(render({ screen: 'doctypes' }, lang).docTypesRows).map((t: any) => pick(t, ['code', 'label', 'famLabel', 'circuit', 'retention', 'iso', 'clientText', 'count']));
  return out;
}

/** Template labels of the screens (template 2310–2383, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(2309, 2383).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

const out = { en: build('en'), fr: build('fr'), labels: labels() };
const target = path.join(root, 'src/features/docs/docs.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
