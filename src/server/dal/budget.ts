import 'server-only';
// Budget & cost screen data (docs/spec/04 §1): cost control (EVM series, offer, categories, work packages, budget
// change lines, reconciliation — via cost.ts), the REX payment pattern of the project's machine type (Cost profile),
// and the client contract that feeds Cash & recovery (§1.6).
import { asc, eq } from 'drizzle-orm';
import type { PaymentMilestone } from '@/domain/evm';
import { getDb } from '@/server/db/client';
import { machineTypes, projects, rexReferences } from '@/server/db/schema';
import { getCashContract } from './contract';
import { getCostControl, type CostControl } from './cost';
import { getOpenCommitment } from './evm';

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
  return { mt: p.mtLabel ?? p.mtCode ?? 'AUTRE', ...pattern };
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
  return { ref: ct.reference, amount: ct.amount, terms: ct.terms, amendments: ct.amendments, milestones: ct.milestones, openCommit: await getOpenCommitment(code) };
}

export interface BudgetData {
  cost: CostControl;
  rex: RexPattern | null;
  contract: BudgetContract | null;
}

/** Everything the Budget & cost screen reads; null for projects without cost data (empty state). */
export async function getBudgetData(code: string): Promise<BudgetData | null> {
  const cost = await getCostControl(code);
  if (!cost || !cost.ev.length) return null;
  const [rex, contract] = await Promise.all([getRexPattern(code), getBudgetContract(code)]);
  return { cost, rex, contract };
}
