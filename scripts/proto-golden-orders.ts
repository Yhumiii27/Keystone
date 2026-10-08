// Generates src/features/orders/orders.golden.json: the prototype's own render values (`renderVals`, i.e.
// renderValsEN + the FR deep translation) of the Purchase orders screen (`orders`, template 2615–2688, logic
// 4306–4337) in EN and FR, for every project of the switcher (+ EWA-051, which has no orders), with:
// - KPI tiles, status chips (every filter), table rows, BOM shortfall banner and the header primary action;
// - the order drawer of every order;
// - the BOM shortfall assistant (`createDrafts`) run on each project with a shortfall (drawers of the drafts), then
//   the first draft sent for approval and approved, and PO-1082 cancelled from My approvals (poOverrides);
// - the static template labels («…», EN source) with their FR rendering.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with the sandbox's own intrinsics (the
// FR deep translation checks `Object.getPrototypeOf(v) === Object.prototype`, so host built-ins must not be injected).
// Quantities use `toLocaleString()` without a locale in the prototype (browser default): node's default (en-US) here.
//   npx tsx scripts/proto-golden-orders.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const design = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
const ctx: any = {
  console,
  window: { addEventListener() {}, removeEventListener() {} },
  React: { createRef: () => ({ current: null }) },
};
vm.createContext(ctx);
vm.runInContext(
  `class DCLogic { constructor(props) { this.props = props || {}; } setState(p) { const u = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...u }; } }\n` +
    design.slice(3095, 5239).join('\n') +
    '\n;globalThis.__C = Component; globalThis.__tr = s => fixEnt(trFR(s));',
  ctx,
);

const make = (state: any = {}) => {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'orders', ...state };
  return c;
};
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const LANGS = ['en', 'fr'] as const;
const PO_FLOW = ['Draft', 'Awaiting approval', 'Ordered', 'Partially received', 'Received', 'Cancelled'];
const ROW_KEYS = ['id', 'idColor', 'supplier', 'lineSummary', 'lineCount', 'value', 'status', 'tagClass', 'ordered', 'expected', 'expColor', 'need', 'risk', 'riskColor', 'canSubmit', 'canApprove'];

/** Everything the Orders screen renders from one state. */
function screen(c: any) {
  const v = c.renderVals();
  return {
    kpis: plain(v.poKpis),
    chips: plain(v.poChips).map((x: any) => pick(x, ['label', 'count', 'bg', 'border', 'color'])),
    title: v.poTitle,
    noPOs: v.noPOs,
    rows: plain(v.poRows).map((r: any) => pick(r, ROW_KEYS)),
    hasShortfall: v.hasShortfall,
    shortfall: plain(v.shortfall).map((s: any) => [s.ref, s.qty]),
    shortfallTitle: v.shortfallTitle,
    shortfallSub: v.shortfallSub,
    primary: v.primaryAction,
    hasPrimary: v.hasPrimary,
    statusNote: v.FL ? v.FL.status : null,
  };
}

/** The order drawer of `id` (poVals 4331–4337). */
function drawer(c: any, id: string) {
  const prev = c.state.po;
  c.state = { ...c.state, po: id };
  const d = plain(c.renderVals().po);
  c.state = { ...c.state, po: prev };
  return {
    ...pick(d, ['id', 'supplier', 'status', 'tagClass', 'hasWarn', 'warn']),
    steps: d.steps,
    lines: d.lines.map((l: any) => pick(l, ['ref', 'name', 'qty', 'recv', 'price', 'total', 'pstatus', 'tagClass'])),
    meta: d.meta,
  };
}

/** Screen + the drawers of `ids` (default: every row). */
function snapshot(c: any, ids?: string[]) {
  const s = screen(c);
  return { ...s, drawers: Object.fromEntries((ids ?? s.rows.map((r: any) => r.id)).map((id: string) => [id, drawer(c, id)])) };
}

const out: any = { labels: {}, projects: {}, filters: {}, drafts: {}, flow: {}, selected: {}, roles: {} };

// ── Static template labels (template 2615–2688, «…» = EN source) ──
const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(2614, 2688).join('\n');
const labels = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
for (const en of [...labels, 'Purchase orders', 'New purchase order', 'Status', 'All', ...PO_FLOW, 'Approved', 'Not yet', 'To confirm', 'Delivered']) out.labels[en] = ctx.__tr(en);

for (const lang of LANGS) {
  // ── Every project, default state ──
  out.projects[lang] = {};
  for (const project of PROJECTS) out.projects[lang][project] = snapshot(make({ lang, project }));

  // ── Status chips (poFilter) on Harbor Line ──
  out.filters[lang] = {};
  for (const f of PO_FLOW) {
    const s = screen(make({ lang, poFilter: f }));
    out.filters[lang][f] = { chips: s.chips, title: s.title, noPOs: s.noPOs, rows: s.rows.map((r: any) => r.id) };
  }

  // ── Selected row (idColor) ──
  out.selected[lang] = screen(make({ lang, po: 'PO-1063' })).rows.map((r: any) => [r.id, r.idColor]);

  // ── BOM shortfall assistant (createDrafts), per project with a shortfall ──
  out.drafts[lang] = {};
  for (const project of PROJECTS) {
    const c = make({ lang, project, poFilter: 'Received' });
    const v0 = c.renderVals();
    if (!v0.hasShortfall) continue;
    v0.createDrafts();
    out.drafts[lang][project] = { draftPOs: plain(c.state.draftPOs), poFilter: c.state.poFilter, ...snapshot(c, c.state.draftPOs.map((d: any) => d.id)) };
  }

  // ── Workflow on Harbor Line: drafts → Send for approval → Approve & order; PO-1082 rejected in My approvals ──
  {
    const c = make({ lang });
    c.renderVals().createDrafts();
    const first = c.state.draftPOs[0].id;
    c.renderVals().poRows.find((r: any) => r.id === first).submit({ stopPropagation() {} });
    const submitted = snapshot(c, [first]);
    c.renderVals().poRows.find((r: any) => r.id === first).approve({ stopPropagation() {} });
    const approved = snapshot(c, [first]);
    // My approvals inline decisions (apprItems 4724): approve → Ordered, reject → Cancelled.
    const inbox = make({ lang, screen: 'myapprovals' });
    const item = inbox.renderVals().myApprovals.find((i: any) => i.id === 'PO-1082');
    item.reject({ stopPropagation() {} });
    const cancelled = snapshot(make({ lang, poOverrides: inbox.state.poOverrides }), ['PO-1082']);
    out.flow[lang] = { first, submitted, approved, cancelledOverrides: plain(inbox.state.poOverrides), cancelled };
  }

  // ── Header primary per role (hasPrimary: outside → hidden; project read-only → hidden) ──
  out.roles[lang] = {};
  for (const role of ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client']) {
    out.roles[lang][role] = {};
    for (const project of ['HLT-026', 'NDC-031']) {
      const v = make({ lang, role, project }).renderVals();
      out.roles[lang][role][project] = { hasPrimary: v.hasPrimary, primary: v.primaryAction, readOnly: v.projReadOnly ?? null };
    }
  }
}

fs.writeFileSync(path.join(root, 'src/features/orders/orders.golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/features/orders/orders.golden.json');
