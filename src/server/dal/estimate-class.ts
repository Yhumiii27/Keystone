import 'server-only';
// R-188 (estimate class, DIG-PRODI ±50 % / ±30 % / +10 −5 %): the class of each project's current budget — its current
// baseline's class, else the working-budget class of its stage (src/domain/estimate-class.ts `budgetEstimate`). Read by the
// Budget screen (class and range next to the BAC) and the Portfolio overview ("Uncertainty gap").
import { and, eq } from 'drizzle-orm';
import { budgetEstimate, estimateRange, type BudgetEstimate, type EstimateRange } from '@/domain/estimate-class';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { baselines, projects } from '@/server/db/schema';

type Q = DB | Tx;

/** Class of every project's current budget, by project code. */
export async function listBudgetEstimates(q?: Q): Promise<Map<string, BudgetEstimate>> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ code: projects.code, stage: projects.stage, blCode: baselines.code, blClass: baselines.estimateClass })
    .from(projects)
    .leftJoin(baselines, and(eq(baselines.projectId, projects.id), eq(baselines.state, 'current')));
  const out = new Map<string, BudgetEstimate>();
  for (const r of rows) out.set(r.code, budgetEstimate(r.stage, r.blCode ? { code: r.blCode, estimateClass: r.blClass } : null));
  return out;
}

export interface ProjectBudgetEstimate extends BudgetEstimate {
  /** The project's budget (BAC), k€. */
  bac: number;
  /** Low / central / high of the BAC in its class; null when not classified. */
  range: EstimateRange | null;
}

/** Class and range of one project's current budget (null for an unknown project). */
export async function getBudgetEstimate(code: string, q?: Q): Promise<ProjectBudgetEstimate | null> {
  const db = q ?? (await getDb());
  const [p] = await db.select({ id: projects.id, stage: projects.stage, bac: projects.budgetKeur }).from(projects).where(eq(projects.code, code));
  if (!p) return null;
  const [bl] = await db
    .select({ code: baselines.code, estimateClass: baselines.estimateClass })
    .from(baselines)
    .where(and(eq(baselines.projectId, p.id), eq(baselines.state, 'current')));
  const e = budgetEstimate(p.stage, bl ?? null);
  return { ...e, bac: p.bac, range: e.estimateClass ? estimateRange(p.bac, e.estimateClass) : null };
}
