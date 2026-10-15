// Contract & Billing Server Functions against in-memory seeded databases: permission gate (read-only, outside,
// no contract), validation of the forms and sheet fields, and — for each mutation the screens offer — the screens
// rebuilt from the database after the write compared with the same scenario applied to the seed fixture (whose views
// model.test.ts compares with the prototype's own render, contract.golden.json, EN and FR, with the owner's decisions:
// NEW-D3-3 amendment milestones, C-6 payment rule, C-9 currency). Session and project context are mocked; the viewer is the actor.
// Delivery 7: the signature cycle and the release of a guarantee (R-079), the payment rule and currency fields (R-076, R-075)
// and the project's budget rate — the portfolio director only.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', role: 'pm', lang: 'en' as 'en' | 'fr', edit: { contract: true, billing: true } as Record<string, boolean> };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (_code: string, screen: string) => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: (s: string = screen) => !!viewer.edit[s] }),
}));

import { makeT, type Lang } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { customerInvoices, paymentMilestones } from '@/server/db/schema';
import { getBudgetContract } from '@/server/dal/budget';
import { listEurBillingPlans } from '@/server/dal/cashflow';
import { getContract, lateBillingMilestonesByProject } from '@/server/dal/contract';
import { getProjectFx } from '@/server/dal/currency';
import { listAudit } from '@/server/dal/notifications';
import {
  addAmendmentAction, addBondAction, addPaymentMilestoneAction, issueInvoiceAction, markInvoicePaidAction, releaseBondAction, sendAmendmentAction,
  setBudgetRateAction, signAmendmentAction, updateContractFieldAction,
} from './actions';
import { billingView, contractView } from './model';
import { G, scenarioData } from './test-fixtures';

const fresh = async () => setDb(await openDatabase());
const hlt = async () => (await getContract('HLT-026'))!;

/** The Contract screen rebuilt from the database = the fixture's `scenario` (prototype state + owner decisions). */
async function expectContract(scenario: string, lang: Lang, parts: ('kpis' | 'amendments' | 'bonds' | 'milestones' | 'fields')[] = ['kpis', 'amendments', 'bonds', 'milestones', 'fields']) {
  const t = makeT(lang);
  const v = contractView(await hlt(), t, lang);
  const w = contractView(scenarioData(scenario), t, lang);
  if (parts.includes('kpis')) expect(v.kpis).toEqual(w.kpis);
  if (parts.includes('fields')) expect(v.fields.map((f) => [f.key, f.value])).toEqual(w.fields.map((f) => [f.key, f.value]));
  if (parts.includes('amendments'))
    expect(v.amendments.map((a) => [a.label, a.amount, a.status, a.date, a.doc ?? '', a.tagClass])).toEqual(w.amendments.map((a) => [a.label, a.amount, a.status, a.date, a.doc ?? '', a.tagClass]));
  if (parts.includes('bonds')) expect(v.bonds.map((b) => [b.label, b.amount, b.state, b.released])).toEqual(w.bonds.map((b) => [b.label, b.amount, b.state, b.released]));
  if (parts.includes('milestones')) {
    expect(v.milestones).toEqual(w.milestones);
    expect([v.groups, v.total, v.baseTotal]).toEqual([w.groups, w.total, w.baseTotal]);
  }
}

/** The Billing screen rebuilt from the database = the fixture's `scenario`. */
async function expectBilling(scenario: string, lang: Lang) {
  const t = makeT(lang);
  const v = billingView(await hlt(), t, lang);
  const w = billingView(scenarioData(scenario), t, lang);
  expect([v.kpis, v.progress, v.toInvoice, v.invoices, v.terms]).toEqual([w.kpis, w.progress, w.toInvoice, w.invoices, w.terms]);
}

beforeEach(() => {
  viewer.name = 'Romain Aubert';
  viewer.role = 'pm';
  viewer.lang = 'en';
  viewer.edit = { contract: true, billing: true };
});

describe('permission gate and validation', () => {
  beforeAll(fresh, 60_000);

  it('the seed = the fixture (NEW-D3-3 seed: base-priced invoices, Amendment 1’s M6)', async () => {
    for (const lang of ['en', 'fr'] as const) {
      await expectContract('seed', lang);
      await expectBilling('seed', lang);
    }
  });

  it('refuses viewers who may not edit, unknown projects, projects without a contract, forged payloads', async () => {
    viewer.edit = { contract: false, billing: false };
    expect(await updateContractFieldAction('HLT-026', 'amount', '1')).toEqual({ error: 'This contract is read-only for you' });
    expect(await addAmendmentAction('HLT-026', { label: 'x', amt: '1' })).toEqual({ error: 'This contract is read-only for you' });
    expect(await addBondAction('HLT-026', { amt: '1', issuer: 'x', valid: '1 Jan 2027' })).toEqual({ error: 'This contract is read-only for you' });
    expect(await addPaymentMilestoneAction('HLT-026', { label: 'x', pct: '1', due: '1 Jan 2027' })).toEqual({ error: 'This contract is read-only for you' });
    expect(await issueInvoiceAction('HLT-026', { ms: 'M4', no: 'X', date: '30 Sep 2026' })).toEqual({ error: 'Billing is read-only for you' });
    expect(await markInvoicePaidAction('HLT-026', 'M3')).toEqual({ error: 'Billing is read-only for you' });
    expect(await sendAmendmentAction('HLT-026', 1)).toEqual({ error: 'This contract is read-only for you' });
    expect(await signAmendmentAction('HLT-026', 1, { date: '30 Sep 2026' })).toEqual({ error: 'This contract is read-only for you' });
    expect(await releaseBondAction('HLT-026', 0, { date: '30 Sep 2026' })).toEqual({ error: 'This contract is read-only for you' });
    // Procurement may edit the contract (its workspace) but not billing (outside): each screen is gated on its own.
    viewer.edit = { contract: true, billing: false };
    expect(await markInvoicePaidAction('HLT-026', 'M3')).toEqual({ error: 'Billing is read-only for you' });
    viewer.lang = 'fr';
    viewer.edit = { contract: false, billing: false };
    expect(await addAmendmentAction('HLT-026', { label: 'x', amt: '1' })).toEqual({ error: 'Ce contrat est en lecture seule pour vous' });
    viewer.edit = { contract: true, billing: true };
    expect(await issueInvoiceAction('NOPE-000', {})).toEqual({ error: 'Projet inconnu' });
    viewer.lang = 'en';
    expect(await issueInvoiceAction('', {})).toEqual({ error: 'Invalid request' });
    expect(await addAmendmentAction('NDC-031', { label: 'x', amt: '1' })).toEqual({ error: 'No contract registered for this project' });
    expect(await markInvoicePaidAction('EWA-051', 'M1')).toEqual({ error: 'No contract registered for this project' });
    expect(await sendAmendmentAction('NDC-031', 0)).toEqual({ error: 'No contract registered for this project' });
    expect(await addAmendmentAction('HLT-026', { label: 42, amt: ['1'] } as never)).toEqual({ error: 'Subject is required' });
    expect(await updateContractFieldAction('HLT-026', 'owner', 'x')).toEqual({ error: 'Invalid request' });
    expect(await updateContractFieldAction('HLT-026', 'amount', 5 as never)).toEqual({ error: 'Invalid request' });
    // Forged amendment / guarantee positions.
    for (const pos of [-1, 1.5, 99, '1' as never, null as never]) {
      expect(await sendAmendmentAction('HLT-026', pos)).toEqual({ error: 'Unknown amendment' });
      expect(await signAmendmentAction('HLT-026', pos, { date: '30 Sep 2026' })).toEqual({ error: 'Unknown amendment' });
      expect(await releaseBondAction('HLT-026', pos, { date: '30 Sep 2026' })).toEqual({ error: 'Unknown guarantee' });
    }
    // Nothing was written.
    const c = await hlt();
    expect([c.amendments.length, c.bonds.length, c.milestones.length, c.invoices.length, c.sheet.baseAmountKeur]).toEqual([2, 2, 6, 3, 5400]);
    expect(c.amendments.map((a) => a.status)).toEqual(['signed', 'awaiting_signature']);
  });

  it('form validation messages (EN and FR)', async () => {
    expect(await addBondAction('HLT-026', { label: 'warranty', amt: '10', issuer: 'BNP', valid: 'next year' })).toEqual({ error: 'Enter a date such as 14 Dec 2026' });
    viewer.lang = 'fr';
    expect(await addBondAction('HLT-026', { label: 'warranty', amt: '10', issuer: 'BNP', valid: 'l’an prochain' })).toEqual({ error: 'Saisissez une date comme 14 déc. 2026' });
    expect(await addPaymentMilestoneAction('HLT-026', { label: 'x', pct: '120', due: '1 janv. 2027' })).toEqual({ error: 'Saisissez une part entre 0 et 100 %' });
    expect(await addPaymentMilestoneAction('HLT-026', { basis: '7', label: 'x', pct: '10', due: '1 janv. 2027' })).toEqual({ error: 'Avenant inconnu' });
    expect(await issueInvoiceAction('HLT-026', { ms: 'M3', no: 'X', date: '30 sept. 2026' })).toEqual({ error: 'Choisissez un jalon restant à facturer' });
    expect(await updateContractFieldAction('HLT-026', 'retention', '120')).toEqual({ error: 'Saisissez un pourcentage entre 0 et 100' });
    expect(await updateContractFieldAction('HLT-026', 'days', '200')).toEqual({ error: 'Saisissez un nombre de jours entre 0 et 180' });
    expect(await addAmendmentAction('HLT-026', { label: 'x', amt: '1', status: 'signed' })).toEqual({ error: 'Saisissez la date de signature d’un avenant signé' });
    expect(await markInvoicePaidAction('HLT-026', 'M4')).toEqual({ error: 'Cette facture n’est pas en attente de paiement' });
    expect(await markInvoicePaidAction('HLT-026', 'M2')).toEqual({ error: 'Cette facture n’est pas en attente de paiement' });
  });
});

describe('Issue invoice (AF.billing)', () => {
  beforeAll(fresh, 60_000);

  it('issues M4 (FR date typed), toast, screens = scenario "issue-m4" (M4 at the base amount, NEW-D3-3), audit and activity by the viewer', async () => {
    viewer.lang = 'fr';
    expect(await issueInvoiceAction('HLT-026', { ms: 'M4', no: 'INV-2026-004', date: '30 sept. 2026', note: 'Cranes 1–2 accepted' })).toEqual({
      toast: G.toasts['issue-m4|fr'],
    });
    for (const lang of ['en', 'fr'] as const) {
      await expectBilling('issue-m4', lang);
      await expectContract('issue-m4', lang);
    }
    expect((await hlt()).invoices.at(-1)).toMatchObject({ number: 'INV-2026-004', amountKeur: 1080, currency: 'EUR' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'INV-2026-004' });
  });

  it('refuses a used number and an already invoiced milestone; the next number follows', async () => {
    expect(await issueInvoiceAction('HLT-026', { ms: 'M5', no: 'INV-2026-004', date: '14 Jan 2027' })).toEqual({ error: 'INV-2026-004 · This invoice number is already used' });
    expect(await issueInvoiceAction('HLT-026', { ms: 'M4', no: 'INV-2026-009', date: '14 Jan 2027' })).toEqual({ error: 'Choose a milestone still to invoice' });
    expect((await hlt()).nextInvoiceNumber).toBe('INV-2026-005');
  });
});

describe('Mark paid', () => {
  beforeAll(fresh, 60_000);

  it('M4 issued then M3 and M4 paid on 30 Sep = scenario "pay-all"; a planned or paid milestone is refused', async () => {
    expect(await issueInvoiceAction('HLT-026', { ms: 'M4', no: 'INV-2026-004', date: '30 Sep 2026', note: '' })).toEqual({ toast: G.toasts['issue-m4|en'] });
    expect(await markInvoicePaidAction('HLT-026', 'M3')).toEqual({ ok: true });
    expect(await markInvoicePaidAction('HLT-026', 'M4')).toEqual({ ok: true });
    for (const lang of ['en', 'fr'] as const) await expectBilling('pay-all', lang);
    expect(await markInvoicePaidAction('HLT-026', 'M5')).toEqual({ error: 'This invoice is not awaiting payment' });
    expect(await markInvoicePaidAction('HLT-026', 'M3')).toEqual({ error: 'This invoice is not awaiting payment' });
    expect(await markInvoicePaidAction('HLT-026', 42 as never)).toEqual({ error: 'This invoice is not awaiting payment' });
  });
});

describe('Add amendment / guarantee (AF.amendment, AF.bond)', () => {
  beforeAll(fresh, 60_000);

  it('a signed amendment raises the value but re-prices no milestone (NEW-D3-3) = scenario "amend-signed"; a guarantee = "bond"', async () => {
    expect(
      await addAmendmentAction('HLT-026', { label: 'Amendment 3 — extra lighting', cr: 'CR-007', amt: '80', status: 'signed', date: '30 Sep 2026', doc: 'CTR-HLT-003' }),
    ).toEqual({ toast: G.toasts['amend-signed|en'] });
    for (const lang of ['en', 'fr'] as const) {
      await expectContract('amend-signed', lang);
      await expectBilling('amend-signed', lang);
    }
    // Its amount waits for its own milestones: the schedule says so.
    expect(contractView(await hlt(), makeT('en'), 'en').groups.at(-1)).toMatchObject({ label: 'Amendment 3 — extra lighting (CR-007)', ok: false, hint: 'No payment milestone for this amendment' });
    viewer.lang = 'fr';
    expect(await addBondAction('HLT-026', { label: 'warranty', amt: '280', issuer: 'BNP Paribas', valid: '14 janv. 2029' })).toEqual({ toast: G.toasts['bond|fr'] });
    for (const lang of ['en', 'fr'] as const) await expectContract('bond', lang, ['bonds']);
    const k = contractView(await hlt(), makeT('en'), 'en').kpis[2];
    expect(k).toEqual(G.scenarios['bond|contract|en'].kpis[2]);
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'CTR-HLT-001' });
  });
});

describe('Add payment milestone (AF.milestone)', () => {
  beforeAll(fresh, 60_000);

  it('M7 due 15 Sep is late = scenario "milestone-late" (share total 102,5 %, Billing badge 1)', async () => {
    viewer.lang = 'fr';
    expect(await addPaymentMilestoneAction('HLT-026', { label: 'Design review', pct: '2,5', due: '15 sept. 2026', cond: '' })).toEqual({ toast: G.toasts['milestone|fr'] });
    for (const lang of ['en', 'fr'] as const) {
      await expectContract('milestone-late', lang);
      await expectBilling('milestone-late', lang);
    }
    expect((await lateBillingMilestonesByProject())['HLT-026']).toBe(1);
  });

  it('NEW-D3-3: a milestone of an amendment not signed yet is listed, not billable, and cannot be invoiced', async () => {
    expect(await addPaymentMilestoneAction('HLT-026', { basis: '1', label: 'Crane upgrade delivered', pct: '100', due: '1 Sep 2026' })).toEqual({ toast: 'Payment milestone added' });
    const c = await hlt();
    expect(c.milestones.at(-1)).toMatchObject({ number: 'M8', amendment: 1, amountKeur: 260, billable: false, late: false });
    expect(await issueInvoiceAction('HLT-026', { ms: 'M8', no: 'INV-2026-010', date: '30 Sep 2026' })).toEqual({ error: 'Choose a milestone still to invoice' });
    // Not late (not billable) in the Billing badge; not in the billing plans of Cash flow.
    expect((await lateBillingMilestonesByProject())['HLT-026']).toBe(1);
    expect((await listEurBillingPlans())['HLT-026'].milestones.map((m) => m.number)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
  });
});

describe('Signature cycle and guarantee release (R-079)', () => {
  beforeAll(fresh, 60_000);

  it('draft → sent for signature → signed; its milestones become billable; each step audited with an activity', async () => {
    expect(await addAmendmentAction('HLT-026', { label: 'Amendment 3 — extra lighting', amt: '80', status: 'draft' })).toEqual({ toast: 'Amendment 3 — extra lighting · Amendment registered' });
    expect(await addPaymentMilestoneAction('HLT-026', { basis: '2', label: 'Lighting commissioned', pct: '100', due: '14 Dec 2026' })).toEqual({ toast: 'Payment milestone added' });
    // A draft cannot be signed; a signed one cannot be sent.
    expect(await signAmendmentAction('HLT-026', 2, { date: '30 Sep 2026' })).toEqual({ error: 'Only an amendment sent for signature can be signed' });
    expect(await sendAmendmentAction('HLT-026', 0)).toEqual({ error: 'Only a draft amendment can be sent for signature' });
    expect(await sendAmendmentAction('HLT-026', 2)).toEqual({ toast: 'Amendment 3 — extra lighting · Sent for signature' });
    expect(await sendAmendmentAction('HLT-026', 2)).toEqual({ error: 'Only a draft amendment can be sent for signature' });
    let c = await hlt();
    expect(c.amendments[2]).toMatchObject({ status: 'sent_for_signature', sentOn: '2026-09-30', canSend: false, canSign: true });
    expect(contractView(c, makeT('fr'), 'fr').amendments[2].date).toBe('Envoyé pour signature le 30 sept. 2026');
    expect(c.valueKeur).toBe(5520);
    expect(await signAmendmentAction('HLT-026', 2, { date: 'tomorrow' })).toEqual({ error: 'Enter a date such as 14 Dec 2026' });
    viewer.lang = 'fr';
    expect(await signAmendmentAction('HLT-026', 2, { date: '2 oct. 2026', doc: 'CTR-HLT-003' })).toEqual({ toast: 'Amendment 3 — extra lighting · Avenant signé' });
    c = await hlt();
    expect(c.amendments[2]).toMatchObject({ status: 'signed', signedOn: '2026-10-02', documentRef: 'CTR-HLT-003', canSign: false });
    expect(c.valueKeur).toBe(5600);
    // The existing milestones did not move; the amendment's own milestone is billable.
    expect(c.milestones.map((m) => [m.number, m.amountKeur, m.billable])).toEqual([
      ['M1', 540, true], ['M2', 1080, true], ['M3', 1350, true], ['M4', 1080, true], ['M5', 1350, true], ['M6', 120, true], ['M7', 80, true],
    ]);
    expect(await issueInvoiceAction('HLT-026', { ms: 'M7', no: 'INV-2026-004', date: '30 Sep 2026' })).toMatchObject({ toast: expect.stringContaining('INV-2026-004 · M7') });
    expect((await hlt()).invoices.at(-1)).toMatchObject({ number: 'INV-2026-004', amountKeur: 80 });
    // Awaiting signature (the seed's Amendment 2) is signed the same way.
    viewer.lang = 'en';
    expect(await signAmendmentAction('HLT-026', 1, { date: '1 Oct 2026' })).toEqual({ toast: 'Amendment 2 — crane upgrade 250 t (CR-006) · Amendment signed' });
    expect((await hlt()).valueKeur).toBe(5860);
    const audit = await listAudit();
    expect(audit.slice(0, 4).map((a) => a.change)).toEqual(expect.arrayContaining([
      'amendment Amendment 2 — crane upgrade 250 t (CR-006) · status: Awaiting signature → Signed · 2026-10-01',
    ]));
  });

  it('a guarantee in force is released once, on the date given', async () => {
    expect(await releaseBondAction('HLT-026', 1, { date: '30 Sep 2026' })).toEqual({ error: 'This guarantee is already released' });
    expect(await releaseBondAction('HLT-026', 0, { date: 'never' })).toEqual({ error: 'Enter a date such as 14 Dec 2026' });
    expect(await releaseBondAction('HLT-026', 0, { date: '30 Sep 2026' })).toEqual({ toast: 'Performance bond · Guarantee released' });
    const c = await hlt();
    expect(c.bonds.map((b) => [b.inForce, b.releasedOn])).toEqual([[false, '2026-09-30'], [false, '2026-09-12']]);
    expect(c.bondsInForce).toEqual({ count: 0, total: 2, amountKeur: 0 });
    expect(await releaseBondAction('HLT-026', 0, { date: '1 Oct 2026' })).toEqual({ error: 'This guarantee is already released' });
  });
});

describe('Contract sheet edits', () => {
  beforeAll(fresh, 60_000);

  it('per-field saves = scenario "sheet"; Budget › Cash & recovery reads the new terms and amount', async () => {
    for (const [k, v] of [['ref', 'CTR-HLT-001-A'], ['amount', '6000'], ['days', '30'], ['retention', '10'], ['ld', '1 % per week · cap 5 %'], ['warranty', '36 months from SAT']])
      expect(await updateContractFieldAction('HLT-026', k, v)).toEqual({ ok: true });
    for (const lang of ['en', 'fr'] as const) {
      await expectContract('sheet', lang);
      await expectBilling('sheet', lang);
    }
    expect(await getBudgetContract('HLT-026')).toMatchObject({ ref: 'CTR-HLT-001-A', amount: 6000, terms: 'Net 30 days' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'CTR-HLT-001-A', change: 'warranty: 24 months from SAT → 36 months from SAT' });
  });

  it('C-6: the payment rule moves the due dates and the terms text', async () => {
    expect(await updateContractFieldAction('HLT-026', 'rule', 'days_eom')).toEqual({ ok: true });
    let c = await hlt();
    expect([c.sheet.paymentRule, c.sheet.paymentDays, c.sheet.paymentTerms]).toEqual(['days_eom', 30, '30 days end of month']);
    expect(c.invoices.map((i) => i.dueOn)).toEqual(['2026-04-30', '2026-08-31', '2026-10-31']);
    expect(billingView(c, makeT('fr'), 'fr').terms).toBe('30 jours fin de mois');
    expect(await updateContractFieldAction('HLT-026', 'rule', 'eom_days')).toEqual({ ok: true });
    c = await hlt();
    expect(c.invoices.map((i) => i.dueOn)).toEqual(['2026-04-30', '2026-08-30', '2026-10-30']);
    expect(await updateContractFieldAction('HLT-026', 'rule', 'Net')).toEqual({ error: 'Unknown payment rule' });
    expect((await listAudit())[0].change).toBe('paymentRule: days_eom → eom_days');
  });

  it('contract type code, French signature date, empty date; invalid values refused without writing', async () => {
    expect(await updateContractFieldAction('HLT-026', 'type', 'cost_plus')).toEqual({ ok: true });
    expect(await updateContractFieldAction('HLT-026', 'signed', '2 févr. 2026')).toEqual({ ok: true });
    let c = await hlt();
    expect([c.sheet.type, c.sheet.signedOn]).toEqual(['cost_plus', '2026-02-02']);
    expect(await updateContractFieldAction('HLT-026', 'signed', '')).toEqual({ ok: true });
    expect(await updateContractFieldAction('HLT-026', 'type', 'Cost plus')).toEqual({ error: 'Unknown contract type' });
    expect(await updateContractFieldAction('HLT-026', 'ref', '  ')).toEqual({ error: 'Reference is required' });
    expect(await updateContractFieldAction('HLT-026', 'amount', '-5')).toEqual({ error: 'Enter an amount in k€' });
    c = await hlt();
    expect([c.sheet.type, c.sheet.signedOn, c.sheet.reference, c.sheet.baseAmountKeur]).toEqual(['cost_plus', null, 'CTR-HLT-001-A', 6000]);
  });
});

describe('Currency and budget rate (C-9, R-075)', () => {
  beforeAll(fresh, 60_000);

  it('the budget rate is the portfolio director’s; a currency needs it; invoices fix the contract currency', async () => {
    // The PM cannot set the rate; nor can anyone else but the director — and Finance since R-044 (C-9 default).
    expect(await setBudgetRateAction('HLT-026', 'USD', '0.9')).toEqual({ error: 'Only the portfolio director and Finance set the budget rate' });
    viewer.role = 'procurement';
    expect(await setBudgetRateAction('HLT-026', 'USD', '0.9')).toEqual({ error: 'Only the portfolio director and Finance set the budget rate' });
    // The contract cannot move to a currency the project does not use.
    viewer.role = 'pm';
    expect(await updateContractFieldAction('HLT-026', 'currency', 'USD')).toEqual({ error: 'The currency cannot change once an invoice is issued' });
    viewer.role = 'director';
    viewer.name = 'Hélène Marchetti';
    // A read-only project keeps its rate, even for the director.
    viewer.edit = { contract: false, billing: false };
    expect(await setBudgetRateAction('HLT-026', 'USD', '0.9')).toEqual({ error: 'This contract is read-only for you' });
    viewer.edit = { contract: true, billing: true };
    expect(await setBudgetRateAction('HLT-026', 'usd', '0.9')).toEqual({ error: 'Unknown currency' });
    expect(await setBudgetRateAction('HLT-026', 'USD', '')).toEqual({ error: 'Enter a budget rate in euros per unit' });
    expect(await setBudgetRateAction('HLT-026', 'USD', '-1')).toEqual({ error: 'Enter a budget rate in euros per unit' });
    expect(await setBudgetRateAction('NOPE-000', 'USD', '0.9')).toEqual({ error: 'Unknown project' });
    expect(await setBudgetRateAction('HLT-026', 'USD', '0,92')).toEqual({ ok: true });
    expect(await getProjectFx('HLT-026')).toEqual({ currency: 'USD', budgetRate: 0.92 });
    expect((await listAudit())[0]).toMatchObject({ object: 'HLT-026', change: 'budget rate: EUR → USD · 1 USD = 0.92 €' });
    // The seed contract has invoices: its currency is fixed (EUR), whatever the project currency.
    expect(await updateContractFieldAction('HLT-026', 'currency', 'USD')).toEqual({ error: 'The currency cannot change once an invoice is issued' });
    // Back to EUR clears the rate.
    expect(await setBudgetRateAction('HLT-026', 'EUR', '5')).toEqual({ ok: true });
    expect(await getProjectFx('HLT-026')).toEqual({ currency: 'EUR', budgetRate: null });
  });

  it('a contract in the project currency: its screens in USD, Budget and Cash flow in euros at the budget rate; the project currency is then fixed', async () => {
    await fresh();
    viewer.role = 'director';
    viewer.name = 'Hélène Marchetti';
    expect(await setBudgetRateAction('HLT-026', 'USD', '0.92')).toEqual({ ok: true });
    // Test set-up: a contract without any invoice yet (the seed's three removed, their milestones planned again).
    const db = await getDb();
    await db.delete(customerInvoices);
    await db.update(paymentMilestones).set({ status: 'planned' });
    viewer.role = 'pm';
    viewer.name = 'Romain Aubert';
    expect(await updateContractFieldAction('HLT-026', 'currency', 'GBP')).toEqual({ error: 'A document is in euros or in the project currency' });
    expect(await updateContractFieldAction('HLT-026', 'currency', 'XXX')).toEqual({ error: 'Unknown currency' });
    expect(await updateContractFieldAction('HLT-026', 'currency', 'USD')).toEqual({ ok: true });
    expect((await listAudit())[0]).toMatchObject({ object: 'CTR-HLT-001', change: 'currency: EUR → USD' });
    const c = await hlt();
    expect([c.sheet.currency, c.fx]).toEqual(['USD', { currency: 'USD', budgetRate: 0.92 }]);
    // The contract's own screens: amounts in dollars, the euro equivalent beside them.
    const v = contractView(c, makeT('en'), 'en');
    expect(v.kpis[0].value).toBe('$5.52M');
    expect(contractView(c, makeT('fr'), 'fr').kpis[0].value).toBe('5,52 M$');
    // Consolidations in euros at 0.92: Budget › Cash & recovery, Cash flow & billing.
    const budget = (await getBudgetContract('HLT-026'))!;
    expect(budget.amount).toBeCloseTo(4968, 6);
    expect(budget.milestones[0].amount).toBeCloseTo(540 * 0.92, 6);
    const plan = (await listEurBillingPlans())['HLT-026'];
    expect([plan.currency, plan.eurRate]).toEqual(['EUR', 1]);
    expect(plan.contractValueKeur).toBeCloseTo(5520 * 0.92, 6);
    // An invoice is issued in the contract currency.
    expect(await issueInvoiceAction('HLT-026', { ms: 'M1', no: 'INV-2026-010', date: '30 Sep 2026' })).toHaveProperty('toast');
    expect((await hlt()).invoices.at(-1)).toMatchObject({ number: 'INV-2026-010', amountKeur: 540, currency: 'USD' });
    expect(await updateContractFieldAction('HLT-026', 'currency', 'EUR')).toEqual({ error: 'The currency cannot change once an invoice is issued' });
    // Documents in USD: the project currency is fixed; its budget rate may still be revised.
    viewer.role = 'director';
    viewer.name = 'Hélène Marchetti';
    expect(await setBudgetRateAction('HLT-026', 'GBP', '1.15')).toEqual({ error: 'Documents of this project are in its currency: it cannot change' });
    expect(await setBudgetRateAction('HLT-026', 'EUR', '')).toEqual({ error: 'Documents of this project are in its currency: it cannot change' });
    expect(await setBudgetRateAction('HLT-026', 'USD', '0.95')).toEqual({ ok: true });
    expect((await listEurBillingPlans())['HLT-026'].contractValueKeur).toBeCloseTo(5520 * 0.95, 6);
    expect((await listAudit())[0]).toMatchObject({ who: 'Hélène Marchetti', change: 'budget rate: USD · 1 USD = 0.92 € → USD · 1 USD = 0.95 €' });
  }, 60_000);
});
