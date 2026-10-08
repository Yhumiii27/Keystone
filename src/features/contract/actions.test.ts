// Contract & Billing Server Functions against in-memory seeded databases: permission gate (read-only, outside,
// no contract), validation of the forms and sheet fields, and — for each mutation the screens offer — the screens
// rebuilt from the database after the write compared with the prototype's own render of the same state
// (contract.golden.json, EN and FR). Session and project context are mocked; the viewer is the actor.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Romain Aubert', lang: 'en' as 'en' | 'fr', edit: { contract: true, billing: true } as Record<string, boolean> };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (_code: string, screen: string) => ({ viewer: { name: viewer.name }, canEdit: (s: string = screen) => !!viewer.edit[s] }),
}));

import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getBudgetContract } from '@/server/dal/budget';
import { getContract, lateBillingMilestonesByProject } from '@/server/dal/contract';
import { listAudit } from '@/server/dal/notifications';
import {
  addAmendmentAction, addBondAction, addPaymentMilestoneAction, issueInvoiceAction, markInvoicePaidAction, updateContractFieldAction,
} from './actions';
import { billingView, contractView } from './model';
import { G } from './test-fixtures';

const fresh = async () => setDb(await openDatabase());
const hlt = async () => (await getContract('HLT-026'))!;
const deviate = (s: string, lang: Lang) =>
  lang === 'fr' ? s.replace(/^(\d+)\.(\d+) %$/, '$1,$2 %') : s.replace(/^0 invoice awaiting payment/, '0 invoices awaiting payment');

/** The Contract screen rebuilt from the database = the prototype render of `scenario`. */
async function expectContract(scenario: string, lang: Lang, parts: ('kpis' | 'amendments' | 'bonds' | 'milestones' | 'fields')[] = ['kpis', 'amendments', 'bonds', 'milestones', 'fields']) {
  const g = G.scenarios[`${scenario}|contract|${lang}`];
  const v = contractView(await hlt(), makeT(lang), lang);
  if (parts.includes('kpis')) expect(v.kpis).toEqual(g.kpis);
  if (parts.includes('fields'))
    expect(v.fields.map((f) => [f.key, f.type === 'select' ? f.options!.find((o) => o.value === f.value)!.label : f.value])).toEqual(g.fields.map(([k, x]: string[]) => [k, x]));
  if (parts.includes('amendments'))
    expect(v.amendments.map((a) => [a.label, a.amount, a.status, a.date, a.doc ?? '', a.tagClass])).toEqual(
      g.amendments.map((a: Record<string, string>) => [a.label, a.amtText, a.status, a.date, a.doc, a.stClass]),
    );
  if (parts.includes('bonds')) expect(v.bonds.map((b) => [b.label, b.amount, b.state, b.released])).toEqual(g.bonds.map((b: Record<string, string>) => [b.label, b.amtText, b.state, b.released]));
  if (parts.includes('milestones')) {
    expect(v.milestones.map((m) => [m.id, m.label, m.share, m.amount, m.due, m.condition])).toEqual(
      g.milestones.map((m: Record<string, string>) => [m.id, m.label, deviate(m.pctText, lang), m.amtText, m.due, m.condText]),
    );
    expect([v.total.share, v.total.amount, v.total.hint]).toEqual([deviate(g.schedTotal.pct, lang), g.schedTotal.amt, g.schedTotal.hint]);
  }
}

/** The Billing screen rebuilt from the database = the prototype render of `scenario`. */
async function expectBilling(scenario: string, lang: Lang) {
  const g = G.scenarios[`${scenario}|billing|${lang}`];
  const v = billingView(await hlt(), makeT(lang), lang);
  expect(v.kpis).toEqual(g.kpis.map((k: Record<string, string>) => ({ ...k, sub: deviate(k.sub, lang) })));
  expect([v.progress.paidW, v.progress.invW, v.progress.retention, v.progress.retentionNote, v.progress.total]).toEqual([g.bill.paidW, g.bill.invW, g.bill.retention, g.bill.retNote, g.bill.total]);
  expect(v.toInvoice.map((m) => [m.id, m.label, m.amount, m.late])).toEqual(g.toInvoice.map((m: Record<string, string>) => [m.id, m.label, m.amtText, m.late]));
  expect(v.invoices.map((i) => [i.number, i.milestone, i.label, i.issued, i.amount, i.due, i.overdue, i.paid, i.status, i.tagClass, i.canPay, i.note ?? ''])).toEqual(
    g.invoices.map((i: Record<string, string>) => [i.no, i.msId, i.label, i.issued, i.amtText, i.due, i.overdue, i.paid, i.status, i.stClass, i.canPay, i.note]),
  );
}

beforeEach(() => {
  viewer.name = 'Romain Aubert';
  viewer.lang = 'en';
  viewer.edit = { contract: true, billing: true };
});

describe('permission gate and validation', () => {
  beforeAll(fresh, 60_000);

  it('refuses viewers who may not edit, unknown projects, projects without a contract, forged payloads', async () => {
    viewer.edit = { contract: false, billing: false };
    expect(await updateContractFieldAction('HLT-026', 'amount', '1')).toEqual({ error: 'This contract is read-only for you' });
    expect(await addAmendmentAction('HLT-026', { label: 'x', amt: '1' })).toEqual({ error: 'This contract is read-only for you' });
    expect(await addBondAction('HLT-026', { amt: '1', issuer: 'x', valid: '1 Jan 2027' })).toEqual({ error: 'This contract is read-only for you' });
    expect(await addPaymentMilestoneAction('HLT-026', { label: 'x', pct: '1', due: '1 Jan 2027' })).toEqual({ error: 'This contract is read-only for you' });
    expect(await issueInvoiceAction('HLT-026', { ms: 'M4', no: 'X', date: '30 Sep 2026' })).toEqual({ error: 'Billing is read-only for you' });
    expect(await markInvoicePaidAction('HLT-026', 'M3')).toEqual({ error: 'Billing is read-only for you' });
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
    expect(await addAmendmentAction('HLT-026', { label: 42, amt: ['1'] } as never)).toEqual({ error: 'Subject is required' });
    expect(await updateContractFieldAction('HLT-026', 'owner', 'x')).toEqual({ error: 'Invalid request' });
    expect(await updateContractFieldAction('HLT-026', 'amount', 5 as never)).toEqual({ error: 'Invalid request' });
    // Nothing was written.
    const c = await hlt();
    expect([c.amendments.length, c.bonds.length, c.milestones.length, c.invoices.length, c.sheet.baseAmountKeur]).toEqual([2, 2, 5, 3, 5400]);
  });

  it('form validation messages (EN and FR)', async () => {
    expect(await addBondAction('HLT-026', { label: 'warranty', amt: '10', issuer: 'BNP', valid: 'next year' })).toEqual({ error: 'Enter a date such as 14 Dec 2026' });
    viewer.lang = 'fr';
    expect(await addBondAction('HLT-026', { label: 'warranty', amt: '10', issuer: 'BNP', valid: 'l’an prochain' })).toEqual({ error: 'Saisissez une date comme 14 déc. 2026' });
    expect(await addPaymentMilestoneAction('HLT-026', { label: 'x', pct: '120', due: '1 janv. 2027' })).toEqual({ error: 'Saisissez une part entre 0 et 100 %' });
    expect(await issueInvoiceAction('HLT-026', { ms: 'M3', no: 'X', date: '30 sept. 2026' })).toEqual({ error: 'Choisissez un jalon restant à facturer' });
    expect(await updateContractFieldAction('HLT-026', 'retention', '120')).toEqual({ error: 'Saisissez un pourcentage entre 0 et 100' });
    expect(await markInvoicePaidAction('HLT-026', 'M4')).toEqual({ error: 'Cette facture n’est pas en attente de paiement' });
    expect(await markInvoicePaidAction('HLT-026', 'M2')).toEqual({ error: 'Cette facture n’est pas en attente de paiement' });
  });
});

describe('Issue invoice (AF.billing)', () => {
  beforeAll(fresh, 60_000);

  it('issues M4 (FR date typed), toast, screens = prototype "issue-m4", audit and activity by the viewer', async () => {
    viewer.lang = 'fr';
    expect(await issueInvoiceAction('HLT-026', { ms: 'M4', no: 'INV-2026-004', date: '30 sept. 2026', note: 'Cranes 1–2 accepted' })).toEqual({
      toast: G.toasts['issue-m4|fr'],
    });
    for (const lang of ['en', 'fr'] as const) {
      await expectBilling('issue-m4', lang);
      await expectContract('issue-m4', lang);
    }
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

  it('M4 issued then M3 and M4 paid on 30 Sep = prototype "pay-all"; a planned or paid milestone is refused', async () => {
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

  it('a signed amendment re-prices every milestone = prototype "amend-signed"; a guarantee = prototype "bond"', async () => {
    expect(
      await addAmendmentAction('HLT-026', { label: 'Amendment 3 — extra lighting', cr: 'CR-007', amt: '80', status: 'signed', date: '30 Sep 2026', doc: 'CTR-HLT-003' }),
    ).toEqual({ toast: G.toasts['amend-signed|en'] });
    for (const lang of ['en', 'fr'] as const) {
      await expectContract('amend-signed', lang);
      await expectBilling('amend-signed', lang);
    }
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

  it('M6 due 15 Sep is late = prototype "milestone-late" (share total 102,5 %, Billing badge 1)', async () => {
    viewer.lang = 'fr';
    expect(await addPaymentMilestoneAction('HLT-026', { label: 'Design review', pct: '2,5', due: '15 sept. 2026', cond: '' })).toEqual({ toast: G.toasts['milestone|fr'] });
    for (const lang of ['en', 'fr'] as const) {
      await expectContract('milestone-late', lang);
      await expectBilling('milestone-late', lang);
    }
    expect((await lateBillingMilestonesByProject())['HLT-026']).toBe(1);
  });
});

describe('Contract sheet edits', () => {
  beforeAll(fresh, 60_000);

  it('per-field saves = prototype "sheet"; Budget › Cash & recovery reads the new terms and amount', async () => {
    for (const [k, v] of [['ref', 'CTR-HLT-001-A'], ['amount', '6000'], ['terms', 'Net 30 days'], ['retention', '10'], ['ld', '1 % per week · cap 5 %'], ['warranty', '36 months from SAT']])
      expect(await updateContractFieldAction('HLT-026', k, v)).toEqual({ ok: true });
    for (const lang of ['en', 'fr'] as const) {
      await expectContract('sheet', lang);
      await expectBilling('sheet', lang);
    }
    expect(await getBudgetContract('HLT-026')).toMatchObject({ ref: 'CTR-HLT-001-A', amount: 6000, terms: 'Net 30 days' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'CTR-HLT-001-A', change: 'warranty: 24 months from SAT → 36 months from SAT' });
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
