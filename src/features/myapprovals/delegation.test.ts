// R-051 (owner answer P-7d): delegation of approvals to a substitute for a period, on the seeded in-memory database with the
// real session ("View as" cookie) and project context. The approver's own items reach the substitute during the period only;
// the substitute decides one through the module's own Server Function, traced in their name "on behalf of" the approver;
// the approver keeps their queue; no chaining; refused declarations; who cancels; nothing else is widened.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); },
  useRouter: () => ({ push() {}, prefetch() {}, refresh() {} }), usePathname: () => '/my/approvals',
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { eq } from 'drizzle-orm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inboxView } from '@/domain/approvals';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { DelegationBanner, DelegationCard } from './delegation-card';
import { MyApprovalsBody } from './inbox';
import { PERSONA_BY_ROLE, PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import type { ApprovalDecision } from '@/domain/approvals';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { addDaysIso } from '@/server/db/codes';
import { approvalCount, getApprovalInbox } from '@/server/approvals';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { approvalDelegations, users } from '@/server/db/schema';
import { getDelegationPanel } from '@/server/dal/delegations';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getPurchaseOrder } from '@/server/dal/purchasing';
import { currentDelegation } from '@/server/delegation-scope';
import { COOKIE, getViewer } from '@/server/session';
import { cancelDelegationAction, declareDelegationAction, decideOnBehalfAction } from './delegation-actions';

const as = (role: RoleKey) => jar.set(COOKIE.role, role);
const userOf = async (role: RoleKey) => {
  const [u] = await (await getDb()).select({ id: users.id }).from(users).where(eq(users.personaRole, role));
  return u.id;
};
const queue = async (role: RoleKey, code = 'HLT-026') =>
  (await getApprovalInbox(PERSONA_BY_ROLE[role], { projectCode: code })).items.map((i) => `${i.kind}:${i.id}${i.onBehalfOf ? ` ← ${i.onBehalfOf.name}` : ''}`);
const day = (n: number) => addDaysIso(DEMO_TODAY_ISO, n);
const PO: ApprovalDecision = { mode: 'purchase-order', projectCode: 'HLT-026', number: 'PO-1082' };

describe('R-051 — approval delegation', () => {
  let pmDelegation = '';

  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('before any delegation: the engineering lead has nothing to decide on Harbor Line', async () => {
    expect(await queue('englead')).toEqual([]);
  });

  it('refused declarations: oneself, a client, an end before the start, a past period, a client approver', async () => {
    as('pm');
    const pm = await userOf('pm');
    expect(await declareDelegationAction({ substituteUserId: pm, startsOn: day(0), endsOn: day(7) })).toEqual({ ok: false, error: 'You cannot delegate to yourself' });
    expect(await declareDelegationAction({ substituteUserId: await userOf('client'), startsOn: day(0), endsOn: day(7) })).toEqual({ ok: false, error: 'The substitute must be an internal user' });
    expect(await declareDelegationAction({ substituteUserId: await userOf('englead'), startsOn: day(7), endsOn: day(1) })).toEqual({ ok: false, error: 'The end date is before the start date' });
    expect(await declareDelegationAction({ substituteUserId: await userOf('englead'), startsOn: day(-9), endsOn: day(-1) })).toEqual({ ok: false, error: 'The period is already over' });
    expect(await declareDelegationAction({ substituteUserId: 'not-a-uuid', startsOn: day(0), endsOn: day(7) })).toEqual({ ok: false, error: 'The substitute must be an internal user' });
    as('client');
    await expect(declareDelegationAction({ substituteUserId: pm, startsOn: day(0), endsOn: day(7) })).resolves.toEqual({ ok: false, error: 'Only internal users can delegate their approvals' });
    expect(await (await getDb()).select().from(approvalDelegations)).toEqual([]);
  });

  it('the PM declares the engineering lead for a week: audited, the substitute notified; an overlapping one is refused', async () => {
    as('pm');
    expect(await declareDelegationAction({ substituteUserId: await userOf('englead'), startsOn: day(0), endsOn: day(7), note: 'Site visit in Le Havre' })).toEqual({ ok: true, toast: 'Delegation recorded' });
    expect(await declareDelegationAction({ substituteUserId: await userOf('quality'), startsOn: day(5), endsOn: day(9) })).toEqual({ ok: false, error: 'You already have a delegation over these dates' });
    const [d] = await (await getDb()).select().from(approvalDelegations);
    pmDelegation = d.id;
    expect([d.startsOn, d.endsOn, d.note, d.createdByName]).toEqual([DEMO_TODAY_ISO, day(7), 'Site visit in Le Havre', 'Romain Aubert']);
    const audit = (await listAudit({ limit: 5 })).find((a) => a.area === 'My approvals')!;
    expect([audit.who, audit.object, audit.change]).toEqual(['Romain Aubert', 'Delegation Romain Aubert → Antoine Girard', `delegation: ${DEMO_TODAY_ISO} → ${day(7)}`]);
  });

  it('during the period the substitute gets the approver’s own items, marked "on behalf of"; the approver keeps them', async () => {
    expect(await queue('englead')).toEqual(['po:PO-1082 ← Romain Aubert', 'eco:ECO-2026-015 ← Romain Aubert', 'rfq:RFQ-2026-031 ← Romain Aubert']);
    expect(await queue('pm')).toEqual(['po:PO-1082', 'eco:ECO-2026-015', 'rfq:RFQ-2026-031']);
    const po = (await getApprovalInbox(PERSONA_BY_ROLE.englead, { projectCode: 'HLT-026' })).items[0];
    expect(po.onBehalfOf).toEqual({ name: 'Romain Aubert', delegationId: pmDelegation });
    expect(po.decision).toEqual(PO);
    expect(await approvalCount(PERSONA_BY_ROLE.englead, 'HLT-026')).toBe(3);
    // Banner of the substitute, the approver's own list, the director's list.
    const panel = await getDelegationPanel(PERSONA_BY_ROLE.englead, true);
    expect(panel.standingIn.map((d) => [d.approverName, d.from, d.to, d.canCancel])).toEqual([['Romain Aubert', '25 Sep 2026', '2 Oct 2026', false]]);
    expect((await getDelegationPanel(PERSONA_BY_ROLE.pm, true)).mine.map((d) => [d.substituteName, d.state, d.canCancel])).toEqual([['Antoine Girard', 'active', true]]);
    expect((await getDelegationPanel(PERSONA_BY_ROLE.director, true)).all?.map((d) => [d.approverName, d.substituteName, d.canCancel])).toEqual([['Romain Aubert', 'Antoine Girard', true]]);
    expect((await getDelegationPanel(PERSONA_BY_ROLE.pm, true)).candidates.map((c) => c.name)).not.toContain('Nadia Bensaïd');
  });

  it('render (FR): the banner, the "Pour le compte de" line and the Delegation card', async () => {
    const { items, decided } = await getApprovalInbox(PERSONA_BY_ROLE.englead, { projectCode: 'HLT-026' });
    const panel = await getDelegationPanel(PERSONA_BY_ROLE.englead, true);
    const html = renderToStaticMarkup(
      h(I18nProvider, {
        lang: 'fr',
        children: h(MyApprovalsBody, {
          view: inboxView(items, { decided, roleTitle: 'Engineering lead' }), t: makeT('fr'), lang: 'fr', canDecide: true,
          banner: h(DelegationBanner, { panel }), delegation: h(DelegationCard, { panel }),
        }),
      }),
    );
    expect(html).toContain('Vous suppléez Romain Aubert · 25 sept. 2026 → 2 oct. 2026');
    expect(html.match(/Pour le compte de Romain Aubert/g)).toHaveLength(3);
    expect(html).toContain('Suppléance');
    expect(html).toContain('Déclarer un suppléant');
    expect(html.match(/>Approuver</g)).toHaveLength(2); // PO and ECO decide inline; the RFQ is awarded on Sourcing
  });

  it('the substitute approves the purchase order: recorded by the Orders writer, audit and activity in their name on behalf of the PM', async () => {
    as('englead');
    expect(await decideOnBehalfAction({ delegationId: pmDelegation, decision: PO, ok: true })).toEqual({ ok: true });
    expect((await getPurchaseOrder('PO-1082'))?.status).toBe('ordered');
    const audit = (await listAudit({ limit: 10 })).find((a) => a.object.includes('PO-1082'))!;
    expect([audit.who, audit.onBehalfOf, audit.userEmail]).toEqual(['Antoine Girard', 'Romain Aubert', 'antoine.girard@epc2i.fr']);
    const act = (await listActivity({ limit: 10 })).find((a) => a.what.includes('PO-1082'))!;
    expect([act.who, act.onBehalfOf]).toEqual(['Antoine Girard', 'Romain Aubert']);
    // Gone from both queues; the scope ended with the call.
    expect(await queue('englead')).not.toContain('po:PO-1082 ← Romain Aubert');
    expect(await queue('pm')).not.toContain('po:PO-1082');
    expect(currentDelegation()).toBeNull();
    expect((await getViewer()).name).toBe('Antoine Girard');
    // Decided already: refused.
    expect(await decideOnBehalfAction({ delegationId: pmDelegation, decision: PO, ok: false, note: 'x' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
  });

  it('only the approver’s own items: another person’s item, a forged decision, someone else using the delegation', async () => {
    as('englead');
    expect(await decideOnBehalfAction({ delegationId: pmDelegation, decision: { mode: 'resource-request', number: 'RQ-043' }, ok: true })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    expect(await decideOnBehalfAction({ delegationId: pmDelegation, decision: { mode: 'purchase-order', projectCode: 'WSA-044', number: 'PO-5141' }, ok: true })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    expect(await decideOnBehalfAction({ delegationId: 'nope', decision: PO, ok: true })).toEqual({ ok: false, error: 'Invalid request' });
    as('quality'); // not the substitute
    expect(await decideOnBehalfAction({ delegationId: pmDelegation, decision: { mode: 'eco', number: 'ECO-2026-015', key: 'pm' }, ok: true })).toEqual({ ok: false, error: 'This delegation is not running today' });
  });

  it('no chaining: the head of engineering delegates to the PM — the PM gets her requests, the PM’s substitute does not', async () => {
    as('depthead');
    expect((await declareDelegationAction({ substituteUserId: await userOf('pm'), startsOn: day(0), endsOn: day(3) })).ok).toBe(true);
    expect(await queue('pm')).toEqual(['eco:ECO-2026-015', 'rfq:RFQ-2026-031', 'request:RQ-043 ← Marion Kerviel', 'request:RQ-041 ← Marion Kerviel']);
    expect(await queue('englead')).toEqual(['eco:ECO-2026-015 ← Romain Aubert', 'rfq:RFQ-2026-031 ← Romain Aubert']);
    as('englead');
    expect(await decideOnBehalfAction({ delegationId: pmDelegation, decision: { mode: 'resource-request', number: 'RQ-043' }, ok: true })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
  });

  it('a delegation that starts later routes nothing yet', async () => {
    as('quality');
    expect((await declareDelegationAction({ substituteUserId: await userOf('procurement'), startsOn: day(3), endsOn: day(10) })).ok).toBe(true);
    expect((await queue('procurement')).filter((x) => x.includes('←'))).toEqual([]);
    expect((await getDelegationPanel(PERSONA_BY_ROLE.procurement, true)).upcomingFor.map((d) => d.approverName)).toEqual(['Gabriel Comte']);
  });

  it('cancellation: the substitute cannot, the director can; the items leave the substitute’s queue', async () => {
    as('englead');
    expect(await cancelDelegationAction({ id: pmDelegation })).toEqual({ ok: false, error: 'You cannot change this delegation' });
    as('director');
    expect(await cancelDelegationAction({ id: pmDelegation, reason: 'Back early' })).toEqual({ ok: true, toast: 'Delegation cancelled' });
    expect(await queue('englead')).toEqual([]);
    as('englead');
    expect(await decideOnBehalfAction({ delegationId: pmDelegation, decision: { mode: 'eco', number: 'ECO-2026-015', key: 'pm' }, ok: true })).toEqual({ ok: false, error: 'This delegation is not running today' });
    as('pm');
    expect(await cancelDelegationAction({ id: pmDelegation })).toEqual({ ok: false, error: 'You cannot change this delegation' }); // already cancelled
    const audit = (await listAudit({ limit: 5 })).find((a) => a.change === 'delegation: cancelled')!;
    expect([audit.who, audit.reason]).toEqual(['Marie Lefebvre', 'Back early']);
  });

  it('every persona: the panel loads; a client never declares nor stands in', async () => {
    for (const p of PERSONAS) {
      const panel = await getDelegationPanel(p, true);
      expect([p.role, panel.canDeclare]).toEqual([p.role, p.role !== 'client']);
      if (p.role === 'client') expect(panel).toMatchObject({ mine: [], standingIn: [], candidates: [] });
    }
  });
});
