// R-130 (NEW-D1-1 a): the portfolio alerts from the live data — a billing rule raised by a write (late milestone, then overdue
// invoice), worst first and capped at 8 (the seed has 8 alerts: the approval alert gives way). In-memory database.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addPaymentMilestone, getContract, issueInvoice, updatePaymentMilestone } from './contract';
import { getPortfolioAlerts } from './portfolio-alerts';
import { overloadJulienWagner } from '@/features/resources/overload.test-fixture';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

// The rules read the register's health, progress, actual cost and SPI, which R-073 (lot cost-control) computes from the activities:
// HLT-026 is the off-track project (SPI 0.82 · CPI 0.89; it was RCF-019 on the prototype's figures) and so carries no separate
// cost alert, RCF-019 (At risk, CPI 0.97) raises the cost overrun (it was HLT-026, CPI 0.91).
describe('portfolio alerts (R-130)', () => {
  it('seed: 7 alerts, the director’s approvals last', async () => {
    // R-084 (owner answers 17 Oct 2026, third round): the loads come from the schedules — nobody is above 110 % on the demo data
    // set, so no over-allocation alert ("3 people over 110%" on the seeded allocation rows).
    expect((await getPortfolioAlerts('en')).map((a) => a.key)).toEqual([
      'off-HLT-026', 'slip-RCF-019', 'slip-HLT-026', 'slip-MSR-012', 'slip-NDC-031', 'cost-RCF-019', 'approvals',
    ]);
  });

  it('a billable milestone past its date and not invoiced, then its invoice past due, raise the billing alert', async () => {
    const n = await addPaymentMilestone('HLT-026', { label: 'Early works', sharePct: 1, contractualDue: '2026-08-01' }, 'Romain Aubert');
    let alerts = await getPortfolioAlerts('en');
    expect(alerts.map((a) => a.key)).toEqual([
      'off-HLT-026', 'slip-RCF-019', 'slip-HLT-026', 'slip-MSR-012', 'slip-NDC-031', 'cost-RCF-019', 'bill-HLT-026', 'approvals',
    ]);
    expect(alerts[6]).toMatchObject({
      kind: 'billing_late', title: 'Harbor Line Terminal Expansion — billing late', detail: `${n} Early works · contractual date 1 Aug 2026, not invoiced.`,
      target: { screen: 'billing', code: 'HLT-026' },
    });
    // Delivery 8 (R-077, C-7): the extra 1 % takes the base schedule to 101 %, which blocks its invoicing — the schedule is
    // corrected first (C-7a: M5 25 % → 24 %, back to 100 %).
    const m5 = (await getContract('HLT-026'))!.milestones.find((m) => m.number === 'M5')!;
    await updatePaymentMilestone('HLT-026', 'M5', { label: m5.label, sharePct: 24, contractualDue: m5.contractualDue!, condition: m5.condition }, { name: 'Romain Aubert', role: 'pm' });
    // Invoiced on 1 Aug, net 45 → due 15 Sep: overdue at the data date.
    await issueInvoice('HLT-026', { milestone: n, issuedOn: '2026-08-01' }, 'Romain Aubert');
    alerts = await getPortfolioAlerts('fr');
    const bill = alerts.find((a) => a.key === 'bill-HLT-026')!;
    expect([bill.title, bill.detail]).toEqual([
      'Extension du terminal Harbor Line — facture en retard de paiement', 'INV-2026-004 · 54 k€ échue le 15 sept. 2026.',
    ]);
  });

  it('R-084: the over-allocation alert reads the schedules\' loads over the 8 weeks from the data date', async () => {
    // Julien Wagner on a second assignment (NDC-031, 1 × 4 h/d, 28 Sep – 16 Oct): 60 h / 40 h = 150 % in weeks 40–41.
    await overloadJulienWagner();
    const people = (await getPortfolioAlerts('en')).find((a) => a.key === 'people')!;
    expect(people).toMatchObject({ kind: 'over_allocation', title: '1 person over 110%', detail: 'Weeks 40–41 · Julien Wagner.', target: { screen: 'resources' } });
    // From a data date after those weeks: nobody.
    expect((await getPortfolioAlerts('en', '2026-10-19')).some((a) => a.key === 'people')).toBe(false);
  });
});
