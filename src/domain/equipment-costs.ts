// R-185 (multi-equipment projects, owner's choice 3 — docs/delivery-9/cadrage-r185-r186.md § 3–4): costs are tracked at project
// level, with a read-only breakdown by equipment line where the planning lots give it. No per-equipment cost category.
// Pure rule, no I/O, no translation. Documented in docs/delivery-9/notes-r185-equipments.md § "Ventilation des coûts par équipement".
//
// Attribution (each figure goes to ONE line, or to "Common to the project"; nothing is spread pro rata):
//  - a WBS node belongs to its own `equipment_id`, else to its nearest ancestor's; none → common;
//  - an activity belongs to its own `equipment_id`, else to its WBS node's line;
//  - a work package's current budget (original + approved changes, the Budget's "Budget by work package" table) belongs to its
//    WBS node's line; the unallocated contingency row ("—") is common;
//  - a work package's actual cost and EAC: each of its activities' figures go to the activity's line, the stock issued in Keystone
//    (SC-5a, R-098) to the line of the activity it was issued to (else the work package's), and whatever else the package holds
//    (its own figures when it has no activity) to the work package's line;
//  - earned value (only when computed from Keystone data, R-073): BAC × the activity's budget × % complete / Σ activity budgets —
//    exactly the project's EV at its data date, summed by line;
//  - an open purchase-order line (R-073 orders placed): the equipment line of the article's BOM line, else the line of the
//    activity the order is needed for, else common.
// A line id that is not one of the project's lines (removed meanwhile) counts as common. Totals equal the project's figures.

/** Key of the "Common to the project" row. */
export const COMMON_COST_KEY = 'common';

export interface CostLineRef {
  /** project_equipments.id. */
  id: string;
  /** "EQ-02". */
  ref: string;
}

export interface CostWbsNode {
  id: string;
  /** "1.5". */
  code: string;
  parentId: string | null;
  equipmentId: string | null;
}

export interface CostActivity {
  id: string;
  wbsNodeId: string;
  equipmentId: string | null;
  /** k€. */
  budget: number;
  /** % complete 0–100. */
  pct: number;
  /** k€. */
  actual: number;
  /** k€. */
  eac: number;
}

/** A row of the Budget's "Budget by work package" table (CostControl.workPackages), k€. */
export interface CostWorkPackage {
  /** "1.4", or "—" for the unallocated contingency. */
  wbs: string;
  original: number;
  changes: number;
  actual: number;
  eac: number;
}

/** Stock issued (+) or returned (−) in Keystone, k€, charged to the work package `wbs` (SC-5a, R-098). */
export interface CostStockMove {
  wbs: string;
  activityId: string | null;
  amount: number;
}

/** The open part of a purchase-order line, k€ (ordered − received, at the project's budget rate). */
export interface CostOpenOrder {
  amount: number;
  /** Equipment line of the article's BOM line in the project (null = common or no BOM line). */
  bomEquipmentId: string | null;
  /** The activity the order is needed for. */
  activityId: string | null;
}

export interface EquipmentCostInput {
  lines: readonly CostLineRef[];
  wbs: readonly CostWbsNode[];
  activities: readonly CostActivity[];
  workPackages: readonly CostWorkPackage[];
  stock?: readonly CostStockMove[];
  openOrders?: readonly CostOpenOrder[];
  /** Budget at completion, k€ (the EV scale). */
  bac: number;
  /** False when the project's EV is not computed from its activities (seeded series): earned value is not broken down. */
  earnedValue: boolean;
}

export interface EquipmentCostFigures {
  /** Current budget (original + approved changes), k€. */
  budget: number;
  actual: number;
  eac: number;
  /** Null when earned value is not broken down. */
  ev: number | null;
  openOrders: number;
}

export interface EquipmentCostRow extends EquipmentCostFigures {
  /** A line id, or COMMON_COST_KEY. */
  key: string;
  /** "EQ-02"; null for the common row. */
  ref: string | null;
}

export interface EquipmentCostBreakdown {
  /** One row per line (input order), then the common row. */
  rows: EquipmentCostRow[];
  total: EquipmentCostFigures;
}

const pos = (v: number) => Math.max(0, v || 0);
const pctOf = (v: number) => Math.max(0, Math.min(100, v || 0)) / 100;

/** The line (id) a WBS node belongs to: its own, else its nearest ancestor's; null = common. Cycles are cut. */
export function wbsEquipmentOf(nodes: readonly CostWbsNode[]): (nodeId: string | null | undefined) => string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, string | null>();
  const resolve = (id: string | null | undefined, seen: Set<string>): string | null => {
    if (!id) return null;
    if (memo.has(id)) return memo.get(id)!;
    const n = byId.get(id);
    if (!n || seen.has(id)) return null;
    seen.add(id);
    const v = n.equipmentId ?? resolve(n.parentId, seen);
    memo.set(id, v);
    return v;
  };
  return (id) => resolve(id, new Set());
}

/** Costs of a project by equipment line (rules in the file header). */
export function equipmentCostBreakdown(inp: EquipmentCostInput): EquipmentCostBreakdown {
  const known = new Set(inp.lines.map((l) => l.id));
  const keyOf = (equipmentId: string | null | undefined) => (equipmentId && known.has(equipmentId) ? equipmentId : COMMON_COST_KEY);
  const nodeLine = wbsEquipmentOf(inp.wbs);
  const nodeByCode = new Map(inp.wbs.map((n) => [n.code, n]));
  const actById = new Map(inp.activities.map((a) => [a.id, a]));
  const activityKey = (a: CostActivity) => keyOf(a.equipmentId ?? nodeLine(a.wbsNodeId));

  const zero = (): EquipmentCostFigures => ({ budget: 0, actual: 0, eac: 0, ev: inp.earnedValue ? 0 : null, openOrders: 0 });
  const acc = new Map<string, EquipmentCostFigures>([...inp.lines.map((l) => [l.id, zero()] as const), [COMMON_COST_KEY, zero()]]);
  const add = (key: string, k: 'budget' | 'actual' | 'eac' | 'openOrders' | 'ev', v: number) => {
    const row = acc.get(key)!;
    row[k] = (row[k] ?? 0) + v;
  };

  // Work packages: budget to the package's line; actual / EAC through its activities and stock, the rest to the package's line.
  const stock = inp.stock ?? [];
  for (const w of inp.workPackages) {
    const node = w.wbs === '—' ? undefined : nodeByCode.get(w.wbs);
    const wpKey = keyOf(node ? nodeLine(node.id) : null);
    add(wpKey, 'budget', (w.original || 0) + (w.changes || 0));
    let actual = w.actual || 0;
    let eac = w.eac || 0;
    if (node) {
      for (const a of inp.activities.filter((x) => x.wbsNodeId === node.id)) {
        const k = activityKey(a);
        add(k, 'actual', a.actual || 0);
        add(k, 'eac', a.eac || 0);
        actual -= a.actual || 0;
        eac -= a.eac || 0;
      }
    }
    if (w.wbs !== '—')
      for (const m of stock.filter((s) => s.wbs === w.wbs)) {
        const a = m.activityId ? actById.get(m.activityId) : undefined;
        const k = a ? activityKey(a) : wpKey;
        add(k, 'actual', m.amount || 0);
        add(k, 'eac', m.amount || 0);
        actual -= m.amount || 0;
        eac -= m.amount || 0;
      }
    // Whatever the package holds beyond its activities and stock (its own figures without activity, the contingency row).
    add(wpKey, 'actual', actual);
    add(wpKey, 'eac', eac);
  }

  // Earned value: the project's EV at its data date (BAC × budget-weighted progress), summed by line.
  if (inp.earnedValue) {
    const total = inp.activities.reduce((t, a) => t + pos(a.budget), 0);
    if (total > 0) for (const a of inp.activities) add(activityKey(a), 'ev', (inp.bac * pos(a.budget) * pctOf(a.pct)) / total);
  }

  // Open orders: the article's line, else the line of the activity the order is needed for.
  for (const o of inp.openOrders ?? []) {
    const a = o.activityId ? actById.get(o.activityId) : undefined;
    const k = o.bomEquipmentId && known.has(o.bomEquipmentId) ? o.bomEquipmentId : a ? activityKey(a) : COMMON_COST_KEY;
    add(k, 'openOrders', o.amount || 0);
  }

  const rows: EquipmentCostRow[] = [
    ...inp.lines.map((l) => ({ key: l.id, ref: l.ref, ...acc.get(l.id)! })),
    { key: COMMON_COST_KEY, ref: null, ...acc.get(COMMON_COST_KEY)! },
  ];
  const total = rows.reduce<EquipmentCostFigures>(
    (t, r) => ({
      budget: t.budget + r.budget, actual: t.actual + r.actual, eac: t.eac + r.eac, openOrders: t.openOrders + r.openOrders,
      ev: t.ev == null || r.ev == null ? null : t.ev + r.ev,
    }),
    zero(),
  );
  return { rows, total };
}
