import 'server-only';
// Budget & cost screen data (docs/spec/04 §1): cost control (EVM series, offer, categories, work packages, budget
// change lines, reconciliation — via cost.ts), the REX payment pattern of the project's machine type (Cost profile),
// and the client contract that feeds Cash & recovery (§1.6).
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { COMMITTED_PO_STATUSES } from '@/domain/cost-control';
import { projectFxOf, toEur } from '@/domain/currency';
import { equipmentCostBreakdown, type EquipmentCostBreakdown, type EquipmentCostRow } from '@/domain/equipment-costs';
import { equipmentLotLabel } from '@/domain/project-equipment';
import { showsEquipment } from '@/domain/equipment-scope';
import type { PaymentMilestone } from '@/domain/evm';
import { getDb } from '@/server/db/client';
import {
  activities, machineTypes, poLines, projectBomLines, projects, purchaseOrders, rexReferences, stockMovements, wbsNodes,
} from '@/server/db/schema';
import { getCashContract } from './contract';
import { getCostControl, type CostControl } from './cost';
import { getOpenCommitment } from './evm';
import { listProjectEquipments } from './project-equipment';

export interface RexReference {
  /** Analytic code of the reference project, e.g. "HAV001". */
  id: string;
  name: string;
  year: string;
  /** "29 % deposits · peak M8 · 8 % at SAT". */
  pattern: string;
}

/** REX financial pattern of a machine type (`REX_FIN[mt]`, logic 3101/3829). */
export interface RexPattern {
  /** Display code of the project's machine type ("EMP", "R&D"…), 'AUTRE' when the project has none. */
  mt: string;
  dep: number;
  deliv: number;
  acc: number;
  refs: RexReference[];
  /**
   * R-185: the REX references of the project's other equipment types (one entry per type of its later lines, in line order;
   * absent when the project has a single type). The payment pattern stays the main type's.
   */
  others?: { mt: string; refs: RexReference[] }[];
}

/**
 * `rexCat = REX_FIN[PROJ_ID[project].mt] || REX_FIN.AUTRE`, `rexMt = mt || 'AUTRE'`: the pattern comes from the
 * project's machine type, falling back to AUTRE when the type has no pattern row.
 */
export async function getRexPattern(code: string): Promise<RexPattern | null> {
  const db = await getDb();
  const [p] = await db
    .select({ mtCode: projects.machineTypeCode, mtLabel: machineTypes.label })
    .from(projects)
    .leftJoin(machineTypes, eq(machineTypes.code, projects.machineTypeCode))
    .where(eq(projects.code, code));
  if (!p) return null;
  const load = async (mtCode: string) => {
    const [t] = await db.select().from(machineTypes).where(eq(machineTypes.code, mtCode));
    if (!t) return null;
    const refs = await db.select().from(rexReferences).where(eq(rexReferences.machineTypeCode, mtCode)).orderBy(asc(rexReferences.position));
    return { dep: t.depositPct, deliv: t.deliveryPct, acc: t.acceptancePct, refs: refs.map((r) => ({ id: r.analyticCode, name: r.projectName, year: r.year, pattern: r.pattern })) };
  };
  const pattern = (p.mtCode ? await load(p.mtCode) : null) ?? (await load('AUTRE'));
  if (!pattern) return null;
  // R-185: the references of the other equipment lines' types.
  const lines = await listProjectEquipments(code);
  const others: NonNullable<RexPattern['others']> = [];
  for (const l of lines)
    if (l.machineTypeCode !== p.mtCode && !others.some((o) => o.mt === l.typeLabel)) {
      const refs = await db.select().from(rexReferences).where(eq(rexReferences.machineTypeCode, l.machineTypeCode)).orderBy(asc(rexReferences.position));
      others.push({ mt: l.typeLabel, refs: refs.map((r) => ({ id: r.analyticCode, name: r.projectName, year: r.year, pattern: r.pattern })) });
    }
  return { mt: p.mtLabel ?? p.mtCode ?? 'AUTRE', ...pattern, ...(others.length ? { others } : {}) };
}

/** Client contract figures used by Cash & recovery (04 §1.6), read from the contract module (src/server/dal/contract.ts). */
export interface BudgetContract {
  /** "CTR-HLT-001". */
  ref: string;
  /** Base amount (k€). */
  amount: number;
  /** "Net 45 days" — first integer = payment delay in days. */
  terms: string;
  amendments: { label: string; amount: number; signed: boolean }[];
  milestones: PaymentMilestone[];
  /** Orders placed not yet received (k€): the project's purchase orders (delivery 7, R-073). */
  openCommit: number | null;
  /** Business year (R-013): the milestone texts show their year outside it. */
  year: number;
}

/**
 * The project's client contract, or null when none is registered (only HLT-026 in the seed). Billing's invoices and
 * payments and the contract-sheet edits are persisted by the contract module and flow in here. `openCommit` is the
 * project's "orders placed" figure — since delivery 7 (R-073) its open purchase orders (getBudgetData), no longer the
 * prototype's 713 k€ literal.
 */
export async function getBudgetContract(code: string): Promise<BudgetContract | null> {
  const ct = await getCashContract(code);
  if (!ct) return null;
  // R-073: the open purchase orders of the project (src/server/dal/evm.ts), not the stored prototype figure.
  return { ref: ct.reference, amount: ct.amount, terms: ct.terms, amendments: ct.amendments, milestones: ct.milestones, openCommit: await getOpenCommitment(code), year: ct.year };
}

/** R-185: a row of the Budget's "Budget by equipment" table. */
export interface EquipmentCostLine extends EquipmentCostRow {
  /** "EQ-02 · 3 × MEMU"; null for the "Common to the project" row. */
  lotLabel: string | null;
  /** The line's typed label (dataText), null when none. */
  label: string | null;
}

/** R-185: the project's costs by equipment line (src/domain/equipment-costs.ts), read-only. */
export interface EquipmentCosts extends EquipmentCostBreakdown {
  rows: EquipmentCostLine[];
}

/**
 * R-185 (owner's choice 3): the costs of a multi-equipment project broken down by equipment line where the planning lots give
 * it (attribution rule: src/domain/equipment-costs.ts); null for a project with one line or none (the screen stays as it was).
 * Reads the same facts as the Budget's work packages, EV and orders placed (src/server/dal/cost.ts, evm.ts, stock.ts), so the
 * total row equals the figures the screen shows.
 */
export async function getEquipmentCosts(code: string, cost: CostControl): Promise<EquipmentCosts | null> {
  const lines = await listProjectEquipments(code);
  if (!showsEquipment(lines)) return null;
  const db = await getDb();
  const [p] = await db.select({ id: projects.id, currency: projects.currency, budgetRate: projects.budgetRate }).from(projects).where(eq(projects.code, code));
  if (!p) return null;
  const [nodes, acts, stock, orders] = await Promise.all([
    db.select({ id: wbsNodes.id, code: wbsNodes.code, parentId: wbsNodes.parentId, equipmentId: wbsNodes.equipmentId }).from(wbsNodes).where(eq(wbsNodes.projectId, p.id)),
    db
      .select({
        id: activities.id, wbsNodeId: activities.wbsNodeId, equipmentId: activities.equipmentId, budget: activities.budgetKeur, pct: activities.percentComplete,
        actual: activities.actualKeur, eac: activities.eacKeur,
      })
      .from(activities)
      .where(eq(activities.projectId, p.id)),
    // The stock movements stockCostByWorkPackage charges to a work package (SC-5a, R-098), by activity.
    db
      .select({ wbs: stockMovements.wbsCode, activityId: stockMovements.activityId, type: stockMovements.type, value: sql<number>`sum(${stockMovements.valueEur})::float8` })
      .from(stockMovements)
      .where(and(eq(stockMovements.projectId, p.id), inArray(stockMovements.type, ['issue', 'return']), isNotNull(stockMovements.wbsCode), isNotNull(stockMovements.valueEur)))
      .groupBy(stockMovements.wbsCode, stockMovements.activityId, stockMovements.type),
    // The open purchase-order lines getOpenCommitment counts, with the article's BOM line and the order's activity.
    db
      .select({
        orderedQty: poLines.orderedQty, receivedQty: poLines.receivedQty, unitPrice: poLines.unitPriceEur, currency: purchaseOrders.currency,
        activityId: purchaseOrders.neededForActivityId, bomEquipmentId: projectBomLines.equipmentId,
      })
      .from(poLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
      .leftJoin(projectBomLines, and(eq(projectBomLines.projectId, purchaseOrders.projectId), eq(projectBomLines.partId, poLines.partId)))
      .where(and(eq(purchaseOrders.projectId, p.id), inArray(purchaseOrders.status, [...COMMITTED_PO_STATUSES]))),
  ]);
  const fx = projectFxOf(p);
  const breakdown = equipmentCostBreakdown({
    lines,
    wbs: nodes,
    activities: acts,
    workPackages: cost.workPackages,
    stock: stock.filter((m) => m.wbs && m.value).map((m) => ({ wbs: m.wbs!, activityId: m.activityId, amount: ((m.type === 'return' ? -1 : 1) * m.value) / 1000 })),
    openOrders: orders.map((o) => ({
      amount: (Math.max(0, (o.orderedQty || 0) - (o.receivedQty || 0)) * toEur(o.unitPrice || 0, o.currency, fx)) / 1000,
      bomEquipmentId: o.bomEquipmentId, activityId: o.activityId,
    })),
    bac: cost.bac,
    earnedValue: cost.evmSource === 'keystone',
  });
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    ...breakdown,
    rows: breakdown.rows.map((r) => {
      const l = byId.get(r.key);
      return { ...r, lotLabel: l ? equipmentLotLabel(l) : null, label: l?.label ?? null };
    }),
  };
}

export interface BudgetData {
  cost: CostControl;
  rex: RexPattern | null;
  contract: BudgetContract | null;
  /** R-185: costs by equipment line; null unless the project has more than one line. */
  equipment: EquipmentCosts | null;
}

/** Everything the Budget & cost screen reads; null for projects without cost data (empty state). */
export async function getBudgetData(code: string): Promise<BudgetData | null> {
  const cost = await getCostControl(code);
  if (!cost || !cost.ev.length) return null;
  const [rex, contract, equipment] = await Promise.all([getRexPattern(code), getBudgetContract(code), getEquipmentCosts(code, cost)]);
  return { cost, rex, contract, equipment };
}
