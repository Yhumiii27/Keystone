// Generates src/features/admin/admin.golden.json: the prototype's own render values for the three administration screens
// built in Delivery 5 — Settings (`settings`, docs/spec/10 §1, template 1573–1597, logic 4437–4445), Standard machine
// types (`mtypes`, 09 §9, template 1529–1572, logic 5083–5099) and Activity, integrations & audit (`plumbing`, 10 §2,
// template 2237–2267, logic 4692–4718) — in English (`renderValsEN`) and French (`renderVals`, i.e. `deepTr` over the
// English values): header (title, breadcrumb, primary), KPI tiles, cards, lists, segmented controls, chips, tables, the
// template labels (TPL_KEYS through trFR), the add-forms `AF.mtype` / `AF.plumbing`, and the effects of the in-screen
// edits (Settings add / remove / thresholds / reset; machine-type identity, lists and payment pattern; New machine type).
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own intrinsics and a minimal
// component base class.
//   npx tsx scripts/proto-golden-admin.ts
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
const plain = (v: any) => JSON.parse(JSON.stringify(v ?? null));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, plain(o?.[k])]));
const tr = (s: string, lang: Lang) => (lang === 'fr' ? ctx.__trFR(s) : s);

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c;
}
const valsOf = (c: any, lang: Lang) => {
  c.state = { ...c.state, lang };
  return c.renderVals();
};
const ev = (value: string) => ({ target: { value } });

const header = (v: any) => ({ title: v.title, crumb: v.crumb, primary: v.primaryAction ?? null, hasPrimary: !!v.hasPrimary, outside: !!v.outside });
const kpisOf = (ks: any[]) => plain(ks).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const segOf = (xs: any[]) => plain(xs).map((o: any) => pick(o, ['label', 'color', 'shadow', 'bl']));
const chipsOf = (xs: any[]) => plain(xs).map((o: any) => pick(o, ['label', 'count', 'bg', 'border', 'color']));
const formOf = (af: any) => ({
  title: af.title, submit: af.submit, icon: af.icon, canSubmit: af.canSubmit,
  fields: plain(af.fields).map((f: any) => ({ id: f.id, label: f.label, req: f.req, type: f.isSelect ? 'select' : f.isTextarea ? 'textarea' : f.isNumber ? 'number' : 'text', value: f.value, options: (f.options ?? []).map((o: any) => o.v), span: f.span })),
});

// ── Settings ──
const settingsCards = (v: any) =>
  plain(v.settingsCards).map((c: any) => ({ key: c.key, title: c.title, sub: c.sub, icon: c.icon, count: c.count, isLoc: c.isLoc, draft: c.draft, items: c.items.map((i: any) => pick(i, ['label', 'sub', 'hasSub'])) }));
const settingsOf = (v: any) => ({ ...header(v), kpis: kpisOf(v.settingsKpis), health: pick(v.health, ['risk', 'off', 'text']), cards: settingsCards(v), locTypeSeg: segOf(v.locTypeSeg) });

/** Settings after a sequence of edits: [card key, 'add', draft, locType?] | [key, 'remove', index] | ['health', k, value] | ['reset']. */
function settingsAfter(ops: any[][], lang: Lang = 'en') {
  const c = make({ screen: 'settings' });
  for (const op of ops) {
    const v = valsOf(c, 'en');
    if (op[0] === 'reset') { v.primaryOnClick(); continue; }
    if (op[0] === 'health') { (op[1] === 'risk' ? v.health.setRisk : v.health.setOff)(ev(op[2])); continue; }
    if (op[0] === 'locType') { c.setState({ locType: op[1] }); continue; }
    const card = v.settingsCards.find((x: any) => x.key === op[0]);
    if (op[1] === 'add') {
      card.setDraft(ev(op[2]));
      valsOf(c, 'en').settingsCards.find((x: any) => x.key === op[0]).add();
    } else if (op[1] === 'remove') card.items[op[2]].remove();
  }
  const v = valsOf(c, lang);
  return { kpis: kpisOf(v.settingsKpis), health: pick(v.health, ['risk', 'off', 'text']), cards: settingsCards(v).map((x: any) => ({ key: x.key, count: x.count, items: x.items, draft: x.draft })) };
}

// ── Machine types ──
const MT_KEYS = ['code', 'label', 'desc', 'cal', 'stateText', 'toggleLabel', 'dep', 'deliv', 'acc', 'termsOk', 'termsBad', 'termsSum', 'catTotal', 'noRefs', 'noProjects'];
const mtOf = (mt: any) => ({
  ...pick(mt, MT_KEYS),
  calOpts: plain(mt.calOpts),
  phases: plain(mt.phases).map((p: any) => pick(p, ['n', 'name'])),
  cats: plain(mt.cats).map((x: any) => ({ ...pick(x, ['name', 'type', 'budget']), typeOpts: x.typeOpts.map((o: any) => o.v) })),
  itp: plain(mt.itp).map((s: any) => s.name),
  refs: plain(mt.refs).map((r: any) => r.name),
  projects: plain(mt.projects).map((p: any) => ({ name: p.name, code: p.code, status: p.status, open: !!mt.projects.find((x: any) => x.code === p.code).open })),
});
const mtListOf = (v: any) => plain(v.mtList).map((m: any) => pick(m, ['code', 'label', 'sub', 'use', 'active', 'stateText', 'stateClass', 'bg', 'edge', 'custom']));
const mtypesOf = (v: any) => ({ ...header(v), kpis: kpisOf(v.mtKpis), list: mtListOf(v), mt: mtOf(v.mt), mtCanEdit: v.mtCanEdit });

/** Machine types after a sequence of handler calls on the selected type: [mtSel, handler, value?] or ['af', values]. */
function mtypesAfter(ops: any[][], lang: Lang = 'en') {
  const c = make({ screen: 'mtypes' });
  let toast: string | null = null;
  for (const op of ops) {
    if (op[0] === 'af') {
      valsOf(c, 'en');
      c.setState({ af: { open: true, key: 'mtype', values: op[1] } });
      valsOf(c, 'en').afSubmit();
      toast = c.state.toast;
      continue;
    }
    c.setState({ mtSel: op[0] });
    const mt = valsOf(c, 'en').mt;
    const [, h, a, b] = op;
    if (h === 'phase' || h === 'itp') {
      const row = (h === 'phase' ? mt.phases : mt.itp)[a];
      if (b === null) row.remove(); else row.set(ev(b));
    } else if (h === 'cat') {
      const row = mt.cats[a];
      if (b === null) row.remove(); else row[b[0]](ev(b[1]));
    } else if (h === 'ref') mt.refs[a].remove();
    else if (typeof mt[h] === 'function' && a === undefined) mt[h]();
    else mt[h](ev(a));
  }
  const v = valsOf(c, lang);
  return { toast, mtSel: c.state.mtSel, kpis: kpisOf(v.mtKpis), list: mtListOf(v), mt: mtOf(v.mt) };
}

// ── Activity, integrations & audit ──
const ACT_KINDS = ['sync', 'stock', 'comment', 'change', 'snapshot', 'quality', 'request', 'delivery', 'invoice', 'eco', 'client'];
const actRowsOf = (v: any) => plain(v.actRows).map((a: any) => pick(a, ['when', 'who', 'what', 'kind', 'icon']));
function plumbingOf(lang: Lang) {
  const v = valsOf(make({ screen: 'plumbing' }), lang);
  return {
    ...header(v),
    kpis: kpisOf(v.plumbKpis),
    seg: segOf(v.plumbSeg),
    view: v.FL.view,
    source: v.FL.source,
    chips: chipsOf(v.actChips),
    actRows: actRowsOf(v),
    byKind: Object.fromEntries(ACT_KINDS.map((k) => {
      const f = valsOf(make({ screen: 'plumbing', actFilter: k }), lang);
      return [k, { rows: actRowsOf(f).map((r: any) => r.what), chips: chipsOf(f.actChips).map((x: any) => x.bg) }];
    })),
    views: Object.fromEntries(['activity', 'connectors', 'imports', 'audit'].map((t) => {
      const f = valsOf(make({ screen: 'plumbing', plumbTab: t }), lang);
      return [t, { plIsAct: !!f.plIsAct, plIsConn: !!f.plIsConn, plIsImp: !!f.plIsImp, plIsAudit: !!f.plIsAudit, seg: segOf(f.plumbSeg).map((o: any) => o.color) }];
    })),
    connRows: plain(v.connRows).map((r: any) => pick(r, ['name', 'what', 'freq', 'st', 'last', 'vol', 'tagClass'])),
    importRows: plain(v.importRows).map((r: any) => pick(r, ['name', 'desc', 'icon'])),
    auditRows: plain(v.auditRows).map((r: any) => pick(r, ['when', 'who', 'obj', 'change', 'area'])),
    kpisByRole: Object.fromEntries(['director', 'pm'].map((role) => [role, kpisOf(valsOf(make({ screen: 'plumbing', role }), lang).plumbKpis)])),
  };
}

// Template labels of the three screens (TPL_KEYS strings, rendered through trFR in French).
const LABELS = [
  // Settings
  'Project health rules', 'At risk below', 'Off track below', 'Labor rates and multipliers are edited on the', 'Rate cards', 'page (directors and PMs).',
  'Remove', 'Add an entry', 'Add', 'Reset to defaults',
  // Machine types
  'Machine types', 'Standard planning · costs · inspections · financial REX', 'Custom', 'Code', 'Label', 'Default calendar', 'Description',
  'Payment pattern (deposit / delivery / acceptance)', 'Deposit %', 'Delivery %', 'Acceptance %', 'Total', 'Shares must total 100 %', 'Standard phases',
  'Add phase', 'ITP systems', 'Add system', 'Cost categories (reference budget, k€)', 'Add category', 'Category', 'Type', 'Budget',
  'Financial REX · reference projects', 'No reference project yet · the first closed project of this type will feed it', 'Projects using this type',
  'Open project', 'No project of this type yet', 'New machine type', 'Active', 'Inactive', 'Activate', 'Deactivate', 'Labor', 'Material', 'Equipment',
  'Subcontract', 'Fees', 'Standard 5d · 8h', 'Standard 5d · 8h + Atelier', 'Site 6d · 10h', 'Chantier 6d · 10h',
  // Activity, integrations & audit
  'Activity feed', 'Every change across projects, people and connectors · newest first', 'Connectors',
  'Source systems stay the reference — Keystone reads, links and pushes back approved changes', 'System', 'Data', 'Frequency', 'Status', 'Last sync',
  'Last volume', 'Sync now', 'Configure', 'Drop a file or click to choose', 'Audit trail', 'Who changed what, when — immutable, exportable for ISO 9001 audits',
  'When', 'Who', 'Object', 'Change', 'Area', 'Add connector', 'All', 'OK', 'Warning', 'Ready',
];

function build(lang: Lang) {
  const settings = settingsOf(valsOf(make({ screen: 'settings' }), lang));
  const mtypes = mtypesOf(valsOf(make({ screen: 'mtypes' }), lang));
  const types = Object.fromEntries(mtypes.list.map((m: any) => [m.code, mtOf(valsOf(make({ screen: 'mtypes', mtSel: m.code }), lang).mt)]));
  const listSelected = Object.fromEntries(mtypes.list.map((m: any) => [m.code, mtListOf(valsOf(make({ screen: 'mtypes', mtSel: m.code }), lang)).map((x: any) => x.bg)]));
  const c = make({ screen: 'mtypes' });
  valsOf(c, 'en');
  c.setState({ af: { open: true, key: 'mtype', values: { code: '', label: '', base: 'EMP', cal: 'Standard 5d · 8h', desc: '' } } });
  const mtypeForm = formOf(valsOf(c, lang).afForm);
  const p = make({ screen: 'plumbing' });
  valsOf(p, 'en');
  p.setState({ af: { open: true, key: 'plumbing', values: { system: 'Sage X3', direction: 'Import', freq: 'Real time', owner: '' } } });
  const plumbingForm = formOf(valsOf(p, lang).afForm);
  return {
    settings,
    mtypes: { ...mtypes, types, listSelected },
    plumbing: plumbingOf(lang),
    forms: { mtype: mtypeForm, plumbing: plumbingForm },
    results: { mtype: tr('Machine type created', lang), duplicate: tr('Code already used', lang), plumbing: tr('Connector added · first sync scheduled', lang) },
    labels: Object.fromEntries(LABELS.map((l) => [l, tr(l, lang)])),
  };
}

const out: any = { en: build('en'), fr: build('fr') };

// Role gates (header primary, outside banner, mtCanEdit) per persona.
out.roles = Object.fromEntries(['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'].map((role) => [role, {
  settings: header(valsOf(make({ screen: 'settings', role }), 'en')),
  mtypes: { ...header(valsOf(make({ screen: 'mtypes', role }), 'en')), mtCanEdit: valsOf(make({ screen: 'mtypes', role }), 'en').mtCanEdit },
  plumbing: header(valsOf(make({ screen: 'plumbing', role }), 'en')),
}]));

// ── Edits (EN) ──
out.settingsEdits = {
  addSkill: settingsAfter([['skills', 'add', '  Welding  ']]),
  addBlank: settingsAfter([['skills', 'add', '   ']]),
  addLocationDefaultType: settingsAfter([['locations', 'add', 'Magasin chantier — Dakar']]),
  addLocationWorkshop: settingsAfter([['locType', 'Workshop'], ['locations', 'add', 'Atelier électrique — Lyon']]),
  removeRisk: settingsAfter([['riskCats', 'remove', 1]]),
  removeLocation: settingsAfter([['locations', 'remove', 4]]),
  addHoliday: settingsAfter([['holidays', 'add', '26 Dec · Saint-Étienne']]),
  thresholds: settingsAfter([['health', 'risk', '0.95'], ['health', 'off', '0.85']]),
  thresholdNaN: settingsAfter([['health', 'off', 'abc']]),
  reset: settingsAfter([['skills', 'add', 'Welding'], ['riskCats', 'remove', 0], ['health', 'risk', '0.95'], ['reset']]),
  frAfterAdd: settingsAfter([['skills', 'add', 'Welding'], ['locType', 'Quarantine (QC hold)'], ['locations', 'add', 'Zone quarantaine — Le Havre']], 'fr'),
};

out.mtypeEdits = {
  deactivate: mtypesAfter([['EMP', 'toggle']]),
  reactivate: mtypesAfter([['EMP', 'toggle'], ['EMP', 'toggle']]),
  identity: mtypesAfter([['MEMU', 'setLabel', 'Modular units'], ['MEMU', 'setCal', 'Site 6d · 10h'], ['MEMU', 'setDesc', 'Standard modular planning']]),
  terms: mtypesAfter([['SPUR', 'setDep', '25'], ['SPUR', 'setDeliv', 'x']]),
  phases: mtypesAfter([['AUTRE', 'addPhase'], ['AUTRE', 'phase', 1, 'Design'], ['AUTRE', 'phase', 0, null]]),
  itp: mtypesAfter([['R&D', 'addItp'], ['R&D', 'itp', 0, null]]),
  cats: mtypesAfter([['EMP', 'addCat'], ['EMP', 'cat', 7, ['setBudget', '40.5']], ['EMP', 'cat', 7, ['setType', 'Equipment']], ['EMP', 'cat', 0, null]]),
  removeRef: mtypesAfter([['EMP', 'ref', 0], ['EMP', 'ref', 0]]),
  createFromMemu: mtypesAfter([['af', { code: ' new type ', label: 'Mobile hoist', base: 'MEMU', cal: 'Chantier 6d · 10h', desc: 'Test' }]]),
  createBlank: mtypesAfter([['af', { code: 'lab', label: 'Lab', base: 'Blank', cal: 'Standard 5d · 8h', desc: '' }]]),
  createDuplicate: mtypesAfter([['af', { code: 'emp', label: 'Duplicate', base: 'EMP', cal: 'Standard 5d · 8h', desc: '' }]]),
};

const file = path.join(root, 'src/features/admin/admin.golden.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, file));
