// Delivery 8, lot cost-change — R-077 (C-7, C-7a) through the Server Functions with the real project context: "Edit" and "Remove"
// of a planned payment milestone for the 9 personas (Contract rights since P-4 / R-044: director, PM, Finance; the client is sent
// home; the others, procurement included, read only), malformed input and stale rows (invoiced, removed, unknown), and "Issue invoice" refused with the reason
// while the milestone's group exceeds 100 %, allowed again once the schedule is corrected. The view models: the group hint,
// the Billing row's reason, the invoice form without the blocked milestones, the edit dialog's values round-trip (EN / FR).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const session = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
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
  return { getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }), getViewer: async () => PERSONA_BY_ROLE[session.role] };
});

import { optionValue } from '@/components/app/form-def';
import { INVOICE_BLOCKED_MESSAGE, parseMilestoneForm } from '@/domain/contract';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { addPaymentMilestone, getContract } from '@/server/dal/contract';
import { listAudit } from '@/server/dal/notifications';
import { issueInvoiceAction, removePaymentMilestoneAction, updatePaymentMilestoneAction } from './actions';
import { billingView, contractView, editMilestoneValues, invoiceFormDef } from './model';

const ROLES: RoleKey[] = ['director', 'pm', 'procurement', 'finance', 'client', 'depthead', 'member', 'englead', 'quality'];
// P-4 (R-044, roles-rates-hr lot): procurement no longer edits the contract; Finance does, on every project.
const CONTRACT_EDITORS: RoleKey[] = ['director', 'pm', 'finance'];
const hlt = async () => (await getContract('HLT-026'))!;
const VALUES = { label: 'Crane load test passed', pct: '5', due: '15 Mar 2027', cond: 'Load test report accepted' };

beforeAll(async () => setDb(await openDatabase()), 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('R-077 — Edit / Remove milestone for the 9 personas', () => {
  for (const role of ROLES)
    it(role, async () => {
      const n = await addPaymentMilestone('HLT-026', { label: `Spare ${role}`, sharePct: 1, contractualDue: '2027-02-01' }, 'Marie Lefebvre');
      session.role = role;
      if (role === 'client') {
        // R-042 (P-1): Contract is outside the client's workspace → sent home.
        await expect(updatePaymentMilestoneAction('HLT-026', n, VALUES)).rejects.toThrow('REDIRECT /');
        await expect(removePaymentMilestoneAction('HLT-026', n)).rejects.toThrow('REDIRECT /');
        return;
      }
      if (!CONTRACT_EDITORS.includes(role)) {
        const ro = { error: 'This contract is read-only for you' };
        expect(await updatePaymentMilestoneAction('HLT-026', n, VALUES)).toEqual(ro);
        expect(await removePaymentMilestoneAction('HLT-026', n)).toEqual(ro);
        expect((await hlt()).milestones.find((m) => m.number === n)?.label).toBe(`Spare ${role}`);
        return;
      }
      expect(await updatePaymentMilestoneAction('HLT-026', n, VALUES)).toEqual({ toast: `${n} · Payment milestone updated` });
      const m = (await hlt()).milestones.find((x) => x.number === n)!;
      expect([m.label, m.sharePct, m.contractualDue, m.condition, m.amendment]).toEqual(['Crane load test passed', 5, '2027-03-15', 'Load test report accepted', null]);
      expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ area: 'Contract', change: expect.stringMatching(new RegExp(`^payment milestone ${n} changed · label: Spare ${role} → Crane load test passed · share: 1 → 5 %`)) });
      expect(await removePaymentMilestoneAction('HLT-026', n)).toEqual({ toast: `${n} · Payment milestone removed` });
      expect((await hlt()).milestones.map((x) => x.number)).not.toContain(n);
      // Stale click: the row is gone.
      expect(await removePaymentMilestoneAction('HLT-026', n)).toEqual({ error: 'Unknown milestone' });
      expect(await updatePaymentMilestoneAction('HLT-026', n, VALUES)).toEqual({ error: 'Unknown milestone' });
    });
});

describe('R-077 — validation, stale rows, the basis never changes', () => {
  it('malformed input and invoiced milestones are refused; nothing is written', async () => {
    const before = await hlt();
    const invoiced = before.milestones.find((m) => m.status !== 'planned')!.number;
    const planned = before.milestones.find((m) => m.status === 'planned' && m.amendment == null)!.number;
    for (const bad of ['', 'M', 'M1; drop', 'X4', 42 as unknown as string, null as unknown as string])
      expect([bad, await removePaymentMilestoneAction('HLT-026', bad)]).toEqual([bad, { error: 'Invalid request' }]);
    expect(await updatePaymentMilestoneAction('HLT-026', invoiced, VALUES)).toEqual({ error: 'Only a planned milestone can be changed' });
    expect(await removePaymentMilestoneAction('HLT-026', invoiced)).toEqual({ error: 'Only a planned milestone can be changed' });
    expect(await updatePaymentMilestoneAction('HLT-026', planned, { ...VALUES, pct: '0' })).toEqual({ error: 'Enter a share between 0 and 100 %' });
    expect(await updatePaymentMilestoneAction('HLT-026', planned, { ...VALUES, pct: '101' })).toEqual({ error: 'Enter a share between 0 and 100 %' });
    expect(await updatePaymentMilestoneAction('HLT-026', planned, { ...VALUES, label: ' ' })).toEqual({ error: 'Milestone is required' });
    expect(await updatePaymentMilestoneAction('HLT-026', planned, { ...VALUES, due: '31 Feb' })).toEqual({ error: 'Enter a date such as 14 Dec 2026' });
    expect(await updatePaymentMilestoneAction('NOPE-1', planned, VALUES)).toEqual({ error: 'Unknown project' });
    expect(await updatePaymentMilestoneAction(42 as unknown as string, planned, VALUES)).toEqual({ error: 'Invalid request' });
    // A forged "Applies to" is ignored: the milestone stays on its basis.
    expect(await updatePaymentMilestoneAction('HLT-026', planned, { ...VALUES, basis: '0', label: 'Kept on the base' })).toEqual({ toast: `${planned} · Payment milestone updated` });
    expect((await hlt()).milestones.find((m) => m.number === planned)!.amendment).toBeNull();
    expect((await hlt()).milestones.filter((m) => m.status !== 'planned').map((m) => [m.number, m.label, m.sharePct]))
      .toEqual(before.milestones.filter((m) => m.status !== 'planned').map((m) => [m.number, m.label, m.sharePct]));
    session.lang = 'fr';
    expect(await removePaymentMilestoneAction('HLT-026', invoiced)).toEqual({ error: makeT('fr')('Only a planned milestone can be changed') });
  });

  it('the edit dialog values round-trip through the form parser (EN and FR dates)', () => {
    const m = { label: 'Handover', sharePct: 12.5, contractualDue: '2027-01-14', condition: null };
    for (const lang of ['en', 'fr'] as const) {
      const v = editMilestoneValues(m, makeT(lang));
      const parsed = parseMilestoneForm(v);
      expect([lang, parsed]).toEqual([lang, { ok: true, value: { label: 'Handover', sharePct: 12.5, contractualDue: '2027-01-14', condition: null, amendment: null } }]);
    }
  });
});

describe('R-077 — Issue invoice blocked while the group exceeds 100 %', () => {
  it('over 100 %: the reason on Billing and the contract hint, the invoice refused; corrected → invoiced', async () => {
    const c = await hlt();
    const base = c.milestones.filter((m) => m.amendment == null).reduce((a, m) => a + m.sharePct, 0);
    const extra = await addPaymentMilestone('HLT-026', { label: 'Overflow', sharePct: Math.round((105 - base) * 100) / 100, contractualDue: '2027-05-01' }, 'Marie Lefebvre');
    const blocked = await hlt();
    const target = blocked.milestones.find((m) => m.status === 'planned' && m.amendment == null && m.number !== extra)!.number;
    for (const lang of ['en', 'fr'] as const) {
      const t = makeT(lang);
      const b = billingView(blocked, t, lang);
      expect(b.toInvoice.filter((r) => r.blocked).length).toBeGreaterThan(0);
      expect(b.toInvoice.find((r) => r.blocked)!.blocked).toBe(t(INVOICE_BLOCKED_MESSAGE));
      const v = contractView(blocked, t, lang);
      expect(v.baseTotal.hint).toBe(lang === 'en' ? 'Shares total 105 % · invoicing blocked' : 'Total des parts 105 % · facturation bloquée');
      const ms = invoiceFormDef(blocked, t, lang).fields.find((f) => f.id === 'ms')!;
      expect((ms.options ?? []).map(optionValue)).not.toContain(target);
    }
    session.role = 'pm';
    expect(await issueInvoiceAction('HLT-026', { ms: target, no: 'INV-2026-090', date: '30 Sep 2026' })).toEqual({ error: INVOICE_BLOCKED_MESSAGE });
    session.lang = 'fr';
    expect(await issueInvoiceAction('HLT-026', { ms: target, no: 'INV-2026-090', date: '30 Sep 2026' })).toEqual({ error: makeT('fr')(INVOICE_BLOCKED_MESSAGE) });
    session.lang = 'en';
    // Corrected by removing the extra milestone (Finance edits the contract, not the billing — P-4, R-044).
    session.role = 'finance';
    expect(await removePaymentMilestoneAction('HLT-026', extra)).toEqual({ toast: `${extra} · Payment milestone removed` });
    session.role = 'pm';
    expect(await issueInvoiceAction('HLT-026', { ms: target, no: 'INV-2026-090', date: '30 Sep 2026' })).toMatchObject({ toast: expect.stringContaining('INV-2026-090') });
  });
});
