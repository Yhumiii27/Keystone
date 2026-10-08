// Generates src/server/dal/delivery3.golden.json: the prototype's own render values (renderValsEN, default state,
// director, EN) for the data behind the Delivery 3 screens — Documents and Document types, Contract, Billing, Cash &
// recovery, Cash flow, Prioritisation, Meetings, Stakeholders, Interfaces, Portfolio schedule and Projects map.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-d3.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
// The sandbox keeps its own intrinsics (Object, Array, JSON…): the prototype's `deepTr` only walks objects whose
// prototype is the sandbox's Object.prototype, so injecting the host's built-ins would silently skip the FR translation.
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

const render = (state: any = {}) => {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c.renderValsEN();
};
/** Drops functions and DOM refs. */
const plain = (v: any) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'mapRef' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/** Initial `state.dv` of the prototype. */
const dv0 = () => new ctx.__C({}).state.dv;

const out: any = {};

// ── Documents ──
const base = render({ screen: 'docs' });
const docKeys = ['id', 'type', 'proj', 'rev', 'status', 'shared', 'ack', 'typeLabel', 'famLabel', 'svcLabel', 'conf', 'tags', 'isNew', 'nextRole', 'approveLabel', 'stepText', 'canFreeze', 'canPropose', 'canApprove', 'date', 'by'];
out.docs = {
  kpis: plain(base.dvKpis), views: plain(base.dvViews), fam: plain(base.dvFam), st: plain(base.dvSt), sync: base.codexSync,
  list: plain(base.dvList).map((d: any) => pick(d, docKeys)),
  allKpis: plain(render({ screen: 'docs', dv: { ...dv0(), scope: 'all' } }).dvKpis),
  ndcKpis: plain(render({ screen: 'docs', project: 'NDC-031' }).dvKpis),
  types: plain(base.docTypesRows),
  clientDocs: plain(base.cpVaultDocs).map((d: any) => pick(d, ['id', 'rev', 'ack'])),
  drawers: {} as any,
};
const allIds = plain(render({ screen: 'docs', dv: { ...dv0(), scope: 'all' } }).dvList).map((d: any) => d.id);
for (const id of allIds) {
  const v = render({ screen: 'docs', dv: { ...dv0(), scope: 'all', open: id } });
  const d = plain(v.doc);
  out.docs.drawers[id] = { meta: d.meta, revs: d.revs.map((r: any) => pick(r, ['rev', 'date', 'by', 'status', 'versions', 'note'])), appr: d.appr.map((a: any) => pick(a, ['role', 'who', 'when', 'state'])), dist: d.dist.map((x: any) => pick(x, ['to', 'rev', 'date', 'ack'])), dl: d.dl, links: d.links.map((l: any) => pick(l, ['kind', 'id'])) };
}

// ── Contract, Billing, Cash & recovery ──
const ct = render({ screen: 'contract' });
out.contract = {
  kpis: plain(ct.ctrKpis), fields: plain(ct.ctrFields).map((f: any) => [f.k, f.value]), amendments: plain(ct.ctrAmend).map((a: any) => pick(a, ['label', 'amtText', 'status', 'date', 'doc'])),
  bonds: plain(ct.ctrBonds).map((b: any) => pick(b, ['label', 'amtText', 'state', 'released'])), milestones: plain(ct.ctrMs).map((m: any) => pick(m, ['id', 'label', 'pct', 'due', 'status', 'inv', 'paid', 'amt', 'late', 'condText'])),
  schedTotal: plain(ct.ctrSchedTotal),
};
const bl = render({ screen: 'billing' });
out.billing = {
  kpis: plain(bl.billKpis), bill: plain(bl.ctrBill), toInvoice: plain(bl.ctrToInvoice).map((m: any) => pick(m, ['id', 'label', 'due', 'pct', 'late', 'amt'])),
  invoices: plain(bl.ctrInvoices).map((i: any) => pick(i, ['no', 'msId', 'label', 'issued', 'amt', 'due', 'paid', 'status', 'overdue'])),
};
out.recovery = { kpis: plain(render({ screen: 'budget', budgetTab: 'cash' }).recKpis) };

// ── Cash flow ──
out.cash = {};
for (const z of [null, 'euna', 'afr', 'apac']) {
  const v = render({ screen: 'cash', pfZone: z });
  out.cash[String(z)] = {
    rows: plain(v.cashRows).map((r: any) => pick(r, ['code', 'model', 'contract', 'invoiced', 'paid', 'outstanding', 'cost', 'marginText', 'next', 'invW', 'paidW', 'isInternal'])),
    kpis: plain(v.cashKpis), bars: plain(v.cashBars),
  };
}

// ── Prioritisation & capacity ──
const pf = render({ screen: 'portfolio' });
out.prioritisation = {
  rows: plain(pf.scoreRows).map((r: any) => ({ ...pick(r, ['code', 'rank', 'score', 'marginText', 'isPipeline', 'status']), axes: r.axes.map((a: any) => a.v) })),
  kpis: plain(pf.pfKpis), weights: plain(pf.weightRows).map((w: any) => pick(w, ['k', 'l', 'v', 'pct'])),
  capacity: {} as any,
};
for (const code of ['WSA-044', 'EWA-051', 'FTU-052', 'RBR-048', 'CER-047']) {
  const v = render({ screen: 'portfolio', pfTab: 'capacity', pfWhatif: code });
  out.prioritisation.capacity[code] = { rows: plain(v.capRows).map((r: any) => pick(r, ['name', 'cap', 'cur', 'add', 'tot', 'gap'])), wi: pick(plain(v.wi), ['verdict', 'gapText', 'budget', 'start']) };
}

// ── Meetings ──
out.meetings = {};
for (const code of ['HLT-026', 'NDC-031', 'EWA-051']) {
  const v0 = render({ screen: 'meetings', project: code });
  const m: any = { list: plain(v0.mtgList).map((x: any) => pick(x, ['id', 'title', 'status', 'type', 'date', 'time', 'dur', 'loc', 'organizer', 'sub', 'doc'])), kpis: plain(v0.mtgKpis),
    actions: plain(v0.mtgActionRows).map((l: any) => pick(l, ['mid', 'text', 'owner', 'ownerFull', 'due', 'done', 'stText'])),
    decisions: plain(v0.mtgDecisionRows).map((l: any) => pick(l, ['mid', 'text', 'pt', 'mtype'])), detail: {} };
  for (const x of m.list) {
    const s0 = new ctx.__C({}).state.mtg;
    const v = render({ screen: 'meetings', project: code, mtg: { ...s0, sel: x.id } });
    const a = render({ screen: 'meetings', project: code, mtg: { ...s0, sel: x.id, analysed: { [x.id]: true } } });
    const sel = plain(v.mtgSel);
    m.detail[x.id] = {
      meta: sel.meta, attendance: sel.attendance.map((p: any) => pick(p, ['name', 'present', 'label'])),
      agenda: sel.agenda.map((p: any) => ({ pt: p.pt, lines: p.lines.map((l: any) => pick(l, ['type', 'text', 'owner', 'due', 'done'])) })),
      carried: sel.carried.map((c: any) => pick(c, ['text', 'owner', 'due', 'from'])), sentText: sel.sentText, dist: sel.dist.map((d: any) => pick(d, ['who', 'state'])),
      prep: v.mtgPrep ? pick(plain(v.mtgPrep), ['prevRef', 'prevDecisions', 'closedCount', 'bridge', 'bridgeTitle', 'transcript']) : null,
      prevActions: v.mtgPrep ? plain(v.mtgPrep).prevActions.map((p: any) => pick(p, ['text', 'who', 'due', 'done'])) : null,
      analysis: a.mtgPrep && a.mtgPrep.analysed ? { summary: a.mtgPrep.summary, lines: plain(a.mtgPrep.draftLines).map((l: any) => pick(l, ['type', 'text', 'meta'])) } : null,
    };
  }
  out.meetings[code] = m;
}

// ── Stakeholders, interfaces ──
const sk = render({ screen: 'stakeholders' });
out.stakeholders = { rows: plain(sk.stkRows).map((r: any) => pick(r, ['name', 'org', 'role', 'type', 'contactText', 'owner', 'last', 'lastText', 'notes', 'initials'])), kpis: plain(sk.stkKpis), cols: plain(sk.raciCols).map((c: any) => c.label), raci: plain(sk.raciRows).map((r: any) => [r.label, ...r.cells.map((c: any) => c.v)]) };
const ifc = render({ screen: 'interfaces' });
out.interfaces = { rows: plain(ifc.ifcRows).map((r: any) => pick(r, ['id', 'title', 'a', 'b', 'data', 'needed', 'provided', 'status', 'owner', 'neededSub'])), kpis: plain(ifc.ifcKpis) };

// ── Portfolio schedule, Projects map ──
out.pfplan = {};
out.map = {};
for (const z of [null, 'euna', 'afr', 'apac']) {
  const v = render({ screen: 'pfplan', pfZone: z });
  out.pfplan[String(z)] = {
    kpis: plain(v.pgKpis),
    groups: plain(v.pgGroups).map((g: any) => ({ key: g.key, rows: g.rows.map((r: any) => ({ ...pick(r, ['code', 'pipe', 'gate', 'gateSub', 'hasExec', 'exL', 'exW', 'exFill', 'hasBase', 'bL', 'bW', 'clipped', 'clipText']), segs: r.segs.map((s: any) => pick(s, ['left', 'width', 'title', 'label', 'diamond'])) })) })),
  };
  const w = render({ screen: 'worldmap', pfZone: z });
  const hash = JSON.parse(decodeURIComponent(w.mapSrc.split('#')[1]));
  out.map[String(z)] = { kpis: plain(w.mapKpis), groups: plain(w.mapGroups).map((g: any) => ({ city: g.city, country: g.country, codes: g.items.map((i: any) => i.code) })), points: hash.points, zone: hash.zone };
}

const target = path.join(root, 'src/server/dal/delivery3.golden.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB');
