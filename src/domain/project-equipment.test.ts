// R-185 (multi-equipment projects): the pure rules — references, validation, summaries, main type and the reference budget
// (choice 3: Σ type budget × quantity).
import { describe, expect, it } from 'vitest';
import {
  PER_EQUIPMENT_PHASES, equipmentCount, equipmentLotLabel, equipmentRef, equipmentSummary, isPerEquipmentPhase, mainTypeOf, nextEquipmentRef,
  parseEquipmentLine, referenceBudget, referenceCategories,
} from './project-equipment';
import { PROTO } from '@/server/prototype';

const TYPES = ['EMP', 'MEMU', 'SPUR', 'AUTRE', 'rnd'];

describe('equipment line references', () => {
  it('EQ-01, EQ-02… one after the highest in use, every digit kept past 99', () => {
    expect([equipmentRef(1), equipmentRef(12), equipmentRef(100)]).toEqual(['EQ-01', 'EQ-12', 'EQ-100']);
    expect(nextEquipmentRef([])).toBe('EQ-01');
    expect(nextEquipmentRef(['EQ-01', 'EQ-03'])).toBe('EQ-04');
    expect(nextEquipmentRef(['EQ-99'])).toBe('EQ-100');
    expect(nextEquipmentRef(['X-7', 'EQ-2'])).toBe('EQ-01');
  });
});

describe('parseEquipmentLine', () => {
  const ok = (v: Record<string, unknown>) => parseEquipmentLine(v, TYPES);
  it('accepts a type among the proposed ones and a whole quantity; trims and normalises the optional fields', () => {
    expect(ok({ machineTypeCode: 'MEMU', quantity: '3', label: '  Unités quai 4 ', capacityValue: '12,5', capacityUnit: ' t/h ', options: 'Cabine, ,Radio,Cabine', besoinRef: 'cpx-sai-2026-01/b02' }))
      .toEqual({ ok: true, value: { machineTypeCode: 'MEMU', quantity: 3, label: 'Unités quai 4', capacityValue: 12.5, capacityUnit: 't/h', options: ['Cabine', 'Radio'], besoinRef: 'CPX-SAI-2026-01/B02' } });
    expect(ok({ machineTypeCode: 'EMP', quantity: 1 })).toEqual({
      ok: true, value: { machineTypeCode: 'EMP', quantity: 1, label: null, capacityValue: null, capacityUnit: null, options: [], besoinRef: null },
    });
    // A unit without a capacity is dropped.
    expect(ok({ machineTypeCode: 'EMP', quantity: 2, capacityUnit: 't' })).toMatchObject({ ok: true, value: { capacityValue: null, capacityUnit: null } });
  });

  it('refuses an unknown type, a quantity outside 1–999, bad capacities, options and machine needs', () => {
    const err = (v: Record<string, unknown>) => {
      const r = ok(v);
      return r.ok ? null : r.error;
    };
    expect(err({ machineTypeCode: 'XYZ', quantity: 1 })).toBe('Choose the machine type among the proposed types');
    for (const q of [0, -1, 1.5, '2.5', 1000, 'abc', null]) expect(err({ machineTypeCode: 'EMP', quantity: q })).toBe('The quantity is a whole number from 1 to 999');
    expect(err({ machineTypeCode: 'EMP', quantity: 1, label: 'x'.repeat(121) })).toBe('The equipment label is too long');
    expect(err({ machineTypeCode: 'EMP', quantity: 1, capacityValue: '-3', capacityUnit: 't' })).toBe('The target capacity is a positive number');
    expect(err({ machineTypeCode: 'EMP', quantity: 1, capacityValue: '40' })).toBe('Enter the unit of the target capacity');
    expect(err({ machineTypeCode: 'EMP', quantity: 1, options: [1, 2] })).toBe('Invalid options');
    expect(err({ machineTypeCode: 'EMP', quantity: 1, options: Array.from({ length: 13 }, (_, i) => `o${i}`) })).toBe('Too many or too long options');
    expect(err({ machineTypeCode: 'EMP', quantity: 1, besoinRef: 'CPX-SAI-2026-01' })).toBe('The machine need follows the CAPEX application’s format (CPX-SAI-2026-01/B01)');
  });
});

describe('summaries and main type', () => {
  it('a single line of one machine reads as before R-185; otherwise quantity × type per line', () => {
    expect(equipmentSummary([])).toBeNull();
    expect(equipmentSummary([{ typeLabel: 'EMP', quantity: 1 }])).toBe('EMP');
    expect(equipmentSummary([{ typeLabel: 'MEMU', quantity: 3 }])).toBe('3 × MEMU');
    expect(equipmentSummary([{ typeLabel: 'EMP', quantity: 1 }, { typeLabel: 'MEMU', quantity: 3 }])).toBe('1 × EMP · 3 × MEMU');
    expect(equipmentCount([{ quantity: 1 }, { quantity: 3 }])).toBe(4);
    expect([equipmentLotLabel({ ref: 'EQ-02', typeLabel: 'MEMU', quantity: 3 }), equipmentLotLabel({ ref: 'EQ-01', typeLabel: 'EMP', quantity: 1 })]).toEqual(['EQ-02 · 3 × MEMU', 'EQ-01 · EMP']);
  });

  it('the main type is the line with the lowest position', () => {
    expect(mainTypeOf([])).toBeNull();
    expect(mainTypeOf([{ machineTypeCode: 'MEMU', position: 2 }, { machineTypeCode: 'EMP', position: 0 }])).toBe('EMP');
  });
});

describe('reference budget (choice 3)', () => {
  const CATS: Record<string, { name: string; type: string; budget: number }[]> = {
    EMP: [{ name: 'Études', type: 'Labor', budget: 160 }, { name: 'Frais & transport', type: 'Fees', budget: 60 }],
    MEMU: [{ name: 'Études', type: 'Labor', budget: 120 }, { name: 'Assemblage', type: 'Labor', budget: 240 }, { name: 'Frais & transport', type: 'Fees', budget: 70 }],
  };
  const of = (mt: string) => CATS[mt] ?? [];

  it('Σ the type budget × quantity, categories of the same name and type merged, the main type first', () => {
    const lines = [{ machineTypeCode: 'EMP', quantity: 1 }, { machineTypeCode: 'MEMU', quantity: 3 }];
    expect(referenceCategories(lines, of)).toEqual([
      { name: 'Études', type: 'Labor', budget: 160 + 360 },
      { name: 'Frais & transport', type: 'Fees', budget: 60 + 210 },
      { name: 'Assemblage', type: 'Labor', budget: 720 },
    ]);
    expect(referenceBudget(lines, of)).toBe(220 + 3 * 430);
    // One line of one machine: the type's categories as they are.
    expect(referenceCategories([{ machineTypeCode: 'EMP', quantity: 1 }], of)).toEqual(CATS.EMP);
    expect(referenceBudget([], of)).toBe(0);
  });
});

describe('PER_EQUIPMENT_PHASES', () => {
  it('names standard phases of the prototype templates, R&D has none', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const templates = PROTO.NP_TEMPLATES as any[];
    for (const [code, names] of Object.entries(PER_EQUIPMENT_PHASES)) {
      const phases = templates.find((t) => t.mt === code)!.phases as string[];
      for (const n of names) expect(phases, `${code} · ${n}`).toContain(n);
    }
    expect(isPerEquipmentPhase('EMP', 'Fabrication structure')).toBe(true);
    expect(isPerEquipmentPhase('EMP', 'Études & approvisionnements longs')).toBe(false);
    expect(isPerEquipmentPhase('rnd', 'Prototype')).toBe(false);
  });
});
