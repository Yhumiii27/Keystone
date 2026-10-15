// Server-side gating of the Contract & Billing Server Functions with the real project context (docs/spec/04 §0.2,
// 01 §3.3): the persona comes from the (mocked) session, and each action is called with a payload that the gate
// lets through to validation only when the viewer may edit — so the answer tells which side of the gate it landed
// on, and nothing is written. Contract: director, PM, procurement; Billing: director, PM (the prototype's
// `ctrCanEdit`, contract.golden.json); every other persona is outside → refused, whatever the client sends.
// Delivery 8 (R-044, P-4): the Contract is edited by the director, Finance (every project — default to confirm against P-2) and
// the project's leads whose workspace has it; procurement loses it (the golden's procurement scenario is overridden below,
// citing P-4); Finance reads Billing; the budget rate is the director's and Finance's (C-9 default).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'director' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }), getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { and, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { persons, projectMembers, projects } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { getContract } from '@/server/dal/contract';
import {
  addAmendmentAction, addBondAction, addPaymentMilestoneAction, issueInvoiceAction, markInvoicePaidAction, releaseBondAction, sendAmendmentAction, setBudgetRateAction,
  signAmendmentAction, updateContractFieldAction,
} from './actions';
import { G } from './test-fixtures';

const ROLES: RoleKey[] = ['director', 'pm', 'procurement', 'finance', 'client', 'depthead', 'member', 'englead', 'quality'];
/** P-4 (R-044): who edits the contract / bills on HLT-026 now — the golden's `ctrCanEdit` except procurement, plus Finance. */
const P4: Partial<Record<RoleKey, { contract: boolean; billing: boolean }>> = {
  procurement: { contract: false, billing: false },
  finance: { contract: true, billing: false },
};

beforeAll(async () => setDb(await openDatabase()), 60_000);

describe('Contract & Billing Server Functions behind the real project context', () => {
  for (const role of ROLES)
    it(role, async () => {
      session.role = role;
      if (role === 'client') {
        // R-042 (P-1): Contract and Billing are outside the client's workspace → sent home (was: the read-only refusal).
        await expect(addAmendmentAction('HLT-026', { label: ' ', amt: '1' })).rejects.toThrow('REDIRECT /');
        await expect(issueInvoiceAction('HLT-026', { ms: 'M3', no: 'X', date: '30 Sep 2026' })).rejects.toThrow('REDIRECT /');
        return;
      }
      const contract = P4[role]?.contract ?? (G.scenarios[`${role === 'director' ? 'seed' : role}|contract|en`].ctrCanEdit as boolean);
      const billing = P4[role]?.billing ?? (G.scenarios[`${role === 'director' ? 'seed' : role}|billing|en`].ctrCanEdit as boolean);
      const ro = { error: 'This contract is read-only for you' };
      const bro = { error: 'Billing is read-only for you' };
      expect(await addAmendmentAction('HLT-026', { label: ' ', amt: '1' })).toEqual(contract ? { error: 'Subject is required' } : ro);
      expect(await addBondAction('HLT-026', { amt: '1', issuer: '', valid: '1 Jan 2027' })).toEqual(contract ? { error: 'Issuer is required' } : ro);
      expect(await addPaymentMilestoneAction('HLT-026', { label: '', pct: '1', due: '1 Jan 2027' })).toEqual(contract ? { error: 'Milestone is required' } : ro);
      expect(await updateContractFieldAction('HLT-026', 'retention', '120')).toEqual(contract ? { error: 'Enter a percentage between 0 and 100' } : ro);
      expect(await issueInvoiceAction('HLT-026', { ms: 'M3', no: 'X', date: '30 Sep 2026' })).toEqual(billing ? { error: 'Choose a milestone still to invoice' } : bro);
      expect(await markInvoicePaidAction('HLT-026', 'M4')).toEqual(billing ? { error: 'This invoice is not awaiting payment' } : bro);
      // R-079: the signature cycle and the guarantee release follow the contract's rights.
      expect(await sendAmendmentAction('HLT-026', 0)).toEqual(contract ? { error: 'Only a draft amendment can be sent for signature' } : ro);
      expect(await signAmendmentAction('HLT-026', 0, { date: '30 Sep 2026' })).toEqual(contract ? { error: 'Only an amendment sent for signature can be signed' } : ro);
      expect(await releaseBondAction('HLT-026', 1, { date: '30 Sep 2026' })).toEqual(contract ? { error: 'This guarantee is already released' } : ro);
      // C-9: the budget rate is the portfolio director's — and Finance's since R-044 (default, DELIVERY-7 §8).
      expect(await setBudgetRateAction('HLT-026', 'usd', '1')).toEqual(
        role === 'director' || role === 'finance' ? { error: 'Unknown currency' } : { error: 'Only the portfolio director and Finance set the budget rate' },
      );
    });

  it('P-4: a deputy PM whose role is "member" gets no contract editing (Contract is outside their workspace)', async () => {
    session.role = 'member';
    const db = await getDb();
    const [julien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const where = and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, julien.id));
    const [before] = await db.select({ role: projectMembers.projectRole }).from(projectMembers).where(where);
    await db.update(projectMembers).set({ projectRole: 'deputy' }).where(where);
    try {
      expect(await addAmendmentAction('HLT-026', { label: ' ', amt: '1' })).toEqual({ error: 'This contract is read-only for you' });
      expect(await setBudgetRateAction('HLT-026', 'usd', '1')).toEqual({ error: 'Only the portfolio director and Finance set the budget rate' });
    } finally {
      await db.update(projectMembers).set({ projectRole: before.role }).where(where);
    }
  });

  it('P-4: Finance edits the contract of a project whose team it is not on, but never bills', async () => {
    session.role = 'finance';
    // RCF-019: no team row for Léa Marchand; read-only for her elsewhere, the contract stays hers to edit (no contract → refusal of the data).
    expect(await addAmendmentAction('RCF-019', { label: ' ', amt: '1' })).toEqual({ error: 'No contract registered for this project' });
    expect(await issueInvoiceAction('RCF-019', { ms: 'M3', no: 'X', date: '30 Sep 2026' })).toEqual({ error: 'Billing is read-only for you' });
  });

  it('nothing was written', async () => {
    const c = (await getContract('HLT-026'))!;
    expect([c.amendments.length, c.bonds.length, c.milestones.length, c.invoices.length, c.sheet.retentionPct]).toEqual([2, 2, 6, 3, 5]);
    expect([c.amendments.map((a) => a.status), c.bonds.map((b) => b.inForce), c.fx]).toEqual([['signed', 'awaiting_signature'], [true, false], { currency: 'EUR', budgetRate: null }]);
  });
});
