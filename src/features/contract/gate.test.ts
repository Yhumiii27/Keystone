// Server-side gating of the Contract & Billing Server Functions with the real project context (docs/spec/04 §0.2,
// 01 §3.3): the persona comes from the (mocked) session, and each action is called with a payload that the gate
// lets through to validation only when the viewer may edit — so the answer tells which side of the gate it landed
// on, and nothing is written. Contract: director, PM, procurement; Billing: director, PM (the prototype's
// `ctrCanEdit`, contract.golden.json); every other persona is outside → refused, whatever the client sends.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'director' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }), getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getContract } from '@/server/dal/contract';
import { addAmendmentAction, addBondAction, addPaymentMilestoneAction, issueInvoiceAction, markInvoicePaidAction, updateContractFieldAction } from './actions';
import { G } from './test-fixtures';

const ROLES: RoleKey[] = ['director', 'pm', 'procurement', 'client', 'depthead', 'member', 'englead', 'quality'];

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('Contract & Billing Server Functions behind the real project context', () => {
  for (const role of ROLES)
    it(role, async () => {
      session.role = role;
      const contract = G.scenarios[`${role === 'director' ? 'seed' : role}|contract|en`].ctrCanEdit as boolean;
      const billing = G.scenarios[`${role === 'director' ? 'seed' : role}|billing|en`].ctrCanEdit as boolean;
      const ro = { error: 'This contract is read-only for you' };
      const bro = { error: 'Billing is read-only for you' };
      expect(await addAmendmentAction('HLT-026', { label: ' ', amt: '1' })).toEqual(contract ? { error: 'Subject is required' } : ro);
      expect(await addBondAction('HLT-026', { amt: '1', issuer: '', valid: '1 Jan 2027' })).toEqual(contract ? { error: 'Issuer is required' } : ro);
      expect(await addPaymentMilestoneAction('HLT-026', { label: '', pct: '1', due: '1 Jan 2027' })).toEqual(contract ? { error: 'Milestone is required' } : ro);
      expect(await updateContractFieldAction('HLT-026', 'retention', '120')).toEqual(contract ? { error: 'Enter a percentage between 0 and 100' } : ro);
      expect(await issueInvoiceAction('HLT-026', { ms: 'M3', no: 'X', date: '30 Sep 2026' })).toEqual(billing ? { error: 'Choose a milestone still to invoice' } : bro);
      expect(await markInvoicePaidAction('HLT-026', 'M4')).toEqual(billing ? { error: 'This invoice is not awaiting payment' } : bro);
    });

  it('nothing was written', async () => {
    const c = (await getContract('HLT-026'))!;
    expect([c.amendments.length, c.bonds.length, c.milestones.length, c.invoices.length, c.sheet.retentionPct]).toEqual([2, 2, 5, 3, 5]);
  });
});
