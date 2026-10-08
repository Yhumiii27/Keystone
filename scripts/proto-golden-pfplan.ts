// Generates src/domain/pfplan.golden.json: the prototype's own render values of the Portfolio schedule (`pfplan`,
// docs/spec/05 §3, template 972–1023, logic 4523–4555) for every zone, in EN (`renderValsEN`) and FR (`renderVals`,
// i.e. deepTr over the EN values + the translated template keys). The prototype logic (design file lines 3096–5239)
// runs in a node:vm sandbox with its own intrinsics (deepTr checks `Object.prototype`, so host built-ins must not
// be injected). The screen does not depend on the role (director and PM give the same values). `scenarios` holds the
// same screen after a stage change or a project creation (checked on the database by pfplan.scenarios.test.ts).
//   npx tsx scripts/proto-golden-pfplan.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
/** A fresh prototype instance: its logic evaluated in a new sandbox; returns the Component class. */
const load = () => {
  const ctx: any = {
    console,
    window: { addEventListener() {}, removeEventListener() {} },
    React: { createRef: () => ({ current: null }) },
    DCLogic: class {
      props: any; state: any;
      constructor(props: any) { this.props = props || {}; }
      setState(p: any) { const u = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...u }; }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(lines.slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component;', ctx);
  return ctx.__C;
};
const Component = load();

const render = (state: any) => {
  const c = new Component({});
  c.state = { ...c.state, role: 'director', project: 'HLT-026', screen: 'pfplan', ...state };
  return c.renderVals();
};
const plain = (v: any) => JSON.parse(JSON.stringify(v));
/** Template keys of lines 972–1023 (Finish, Project, Baseline finish, Portfolio schedule, sub, legend, Next decision, Status). */
const TPL = [112, 14, 812, 813, 814, 815, 816, 817, 818, 819, 820, 94];

const out: any = {};
for (const lang of ['en', 'fr']) {
  const base = render({ lang });
  out[lang] = {
    title: base.title,
    stageLabel: base.FL.stage,
    segCtl: plain(base.pgSegCtl).map((o: any) => o.label),
    months: plain(base.pgMonths),
    todayL: base.pgTodayL,
    zoneEmptyText: base.zoneEmptyText,
    tpl: Object.fromEntries(TPL.map((k) => ['k' + k, base.T['k' + k]])),
    /** Full rows by project code (zone-independent: every zone renders the same row for a project). */
    rows: {} as any,
    zones: {} as any,
  };
  for (const z of [null, 'euna', 'afr', 'apac']) {
    const v = render({ lang, pfZone: z });
    out[lang].zones[String(z)] = {
      crumb: v.crumb,
      zoneEmpty: v.zoneEmptyPg,
      kpis: plain(v.pgKpis),
      groups: plain(v.pgGroups).map((g: any) => {
        for (const r of g.rows) {
          const seen = out[lang].rows[r.code];
          if (seen && JSON.stringify(seen) !== JSON.stringify(r)) throw new Error(`row ${r.code} differs between zones`);
          out[lang].rows[r.code] = r;
        }
        return { key: g.key, label: g.label, count: g.count, codes: g.rows.map((r: any) => r.code) };
      }),
      filters: Object.fromEntries(['all', 'exec', 'pipe'].map((f) => [f, plain(render({ lang, pfZone: z, pgFilter: f }).pgGroups).map((g: any) => g.key)])),
    };
  }
}

// Mutation scenarios (no zone, filter All). Each render runs in a fresh prototype instance (npCreate bumps the
// module-level PROJ_ID counters). A stage change is the prototype's `advance` (logic 3922: new status, history entry
// dated 25 Sep 2026); "new-project" is the New project wizard's own npCreate (3969) with a name and a client.
// Only the rows that differ from the seed render are stored.
const advance = (code: string, to: string) => (s: any) => ({
  projects: s.projects.map((x: any) => (x.code === code ? { ...x, status: to, isNew: false } : x)),
  stageHist: { ...s.stageHist, [code]: [...(s.stageHist[code] || []), [to, '25 Sep 2026', 'auto', '']] },
});
const SCENARIOS: Record<string, { code: string; to: string } | { create: { name: string; client: string } }> = {
  'aps-EWA-051': { code: 'EWA-051', to: 'APS' },
  'etudes-WSA-044': { code: 'WSA-044', to: 'Etudes' },
  'etudes-CER-047': { code: 'CER-047', to: 'Etudes' },
  'annule-RCF-019': { code: 'RCF-019', to: 'Annulé' },
  'new-project': { create: { name: 'Test plant', client: 'Port authority' } },
};
out.scenarios = {};
for (const [key, sc] of Object.entries(SCENARIOS)) {
  out.scenarios[key] = { ...sc };
  for (const lang of ['en', 'fr']) {
    const c = new (load())({});
    c.state = { ...c.state, role: 'director', project: 'HLT-026', screen: 'pfplan', lang };
    if ('create' in sc) {
      c.state = { ...c.state, np: { ...c.state.np, ...sc.create } };
      c.renderVals().npCreate();
      c.state = { ...c.state, screen: 'pfplan' };
      out.scenarios[key].project = c.state.projects[0];
    } else c.state = { ...c.state, ...advance(sc.code, sc.to)(c.state) };
    const v = c.renderVals();
    const groups = plain(v.pgGroups);
    // Rows identical to the seed render (`rows`) are not repeated.
    const changed = Object.fromEntries(
      groups.flatMap((g: any) => g.rows).filter((r: any) => JSON.stringify(r) !== JSON.stringify(out[lang].rows[r.code])).map((r: any) => [r.code, r]),
    );
    out.scenarios[key][lang] = {
      kpis: plain(v.pgKpis),
      groups: groups.map((g: any) => ({ key: g.key, label: g.label, count: g.count, codes: g.rows.map((r: any) => r.code) })),
      rows: changed,
    };
  }
}

const target = path.join(root, 'src/domain/pfplan.golden.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
