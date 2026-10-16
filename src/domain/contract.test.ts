// Golden values of the Contract / Billing logic, computed by the prototype itself: scripts/proto-golden-contract.ts
// runs design lines 3096–5239 in node:vm and stores renderVals() of both screens (EN, FR) for the seed and for each
// mutation the screens offer (src/features/contract/contract.golden.json). Here the domain figures are rebuilt from
// CONTRACTS (3713) with the same mutations applied, and compared number by number; the rendered strings are
// compared by src/features/contract/model.test.ts.
//
// Delivery 7 deviations, each from an owner decision:
// - NEW-D3-3 (R-079): an amendment has its own milestones and never re-prices the existing ones. The base contract's
//   milestones are priced on the base amount (the prototype used base + signed amendments: M1 €552k → €540k), an invoiced
//   milestone keeps its invoice's amount, and the seed's Amendment 1 carries milestone M6 (€120k). The amounts below come from
//   `expectedFigures` (the rule restated); everything else — ids, statuses, late flags, invoices, counts — is the prototype's.
// - C-6 (R-076): due dates follow the contract's payment rule (the seed's "Net 45 days" = net 45: unchanged dates).
import { describe, expect, it } from 'vitest';
import { G, M6, SCENARIOS, addMs, expectedFigures, invoiceOf, ms, seedInput } from '@/features/contract/test-fixtures';
import { money } from '@/lib/format';
import {
  canSendAmendment, canSignAmendment, contractFigures as contractFiguresAt, contractValueSub, decimalText, liquidatedDamagesKpi, nextInvoiceNo, outstandingSub, overdueSub,
  parseAmendmentForm, parseBondForm, parseDateInput, parseInvoiceForm, parseMilestoneForm, parseNumber, parseReleaseBondForm, parseSheetField,
  parseSignAmendmentForm, pendingSub, plannedMilestoneAmount, progressCss, progressText, shareTotalText,
} from './contract';

const en = (k: number) => money(k, 'en');
/** R-013: the golden comparison keeps the prototype's "now" (PG_NOW / NOWD = 30 Sep 2026), passed explicitly. */
const PROTO_NOW = '2026-09-30';
const contractFigures = (c: Parameters<typeof contractFiguresAt>[0]) => contractFiguresAt(c, PROTO_NOW);
/** The base contract's milestones (the prototype's list); the golden's "M6" of the add-milestone scenarios is M7 here (M6 = Amendment 1's). */
const base = <T extends { amendment?: number | null }>(xs: readonly T[]) => xs.filter((m) => m.amendment == null);
const gid = (name: string, id: string) => (name.startsWith('milestone') && id === 'M6' ? 'M7' : id);

describe('contract figures vs the prototype (CONTRACTS HLT-026 + the screens’ mutations)', () => {
  for (const [name, mutate] of Object.entries(SCENARIOS)) {
    it(name, () => {
      const input = mutate(seedInput());
      const fig = contractFigures(input);
      const x = expectedFigures(input);
      const c = G.scenarios[`${name}|contract|en`];
      const b = G.scenarios[`${name}|billing|en`];
      // Contract: value, amendments, guarantees (the prototype's: base + signed amendments).
      expect([en(fig.valueKeur), String(fig.pending.count), `${fig.bonds.live} / ${fig.bonds.total}`]).toEqual([c.kpis[0].value, c.kpis[1].value, c.kpis[2].value]);
      expect(fig.valueKeur).toBe(x.value);
      // Schedule: the prototype's base milestones, ids and late flags; amounts by NEW-D3-3.
      expect(base(fig.milestones).map((m) => [m.number, m.late])).toEqual(c.milestones.map((m: { id: string; late: boolean }) => [gid(name, m.id), m.late]));
      expect(fig.milestones.map((m) => m.amountKeur)).toEqual(input.milestones.map(x.amount));
      expect([shareTotalText(fig.sharePct, 'en'), fig.groups[0].shareOk]).toEqual([c.schedTotal.pct, c.schedTotal.hint === '']);
      expect(fig.scheduleAmountKeur).toBe(x.schedule);
      // Billing: receivables, retention, progress, invoices (due dates by the rule), next / late.
      expect([fig.invoicedKeur, fig.paidKeur, fig.outstandingKeur]).toEqual([x.invoiced, x.paid, x.invoiced - x.paid]);
      expect(fig.overdueKeur).toBe(fig.invoices.filter((i) => i.overdue).reduce((s, i) => s + i.amountKeur, 0));
      expect(fig.overdueCount).toBe(b.invoices.filter((i: { overdue: boolean }) => i.overdue).length);
      // Next to invoice: the prototype's among the base milestones (M6, Amendment 1's, comes after them — NEW-D3-3).
      expect(base(fig.toInvoice)[0]?.number ?? '—').toBe(gid(name, b.kpis[4].value));
      expect(fig.next?.number ?? null).toBe(x.next?.number ?? null);
      expect([en(fig.retentionKeur), progressCss(fig.paidKeur, fig.valueKeur)]).toEqual([en(Math.round((x.paid * input.sheet.retentionPct) / 100)), progressCss(x.paid, x.value)]);
      expect(fig.invoices.map((i) => [i.number, i.milestone, i.status, i.overdue, i.canPay])).toEqual(
        b.invoices.map((i: { no: string; msId: string; status: string; overdue: boolean; canPay: boolean }) => [i.no, i.msId, i.status.toLowerCase().replace(' ', '_'), i.overdue, i.canPay]),
      );
      expect(base(fig.toInvoice).map((m) => [m.number, m.late])).toEqual(b.toInvoice.map((m: { id: string; late: boolean }) => [gid(name, m.id), m.late]));
      expect(String(fig.lateCount || '')).toBe(b.badge);
    });
  }

  it('NEW-D3-3 on the seed: base milestones on the base amount, Amendment 1’s own M6, invoiced amounts frozen', () => {
    const fig = contractFigures(seedInput());
    // Prototype: M1–M5 = 552 / 1 104 / 1 380 / 1 104 / 1 380 (value × share, Amendment 1 spread over every milestone).
    expect(fig.milestones.map((m) => [m.number, m.amountKeur, m.billable])).toEqual([
      ['M1', 540, true], ['M2', 1080, true], ['M3', 1350, true], ['M4', 1080, true], ['M5', 1350, true], ['M6', 120, true],
    ]);
    expect([fig.valueKeur, fig.scheduleAmountKeur, fig.invoicedKeur, fig.paidKeur, fig.outstandingKeur]).toEqual([5520, 5520, 2970, 1620, 1350]);
    expect(fig.groups.map((g) => [g.amendment, g.amountKeur, g.sharePct, g.shareOk, g.billable])).toEqual([[null, 5400, 100, true, true], [0, 120, 100, true, true]]);
    expect(fig.toInvoice.map((m) => m.number)).toEqual(['M4', 'M5', 'M6']);
    // Raising the base amount re-prices only the planned base milestones; invoices keep their amounts.
    const raised = contractFigures({ ...seedInput(), sheet: { ...seedInput().sheet, baseAmountKeur: 6000 } });
    expect(raised.milestones.map((m) => m.amountKeur)).toEqual([540, 1080, 1350, 1200, 1500, 120]);
    // An amendment awaiting signature: its milestones are listed but not billable (no value, not in "To invoice").
    const pending = contractFigures({ ...seedInput(), milestones: [...seedInput().milestones, { ...M6, number: 'M7', sharePct: 50, amendment: 1 }] });
    expect(pending.milestones.at(-1)).toMatchObject({ number: 'M7', amountKeur: 130, billable: false, late: false });
    expect([pending.scheduleAmountKeur, pending.toInvoice.map((m) => m.number)]).toEqual([5520, ['M4', 'M5', 'M6']]);
    expect(pending.groups.map((g) => [g.amendment, g.billable, g.shareOk])).toEqual([[null, true, true], [0, true, true], [1, false, false]]);
    // A signed amendment without milestones leaves its amount unscheduled (hint).
    const unscheduled = contractFigures({ ...seedInput(), milestones: base(seedInput().milestones) });
    expect([unscheduled.scheduleAmountKeur, unscheduled.shareOk, unscheduled.groups[1]]).toMatchObject([5400, false, { amendment: 0, shareOk: false, milestones: [] }]);
    expect(plannedMilestoneAmount(260, 50)).toBe(130);
  });

  it('invoice due dates by the payment rule (C-6): net, N days end of month, end of month + N', () => {
    const fig = contractFigures(seedInput());
    expect(fig.invoices.map((i) => [i.issuedOn, i.dueOn])).toEqual([['2026-03-12', '2026-04-26'], ['2026-07-15', '2026-08-29'], ['2026-09-26', '2026-11-10']]);
    // Across the end of DST (25 Oct 2026) and the year end.
    const all = contractFigures(SCENARIOS['issue-all'](seedInput()));
    expect(all.invoices.slice(3).map((i) => i.dueOn)).toEqual(['2026-11-14', '2027-02-28']);
    expect(contractFigures(SCENARIOS['sheet-terms60'](seedInput())).invoices.map((i) => i.dueOn)).toEqual(['2026-05-11', '2026-09-13', '2026-11-25']);
    const eom = contractFigures({ ...seedInput(), sheet: { ...seedInput().sheet, paymentRule: 'days_eom', paymentDays: 45 } });
    expect(eom.invoices.map((i) => i.dueOn)).toEqual(['2026-04-30', '2026-08-31', '2026-11-30']);
    const eomPlus = contractFigures({ ...seedInput(), sheet: { ...seedInput().sheet, paymentRule: 'eom_days', paymentDays: 30 } });
    expect(eomPlus.invoices.map((i) => i.dueOn)).toEqual(['2026-04-30', '2026-08-30', '2026-10-30']);
    expect(G.dst).toEqual({ tz: 'UTC', m3Due: '10 Nov' });
  });

  it('late flag = planned and contractual date before the business date (29 Sep is late on 30 Sep, 30 Sep is not); overdue = due before 30 Sep', () => {
    const late = (due: string) => contractFigures(addMs(seedInput(), { number: 'M7', label: 'x', sharePct: 1, contractualDue: due, condition: null })).milestones.find((m) => m.number === 'M7')!.late;
    // R-013: the prototype's PG_NOW (8.97) lay just after 30 Sep, so "30 Sep" was already late; the business date's own day is not.
    expect([late('2026-09-29'), late('2026-09-30'), late('2026-10-01')]).toEqual([true, false, false]);
    const over = (issued: string) => {
      const c = seedInput();
      return contractFigures(ms(c, 'M4', { status: 'invoiced', invoice: invoiceOf(c, 'M4', 'INV-2026-004', issued) })).invoices[3].overdue;
    };
    expect([over('2026-08-15'), over('2026-08-16'), over('2026-08-17')]).toEqual([true, false, false]); // due 29 Sep · 30 Sep · 1 Oct
  });

  it('signature cycle (R-079): draft → sent for signature → signed', () => {
    expect(['draft', 'sent_for_signature', 'awaiting_signature', 'signed'].map((s) => [canSendAmendment(s as never), canSignAmendment(s as never)])).toEqual([
      [true, false], [false, true], [false, true], [false, false],
    ]);
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
  it('dates typed in EN, FR or ISO; the business year by default; impossible dates refused', () => {
    expect(['14 Dec 2026', '14 déc. 2026', '14 décembre 2026', '14 dec', '1er oct. 2026', '30 sept. 2026', '14 Jan ’27', '14/12/2026', '2026-12-14', '3 août 2026', '3 aout'].map((s) => parseDateInput(s, 2026))).toEqual([
      '2026-12-14', '2026-12-14', '2026-12-14', '2026-12-14', '2026-10-01', '2026-09-30', '2027-01-14', '2026-12-14', '2026-12-14', '2026-08-03', '2026-08-03',
    ]);
    expect(['', '31 Feb 2026', 'soon', '2026-13-01', '14 Foo 2026', '0 Jan 2026'].map((s) => parseDateInput(s, 2026))).toEqual([null, null, null, null, null, null]);
    // R-013: a year-less date is in the business date's year (14 Jan typed on 5 Jan 2027 → 2027); a stated year is kept.
    expect([parseDateInput('14 Jan', 2027), parseDateInput('14/01', 2027), parseDateInput('12 Mar 2026', 2027), parseDateInput('29 Feb', 2028), parseDateInput('29 Feb', 2027)])
      .toEqual(['2027-01-14', '2027-01-14', '2026-03-12', '2028-02-29', null]);
  });

  it('numbers with a French comma; anything else is NaN', () => {
    expect(['12', '12.5', '12,5', ' 7 ', '-80', '1 200'].map(parseNumber)).toEqual([12, 12.5, 12.5, 7, -80, 1200]);
    expect(['', 'abc', '1e3', '12.'].map(parseNumber).every(Number.isNaN)).toBe(true);
  });

  it('AF.amendment', () => {
    expect(parseAmendmentForm({ label: ' Amendment 3 — extra lighting ', cr: 'CR-007', amt: '80', status: 'signed', date: '30 sept. 2026', doc: 'CTR-HLT-003' }, 2026)).toEqual({
      ok: true, value: { subject: 'Amendment 3 — extra lighting', changeRequestRef: 'CR-007', amountKeur: 80, status: 'signed', signedOn: '2026-09-30', documentRef: 'CTR-HLT-003' },
    });
    expect(parseAmendmentForm({ label: 'x', amt: '0' }, 2026)).toMatchObject({ ok: true, value: { status: 'draft', signedOn: null, changeRequestRef: null, documentRef: null } });
    expect(parseAmendmentForm({ label: ' ', amt: '1' }, 2026)).toEqual({ ok: false, error: 'Subject is required' });
    expect(parseAmendmentForm({ label: 'x', amt: 'a' }, 2026)).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseAmendmentForm({ label: 'x', amt: '1', status: 'Signed' }, 2026)).toEqual({ ok: false, error: 'Unknown status' });
    expect(parseAmendmentForm({ label: 'x', amt: '1', date: 'tomorrow' }, 2026)).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
    // R-079: an amendment registered as signed carries its signature date.
    expect(parseAmendmentForm({ label: 'x', amt: '1', status: 'signed' }, 2026)).toEqual({ ok: false, error: 'Enter the signature date of a signed amendment' });
    expect(parseAmendmentForm({ label: 'x', amt: '1', status: 'sent_for_signature' }, 2026)).toMatchObject({ ok: true, value: { status: 'sent_for_signature', signedOn: null } });
  });

  it('Mark signed and Release (R-079)', () => {
    expect(parseSignAmendmentForm({ date: '30 Sep 2026', doc: ' CTR-HLT-004 ' }, 2026)).toEqual({ ok: true, value: { signedOn: '2026-09-30', documentRef: 'CTR-HLT-004' } });
    expect(parseSignAmendmentForm({ date: '1 oct.', doc: '' }, 2026)).toEqual({ ok: true, value: { signedOn: '2026-10-01', documentRef: null } });
    expect(parseSignAmendmentForm({ date: '' }, 2026)).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
    expect(parseSignAmendmentForm({ date: '1 Oct 2026', doc: 'x'.repeat(61) }, 2026)).toEqual({ ok: false, error: 'Reference is too long' });
    expect(parseReleaseBondForm({ date: '12 Sep 2026' }, 2026)).toEqual({ ok: true, value: { releasedOn: '2026-09-12' } });
    expect(parseReleaseBondForm({ date: 'soon' }, 2026)).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
  });

  it('AF.bond', () => {
    expect(parseBondForm({ label: 'warranty', amt: '280', issuer: 'BNP Paribas', valid: '14 Jan 2029' }, 2026)).toEqual({
      ok: true, value: { type: 'warranty', amountKeur: 280, issuer: 'BNP Paribas', validUntil: '2029-01-14' },
    });
    expect(parseBondForm({ amt: '0', issuer: 'x', valid: '1 Jan 2027' }, 2026)).toMatchObject({ ok: true, value: { type: 'performance' } });
    expect(parseBondForm({ label: 'surety', amt: '1', issuer: 'x', valid: '1 Jan 2027' }, 2026)).toEqual({ ok: false, error: 'Unknown guarantee type' });
    expect(parseBondForm({ amt: '-1', issuer: 'x', valid: '1 Jan 2027' }, 2026)).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseBondForm({ amt: '1', issuer: '', valid: '1 Jan 2027' }, 2026)).toEqual({ ok: false, error: 'Issuer is required' });
    expect(parseBondForm({ amt: '1', issuer: 'x', valid: '' }, 2026)).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
  });

  it('AF.milestone', () => {
    expect(parseMilestoneForm({ label: 'Final acceptance', pct: '2,5', due: '14 janv. 2028', cond: '' }, 2026)).toEqual({
      ok: true, value: { label: 'Final acceptance', sharePct: 2.5, contractualDue: '2028-01-14', condition: null, amendment: null },
    });
    // NEW-D3-3: "Applies to" the base contract or an amendment (its position).
    expect(parseMilestoneForm({ basis: '1', label: 'Crane upgrade delivered', pct: '100', due: '14 Dec 2026' }, 2026)).toMatchObject({ ok: true, value: { amendment: 1, sharePct: 100 } });
    expect(parseMilestoneForm({ basis: 'base', label: 'x', pct: '10', due: '14 Dec 2026' }, 2026)).toMatchObject({ ok: true, value: { amendment: null } });
    expect(parseMilestoneForm({ basis: 'Amendment 1', label: 'x', pct: '10', due: '14 Dec 2026' }, 2026)).toEqual({ ok: false, error: 'Choose the base contract or an amendment' });
    expect(parseMilestoneForm({ label: '', pct: '10', due: '1 Jan 2027' }, 2026)).toEqual({ ok: false, error: 'Milestone is required' });
    expect(['0', '101', 'x'].map((pct) => parseMilestoneForm({ label: 'x', pct, due: '1 Jan 2027' }, 2026))).toEqual(
      Array(3).fill({ ok: false, error: 'Enter a share between 0 and 100 %' }),
    );
  });

  it('AF.billing: a planned milestone (first by default), a number, a date', () => {
    const planned = ['M4', 'M5'];
    expect(parseInvoiceForm({ ms: 'M5', no: ' INV-2026-004 ', date: '30 Sep 2026', note: 'x' }, planned, 2026)).toEqual({
      ok: true, value: { milestone: 'M5', invoiceNumber: 'INV-2026-004', issuedOn: '2026-09-30', note: 'x' },
    });
    expect(parseInvoiceForm({ ms: 'M4 · Cranes operational', no: 'A', date: '30 Sep 2026' }, planned, 2026)).toMatchObject({ ok: true, value: { milestone: 'M4' } });
    expect(parseInvoiceForm({ no: 'A', date: '30 Sep 2026' }, planned, 2026)).toMatchObject({ ok: true, value: { milestone: 'M4', note: null } });
    expect(parseInvoiceForm({ ms: 'M3', no: 'A', date: '30 Sep 2026' }, planned, 2026)).toEqual({ ok: false, error: 'Choose a milestone still to invoice' });
    expect(parseInvoiceForm({ ms: 'M4', no: ' ', date: '30 Sep 2026' }, planned, 2026)).toEqual({ ok: false, error: 'Invoice number is required' });
    expect(parseInvoiceForm({ ms: 'M4', no: 'A', date: '' }, planned, 2026)).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
    expect(parseInvoiceForm({ no: 'A', date: '30 Sep 2026' }, [], 2026)).toEqual({ ok: false, error: 'Choose a milestone still to invoice' });
  });

  it('contract-sheet fields', () => {
    expect(parseSheetField('amount', '6000', 2026)).toEqual({ ok: true, value: { baseAmountKeur: 6000 } });
    expect(parseSheetField('retention', '2,5', 2026)).toEqual({ ok: true, value: { retentionPct: 2.5 } });
    expect(parseSheetField('retention', '120', 2026)).toEqual({ ok: false, error: 'Enter a percentage between 0 and 100' });
    expect(parseSheetField('amount', '-1', 2026)).toEqual({ ok: false, error: 'Enter an amount in k€' });
    expect(parseSheetField('type', 'cost_plus', 2026)).toEqual({ ok: true, value: { type: 'cost_plus' } });
    expect(parseSheetField('type', 'Cost plus', 2026)).toEqual({ ok: false, error: 'Unknown contract type' });
    expect(parseSheetField('signed', '14 janv. 2026', 2026)).toEqual({ ok: true, value: { signedOn: '2026-01-14' } });
    expect(parseSheetField('signed', '', 2026)).toEqual({ ok: true, value: { signedOn: null } });
    expect(parseSheetField('signed', 'x', 2026)).toEqual({ ok: false, error: 'Enter a date such as 14 Dec 2026' });
    expect(parseSheetField('ref', ' ', 2026)).toEqual({ ok: false, error: 'Reference is required' });
    // C-6 (R-076): the payment rule and its days replace the free "Payment terms" text.
    expect(parseSheetField('rule', 'days_eom', 2026)).toEqual({ ok: true, value: { paymentRule: 'days_eom' } });
    expect(parseSheetField('rule', '45 days end of month', 2026)).toEqual({ ok: false, error: 'Unknown payment rule' });
    expect(parseSheetField('days', ' 60 ', 2026)).toEqual({ ok: true, value: { paymentDays: 60 } });
    expect(['181', '-1', '4.5', 'x', ''].map((d) => parseSheetField('days', d, 2026))).toEqual(Array(5).fill({ ok: false, error: 'Enter a number of days between 0 and 180' }));
    // C-9 (R-075): a currency code (the DAL checks it against the project).
    expect(parseSheetField('currency', 'USD', 2026)).toEqual({ ok: true, value: { currency: 'USD' } });
    expect(parseSheetField('currency', 'usd', 2026)).toEqual({ ok: false, error: 'Unknown currency' });
    expect(parseSheetField('scope', 'x'.repeat(2001), 2026)).toEqual({ ok: false, error: 'Text is too long' });
    expect([parseSheetField('owner', 'x', 2026), parseSheetField('terms', 'Net 60 days', 2026), parseSheetField('rule', 5, 2026)]).toEqual([
      { ok: false, error: 'Invalid request' }, { ok: false, error: 'Invalid request' }, { ok: false, error: 'Invalid request' },
    ]);
  });
});
