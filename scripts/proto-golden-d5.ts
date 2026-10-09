// Generates src/server/dal/delivery5.golden.json: the prototype's own render values (renderValsEN, default state, EN)
// for the data behind the Delivery 5 screens — Quality (NCR log and drawer, deliverables register and drawer), ITP &
// punch list, Commissioning, Lessons learned & closure, Installed base, Warranty claims (per zone), Site (three tabs),
// Client portal, Engineering synthesis and the four discipline screens, P&ID validation, Machine types, Settings,
// Activity & integrations, and the NCR verification / deliverable acceptance kinds of My approvals.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-d5.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
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

const make = (state: any = {}) => {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c;
};
const render = (state: any = {}) => make(state).renderValsEN();
const plain = (v: any) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'mapRef' || typeof x === 'function' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const kpis = (ks: any[]) => plain(ks ?? []).map((k: any) => pick(k, ['label', 'value', 'sub']));
const chips = (cs: any[]) => plain(cs ?? []).map((c: any) => [c.label, Number(c.count)]);
const DATA = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];

const out: any = {};

// ── Quality ──
out.quality = {};
for (const code of DATA) {
  const v = plain(render({ screen: 'quality', project: code }));
  const d = plain(render({ screen: 'quality', project: code, qTab: 'dlv' }));
  out.quality[code] = {
    ncrKpis: kpis(v.ncrKpis), ncrChips: chips(v.ncrChips),
    ncrRows: v.ncrRows.map((r: any) => pick(r, ['id', 'title', 'sev', 'src', 'actText', 'owner', 'due', 'costText', 'status', 'stepIdx', 'canAdvance', 'nextLabel', 'raised', 'date'])),
    dlvKpis: kpis(d.dlvKpis), dlvChips: chips(d.dlvChips),
    dlvRows: d.dlvRows.map((r: any) => ({ ...pick(r, ['id', 'title', 'type', 'wbs', 'due', 'rev', 'acc', 'status', 'canStart', 'canSubmit', 'nextLabel']), raci: r.raciCells.map((c: any) => [c.k, c.who, c.ini]) })),
  };
}
out.ncrDrawers = {};
for (const r of out.quality['HLT-026'].ncrRows) out.ncrDrawers[r.id] = pick(plain(render({ screen: 'quality', ncr: r.id }).ncr), ['meta', 'root', 'action', 'nextLabel', 'hasEco', 'ecoId', 'hasPart']);
out.dlvDrawers = {};
for (const r of out.quality['HLT-026'].dlvRows) out.dlvDrawers[r.id] = pick(plain(render({ screen: 'quality', qTab: 'dlv', dlv: r.id }).dlv), ['meta', 'raci']);

// ── ITP & punch list ──
out.itp = {};
for (const code of DATA) {
  const v = plain(render({ screen: 'itp', project: code }));
  out.itp[code] = {
    kpis: kpis(v.itpKpis),
    groups: (v.itpBySys ?? []).map((g: any) => ({ sys: g.sys, count: g.count, passed: g.passed, rows: g.rows.map((r: any) => pick(r, ['id', 'name', 'type', 'stage', 'ref', 'date', 'status', 'doc'])) })),
    punch: (v.punchRows ?? []).map((r: any) => pick(r, ['id', 'item', 'loc', 'cat', 'src', 'owner', 'due', 'status', 'canAdvance', 'next'])),
  };
}

// ── Commissioning ──
{
  const v = plain(render({ screen: 'commissioning' }));
  out.commissioning = {
    kpis: kpis(v.cmKpis), cols: v.cmCols.map((c: any) => c.label),
    rows: v.cmRows.map((r: any) => ({ sys: r.sys, punchA: r.punchA, cells: r.cells.map((c: any) => [c.st, c.date]) })),
    dossier: v.cmDossier.map((d: any) => pick(d, ['item', 'type', 'doc', 'status'])),
  };
  out.commissioningNdc = kpis(plain(render({ screen: 'commissioning', project: 'NDC-031' })).cmKpis);
}

// ── Lessons learned & closure ──
{
  const v = plain(render({ screen: 'rex' }));
  out.rex = {
    kpis: kpis(v.rexKpis), lessons: v.llRows.map((r: any) => pick(r, ['id', 'theme', 'what', 'impact', 'reco', 'apply', 'status', 'canAdvance', 'next'])),
    closure: v.clRows.map((r: any) => pick(r, ['item', 'owner', 'status'])), satisfaction: v.satRows.map((r: any) => pick(r, ['k', 'v', 'w'])), satAvg: v.satAvg,
  };
  out.rexNdc = kpis(plain(render({ screen: 'rex', project: 'NDC-031' })).rexKpis);
}

// ── Installed base & warranty claims (all zones and per zone) ──
out.fleet = {};
out.sav = {};
for (const zone of [null, 'euna', 'afr', 'apac']) {
  const key = zone ?? 'all';
  const f = plain(render({ screen: 'fleet', pfZone: zone }));
  out.fleet[key] = {
    kpis: kpis(f.fleetKpis), zoneSeg: chips(f.zoneSeg),
    rows: f.fleetRows.map((r: any) => ({ ...pick(r, ['id', 'type', 'name', 'client', 'site', 'proj', 'delivered', 'wend', 'status', 'open', 'gen', 'openText', 'wendSub', 'cost']), cfg: (r.cfgItems ?? []).map((c: any) => c.label ?? c.text ?? c) })),
  };
  const s = plain(render({ screen: 'sav', pfZone: zone }));
  out.sav[key] = {
    kpis: kpis(s.savKpis),
    claims: s.claimRows.map((r: any) => pick(r, ['id', 'mch', 'mname', 'client', 'issue', 'sev', 'date', 'status', 'cover', 'cost', 'costText', 'eco', 'owner', 'next'])),
    interventions: s.ivRows.map((r: any) => pick(r, ['id', 'mch', 'mname', 'site', 'date', 'tech', 'type', 'dur', 'status'])),
    costs: s.savCostRows.map((r: any) => pick(r, ['id', 'name', 'client', 'status', 'claims', 'warrantyCost', 'chargeable', 'barW'])),
  };
}

// ── Site ──
{
  const v = plain(render({ screen: 'site' }));
  out.site = {
    kpis: kpis(v.siteKpis), goItems: v.goItems.map((g: any) => pick(g, ['label', 'ok', 'sub'])), goLabel: v.goLabel, meta: v.siteMeta.map((m: any) => [m.k, m.v]),
    prereqs: v.prereqs.map((p: any) => pick(p, ['title', 'act', 'due', 'status', 'note', 'late', 'canConfirm', 'canSign'])),
    equip: v.equip.map((e: any) => pick(e, ['name', 'src', 'status', 'note', 'canConfirm'])),
    docs: v.docs.map((d: any) => pick(d, ['who', 'visa', 'vacc', 'hab', 'habNote', 'status', 'rec', 'canReq'])),
    teamKpis: kpis(v.teamKpis), rotation: v.rotation.map((r: any) => pick(r, ['who', 'role', 'from', 'to', 'lodging', 'travel', 'rot', 'collideIcon'])),
    collisions: v.collisions.map((c: any) => pick(c, ['who', 'what', 'kind', 'fix'])), missionCosts: v.missionCosts.map((m: any) => pick(m, ['name', 'budget', 'actual', 'pct', 'left'])),
    execKpis: kpis(v.execKpis), reports: v.reports.map((r: any) => pick(r, ['date', 'act', 'pct', 'txt', 'link', 'by'])),
    punch: v.punch.map((p: any) => pick(p, ['id', 'title', 'ncr', 'status', 'owner', 'due'])), hse: v.hse.map((h: any) => pick(h, ['title', 'status', 'date'])),
  };
}

// ── Client portal (client persona) ──
{
  const v = plain(render({ screen: 'client', role: 'client' }));
  out.client = {
    kpis: kpis(v.cpKpis), decisions: v.cpDecisions.map((d: any) => pick(d, ['kind', 'id', 'title', 'sub', 'when', 'approveLabel'])),
    decided: v.cpDecided.map((d: any) => pick(d, ['id', 'title', 'state', 'when'])), invoices: v.cpInvoices.map((i: any) => pick(i, ['no', 'name', 'amt', 'status', 'due'])),
    invKpis: v.cpInvKpis.map((k: any) => [k.k, k.v]), issues: v.cpIssues.map((i: any) => pick(i, ['id', 'title', 'when', 'status', 'resp'])),
    docs: (v.cpVaultDocs ?? []).map((d: any) => pick(d, ['id', 'title', 'rev', 'status', 'ack'])),
  };
}

// ── Engineering ──
{
  const v = plain(render({ screen: 'eng' }));
  out.eng = {
    kpis: kpis(v.engKpis), from: v.engFrom,
    matrix: v.engMatrix.map((r: any) => ({ label: r.label, cells: r.cells.map((c: any) => c.items.map((i: any) => [i.label, i.sub])) })),
    discCards: v.engDiscCards.map((c: any) => pick(c, ['label', 'lead', 'tools', 'pct', 'relText', 'openText'])),
    gate: v.engGateItems.map((c: any) => pick(c, ['id', 'title', 'ruleLabel', 'lead', 'status'])), gateText: v.engGateText,
    changes: v.engChanges.map((c: any) => pick(c, ['date', 'text', 'impact'])),
    disciplines: {} as any,
  };
  for (const k of ['process', 'meca', 'elec', 'auto']) {
    const d = plain(render({ screen: 'eng-' + k }));
    out.eng.disciplines[k] = {
      kpis: kpis(d.engDKpis),
      inputs: d.engDIn.map((r: any) => pick(r, ['doc', 'title', 'from', 'revText', 'latestText', 'state', 'canConfirm', 'canImport'])),
      docs: d.engDDocs.map((r: any) => pick(r, ['id', 'title', 'rev', 'status', 'toText', 'canFreeze', 'canPropose', 'proposeBlocked', 'blockedText', 'canValidate'])),
      outputs: d.engDOut.map((r: any) => pick(r, ['id', 'name', 'toText', 'source', 'state', 'stateText', 'canGen'])),
      checks: d.engDChk.map((r: any) => pick(r, ['id', 'title', 'detail', 'ruleLabel', 'ownerLabel', 'lead', 'sevLabel', 'status', 'canAct'])),
      chips: chips(d.engChkChips),
    };
  }
}

// ── P&ID ──
{
  const v = plain(render({ screen: 'pid' }));
  out.pid = {
    kpis: kpis(v.pidKpis), chips: chips(v.pidChips), steps: v.pidSteps.map((s: any) => pick(s, ['label', 'who', 'date', 'state'])),
    rows: v.pidList.map((r: any) => pick(r, ['tag', 'desc', 'kind', 'scope', 'refText', 'partName', 'status', 'actText', 'plcText', 'fbText', 'fbWarn'])),
    overlay: v.overlay.map((r: any) => r.tag), drawers: {} as any,
  };
  for (const tag of ['LT-101', 'TT-102', 'XV-111', 'FD-001', 'T-101', 'P-110']) {
    const d = plain(render({ screen: 'pid', pidTag: tag }).pidTag);
    out.pid.drawers[tag] = { meta: d.meta.map((m: any) => [m.k, m.v]), candidates: d.candidates.map((c: any) => [c.ref, c.status]), canMap: d.canMap, notInBom: d.notInBom, fbWarn: d.fbWarn };
  }
}

// ── Machine types ──
{
  const v = plain(render({ screen: 'mtypes' }));
  out.mtypes = { kpis: kpis(v.mtKpis), list: v.mtList.map((m: any) => pick(m, ['code', 'label', 'sub', 'use', 'stateText', 'custom'])), types: {} as any };
  for (const m of out.mtypes.list) {
    const t = plain(render({ screen: 'mtypes', mtSel: m.code }).mt);
    out.mtypes.types[m.code] = {
      ...pick(t, ['code', 'label', 'desc', 'cal', 'dep', 'deliv', 'acc', 'termsSum', 'catTotal']),
      phases: t.phases.map((p: any) => p.name), cats: t.cats.map((c: any) => [c.name, c.type, c.budget]), itp: (t.itp ?? []).map((x: any) => x.name ?? x),
      refs: (t.refs ?? []).map((x: any) => x.label ?? x.text ?? x), projects: (t.projects ?? []).map((x: any) => x.name ?? x),
    };
  }
}

// ── Settings ──
{
  const v = plain(render({ screen: 'settings' }));
  out.settings = {
    kpis: kpis(v.settingsKpis), healthText: v.health.text,
    cards: v.settingsCards.map((c: any) => ({ key: c.key, title: c.title, count: c.count, items: c.items.map((i: any) => (i.hasSub ? [i.label, i.sub] : i.label)) })),
  };
}

// ── Activity & integrations (director) ──
{
  const v = plain(render({ screen: 'plumbing' }));
  out.plumbing = {
    kpis: kpis(v.plumbKpis), chips: chips(v.actChips),
    connectors: v.connRows.map((c: any) => pick(c, ['name', 'what', 'freq', 'st', 'last', 'vol'])), imports: v.importRows.map((i: any) => pick(i, ['name', 'desc', 'icon'])),
    audit: v.auditRows.map((a: any) => pick(a, ['when', 'who', 'obj', 'change', 'area'])),
  };
}

// ── My approvals (NCR verification, deliverable acceptance) ──
out.approvals = {};
for (const role of ['quality', 'client']) {
  const v = plain(render({ screen: 'myapprovals', role }));
  out.approvals[role] = v.myApprovals.filter((i: any) => i.kind === 'NCR verification' || i.kind === 'Deliverable acceptance').map((i: any) => pick(i, ['kind', 'id', 'title', 'sub', 'when', 'who']));
}

fs.writeFileSync(path.join(root, 'src/server/dal/delivery5.golden.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote src/server/dal/delivery5.golden.json');
