import 'server-only';
// Earned value from Keystone data (delivery 7, R-073; owner decisions C-2a, A-7, A-12, A-15): progress, PV / EV / AC series,
// SPI, CPI and the orders placed of a project, computed at its data date from its activities (budget, % complete, actual
// cost, actual dates), the cost-loaded current baseline, its validated contingency draw-downs, the stock issued to its
// activities in Keystone less the returns (SC-5a, R-098) and its purchase orders (rules: src/domain/cost-control.ts).
// Every screen reads them from here — the Budget, the Schedule's progression curve, the client portal, the Home, the
// Contingency register and the projects register (progress, actual cost, SPI, health).
// A project without activity budgets keeps the figures it has (the prototype's seeded ones: "no Keystone data").
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { cache } from 'react';
import { projectDataDate } from '@/domain/ch4-defaults';
import { businessToday } from '@/server/clock';
import { versionedRead } from '@/server/cache/read-cache';
import { computeEvm, monthIndexOf, openCommitmentKeur, type ComputedEvm, type EvmActivity, type EvmCostEvent, type EvmPlanRow } from '@/domain/cost-control';
import { projectFxOf, toEur } from '@/domain/currency';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { parisParts } from '@/server/db/codes';
import {
  activities, baselineActivities, baselines, contingencyDraws, contingencyRegisters, poLines, projectControls, projects, purchaseOrders, stockMovements,
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

/**
 * A Keystone stock issue (+) or return (−) as a dated cost of its project (SC-5a, R-098): its value in k€, on its Paris
 * calendar day (the stock movement lists show Paris times).
 */
export function stockCostEvent(type: string, at: Date, valueEur: number): EvmCostEvent {
  return { date: parisParts(at).iso, amount: (type === 'return' ? -valueEur : valueEur) / 1000 };
}

/** Loads the inputs of the projects `ids` (all projects when omitted) and computes their earned value. */
async function computeFor(q: Q, ids?: string[]): Promise<Map<string, ProjectEvm>> {
  const today = await businessToday(q);
  const heads: Head[] = (
    await q
      .select({ id: projects.id, code: projects.code, bac: projects.budgetKeur, dataDate: projects.dataDate, startMonth: projects.startMonth, ctlStart: projectControls.startMonth })
      .from(projects)
      .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
      .where(ids ? inArray(projects.id, ids) : undefined)
  ).map((h) => ({ ...h, dataDate: projectDataDate(h, today) }));
  const out = new Map<string, ProjectEvm>();
  if (!heads.length) return out;
  // Four reads for every project at once (the projects register calls this on each request).
  const scope = (col: AnyPgColumn) => (ids ? inArray(col, ids) : undefined);
  const [acts, snapshot, draws, stockMoves] = await Promise.all([
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
    // SC-5a (R-098): stock issued to (returned from) the project's activities in Keystone, valued at the stock unit cost (€).
    // Movements without a value (the X3 seed, whose cost is already in the activities' actuals) count for nothing.
    q
      .select({ projectId: stockMovements.projectId, type: stockMovements.type, at: stockMovements.occurredAt, value: stockMovements.valueEur })
      .from(stockMovements)
      .where(and(scope(stockMovements.projectId), inArray(stockMovements.type, ['issue', 'return']), isNotNull(stockMovements.valueEur))),
  ]);
  // One current baseline per project (the latest when several are marked current).
  const baselineOf = new Map<string, { id: string; position: number }>();
  for (const r of snapshot) {
    const b = baselineOf.get(r.projectId);
    if (!b || r.position > b.position) baselineOf.set(r.projectId, { id: r.baselineId, position: r.position });
  }
  // R-017: grouped in one pass (the list was copied for every activity, quadratic on a large portfolio).
  const actsOf = new Map<string, typeof acts>();
  for (const a of acts) {
    const list = actsOf.get(a.projectId);
    if (list) list.push(a);
    else actsOf.set(a.projectId, [a]);
  }
  const snapshotOf = new Map<string, typeof snapshot>();
  for (const r of snapshot) {
    const list = snapshotOf.get(r.baselineId);
    if (list) list.push(r);
    else snapshotOf.set(r.baselineId, [r]);
  }
  for (const h of heads) {
    const own = actsOf.get(h.id) ?? [];
    if (!own.length) continue;
    const blId = baselineOf.get(h.id)?.id;
    const plan: EvmPlanRow[] = (blId ? snapshotOf.get(blId) ?? [] : []).map((r) => ({ budget: r.budget ?? 0, start: r.start, finish: r.finish }));
    const facts: EvmActivity[] = own.map((a) => ({
      budget: a.budget, actual: a.actual, pct: a.pct, start: a.start, finish: a.finish,
      started: a.startActual || a.pct > 0, finished: a.finishActual || a.pct >= 100,
    }));
    const costs: EvmCostEvent[] = [
      ...draws.filter((d) => d.projectId === h.id).map((d) => ({ date: d.date, amount: d.amount })),
      ...stockMoves.filter((m) => m.projectId === h.id && m.value).map((m) => stockCostEvent(m.type, m.at, m.value!)),
    ];
    // Chart month 0: the Budget's (project controls), else the project's start month, else the first activity's month.
    const firstStart = own.map((a) => a.start).filter((d): d is string => !!d).sort()[0];
    const startMonth = h.ctlStart ?? (h.startMonth != null ? Math.floor(h.startMonth) : monthIndexOf(firstStart ?? h.dataDate));
    const evm = computeEvm({ bac: h.bac, dataDate: h.dataDate, startMonth, activities: facts, plan, costs });
    if (evm) out.set(h.code, { ...evm, projectCode: h.code, dataDate: h.dataDate, bac: h.bac, startMonth });
  }
  return out;
}

/** Earned value of every project computed from Keystone data (memoised per request). Projects without activity budgets are absent. */
// R-017: every page reads it (projects register, shell, project context): computed once per database version (exact, see
// src/server/cache/read-cache.ts) — it reads every activity of the portfolio.
export const listProjectEvms = cache(async (): Promise<Map<string, ProjectEvm>> => {
  const today = await businessToday();
  return versionedRead(`evm|${today}`, async () => computeFor(await getDb()));
});

/** Earned value of a project computed from Keystone data; null when it has no activity budget (keep its own figures). */
export async function getProjectEvm(code: string, q?: Q): Promise<ProjectEvm | null> {
  if (!q) return (await listProjectEvms()).get(code) ?? null;
  const [p] = await q.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  if (!p) return null;
  return (await computeFor(q, [p.id])).get(code) ?? null;
}

/**
 * Orders placed and not yet received of a project, k€ (R-073: Keystone purchase orders, src/domain/cost-control.ts). A line
 * price is in its order's currency (C-9, R-075): converted to euros at the project's budget rate before summing.
 */
export async function getOpenCommitment(code: string, q?: Q): Promise<number> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({
      status: purchaseOrders.status, orderedQty: poLines.orderedQty, receivedQty: poLines.receivedQty, unitPrice: poLines.unitPriceEur,
      currency: purchaseOrders.currency, projectCurrency: projects.currency, budgetRate: projects.budgetRate,
    })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(eq(projects.code, code));
  return openCommitmentKeur(rows.map((r) => ({
    status: r.status, orderedQty: r.orderedQty, receivedQty: r.receivedQty,
    unitPriceEur: toEur(r.unitPrice, r.currency, projectFxOf({ currency: r.projectCurrency, budgetRate: r.budgetRate })),
  })));
}
