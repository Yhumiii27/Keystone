import 'server-only';
// Earned value from Keystone data (delivery 7, R-073; owner decisions C-2a, A-7, A-12, A-15): progress, PV / EV / AC series,
// SPI, CPI and the orders placed of a project, computed at its data date from its activities (budget, % complete, actual
// cost, actual dates), the cost-loaded current baseline, its validated contingency draw-downs and its purchase orders
// (rules: src/domain/cost-control.ts). Every screen reads them from here — the Budget, the Schedule's progression curve,
// the client portal, the Home, the Contingency register and the projects register (progress, actual cost, SPI, health).
// A project without activity budgets keeps the figures it has (the prototype's seeded ones: "no Keystone data").
import { and, asc, eq, inArray } from 'drizzle-orm';
import { cache } from 'react';
import { projectDataDate } from '@/domain/ch4-defaults';
import { computeEvm, monthIndexOf, openCommitmentKeur, type ComputedEvm, type EvmActivity, type EvmCostEvent, type EvmPlanRow } from '@/domain/cost-control';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb, type DB, type Tx } from '@/server/db/client';
import {
  activities, baselineActivities, baselines, contingencyDraws, contingencyRegisters, poLines, projectControls, projects, purchaseOrders,
} from '@/server/db/schema';

type Q = DB | Tx;

export interface ProjectEvm extends ComputedEvm {
  projectCode: string;
  /** Data date the figures are computed at (ISO). */
  dataDate: string;
  bac: number;
  /** Chart month 0 (month index from Jan 2026). */
  startMonth: number;
}

interface Head {
  id: string;
  code: string;
  bac: number;
  dataDate: string;
  startMonth: number | null;
  ctlStart: number | null;
}

/** Loads the inputs of the projects `ids` (all projects when omitted) and computes their earned value. */
async function computeFor(q: Q, ids?: string[]): Promise<Map<string, ProjectEvm>> {
  const heads: Head[] = (
    await q
      .select({ id: projects.id, code: projects.code, bac: projects.budgetKeur, dataDate: projects.dataDate, startMonth: projects.startMonth, ctlStart: projectControls.startMonth })
      .from(projects)
      .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
      .where(ids ? inArray(projects.id, ids) : undefined)
  ).map((h) => ({ ...h, dataDate: projectDataDate(h) }));
  const out = new Map<string, ProjectEvm>();
  if (!heads.length) return out;
  // Three reads for every project at once (the projects register calls this on each request).
  const scope = (col: AnyPgColumn) => (ids ? inArray(col, ids) : undefined);
  const [acts, snapshot, draws] = await Promise.all([
    q
      .select({
        projectId: activities.projectId, budget: activities.budgetKeur, actual: activities.actualKeur, pct: activities.percentComplete,
        start: activities.startDate, finish: activities.finishDate, startActual: activities.startActual, finishActual: activities.finishActual,
      })
      .from(activities)
      .where(scope(activities.projectId)),
    // The activity snapshot of the current baseline(s).
    q
      .select({
        projectId: baselines.projectId, baselineId: baselines.id, position: baselines.position,
        budget: baselineActivities.budgetKeur, start: baselineActivities.startDate, finish: baselineActivities.finishDate,
      })
      .from(baselineActivities)
      .innerJoin(baselines, eq(baselines.id, baselineActivities.baselineId))
      .where(and(scope(baselines.projectId), eq(baselines.state, 'current')))
      .orderBy(asc(baselineActivities.position)),
    q
      .select({ projectId: contingencyRegisters.projectId, date: contingencyDraws.drawnOn, amount: contingencyDraws.amountKeur })
      .from(contingencyDraws)
      .innerJoin(contingencyRegisters, eq(contingencyRegisters.id, contingencyDraws.registerId))
      .where(and(scope(contingencyRegisters.projectId), eq(contingencyDraws.status, 'validated'))),
  ]);
  // One current baseline per project (the latest when several are marked current).
  const baselineOf = new Map<string, { id: string; position: number }>();
  for (const r of snapshot) {
    const b = baselineOf.get(r.projectId);
    if (!b || r.position > b.position) baselineOf.set(r.projectId, { id: r.baselineId, position: r.position });
  }
  const actsOf = new Map<string, typeof acts>();
  for (const a of acts) actsOf.set(a.projectId, [...(actsOf.get(a.projectId) ?? []), a]);
  for (const h of heads) {
    const own = actsOf.get(h.id) ?? [];
    if (!own.length) continue;
    const blId = baselineOf.get(h.id)?.id;
    const plan: EvmPlanRow[] = snapshot.filter((r) => r.baselineId === blId).map((r) => ({ budget: r.budget ?? 0, start: r.start, finish: r.finish }));
    const facts: EvmActivity[] = own.map((a) => ({
      budget: a.budget, actual: a.actual, pct: a.pct, start: a.start, finish: a.finish,
      started: a.startActual || a.pct > 0, finished: a.finishActual || a.pct >= 100,
    }));
    const costs: EvmCostEvent[] = draws.filter((d) => d.projectId === h.id).map((d) => ({ date: d.date, amount: d.amount }));
    // Chart month 0: the Budget's (project controls), else the project's start month, else the first activity's month.
    const firstStart = own.map((a) => a.start).filter((d): d is string => !!d).sort()[0];
    const startMonth = h.ctlStart ?? (h.startMonth != null ? Math.floor(h.startMonth) : monthIndexOf(firstStart ?? h.dataDate));
    const evm = computeEvm({ bac: h.bac, dataDate: h.dataDate, startMonth, activities: facts, plan, costs });
    if (evm) out.set(h.code, { ...evm, projectCode: h.code, dataDate: h.dataDate, bac: h.bac, startMonth });
  }
  return out;
}

/** Earned value of every project computed from Keystone data (memoised per request). Projects without activity budgets are absent. */
export const listProjectEvms = cache(async (): Promise<Map<string, ProjectEvm>> => computeFor(await getDb()));

/** Earned value of a project computed from Keystone data; null when it has no activity budget (keep its own figures). */
export async function getProjectEvm(code: string, q?: Q): Promise<ProjectEvm | null> {
  if (!q) return (await listProjectEvms()).get(code) ?? null;
  const [p] = await q.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  if (!p) return null;
  return (await computeFor(q, [p.id])).get(code) ?? null;
}

/** Orders placed and not yet received of a project, k€ (R-073: Keystone purchase orders, src/domain/cost-control.ts). */
export async function getOpenCommitment(code: string, q?: Q): Promise<number> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ status: purchaseOrders.status, orderedQty: poLines.orderedQty, receivedQty: poLines.receivedQty, unitPriceEur: poLines.unitPriceEur })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(eq(projects.code, code));
  return openCommitmentKeur(rows);
}
