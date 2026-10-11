// Generates src/server/dal/delivery4.golden.json: the prototype's own render values (renderValsEN, default state, EN)
// for the data behind the Delivery 4 screens — Project BOM (flat, tree, where-used, compare, PU/PR), PLM catalogue and
// part record, ECOs (per approver role), Drawings, Purchase orders (+ the shortfall drafts), Deliveries, Stock,
// Sourcing (RFQs, invoices, suppliers) and the supply-chain kinds of My approvals.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-d4.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { applyE2a } from './proto-e2a';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
// The sandbox keeps its own intrinsics (see proto-golden-d3.ts).
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
vm.runInContext(applyE2a(lines).slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component;', ctx);

const make = (state: any = {}) => {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c;
};
const render = (state: any = {}) => make(state).renderValsEN();
const plain = (v: any) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'mapRef' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const kpis = (ks: any[]) => plain(ks).map((k: any) => pick(k, ['label', 'value', 'sub']));
const PROJECTS = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012', 'EWA-051'];
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];

const out: any = {};

// ── Project BOM ──
out.bom = {};
for (const code of PROJECTS) {
  const v = render({ screen: 'bom', project: code });
  out.bom[code] = {
    kpis: kpis(v.bomKpis), count: v.bomCountText,
    rows: plain(v.bomRows).map((r: any) => pick(r, ['ref', 'qty', 'total', 'price', 'status', 'eco', 'used', 'usedCount', 'restr', 'lead', 'pu', 'mfr'])),
    typeOpts: plain(v.bomTypeOpts).map((o: any) => o.label), mfrOpts: plain(v.bomMfrOpts).map((o: any) => o.label),
    hasTree: v.bomHasTree,
  };
}
const tree = render({ screen: 'bom', bomView: 'tree' });
out.tree = plain(tree.treeRows).map((r: any) => pick(r, ['ref', 'qty', 'ext', 'unit', 'total', 'rev', 'status', 'pad', 'has']));
out.nodes = {};
for (const r of out.tree) {
  const v = render({ screen: 'bom', bomView: 'tree', bomNode: r.ref });
  out.nodes[r.ref] = pick(plain(v.node), ['ident', 'cost', 'parents']);
}
out.used = {};
for (const q of ['', 'CR-BRG-SKF', 'EL-VFD-200', 'FD-DET-OPT', 'EL-TRF-2MVA', 'KS-STL-0450']) {
  const v = render({ screen: 'bom', bomView: 'used', bomUsedQ: q });
  out.used[q || '(default)'] = plain(v.used);
}
out.compare = plain(render({ screen: 'bom', bomView: 'compare' }).cmp);
out.spares = {};
for (const sys of ['ASM-RMG-250', 'ASM-BOG-300', 'ASM-HST-400', 'ASM-DRV-700', 'ASM-CTL-800']) {
  const v = render({ screen: 'bom', bomView: 'spares', spareSys: sys });
  out.spares[sys] = { kpis: kpis(v.spKpis), sysName: v.spSysName, rows: plain(v.spareRows).map((r: any) => pick(r, ['ref', 'kind', 'qPer', 'qTotal', 'note', 'price', 'total', 'lead', 'stock', 'stockText', 'frozen', 'pinned', 'pinnedText'])) };
}
out.spSeg = plain(render({ screen: 'bom', bomView: 'spares' }).spSeg).map((o: any) => o.label);

// ── PLM ──
const plm = render({ screen: 'plm' });
out.plm = {
  kpis: kpis(plm.plmKpis), count: plm.plmCount,
  rows: plain(plm.plmRows).map((r: any) => pick(r, ['ref', 'name', 'type', 'mb', 'pu', 'mfr', 'mfrRef', 'price', 'lead', 'status', 'eco', 'restr', 'usedCount'])),
  filters: pick(plain(plm), ['plmTypeOpts', 'plmStatusOpts', 'plmPuOpts', 'plmMbOpts']),
};
out.parts = {};
for (const r of out.plm.rows) {
  const v = render({ screen: 'plm', part: r.ref });
  const p = plain(v.part);
  out.parts[r.ref] = {
    warn: p.warn, ident: p.ident, comm: p.comm, equiv: p.equiv.map((e: any) => pick(e, ['ref', 'name', 'status'])), spares: p.spares.map((s: any) => pick(s, ['ref', 'name', 'kind', 'qty'])),
    projects: p.projects.map((x: any) => pick(x, ['code', 'name', 'qty', 'status'])), fleetUse: p.fleetUse.map((m: any) => pick(m, ['id', 'name', 'gen', 'revText', 'state', 'eco'])),
    ecoList: p.ecoList.map((e: any) => pick(e, ['id', 'title', 'status'])),
  };
}

// ── ECOs ──
out.eco = { byRole: {}, rows: null, drawers: {} };
for (const role of ROLES) {
  const v = render({ screen: 'eco', role });
  out.eco.byRole[role] = { kpis: kpis(v.ecoKpis) };
}
const eco = render({ screen: 'eco' });
out.eco.rows = plain(eco.ecoRows).map((r: any) => ({ ...pick(r, ['id', 'title', 'type', 'status', 'parts', 'projects', 'by', 'date', 'cost', 'sched', 'hasPend', 'pendText', 'lockIcon', 'canStart', 'canSubmit', 'needInterch']), approvals: r.approvals.map((a: any) => a.dot) }));
out.eco.chips = plain(eco.ecoChips).map((c: any) => [c.label, Number(c.count)]);
for (const r of out.eco.rows) {
  const v = plain(render({ screen: 'eco', eco: r.id, role: 'pm' }).eco);
  out.eco.drawers[r.id] = {
    ...pick(v, ['by', 'revText', 'interchLabel', 'pendText', 'isLocked', 'pinnedList', 'projCount', 'mchCount']),
    steps: v.steps.map((s: any) => s.dot), impact: v.impact, parts: v.parts.map((p: any) => pick(p, ['ref', 'status'])),
    approvers: v.approvers.map((a: any) => pick(a, ['label', 'who', 'state', 'canAct'])),
    dispProjects: v.dispProjects.map((t: any) => pick(t, ['name', 'sub', 'l1', 'l2', 'l3', 'revText', 'label', 'note'])),
    dispMachines: v.dispMachines.map((t: any) => pick(t, ['name', 'sub', 'l1', 'l2', 'l3', 'revText', 'label', 'note'])),
  };
}

// ── Drawings ──
const dw = render({ screen: 'drawings' });
out.drawings = {
  kpis: kpis(dw.dwgKpis), chips: plain(dw.dwgChips).map((c: any) => [c.label, Number(c.count)]),
  rows: plain(dw.dwgRows).map((r: any) => pick(r, ['no', 'title', 'part', 'partName', 'rev', 'state', 'path', 'by', 'date', 'eco'])),
  drawers: {} as any,
};
for (const r of out.drawings.rows) out.drawings.drawers[r.no] = pick(plain(render({ screen: 'drawings', dwg: r.no }).dwg), ['meta', 'hist']);

// ── Purchase orders ──
out.orders = {};
for (const code of PROJECTS) {
  const v = render({ screen: 'orders', project: code });
  out.orders[code] = {
    kpis: kpis(v.poKpis), title: v.poTitle, chips: plain(v.poChips).map((c: any) => [c.label, Number(c.count)]),
    rows: plain(v.poRows).map((r: any) => pick(r, ['id', 'supplier', 'lineSummary', 'lineCount', 'value', 'status', 'ordered', 'expected', 'need', 'risk', 'canSubmit', 'canApprove'])),
    shortfall: plain(v.shortfall).map((s: any) => [s.ref, s.qty, s.need]), shortfallTitle: v.shortfallTitle, shortfallSub: v.shortfallSub,
    drawers: Object.fromEntries(plain(v.poRows).map((r: any) => {
      const d = plain(render({ screen: 'orders', project: code, po: r.id }).po);
      return [r.id, { warn: d.warn, steps: d.steps.map((s: any) => s.dot), lines: d.lines.map((l: any) => pick(l, ['ref', 'name', 'qty', 'recv', 'price', 'total', 'pstatus'])), meta: d.meta }];
    })),
  };
}
// createDrafts on HLT-026
{
  const c = make({ screen: 'orders' });
  // The header primary / banner button calls createDrafts (closure over the current state).
  c.renderValsEN().createDrafts();
  const v1 = c.renderValsEN();
  out.ordersAfterDrafts = {
    kpis: kpis(v1.poKpis), drafts: plain(c.state.draftPOs), rows: plain(v1.poRows).map((r: any) => pick(r, ['id', 'supplier', 'lineSummary', 'lineCount', 'value', 'status', 'ordered', 'expected'])),
    shortfall: plain(v1.shortfall),
  };
}

// ── Deliveries ──
out.deliveries = {};
for (const code of PROJECTS) {
  const v = render({ screen: 'deliveries', project: code });
  out.deliveries[code] = {
    kpis: kpis(v.delivKpis), chips: plain(v.delivChips).map((c: any) => [c.label, Number(c.count)]),
    rows: plain(v.delivRows).map((r: any) => pick(r, ['id', 'po', 'supplier', 'date', 'note', 'lines', 'qty', 'acc', 'rej', 'status', 'loc', 'qc'])),
    drawers: Object.fromEntries(plain(v.delivRows).map((r: any) => {
      const d = plain(render({ screen: 'deliveries', project: code, deliv: r.id }).deliv);
      return [r.id, { meta: d.meta, qc: d.qc, docs: d.docs, lines: d.lines.map((l: any) => pick(l, ['ref', 'name', 'o', 'd', 'a', 'r', 'loc'])) }];
    })),
  };
}

// ── Stock ──
const st = render({ screen: 'stock' });
out.stock = {
  kpis: kpis(st.stockKpis), chips: plain(st.stockLocChips).map((c: any) => [c.label, Number(c.count)]),
  rows: plain(st.stockRows).map((r: any) => pick(r, ['ref', 'name', 'loc', 'locType', 'onHand', 'reserved', 'avail', 'min', 'below', 'value', 'source', 'last', 'pinned', 'pinnedText'])),
  moves: plain(st.moveRows),
  drawers: Object.fromEntries(plain(st.stockRows).map((r: any) => {
    const d = plain(render({ screen: 'stock', stockRow: r.i }).stockSel);
    return [String(r.i), { meta: d.meta, moves: d.moves, targets: d.targets.map((t: any) => t.label), scrapWarnText: d.scrapWarnText }];
  })),
};

// ── Sourcing ──
const pr = render({ screen: 'procurement' });
out.procurement = {
  rfqKpis: kpis(pr.rfqKpis), invKpis: kpis(pr.invKpis), supKpis: kpis(pr.supKpis),
  rfqRows: plain(pr.rfqRows).map((r: any) => pick(r, ['id', 'title', 'part', 'qty', 'due', 'owner', 'quotesText', 'rule', 'chosenText', 'status', 'canSend', 'canCompare'])),
  invRows: plain(pr.invRows).map((r: any) => ({ ...pick(r, ['id', 'supplier', 'poText', 'grText', 'amountText', 'gapText', 'date', 'dueDate', 'status', 'canApprove', 'canPartial']), m: r.m.map((x: any) => x.dot) })),
  invChips: plain(pr.invChips).map((c: any) => [c.label, Number(c.count)]),
  supRows: plain(pr.supRows).map((r: any) => pick(r, ['name', 'otd', 'qual', 'ncr', 'grade', 'pos', 'ncrs'])),
  rfqDrawers: {} as any, invDrawers: {} as any,
};
for (const r of out.procurement.rfqRows) {
  out.procurement.rfqDrawers[r.id] = {};
  for (const role of ['director', 'pm', 'procurement', 'quality']) {
    const d = plain(render({ screen: 'procurement', rfq: r.id, role }).rfq);
    out.procurement.rfqDrawers[r.id][role] = { meta: d.meta, hint: d.hint, quotes: d.quotes.map((q: any) => pick(q, ['sup', 'price', 'total', 'lead', 'terms', 'grade', 'score', 'isBest', 'isFast', 'chosen', 'canAward', 'delta'])) };
  }
}
for (const r of out.procurement.invRows) {
  const d = plain(render({ screen: 'procurement', pTab: 'inv', inv: r.id }).inv);
  out.procurement.invDrawers[r.id] = { rows: d.rows.map((x: any) => pick(x, ['k', 'ref', 'amt', 'state'])), meta: d.meta, partialLabel: d.partialLabel, canReject: d.canReject };
}

// ── My approvals (supply-chain and ECO kinds) ──
out.myapprovals = {};
for (const role of ROLES) {
  const v = render({ screen: 'myapprovals', role });
  out.myapprovals[role] = { items: plain(v.myApprovals).map((i: any) => pick(i, ['kind', 'id', 'title', 'sub', 'when', 'who'])), kpis: kpis(v.myApprKpis) };
}

fs.writeFileSync(path.join(root, 'src/server/dal/delivery4.golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/server/dal/delivery4.golden.json');
