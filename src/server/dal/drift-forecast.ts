import 'server-only';
// R-208 (K-208 alt1): inputs of the rule-based drift forecast of a project (src/domain/drift-forecast.ts) — the earned value
// (src/server/dal/evm.ts, else the project's own figures), the schedule as the last Reschedule stored it (activities' current
// dates, total float, critical flag; milestones and their anchor's float), the previous weekly snapshot's float, the orders
// placed not yet received, the contingency left and the latest Monte-Carlo run (R-205). Reads stored values only (no CPM run),
// so the portfolio can ask it for every project.
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { forecastDrift, type DriftActivity, type DriftForecast, type DriftInput, type DriftMilestone } from '@/domain/drift-forecast';
import { projectDataDate } from '@/domain/ch4-defaults';
import { projectFloat } from '@/domain/schedule-rollup';
import { businessToday } from '@/server/clock';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { activities, milestones, projects, statusSnapshots } from '@/server/db/schema';
import { getContingencyTotals } from './contingency';
import { getOpenCommitment, getProjectEvm } from './evm';
import { getRiskAnalysis } from './risk-analysis';

type Q = DB | Tx;

export interface ProjectDrift {
  projectCode: string;
  dataDate: string;
  targetSource: 'planned' | 'baseline' | 'none';
  /** Activity names by code (the suggestions name activities by code; the screen shows "A1250 · Steel structure"). */
  names: Record<string, string>;
  /** When the Monte-Carlo run used was made (null: none). */
  monteCarloRanAt: Date | null;
  forecast: DriftForecast;
}

/** The drift forecast of a project; null for an unknown project. */
export async function getDriftForecast(code: string, q?: Q): Promise<ProjectDrift | null> {
  const db = q ?? (await getDb());
  const [p] = await db
    .select({ id: projects.id, code: projects.code, dataDate: projects.dataDate, bac: projects.budgetKeur, actual: projects.actualKeur, progress: projects.progress, spi: projects.spi })
    .from(projects)
    .where(eq(projects.code, code));
  if (!p) return null;
  const dataDate = projectDataDate(p, await businessToday(db));
  const [evm, acts, ms, prevSnap, commitment, contingency, analysis] = await Promise.all([
    getProjectEvm(p.code, q),
    db
      .select({
        id: activities.id, code: activities.code, name: activities.name, start: activities.startDate, finish: activities.finishDate, startActual: activities.startActual,
        finishActual: activities.finishActual, pct: activities.percentComplete, critical: activities.critical, tf: activities.totalFloatDays, budget: activities.budgetKeur,
        eac: activities.eacKeur,
      })
      .from(activities)
      .where(eq(activities.projectId, p.id))
      .orderBy(asc(activities.position)),
    db.select({ name: milestones.name, status: milestones.status, activityId: milestones.activityId }).from(milestones).where(eq(milestones.projectId, p.id)).orderBy(asc(milestones.position)),
    db
      .select({ floatDays: statusSnapshots.floatDays })
      .from(statusSnapshots)
      .where(and(eq(statusSnapshots.projectId, p.id), lt(statusSnapshots.statusDate, dataDate)))
      .orderBy(desc(statusSnapshots.statusDate))
      .limit(1),
    getOpenCommitment(p.code, q),
    getContingencyTotals(p.code),
    getRiskAnalysis(p.code, q),
  ]);
  const facts: DriftActivity[] = acts.map((a) => {
    const complete = a.finishActual && a.startActual;
    return {
      code: a.code, name: a.name, complete, inProgress: !complete && (a.startActual || a.pct > 0), critical: !complete && (a.critical === true || (a.tf != null && a.tf <= 0)),
      totalFloat: complete ? null : a.tf, start: a.start, finish: a.finish, budget: a.budget, eac: a.eac,
    };
  });
  const floatOf = new Map(acts.map((a) => [a.id, a.finishActual && a.startActual ? null : a.tf]));
  const mils: DriftMilestone[] = ms.map((m) => ({ name: m.name, status: m.status, floatDays: m.activityId ? floatOf.get(m.activityId) ?? null : null }));
  const finishes = acts.map((a) => a.finish).filter((d): d is string => !!d).sort();
  const run = analysis?.latest ?? null;
  // Earned value from Keystone data; else the project's own figures (seeded projects without activity budgets).
  const ev = evm
    ? { bac: evm.bac, ev: evm.ev, ac: evm.ac, pv: evm.pv, cpi: evm.cpi, spi: evm.spi, progress: evm.progress }
    : p.actual > 0 && p.progress > 0
      ? { bac: p.bac, ev: p.bac * p.progress, ac: p.actual, pv: p.spi ? (p.bac * p.progress) / p.spi : p.bac * p.progress, cpi: (p.bac * p.progress) / p.actual, spi: p.spi ?? null, progress: p.progress }
      : null;
  const input: DriftInput = {
    dataDate,
    currentFinish: finishes[finishes.length - 1] ?? null,
    targetFinish: analysis?.target.finish ?? null,
    evm: ev,
    activities: facts,
    milestones: mils,
    currentFloat: facts.some((a) => !a.complete) ? projectFloat(facts.filter((a) => !a.complete).map((a) => a.totalFloat)) : null,
    previousFloat: prevSnap[0]?.floatDays ?? null,
    openCommitmentKeur: commitment,
    contingencyLeftKeur: contingency ? contingency.initial - contingency.drawn : null,
    monteCarlo: run
      ? {
          dataDate: run.dataDate, stale: analysis!.stale, p80Finish: run.result.finish.dates.p80, p80Cost: run.result.cost.p80,
          probOnTarget: run.result.finish.probOnTarget, probWithinBudget: run.result.cost.probWithinTarget, drivers: run.result.tornado.map((d) => d.id),
        }
      : null,
  };
  return {
    projectCode: p.code, dataDate, targetSource: analysis?.target.source ?? 'none', names: Object.fromEntries(acts.map((a) => [a.code, a.name])),
    monteCarloRanAt: run?.ranAt ?? null, forecast: forecastDrift(input),
  };
}
