// Sourcing Server Functions against an in-memory database: the workspace gate (outside viewers refused), the award and
// invoice-decision role rules (P-5), the state guards of every action, the New RFQ form parsing (numbering, current
// project, viewer as buyer), the drafted purchase order of an award, the My approvals queues and "Decided this week"
// following the decisions, and the viewer recorded in the audit trail. Session and screen access are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr', project: 'HLT-026' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }), getLastProject: async () => viewer.project };
});
vi.mock('@/server/project-context', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { canSee } = await import('@/config/screens');
  return { getScreenAccess: async () => ({ viewer: PERSONA_BY_ROLE[viewer.role], outside: !canSee(viewer.role, 'procurement'), canEdit: canSee(viewer.role, 'procurement') }) };
});

import { revalidatePath } from 'next/cache';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getPurchaseOrder, getRfq, getSupplierInvoice, listRfqs } from '@/server/dal/purchasing';
import { getApprovalInbox } from '@/server/approvals';
import {
  approveInvoiceAction, approveInvoicePartAction, awardRfqAction, compareRfqAction, createRfqAction, rejectInvoiceAction, sendRfqAction,
} from './actions';

const inbox = async (role: RoleKey) => getApprovalInbox(PERSONA_BY_ROLE[role], { projectCode: 'HLT-026', lang: 'en' });
const ids = async (role: RoleKey, kind: string) => (await inbox(role)).items.filter((i) => i.kind === kind).map((i) => i.id);

describe('Sourcing Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.role = 'director';
    viewer.lang = 'en';
    viewer.project = 'HLT-026';
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses viewers outside the workspace (EN and FR) and malformed requests, without writing', async () => {
    viewer.role = 'quality';
    expect(await sendRfqAction('RFQ-2026-034')).toEqual({ error: 'Sourcing is read-only for you' });
    expect(await createRfqAction({ title: 'x', suppliers: 'y', articles: 'z' })).toEqual({ error: 'Sourcing is read-only for you' });
    expect(await rejectInvoiceAction('INV-LE-2210')).toEqual({ error: 'Sourcing is read-only for you' });
    viewer.lang = 'fr';
    expect(await awardRfqAction('RFQ-2026-031', 'Dillinger')).toEqual({ error: 'Les consultations et factures sont en consultation seule pour vous' });
    viewer.role = 'procurement';
    viewer.lang = 'en';
    expect(await sendRfqAction(42 as never)).toEqual({ error: 'Invalid request' });
    expect(await sendRfqAction('RFQ-2026-999')).toEqual({ error: 'Unknown RFQ' });
    expect(await awardRfqAction('RFQ-2026-031', '')).toEqual({ error: 'Invalid request' });
    expect(await approveInvoiceAction('INV-NOPE')).toEqual({ error: 'Unknown invoice' });
    expect((await getRfq('RFQ-2026-034'))!.status).toBe('draft');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('"New RFQ": validation, RFQ-2026-035 on the current project, Open, the viewer as buyer; toast with the number', async () => {
    viewer.role = 'procurement';
    expect(await createRfqAction({ title: ' ', suppliers: 'ArcelorMittal', articles: 'x' })).toEqual({ error: 'The title is required' });
    expect(await createRfqAction({ title: 'Plates', suppliers: 'ArcelorMittal', articles: 'x', due: 'soon' })).toEqual({ error: 'Enter the reply date as a date (e.g. 15 Oct 2026)' });
    viewer.lang = 'fr';
    expect(await createRfqAction({ title: 'Plates', suppliers: ' ', articles: 'x' })).toEqual({ error: 'Indiquez au moins un fournisseur' });
    expect(await createRfqAction({ title: 'Plates', suppliers: 'ArcelorMittal, Dillinger', articles: 'KS-PLT-S355 × 192', due: '20 oct. 2026', incoterm: 'FCA' })).toEqual({
      toast: 'Consultation envoyée aux fournisseurs · RFQ-2026-035',
    });
    const r = (await getRfq('RFQ-2026-035'))!;
    expect([r.title, r.status, r.owner, r.projectCode, r.partRef, r.quantity, r.replyDueOn, r.incoterm, r.invitedSuppliers, r.articlesText]).toEqual([
      'Plates', 'open', 'Fabien Bertrand', 'HLT-026', 'KS-PLT-S355', null, '2026-10-20', 'FCA', ['ArcelorMittal', 'Dillinger'], 'KS-PLT-S355 × 192',
    ]);
    expect((await listRfqs())[0].number).toBe('RFQ-2026-035');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    // Default reply date and Incoterm.
    viewer.lang = 'en';
    expect(await createRfqAction({ title: 'Cable glands', suppliers: 'Lincoln Electric', articles: 'Glands M25' })).toEqual({ toast: 'RFQ sent to suppliers · RFQ-2026-036' });
    expect([(await getRfq('RFQ-2026-036'))!.replyDueOn, (await getRfq('RFQ-2026-036'))!.incoterm, (await getRfq('RFQ-2026-036'))!.partRef]).toEqual(['2026-10-15', 'DAP', null]);
  });

  it('"Send to suppliers" and "Compare quotes" follow the status rules', async () => {
    viewer.role = 'pm';
    expect(await compareRfqAction('RFQ-2026-034')).toEqual({ error: 'This RFQ cannot be compared now' });
    expect(await sendRfqAction('RFQ-2026-034')).toEqual({ ok: true });
    expect((await getRfq('RFQ-2026-034'))!.status).toBe('open');
    expect(await sendRfqAction('RFQ-2026-034')).toEqual({ error: 'This RFQ has already been sent' });
    // Open without two quotes: cannot be compared.
    expect(await compareRfqAction('RFQ-2026-034')).toEqual({ error: 'This RFQ cannot be compared now' });
    expect(await compareRfqAction('RFQ-2026-033')).toEqual({ ok: true });
    expect((await getRfq('RFQ-2026-033'))!.status).toBe('comparing');
    // Now two RFQs wait for the award, for the project manager and procurement (not the director).
    expect(await ids('pm', 'rfq')).toEqual(['RFQ-2026-031', 'RFQ-2026-033']);
    expect(await ids('procurement', 'rfq')).toEqual(['RFQ-2026-031', 'RFQ-2026-033']);
    expect(await ids('director', 'rfq')).toEqual([]);
    const audit = (await listAudit()).filter((a) => a.object === 'RFQ-2026-033');
    expect(audit[0]).toMatchObject({ who: 'Romain Aubert', change: 'status: Open → Comparing' });
  });

  it('"Award": the project manager awards RFQ-2026-031 to Dillinger — draft PO on Harbor Line, leaves the queues, decided', async () => {
    viewer.role = 'pm';
    expect(await awardRfqAction('RFQ-2026-031', 'Unknown Steel')).toEqual({ error: 'This supplier has not quoted' });
    const res = await awardRfqAction('RFQ-2026-031', 'Dillinger');
    expect(res).toMatchObject({ ok: true });
    const po = (res as { toast?: string }).toast!.split(' · ')[1];
    expect((res as { toast?: string }).toast).toBe(`Purchase order created as draft · ${po}`);
    const order = (await getPurchaseOrder(po))!;
    expect([order.projectCode, order.supplier, order.status, order.createdBy, order.lines.map((l) => [l.ref, l.orderedQty, l.unitPriceEur])]).toEqual([
      'HLT-026', 'Dillinger', 'draft', 'Romain Aubert', [['KS-STL-0450', 192, 1195]],
    ]);
    const r = (await getRfq('RFQ-2026-031'))!;
    expect([r.status, r.awardedTo, r.awardedBy, r.purchaseOrderNumber]).toEqual(['awarded', 'Dillinger', 'Romain Aubert', po]);
    expect(await awardRfqAction('RFQ-2026-031', 'Salzgitter')).toEqual({ error: 'This RFQ is not ready to award' });
    expect(await ids('pm', 'rfq')).toEqual(['RFQ-2026-033']);
    expect((await inbox('pm')).decided).toBeGreaterThanOrEqual(1);
    const before = (await inbox('procurement')).decided;
    // Procurement awards the other one: decided for procurement only.
    viewer.role = 'procurement';
    expect(await awardRfqAction('RFQ-2026-033', 'Siemens')).toMatchObject({ ok: true });
    expect(await ids('procurement', 'rfq')).toEqual([]);
    expect((await inbox('procurement')).decided).toBe(before + 1);
  });

  it('invoice decisions: refused to the project manager; procurement approves the received part; the director rejects', async () => {
    viewer.role = 'pm';
    expect(await approveInvoicePartAction('INV-HC-7781')).toEqual({ error: 'Supplier invoices are decided by procurement or the portfolio director' });
    expect(await rejectInvoiceAction('INV-LE-2210')).toEqual({ error: 'Supplier invoices are decided by procurement or the portfolio director' });
    viewer.role = 'procurement';
    // Not matched for a full approval (receipt short): refused.
    expect(await approveInvoiceAction('INV-HC-7781')).toEqual({ error: 'This invoice is not matched for this approval' });
    expect(await approveInvoicePartAction('INV-NV-1190')).toEqual({ error: 'This invoice is not matched for this approval' });
    expect(await ids('procurement', 'invoice')).toEqual(['INV-HC-7781', 'INV-BX-55120', 'INV-LE-2210']);
    expect(await approveInvoicePartAction('INV-HC-7781')).toEqual({ ok: true });
    const hc = (await getSupplierInvoice('INV-HC-7781'))!;
    expect([hc.status, hc.amountEur, hc.creditNoteEur, hc.decidedBy]).toEqual(['approved_for_payment', 1259600, 26800, 'Fabien Bertrand']);
    expect(await rejectInvoiceAction('INV-HC-7781')).toEqual({ error: 'This invoice can no longer be rejected' });
    expect(await ids('procurement', 'invoice')).toEqual(['INV-BX-55120', 'INV-LE-2210']);
    expect(await ids('director', 'invoice')).toEqual(['INV-BX-55120', 'INV-LE-2210']);
    expect((await inbox('procurement')).decided).toBeGreaterThanOrEqual(1);

    viewer.role = 'director';
    expect(await rejectInvoiceAction('INV-LE-2210')).toEqual({ ok: true });
    expect((await getSupplierInvoice('INV-LE-2210'))!.status).toBe('rejected');
    expect(await rejectInvoiceAction('INV-LE-2210')).toEqual({ error: 'This invoice can no longer be rejected' });
    expect(await ids('director', 'invoice')).toEqual(['INV-BX-55120']);
    const audit = (await listAudit()).filter((a) => a.object === 'INV-LE-2210');
    expect(audit[0]).toMatchObject({ who: 'Marie Lefebvre' });
    expect(audit[0].change).toContain('No PO → Rejected');
  });
});
