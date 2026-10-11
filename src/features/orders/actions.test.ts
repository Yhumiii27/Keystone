// Purchase orders Server Functions against an in-memory database: permission gate (read-only / outside viewers,
// approvers), input validation, the workflow of the prototype (BOM shortfall drafts → Send for approval → Approve &
// order; My approvals Approve / Reject) checked against the prototype's render values after each step
// (orders.golden.json drafts / flow), the Push to X3 local-change flag, and the viewer as the actor in the audit
// trail. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Fabien Bertrand', canEdit: true, inbox: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name }, canEdit: () => viewer.canEdit }),
  getScreenAccess: async () => ({ viewer: { name: viewer.name }, canEdit: viewer.inbox, outside: !viewer.inbox }),
}));

import { revalidatePath } from 'next/cache';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { makeT, type Lang } from '@/i18n/translate';
import { getApprovalInbox } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getOrdersScreen } from '@/server/dal/orders';
import { getPurchaseOrder } from '@/server/dal/purchasing';
import golden from './orders.golden.json';
import { approveOrderAction, createDraftOrdersAction, decidePurchaseOrderAction, pushOrderToX3Action, submitOrderAction } from './actions';
import { ordersView } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const view = async (lang: Lang = 'en', selected: string | null = null, code = 'HLT-026') =>
  ordersView({ code, data: await getOrdersScreen(code, viewer.name), filter: null, selected }, makeT(lang), lang);
const day = (s: string) => s.replace(/(^|· )0(\d)/g, '$1$2');
const lastAudit = async () => (await listAudit({ limit: 1 }))[0];

/** KPI tiles, chips and the order rows' status / dates / buttons against a prototype snapshot (EN). */
async function expectSnapshot(g: any) {
  const v = await view();
  expect(v.kpis.map((k) => [k.label, k.value, k.sub, k.color])).toEqual(g.kpis.map((k: any) => [k.label, String(k.value), k.sub, k.color]));
  expect(v.chips.map((c) => [c.label, String(c.count)])).toEqual(g.chips.map((c: any) => [c.label, c.count]));
  expect(v.rows.map((r) => [r.number, r.supplier, r.lineSummary, r.value, r.status, r.ordered, r.expected, r.need, r.canSubmit, r.canApprove])).toEqual(
    g.rows.map((r: any) => [r.id, r.supplier, r.lineSummary, r.value, r.status, day(r.ordered), day(r.expected), r.need, r.canSubmit, r.canApprove]),
  );
  return v;
}

describe('purchase orders Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.name = 'Fabien Bertrand';
    viewer.canEdit = true;
    viewer.inbox = true;
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses read-only viewers, malformed requests, unknown projects and orders of another project', async () => {
    viewer.canEdit = false;
    for (const r of [await createDraftOrdersAction('HLT-026'), await submitOrderAction('HLT-026', 'PO-1082'), await approveOrderAction('HLT-026', 'PO-1082'), await pushOrderToX3Action('HLT-026', 'PO-1041')])
      expect(r).toEqual({ ok: false, error: 'Purchase orders are read-only for you' });
    viewer.canEdit = true;
    expect(await createDraftOrdersAction('hlt-026')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await createDraftOrdersAction(42 as never)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await createDraftOrdersAction('NOP-999')).toEqual({ ok: false, error: 'Unknown project' });
    expect(await submitOrderAction('HLT-026', 'PO-x')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await submitOrderAction('HLT-026', 'PO-9999')).toEqual({ ok: false, error: 'Unknown purchase order' });
    expect(await submitOrderAction('NDC-031', 'PO-1082')).toEqual({ ok: false, error: 'Unknown purchase order' });
    expect(revalidatePath).not.toHaveBeenCalled();
    // Refusals because the order or the BOM moved on since the page was rendered refresh the stale rows / banner.
    expect(await submitOrderAction('HLT-026', 'PO-1082')).toEqual({ ok: false, error: 'This order is no longer a draft' });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(await createDraftOrdersAction('NDC-031')).toEqual({ ok: false, error: 'Every BOM article is already ordered' });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect((await getPurchaseOrder('PO-1082'))!.status).toBe('awaiting_approval');
  });

  it('"New purchase order": one draft per manufacturer of the BOM shortfall, as the prototype’s createDrafts; the banner goes', async () => {
    expect(await createDraftOrdersAction('HLT-026')).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const g = G.drafts.en['HLT-026'];
    const v = await expectSnapshot(g);
    expect(v.shortfall).toBeNull();
    // Each draft's drawer: the prototype's rows, plus the Sage X3 local-change flag (drafted in Keystone).
    for (const d of g.draftPOs as any[]) {
      const dr = (await view('en', d.id)).drawer!;
      // R-169: a shortfall draft has no terms yet ("To be agreed"; the prototype wrote "Site gate 2 · DAP · Net 30").
      const terms = (m: any) => (m.k === 'Delivery / terms' ? 'To be agreed' : m.v);
      expect(dr.meta.slice(0, 5).map((m) => [m.k, m.v])).toEqual(g.drawers[d.id].meta.map((m: any) => [m.k, terms(m)]));
      expect(dr.meta.slice(5).map((m) => [m.k, m.v, m.color])).toEqual([['Sage X3', 'Local change · not yet pushed to X3', 'var(--color-accent-300)']]);
      expect(dr.canPush).toBe(false); // not approved yet
    }
    expect((await view('fr', 'PO-1100')).drawer!.meta[5].v).toBe('Modification locale · pas encore envoyée vers X3');
    expect(await lastAudit()).toMatchObject({ who: 'Fabien Bertrand', area: 'Purchase orders' });
    expect(await createDraftOrdersAction('HLT-026')).toEqual({ ok: false, error: 'Every BOM article is already ordered' });
  });

  it('"Send for approval" → Awaiting approval; it reaches the PM’s and the director’s My approvals, submitted by the viewer', async () => {
    const first = G.flow.en.first as string;
    expect(await submitOrderAction('HLT-026', first)).toEqual({ ok: true });
    await expectSnapshot(G.flow.en.submitted);
    expect(await submitOrderAction('HLT-026', first)).toEqual({ ok: false, error: 'This order is no longer a draft' });
    const pm = (await getApprovalInbox(PERSONA_BY_ROLE.pm, { projectCode: 'HLT-026', lang: 'en' })).items.filter((i) => i.kind === 'po');
    expect(pm.map((i) => [i.id, i.title, i.sub, i.who, i.when, i.decision])).toEqual([
      ['PO-1082', 'Cotswold Fire Systems · €9k', 'FD-DET-OPT', 'Fabien Bertrand', '24 Sep', { mode: 'purchase-order', projectCode: 'HLT-026', number: 'PO-1082' }],
      [first, 'ArcelorMittal · €238k', 'KS-PLT-S355', 'Fabien Bertrand', '25 Sep', { mode: 'purchase-order', projectCode: 'HLT-026', number: first }],
    ]);
    expect((await getApprovalInbox(PERSONA_BY_ROLE.procurement, { projectCode: 'HLT-026', lang: 'en' })).items.filter((i) => i.kind === 'po')).toEqual([]);
  });

  it('"Approve & order": only the portfolio director or the project’s manager; then the order can be pushed to X3', async () => {
    const first = G.flow.en.first as string;
    expect(await approveOrderAction('HLT-026', first)).toEqual({ ok: false, error: 'Only the project manager or the portfolio director approves purchase orders' });
    viewer.name = 'Romain Aubert';
    expect(await approveOrderAction('HLT-026', first)).toEqual({ ok: true });
    await expectSnapshot(G.flow.en.approved);
    expect(await approveOrderAction('HLT-026', first)).toEqual({ ok: false, error: 'This order is no longer awaiting approval' });
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: first, change: 'status: Awaiting approval → Ordered' });

    const dr = (await view('en', first)).drawer!;
    expect(dr.steps.map((s) => [s.label, s.reached, s.current])).toEqual([['Draft', true, false], ['Approved', true, false], ['Ordered', true, true]]);
    expect(dr.canPush).toBe(true);
    viewer.name = 'Fabien Bertrand';
    expect(await pushOrderToX3Action('HLT-026', first)).toEqual({ ok: true, message: `${first} · Pushed to X3 · X3-${first}` });
    const pushed = (await view('en', first)).drawer!;
    expect([pushed.canPush, pushed.meta.at(-1)!.v, pushed.meta.at(-1)!.color]).toEqual([false, `Pushed to X3 · X3-${first}`, 'var(--color-text)']);
    expect(await lastAudit()).toMatchObject({ who: 'Fabien Bertrand', object: first, change: `pushed to Sage X3 · X3-${first}` });
    expect(await pushOrderToX3Action('HLT-026', first)).toEqual({ ok: false, error: 'Only an approved order drafted in Keystone can be pushed to X3' });
    expect(await pushOrderToX3Action('HLT-026', 'PO-1041')).toEqual({ ok: false, error: 'Only an approved order drafted in Keystone can be pushed to X3' });
    expect(await pushOrderToX3Action('HLT-026', 'PO-1101')).toEqual({ ok: false, error: 'Only an approved order drafted in Keystone can be pushed to X3' });
  });

  it('My approvals Approve / Reject: inbox gate, approver only, stale rows; Reject cancels (Cancelled reaches nothing)', async () => {
    viewer.inbox = false;
    expect(await decidePurchaseOrderAction({ projectCode: 'HLT-026', number: 'PO-1082', decision: 'rejected' })).toEqual({ ok: false, error: 'Read-only — you cannot decide from this inbox' });
    viewer.inbox = true;
    expect(await decidePurchaseOrderAction({ projectCode: 'HLT-026', number: 'PO-1082', decision: 'maybe' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decidePurchaseOrderAction({ projectCode: 'HLT-026', number: 'PO-1082', decision: 'rejected' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    viewer.name = 'Marie Lefebvre';
    expect(await decidePurchaseOrderAction({ projectCode: 'NDC-031', number: 'PO-1082', decision: 'rejected' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    expect(await decidePurchaseOrderAction({ projectCode: 'HLT-026', number: 'PO-1082', decision: 'rejected' })).toEqual({ ok: true, status: 'Cancelled' });
    expect(await lastAudit()).toMatchObject({ who: 'Marie Lefebvre', object: 'PO-1082', change: 'status: Awaiting approval → Cancelled' });
    const g = G.flow.en.cancelled;
    const v = await view('en', 'PO-1082');
    const row = v.rows.find((r) => r.number === 'PO-1082')!;
    const gRow = g.rows.find((r: any) => r.id === 'PO-1082');
    expect([row.status, row.statusClass, row.canApprove, row.risk]).toEqual([gRow.status, gRow.tagClass, gRow.canApprove, gRow.risk]);
    expect(v.drawer!.steps.map((s) => s.reached)).toEqual(g.drawers['PO-1082'].steps.map((s: any) => s.dot === 'var(--color-accent)'));
    // A cancelled order no longer covers the BOM: FD-DET-OPT is short again (banner back).
    expect(v.shortfall!.chips).toEqual(['FD-DET-OPT · 180 to order']);
    expect(await decidePurchaseOrderAction({ projectCode: 'HLT-026', number: 'PO-1082', decision: 'ok' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    expect((await getApprovalInbox(PERSONA_BY_ROLE.director, { projectCode: 'HLT-026', lang: 'en' })).items.filter((i) => i.kind === 'po')).toEqual([]);
  });

  it('My approvals Approve on another project: the director orders WSA-044’s PO-5141', async () => {
    viewer.name = 'Marie Lefebvre';
    expect(await decidePurchaseOrderAction({ projectCode: 'WSA-044', number: 'PO-5141', decision: 'ok' })).toEqual({ ok: true, status: 'Ordered' });
    expect((await getPurchaseOrder('PO-5141'))!).toMatchObject({ status: 'ordered', decidedBy: 'Marie Lefebvre' });
  });
});
