// Deliveries Server Functions against an in-memory seeded database: permission gates (read-only / outside, QC roles,
// receipts of another project, forged input), Announce a delivery (listed, BL-2026-0600…, what is still to come),
// Register receipt (short delivery), the quality decision (accept → stock, reject → quarantine, per article), the
// My approvals inline decision and the "Delivery — quality check" provider on the database, Attach delivery note.
// The viewer is the actor everywhere. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Gabriel Comte', role: 'quality' as string, canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }), getLastProject: async () => 'HLT-026' };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: () => viewer.canEdit }),
  getScreenAccess: async () => ({ viewer: { name: viewer.name, role: viewer.role }, outside: !viewer.canEdit, canEdit: viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { getApprovalInbox } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getDeliveriesScreen, getReceipt, listAnnounceableOrders, receiptsQcPendingByProject } from '@/server/dal/deliveries';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getPurchaseOrder } from '@/server/dal/purchasing';
import { listStock } from '@/server/dal/stock';
import {
  acceptReceiptAction, announceDeliveryAction, attachDeliveryNoteAction, decideReceiptFromInboxAction, recordPartialQcAction, registerReceiptAction, rejectReceiptAction,
} from './actions';

const as = (role: string, name: string) => Object.assign(viewer, { role, name });
const stockAt = async (ref: string, location: string) => (await listStock()).find((s) => s.ref === ref && s.location === location);

describe('deliveries Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('quality', 'Gabriel Comte');
    viewer.canEdit = true;
    viewer.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses read-only / outside viewers, non-QC roles for decisions, unknown or foreign receipts and forged input', async () => {
    viewer.canEdit = false;
    expect(await acceptReceiptAction('HLT-026', 'BL-2026-0521')).toEqual({ ok: false, error: 'This delivery register is read-only for you' });
    expect(await announceDeliveryAction('HLT-026', { po: 'PO-1052' })).toEqual({ error: 'This delivery register is read-only for you' });
    expect(await registerReceiptAction('HLT-026', 'BL-2026-0540', {})).toEqual({ error: 'This delivery register is read-only for you' });
    viewer.lang = 'fr';
    expect(await rejectReceiptAction('HLT-026', 'BL-2026-0521')).toEqual({ ok: false, error: 'Ce registre des livraisons est en consultation pour vous' });
    viewer.canEdit = true;
    as('pm', 'Romain Aubert');
    expect(await acceptReceiptAction('HLT-026', 'BL-2026-0521')).toEqual({ ok: false, error: 'Les décisions qualité reviennent au responsable qualité et aux achats' });
    viewer.lang = 'en';
    expect(await recordPartialQcAction('HLT-026', 'BL-2026-0521', {})).toEqual({ ok: false, error: 'Quality decisions belong to the quality manager and procurement' });
    as('quality', 'Gabriel Comte');
    expect(await acceptReceiptAction('NOPE-000', 'BL-2026-0521')).toEqual({ ok: false, error: 'Unknown project' });
    expect(await acceptReceiptAction('' as string, 'BL-2026-0521')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await acceptReceiptAction('HLT-026', "BL-2026-0521'; --")).toEqual({ ok: false, error: 'Invalid request' });
    expect(await acceptReceiptAction('HLT-026', 42 as never)).toEqual({ ok: false, error: 'Invalid request' });
    // A receipt of another project is not found on this one.
    expect(await acceptReceiptAction('HLT-026', 'BL-2026-0331')).toEqual({ ok: false, error: 'Unknown delivery' });
    expect(await acceptReceiptAction('HLT-026', 'BL-2026-0540')).toEqual({ ok: false, error: 'This delivery is no longer waiting for a quality check' });
    expect(await registerReceiptAction('HLT-026', 'BL-2026-0521', {})).toEqual({ error: 'This delivery is no longer waiting to be received' });
    expect((await getReceipt('BL-2026-0521'))!.status).toBe('qc_pending');
  });

  it('Announce a delivery: listed at once (BL-2026-0600), for what is still to come; the viewer in the audit trail', async () => {
    as('procurement', 'Fabien Bertrand');
    expect((await listAnnounceableOrders('HLT-026')).map((o) => [o.number, o.lines.map((l) => `${l.ref}×${l.qty}`).join(',')])).toEqual([
      ['PO-1052', 'EQ-CRN-250T×2'], ['PO-1063', 'EL-SWG-11KV×2'], ['PO-1071', 'LT-HB-200W×260'],
    ]);
    expect(await announceDeliveryAction('HLT-026', { po: 'PO-1078' })).toEqual({ error: 'Choose a purchase order that is waiting for goods' });
    expect(await announceDeliveryAction('HLT-026', { po: 'PO-1052', expected: 'next week' })).toEqual({ error: 'Enter a date such as 14 Dec 2026' });
    expect(await announceDeliveryAction('HLT-026', { po: 'PO-1052', expected: '9 oct. 2026', carrier: 'Halvorsen logistics', location: 'Magasin chantier — Le Havre' })).toEqual({
      toast: 'Delivery BL-2026-0600 announced', number: 'BL-2026-0600',
    });
    const s = await getDeliveriesScreen('HLT-026');
    expect(s.receipts.map((r) => r.number).at(-1)).toBe('BL-2026-0600');
    const r = (await getReceipt('BL-2026-0600'))!;
    expect([r.status, r.poNumber, r.expectedOn, r.carrier, r.lines.map((l) => [l.ref, l.ordered, l.delivered, l.location]), r.qc.remarks]).toEqual([
      'announced', 'PO-1052', '2026-10-09', 'Halvorsen logistics', [['EQ-CRN-250T', 2, 0, 'Magasin chantier — Le Havre']], 'Announced by supplier',
    ]);
    expect(s.announceable.map((o) => o.number)).toEqual(['PO-1063', 'PO-1071']);
    expect((await listAudit())[0]).toMatchObject({ who: 'Fabien Bertrand', object: 'BL-2026-0600', area: 'Deliveries' });
    expect((await listActivity())[0]).toMatchObject({ who: 'Fabien Bertrand' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    viewer.lang = 'fr';
    expect(await announceDeliveryAction('HLT-026', { po: 'PO-1071' })).toEqual({ toast: 'Livraison BL-2026-0601 annoncée', number: 'BL-2026-0601' });
    expect((await getReceipt('BL-2026-0601'))!.expectedOn).toBe('2026-10-19');
    // Nothing left on a project without orders.
    expect(await announceDeliveryAction('EWA-051', { po: 'PO-1' })).toEqual({ error: 'Aucune commande passée n’attend de livraison' });
  });

  it('Register receipt: delivered quantities checked, short delivery recorded, the viewer as receiving clerk', async () => {
    as('procurement', 'Fabien Bertrand');
    expect(await registerReceiptAction('HLT-026', 'BL-2026-0601', { 'qty:LT-HB-200W': '300' })).toEqual({
      error: 'Delivered quantities must be whole numbers between 0 and the quantity announced',
    });
    expect(await registerReceiptAction('HLT-026', 'BL-2026-0601', { 'qty:LT-HB-200W': '0' })).toEqual({ error: 'Nothing was delivered' });
    viewer.lang = 'fr';
    expect(await registerReceiptAction('HLT-026', 'BL-2026-0601', { date: '24 sept. 2026', carrier: 'Geodis', note: 'BX-56001', 'qty:LT-HB-200W': '250' })).toEqual({
      toast: 'BL-2026-0601 reçue · contrôle qualité à faire',
    });
    const r = (await getReceipt('BL-2026-0601'))!;
    expect([r.status, r.receivedOn, r.carrier, r.supplierDeliveryNote, r.receivedBy, r.totals.delivered, r.qc]).toEqual([
      'qc_pending', '2026-09-24', 'Geodis', 'BX-56001', 'Fabien Bertrand', 250, { by: null, result: 'Pending', remarks: 'Received incomplete · inspection to do' },
    ]);
    viewer.lang = 'en';
    expect(await registerReceiptAction('HLT-026', 'BL-2026-0600', {})).toEqual({ toast: 'BL-2026-0600 received · quality check to do' });
    expect(await receiptsQcPendingByProject()).toMatchObject({ 'HLT-026': 3 });
  });

  it('Accept → stock with typed remarks (the viewer inspects); the order follows; what is still to come is announceable again', async () => {
    expect(await acceptReceiptAction('HLT-026', 'BL-2026-0600', '  Load test certificate checked ')).toEqual({ ok: true, status: 'Accepted', message: 'BL-2026-0600 · Accepted' });
    const r = (await getReceipt('BL-2026-0600'))!;
    expect([r.status, r.qc, r.totals.accepted]).toEqual(['accepted', { by: 'Gabriel Comte', result: 'Passed', remarks: 'Load test certificate checked' }, 2]);
    expect(await stockAt('EQ-CRN-250T', 'Magasin chantier — Le Havre')).toMatchObject({ onHand: 2 });
    expect((await getPurchaseOrder('PO-1052'))!.status).toBe('received');
    // Short delivery of PO-1071: 250 accepted, 10 still to come.
    viewer.lang = 'fr';
    expect(await acceptReceiptAction('HLT-026', 'BL-2026-0601')).toEqual({ ok: true, status: 'Acceptée', message: 'BL-2026-0601 · Acceptée' });
    expect((await getReceipt('BL-2026-0601'))!.qc.remarks).toBe('Conforming — released to stock');
    expect((await listAnnounceableOrders('HLT-026')).map((o) => [o.number, o.lines.map((l) => `${l.ref}×${l.qty}`).join(',')])).toEqual([
      ['PO-1063', 'EL-SWG-11KV×2'], ['PO-1071', 'LT-HB-200W×10'],
    ]);
    expect((await listAudit())[0]).toMatchObject({ who: 'Gabriel Comte', object: 'BL-2026-0601' });
  });

  it('Reject → quarantine (procurement); per article on NDC-031 → Partially rejected; invalid splits refused', async () => {
    as('procurement', 'Fabien Bertrand');
    // R-096 (NEW-D4-3 "a"): a rejection on the Deliveries screen reminds to declare the supplier NCR in Vigie.
    expect(await rejectReceiptAction('HLT-026', 'BL-2026-0521')).toEqual({
      ok: true, status: 'Rejected', message: 'BL-2026-0521 · Rejected · 2 rejected · declare the supplier NCR in Vigie',
    });
    const r = (await getReceipt('BL-2026-0521'))!;
    expect([r.qc.by, r.qc.result, r.qc.remarks, r.lines.map((l) => [l.rejected, l.location])]).toEqual([
      'Fabien Bertrand', 'Failed', 'Non-conforming — supplier notified', [[2, 'Zone quarantaine QC — Lyon']],
    ]);
    as('director', 'Marie Lefebvre');
    expect(await recordPartialQcAction('NDC-031', 'BL-2026-0331', { 'EL-CBL-XLPE': '10' })).toEqual({
      ok: false, error: 'Rejected quantities must be whole numbers between 0 and the quantity delivered',
    });
    expect(await recordPartialQcAction('NDC-031', 'BL-2026-0331', { 'EL-CBL-XLPE': '3', 'XX-1': '1' })).toEqual({ ok: false, error: 'Unknown article in the decision' });
    expect(await recordPartialQcAction('NDC-031', 'BL-2026-0331', { 'EL-CBL-XLPE': '3' }, 'Sheath damage on 3 drums')).toEqual({
      ok: true, status: 'Partially rejected', message: 'BL-2026-0331 · Partially rejected · 3 rejected · declare the supplier NCR in Vigie', // R-096
    });
    const p = (await getReceipt('BL-2026-0331'))!;
    expect([p.status, p.qc.by, p.qc.result, p.qc.remarks, p.lines.map((l) => [l.ref, l.accepted, l.rejected, l.location])]).toEqual([
      'partially_rejected', 'Marie Lefebvre', 'Failed on 3 units', 'Sheath damage on 3 drums',
      [['EL-CBL-XLPE', 6, 3, 'Entrepôt central — Lyon'], ['LT-HB-200W', 20, 0, 'Entrepôt central — Lyon']],
    ]);
  });

  it('My approvals: the provider reads the database; the inline decision accepts / rejects (no crash); only the QC roles', async () => {
    const inbox = async (role: 'quality' | 'procurement' | 'director', code = 'NDC-031') => getApprovalInbox(PERSONA_BY_ROLE[role], { projectCode: code, lang: 'en' });
    const items = (await inbox('quality')).items.filter((i) => i.kind === 'delivery');
    expect(items).toEqual([
      {
        kind: 'delivery', id: 'BL-2026-0332', title: 'Aeris Controls · ME-CRAC-60', sub: 'Inspection to schedule', who: 'Fabien Bertrand', when: '17 Nov', whenIso: '2026-11-17',
        href: '/projects/NDC-031/deliveries?receipt=BL-2026-0332', decision: { mode: 'delivery-qc', projectCode: 'NDC-031', number: 'BL-2026-0332' },
      },
    ]);
    expect((await inbox('director')).items.some((i) => i.kind === 'delivery')).toBe(false);
    const before = (await inbox('quality')).decided;
    as('director', 'Marie Lefebvre');
    expect(await decideReceiptFromInboxAction({ projectCode: 'NDC-031', number: 'BL-2026-0332', decision: 'ok' })).toEqual({ ok: false, error: 'Read-only — you cannot decide from this inbox' });
    as('quality', 'Gabriel Comte');
    expect(await decideReceiptFromInboxAction({ projectCode: 'NDC-031', number: 'BL-2026-0332', decision: 'maybe' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideReceiptFromInboxAction({ projectCode: 'NDC', number: 'BL-2026-0332', decision: 'ok' })).toEqual({ ok: false, error: 'Invalid request' });
    viewer.lang = 'fr'; // English result whatever the language: the inbox translates it.
    expect(await decideReceiptFromInboxAction({ projectCode: 'NDC-031', number: 'BL-2026-0332', decision: 'rejected' })).toEqual({ ok: true, status: 'Rejected', message: 'BL-2026-0332 · Rejected' });
    expect(await decideReceiptFromInboxAction({ projectCode: 'NDC-031', number: 'BL-2026-0332', decision: 'ok' })).toEqual({ ok: false, error: 'This delivery is no longer waiting for a quality check' });
    expect((await inbox('quality')).items.some((i) => i.kind === 'delivery')).toBe(false);
    // The viewer's quality checks on the current project count (BL-2026-0331 was the director's; HLT-026's do not count here).
    expect((await inbox('quality')).decided).toBe(before + 1);
    expect(await receiptsQcPendingByProject()).not.toHaveProperty('NDC-031');
    expect(await stockAt('ME-CRAC-60', 'Zone quarantaine QC — Lyon')).toMatchObject({ onHand: 6 });
  });

  it('Attach delivery note: the file name on the receipt (path stripped); an empty name refused', async () => {
    as('procurement', 'Fabien Bertrand');
    expect(await attachDeliveryNoteAction('HLT-026', 'BL-2026-0540', '  ')).toEqual({ ok: false, error: 'Choose a file to attach' });
    expect(await attachDeliveryNoteAction('HLT-026', 'BL-2026-0540', 'C:\\scans\\CF-DN-0921.pdf')).toEqual({ ok: true, message: 'C: scans CF-DN-0921.pdf attached to BL-2026-0540' });
    viewer.lang = 'fr';
    expect(await attachDeliveryNoteAction('HLT-026', 'BL-2026-0540', 'Delivery note CF-0921.pdf')).toEqual({ ok: true, message: 'Delivery note CF-0921.pdf joint à BL-2026-0540' });
    expect((await getReceipt('BL-2026-0540'))!.documents).toEqual(['C: scans CF-DN-0921.pdf', 'Delivery note CF-0921.pdf']);
    expect((await listAudit())[0]).toMatchObject({ who: 'Fabien Bertrand', object: 'BL-2026-0540' });
  });
});
