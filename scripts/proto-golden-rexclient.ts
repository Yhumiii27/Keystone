// Generates src/domain/rexclient.golden.json: the prototype's own render values (`renderVals()`, EN and FR) of
//   - Lessons learned & project closure (docs/spec/07 §2.7, template 921–931, logic 4997–5006): KPI tiles, lessons,
//     closure checklist, customer satisfaction, header (title, crumb, primary per role), for HLT-026 and a project
//     without REX data (NDC-031), and the transitions the screen offers (Validate, Mark applied, closure cycle,
//     Add lesson learned → LL-10, LL-11);
//   - My project — client view (docs/spec/03 §8, template 2180–2236, logic 4679–4690, 5061): KPI tiles, display
//     segments, progress, milestones, decisions waiting / decided, invoices and contract summary, issues, shared
//     documents, empty-state flags, header (title, crumb, primary per role), for HLT-026 and NDC-031, and the
//     transitions (approve / reject a CR client step, accept / reject a deliverable, Raise issue × 3 — the third one
//     shows the "CI-010" defect, 03 OQ16; Acknowledge receipt).
// Also the FR translation of every template label of the two screens (TPL keys) and of the toasts.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   npx tsx scripts/proto-golden-rexclient.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
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
vm.runInContext(lines.slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component; globalThis.__trFR = trFR;', ctx);

const plain = (v: any) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === 'mapRef' || typeof x === 'function' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const LANGS = ['en', 'fr'] as const;
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];

function comp(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c;
}

const header = (v: any) => pick(v, ['title', 'crumb', 'primaryAction', 'hasPrimary', 'outside']);

// ── Lessons learned & closure ──
function rexSnap(c: any) {
  const v = plain(c.renderVals());
  return {
    header: header(v),
    kpis: v.rexKpis.map((k: any) => pick(k, ['label', 'value', 'sub', 'color'])),
    lessons: v.llRows.map((r: any) => pick(r, ['id', 'theme', 'what', 'impact', 'reco', 'apply', 'status', 'stClass', 'canAdvance', 'next'])),
    closure: v.clRows.map((r: any) => pick(r, ['item', 'owner', 'status', 'icon', 'color', 'textColor'])),
    satisfaction: v.satRows.map((r: any) => pick(r, ['k', 'v', 'w'])),
    satAvg: v.satAvg,
  };
}

/** Replays an action on the EN component, then renders it in each language. */
function both(state: any, act: (c: any) => void) {
  const out: any = {};
  for (const lang of LANGS) {
    const c = comp({ ...state, lang: 'en' });
    act(c);
    c.setState({ lang });
    out[lang] = c;
  }
  return out as Record<(typeof LANGS)[number], any>;
}

const out: any = { rex: {}, client: {}, labels: {}, toasts: {} };

for (const lang of LANGS) {
  out.rex[lang] = {
    'HLT-026': rexSnap(comp({ screen: 'rex', lang })),
    'NDC-031': rexSnap(comp({ screen: 'rex', lang, project: 'NDC-031' })),
  };
  out.rex[lang].roles = Object.fromEntries(ROLES.map((role) => [role, header(plain(comp({ screen: 'rex', lang, role }).renderVals()))]));
}

// Transitions: Validate LL-04, Mark applied LL-01 and LL-03; closure cycle on rows 0 (Not started → In progress),
// 2 (In progress → Done) and 4 (Done → Not started); Add lesson learned twice (the second with an empty impact).
{
  const advance = both({ screen: 'rex' }, (c) => {
    for (const id of ['LL-04', 'LL-01', 'LL-03']) c.renderValsEN().llRows.find((r: any) => r.id === id).advance();
  });
  const cycle = both({ screen: 'rex' }, (c) => {
    for (const i of [0, 2, 4]) c.renderValsEN().clRows[i].toggle();
  });
  const cycleTwice = both({ screen: 'rex' }, (c) => {
    c.renderValsEN().clRows[0].toggle();
    c.renderValsEN().clRows[0].toggle();
    c.renderValsEN().clRows[0].toggle();
  });
  const add = both({ screen: 'rex' }, (c) => {
    c.setState({ af: { open: true, key: 'rex', values: { theme: 'Quality', what: 'Weld map missing at FAT', impact: '2 d lost', reco: 'Attach the weld map to the FAT pack', apply: 'ITP template' } } });
    c.renderValsEN().afSubmit();
    c.setState({ af: { open: true, key: 'rex', values: { theme: '', what: 'Late crane permit', impact: '', reco: 'Request permits at award', apply: '' } } });
    c.renderValsEN().afSubmit();
    c.renderValsEN().llRows.find((r: any) => r.id === 'LL-10').advance();
  });
  for (const lang of LANGS) {
    out.rex[lang].afterAdvance = rexSnap(advance[lang]);
    out.rex[lang].afterCycle = rexSnap(cycle[lang]);
    out.rex[lang].afterCycleTwice = rexSnap(cycleTwice[lang]);
    out.rex[lang].afterAdd = rexSnap(add[lang]);
  }
  out.toasts.rex = Object.fromEntries(
    LANGS.map((lang) => {
      const c = comp({ screen: 'rex', lang });
      c.setState({ af: { open: true, key: 'rex', values: { theme: 'Quality', what: 'x', impact: '', reco: 'y', apply: 'Other' } } });
      c.renderValsEN().afSubmit();
      return [lang, c.state.toast];
    }),
  );
}

// ── Client portal ──
function clientSnap(c: any) {
  const v = plain(c.renderVals());
  return {
    header: header(v),
    kpis: v.cpKpis.map((k: any) => pick(k, ['label', 'value', 'sub', 'color'])),
    seg: v.cpSeg.map((o: any) => o.label),
    progress: v.cpProgress,
    milestones: v.milestones.map((m: any) => pick(m, ['name', 'baseDate', 'fcDate', 'status', 'tagClass'])),
    decisions: v.cpDecisions.map((d: any) => pick(d, ['kind', 'id', 'title', 'sub', 'when', 'approveLabel'])),
    decided: v.cpDecided.map((d: any) => pick(d, ['id', 'title', 'state', 'tagClass', 'when'])),
    invoices: v.cpInvoices.map((i: any) => pick(i, ['no', 'name', 'amt', 'status', 'tagClass', 'due'])),
    invKpis: v.cpInvKpis.map((g: any) => pick(g, ['k', 'v', 'color'])),
    issues: v.cpIssues.map((i: any) => pick(i, ['id', 'title', 'when', 'status', 'resp', 'tagClass'])),
    docs: v.cpVaultDocs.map((d: any) => pick(d, ['id', 'title', 'typeLabel', 'date', 'rev', 'status', 'stClass', 'ack', 'canAck', 'ackLabel'])),
    flags: pick(v, ['noDecisions', 'noDecided', 'noCpInv', 'noCpVault', 'cpIsProgress', 'cpIsDecisions', 'cpIsInvoices', 'cpIsIssues', 'cpIsDocs']),
  };
}

for (const lang of LANGS) {
  out.client[lang] = {
    'HLT-026': clientSnap(comp({ screen: 'client', role: 'client', lang })),
    'NDC-031': clientSnap(comp({ screen: 'client', role: 'client', lang, project: 'NDC-031' })),
  };
  out.client[lang].roles = Object.fromEntries(ROLES.map((role) => [role, header(plain(comp({ screen: 'client', lang, role }).renderVals()))]));
}

{
  const st = { screen: 'client', role: 'client' };
  const decide = both(st, (c) => {
    const ds = c.renderValsEN().cpDecisions;
    ds.find((d: any) => d.id === 'CR-008').approve();
    c.renderValsEN().cpDecisions.find((d: any) => d.id === 'D-014').approve();
    c.renderValsEN().cpDecisions.find((d: any) => d.id === 'D-016').reject();
  });
  const rejectCr = both(st, (c) => c.renderValsEN().cpDecisions.find((d: any) => d.id === 'CR-008').reject());
  const issues = both(st, (c) => {
    c.setState({ ciNew: '   ' });
    c.renderValsEN().raiseIssue();
    for (const t of ['Crane test witness slot', 'Spare parts list format', 'Training dates']) {
      c.setState({ ciNew: t });
      c.renderValsEN().raiseIssue();
    }
  });
  const ack = both(st, (c) => {
    c.renderValsEN().cpVaultDocs.find((d: any) => d.id === 'PID-HLT-026').acknowledge();
  });
  for (const lang of LANGS) {
    out.client[lang].afterDecide = clientSnap(decide[lang]);
    out.client[lang].afterRejectCr = clientSnap(rejectCr[lang]);
    out.client[lang].afterIssues = clientSnap(issues[lang]);
    out.client[lang].afterAck = clientSnap(ack[lang]);
  }
  out.toasts.client = Object.fromEntries(
    LANGS.map((lang) => {
      const c = comp({ ...st, lang: 'en' });
      c.setState({ af: { open: true, key: 'client', values: { period: 'September 2026', format: 'PDF' } } });
      c.setState({ lang });
      c.renderValsEN().afSubmit();
      return [lang, c.state.toast];
    }),
  );
}

// FR of every English text written in the two templates and the action forms (the screens translate them with t()).
const LABELS = [
  // REX template
  'Lessons learned', 'Theme', 'What happened', 'Impact', 'Recommendation', 'Applies to', 'Status', 'Closure checklist',
  'Click to cycle · not started → in progress → done', 'Customer satisfaction', 'Survey · 5 criteria',
  // Client template
  'Display', 'Progress to date', 'Cumulative % complete · planned vs actual', 'Planned', 'Actual', 'Milestones', 'Contract', '· Forecast',
  'Waiting for your decision', 'Change requests affect the contract value or the handover date · deliverables are accepted with a signed PV',
  'Reject', 'Nothing waiting for you', 'Decided', 'No decision yet', 'Invoices & payments', 'Milestone billing per contract · 30 days net', 'Invoice',
  'Milestone', 'Amount', 'Payment', 'Internal project — no client billing', 'Contract summary', 'Download statement', 'Issues you raised',
  'Acknowledged within 2 working days · answered by the project manager', 'Describe a new issue or request', 'Raise issue', 'Documents', 'Deliverables',
  'Column mapping', 'Title', 'Rev', 'Own documents · files stay in the business tool, Keystone holds revision and status',
  // Forms
  'Add lesson learned', 'Record', 'Theme', 'Engineering', 'Procurement', 'Site', 'Client', 'Planning', 'Quality', 'HSE', 'WBS template', 'ITP template',
  'Purchasing procedure', 'Engineering gate checklist', 'Stakeholder & RACI template', 'Other', 'Download status report', 'Download', 'Period', 'Format',
  'September 2026', 'Q3 2026', 'Since project start', 'PDF', 'PowerPoint', 'Add lesson', 'Lesson recorded · to be validated', 'Report downloaded',
  // Rows
  'Validate', 'Mark applied', 'Applied', 'Validated', 'Proposed', 'Not started', 'In progress', 'Done', 'Change request', 'Deliverable', 'Approve', 'Accept (PV)',
  'Approved', 'Rejected', 'Accepted', 'Paid', 'Invoiced', 'Settled', 'On milestone', 'Open', 'Closed', 'Acknowledged', 'Acknowledge receipt', 'Released',
  'Raised today', 'Acknowledged — response within 2 working days', 'Contract value', 'Approved changes', 'Reference', 'survey not received',
  'Lessons learned & project closure', 'My project — client view', 'Project · Project review', 'Keystone · read-only except decisions and issues',
];
out.labels = Object.fromEntries([...new Set(LABELS)].map((l) => [l, ctx.__trFR(l)]));

const file = path.join(root, 'src/domain/rexclient.golden.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', path.relative(root, file));
