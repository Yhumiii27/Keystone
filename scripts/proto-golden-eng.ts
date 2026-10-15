// Generates src/features/eng/eng.golden.json: the prototype's own render values for the Engineering synthesis and the
// four discipline screens (KPI tiles, "Who is waiting for what" matrix, discipline cards, gate, recent changes; per
// discipline the header, KPI tiles, inputs, deliverables, generated outputs, consistency checks and their chips), the
// import wizard (every preset, every step, the tool choice) and the sidebar badges — in English (`renderValsEN`) and
// French (`renderVals`, i.e. `deepTr` over the English values) — for the default state and after each step of a
// sequence played with the prototype's own handlers (confirm an input, resolve / send back a check, import with the
// wizard, freeze / propose / validate a deliverable, generate an output, until no blocking check is left). Also the
// template labels (2384–2471) and the header / filter strings with their prototype French.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-eng.ts
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
// E-5 = a (docs/DECISIONS.md, Delivery 7 R-105): the latest frozen or released revision is the reference of an
// engineering input — the prototype took only a Released one (`inRows` 4794), so a Frozen LST-IO-026 rev B read
// "latest rev A". The rule is applied to the prototype logic before it runs, so every derived value follows.
const E5_FROM = "(eo.docs[d.id]||d.status)==='Released'?d.rev:prevRev(d.rev)";
const E5_TO = "['Frozen','Release proposed','Released','Obsolete'].includes(eo.docs[d.id]||d.status)?d.rev:prevRev(d.rev)";
const applyE5 = (src: string) => {
  if (!src.includes(E5_FROM)) throw new Error('E-5 patch: inRows rule not found');
  return src.replace(E5_FROM, E5_TO);
};
vm.runInContext(
  `class DCLogic { constructor(p) { this.props = p || {}; } setState(p) { const u = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...u }; } }\n` +
    applyE5(lines.slice(3095, 5239).join('\n')) +
    '\n;globalThis.__C = Component; globalThis.__trFR = trFR;',
  ctx,
);

type Lang = 'en' | 'fr';
const DISCS = ['process', 'meca', 'elec', 'auto'] as const;
const plain = (v: any) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c;
}
/** Render values of component `c` on `screen` in `lang` (the component's state is kept). */
function valsOf(c: any, screen: string, lang: Lang, extra: any = {}) {
  c.state = { ...c.state, screen, lang, ...extra };
  return c.renderVals();
}

const kpis = (ks: any[]) => plain(ks).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));

function synthesis(v: any) {
  const p = plain(v);
  return {
    isEngProj: p.isEngProj,
    kpis: kpis(p.engKpis),
    from: p.engFrom.map((f: any) => f.label),
    matrix: p.engMatrix.map((r: any) => ({
      label: r.label,
      cells: r.cells.map((c: any) => ({ bg: c.bg, items: c.items.map((i: any) => pick(i, ['label', 'sub', 'color', 'border', 'dot', 'dotBorder'])) })),
    })),
    discCards: p.engDiscCards.map((d: any) => pick(d, ['label', 'icon', 'lead', 'tools', 'pct', 'relText', 'openText', 'openColor'])),
    gate: {
      cls: p.engGateClass,
      text: p.engGateText,
      items: p.engGateItems.map((c: any) => ({ ...pick(c, ['id', 'title', 'ruleLabel', 'lead', 'status', 'stClass', 'sevDot']), disc: c.disc })),
    },
    changes: p.engChanges.map((c: any) => pick(c, ['date', 'text', 'impact'])),
  };
}

function discipline(v: any) {
  const p = plain(v);
  return {
    head: p.engD,
    kpis: kpis(p.engDKpis),
    inputs: p.engDIn.map((r: any) => pick(r, ['doc', 'title', 'from', 'revText', 'latestText', 'revColor', 'state', 'stClass', 'canConfirm', 'canImport'])),
    docs: p.engDDocs.map((d: any) =>
      pick(d, ['id', 'title', 'date', 'by', 'rev', 'status', 'stClass', 'toText', 'canFreeze', 'canPropose', 'proposeBlocked', 'blockedText', 'canValidate']),
    ),
    outputs: p.engDOut.map((o: any) => pick(o, ['id', 'name', 'toText', 'source', 'genText', 'state', 'stateText', 'stClass', 'canGen'])),
    checks: p.engDChk.map((c: any) =>
      pick(c, ['id', 'title', 'detail', 'ruleLabel', 'ownerLabel', 'lead', 'note', 'sevDot', 'sevLabel', 'sevClass', 'status', 'stClass', 'color', 'canAct']),
    ),
    chips: p.engChkChips.map((s: any) => pick(s, ['label', 'count', 'bg', 'border', 'color'])),
  };
}

/** Sidebar entries of the engineering screens: { id: badge }. */
function badges(v: any) {
  const out: Record<string, string> = {};
  const seen = new Set<any>();
  const walk = (x: any, depth: number) => {
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 6) return;
    seen.add(x);
    if (Array.isArray(x)) return x.forEach((y) => walk(y, depth + 1));
    if (typeof x.id === 'string' && /^(eng|eng-(process|meca|elec|auto))$/.test(x.id) && 'badge' in x) out[x.id] = x.badge;
    for (const k of Object.keys(x)) walk(x[k], depth + 1);
  };
  walk(plain(v), 0);
  return out;
}

function wizard(v: any) {
  const w = plain(v.engImp);
  return {
    open: v.engImpOpen,
    target: w.target,
    file: w.file,
    steps: w.steps.map((s: any) => pick(s, ['label', 'n', 'color', 'dot'])),
    tools: w.tools.map((t: any) => pick(t, ['label', 'disc', 'bg', 'border', 'dot'])),
    map: w.map,
    stats: w.stats,
    deltas: w.deltas,
    is1: w.is1,
    is2: w.is2,
    is3: w.is3,
    canBack: w.canBack,
    canNext: w.canNext,
  };
}

/** Everything the five screens show for the component's current state. */
function screens(c: any, lang: Lang, chkFilters = false) {
  const out: any = { synthesis: synthesis(valsOf(c, 'eng', lang)), badges: badges(valsOf(c, 'eng', lang)), disciplines: {} };
  for (const k of DISCS) {
    out.disciplines[k] = discipline(valsOf(c, 'eng-' + k, lang, { engChkF: null }));
    if (chkFilters) {
      out.disciplines[k].filters = Object.fromEntries(
        ['open', 'Sent back', 'Resolved'].map((f) => [f, plain(valsOf(c, 'eng-' + k, lang, { engChkF: f }).engDChk).map((x: any) => x.id)]),
      );
    }
  }
  c.state = { ...c.state, engChkF: null };
  return out;
}

/** Calls a handler of a list item found in the render values of `screen`, then returns the component. */
function act(c: any, screen: string, list: string, key: string, idValue: string, handler: string) {
  const v = valsOf(c, screen, 'en');
  const item = v[list].find((x: any) => x[key] === idValue);
  if (!item) throw new Error(`${list}: ${idValue} not found on ${screen}`);
  item[handler]();
  return c;
}

/** Runs the wizard: opens it for disc/doc/tool (the prototype's `openImp` preset or an explicit tool), steps to 3, finishes. */
function importWith(c: any, disc: string, doc: string, tool: number) {
  c.state = { ...c.state, engImp: { ...c.state.engImp, open: true, step: 3, disc, doc, tool } };
  const v = valsOf(c, 'eng-' + disc, 'en');
  v.engImp.finish();
  return c;
}

/**
 * One sequence of actions on the register, each with the prototype's own handler, snapshotting after every step the
 * Synthesis, the screen of the discipline acted on and the badges — so a single database can replay it (data layer
 * writers) and compare after each step.
 */
type Step = { name: string; disc: string; run: (c: any) => void };
const SEQUENCE: Step[] = [
  { name: 'confirm meca PID-HLT-026', disc: 'meca', run: (c) => act(c, 'eng-meca', 'engDIn', 'doc', 'PID-HLT-026', 'confirm') },
  { name: 'resolve C-01', disc: 'elec', run: (c) => act(c, 'eng-elec', 'engDChk', 'id', 'C-01', 'resolve') },
  { name: 'send back C-03', disc: 'elec', run: (c) => act(c, 'eng-elec', 'engDChk', 'id', 'C-03', 'sendBack') },
  { name: 'import elec LST-INS-026', disc: 'elec', run: (c) => importWith(c, 'elec', 'LST-INS-026', 0) },
  { name: 'freeze SCH-ELE-026', disc: 'elec', run: (c) => act(c, 'eng-elec', 'engDDocs', 'id', 'SCH-ELE-026', 'freeze') },
  { name: 'propose BOM-MEC-026', disc: 'meca', run: (c) => act(c, 'eng-meca', 'engDDocs', 'id', 'BOM-MEC-026', 'propose') },
  { name: 'validate BOM-MEC-026', disc: 'meca', run: (c) => act(c, 'eng-meca', 'engDDocs', 'id', 'BOM-MEC-026', 'validate') },
  { name: 'generate O-01', disc: 'process', run: (c) => act(c, 'eng-process', 'engDOut', 'id', 'O-01', 'gen') },
  { name: 'import auto LST-IO-026', disc: 'auto', run: (c) => importWith(c, 'auto', 'LST-IO-026', 2) },
  { name: 'resolve C-02', disc: 'auto', run: (c) => act(c, 'eng-auto', 'engDChk', 'id', 'C-02', 'resolve') },
  { name: 'send back C-04', disc: 'auto', run: (c) => act(c, 'eng-auto', 'engDChk', 'id', 'C-04', 'sendBack') },
  { name: 'propose SCH-ELE-026', disc: 'elec', run: (c) => act(c, 'eng-elec', 'engDDocs', 'id', 'SCH-ELE-026', 'propose') },
  { name: 'validate SCH-ELE-026', disc: 'elec', run: (c) => act(c, 'eng-elec', 'engDDocs', 'id', 'SCH-ELE-026', 'validate') },
  { name: 'generate O-03', disc: 'elec', run: (c) => act(c, 'eng-elec', 'engDOut', 'id', 'O-03', 'gen') },
  { name: 'confirm elec LST-INS-026', disc: 'elec', run: (c) => act(c, 'eng-elec', 'engDIn', 'doc', 'LST-INS-026', 'confirm') },
  { name: 'import process GA-HLT-026', disc: 'process', run: (c) => importWith(c, 'process', 'GA-HLT-026', 1) },
  { name: 'propose FDS-HLT-026', disc: 'auto', run: (c) => act(c, 'eng-auto', 'engDDocs', 'id', 'FDS-HLT-026', 'propose') },
];

function sequence(lang: Lang) {
  const c = make();
  return SEQUENCE.map((st) => {
    st.run(c);
    return {
      name: st.name,
      disc: st.disc,
      synthesis: synthesis(valsOf(c, 'eng', lang)),
      badges: badges(valsOf(c, 'eng', lang)),
      discipline: discipline(valsOf(c, 'eng-' + st.disc, lang, { engChkF: null })),
    };
  });
}

/** Import-wizard values: header presets (logic 5137), body buttons (`openImp`), every step, the tool choice. */
function wizards(lang: Lang) {
  const out: any = { presets: {}, body: {}, steps: {}, toolChoice: null, closed: null };
  // Header primary: synthesis keeps the previous wizard state (initial: elec / LST-INS-026 / tool 2); the discipline
  // screens preset it.
  const primary: Record<string, any> = {
    eng: {},
    'eng-process': { disc: 'process', doc: 'GA-HLT-026', tool: 1 },
    'eng-meca': { disc: 'meca', doc: 'LST-INS-026', tool: 0 },
    'eng-elec': { disc: 'elec', doc: 'LST-INS-026', tool: 0 },
    'eng-auto': { disc: 'auto', doc: 'LST-INS-026', tool: 0 },
  };
  for (const [screen, preset] of Object.entries(primary)) {
    const c = make({ screen });
    c.state = { ...c.state, engImp: { ...c.state.engImp, open: true, step: 1, ...preset } };
    out.presets[screen] = { state: plain(c.state.engImp), vals: wizard(valsOf(c, screen, lang)) };
  }
  // Body "Import a list" (`openEngImp`) per discipline screen.
  for (const k of DISCS) {
    const c = make({ screen: 'eng-' + k });
    valsOf(c, 'eng-' + k, 'en').openEngImp();
    out.body[k] = { state: plain(c.state.engImp), vals: wizard(valsOf(c, 'eng-' + k, lang)) };
  }
  // "Import new rev" on each outdated input.
  out.importNewRev = {};
  for (const k of DISCS) {
    const v = valsOf(make({ screen: 'eng-' + k }), 'eng-' + k, 'en');
    for (const r of v.engDIn.filter((x: any) => x.canImport)) {
      const c = make({ screen: 'eng-' + k });
      valsOf(c, 'eng-' + k, 'en').engDIn.find((x: any) => x.doc === r.doc).openImport();
      out.importNewRev[`${k}|${r.doc}`] = { state: plain(c.state.engImp), vals: wizard(valsOf(c, 'eng-' + k, lang)) };
    }
  }
  // Steps 1 → 3 (Next) and back.
  const c = make({ screen: 'eng-elec' });
  valsOf(c, 'eng-elec', 'en').openEngImp();
  for (const step of [1, 2, 3]) {
    out.steps[step] = wizard(valsOf(c, 'eng-elec', lang));
    if (step < 3) valsOf(c, 'eng-elec', 'en').engImp.next();
  }
  valsOf(c, 'eng-elec', 'en').engImp.back();
  out.back = wizard(valsOf(c, 'eng-elec', lang));
  // Choosing another tool.
  const c2 = make({ screen: 'eng-elec' });
  valsOf(c2, 'eng-elec', 'en').openEngImp();
  valsOf(c2, 'eng-elec', 'en').engImp.tools[3].onClick();
  out.toolChoice = wizard(valsOf(c2, 'eng-elec', lang));
  // Close resets the step.
  valsOf(c2, 'eng-elec', 'en').engImp.next();
  valsOf(c2, 'eng-elec', 'en').closeEngImp();
  out.closed = plain(c2.state.engImp);
  return out;
}

function build(lang: Lang) {
  const out: any = { default: screens(make(), lang, true), sequence: sequence(lang), wizard: wizards(lang), otherProject: {} };
  // The import of the instrument list by Automation, which does not consume it yet (English only).
  if (lang === 'en') {
    const c = make();
    importWith(c, 'auto', 'LST-INS-026', 0);
    out.importAutoInstrumentList = screens(c, lang);
  }
  // A project without an engineering register: the empty state and no badge.
  const c = make({ project: 'NDC-031' });
  const v = plain(valsOf(c, 'eng', lang));
  out.otherProject = { isEngProj: v.isEngProj, engNotProj: v.engNotProj, badges: badges(v) };
  return out;
}

/** Template labels of the screens and the wizard (template 2384–2471, «…» in the annotated template) and their prototype French. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(2383, 2471).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

/** Header, nav and filter strings used by the screens (titles, nav labels, FL.status, primary) and their prototype French. */
function extraLabels() {
  const set = [
    'Engineering synthesis', 'Process engineering', 'Mechanical engineering', 'Electrical engineering', 'Automation engineering', 'Synthesis', 'Process',
    'Mechanical', 'Electrical', 'Automation', 'Project · Project engineering', 'Import a list', 'Status', 'All', 'Open', 'Sent back', 'Resolved',
    'Generated today · xlsx', 'Resolved in Keystone', 'Sent back to tool · closes on next import', 'Closed by import of rev D', 'Closed by import of rev C',
    'Closed by import of rev B',
  ];
  return Object.fromEntries(set.map((s) => [s, ctx.__trFR(s)]));
}

const out = { en: build('en'), fr: build('fr'), labels: labels(), extra: extraLabels() };
const target = path.join(root, 'src/features/eng/eng.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
// Compact JSON: indented, the sequence snapshots make a file of about 1 MB.
fs.writeFileSync(target, JSON.stringify(out) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
