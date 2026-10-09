// Generates src/domain/aftersales.golden.json: the prototype's own render values for the two Warranty & after-sales
// screens — Installed base (`fleet`, docs/spec/07 §2.8, template 948–955) and Warranty claims & interventions (`sav`,
// §2.9, template 956–971; logic 4979–4995) — in English (`renderValsEN`) and French (`renderVals`, i.e. `deepTr` over
// the English values), for every zone filter (All zones, Europe & North America, Africa, Asia Pacific) and every
// claims view (Claims, Interventions, Costs per machine): KPI tiles, rows with their tag classes and colours, the zone
// bar counts, the crumb, the nav badge, the primary action per role, the two add-forms (AF `fleet`, AF `sav`) and the
// effect of submitting them (rows, KPIs, badge, toast).
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own intrinsics (deepTr only
// walks plain objects of its own realm) and a minimal component base class.
//   npx tsx scripts/proto-golden-aftersales.ts
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
const ZONES = [null, 'euna', 'afr', 'apac'] as const;
const VIEWS = ['claims', 'interventions', 'costs'] as const;
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];

function make(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'fleet', ...state };
  return c;
}
const valsOf = (c: any, lang: Lang) => {
  c.state = { ...c.state, lang };
  return c.renderVals();
};

const kpisOf = (ks: any[]) => plain(ks).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const segOf = (xs: any[]) => plain(xs).map((o: any) => pick(o, ['label', 'icon', 'color', 'shadow', 'bl']));
const FLEET_KEYS = ['id', 'type', 'name', 'client', 'gen', 'status', 'stClass', 'proj', 'site', 'delivered', 'wend', 'wendColor', 'wendSub', 'open', 'openText', 'openColor', 'hasCfg', 'cfgItems', 'cost'];
const CLAIM_KEYS = ['id', 'mch', 'mname', 'client', 'color', 'issue', 'hasEco', 'eco', 'sev', 'sevClass', 'date', 'status', 'stClass', 'cover', 'coverClass', 'cost', 'costText', 'owner', 'next'];
const IV_KEYS = ['id', 'mch', 'mname', 'site', 'date', 'tech', 'type', 'dur', 'status', 'stClass'];
const COST_KEYS = ['id', 'name', 'client', 'status', 'claims', 'warrantyCost', 'chargeable', 'barW'];

/** The ECO opened by a machine's configuration tags (`openEcoScreen(cfg.first)`). */
function ecoOpenedBy(c: any, lang: Lang, id: string): string | null {
  const row = valsOf(c, lang).fleetRows.find((r: any) => r.id === id);
  if (!row?.openEco) return null;
  const saved = c.state;
  row.openEco();
  const eco = c.state.eco;
  c.state = saved;
  return eco;
}

function fleet(c: any, lang: Lang) {
  const v = valsOf(c, lang);
  return {
    crumb: v.crumb, title: v.title, kpis: kpisOf(v.fleetKpis), zoneSeg: plain(v.zoneSeg).map((o: any) => [o.label, o.count]),
    zoneOwnerLabel: v.zoneOwnerLabel, zoneOwnerName: v.zoneOwnerName,
    rows: plain(v.fleetRows).map((r: any) => ({ ...pick(r, FLEET_KEYS), firstEco: ecoOpenedBy(c, lang, r.id) })),
    zoneEmpty: v.zoneEmptyFleet, zoneEmptyText: v.zoneEmptyText, badge: plain(v.navSav)[1].badge,
  };
}

function sav(c: any, lang: Lang) {
  const v = valsOf(c, lang);
  return {
    crumb: v.crumb, title: v.title, seg: segOf(v.savSeg), kpis: kpisOf(v.savKpis), zoneEmpty: v.zoneEmptySav,
    isClaims: v.savIsClaims, isIv: v.savIsIv, isCosts: v.savIsCosts,
    // The register of the view on show (the prototype computes all three).
    ...(v.savIsClaims ? { claims: plain(v.claimRows).map((r: any) => pick(r, CLAIM_KEYS)) } : {}),
    ...(v.savIsIv ? { interventions: plain(v.ivRows).map((r: any) => pick(r, IV_KEYS)) } : {}),
    ...(v.savIsCosts ? { costs: plain(v.savCostRows).map((r: any) => pick(r, COST_KEYS)) } : {}),
    badge: plain(v.navSav)[1].badge,
  };
}

/** The add-form as the dialog renders it (afForm), after the header's primary action opened it. */
function form(c: any, lang: Lang) {
  valsOf(c, 'en').primaryOnClick();
  const v = valsOf(c, lang);
  return {
    title: v.afForm.title, submit: v.afForm.submit, icon: v.afForm.icon, projectName: v.projectName,
    fields: plain(v.afForm.fields).map((f: any) => ({ id: f.id, label: f.label, req: f.req, type: f.isText ? 'text' : f.isNumber ? 'number' : f.isTextarea ? 'textarea' : 'select', value: f.value, options: (f.options ?? []).map((o: any) => o.v), span: f.span })),
  };
}

/** Opens the screen's add-form, types `values`, submits; returns the screen state and the toast. */
function submit(screen: 'fleet' | 'sav', values: Record<string, string>[], lang: Lang, extra: any = {}) {
  const c = make({ screen, ...extra });
  for (const vals of values) {
    valsOf(c, 'en').primaryOnClick();
    c.setState((s: any) => ({ af: { ...s.af, values: { ...s.af.values, ...vals } } }));
    valsOf(c, 'en').afSubmit();
  }
  const toast = valsOf(c, lang).toast;
  const fl = fleet(make({ screen: 'fleet', added: c.state.added, ...extra }), lang);
  const out: any = { toast, fleet: pick(fl, ['kpis', 'rows', 'zoneSeg', 'badge']), sav: {} };
  for (const view of ['claims', 'costs'] as const) out.sav[view] = sav(make({ screen: 'sav', savView: view, added: c.state.added, ...extra }), lang);
  return out;
}

const NEW_MACHINE = { name: 'Gantry crane 50 t — quay 4', type: 'MEMU', client: 'Port authority', site: 'Abidjan · quay 1', delivered: '1 Oct 2026', warranty: '30 Sep 2028' };
const BARE_MACHINE = { name: 'Rail spur set — yard 2', client: 'Transit BU' };
const NEW_CLAIM = { machine: 'MCH-044 · Gantry crane 45 t — quay 3', issue: 'Hoist overload trip at 30 t', sev: 'Critical', cover: 'Extended warranty', owner: 'S. Haddad', desc: 'Overload relay trips under nominal load' };
const MINOR_CLAIM = { issue: 'Cabin door seal worn' };

function build(lang: Lang) {
  const out: any = { fleet: {}, sav: {} };
  for (const z of ZONES) {
    const key = z ?? 'all';
    out.fleet[key] = fleet(make({ screen: 'fleet', pfZone: z }), lang);
    out.sav[key] = Object.fromEntries(VIEWS.map((view) => [view, sav(make({ screen: 'sav', pfZone: z, savView: view }), lang)]));
  }
  out.forms = { fleet: form(make({ screen: 'fleet' }), lang), sav: form(make({ screen: 'sav' }), lang) };
  out.added = {
    machine: submit('fleet', [NEW_MACHINE], lang),
    bareMachine: submit('fleet', [BARE_MACHINE], lang),
    machineInAfrica: submit('fleet', [NEW_MACHINE], lang, { pfZone: 'afr' }),
    claim: submit('sav', [NEW_CLAIM], lang),
    twoClaims: submit('sav', [NEW_CLAIM, MINOR_CLAIM], lang),
  };
  return out;
}

const out: any = { en: build('en'), fr: build('fr') };

// Primary header action and its visibility per role (hasPrimary: hidden outside the workspace).
out.primary = Object.fromEntries(
  (['fleet', 'sav'] as const).map((screen) => [screen, Object.fromEntries(ROLES.map((role) => {
    const v = valsOf(make({ screen, role }), 'en');
    return [role, { label: v.primaryAction, hasPrimary: v.hasPrimary, outside: !!v.outside }];
  }))]),
);
out.inputs = { NEW_MACHINE, BARE_MACHINE, NEW_CLAIM, MINOR_CLAIM };

/** Template labels of the two screens («…» in the annotated template) and the prototype French of the texts they show. */
function labels() {
  const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(947, 971).join('\n');
  const set = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
  const extra = [
    'Installed base', 'Warranty claims & interventions', 'Warranty & after-sales', 'Add machine', 'New claim', 'Display', 'Zone',
    'In warranty', 'Out of warranty', 'Open', 'Diagnosed', 'Intervention planned', 'Closed', 'Planned', 'Done', 'Minor', 'Major', 'Critical',
    'Warranty', 'Extended warranty', 'Chargeable', 'Corrective', 'Diagnosis', 'Preventive', 'Type',
  ];
  return Object.fromEntries([...set, ...extra].map((s) => [s, ctx.__trFR(s)]));
}
out.labels = labels();

const target = path.join(root, 'src/domain/aftersales.golden.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
