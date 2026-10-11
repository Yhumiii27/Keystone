// R-130 (NEW-D1-1 a): the portfolio alerts from the live data — a billing rule raised by a write (late milestone, then overdue
// invoice), worst first and capped at 8 (the seed has 8 alerts: the approval alert gives way). In-memory database.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addPaymentMilestone, issueInvoice } from './contract';
import { getPortfolioAlerts } from './portfolio-alerts';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('portfolio alerts (R-130)', () => {
  it('seed: 8 alerts, the director’s approvals last', async () => {
    expect((await getPortfolioAlerts('en')).map((a) => a.key)).toEqual([
      'off-RCF-019', 'slip-RCF-019', 'slip-HLT-026', 'slip-MSR-012', 'slip-NDC-031', 'cost-HLT-026', 'people', 'approvals',
    ]);
  });

  it('a billable milestone past its date and not invoiced, then its invoice past due, raise the billing alert', async () => {
    const n = await addPaymentMilestone('HLT-026', { label: 'Early works', sharePct: 1, contractualDue: '2026-08-01' }, 'Romain Aubert');
    let alerts = await getPortfolioAlerts('en');
    expect(alerts.map((a) => a.key)).toEqual([
      'off-RCF-019', 'slip-RCF-019', 'slip-HLT-026', 'slip-MSR-012', 'slip-NDC-031', 'cost-HLT-026', 'bill-HLT-026', 'people',
    ]);
    expect(alerts[6]).toMatchObject({
      kind: 'billing_late', title: 'Harbor Line Terminal Expansion — billing late', detail: `${n} Early works · contractual date 1 Aug 2026, not invoiced.`,
      target: { screen: 'billing', code: 'HLT-026' },
    });
    // Invoiced on 1 Aug, net 45 → due 15 Sep: overdue at the data date.
    await issueInvoice('HLT-026', { milestone: n, issuedOn: '2026-08-01' }, 'Romain Aubert');
    alerts = await getPortfolioAlerts('fr');
    const bill = alerts.find((a) => a.key === 'bill-HLT-026')!;
    expect([bill.title, bill.detail]).toEqual([
      'Extension du terminal Harbor Line — facture en retard de paiement', 'INV-2026-004 · 54 k€ échue le 15 sept. 2026.',
    ]);
  });
});
