// Generates src/features/contract/contract.golden.json: the prototype's own render values (`renderVals()`, EN and FR)
// of the Contract and Billing & payments screens (docs/spec/04 §3–4, template 814–869, logic 4869–4903) for a set of
// states — the seed, then the mutations the screens offer (issue invoice, mark paid, add amendment / guarantee /
// payment milestone, contract-sheet edits), read-only and outside viewers, a project without a contract.
// The prototype logic (design file lines 3096–5239) runs in a node:vm sandbox with a minimal component base class.
//   TZ=UTC npx tsx scripts/proto-golden-contract.ts
// TZ=UTC on purpose: the prototype adds `terms × 86 400 000 ms` to the invoice date (04 Q12). In UTC that equals the
// calendar-day arithmetic the rebuild uses; in Europe/Paris the DST change shows 26 Sep + 45 d as "9 Nov" (defect).
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'design/Keystone PM v8.dc.html'), 'utf8').split('\n');
// The sandbox keeps its own intrinsics (Object, Array…): `deepTr` checks `Object.getPrototypeOf(v) === Object.prototype`,
// which fails on objects of another realm and would leave the FR render untranslated.
const ctx: any = {
  console,
  setTimeout: () => 0, clearTimeout: () => undefined,
  window: { addEventListener() {}, removeEventListener() {} },
  React: { createRef: () => ({ current: null }) },
  DCLogic: class {
    props: any; state: any;
    constructor(props: any) { this.props = props || {}; }
    setState(p: any) { const u = typeof p === 'function' ? p(this.state) : p; this.state = { ...this.state, ...u }; }
  },
};
vm.createContext(ctx);
vm.runInContext(lines.slice(3095, 5239).join('\n') + '\n;globalThis.__C = Component; globalThis.__trFR = trFR;', ctx);

/** Drops functions and DOM refs. */
const plain = (v: any) => JSON.parse(JSON.stringify(v ?? null, (k, x) => (k === 'mapRef' ? undefined : x)));
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

/** A component in a given state (director, HLT-026, EN by default). */
function comp(state: any = {}) {
  const c = new ctx.__C({});
  c.state = { ...c.state, role: 'director', lang: 'en', project: 'HLT-026', ...state };
  return c;
}
const added = (c: any, patch: any) => ({ ...c.state.added, ...patch });

/** Billing nav badge = the `badge` of the nav item `billing`, wherever the nav tree puts it. */
function findBadge(v: any): string | undefined {
  let out: string | undefined;
  const walk = (x: any, d = 0) => {
    if (out !== undefined || d > 8 || !x || typeof x !== 'object') return;
    if (x.id === 'billing' && 'badge' in x) { out = x.badge; return; }
    for (const k of Object.keys(x)) walk(x[k], d + 1);
  };
  walk(v);
  return out;
}

function snapshot(c: any) {
  const v = c.renderVals();
  const head = {
    crumb: v.crumb, primaryAction: v.primaryAction, hasPrimary: v.hasPrimary, ctrCanEdit: v.ctrCanEdit, hasContract: v.hasContract, noContract: v.noContract,
    badge: findBadge(v) ?? null,
  };
  if (c.state.screen === 'contract')
    return {
      ...head,
      kpis: plain(v.ctrKpis),
      /** [key, value, disabled]; labels, types and options are in `fieldDefs`. */
      fields: plain(v.ctrFields).map((f: any) => [f.k, f.value, f.disabled]),
      amendments: plain(v.ctrAmend).map((a: any) => pick(a, ['label', 'amtText', 'status', 'date', 'doc', 'stClass', 'hasDoc'])),
      bonds: plain(v.ctrBonds).map((b: any) => pick(b, ['label', 'amtText', 'state', 'released', 'stateColor'])),
      milestones: plain(v.ctrMs).map((m: any) => pick(m, ['id', 'label', 'pctText', 'amtText', 'due', 'status', 'late', 'condText'])),
      schedTotal: plain(v.ctrSchedTotal),
    };
  return {
    ...head,
    kpis: plain(v.billKpis), bill: plain(v.ctrBill),
    toInvoice: plain(v.ctrToInvoice).map((m: any) => pick(m, ['id', 'label', 'due', 'pctText', 'late', 'amtText', 'dueColor'])),
    invoices: plain(v.ctrInvoices).map((i: any) => pick(i, ['no', 'msId', 'label', 'issued', 'amtText', 'due', 'dueColor', 'paid', 'status', 'stClass', 'canPay', 'overdue', 'note'])),
    noToInvoice: v.noToInvoice, noInvoices: v.noInvoices,
  };
}

const LABELS = [
  'Contract sheet', 'Fill in the terms once · billing, change control and the client portal read from here', 'Open contract', 'Amendments', 'Add amendment',
  'Bonds & guarantees', 'Add guarantee', 'Payment milestones', 'Contractual schedule · invoicing is tracked on the Billing page', 'Add payment milestone',
  'Milestone', 'Share', 'Amount', 'Contractual date', 'Condition', 'Total', 'No contract registered for this project', 'Billing progress', 'Contract value',
  'Retention held by client', 'To invoice', 'Planned milestones in contractual order · a date already passed is flagged', 'Late', 'Issue invoice',
  'All milestones invoiced', 'Invoices', 'Invoice', 'Issued on', 'Payment due', 'Paid on', 'Status', 'Mark paid', 'No invoice issued yet',
  'Contract', 'Billing & payments', 'Collected', 'Invoiced, awaiting payment', 'Not yet invoiced',
  // AF dialogs (amendment, bond, milestone, billing) and their results.
  'Subject', 'Linked change request', 'Amount (k€)', 'Signature date', 'Document reference', 'Register amendment', 'Draft', 'Sent for signature',
  'Awaiting signature', 'Signed', 'Type', 'Issuer', 'Valid until', 'Register guarantee', 'Performance bond', 'Advance payment bond', 'Retention bond',
  'Warranty bond', 'Parent company guarantee', 'Share of contract (%)', 'Add milestone', 'Invoice number', 'Invoice date', 'Note on the invoice',
  'Amendment registered', 'Guarantee registered', 'Payment milestone added', 'Invoice issued', 'sent to the client', 'Paid', 'Overdue', 'Awaiting payment',
  'Planned', 'Invoiced', 'Lump sum (EPC)', 'Unit rates', 'Cost plus', 'Framework agreement', 'Reference', 'Client', 'Contract type', 'Signed on',
  'Base amount (k€)', 'Payment terms', 'Retention (%)', 'Retention release', 'Liquidated damages', 'Warranty', 'Governing law', 'Scope summary',
  'Contract value', 'Amendments pending', 'Guarantees in force', 'Invoiced', 'Outstanding receivables', 'Overdue receivables', 'Next to invoice',
  'Port authority', 'Net 45 days', 'Released at final acceptance + 12 months', '0.5 % per week · cap 10 %', '24 months from SAT',
  'French law · Commercial court of Le Havre', 'Permits approved', 'Foundations complete', 'Structure topped out (80 % erected)', 'Cranes operational',
  'Handover (SAT)', 'Amendment 1 — anti-collision lidar (CR-004)', 'Amendment 2 — crane upgrade 250 t (CR-006)',
];

/** Runs a dialog submission through the prototype's own afSubmit (validation included); returns the toast. */
function submitAf(c: any, key: string, values: any) {
  c.setState({ af: { open: true, key, values } });
  const v = c.renderVals();
  v.afSubmit();
  return c.state.toast as string;
}

/** Opens the dialog the way the screen does and reads its fields (values, options). */
function openAf(c: any, open: (v: any) => void) {
  open(c.renderVals());
  const v = c.renderVals();
  return { ...pick(plain(v.afForm), ['title', 'submit', 'isRun']), fields: plain(v.afForm.fields).map((f: any) => pick(f, ['id', 'label', 'req', 'value', 'options', 'span'])) };
}

const out: any = { scenarios: {}, dialogs: {}, toasts: {}, dst: {}, labels: {} as any };
/** Template labels of both screens («…» in template-annotated.html 814–869) and dialog texts, in FR (trFR). */
for (const l of LABELS) out.labels[l] = ctx.__trFR(l);
for (const lang of ['en', 'fr']) {
  const v = comp({ lang, screen: 'contract' }).renderVals();
  out[`fieldDefs|${lang}`] = plain(v.ctrFields).map((f: any) => pick(f, ['k', 'label', 'isSelect', 'isNumber', 'isTextarea', 'isText', 'span', 'options']));
}

for (const lang of ['en', 'fr'] as const) {
  const S = (name: string, state: any, screen = 'contract') => {
    out.scenarios[`${name}|${screen}|${lang}`] = snapshot(comp({ ...state, lang, screen }));
  };
  for (const screen of ['contract', 'billing']) {
    S('seed', {}, screen);
    S('pm', { role: 'pm' }, screen);
    S('procurement', { role: 'procurement' }, screen);
    S('client', { role: 'client' }, screen);
    // The other personas: both screens outside their workspace (read-only render, no primary, no edit buttons).
    for (const role of ['depthead', 'member', 'englead', 'quality']) S(role, { role }, screen);
    S('pm-ndc', { role: 'pm', project: 'NDC-031' }, screen);
    S('no-contract', { project: 'NDC-031' }, screen);
  }

  // Mutations, each through the prototype's afSubmit or row handlers, rendered on both screens.
  const scen: [string, (c: any) => void][] = [
    ['issue-m4', (c) => { out.toasts[`issue-m4|${lang}`] = submitAf(c, 'billing', { ms: 'M4 · Cranes operational', no: 'INV-2026-004', date: '30 Sep 2026', note: 'Cranes 1–2 accepted' }); }],
    ['issue-m4-overdue', (c) => { submitAf(c, 'billing', { ms: 'M4 · Cranes operational', no: 'INV-2026-004', date: '1 Aug 2026', note: '' }); }],
    ['issue-all', (c) => {
      submitAf(c, 'billing', { ms: 'M4 · Cranes operational', no: 'INV-2026-004', date: '30 Sep 2026', note: '' });
      submitAf(c, 'billing', { ms: 'M5 · Handover (SAT)', no: 'INV-2026-005', date: '14 Jan 2027', note: '' });
    }],
    ['pay-m3', (c) => { c.renderVals().ctrInvoices.find((i: any) => i.msId === 'M3').pay(); }],
    ['pay-all', (c) => {
      submitAf(c, 'billing', { ms: 'M4 · Cranes operational', no: 'INV-2026-004', date: '30 Sep 2026', note: '' });
      for (const id of ['M3', 'M4']) c.renderVals().ctrInvoices.find((i: any) => i.msId === id).pay();
    }],
    ['amend-signed', (c) => { out.toasts[`amend-signed|${lang}`] = submitAf(c, 'amendment', { label: 'Amendment 3 — extra lighting', cr: 'CR-007', amt: '80', status: 'Signed', date: '30 Sep 2026', doc: 'CTR-HLT-003' }); }],
    ['amend-draft', (c) => { submitAf(c, 'amendment', { label: 'Amendment 3 — extra lighting', cr: '', amt: '80', status: 'Draft', date: '', doc: '' }); }],
    // A second signed amendment of 0 k€: plural sub-line, same value.
    ['amend-sign-all', (c) => {
      c.setState({ added: added(c, { amendments: [{ label: 'x', cr: '', amt: '0', status: 'Signed', date: '', doc: '', proj: 'HLT-026' }] }) });
    }],
    ['bond', (c) => { out.toasts[`bond|${lang}`] = submitAf(c, 'bond', { label: 'Warranty bond', amt: '280', issuer: 'BNP Paribas', valid: '14 Jan 2029' }); }],
    ['milestone', (c) => { out.toasts[`milestone|${lang}`] = submitAf(c, 'milestone', { label: 'Final acceptance', pct: '5', due: '14 Jan 2028', cond: 'Final acceptance certificate signed' }); }],
    ['milestone-late', (c) => { submitAf(c, 'milestone', { label: 'Design review', pct: '2.5', due: '15 Sep 2026', cond: '' }); }],
    ['sheet', (c) => { c.setState({ ctrInfo: { 'HLT-026': { amount: '6000', terms: 'Net 30 days', retention: '10', ld: '1 % per week · cap 5 %', warranty: '36 months from SAT', ref: 'CTR-HLT-001-A' } } }); }],
    ['sheet-terms60', (c) => { c.setState({ ctrInfo: { 'HLT-026': { terms: 'Net 60 days' } } }); }],
  ];
  for (const [name, mutate] of scen) {
    const c = comp({ lang, screen: 'billing' });
    mutate(c);
    for (const screen of ['contract', 'billing']) out.scenarios[`${name}|${screen}|${lang}`] = snapshot(comp({ ...c.state, lang, screen, toast: '' }));
  }

  // Dialogs as the screens open them: header primary of Billing (first planned milestone), the Contract "Add …" buttons.
  out.dialogs[`billing-primary|${lang}`] = openAf(comp({ lang, screen: 'billing' }), (v) => v.primaryOnClick());
  // A "To invoice" row pre-selects its milestone (`afOpenWith('billing', {ms})`).
  out.dialogs[`billing-row-m5|${lang}`] = openAf(comp({ lang, screen: 'billing' }), (v) => v.ctrToInvoice.find((m: any) => m.id === 'M5').issue());
  for (const [key, opener] of [['amendment', 'addAmendment'], ['bond', 'addBond'], ['milestone', 'addMilestone']] as const) {
    const c3 = comp({ lang, screen: 'contract' });
    out.dialogs[`${key}|${lang}`] = openAf(c3, (v) => v[opener]());
  }
}

// The DST defect, for the record: the same seed in Europe/Paris shows M3's due date as "9 Nov".
out.dst = { tz: process.env.TZ ?? '', m3Due: out.scenarios['seed|billing|en'].invoices.find((i: any) => i.msId === 'M3').due };

const target = path.join(root, 'src/features/contract/contract.golden.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out) + '\n');
console.log('wrote', path.relative(root, target), Math.round(fs.statSync(target).size / 1024) + ' KB', 'tz', out.dst);
