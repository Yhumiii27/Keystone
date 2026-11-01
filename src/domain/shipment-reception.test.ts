// R-158 lot B — pure rules of the site reception, the closure and the freight-delay proposal; the shipping documents' rules.
import { describe, expect, it } from 'vitest';
import {
  RECEPTION_PUNCH_CATEGORY, closesWithPunch, freightDelayDays, freightRiskDraft, freightRiskTrigger, parseCloseReason, parseItemReception, parseLoadReception,
  receptionBlocker, receptionProgress,
} from './shipment-reception';
import { nextShipmentStatus } from './shipments';
import { SHIPPING_DOC_KINDS, nextRevisionLetter, shippingDocBlocker } from './shipping-documents';

const id = (x: string) => x;

describe('site reception (decision 5)', () => {
  it('default punch categories: damaged A (blocking), missing B (before SAT)', () => {
    expect(RECEPTION_PUNCH_CATEGORY).toEqual({ damaged: 'A', missing: 'B' });
  });

  it('a load: state, a note for a gap, the category (default per kind)', () => {
    expect(parseLoadReception({ state: 'received' })).toEqual({ ok: true, value: { state: 'received', note: null, category: null } });
    expect(parseLoadReception({ state: 'damaged' })).toEqual({ ok: false, error: 'Describe the gap found at the reception' });
    expect(parseLoadReception({ state: 'damaged', note: 'Seal broken' })).toEqual({ ok: true, value: { state: 'damaged', note: 'Seal broken', category: 'A' } });
    expect(parseLoadReception({ state: 'missing', note: 'Truck 2 not arrived', category: 'c' })).toMatchObject({ ok: true, value: { category: 'C' } });
    expect(parseLoadReception({ state: 'missing', note: 'x', category: 'Z' })).toEqual({ ok: false, error: 'Unknown category' });
    expect(parseLoadReception({ state: 'lost' })).toEqual({ ok: false, error: 'Invalid request' });
  });

  it('a content line: received + missing + damaged = shipped; a note for a gap', () => {
    expect(parseItemReception({ received: '12' }, 12)).toMatchObject({ ok: true, value: { received: 12, missing: 0, damaged: 0, missingCategory: 'B', damagedCategory: 'A' } });
    expect(parseItemReception({ received: '11' }, 12)).toEqual({ ok: false, error: 'Received, missing and damaged must add up to the quantity shipped' });
    expect(parseItemReception({ received: '11', damaged: '1' }, 12)).toEqual({ ok: false, error: 'Describe the gap found at the reception' });
    expect(parseItemReception({ received: '10,5', damaged: '1.5', note: 'Wet', damagedCategory: 'B' }, 12)).toMatchObject({ ok: true, value: { received: 10.5, damaged: 1.5, damagedCategory: 'B' } });
    expect(parseItemReception({ received: '-1', missing: '13' }, 12)).toEqual({ ok: false, error: 'Invalid quantity' });
  });

  it('complete once every load and line is pointed, only while arrived', () => {
    const loads = [{ id: 'L1', items: [{ id: 'a' }, { id: 'b' }] }, { id: 'L2', items: [] }];
    const p = receptionProgress({ loads, pointedLoads: new Set(['L1']), pointedItems: new Set(['a']) });
    expect(p).toEqual({ loads: 2, loadsPointed: 1, items: 2, itemsPointed: 1, complete: false });
    expect(receptionBlocker('arrived', p)).toBe('Point every load first');
    const q = receptionProgress({ loads, pointedLoads: new Set(['L1', 'L2']), pointedItems: new Set(['a']) });
    expect(receptionBlocker('arrived', q)).toBe('Point every content line first');
    const r = receptionProgress({ loads, pointedLoads: new Set(['L1', 'L2']), pointedItems: new Set(['a', 'b']) });
    expect([r.complete, receptionBlocker('arrived', r), receptionBlocker('in_transit', r)]).toEqual([true, null, 'The reception is pointed once the shipment has arrived']);
    expect(receptionProgress({ loads: [], pointedLoads: new Set(), pointedItems: new Set() }).complete).toBe(false);
    void id;
  });

  it('statuses: arrived → received through the reception, received → closed with the last punch item or by hand', () => {
    expect(['prepared', 'picked_up', 'in_transit', 'arrived', 'received', 'closed'].map((s) => nextShipmentStatus(s as never))).toEqual(['picked_up', 'in_transit', 'arrived', null, null, null]);
    expect([closesWithPunch('received', 0), closesWithPunch('received', 1), closesWithPunch('arrived', 0)]).toEqual([true, false, false]);
    expect(parseCloseReason('', 1)).toEqual({ ok: false, error: 'Give the reason for closing with open punch items' });
    expect(parseCloseReason('', 0)).toEqual({ ok: true, value: null });
    expect(parseCloseReason(' Spare sent separately ', 2)).toEqual({ ok: true, value: 'Spare sent separately' });
  });
});

describe('freight delay (risk suggestion, never automatic)', () => {
  const need = { date: '2026-10-05', source: 'site_sheet' as const };
  it('days late while not on site; nothing without a need date or an ETA', () => {
    expect(freightDelayDays({ status: 'in_transit', eta: '2026-10-09' }, need)).toBe(4);
    expect(freightDelayDays({ status: 'draft', eta: '2026-10-05' }, need)).toBeNull();
    expect(freightDelayDays({ status: 'arrived', eta: '2026-10-09' }, need)).toBeNull();
    expect(freightDelayDays({ status: 'prepared', eta: null }, need)).toBeNull();
    expect(freightDelayDays({ status: 'prepared', eta: '2026-10-09' }, null)).toBeNull();
  });
  it('the "New risk" values: Freight delay — ref · title, Supplier / delivery, the PM, mitigate', () => {
    const t = (s: string) => s;
    expect(freightRiskDraft({ ref: 'EXP-02', label: 'Gantry' }, { pmName: 'Romain Aubert', owners: ['A', 'Romain Aubert'], categories: ['technical', 'supplier_delivery'] }, t))
      .toEqual({ title: 'Freight delay — EXP-02 · Gantry', cat: 'supplier_delivery', owner: 'Romain Aubert', resp: 'mitigate' });
    expect(freightRiskDraft({ ref: 'EXP-02', label: null }, { pmName: null, owners: ['A'], categories: ['technical'] }, t)).toMatchObject({ cat: 'technical', owner: 'A' });
    expect(freightRiskTrigger('EXP-02', '9 Oct', need, '5 Oct', t)).toBe('Shipment ETA later than the site need date · EXP-02 · ETA 9 Oct · site sheet start 5 Oct');
  });
});

describe('shipping documents (decision 3: no invoice)', () => {
  it('eight kinds, none an invoice; the CMR for road transport; content needed', () => {
    expect(SHIPPING_DOC_KINDS).toHaveLength(8);
    expect(SHIPPING_DOC_KINDS.some((k) => /invoice/.test(k))).toBe(false);
    const full = { loads: [{ items: [1] }] };
    expect(shippingDocBlocker('cmr', { mode: 'sea', ...full })).toBe('The CMR consignment note is for road transport');
    expect(shippingDocBlocker('cmr', { mode: 'multimodal', ...full })).toBeNull();
    expect(shippingDocBlocker('packing_list', { mode: 'sea', loads: [{ items: [] }] })).toBe('Declare the loads and their content first');
  });
  it('revision letters A → B … Z → AA', () => {
    expect(['A', 'B', 'Z', 'AZ', 'ZZ', '1'].map(nextRevisionLetter)).toEqual(['B', 'C', 'AA', 'BA', 'AAA', 'A']);
  });
});
