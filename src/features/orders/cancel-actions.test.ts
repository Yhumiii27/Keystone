// R-095 (SC-3a = a, P-5c = a): cancelling a purchase order before it is placed. Pure rules first (who may cancel or withdraw,
// which orders, the reason), then the Server Functions on the seeded in-memory database with the real project context: the
// 8 personas, a PM outside his project (read-only), malformed input, orders imported from Sage X3, placed orders, stale clicks
// (an approval racing a withdrawal), the writer's own re-check, the audit / activity / notice, the drawer, the RFQ footnote and
// the internal PO summary. Golden baselines are untouched: the cancelled orders are drafts this file creates.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { revalidatePath } from 'next/cache';
import { PERSONAS, PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { isCancellablePo, poCancelReason, poCancelRight, PO_CANCEL_REASON_MAX } from '@/domain/orders';
import { rfqHint } from '@/domain/procurement';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { fmtDOfIso } from '@/server/db/codes';
import { listActivity, listAudit, listNotifications } from '@/server/dal/notifications';
import { getOrdersScreen } from '@/server/dal/orders';
import {
  PurchaseOrderError, approvePurchaseOrder, awardRfq, cancelPurchaseOrder, createDraftPurchaseOrders, getPurchaseOrder, getRfq, listRfqs, poCancelRights, submitPurchaseOrder,
} from '@/server/dal/purchasing';
import { buildExportContext, runExport } from '@/server/export/run';
import { pdfTextLines } from '@/server/export/test/pdf-text';
import '@/server/export/providers';
import { procT } from '@/features/procurement/i18n';
import { rfqDrawerView } from '@/features/procurement/model';
import { cancelOrderAction } from './actions';
import { ordersView } from './model';

const HLT = 'HLT-026';
const REASON = 'Ordered twice — the supplier was changed at the design review';
const as = (role: string, lang: 'en' | 'fr' = 'en') => {
  session.role = role;
  session.lang = lang;
};

describe('R-095 rules', () => {
  const local = { status: 'draft' as const, origin: 'shortfall' as const, x3Ref: null, createdByPersonId: 'author', submittedByPersonId: null };
  it('a Draft: its author, the project’s leads and the director (default beyond SC-3a) cancel it', () => {
    expect(poCancelRight(local, { personId: 'author', lead: false })).toBe('cancel');
    expect(poCancelRight(local, { personId: 'pm', lead: true })).toBe('cancel');
    expect(poCancelRight(local, { personId: 'other', lead: false })).toBeNull();
    expect(poCancelRight(local, { personId: null, lead: false })).toBeNull();
    expect(poCancelRight({ ...local, createdByPersonId: null }, { personId: null, lead: false })).toBeNull();
  });

  it('awaiting approval: only whoever sent it withdraws it (P-5c); the approvers keep Reject', () => {
    const sent = { ...local, status: 'awaiting_approval' as const, submittedByPersonId: 'buyer' };
    expect(poCancelRight(sent, { personId: 'buyer', lead: false })).toBe('withdraw');
    expect(poCancelRight(sent, { personId: 'author', lead: false })).toBeNull();
    expect(poCancelRight(sent, { personId: 'pm', lead: true })).toBeNull();
  });

  it('never an order imported from Sage X3, pushed to X3, or placed', () => {
    for (const origin of ['rfq', 'spares', 'shortfall'] as const) expect(isCancellablePo({ ...local, origin })).toBe(true);
    expect(isCancellablePo({ ...local, origin: 'x3' })).toBe(false);
    expect(isCancellablePo({ ...local, x3Ref: 'X3-PO-1100' })).toBe(false);
    for (const status of ['ordered', 'partially_received', 'received', 'cancelled'] as const) {
      expect(isCancellablePo({ ...local, status }), status).toBe(false);
      expect(poCancelRight({ ...local, status }, { personId: 'author', lead: true }), status).toBeNull();
    }
    expect(poCancelRight({ ...local, origin: 'x3' }, { personId: 'author', lead: true })).toBeNull();
  });

  it('the reason: trimmed, required, at most 1000 characters', () => {
    expect(poCancelReason('  late  ')).toEqual({ ok: true, value: 'late' });
    expect(poCancelReason('   ')).toEqual({ ok: false, error: 'Give the reason for the cancellation' });
    expect(poCancelReason(undefined)).toEqual({ ok: false, error: 'Give the reason for the cancellation' });
    expect(poCancelReason(42)).toEqual({ ok: false, error: 'Give the reason for the cancellation' });
    expect(poCancelReason('x'.repeat(PO_CANCEL_REASON_MAX)).ok).toBe(true);
    expect(poCancelReason('x'.repeat(PO_CANCEL_REASON_MAX + 1))).toEqual({ ok: false, error: 'The reason is too long' });
  });

  it('the RFQ footnote follows the drafted order (the RFQ stays awarded)', () => {
    const r = { status: 'awarded' as const, quoteCount: 3, awardedTo: 'ABB', purchaseOrderNumber: 'PO-1100', awardedInKeystone: true };
    expect(rfqHint({ ...r, purchaseOrderStatus: 'draft' }, 'pm')).toBe('Awarded to ABB — purchase order created as draft.');
    expect(rfqHint({ ...r, purchaseOrderStatus: 'cancelled' }, 'pm')).toBe('Awarded to ABB — purchase order PO-1100 cancelled before it was placed.');
    expect(rfqHint({ ...r, purchaseOrderStatus: 'awaiting_approval' }, 'pm')).toBe('Awarded to ABB — purchase order PO-1100 awaiting approval.');
    expect(rfqHint({ ...r, purchaseOrderStatus: 'received' }, 'pm')).toBe('Awarded to ABB — purchase order PO-1100 placed.');
    const fr = procT(makeT('fr'), 'fr');
    expect(fr('Awarded to ABB — purchase order PO-1100 cancelled before it was placed.')).toBe('Attribuée à ABB — commande PO-1100 annulée avant d’être passée.');
    expect(fr('Awarded to ABB — purchase order PO-1100 placed.')).toBe('Attribuée à ABB — commande PO-1100 passée.');
  });
});

describe('R-095 Server Functions', () => {
  let drafts: string[] = [];
  beforeAll(async () => {
    setDb(await openDatabase());
    // Keystone drafts from the BOM shortfall, written by the buyer (procurement persona).
    drafts = await createDraftPurchaseOrders(HLT, 'Fabien Bertrand');
  }, 60_000);
  beforeEach(() => {
    as('director');
    vi.mocked(revalidatePath).mockClear();
  });

  it('who may cancel the buyer’s draft, per persona: the author, the PM of the project and the director', async () => {
    expect(drafts.length).toBeGreaterThanOrEqual(4);
    const rights = Object.fromEntries(await Promise.all(PERSONAS.map(async (p) => [p.role, (await poCancelRights(HLT, p.name))[drafts[0]] ?? null])));
    // R-044 (roles-rates-hr lot): Finance, the 9th persona, does not cancel orders.
    expect(rights).toEqual({ director: 'cancel', pm: 'cancel', depthead: null, member: null, englead: null, quality: null, procurement: 'cancel', finance: null, client: null });
    // The drawer offers "Cancel order" to exactly those viewers (and to the editors of Orders only).
    for (const p of PERSONAS) {
      const data = await getOrdersScreen(HLT, p.name);
      const d = ordersView({ code: HLT, data, filter: null, selected: drafts[0] }, makeT('en'), 'en').drawer!;
      expect(d.cancel, p.role).toBe(rights[p.role]);
    }
  });

  it('every persona: the Orders editors who may cancel do; the others are refused, nothing written', async () => {
    const outcome: Record<string, string> = {};
    // Refusals first (none of them may change the draft), then the author cancels it.
    const order: RoleKey[] = ['depthead', 'member', 'englead', 'quality', 'client', 'procurement'];
    for (const role of order) {
      as(role);
      try {
        const r = await cancelOrderAction(HLT, drafts[0], REASON);
        outcome[role] = r.ok ? (r.message ?? 'ok') : r.error;
      } catch (e) {
        outcome[role] = (e as Error).message;
      }
    }
    expect(outcome).toEqual({
      depthead: 'Purchase orders are read-only for you',
      member: 'Purchase orders are read-only for you',
      englead: 'Purchase orders are read-only for you',
      quality: 'Purchase orders are read-only for you',
      client: 'NEXT_REDIRECT',
      procurement: `${drafts[0]} · Cancelled`,
    });
    const po = (await getPurchaseOrder(drafts[0]))!;
    expect([po.status, po.cancellation?.by, po.cancellation?.reason]).toEqual(['cancelled', 'Fabien Bertrand', REASON]);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.who, audit.object, audit.change, audit.area]).toEqual(['Fabien Bertrand', drafts[0], `status: Draft → Cancelled · ${REASON}`, 'Purchase orders']);
    const [act] = await listActivity({ kind: 'change', limit: 1 });
    expect([act.who, act.what]).toEqual(['Fabien Bertrand', `Cancelled ${drafts[0]}`]);
    // A second click on the stale button: refused, the row refreshed.
    vi.mocked(revalidatePath).mockClear();
    expect(await cancelOrderAction(HLT, drafts[0], REASON)).toEqual({ ok: false, error: 'This order can no longer be cancelled' });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    // The PM and the director see it cancelled too (stale for them); the drawer says why, by whom and when.
    as('pm');
    expect(await cancelOrderAction(HLT, drafts[0], REASON)).toEqual({ ok: false, error: 'This order can no longer be cancelled' });
    const d = ordersView({ code: HLT, data: await getOrdersScreen(HLT, 'Romain Aubert'), filter: null, selected: drafts[0] }, makeT('fr'), 'fr').drawer!;
    expect([d.status, d.cancel]).toEqual(['Annulé', null]);
    expect(d.meta.find((m) => m.k === 'Annulé')!.v).toBe(`${makeT('fr')(fmtDOfIso(po.cancellation!.at.slice(0, 10)))} · Fabien Bertrand · ${REASON}`);
  });

  it('the project’s PM cancels the buyer’s draft (default beyond SC-3a); the buyer is told in the bell', async () => {
    as('pm');
    expect(await cancelOrderAction(HLT, drafts[1], 'Covered by the client-supplied lot')).toEqual({ ok: true, message: `${drafts[1]} · Cancelled` });
    const notices = await listNotifications('procurement');
    expect(notices[0]).toMatchObject({ title: `${drafts[1]} · Purchase order cancelled`, sub: 'Covered by the client-supplied lot', screen: 'orders', params: { po: drafts[1] } });
    // The actor is never told about his own cancellation.
    expect((await listNotifications('pm')).some((n) => n.title.startsWith(drafts[1]))).toBe(false);
  });

  it('awaiting approval: only the person who sent it withdraws it; an approval racing the withdrawal wins cleanly', async () => {
    await submitPurchaseOrder(drafts[2], 'Fabien Bertrand');
    for (const role of ['pm', 'director'] as const) {
      as(role);
      expect(await cancelOrderAction(HLT, drafts[2], REASON), role).toEqual({ ok: false, error: 'Only the person who sent the order for approval withdraws it' });
    }
    as('procurement');
    expect(await cancelOrderAction(HLT, drafts[2], 'Wrong quantity')).toEqual({ ok: true, message: `${drafts[2]} · Withdrawn from approval` });
    expect(await listAudit({ projectCode: HLT, limit: 1 })).toMatchObject([{ change: 'status: Awaiting approval → Cancelled · Wrong quantity' }]);
    expect((await listActivity({ kind: 'change', limit: 1 }))[0].what).toBe(`Withdrew ${drafts[2]} from approval`);
    // The race: the PM approves (places) the order between the page and the withdrawal.
    await submitPurchaseOrder(drafts[3], 'Fabien Bertrand');
    await approvePurchaseOrder(drafts[3], 'Romain Aubert');
    vi.mocked(revalidatePath).mockClear();
    expect(await cancelOrderAction(HLT, drafts[3], REASON)).toEqual({ ok: false, error: 'This order can no longer be cancelled' });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    await expect(cancelPurchaseOrder(drafts[3], REASON, 'Fabien Bertrand')).rejects.toMatchObject({ code: 'stale' });
    expect((await getPurchaseOrder(drafts[3]))!.status).toBe('ordered');
  });

  it('refuses orders imported from Sage X3, malformed input, unknown orders and a project read-only for the viewer', async () => {
    as('director');
    // PO-1082 awaits approval but comes from Sage X3: cancelled there, not in Keystone (I-3b, A-1a).
    expect(await cancelOrderAction(HLT, 'PO-1082', REASON)).toEqual({ ok: false, error: 'An order imported from Sage X3 is cancelled in Sage X3' });
    await expect(cancelPurchaseOrder('PO-1082', REASON, 'Marie Lefebvre')).rejects.toBeInstanceOf(PurchaseOrderError);
    expect((await getPurchaseOrder('PO-1082'))!.status).toBe('awaiting_approval');
    const next = drafts[4] ?? drafts[1];
    expect(await cancelOrderAction(HLT, next, '')).toEqual({ ok: false, error: 'Give the reason for the cancellation' });
    expect(await cancelOrderAction(HLT, next, 'x'.repeat(1001))).toEqual({ ok: false, error: 'The reason is too long' });
    expect(await cancelOrderAction(HLT, next, 42 as never)).toEqual({ ok: false, error: 'Give the reason for the cancellation' });
    expect(await cancelOrderAction(HLT, 'PO-x', REASON)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await cancelOrderAction('hlt-026', next, REASON)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await cancelOrderAction(HLT, 'PO-9999', REASON)).toEqual({ ok: false, error: 'Unknown purchase order' });
    expect(await cancelOrderAction('NDC-031', next, REASON)).toEqual({ ok: false, error: 'Unknown purchase order' });
    // The PM of HLT-026 is not on NDC-031's team: its orders are read-only for him.
    as('pm');
    expect(await cancelOrderAction('NDC-031', next, REASON)).toEqual({ ok: false, error: 'Purchase orders are read-only for you' });
    // The writer re-checks the rule with the actor: the quality manager (referent of HLT-026, not a lead) may not cancel.
    await expect(cancelPurchaseOrder(drafts[4] ?? drafts[1], REASON, 'Gabriel Comte')).rejects.toMatchObject({ code: drafts[4] ? 'not_allowed' : 'stale' });
  });

  it('an RFQ award’s draft cancelled: the RFQ stays awarded and its footnote says the order was cancelled', async () => {
    const comparing = (await listRfqs()).find((r) => r.status === 'comparing' && r.quotes.length && r.partRef && r.quantity != null);
    expect(comparing, 'an RFQ in Comparing with a part and a quantity').toBeTruthy();
    if (!comparing) return;
    const { purchaseOrderNumber } = await awardRfq(comparing.number, comparing.quotes[0].supplier, 'Fabien Bertrand');
    expect(purchaseOrderNumber).toBeTruthy();
    const po = (await getPurchaseOrder(purchaseOrderNumber!))!;
    as('procurement');
    expect((await cancelOrderAction(po.projectCode, po.number, 'Quote expired')).ok).toBe(true);
    const r = (await getRfq(comparing.number))!;
    expect([r.status, r.purchaseOrderNumber, r.purchaseOrderStatus]).toEqual(['awarded', po.number, 'cancelled']);
    const v = rfqDrawerView(r, { t: procT(makeT('en'), 'en'), lang: 'en', role: 'procurement', canEdit: true, prices: true, orderProject: po.projectCode, currentProject: HLT });
    expect(v.footnote).toContain(`purchase order ${po.number} cancelled before it was placed.`);
  });

  it('the internal PO summary (PDF) of a cancelled order gives why, by whom and when', async () => {
    const ctx = await buildExportContext({ screen: 'orders', viewer: PERSONA_BY_ROLE.procurement, lang: 'en', params: new URLSearchParams(`code=${HLT}&variant=po&id=${drafts[0]}`), now: new Date() });
    const text = pdfTextLines((await runExport(ctx, 'pdf', { compressPdf: false })).body).join('\n');
    expect(text).toContain(`Purchase order summary ${drafts[0]}`);
    expect(text).toContain('Cancelled');
    expect(text).toContain(`Fabien Bertrand · ${REASON.slice(0, 13)}`); // the PDF wraps the long reason
  });
});
