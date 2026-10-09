// Generates src/domain/itpcom.golden.json: the prototype's own render values (`renderVals()`, EN and FR — deepTr applied)
// of the Inspection & test plan · punch list screen (docs/spec/07 §2.4, template 880–892, logic 4938–4951) and of the
// Commissioning & handover dossier (07 §2.6, template 910–920, logic 4969–4977): header (crumb, title, primary, who gets
// it), the ITP sidebar badge, KPI tiles, the plan groups and rows, the punch list rows, the commissioning grid, the
// handover dossier, the three action forms (AF `itp`, `punch`, `commissioning`) and their toasts — for the seed of every
// project and for the transitions the screens offer: punch Start / Close, Add punch item (a category-A item feeds the
// badge and Commissioning's "Blocking A"), Add inspection.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-itpcom.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
const ctx: any = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  window: { addEventListener() {}, removeEventListener() {} },
  React: { createRef: () => ({ current: null }) },
  DCLogic: class {
    props: any;
    state: any;
    constructor(props: any) {
      this.props = props || {};
    }
    setState(p: any) {
      const u = typeof p === 'function' ? p(this.state) : p;
      this.state = { ...this.state, ...u };
    }
  },
};
vm.createContext(ctx);
vm.runInContext(lines.slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component;', ctx);

const plain = (v: any) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === 'mapRef' || typeof x === 'function' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
const LANGS = ['en', 'fr'] as const;

function comp(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'itp', ...state };
  return c;
}

/** Badge of the nav item `id`, wherever the nav tree puts it. */
function findBadge(v: any, id: string): string | null {
  let out: string | null = null;
  const walk = (x: any, d = 0) => {
    if (out !== null || d > 8 || !x || typeof x !== 'object') return;
    if (x.id === id && 'badge' in x) {
      out = x.badge;
      return;
    }
    for (const k of Object.keys(x)) walk(x[k], d + 1);
  };
  walk(v);
  return out;
}

const kpis = (ks: any[]) => plain(ks ?? []).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const ITP_ROW = ['id', 'sys', 'name', 'type', 'typeClass', 'stage', 'ref', 'date', 'status', 'stClass', 'stColor', 'doc', 'hasDoc'];
const PUNCH_ROW = ['id', 'item', 'loc', 'cat', 'catClass', 'src', 'owner', 'due', 'status', 'stClass', 'canAdvance', 'next', 'color'];

function itpSnap(c: any) {
  const v = c.renderVals();
  return {
    crumb: v.crumb,
    title: v.title,
    primary: v.primaryAction,
    hasPrimary: v.hasPrimary,
    badge: findBadge(v, 'itp'),
    seg: plain(v.itpSeg).map((o: any) => pick(o, ['label', 'icon', 'color'])),
    isPlan: v.itpIsPlan,
    isPunch: v.itpIsPunch,
    kpis: kpis(v.itpKpis),
    groups: plain(v.itpBySys).map((g: any) => ({ sys: g.sys, passed: g.passed, count: g.count, rows: g.rows.map((r: any) => pick(r, ITP_ROW)) })),
    noItp: v.noItp,
    punch: plain(v.punchRows).map((r: any) => pick(r, PUNCH_ROW)),
  };
}

function cmSnap(c: any) {
  const v = c.renderVals();
  return {
    crumb: v.crumb,
    title: v.title,
    primary: v.primaryAction,
    hasPrimary: v.hasPrimary,
    hasComm: v.hasComm,
    noComm: v.noComm,
    kpis: kpis(v.cmKpis),
    cols: plain(v.cmCols).map((x: any) => x.label),
    rows: plain(v.cmRows).map((r: any) => ({ sys: r.sys, punchA: r.punchA, cells: r.cells.map((x: any) => pick(x, ['st', 'date', 'bg', 'border', 'color', 'icon'])) })),
    dossier: plain(v.cmDossier).map((d: any) => pick(d, ['item', 'type', 'doc', 'status', 'stClass', 'hasDoc'])),
  };
}

/** Opens the action form `key` (the header primary) and returns its rendered definition. */
function form(state: any) {
  const c = comp(state);
  c.renderVals().primaryOnClick();
  const v = c.renderVals();
  return { ...pick(plain(v.afForm), ['title', 'submit', 'isRun', 'icon']), fields: plain(v.afForm.fields).map((f: any) => ({ ...pick(f, ['id', 'label', 'req', 'value', 'span']), options: f.options.map((o: any) => o.v) })) };
}

/** Submits the open form with `values` (EN state), then reads the toast in `lang`. */
function submitToast(state: any, values: Record<string, string>, lang: 'en' | 'fr') {
  const c = comp({ ...state, lang });
  c.renderVals().primaryOnClick();
  c.setState((s: any) => ({ af: { ...s.af, values: { ...s.af.values, ...values } } }));
  c.renderVals().afSubmit();
  return c.state.toast;
}

const out: any = { itp: {}, commissioning: {}, header: {}, forms: {}, toasts: {}, scenarios: {} };

for (const lang of LANGS) {
  out.itp[lang] = {};
  out.commissioning[lang] = {};
  for (const code of PROJECTS) {
    out.itp[lang][code] = { plan: itpSnap(comp({ lang, project: code })), punch: itpSnap(comp({ lang, project: code, itpView: 'punch' })) };
    out.commissioning[lang][code] = cmSnap(comp({ lang, project: code, screen: 'commissioning' }));
  }
  out.forms[lang] = {
    itp: form({ lang }),
    punch: form({ lang, itpView: 'punch' }),
    commissioning: form({ lang, screen: 'commissioning' }),
    itpNdc: form({ lang, project: 'NDC-031' }),
  };
  out.toasts[lang] = {
    itp: submitToast({}, { name: 'Bolt torque check' }, lang),
    punch: submitToast({ itpView: 'punch' }, { item: 'Missing bolt' }, lang),
    commissioning: submitToast({ screen: 'commissioning' }, {}, lang),
  };
}

// ── Header per role (primary hidden outside the workspace / on a read-only project) ──
for (const screen of ['itp', 'commissioning']) {
  out.header[screen] = {};
  for (const code of ['HLT-026', 'NDC-031']) {
    out.header[screen][code] = {};
    for (const role of ROLES) {
      const v = comp({ role, project: code, screen }).renderVals();
      out.header[screen][code][role] = { hasPrimary: v.hasPrimary, primary: v.primaryAction, readOnly: !!v.readOnly, outside: !!v.outside };
    }
  }
}

// ── Transitions ──
const punchRow = (c: any, id: string) => c.renderVals().punchRows.find((r: any) => r.id === id);
{
  const c = comp({ itpView: 'punch' });
  punchRow(c, 'P-02').advance();
  punchRow(c, 'P-04').advance();
  const s1 = itpSnap(c);
  punchRow(c, 'P-02').advance();
  out.scenarios.advance = { afterStartAndClose: { punch: s1.punch, kpis: s1.kpis }, afterClose: { punch: itpSnap(c).punch, kpis: itpSnap(c).kpis } };
}
{
  // Add a category-A punch item on the structure: the ITP badge and Commissioning's "Blocking A" pick it up.
  const c = comp({ itpView: 'punch' });
  c.renderVals().primaryOnClick();
  c.setState((s: any) => ({ af: { ...s.af, values: { ...s.af.values, item: 'Missing bolt — post 3', loc: 'Structure · Bay 2', cat: 'A — blocking', src: 'SAT', due: '9 Oct' } } }));
  c.renderVals().afSubmit();
  const itp = itpSnap(c);
  c.setState({ screen: 'commissioning' });
  const cm = cmSnap(c);
  c.setState({ screen: 'itp' });
  const p = punchRow(c, 'P-10');
  p.advance();
  const started = itpSnap(c);
  out.scenarios.addPunchA = {
    toast: c.state.toast, row: itp.punch.find((r: any) => r.id === 'P-10'), badge: itp.badge, kpis: itp.kpis,
    cmKpis: cm.kpis, cmPunchA: cm.rows.map((r: any) => r.punchA), afterStartBadge: started.badge,
  };
}
{
  const c = comp();
  c.renderVals().primaryOnClick();
  c.setState((s: any) => ({ af: { ...s.af, values: { ...s.af.values, name: 'Rope end terminations', system: 'Hoist mechanisms', type: 'Witness', stage: 'Site', ref: 'EN 12385', date: '6 Nov' } } }));
  c.renderVals().afSubmit();
  const v = itpSnap(c);
  out.scenarios.addInspection = { kpis: v.kpis, group: v.groups.find((g: any) => g.sys === 'Hoist mechanisms') };
}

fs.writeFileSync(path.join(root, 'src/domain/itpcom.golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/domain/itpcom.golden.json');
