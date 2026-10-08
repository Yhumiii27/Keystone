// Generates src/features/procurement/procurement.golden.json: the prototype's own render values (`renderVals`, i.e.
// renderValsEN + the FR deep translation) of the Sourcing, invoices & suppliers screen (`procurement`, template
// 1972–2078, logic 4646–4676), in EN and FR:
// - the three tabs on the seed (KPI tiles, rows, chips), the supplier scorecard for several current projects;
// - every RFQ drawer for the four award situations (director, pm, procurement, quality) and every invoice drawer;
// - scenarios replayed through the prototype's own handlers (Send to suppliers, Compare quotes, Award, Approve received
//   part, Reject invoice) with the resulting rows, drawers and KPIs;
// - the static template labels (template 1972–2078), the segmented control, the AF `procurement` form ("New RFQ") and
//   the RFQ-award / invoice items of My approvals for every persona.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with its own intrinsics (the FR deep
// translation checks `Object.getPrototypeOf(v) === Object.prototype`, so host built-ins must not be injected).
//   npx tsx scripts/proto-golden-procurement.ts
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
    '\n;globalThis.__C = Component; globalThis.__tr = s => fixEnt(trFR(s)); globalThis.__AF = AF; globalThis.__AFR = typeof AF_RESULT !== "undefined" ? AF_RESULT : {};',
  ctx,
);

const LANGS = ['en', 'fr'] as const;
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const;
const make = (state: any = {}) => {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', screen: 'procurement', ...state };
  return c;
};
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const kpis = (ks: any[]) => plain(ks).map((k: any) => pick(k, ['label', 'value', 'sub', 'color']));
const chips = (cs: any[]) => plain(cs).map((c: any) => [c.label, Number(c.count)]);
const ev = { stopPropagation() {} };

const RFQ_ROW = ['id', 'title', 'part', 'qty', 'due', 'owner', 'quotesText', 'rule', 'chosenText', 'status', 'tagClass', 'idColor', 'canSend', 'canCompare'];
const INV_ROW = ['id', 'date', 'supplier', 'poText', 'grText', 'amountText', 'gapText', 'gapColor', 'dueDate', 'status', 'tagClass', 'idColor', 'canApprove', 'canPartial'];
const SUP_ROW = ['name', 'otd', 'otdW', 'otdColor', 'qual', 'qualW', 'ncr', 'ncrColor', 'pos', 'ncrs', 'grade', 'gradeClass'];

const rfqTab = (v: any) => ({ kpis: kpis(v.rfqKpis), rows: plain(v.rfqRows).map((r: any) => pick(r, RFQ_ROW)) });
const invTab = (v: any) => ({
  kpis: kpis(v.invKpis), chips: chips(v.invChips), noInv: v.noInv,
  rows: plain(v.invRows).map((r: any) => ({ ...pick(r, INV_ROW), m: r.m.map((x: any) => [x.l, x.dot]) })),
});
const supTab = (v: any) => ({ kpis: kpis(v.supKpis), rows: plain(v.supRows).map((r: any) => pick(r, SUP_ROW)) });
const rfqDrawer = (v: any) => {
  const d = plain(v.rfq);
  return {
    ...pick(d, ['id', 'title', 'status', 'tagClass', 'hint', 'noQuotes', 'canSend']), meta: d.meta,
    quotes: d.quotes.map((q: any) => pick(q, ['sup', 'price', 'priceColor', 'total', 'delta', 'lead', 'leadColor', 'terms', 'grade', 'score', 'chosen', 'canAward'])),
  };
};
const invDrawer = (v: any) => {
  const d = plain(v.inv);
  return {
    ...pick(d, ['id', 'supplier', 'status', 'tagClass', 'canApprove', 'canPartial', 'partialLabel', 'canReject', 'hasPO', 'hasGR']),
    rows: d.rows.map((x: any) => pick(x, ['k', 'ref', 'amt', 'dot', 'state', 'color'])), meta: d.meta,
  };
};

const out: any = { seed: {}, sup: {}, rfqDrawers: {}, invDrawers: {}, scenarios: {}, labels: {}, seg: {}, af: {}, myapprovals: {} };

// ── Static template labels (template 1972–2078, «…» = EN source) ──
const tpl = fs.readFileSync(path.join(root, 'design/_extracted/template-annotated.html'), 'utf8').split('\n').slice(1971, 2078).join('\n');
const labels = [...new Set([...tpl.matchAll(/«([^»]+)»/g)].map((m) => m[1]))];
for (const en of [...labels, 'Display', 'Status', 'All', 'Lead time', 'Request', 'Sourcing, invoices & suppliers', 'Purchasing & stock · all projects']) out.labels[en] = ctx.__tr(en);

for (const lang of LANGS) {
  // ── Seed: the three tabs ──
  const v = make({ lang }).renderVals();
  out.seg[lang] = plain(v.pSeg).map((o: any) => o.label);
  out.seed[lang] = { rfq: rfqTab(v), inv: invTab(make({ lang, pTab: 'inv' }).renderVals()), sup: supTab(make({ lang, pTab: 'sup' }).renderVals()) };
  // Invoice chips: each filter value.
  out.seed[lang].invFilters = {};
  for (const f of ['Blocked', 'Awaiting receipt', 'No PO', 'Approved for payment', 'Paid']) {
    const fv = make({ lang, pTab: 'inv', invFilter: f }).renderVals();
    out.seed[lang].invFilters[f] = { ids: plain(fv.invRows).map((r: any) => r.id), noInv: fv.noInv };
  }
  // Scorecard NCR counts per current project.
  out.sup[lang] = {};
  for (const project of ['HLT-026', 'NDC-031', 'WSA-044', 'EWA-051']) out.sup[lang][project] = supTab(make({ lang, pTab: 'sup', project }).renderVals());

  // ── RFQ drawers (award rights per role) ──
  out.rfqDrawers[lang] = {};
  for (const r of out.seed.en.rfq.rows) {
    out.rfqDrawers[lang][r.id] = {};
    for (const role of ['director', 'pm', 'procurement', 'quality']) out.rfqDrawers[lang][r.id][role] = rfqDrawer(make({ lang, rfq: r.id, role }).renderVals());
  }
  // ── Invoice drawers ──
  out.invDrawers[lang] = {};
  for (const r of out.seed[lang].inv.rows) out.invDrawers[lang][r.id] = invDrawer(make({ lang, pTab: 'inv', inv: r.id }).renderVals());

  // ── Scenarios through the prototype's handlers ──
  const sc: any = {};
  {
    // Send RFQ-2026-034 from the row, compare RFQ-2026-033 from the row, award RFQ-2026-031 to Dillinger in the drawer.
    const c = make({ lang });
    const rowOf = (id: string) => c.renderValsEN().rfqRows.find((r: any) => r.id === id);
    rowOf('RFQ-2026-034').send(ev);
    sc.afterSend = { rfq: rfqTab(c.renderVals()) };
    rowOf('RFQ-2026-033').compare(ev);
    c.setState({ rfq: 'RFQ-2026-033' });
    sc.afterCompare = { rfq: rfqTab(c.renderVals()), drawer: rfqDrawer(c.renderVals()) };
    c.setState({ rfq: 'RFQ-2026-031' });
    c.renderValsEN().rfq.quotes.find((q: any) => q.sup === 'Dillinger').award();
    sc.afterAward = { rfq: rfqTab(c.renderVals()), drawer: rfqDrawer(c.renderVals()), myapprovals: {} as any };
    for (const role of ['pm', 'procurement']) {
      c.setState({ role, screen: 'myapprovals' });
      sc.afterAward.myapprovals[role] = plain(c.renderVals().myApprovals).filter((i: any) => /^RFQ-/.test(i.id)).map((i: any) => i.id);
      c.setState({ screen: 'procurement', role: 'director' });
    }
    // The drawer "Send to suppliers" of RFQ-2026-034 in a fresh session.
    const d = make({ lang, rfq: 'RFQ-2026-034' });
    d.renderValsEN().rfq.send();
    sc.drawerSend = rfqDrawer(d.renderVals());
  }
  {
    // Approve the received part of INV-HC-7781, reject INV-LE-2210, then the KPIs, chips and drawers.
    const c = make({ lang, pTab: 'inv' });
    c.renderValsEN().invRows.find((r: any) => r.id === 'INV-HC-7781').partial(ev);
    c.setState({ inv: 'INV-HC-7781' });
    sc.afterPartial = { inv: invTab(c.renderVals()), drawer: invDrawer(c.renderVals()) };
    c.setState({ inv: 'INV-LE-2210' });
    c.renderValsEN().inv.reject();
    sc.afterReject = { inv: invTab(c.renderVals()), drawer: invDrawer(c.renderVals()), myapprovals: {} as any };
    for (const role of ['director', 'procurement']) {
      c.setState({ role, screen: 'myapprovals' });
      sc.afterReject.myapprovals[role] = plain(c.renderVals().myApprovals).filter((i: any) => /^INV-/.test(i.id)).map((i: any) => i.id);
      c.setState({ screen: 'procurement', role: 'director' });
    }
  }
  out.scenarios[lang] = sc;

  // ── My approvals: RFQ-award and invoice items per persona ──
  out.myapprovals[lang] = {};
  for (const role of ROLES) {
    const mv = make({ lang, role, screen: 'myapprovals' }).renderVals();
    out.myapprovals[lang][role] = plain(mv.myApprovals)
      .filter((i: any) => /^(RFQ|INV)-/.test(i.id))
      .map((i: any) => pick(i, ['kind', 'id', 'title', 'sub', 'when', 'who']));
  }
}

// ── AF procurement ("New RFQ") ──
const af = plain(ctx.__AF.procurement);
out.af = {
  def: af,
  result: ctx.__AFR.procurement ?? null,
  fr: {
    title: ctx.__tr(af.title),
    submit: ctx.__tr(af.submit),
    labels: af.fields.map((f: any) => ctx.__tr(f[1])),
    options: af.fields.filter((f: any) => Array.isArray(f[3])).map((f: any) => f[3].map((o: string) => ctx.__tr(o))),
    result: ctx.__AFR.procurement ? ctx.__tr(ctx.__AFR.procurement) : null,
  },
};

fs.writeFileSync(path.join(root, 'src/features/procurement/procurement.golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/features/procurement/procurement.golden.json');
