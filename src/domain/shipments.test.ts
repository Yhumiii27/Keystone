// R-158 lot A — pure rules of the shipments (docs/delivery-9/notes-r158-shipments.md § 5): Incoterm split of the 11 Incoterms
// 2020, transport steps, statuses, the packing control against the BOM, the per-HS-code summary, the deliverable rule and the
// form parsers.
import { describe, expect, it } from 'vitest';
import {
  INCOTERM_STEPS, STANDARD_INCOTERMS, incotermRemoval, parseIncoterm, readSplit, sellerSteps, splitText,
} from './incoterms';
import { isGapKey, parseItemForm, parseLoadForm, parseShipmentForm, parseStepForm } from './shipment-input';
import {
  SHIPMENT_STATUSES, contentEditable, incotermModeMismatch, itemKey, nextShipmentRef, nextShipmentStatus, packingBlocker, packingControl,
  packingDeliverableBlocker, partKey, shipmentSteps, type ControlBomLine, type ControlItem,
} from './shipments';

const split = (code: string) => STANDARD_INCOTERMS.find((i) => i.code === code)!.split;

describe('Incoterms 2020 (decision 9)', () => {
  it('the 11 rules, 7 any mode then 4 sea and inland waterway, each with both languages', () => {
    expect(STANDARD_INCOTERMS.map((i) => `${i.code}:${i.modes}`)).toEqual([
      'EXW:any', 'FCA:any', 'CPT:any', 'CIP:any', 'DAP:any', 'DPU:any', 'DDP:any', 'FAS:sea', 'FOB:sea', 'CFR:sea', 'CIF:sea',
    ]);
    for (const i of STANDARD_INCOTERMS) {
      expect(i.nameEn && i.nameFr && i.descriptionEn && i.descriptionFr, i.code).toBeTruthy();
      expect(Object.keys(i.split)).toEqual([...INCOTERM_STEPS]);
    }
  });

  it('splits the 10 steps between the seller and the buyer', () => {
    // packaging, loading, export clearance, pre-carriage, main carriage, insurance, unloading, import clearance, on-carriage, duties
    expect(Object.fromEntries(STANDARD_INCOTERMS.map((i) => [i.code, splitText(i.split)]))).toEqual({
      EXW: 'S B B B B B B B B B',
      FCA: 'S S S S B B B B B B',
      CPT: 'S S S S S B B B B B',
      CIP: 'S S S S S S B B B B',
      DAP: 'S S S S S S B B S B',
      DPU: 'S S S S S S S B S B',
      DDP: 'S S S S S S B S S S',
      FAS: 'S S S S B B B B B B',
      FOB: 'S S S S B B B B B B',
      CFR: 'S S S S S B B B B B',
      CIF: 'S S S S S S B B B B',
    });
    // Insurance is the seller's obligation only under CIF and CIP among the C rules; the D rules bear the risk to the place.
    expect(sellerSteps(split('DAP'))).toEqual(['export_packaging', 'loading_origin', 'export_clearance', 'pre_carriage', 'main_carriage', 'insurance', 'on_carriage']);
    expect(split('DDP').import_clearance).toBe('seller');
    expect(split('DPU').unloading_destination).toBe('seller');
  });

  it('reads a stored split defensively and parses the Settings form', () => {
    expect(splitText(readSplit({ export_packaging: 'seller', insurance: 'nobody' }))).toBe('S B B B B B B B B B');
    const values = { code: ' xyz ', nameEn: 'Test', nameFr: '', descriptionEn: '', descriptionFr: '', modes: 'any', ...Object.fromEntries(INCOTERM_STEPS.map((k) => [`step_${k}`, 'buyer'])) };
    const ok = parseIncoterm(values);
    expect(ok.ok && ok.value.code).toBe('XYZ');
    expect(parseIncoterm({ ...values, code: 'XY' })).toEqual({ ok: false, error: 'An Incoterm code is three letters' });
    expect(parseIncoterm({ ...values, nameEn: '' })).toEqual({ ok: false, error: 'Enter the Incoterm’s name' });
    expect(parseIncoterm({ ...values, step_insurance: 'both' })).toEqual({ ok: false, error: 'Invalid request' });
    expect([incotermRemoval({ standard: true, usedBy: 0 }), incotermRemoval({ standard: false, usedBy: 1 }), incotermRemoval({ standard: false, usedBy: 0 })])
      .toEqual(['deactivated', 'deactivated', 'deleted']);
  });
});

describe('shipment statuses and steps', () => {
  it('advances one status at a time from prepared; draft goes through the packing-list validation', () => {
    expect(SHIPMENT_STATUSES.map(nextShipmentStatus)).toEqual([null, 'picked_up', 'in_transit', 'arrived', 'received', 'closed', null]);
    expect(SHIPMENT_STATUSES.filter(contentEditable)).toEqual(['draft', 'prepared']);
    expect([nextShipmentRef([]), nextShipmentRef(['EXP-01', 'EXP-07', 'X']), nextShipmentRef(['EXP-99'])]).toEqual(['EXP-01', 'EXP-08', 'EXP-100']);
  });

  it('tracks the seller’s steps (planned, actual, late) and shows the buyer’s', () => {
    const steps = shipmentSteps(split('DAP'), [
      { step: 'export_packaging', plannedOn: '2026-09-22', actualOn: '2026-09-24', note: null },
      { step: 'loading_origin', plannedOn: '2026-09-20', actualOn: null, note: null },
      { step: 'main_carriage', plannedOn: '2026-10-12', actualOn: null, note: 'convoy' },
      { step: 'import_clearance', plannedOn: '2026-10-13', actualOn: null, note: null },
    ], '2026-09-25');
    expect(steps.map((s) => `${s.step}:${s.state}`)).toEqual([
      'export_packaging:done', 'loading_origin:late', 'export_clearance:todo', 'pre_carriage:todo', 'main_carriage:planned', 'insurance:todo',
      'unloading_destination:buyer', 'import_clearance:buyer', 'on_carriage:todo', 'duties_taxes:buyer',
    ]);
    expect(shipmentSteps(null, [], '2026-09-25')).toEqual([]);
    expect([incotermModeMismatch('sea', 'road'), incotermModeMismatch('sea', 'sea'), incotermModeMismatch('any', 'air'), incotermModeMismatch('sea', null)]).toEqual([true, false, false, false]);
  });
});

describe('packing control against the BOM (decision 4)', () => {
  const bom: ControlBomLine[] = [
    { partRef: 'A', name: 'Module frame', equipmentId: 'eq2', quantity: 3, unitValueEur: 1000, hsCode: '7308.90', hsNotApplicable: false, exportRestriction: null },
    { partRef: 'B', name: 'PLC', equipmentId: 'eq2', quantity: 3, unitValueEur: 500, hsCode: '8537.10', hsNotApplicable: false, exportRestriction: 'Encryption module — export notification' },
    { partRef: 'C', name: 'Cable', equipmentId: null, quantity: 10, unitValueEur: 10, hsCode: null, hsNotApplicable: false, exportRestriction: null },
    { partRef: 'D', name: 'Crane rail', equipmentId: 'eq1', quantity: 4, unitValueEur: 200, hsCode: '7302.10', hsNotApplicable: false, exportRestriction: null },
    { partRef: 'E', name: 'Licence', equipmentId: null, quantity: 1, unitValueEur: 50, hsCode: null, hsNotApplicable: true, exportRestriction: null },
  ];
  const item = (id: string, partRef: string | null, quantity: number, extra: Partial<ControlItem> = {}): ControlItem => ({
    id, partRef, description: partRef ?? 'Spare kit', quantity, hsCode: null, unitValueEur: null, originCountry: 'FR', netKg: 10, grossKg: 12, loadLabel: '#1', ...extra,
  });

  it('expected = the BOM of the shipment’s equipment lines less the other shipments; missing, excess, outside the BOM', () => {
    const c = packingControl({
      bom, equipmentIds: ['eq2'], packedElsewhere: new Map([['A', 1]]), justifications: [],
      items: [item('1', 'A', 1), item('2', 'B', 4), item('3', 'C', 12), item('4', 'D', 1), item('5', null, 2, { hsCode: '8536.10', unitValueEur: 180 })],
    });
    expect(c.lines.map((l) => [l.key, l.category, l.expected, l.packed, l.delta, l.gap])).toEqual([
      ['part:A', 'equipment', 2, 1, -1, 'missing'],
      ['part:B', 'equipment', 3, 4, 1, 'excess'],
      ['part:C', 'common', 10, 12, 2, 'excess'],
      ['part:D', 'outside', null, 1, 1, 'not_in_bom'],
      ['item:5', 'outside', null, 2, 2, 'not_in_bom'],
    ]);
    // C has no HS code (and is not declared n/a): blocking; B is restricted: an alert.
    expect(c.missingHs.map((m) => m.label)).toEqual(['C · C']);
    expect(c.restricted).toEqual([{ label: 'B · B', restriction: 'Encryption module — export notification' }]);
    expect([c.openGaps, c.cleared, packingBlocker(c)]).toEqual([5, false, 'An item has no HS code: complete the part in the PLM (or the item) first']);
  });

  it('a gap is cleared by a reason given for its current difference; the per-HS-code summary', () => {
    const items = [item('1', 'A', 3), item('2', 'B', 3, { originCountry: 'DE' }), item('3', 'E', 1), item('5', null, 2, { hsCode: '8536.10', unitValueEur: 180 })];
    const base = { bom, equipmentIds: ['eq2'], packedElsewhere: new Map<string, number>(), items };
    const open = packingControl({ ...base, justifications: [] });
    expect(open.lines.filter((l) => l.gap).map((l) => l.key)).toEqual([itemKey('5')]);
    expect(packingBlocker(open)).toBe('Justify each gap of the packing control first');
    const reason = { key: itemKey('5'), delta: 2, reason: 'Spare kit', by: 'C. Verdier', at: null };
    const cleared = packingControl({ ...base, justifications: [reason] });
    expect([cleared.cleared, packingBlocker(cleared)]).toEqual([true, null]);
    // A reason given for another difference does not clear the gap.
    expect(packingControl({ ...base, justifications: [{ ...reason, delta: 1 }] }).cleared).toBe(false);
    expect(cleared.hsSummary.map((h) => [h.hsCode, h.lines, h.quantity, h.valueEur, h.netKg, h.origins, h.restricted])).toEqual([
      ['7308.90', 1, 3, 3000, 10, ['FR'], false],
      ['8536.10', 1, 2, 360, 10, ['FR'], false],
      ['8537.10', 1, 3, 1500, 10, ['DE'], true],
      ['', 1, 1, 50, 10, ['FR'], false],
    ]);
    expect(cleared.totals).toEqual({ lines: 4, quantity: 9, valueEur: 4910, netKg: 40, grossKg: 48 });
    expect(packingBlocker(packingControl({ ...base, items: [], justifications: [] }))).toBe('Nothing is packed yet');
    expect([partKey('A'), isGapKey('part:A'), isGapKey('item:x'), isGapKey('part:a b')]).toEqual(['part:A', true, false, false]);
  });

  it('« Colisage & documents douaniers » waits for every shipment’s validated packing list', () => {
    const tick = { stage: 'expedition', position: 0, done: true };
    expect(packingDeliverableBlocker(tick, [])).toBe('Prepare the project’s shipments first (Shipments screen)');
    expect(packingDeliverableBlocker(tick, [{ validated: true, cleared: true }, { validated: false, cleared: true }])).toBe('Validate the packing list of every shipment first (Shipments screen)');
    expect(packingDeliverableBlocker(tick, [{ validated: true, cleared: false }])).toBe('Validate the packing list of every shipment first (Shipments screen)');
    expect(packingDeliverableBlocker(tick, [{ validated: true, cleared: true }])).toBeNull();
    expect(packingDeliverableBlocker({ ...tick, done: false }, [])).toBeNull();
    expect(packingDeliverableBlocker({ ...tick, position: 1 }, [])).toBeNull();
  });
});

describe('form parsers', () => {
  it('shipment, load, content and step forms', () => {
    const s = parseShipmentForm({ equipment: 'eq-02, EQ-01', mode: 'sea', etd: '2026-10-12', eta: '2026-10-11' });
    expect(s).toEqual({ ok: false, error: 'The arrival cannot be before the departure' });
    const ok = parseShipmentForm({ equipment: 'EQ-02', mode: '', etd: '2026-10-12', label: ' Modules ' });
    expect(ok.ok && [ok.value.equipment, ok.value.mode, ok.value.label]).toEqual([['EQ-02'], null, 'Modules']);
    expect(parseShipmentForm({ equipment: '' })).toEqual({ ok: false, error: 'Choose the equipment line(s) of the shipment' });
    expect(parseShipmentForm({ equipment: 'EQ-02', etd: '2026-02-30' })).toEqual({ ok: false, error: 'Enter dates as YYYY-MM-DD' });
    expect(parseLoadForm({ type: 'c40hc', grossKg: '9 800,5' })).toEqual({ ok: true, value: { type: 'c40hc', identifier: null, seal: null, grossKg: 9800.5, note: null } });
    expect(parseLoadForm({ type: 'tanker' })).toEqual({ ok: false, error: 'Invalid request' });
    const it = parseItemForm({ part: 'ctl-cam-ocr', quantity: '12', netKg: '54', grossKg: '78', originCountry: 'fr', description: 'ignored' });
    expect(it.ok && [it.value.partRef, it.value.description, it.value.quantity, it.value.originCountry]).toEqual(['CTL-CAM-OCR', null, 12, 'FR']);
    expect(parseItemForm({ quantity: '1' })).toEqual({ ok: false, error: 'Choose a BOM article or describe the item' });
    expect(parseItemForm({ description: 'Kit', quantity: '0' })).toEqual({ ok: false, error: 'Enter a quantity above zero' });
    expect(parseItemForm({ description: 'Kit', quantity: '1', hsCode: '85' })).toEqual({ ok: false, error: 'An HS code reads 8537.20 (4 to 10 digits)' });
    expect(parseItemForm({ description: 'Kit', quantity: '1', netKg: '9', grossKg: '8' })).toEqual({ ok: false, error: 'The net weight cannot exceed the gross weight' });
    expect(parseItemForm({ description: 'Kit', quantity: '1', packages: '1.5' })).toEqual({ ok: false, error: 'Enter a whole number of packages' });
    expect(parseStepForm('insurance', { plannedOn: '2026-10-05' })).toEqual({ ok: true, value: { step: 'insurance', plannedOn: '2026-10-05', actualOn: null, note: null } });
    expect(parseStepForm('teleport', {})).toEqual({ ok: false, error: 'Invalid request' });
  });
});
