// Generates src/domain/deliveries.golden.json: the prototype's own render values (`renderVals()`, EN and FR) of the
// Deliveries & goods receipt screen (docs/spec/08 §3, template 1598–1657, logic 4447–4467) — KPI tiles, status chips,
// the goods-receipt rows, every delivery drawer, the header (title, crumb, primary, who gets it), the sidebar badge —
// for the seed of every project and for the transitions the screen offers: Register receipt (Announced → QC pending),
// Accept → stock and Reject → quarantine (default remarks and typed remarks), plus the "Delivery — quality check"
// items of My approvals before and after a decision (the inline decision is replayed with an event, as the prototype
// meant it: its own inbox call threw, 08 OQ28).
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-deliveries.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
// The sandbox keeps its own intrinsics (see proto-golden-d3.ts): `deepTr` compares prototypes with the sandbox's Object.
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

const plain = (v: any) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === 'mapRef' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const EV = { stopPropagation() {} };
const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
const LANGS = ['en', 'fr'] as const;

function comp(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'deliveries', ...state };
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

const ROW_KEYS = ['id', 'po', 'supplier', 'date', 'note', 'lines', 'qty', 'acc', 'rej', 'rejColor', 'status', 'tagClass', 'loc', 'qc', 'idColor', 'canReceive', 'canQC'];

function drawerOf(d: any) {
  const x = plain(d);
  return {
    ...pick(x, ['id', 'po', 'supplier', 'status', 'tagClass', 'docs', 'noDocs', 'slotId', 'canQC', 'canReceive']),
    meta: x.meta,
    qc: x.qc,
    lines: x.lines.map((l: any) => pick(l, ['ref', 'name', 'o', 'd', 'a', 'r', 'rColor', 'loc'])),
  };
}

/** Screen snapshot of a component state: header, KPIs, chips, rows, open drawer, sidebar badge. */
function snapshot(c: any) {
  const v = c.renderVals();
  return {
    crumb: v.crumb,
    title: v.title,
    primary: v.primaryAction,
    hasPrimary: v.hasPrimary,
    badge: findBadge(v, 'deliveries'),
    kpis: plain(v.delivKpis).map((k: any) => pick(k, ['label', 'value', 'sub', 'color'])),
    chips: plain(v.delivChips).map((k: any) => pick(k, ['label', 'count', 'bg'])),
    rows: plain(v.delivRows).map((r: any) => pick(r, ROW_KEYS)),
    noDeliv: v.noDeliv,
    drawer: v.showDeliv ? drawerOf(v.deliv) : null,
  };
}

/** Delivery QC items of My approvals for a role (kind, id, title, sub, when, who). */
function inbox(c: any) {
  const v = c.renderVals();
  return plain(v.myApprovals)
    .filter((i: any) => i.kind === 'Delivery — quality check' || i.kind === 'Livraison — contrôle qualité')
    .map((i: any) => pick(i, ['kind', 'id', 'title', 'sub', 'when', 'who']));
}

const out: any = { seed: {}, header: {}, scenarios: {} };

// ── Seed of every project, both languages, every drawer ──
for (const lang of LANGS) {
  out.seed[lang] = {};
  for (const code of PROJECTS) {
    const base = snapshot(comp({ lang, project: code }));
    const drawers: Record<string, unknown> = {};
    for (const r of base.rows) drawers[r.id] = snapshot(comp({ lang, project: code, deliv: r.id })).drawer;
    out.seed[lang][code] = { ...base, drawers };
  }
}

// ── Status filter (chips) ──
out.filters = {};
for (const f of ['Announced', 'Received', 'QC pending', 'Accepted', 'Partially rejected', 'Rejected'])
  out.filters[f] = snapshot(comp({ delivFilter: f })).rows.map((r: any) => r.id);

// ── Header per role (primary hidden outside the workspace / on a read-only project) ──
for (const code of ['HLT-026', 'NDC-031']) {
  out.header[code] = {};
  for (const role of ROLES) {
    const v = comp({ role, project: code }).renderVals();
    out.header[code][role] = { hasPrimary: v.hasPrimary, primary: v.primaryAction, readOnly: !!v.readOnly, outside: !!v.outside };
  }
}

// ── Transitions ──
/** Runs `act(rowsOf(c))` on a fresh component then snapshots the screen with `select` open, in EN and FR. */
function scenario(state: any, act: (c: any) => void, select: string) {
  const res: any = {};
  for (const lang of LANGS) {
    const c = comp({ ...state, lang: 'en' });
    act(c);
    c.setState({ lang, deliv: select });
    res[lang] = snapshot(c);
  }
  return res;
}
const rowOf = (c: any, id: string) => c.renderVals().delivRows.find((r: any) => r.id === id);

out.scenarios.register0540 = scenario({ role: 'procurement' }, (c) => rowOf(c, 'BL-2026-0540').receive(EV), 'BL-2026-0540');
out.scenarios.accept0521 = scenario({ role: 'quality' }, (c) => rowOf(c, 'BL-2026-0521').accept(EV), 'BL-2026-0521');
out.scenarios.accept0521Remarks = scenario(
  { role: 'quality' },
  (c) => {
    c.setState({ delivNote: 'Seals intact · routine test report checked' });
    rowOf(c, 'BL-2026-0521').accept(EV);
  },
  'BL-2026-0521',
);
out.scenarios.reject0521 = scenario({ role: 'procurement' }, (c) => rowOf(c, 'BL-2026-0521').reject(EV), 'BL-2026-0521');
// Register then accept the announced Harbor Line delivery (lines delivered = ordered, location kept).
out.scenarios.registerAccept0540 = scenario(
  { role: 'quality' },
  (c) => {
    rowOf(c, 'BL-2026-0540').receive(EV);
    rowOf(c, 'BL-2026-0540').accept(EV);
  },
  'BL-2026-0540',
);
// A generated receipt of another project ("Magasin chantier — Lyon").
{
  const first = snapshot(comp({ project: 'NDC-031' })).rows.find((r: any) => r.canQC)?.id;
  out.scenarios.acceptNdc = { id: first, ...scenario({ role: 'quality', project: 'NDC-031' }, (c) => rowOf(c, first).accept(EV), first) };
  out.scenarios.rejectNdc = { id: first, ...scenario({ role: 'quality', project: 'NDC-031' }, (c) => rowOf(c, first).reject(EV), first) };
}

// ── My approvals: delivery QC items (quality, procurement), before and after the decision ──
out.inbox = {};
for (const lang of LANGS) {
  out.inbox[lang] = {};
  for (const role of ROLES) out.inbox[lang][role] = inbox(comp({ role, lang, screen: 'myapprovals' }));
  const c = comp({ role: 'quality', screen: 'myapprovals' });
  rowOf(c, 'BL-2026-0521').accept(EV);
  c.setState({ lang });
  out.inbox[lang].qualityAfterAccept = inbox(c);
  for (const code of PROJECTS) out.inbox[lang][`procurement:${code}`] = inbox(comp({ role: 'procurement', lang, project: code, screen: 'myapprovals' }));
}

fs.writeFileSync(path.join(root, 'src/domain/deliveries.golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/domain/deliveries.golden.json');
