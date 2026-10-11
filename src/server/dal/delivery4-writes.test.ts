// Delivery 4 database layer — writers on an in-memory PGlite: purchase orders (shortfall drafts, approval circuit),
// RFQs (send, compare, award → draft PO, new RFQ), goods receipts (announce, register, accept / reject / per line with
// the stock, order and invoice effects), supplier invoices (3-way match decisions), stock movements and the mock Sage
// X3 exchange, the catalogue (new part, equivalent, BOM line), the PDM vault sync and the progress recorded on Vigie
// ECOs (outbox "pending sync with Vigie", mock and HTTP connectors). Each write appends an audit row with the viewer.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { canSee, type RoleKey } from '@/config/screens';
import { sql } from 'drizzle-orm';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { seedIfEmpty } from '@/server/db/seed';
import { getVigieEcoConnector, httpEcoConnector, mockEcoConnector, resetVigieRefreshThrottle } from '@/server/integrations/vigie/eco-connector';
import { vigieEcoListUrl, vigieEcoUrl, vigieNewEcoUrl } from '@/server/integrations/vigie/links';
import { ECO_SCREEN_ROLES } from '@/server/integrations/vigie/progress';
import type { VigieEcoRecord } from '@/server/integrations/vigie/types';
import { addBomLine, getProjectBom } from './bom';
import { acceptReceipt, announceDelivery, attachReceiptDocument, getReceipt, listReceipts, recordReceiptQc, registerReceipt, rejectReceipt } from './deliveries';
import { getVaultSyncState, syncPdmVault } from './drawings';
import { ecoApprovalQueue, getEco, listEcos, recordEcoProgress } from './eco';
import { listAudit } from './notifications';
import { createPart, getPart, getPartRecord, registerEquivalent } from './parts';
import {
  approveInvoicePayment, approveInvoiceReceivedPart, approvePurchaseOrder, awardRfq, compareRfqQuotes, createDraftPurchaseOrders, createRfq, getBomShortfall, getPurchaseOrder,
  getRfq, getSupplierInvoice, listPurchaseOrders, listRfqs, rejectPurchaseOrder, rejectSupplierInvoice, sendRfq, submitPurchaseOrder,
} from './purchasing';
import { applyStockMovement, getX3StockSync, importStockFromX3, listStock, listStockMovements, pushStockToX3 } from './stock';
import golden from './delivery4.golden.json';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const lastAudit = async () => (await listAudit({ limit: 1 }))[0];
const stockOf = async (ref: string, loc: string) => (await listStock()).find((s) => s.ref === ref && s.location === loc);

describe('purchase orders', () => {
  it('"Create draft POs by supplier" on HLT-026 reproduces createDrafts: 13 drafts PO-1100…PO-1112 at list price, shortfall cleared', async () => {
    const numbers = await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand');
    const pos = await listPurchaseOrders('HLT-026');
    const drafts = pos.filter((o) => numbers.includes(o.number));
    expect(drafts.map((o) => [o.number, o.supplier, o.lines.map((l) => [l.ref, l.orderedQty, l.receivedQty])])).toEqual(G.ordersAfterDrafts.drafts.map((d: any) => [d.id, d.supplier, d.lines]));
    expect(drafts.every((o) => o.status === 'draft' && o.orderedOn === '2026-09-25' && o.expectedOn === null && o.origin === 'shortfall' && o.createdBy === 'Fabien Bertrand')).toBe(true);
    expect([pos.filter((o) => !['received', 'cancelled'].includes(o.status)).length, pos.length]).toEqual([18, 19]);
    expect((await getBomShortfall('HLT-026')).lines).toEqual([]);
    expect(await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand')).toEqual([]);
    const audit = await listAudit({ limit: 13 });
    expect(audit.map((a) => a.object).sort()).toEqual(numbers);
    expect(audit.every((a) => a.who === 'Fabien Bertrand' && a.area === 'Purchase orders')).toBe(true);
  });

  it('approval circuit: send for approval, approve by the PM or the director only, reject cancels', async () => {
    await submitPurchaseOrder('PO-1100', 'Fabien Bertrand');
    await expect(submitPurchaseOrder('PO-1100', 'Fabien Bertrand')).rejects.toThrow(/not a draft/);
    await expect(approvePurchaseOrder('PO-1100', 'Fabien Bertrand')).rejects.toThrow(/project manager or the portfolio director/);
    await expect(approvePurchaseOrder('PO-1100', 'S. Perrin')).rejects.toThrow(/project manager or the portfolio director/);
    await approvePurchaseOrder('PO-1100', 'Romain Aubert');
    const po = (await getPurchaseOrder('PO-1100'))!;
    expect([po.status, po.submittedBy, po.decidedBy]).toEqual(['ordered', 'Fabien Bertrand', 'Romain Aubert']);
    await rejectPurchaseOrder('PO-1082', 'Marie Lefebvre');
    expect((await getPurchaseOrder('PO-1082'))!.status).toBe('cancelled');
    // A cancelled order no longer covers the BOM: FD-DET-OPT is short again.
    expect((await getBomShortfall('HLT-026')).lines.map((l) => [l.ref, l.need])).toEqual([['FD-DET-OPT', 180]]);
    expect(await lastAudit()).toMatchObject({ who: 'Marie Lefebvre', object: 'PO-1082', change: 'status: Awaiting approval → Cancelled' });
  });
});

describe('RFQs', () => {
  it('send, compare (2 quotes or more), award by an allowed role → draft PO at the quoted price', async () => {
    await sendRfq('RFQ-2026-034', 'Fabien Bertrand');
    expect((await getRfq('RFQ-2026-034'))!.status).toBe('open');
    await expect(compareRfqQuotes('RFQ-2026-034', 'Fabien Bertrand')).rejects.toThrow(/at least two quotes/);
    await compareRfqQuotes('RFQ-2026-033', 'Fabien Bertrand');
    expect((await getRfq('RFQ-2026-033'))!.status).toBe('comparing');
    await expect(awardRfq('RFQ-2026-031', 'Dillinger', 'Gabriel Comte')).rejects.toThrow(/project manager, procurement or the director/);
    await expect(awardRfq('RFQ-2026-031', 'Nobody', 'Fabien Bertrand')).rejects.toThrow(/has not quoted/);
    const { purchaseOrderNumber } = await awardRfq('RFQ-2026-031', 'Dillinger', 'Fabien Bertrand');
    expect(purchaseOrderNumber).toBe('PO-1113');
    const r = (await getRfq('RFQ-2026-031'))!;
    expect([r.status, r.awardedTo, r.awardedBy, r.purchaseOrderNumber]).toEqual(['awarded', 'Dillinger', 'Fabien Bertrand', 'PO-1113']);
    const po = (await getPurchaseOrder('PO-1113'))!;
    expect([po.projectCode, po.supplier, po.origin, po.status, po.lines.map((l) => [l.ref, l.orderedQty, l.unitPriceEur]), po.valueEur]).toEqual(['HLT-026', 'Dillinger', 'rfq', 'draft', [['KS-STL-0450', 192, 1195]], 229440]);
    await expect(awardRfq('RFQ-2026-031', 'Salzgitter', 'Fabien Bertrand')).rejects.toThrow(/not ready to award/);
  });

  it('New RFQ → RFQ-2026-035, sent (Open), listed first, the viewer as buyer', async () => {
    await expect(createRfq({ title: '', suppliers: 'A', articles: 'X', replyDueOn: '2026-10-15' }, 'Fabien Bertrand')).rejects.toThrow(/title/);
    await expect(createRfq({ title: 'T', suppliers: ' ', articles: 'X', replyDueOn: '2026-10-15' }, 'Fabien Bertrand')).rejects.toThrow(/supplier/);
    const n = await createRfq({ title: 'Gearbox spares', suppliers: 'SEW-Eurodrive, Flender', articles: 'CR-MOT-15K × 4', replyDueOn: '2026-10-15', incoterm: 'FCA' }, 'Fabien Bertrand');
    expect(n).toBe('RFQ-2026-035');
    const [first] = await listRfqs();
    expect([first.number, first.status, first.owner, first.partRef, first.quantity, first.incoterm, first.invitedSuppliers, first.awardRule]).toEqual(['RFQ-2026-035', 'open', 'Fabien Bertrand', 'CR-MOT-15K', null, 'FCA', ['SEW-Eurodrive', 'Flender'], 'pm_decides']);
  });
});

describe('goods receipts', () => {
  it('announce a delivery (listed, BL-2026-0600), register it, accept it → stock at the put-away, order received', async () => {
    await expect(announceDelivery('EWA-051', {}, 'Fabien Bertrand')).rejects.toThrow(/No ordered purchase order/);
    const n = await announceDelivery('HLT-026', {}, 'Fabien Bertrand');
    expect(n).toBe('BL-2026-0600');
    let r = (await getReceipt(n))!;
    expect([r.poNumber, r.status, r.lines.map((l) => [l.ref, l.ordered, l.delivered, l.location]), r.qc.remarks]).toEqual(['PO-1100', 'announced', [['KS-PLT-S355', 192, 0, 'Magasin chantier — Le Havre']], 'Announced by supplier']);
    expect((await listReceipts('HLT-026')).map((x) => x.number).at(-1)).toBe('BL-2026-0600');
    await registerReceipt(n, { carrier: 'Geodis' }, 'Hélène Sauvage');
    r = (await getReceipt(n))!;
    expect([r.status, r.receivedOn, r.carrier, r.receivedBy, r.qc]).toEqual(['qc_pending', '2026-09-25', 'Geodis', 'Hélène Sauvage', { by: null, result: 'Pending', remarks: 'Received complete · inspection to do' }]);
    expect(await acceptReceipt(n, { remarks: '' }, 'Gabriel Comte')).toBe('accepted');
    r = (await getReceipt(n))!;
    expect([r.status, r.qc.by, r.qc.result, r.qc.remarks, r.totals.accepted]).toEqual(['accepted', 'Gabriel Comte', 'Passed', 'Conforming — released to stock', 192]);
    expect(await stockOf('KS-PLT-S355', 'Magasin chantier — Le Havre')).toMatchObject({ onHand: 192, source: 'local' });
    expect((await getPurchaseOrder('PO-1100'))!.status).toBe('received');
    expect((await listStockMovements({ limit: 1 }))[0]).toMatchObject({ type: 'receipt', ref: 'KS-PLT-S355', qty: 192, where: 'BL-2026-0600 → Magasin chantier — Le Havre', who: 'Gabriel Comte', pendingPush: true });
    await attachReceiptDocument(n, 'Delivery note AM-1.pdf', 'Hélène Sauvage');
    expect((await getReceipt(n))!.documents).toEqual(['Delivery note AM-1.pdf']);
  });

  it('accepting BL-2026-0521 (held in quarantine) releases it to the central warehouse and lets INV-NV-1190 be approved', async () => {
    expect((await getSupplierInvoice('INV-NV-1190'))!.canApprove).toBe(false);
    expect(await acceptReceipt('BL-2026-0521', { remarks: 'Oil sample OK' }, 'Gabriel Comte')).toBe('accepted');
    const r = (await getReceipt('BL-2026-0521'))!;
    expect(r.lines.map((l) => [l.ref, l.accepted, l.location])).toEqual([['EL-TRF-2MVA', 2, 'Entrepôt central — Lyon']]);
    expect(await stockOf('EL-TRF-2MVA', 'Zone quarantaine QC — Lyon')).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await stockOf('EL-TRF-2MVA', 'Entrepôt central — Lyon')).toMatchObject({ onHand: 2, reserved: 2, reservedForShort: 'HLT' });
    expect((await getPurchaseOrder('PO-1063'))!.status).toBe('partially_received');
    const inv = (await getSupplierInvoice('INV-NV-1190'))!;
    expect([inv.receiptAmountEur, inv.match, inv.canApprove]).toEqual([248000, { po: 'ok', gr: 'ok' }, true]);
    await approveInvoicePayment('INV-NV-1190', 'Fabien Bertrand');
    expect((await getSupplierInvoice('INV-NV-1190'))!.status).toBe('approved_for_payment');
    await expect(acceptReceipt('BL-2026-0521', {}, 'Gabriel Comte')).rejects.toThrow(/not waiting for a quality check/);
  });

  it('reject → quarantine; per-line QC → partially rejected; invalid splits refused', async () => {
    expect(await rejectReceipt('BL-2026-0331', {}, 'Gabriel Comte')).toBe('rejected');
    const r = (await getReceipt('BL-2026-0331'))!;
    expect([r.qc.result, r.qc.remarks, r.lines.map((l) => [l.ref, l.rejected, l.location])]).toEqual(['Failed', 'Non-conforming — supplier notified', [['EL-CBL-XLPE', 9, 'Zone quarantaine QC — Lyon'], ['LT-HB-200W', 20, 'Zone quarantaine QC — Lyon']]]);
    expect(await stockOf('LT-HB-200W', 'Zone quarantaine QC — Lyon')).toMatchObject({ onHand: 20 });
    await expect(recordReceiptQc('BL-2026-0332', { lines: [{ ref: 'ME-CRAC-60', accepted: 4, rejected: 1 }] }, 'Gabriel Comte')).rejects.toThrow(/must equal the 6 delivered/);
    expect(await recordReceiptQc('BL-2026-0332', { lines: [{ ref: 'ME-CRAC-60', accepted: 4, rejected: 2 }], remarks: '2 units dented' }, 'Gabriel Comte')).toBe('partially_rejected');
    const p = (await getReceipt('BL-2026-0332'))!;
    expect([p.status, p.qc.result, p.totals.accepted, p.totals.rejected]).toEqual(['partially_rejected', 'Failed on 2 units', 4, 2]);
    expect((await getPurchaseOrder('PO-3134'))!.lines.map((l) => l.receivedQty)).toEqual([6]);
    // Goods put away at the unconfigured "Magasin chantier — Lyon" are stocked in the central warehouse.
    expect(p.lines.map((l) => l.location)).toEqual(['Entrepôt central — Lyon']);
    expect(await stockOf('ME-CRAC-60', 'Entrepôt central — Lyon')).toMatchObject({ onHand: 4 });
    expect(await stockOf('ME-CRAC-60', 'Zone quarantaine QC — Lyon')).toMatchObject({ onHand: 2 });
    expect((await listStock()).some((s) => s.location === 'Magasin chantier — Lyon')).toBe(false);
  });
});

describe('supplier invoices', () => {
  it('approve received part (credit note), reject, and the guards', async () => {
    await expect(approveInvoicePayment('INV-HC-7781', 'Fabien Bertrand')).rejects.toThrow(/not matched/);
    await approveInvoiceReceivedPart('INV-HC-7781', 'Fabien Bertrand');
    const i = (await getSupplierInvoice('INV-HC-7781'))!;
    expect([i.status, i.amountEur, i.invoicedAmountEur, i.creditNoteEur, i.match]).toEqual(['approved_for_payment', 1259600, 1286400, 26800, { po: 'diff', gr: 'ok' }]);
    await rejectSupplierInvoice('INV-LE-2210', 'Fabien Bertrand');
    expect((await getSupplierInvoice('INV-LE-2210'))!.status).toBe('rejected');
    await expect(rejectSupplierInvoice('INV-KS-4471', 'Fabien Bertrand')).rejects.toThrow(/no longer be rejected/);
    expect(await lastAudit()).toMatchObject({ who: 'Fabien Bertrand', object: 'INV-LE-2210', area: 'Sourcing' });
  });
});

describe('stock movements and the mock X3 exchange', () => {
  it('adjust, transfer, reserve, issue, return, scrap with their guards; Local until pushed; import keeps local changes', async () => {
    const line = (ref: string, loc: string) => stockOf(ref, loc).then((s) => s!.id);
    const lt = await line('LT-HB-200W', 'Entrepôt central — Lyon');
    // SC-5a (Delivery 7, R-098): an issue names its activity.
    await expect(applyStockMovement(lt, { op: 'issue', qty: 5, projectCode: 'HLT-026' }, 'Fabien Bertrand')).rejects.toThrow(/Choose the activity/);
    await expect(applyStockMovement(lt, { op: 'issue', qty: 500, projectCode: 'HLT-026', activityCode: 'A1420' }, 'Fabien Bertrand')).rejects.toThrow(/Only 120 on hand/);
    await expect(applyStockMovement(lt, { op: 'transfer', qty: 5 }, 'Fabien Bertrand')).rejects.toThrow(/destination/);
    await expect(applyStockMovement(lt, { op: 'reserve', qty: 5 }, 'Fabien Bertrand')).rejects.toThrow(/project is required/);
    await applyStockMovement(lt, { op: 'transfer', qty: 20, targetLocation: 'Magasin chantier — Le Havre' }, 'Fabien Bertrand');
    expect([(await stockOf('LT-HB-200W', 'Entrepôt central — Lyon'))!.onHand, (await stockOf('LT-HB-200W', 'Magasin chantier — Le Havre'))!.onHand]).toEqual([100, 20]);
    await applyStockMovement(lt, { op: 'reserve', qty: 30, projectCode: 'HLT-026' }, 'Fabien Bertrand');
    await expect(applyStockMovement(lt, { op: 'reserve', qty: 1, projectCode: 'NDC-031' }, 'Fabien Bertrand')).rejects.toThrow(/another project/);
    await applyStockMovement(lt, { op: 'issue', qty: 10, projectCode: 'HLT-026', activityCode: 'A1420' }, 'Fabien Bertrand');
    expect(await stockOf('LT-HB-200W', 'Entrepôt central — Lyon')).toMatchObject({ onHand: 90, reserved: 20, reservedForShort: 'HLT', source: 'local' });
    expect((await listStockMovements({ limit: 1 }))[0].where).toMatch(/^Entrepôt central — Lyon → A1420 /);
    await applyStockMovement(lt, { op: 'return', qty: 5, projectCode: 'HLT-026' }, 'Fabien Bertrand');
    await applyStockMovement(lt, { op: 'scrap', qty: 5 }, 'Fabien Bertrand');
    await applyStockMovement(lt, { op: 'adjust', qty: 0 }, 'Fabien Bertrand');
    expect(await stockOf('LT-HB-200W', 'Entrepôt central — Lyon')).toMatchObject({ onHand: 0, reserved: 0, reservedForProject: null });
    const moves = (await listStockMovements({ ref: 'LT-HB-200W', limit: 6 })).map((m) => [m.typeLabel, m.qty, m.who, m.pendingPush]);
    expect(moves.slice(0, 5)).toEqual([['Adjust', 0, 'Fabien Bertrand', true], ['Scrap', 5, 'Fabien Bertrand', true], ['Return', 5, 'Fabien Bertrand', true], ['Issue', 10, 'Fabien Bertrand', true], ['Reserve', 30, 'Fabien Bertrand', true]]);
    const local = (await getX3StockSync())!.localLines;
    const imp = await importStockFromX3('Fabien Bertrand');
    expect((await getX3StockSync())!.localLines).toBe(local);
    expect(imp.lines).toBe((await getX3StockSync())!.x3Lines);
    const pushed = await pushStockToX3('Fabien Bertrand');
    expect(pushed.lines).toBe(local);
    expect([(await getX3StockSync())!.localLines, (await getX3StockSync())!.pendingMovements]).toEqual([0, 0]);
  });
});

describe('catalogue, BOM and PDM writers', () => {
  it('New part, register equivalent, Add article, Sync vault', async () => {
    await expect(createPart({ ref: 'KS-STL-0450', name: 'x', family: 'structure' }, 'Antoine Girard')).rejects.toThrow(/already exists/);
    expect(await createPart({ ref: 'me-gbx-90', name: 'Gearbox 90 kW', family: 'mechanical', supplier: 'Flender', priceEur: 8400, unit: 'pc' }, 'Antoine Girard')).toBe('ME-GBX-90');
    const p = (await getPart('ME-GBX-90'))!;
    expect([p.status, p.typeLabel, p.makeBuy, p.manufacturer, p.listPriceEur, p.revision]).toEqual(['not_validated', 'Mechanical', 'purchased', 'Flender', 8400, 'A']);
    await registerEquivalent('ME-GBX-90', 'CR-MOT-15K', 'Antoine Girard');
    expect([(await getPartRecord('ME-GBX-90'))!.equivalents, (await getPart('CR-MOT-15K'))!.equivalents]).toEqual([['CR-MOT-15K'], ['ME-GBX-90']]);
    expect(await addBomLine('HLT-026', { ref: 'ME-GBX-90', quantity: 2, activityCode: 'A1320', scope: 'keystone', note: 'Spare drive' }, 'Romain Aubert')).toBe('ME-GBX-90');
    await expect(addBomLine('HLT-026', { ref: 'ME-GBX-90', quantity: 1 }, 'Romain Aubert')).rejects.toThrow(/already in the project BOM/);
    await expect(addBomLine('HLT-026', { ref: 'NOPE-1', quantity: 1 }, 'Romain Aubert')).rejects.toThrow(/not in the catalogue/);
    const line = (await getProjectBom('HLT-026'))!.lines.find((l) => l.ref === 'ME-GBX-90')!;
    expect([line.quantity, line.activityCode, line.note, line.scopeLabel]).toEqual([2, 'A1320', 'Spare drive', 'Keystone']);
    // A-12 (chapter 4): "Last vault sync" is the latest of Keystone's sync and the PDM connector row's run (26 Sep 07:40) —
    // a sync recorded on 25 Sep 11:05 is older, so the tile keeps 07:40; a later one shows its own time.
    const s = await syncPdmVault({ source: 'solidworks_3dx', scope: 'current_project', projectCode: 'HLT-026' }, 'Antoine Girard', new Date('2026-09-25T09:05:00Z'));
    expect([s.time, s.drawingsInVault, s.linkedDrawings, s.drawingsUpdated]).toEqual(['07:40', 1248, 13, 0]);
    const later = await syncPdmVault({ source: 'solidworks_3dx', scope: 'current_project', projectCode: 'HLT-026' }, 'Antoine Girard', new Date('2026-09-26T09:05:00Z'));
    expect([later.time, later.drawingsInVault, later.linkedDrawings, later.drawingsUpdated]).toEqual(['11:05', 1248, 13, 0]);
    expect((await getVaultSyncState())!.time).toBe('11:05');
  });
});

describe('ECO progress sent to Vigie (outbox)', () => {
  it('the PM approves ECO-2026-015 on the PM key: pending sync with Vigie, leaves the PM queue; status stays Vigie\'s', async () => {
    expect(getVigieEcoConnector().mode).toBe('mock');
    expect((await ecoApprovalQueue({ name: 'Romain Aubert', role: 'pm' })).map((e) => e.number)).toEqual(['ECO-2026-015']);
    const rec = await recordEcoProgress('ECO-2026-015', { key: 'pm', decision: 'ok', comment: 'OK for HLT' }, { name: 'Romain Aubert', role: 'pm' });
    expect([rec.ecoNumber, rec.kind, rec.syncStatus]).toEqual(['ECO-2026-015', 'approval', 'pending']);
    const e = (await getEco('ECO-2026-015'))!;
    expect([e.status, e.approvalsView.map((a) => [a.key, a.decision, a.pendingSync]), e.pendingSync, e.pendingSyncLabel])
      .toEqual(['in_approval', [['englead', 'ok', false], ['quality', 'ok', false], ['pm', 'ok', true]], true, 'Pending sync with Vigie']);
    expect(e.approvals.find((a) => a.key === 'pm')!.decision).toBe('pending'); // Vigie's own value is untouched
    expect(await ecoApprovalQueue({ name: 'Romain Aubert', role: 'pm' })).toEqual([]);
    await expect(recordEcoProgress('ECO-2026-015', { key: 'pm', decision: 'ok' }, { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow(/already waiting for Vigie/);
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'ECO-2026-015', area: 'ECO', change: 'PM of impacted projects: Pending → Approved · Pending sync with Vigie' });
  });

  it('only the viewer\'s own key, in approval, still pending; the director holds none; a PM must manage an impacted project', async () => {
    await expect(recordEcoProgress('ECO-2026-015', { key: 'englead', decision: 'ok' }, { name: 'Antoine Girard', role: 'englead' })).rejects.toThrow(/not pending/);
    await expect(recordEcoProgress('ECO-2026-015', { key: 'pm', decision: 'ok' }, { name: 'Gabriel Comte', role: 'quality' })).rejects.toThrow(/Only the PM of impacted projects/);
    await expect(recordEcoProgress('ECO-2026-015', { key: 'pm', decision: 'ok' }, { name: 'Marie Lefebvre', role: 'director' })).rejects.toThrow(/holds no ECO approval/);
    await expect(recordEcoProgress('ECO-2026-016', { key: 'quality', decision: 'ok' }, { name: 'Gabriel Comte', role: 'quality' })).rejects.toThrow(/not in approval/);
    await expect(recordEcoProgress('ECO-2026-099', { key: 'quality', decision: 'ok' }, { name: 'Gabriel Comte', role: 'quality' })).rejects.toThrow(/Unknown ECO/);
  });

  it('the connector\'s Change-orders roles are the screen registry\'s', () => {
    const roles: RoleKey[] = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
    expect(roles.filter((r) => canSee(r, 'eco'))).toEqual(ECO_SCREEN_ROLES);
  });

  it('step advancement: Start impact analysis (Draft), one at a time; Submit needs the interchangeability decided in Vigie; outside viewers refused', async () => {
    await expect(recordEcoProgress('ECO-2026-017', { step: 'impact_analysis' }, { name: 'Nadia Bensaïd', role: 'client' })).rejects.toThrow(/outside your workspace/);
    await expect(recordEcoProgress('ECO-2026-017', { step: 'in_approval' }, { name: 'Fabien Bertrand', role: 'procurement' })).rejects.toThrow(/cannot move from Draft to In approval/);
    await recordEcoProgress('ECO-2026-017', { step: 'impact_analysis' }, { name: 'Fabien Bertrand', role: 'procurement' });
    const e = (await listEcos({ numbers: ['ECO-2026-017'] }))[0];
    expect([e.status, e.requestedStatus, e.requestedStatusLabel, e.pendingProgress.length]).toEqual(['draft', 'impact_analysis', 'Impact analysis', 1]);
    await expect(recordEcoProgress('ECO-2026-017', { step: 'impact_analysis' }, { name: 'Fabien Bertrand', role: 'procurement' })).rejects.toThrow(/already waiting for Vigie/);
    await expect(recordEcoProgress('ECO-2026-016', { step: 'in_approval' }, { name: 'Antoine Girard', role: 'englead' })).rejects.toThrow(/decide interchangeability in Vigie/);
    expect(await mockEcoConnector.sync()).toEqual({ delivered: 0, failed: 0, pending: 2, refreshed: 0 });
  });

  it('HTTP connector (VIGIE_API_URL): delivers the outbox, then the refresh from Vigie becomes the mirror', async () => {
    vi.stubEnv('VIGIE_API_URL', 'http://vigie.test/');
    const posted: string[] = [];
    const current = (await listEcos({ numbers: ['ECO-2026-015'] }))[0];
    const record: VigieEcoRecord = {
      number: current.number, title: current.title, type: current.type, status: 'in_approval', interchangeability: current.interchangeability, fromRevision: current.fromRevision,
      toRevision: current.toRevision, costEur: current.costEur, scheduleDays: current.scheduleDays, stockImpact: current.stockImpact, documentRefs: current.documentRefs,
      requestedBy: current.requestedBy, raisedOn: current.raisedOn, pendingDispositions: 3, locked: true, parts: current.parts, projects: current.projects,
      approvals: current.approvals.map((a) => ({ key: a.key, decision: 'ok', approver: a.approver, decidedBy: a.key === 'pm' ? 'Romain Aubert' : a.decidedBy, decidedAt: null })),
      effectivity: current.effectivity, updatedAt: '2026-09-25T10:00:00Z',
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(String(url));
        return new Response(JSON.stringify({ id: `V-${posted.length}` }), { status: 200 });
      }
      return new Response(JSON.stringify([record]), { status: 200 });
    }));
    expect(getVigieEcoConnector().mode).toBe('http');
    const res = await httpEcoConnector.sync();
    expect([res.delivered, res.failed, res.pending, res.refreshed]).toEqual([2, 0, 0, 1]);
    expect(posted).toEqual(['http://vigie.test/api/ecos/ECO-2026-015/progress', 'http://vigie.test/api/ecos/ECO-2026-017/progress']);
    const after = await httpEcoConnector.listEcos();
    expect(after.map((e) => e.number)).toEqual(['ECO-2026-015']); // full refresh: Vigie reports only what concerns Keystone
    expect([after[0].locked, after[0].approvals.map((a) => [a.decision, a.pending]), after[0].pendingProgress]).toEqual([true, [['ok', null], ['ok', null], ['ok', null]], []]);
  });

  it('HTTP connector falls back to the local mirror when Vigie is unreachable', async () => {
    vi.stubEnv('VIGIE_API_URL', 'http://vigie.test');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    resetVigieRefreshThrottle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await getVigieEcoConnector().listEcos()).map((e) => e.number)).toEqual(['ECO-2026-015']);
    expect(warn).toHaveBeenCalled();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe('links to Vigie (OPEN QUESTION V-1)', () => {
  it('default base http://localhost:3200, NEXT_PUBLIC_VIGIE_URL overrides; new-ECO link prefilled', () => {
    expect(vigieEcoUrl('ECO-2026-015')).toBe('http://localhost:3200/modifications-techniques/ECO-2026-015');
    expect(vigieNewEcoUrl({ partRef: 'HST-BRK-DSC', projectCode: 'HLT-026', title: 'Disc brake' })).toBe('http://localhost:3200/modifications-techniques/nouvelle?part=HST-BRK-DSC&project=HLT-026&title=Disc+brake&source=keystone');
    vi.stubEnv('NEXT_PUBLIC_VIGIE_URL', 'https://vigie.example.com/');
    expect(vigieEcoListUrl({ partRef: 'EL-VFD-200' })).toBe('https://vigie.example.com/modifications-techniques?part=EL-VFD-200');
    vi.unstubAllEnvs();
  });
});

describe('database seeded before Delivery 4', () => {
  it('gets the Delivery 4 modules seeded once when its catalogue is empty (migration 0003 on an existing data dir)', async () => {
    const db = await openDatabase();
    const count = async (t: string) => (await db.execute(sql.raw(`select count(*)::int as n from ${t}`))).rows[0] as { n: number };
    await db.execute(sql.raw('truncate parts, suppliers, storage_locations, vigie_ecos, x3_sync_runs, pdm_vault_syncs cascade'));
    expect([(await count('parts')).n, (await count('purchase_orders')).n, (await count('vigie_ecos')).n]).toEqual([0, 0, 0]);
    expect(await seedIfEmpty(db)).toBe(false);
    expect([(await count('parts')).n, (await count('purchase_orders')).n, (await count('goods_receipts')).n, (await count('stock_positions')).n, (await count('vigie_ecos')).n])
      .toEqual([54, 21, 15, 18, 6]);
    await seedIfEmpty(db);
    expect((await count('parts')).n).toBe(54);
  }, 60_000);
});
