// R-185: cost breakdown by equipment line (src/domain/equipment-costs.ts).
import { describe, expect, it } from 'vitest';
import { COMMON_COST_KEY, equipmentCostBreakdown, wbsEquipmentOf, type EquipmentCostInput } from './equipment-costs';

const lines = [{ id: 'L1', ref: 'EQ-01' }, { id: 'L2', ref: 'EQ-02' }];
const wbs = [
  { id: 'root', code: '1', parentId: null, equipmentId: null },
  { id: 'n1', code: '1.1', parentId: 'root', equipmentId: null },
  { id: 'n2', code: '1.2', parentId: 'root', equipmentId: 'L1' },
  { id: 'n3', code: '1.3', parentId: 'root', equipmentId: 'L2' },
  { id: 'n31', code: '1.3.1', parentId: 'n3', equipmentId: null },
  { id: 'n4', code: '1.4', parentId: 'root', equipmentId: null },
];
const base: EquipmentCostInput = {
  lines,
  wbs,
  activities: [
    { id: 'a1', wbsNodeId: 'n1', equipmentId: null, budget: 100, pct: 100, actual: 110, eac: 110 },
    { id: 'a2', wbsNodeId: 'n2', equipmentId: null, budget: 200, pct: 50, actual: 90, eac: 210 },
    // Its own line wins over its package's (common) one.
    { id: 'a3', wbsNodeId: 'n1', equipmentId: 'L2', budget: 100, pct: 0, actual: 5, eac: 105 },
    { id: 'a4', wbsNodeId: 'n3', equipmentId: null, budget: 100, pct: 20, actual: 30, eac: 100 },
  ],
  workPackages: [
    { wbs: '1.1', original: 200, changes: 10, actual: 115, eac: 215 },
    { wbs: '1.2', original: 200, changes: 0, actual: 92, eac: 212 },
    { wbs: '1.3', original: 100, changes: -5, actual: 30, eac: 100 },
    // No activity: its own figures go to its (common) line.
    { wbs: '1.4', original: 50, changes: 0, actual: 12, eac: 48 },
    { wbs: '—', original: 30, changes: 0, actual: 8, eac: 20 },
  ],
  stock: [{ wbs: '1.2', activityId: 'a2', amount: 2 }],
  openOrders: [
    { amount: 40, bomEquipmentId: 'L2', activityId: 'a2' },
    { amount: 7, bomEquipmentId: null, activityId: 'a2' },
    { amount: 3, bomEquipmentId: null, activityId: null },
    { amount: 1, bomEquipmentId: 'gone', activityId: null },
  ],
  bac: 600,
  earnedValue: true,
};

const row = (b: ReturnType<typeof equipmentCostBreakdown>, key: string) => b.rows.find((r) => r.key === key)!;

describe('equipment cost breakdown (R-185)', () => {
  it('a WBS node inherits its nearest ancestor’s line; unknown or cyclic nodes are common', () => {
    const of = wbsEquipmentOf(wbs);
    expect([of('n1'), of('n2'), of('n31'), of('root'), of('nope'), of(null)]).toEqual([null, 'L1', 'L2', null, null, null]);
    const cyc = wbsEquipmentOf([{ id: 'x', code: 'x', parentId: 'y', equipmentId: null }, { id: 'y', code: 'y', parentId: 'x', equipmentId: null }]);
    expect(cyc('x')).toBeNull();
  });

  it('rows per line then common; budget by package, actual / EAC / EV by activity, open orders by article then activity', () => {
    const b = equipmentCostBreakdown(base);
    expect(b.rows.map((r) => r.ref)).toEqual(['EQ-01', 'EQ-02', null]);
    // EQ-01: package 1.2 (budget 200); a2 (90 + 2 of stock; EAC 210 + 2); EV 600 × 200 × 0.5 / 500; open order 7 (via a2).
    expect(row(b, 'L1')).toMatchObject({ budget: 200, actual: 92, eac: 212, ev: 120, openOrders: 7 });
    // EQ-02: package 1.3 (95); a3 (own line) + a4; EV 600 × 100 × 0.2 / 500; the BOM line's order (40).
    expect(row(b, 'L2')).toMatchObject({ budget: 95, actual: 35, eac: 205, ev: 24, openOrders: 40 });
    // Common: packages 1.1, 1.4 and the contingency; a1; the 1.1 remainder; EV of a1; orders without line (and a removed line).
    expect(row(b, COMMON_COST_KEY)).toMatchObject({ budget: 290, actual: 130, eac: 178, ev: 120, openOrders: 4 });
  });

  it('the total row equals the project figures', () => {
    const b = equipmentCostBreakdown(base);
    const sum = (k: 'original' | 'changes' | 'actual' | 'eac') => base.workPackages.reduce((t, w) => t + w[k], 0);
    expect(b.total.budget).toBe(sum('original') + sum('changes'));
    expect(b.total.actual).toBe(sum('actual'));
    expect(b.total.eac).toBe(sum('eac'));
    // EV = BAC × budget-weighted progress (src/domain/cost-control.ts computeEvm at the data date).
    expect(b.total.ev).toBeCloseTo(600 * (100 + 100 + 0 + 20) / 500, 9);
    expect(b.total.openOrders).toBe(51);
  });

  it('earned value is not broken down when the project’s EV is not computed from its activities', () => {
    const b = equipmentCostBreakdown({ ...base, earnedValue: false });
    expect(b.rows.every((r) => r.ev === null)).toBe(true);
    expect(b.total.ev).toBeNull();
  });

  it('a project without equipment-tagged lots puts everything in the common row', () => {
    const b = equipmentCostBreakdown({ ...base, wbs: wbs.map((n) => ({ ...n, equipmentId: null })), activities: base.activities.map((a) => ({ ...a, equipmentId: null })), openOrders: [] });
    expect(row(b, 'L1')).toMatchObject({ budget: 0, actual: 0, eac: 0, ev: 0, openOrders: 0 });
    expect(row(b, COMMON_COST_KEY).budget).toBe(b.total.budget);
  });
});
