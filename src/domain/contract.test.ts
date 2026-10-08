// Golden values of the Contract / Billing logic, computed by the prototype itself: scripts/proto-golden-contract.ts
// runs design lines 3096–5239 in node:vm and stores renderVals() of both screens (EN, FR) for the seed and for each
// mutation the screens offer (src/features/contract/contract.golden.json). Here the domain figures are rebuilt from
// CONTRACTS (3713) with the same mutations applied, and compared number by number; the rendered strings are
// compared by src/features/contract/model.test.ts.
import { describe, expect, it } from 'vitest';
import { G, SCENARIOS, addMs, invoice, ms, seedInput } from '@/features/contract/test-fixtures';
import { money } from '@/lib/format';
import {
  contractFigures, contractValueSub, decimalText, liquidatedDamagesKpi, nextInvoiceNo, outstandingSub, overdueSub, parseAmendmentForm, parseBondForm,
  parseDateInput, parseInvoiceForm, parseMilestoneForm, parseNumber, parseSheetField, pendingSub, progressCss, progressText, shareTotalText,
} from './contract';

const en = (k: number) => money(k, 'en');

describe('contract figures vs the prototype (CONTRACTS HLT-026 + the screens’ mutations)', () => {
  for (const [name, mutate] of Object.entries(SCENARIOS)) {
    it(name, () => {
      const fig = contractFigures(mutate(seedInput()));
      const c = G.scenarios[`${name}|contract|en`];
      const b = G.scenarios[`${name}|billing|en`];
      // Contract: value, amendments, guarantees, LD, schedule.
      expect([en(fig.valueKeur), String(fig.pending.count), `${fig.bonds.live} / ${fig.bonds.total}`]).toEqual([c.kpis[0].value, c.kpis[1].value, c.kpis[2].value]);
      expect(fig.milestones.map((m) => [m.number, en(m.amountKeur), m.late])).toEqual(c.milestones.map((m: { id: string; amtText: string; late: boolean }) => [m.id, m.amtText, m.late]));
      expect([shareTotalText(fig.sharePct, 'en'), en(fig.scheduleAmountKeur), fig.shareOk]).toEqual([c.schedTotal.pct, c.schedTotal.amt, c.schedTotal.hint === '']);
      // Billing: receivables, retention, progress, invoices (calendar-day due dates), next / late.
      expect([en(fig.invoicedKeur), en(fig.paidKeur), en(fig.outstandingKeur), en(fig.overdueKeur)]).toEqual(b.kpis.slice(0, 4).map((k: { value: string }) => k.value));
      expect(fig.next?.number ?? '—').toBe(b.kpis[4].value);
      expect([en(fig.retentionKeur), progressCss(fig.paidKeur, fig.valueKeur), progressCss(fig.outstandingKeur, fig.valueKeur)]).toEqual([b.bill.retention, b.bill.paidW, b.bill.invW]);
      expect(fig.invoices.map((i) => [i.number, i.milestone, en(i.amountKeur), i.status, i.overdue, i.canPay])).toEqual(
        b.invoices.map((i: { no: string; msId: string; amtText: string; status: string; overdue: boolean; canPay: boolean }) => [
          i.no, i.msId, i.amtText, i.status.toLowerCase().replace(' ', '_'), i.overdue, i.canPay,
        ]),
      );
      expect(fig.toInvoice.map((m) => [m.number, m.late])).toEqual(b.toInvoice.map((m: { id: string; late: boolean }) => [m.id, m.late]));
      expect(String(fig.lateCount || '')).toBe(b.badge);
    });
  }

  it('invoice due dates: issued + terms in calendar days (the prototype’s ms arithmetic shows 9 Nov in Paris, 04 Q12)', () => {
    const fig = contractFigures(seedInput());
    expect(fig.invoices.map((i) => [i.issuedOn, i.dueOn])).toEqual([['2026-03-12', '2026-04-26'], ['2026-07-15', '2026-08-29'], ['2026-09-26', '2026-11-10']]);
    // Across the end of DST (25 Oct 2026) and the year end.
    const all = contractFigures(SCENARIOS['issue-all'](seedInput()));
    expect(all.invoices.slice(3).map((i) => i.dueOn)).toEqual(['2026-11-14', '2027-02-28']);
    expect(contractFigures(SCENARIOS['sheet-terms60'](seedInput())).invoices.map((i) => i.dueOn)).toEqual(['2026-05-11', '2026-09-13', '2026-11-25']);
    expect(G.dst).toEqual({ tz: 'UTC', m3Due: '10 Nov' });
  });

  it('late flag = planned and contractual date before PG_NOW (30 Sep is already late, 1 Oct is not); overdue = due before 30 Sep', () => {
    const late = (due: string) => contractFigures(addMs(seedInput(), { number: 'M6', label: 'x', sharePct: 1, contractualDue: due, condition: null })).milestones[5].late;
    expect([late('2026-09-29'), late('2026-09-30'), late('2026-10-01')]).toEqual([true, true, false]);
    const over = (issued: string) => contractFigures(ms(seedInput(), 'M4', { status: 'invoiced', invoice: invoice('INV-2026-004', issued) })).invoices[3].overdue;
    expect([over('2026-08-15'), over('2026-08-16'), over('2026-08-17')]).toEqual([true, false, false]); // due 29 Sep · 30 Sep · 1 Oct
  });
});

describe('contract texts', () => {
  it('KPI sub-lines with the prototype’s FR branches', () => {
    expect([contractValueSub('€5.40M', 1, 'en'), contractValueSub('5,40 M€', 2, 'fr')]).toEqual(['€5.40M base · 1 signed amendment', '5,40 M€ de base · 2 avenants signés']);
    // Deliberate: the prototype writes "0 signed amendment"; French keeps the singular for 0.
    expect([contractValueSub('€5.40M', 0, 'en'), contractValueSub('5,40 M€', 0, 'fr')]).toEqual(['€5.40M base · 0 signed amendments', '5,40 M€ de base · 0 avenant signé']);
    expect([pendingSub(1, '€260k', 'en'), pendingSub(0, '', 'fr')]).toEqual(['€260k awaiting signature', 'tous les avenants sont signés']);
    expect(liquidatedDamagesKpi('0.5 % per week · cap 10 %', '24 months from SAT')).toEqual({ value: '0.5 % per week', sub: 'cap 10 % · 24 months from SAT' });
    expect([outstandingSub(1, 'Net 45 days', 'en'), outstandingSub(2, 'Net 45 days', 'fr'), outstandingSub(0, 'Net 45 days', 'fr')]).toEqual([
      '1 invoice awaiting payment · Net 45 days', '2 factures en attente · Net 45 days', '0 facture en attente · Net 45 days',
    ]);
    // Deliberate: the prototype writes "0 invoice awaiting payment".
    expect(outstandingSub(0, 'Net 45 days', 'en')).toBe('0 invoices awaiting payment · Net 45 days');
    expect([overdueSub(1, 'en'), overdueSub(0, 'fr')]).toEqual(['1 invoice(s) past due date', 'aucun retard de paiement']);
    expect([progressText(1656, 5520, 'en'), progressText(1656, 5520, 'fr'), progressText(0, 0, 'en'), progressCss(9000, 5520)]).toEqual(['30.0 %', '30,0 %', '0 %', '100.0%']);
    expect([shareTotalText(102.5, 'en'), shareTotalText(102.5, 'fr'), decimalText(2.5, 'fr')]).toEqual(['102.5 %', '102,5 %', '2,5']);
    expect([nextInvoiceNo(3), nextInvoiceNo(11)]).toEqual(['INV-2026-004', 'INV-2026-012']);
  });
});

describe('form parsing', () => {
  it('dates typed in EN, FR or ISO; year 2026 by default; impossible dates refused', () => {
    expect(['14 Dec 2026', '14 déc. 2026', '14 décembre 2026', '14 dec', '1er oct. 2026', '30 sept. 2026', '14 Jan ’27', '14/12/2026', '2026-12-14', '3 août 2026', '3 aout'].map((s) => parseDateInput(s))).toEqual([
      '2026-12-14', '2026-12-14', '2026-12-14', '2026-12-14', '2026-10-01', '2026-09-30', '2027-01-14', '2026-12-14', '2026-12-14', '2026-08-03', '2026-08-03',
    ]);
    expect(['', '31 Feb 2026', 'soon', '2026-13-01', '14 Foo 2026', '0 Jan 2026'].map((s) => parseDateInput(s))).toEqual([null, null, null, null, null, null]);
  });

  it('numbers with a French comma; anything else is NaN', () => {
    expect(['12', '12.5', '12,5', ' 7 ', '-80', '1 200'].map(parseNumber)).toEqual([12, 12.5, 12.5, 7, -80, 1200]);
    expect(['', 'abc', '1e3', '12.'].map(parseNumber).every(Number.isNaN)).toBe(true);
  });

  it('AF.amendment', () => {
    expect(parseAmendmentForm({ label: ' Amendment 3 — extra lighting ', cr: 'CR-007', amt: '80', status: 'signed', date: '30 sept. 2026', doc: 'CTR-HLT-003' })).toEqual({
      ok: true, value: { subject: 'Amendment 3 — extra lighting', changeRequestRef: 'CR-007', amountKeur: 80, status: 'signed', signedOn: '2026-09-30', documentRef: 'CTR-HLT-003' },
    });
    expect(parseAmendmentForm({ label: 'x', amt: '0' })).toMatchObject({ ok: true, value: { status: 'draft', signedOn: null, changeRequestRef: null, documentRef: null } });
    expect(parseAmendmentForm({ label: ' ', amt: '1' })).toEqual({ ok: false, error: 'Subject is required' });
    expect(parseAmendmentForm({ label: 'x', amt: 'a' })).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseAmendmentForm({ label: 'x', amt: '1', status: 'Signed' })).toEqual({ ok: false, error: 'Unknown status' });
    expect(parseAmendmentForm({ label: 'x', amt: '1', date: 'tomorrow' })).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
  });

  it('AF.bond', () => {
    expect(parseBondForm({ label: 'warranty', amt: '280', issuer: 'BNP Paribas', valid: '14 Jan 2029' })).toEqual({
      ok: true, value: { type: 'warranty', amountKeur: 280, issuer: 'BNP Paribas', validUntil: '2029-01-14' },
    });
    expect(parseBondForm({ amt: '0', issuer: 'x', valid: '1 Jan 2027' })).toMatchObject({ ok: true, value: { type: 'performance' } });
    expect(parseBondForm({ label: 'surety', amt: '1', issuer: 'x', valid: '1 Jan 2027' })).toEqual({ ok: false, error: 'Unknown guarantee type' });
    expect(parseBondForm({ amt: '-1', issuer: 'x', valid: '1 Jan 2027' })).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseBondForm({ amt: '1', issuer: '', valid: '1 Jan 2027' })).toEqual({ ok: false, error: 'Issuer is required' });
    expect(parseBondForm({ amt: '1', issuer: 'x', valid: '' })).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
  });

  it('AF.milestone', () => {
    expect(parseMilestoneForm({ label: 'Final acceptance', pct: '2,5', due: '14 janv. 2028', cond: '' })).toEqual({
      ok: true, value: { label: 'Final acceptance', sharePct: 2.5, contractualDue: '2028-01-14', condition: null },
    });
    expect(parseMilestoneForm({ label: '', pct: '10', due: '1 Jan 2027' })).toEqual({ ok: false, error: 'Milestone is required' });
    expect(['0', '101', 'x'].map((pct) => parseMilestoneForm({ label: 'x', pct, due: '1 Jan 2027' }))).toEqual(
      Array(3).fill({ ok: false, error: 'Enter a share between 0 and 100 %' }),
    );
  });

  it('AF.billing: a planned milestone (first by default), a number, a date', () => {
    const planned = ['M4', 'M5'];
    expect(parseInvoiceForm({ ms: 'M5', no: ' INV-2026-004 ', date: '30 Sep 2026', note: 'x' }, planned)).toEqual({
      ok: true, value: { milestone: 'M5', invoiceNumber: 'INV-2026-004', issuedOn: '2026-09-30', note: 'x' },
    });
    expect(parseInvoiceForm({ ms: 'M4 · Cranes operational', no: 'A', date: '30 Sep 2026' }, planned)).toMatchObject({ ok: true, value: { milestone: 'M4' } });
    expect(parseInvoiceForm({ no: 'A', date: '30 Sep 2026' }, planned)).toMatchObject({ ok: true, value: { milestone: 'M4', note: null } });
    expect(parseInvoiceForm({ ms: 'M3', no: 'A', date: '30 Sep 2026' }, planned)).toEqual({ ok: false, error: 'Choose a milestone still to invoice' });
    expect(parseInvoiceForm({ ms: 'M4', no: ' ', date: '30 Sep 2026' }, planned)).toEqual({ ok: false, error: 'Invoice number is required' });
    expect(parseInvoiceForm({ ms: 'M4', no: 'A', date: '' }, planned)).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
    expect(parseInvoiceForm({ no: 'A', date: '30 Sep 2026' }, [])).toEqual({ ok: false, error: 'Choose a milestone still to invoice' });
  });

  it('contract-sheet fields', () => {
    expect(parseSheetField('amount', '6000')).toEqual({ ok: true, value: { baseAmountKeur: 6000 } });
    expect(parseSheetField('retention', '2,5')).toEqual({ ok: true, value: { retentionPct: 2.5 } });
    expect(parseSheetField('retention', '120')).toEqual({ ok: false, error: 'Enter a percentage between 0 and 100' });
    expect(parseSheetField('amount', '-1')).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseSheetField('type', 'cost_plus')).toEqual({ ok: true, value: { type: 'cost_plus' } });
    expect(parseSheetField('type', 'Cost plus')).toEqual({ ok: false, error: 'Unknown contract type' });
    expect(parseSheetField('signed', '14 janv. 2026')).toEqual({ ok: true, value: { signedOn: '2026-01-14' } });
    expect(parseSheetField('signed', '')).toEqual({ ok: true, value: { signedOn: null } });
    expect(parseSheetField('signed', 'x')).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
    expect(parseSheetField('ref', ' ')).toEqual({ ok: false, error: 'Reference is required' });
    expect(parseSheetField('terms', ' Net 60 jours ')).toEqual({ ok: true, value: { paymentTerms: 'Net 60 jours' } });
    expect(parseSheetField('scope', 'x'.repeat(2001))).toEqual({ ok: false, error: 'Text is too long' });
    expect([parseSheetField('owner', 'x'), parseSheetField('terms', 5)]).toEqual([{ ok: false, error: 'Invalid request' }, { ok: false, error: 'Invalid request' }]);
  });
});
