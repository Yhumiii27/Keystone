import 'server-only';
// Budget & cost screen data (docs/spec/04 §1): cost control (EVM series, offer, categories, work packages, budget
// change lines, reconciliation — via cost.ts), the REX payment pattern of the project's machine type (Cost profile),
// and the client contract that feeds Cash & recovery (§1.6).
import { asc, eq } from 'drizzle-orm';
import type { MilestoneStatus, PaymentMilestone } from '@/domain/evm';
import { getDb } from '@/server/db/client';
import { machineTypes, projects, rexReferences } from '@/server/db/schema';
import { PROTO } from '@/server/prototype';
import { getCostControl, type CostControl } from './cost';

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

/** Client contract figures used by Cash & recovery (subset of `CONTRACTS[project]`, docs/spec/04 §6). */
export interface BudgetContract {
  /** "CTR-HLT-001". */
  ref: string;
  /** Base amount (k€). */
  amount: number;
  /** "Net 45 days" — first integer = payment delay in days. */
  terms: string;
  amendments: { label: string; amount: number; signed: boolean }[];
  milestones: PaymentMilestone[];
  /** Orders placed not yet in actual cost (k€) when known; null → 60 % of next month's planned value. */
  openCommit: number | null;
}

const MS_STATUS: Record<string, MilestoneStatus> = { Planned: 'planned', Invoiced: 'invoiced', Paid: 'paid' };
const dash = (s: string | null | undefined) => (!s || s === '—' ? null : s);

/**
 * The project's client contract, or null when none is registered (only HLT-026 in the seed).
 * TODO(db): contracts, amendments, payment milestones and invoices are not modelled yet (docs/spec/11) — read from
 * the prototype data. Billing's in-session overrides (issue invoice / mark paid, `ctrOv`/`ctrInv`) and contract-sheet
 * edits (`ctrInfo`) must feed this once the Contract & Billing module persists them. `openCommit` (713 for HLT-026)
 * is the prototype's literal; it should become the open purchase-order value from procurement (04 Q11).
 */
export async function getBudgetContract(code: string): Promise<BudgetContract | null> {
  const ct = (PROTO.CONTRACTS as Record<string, unknown>)[code] as
    | { ref: string; amount: number; terms: string; amendments: [string, number, string, string, string][]; milestones: [string, string, number, string, string, string, string][] }
    | undefined;
  if (!ct) return null;
  return {
    ref: ct.ref,
    amount: ct.amount,
    terms: ct.terms,
    amendments: ct.amendments.map(([label, amount, status]) => ({ label, amount, signed: status === 'Signed' })),
    milestones: ct.milestones.map(([id, label, pct, due, status, inv, paid]) => ({
      id, label, pct, due, status: MS_STATUS[status] ?? 'planned', invoiced: dash(inv), paid: dash(paid),
    })),
    openCommit: code === 'HLT-026' ? 713 : null,
  };
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
