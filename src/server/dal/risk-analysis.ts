import 'server-only';
// R-205 (K-205, K-205b): Monte-Carlo risk analysis of a project — inputs (the schedule network as Reschedule reads it, the
// activities' cost at completion and actual cost, the three-point estimates entered by the project manager, the open risks
// linked to an activity with their delay), the stored runs and the writers (ranges, delays, run), each with its audit row and
// activity event. Pure model: src/domain/monte-carlo.ts. The Server Functions (src/features/risk-analysis/actions.ts) check the
// viewer's rights before calling the writers.
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { defaultRiskDelay, riskOccurrence, seedOf, simulate, type McActivity, type McResult, type McRisk, type ThreePoint } from '@/domain/monte-carlo';
import { systemMessage } from '@/domain/system-messages';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, projects, riskAnalysisDelays, riskAnalysisRanges, riskAnalysisRuns, risks } from '@/server/db/schema';
import type { Actor } from './ops-common';
import type { CpmInput } from '@/domain/cpm';
import { loadScheduleNetwork } from './schedule-network';

type Q = DB | Tx;

export type TargetFinishSource = 'planned' | 'baseline' | 'none';

export interface RangeActivity {
  /** Database id. */
  id: string;
  code: string;
  name: string;
  state: 'complete' | 'in_progress' | 'not_started';
  /** Original duration (working days) and remaining duration as the CPM schedules it. */
  duration: number;
  /** Cost at completion (EAC) and actual cost, k€. */
  eac: number;
  actual: number;
  critical: boolean;
  totalFloat: number | null;
  /** Entered three-point estimates; null = the default range. */
  durationRange: ThreePoint | null;
  costRange: ThreePoint | null;
}

export interface AnalysisRisk {
  id: string;
  number: string;
  title: string;
  activityCode: string | null;
  probability: number;
  impact: number;
  costKeur: number;
  /** Delay if it occurs (working days): entered, else the default from the impact. */
  delayDays: number;
  delayEntered: boolean;
}

export interface StoredRun {
  id: string;
  ranAt: Date;
  ranByName: string;
  dataDate: string;
  iterations: number;
  targetFinish: string | null;
  targetFinishSource: TargetFinishSource;
  targetCostKeur: number | null;
  durationMs: number;
  /** Fingerprint of the inputs the run read ('' for none). */
  fingerprint: string;
  result: McResult;
}

export interface RiskAnalysisData {
  projectCode: string;
  dataDate: string;
  activities: RangeActivity[];
  risks: AnalysisRisk[];
  latest: StoredRun | null;
  /** The latest run predates a change of its inputs (data date, activities, links, risks, ranges, delays, targets). */
  stale: boolean;
  /** Fingerprint of the current inputs (stored with a run). */
  fingerprint: string;
  target: { finish: string | null; source: TargetFinishSource; costKeur: number };
}

const triple = (min: number | null, likely: number | null, maxV: number | null): ThreePoint | null =>
  min != null && likely != null && maxV != null ? { min, likely, max: maxV } : null;

/** Target finish: the project's planned finish (wizard), else the baseline finish (latest BL1 finish of its activities). */
async function targetOf(q: Q, projectId: string): Promise<{ finish: string | null; source: TargetFinishSource; costKeur: number }> {
  const [p] = await q.select({ planned: projects.plannedFinishDate, bac: projects.budgetKeur }).from(projects).where(eq(projects.id, projectId));
  if (p?.planned) return { finish: p.planned, source: 'planned', costKeur: p.bac };
  const [b] = await q.select({ finish: max(activities.baselineFinishDate) }).from(activities).where(eq(activities.projectId, projectId));
  return b?.finish ? { finish: b.finish, source: 'baseline', costKeur: p?.bac ?? 0 } : { finish: null, source: 'none', costKeur: p?.bac ?? 0 };
}

const runOf = (r: typeof riskAnalysisRuns.$inferSelect): StoredRun => ({
  id: r.id, ranAt: r.ranAt, ranByName: r.ranByName, dataDate: r.dataDate, iterations: r.iterations, targetFinish: r.targetFinish,
  targetFinishSource: r.targetFinishSource, targetCostKeur: r.targetCostKeur, durationMs: r.durationMs,
  fingerprint: typeof r.inputs?.fingerprint === 'string' ? r.inputs.fingerprint : '', result: r.result as unknown as McResult,
});

/** Latest stored run of each project (the drift forecast, R-208). */
export async function latestRiskAnalysisRuns(projectIds?: string[], q?: Q): Promise<Map<string, StoredRun>> {
  const db = q ?? (await getDb());
  const rows = await db
    .select()
    .from(riskAnalysisRuns)
    .where(projectIds ? inArray(riskAnalysisRuns.projectId, projectIds) : undefined)
    .orderBy(desc(riskAnalysisRuns.ranAt));
  const out = new Map<string, StoredRun>();
  for (const r of rows) if (!out.has(r.projectId)) out.set(r.projectId, runOf(r));
  return out;
}

/** Latest stored run of every project, by project code (the portfolio alerts: one read, no simulation). */
export async function latestRiskAnalysisRunsByCode(q?: Q): Promise<Map<string, StoredRun>> {
  const db = q ?? (await getDb());
  const [runs, codes] = await Promise.all([latestRiskAnalysisRuns(undefined, db), db.select({ id: projects.id, code: projects.code }).from(projects)]);
  const out = new Map<string, StoredRun>();
  for (const p of codes) {
    const r = runs.get(p.id);
    if (r) out.set(p.code, r);
  }
  return out;
}

/** Latest stored run of a project; null when it was never run. */
export async function latestRiskAnalysis(code: string, q?: Q): Promise<StoredRun | null> {
  const db = q ?? (await getDb());
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  if (!p) return null;
  return (await latestRiskAnalysisRuns([p.id], db)).get(p.id) ?? null;
}

/** Everything the "Risk analysis" section shows; null for an unknown project. */
export async function getRiskAnalysis(code: string, q?: Q): Promise<RiskAnalysisData | null> {
  const db = q ?? (await getDb());
  const network = await loadScheduleNetwork(code, db, { suppliers: true });
  if (!network) return null;
  const pid = network.projectId;
  const [acts, ranges, riskRows, delays, latest, target] = await Promise.all([
    db
      .select({ id: activities.id, eac: activities.eacKeur, actual: activities.actualKeur })
      .from(activities)
      .where(eq(activities.projectId, pid)),
    db.select().from(riskAnalysisRanges).where(eq(riskAnalysisRanges.projectId, pid)),
    db
      .select({
        id: risks.id, number: risks.number, title: risks.title, activityId: risks.activityId, probability: risks.probability, impact: risks.impact,
        costKeur: risks.costKeur, status: risks.status, sortOrder: risks.sortOrder,
      })
      .from(risks)
      .where(eq(risks.projectId, pid))
      .orderBy(asc(risks.sortOrder)),
    db.select().from(riskAnalysisDelays).where(eq(riskAnalysisDelays.projectId, pid)),
    latestRiskAnalysisRuns([pid], db),
    targetOf(db, pid),
  ]);
  const costOf = new Map(acts.map((a) => [a.id, a]));
  const rangeOf = new Map(ranges.map((r) => [r.activityId, r]));
  const codeOf = new Map(network.activities.map((a) => [a.dbId, a.code]));
  const delayOf = new Map(delays.map((d) => [d.riskId, d]));
  const activityRows: RangeActivity[] = network.activities.map((a) => {
    const r = rangeOf.get(a.dbId);
    const c = costOf.get(a.dbId);
    return {
      id: a.dbId, code: a.code, name: a.name,
      state: a.finishActual && a.startActual ? 'complete' : a.startActual ? 'in_progress' : 'not_started',
      duration: a.durationDays, eac: c?.eac ?? 0, actual: c?.actual ?? 0, critical: !!a.critical || (a.totalFloatDays != null && a.totalFloatDays <= 0),
      totalFloat: a.totalFloatDays,
      durationRange: r ? triple(r.durationMin, r.durationLikely, r.durationMax) : null,
      costRange: r ? triple(r.costMinKeur, r.costLikelyKeur, r.costMaxKeur) : null,
    };
  });
  const openRisks: AnalysisRisk[] = riskRows
    .filter((r) => r.status === 'open')
    .map((r) => {
      const d = delayOf.get(r.id);
      return {
        id: r.id, number: r.number, title: r.title, activityCode: r.activityId ? codeOf.get(r.activityId) ?? null : null, probability: r.probability,
        impact: r.impact, costKeur: r.costKeur ?? 0, delayDays: d ? d.delayDays : defaultRiskDelay(r.impact), delayEntered: !!d,
      };
    });
  const last = latest.get(pid) ?? null;
  const out: RiskAnalysisData = {
    projectCode: network.projectCode, dataDate: network.dataDate, activities: activityRows, risks: openRisks, latest: last, stale: false, target, fingerprint: '',
  };
  out.fingerprint = fingerprintOf(network.input, out);
  out.stale = !!last && last.fingerprint !== out.fingerprint;
  return out;
}

/**
 * Fingerprint of everything a run reads (network with progress, links, calendars' codes, data date, costs, ranges, risks and
 * delays, targets): a run whose fingerprint differs from the current one is out of date. Covers deletions (a range cleared, a
 * risk closed), which timestamps would miss.
 */
function fingerprintOf(network: CpmInput, data: Omit<RiskAnalysisData, 'fingerprint' | 'stale' | 'latest'>): string {
  const inputs = simulationInputs(data);
  const text = JSON.stringify({
    d: network.dataDate, s: network.projectStart ?? null, c: network.projectCalendar, a: network.activities, l: network.links, m: inputs.activities,
    r: inputs.risks, t: data.target,
  });
  return `${seedOf(text).toString(36)}-${seedOf(text.split('').reverse().join('')).toString(36)}-${text.length}`;
}

/** The simulation inputs of a project (exported for the tests). */
export function simulationInputs(data: Pick<RiskAnalysisData, 'activities' | 'risks'>): { activities: McActivity[]; risks: McRisk[] } {
  return {
    activities: data.activities.map((a) => ({ id: a.code, duration: a.durationRange, cost: a.costRange, refCost: a.eac, actualCost: a.actual })),
    risks: data.risks.map((r) => ({
      id: r.number, activityId: r.activityCode, probability: riskOccurrence(r.probability), delayDays: r.delayDays, costKeur: r.costKeur,
    })),
  };
}

export class RiskAnalysisError extends Error {}

/**
 * Runs the analysis (server side, on request) and stores the run with its date and inputs summary, audited. The seed follows the
 * project, its data date and the iterations, so the same inputs give the same result. Throws the CPM errors (cycle, invalid
 * network) and RiskAnalysisError (no activity).
 */
export async function runRiskAnalysis(code: string, iterations: number, actor: Actor): Promise<StoredRun> {
  const db = await getDb();
  const network = await loadScheduleNetwork(code, db, { suppliers: true });
  if (!network) throw new RiskAnalysisError('Unknown project');
  const data = await getRiskAnalysis(code, db);
  if (!data || !network.input.activities.length) throw new RiskAnalysisError('The project has no activity to simulate');
  const inputs = simulationInputs(data);
  const seed = seedOf(`${data.projectCode}|${data.dataDate}|${iterations}`);
  const t0 = Date.now();
  const result = simulate({
    network: network.input, activities: inputs.activities, risks: inputs.risks, iterations, seed,
    targetFinish: data.target.finish, targetCost: data.target.costKeur,
  });
  const durationMs = Date.now() - t0;
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, data.projectCode);
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    const summary = { ...result.inputs, fingerprint: data.fingerprint, iterations, seed, targetFinish: data.target.finish, targetFinishSource: data.target.source, targetCostKeur: data.target.costKeur };
    const [row] = await tx
      .insert(riskAnalysisRuns)
      .values({
        projectId: p.id, ranByPersonId: person?.id ?? null, ranByName: who, dataDate: data.dataDate, iterations, seed, targetFinish: data.target.finish,
        targetFinishSource: data.target.source, targetCostKeur: data.target.costKeur, inputs: summary, result: result as unknown as Record<string, unknown>, durationMs,
      })
      .returning();
    const message = systemMessage('riskAnalysis.run', { iterations, p80: result.finish.dates.p80, p80Cost: Math.round(result.cost.p80) });
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: data.projectCode, message, area: 'Risks', entityType: 'risk_analysis_run', entityId: row.id,
      projectId: p.id,
      after: {
        iterations, dataDate: data.dataDate, p50Finish: result.finish.dates.p50, p80Finish: result.finish.dates.p80, p90Finish: result.finish.dates.p90,
        p50Cost: result.cost.p50, p80Cost: result.cost.p80, p90Cost: result.cost.p90, probOnTarget: result.finish.probOnTarget, probWithinBudget: result.cost.probWithinTarget,
      },
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, kind: 'change', projectId: p.id, message });
    return runOf(row);
  });
}

const tripleJson = (t: ThreePoint | null) => (t ? { min: t.min, likely: t.likely, max: t.max } : null);

/**
 * Sets (both null: clears) the three-point estimates of one activity of the project. Audited with before / after. Throws
 * RiskAnalysisError('Unknown activity') for an activity of another project.
 */
export async function saveActivityRange(code: string, activityId: string, duration: ThreePoint | null, cost: ThreePoint | null, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const [a] = await tx.select({ id: activities.id, code: activities.code }).from(activities).where(and(eq(activities.id, activityId), eq(activities.projectId, p.id)));
    if (!a) throw new RiskAnalysisError('Unknown activity');
    const [prev] = await tx.select().from(riskAnalysisRanges).where(eq(riskAnalysisRanges.activityId, a.id)).for('update');
    const before = prev
      ? { duration: tripleJson(triple(prev.durationMin, prev.durationLikely, prev.durationMax)), cost: tripleJson(triple(prev.costMinKeur, prev.costLikelyKeur, prev.costMaxKeur)) }
      : { duration: null, cost: null };
    const after = { duration: tripleJson(duration), cost: tripleJson(cost) };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    if (!duration && !cost) {
      if (prev) await tx.delete(riskAnalysisRanges).where(eq(riskAnalysisRanges.id, prev.id));
    } else {
      const values = {
        durationMin: duration?.min ?? null, durationLikely: duration?.likely ?? null, durationMax: duration?.max ?? null,
        costMinKeur: cost?.min ?? null, costLikelyKeur: cost?.likely ?? null, costMaxKeur: cost?.max ?? null,
        updatedByPersonId: person?.id ?? null, updatedByName: who, updatedAt: new Date(),
      };
      if (prev) await tx.update(riskAnalysisRanges).set(values).where(eq(riskAnalysisRanges.id, prev.id));
      else await tx.insert(riskAnalysisRanges).values({ projectId: p.id, activityId: a.id, ...values });
    }
    const message = systemMessage(!duration && !cost ? 'riskAnalysis.rangeCleared' : 'riskAnalysis.rangeSet', { activity: a.code });
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: `${code} · ${a.code}`, message, area: 'Risks', entityType: 'activity', entityId: a.id, projectId: p.id,
      before, after,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, kind: 'change', projectId: p.id, message });
  });
}

/** Sets (null: back to the default) the delay of one open risk of the project. Audited. */
export async function saveRiskDelay(code: string, riskId: string, delayDays: number | null, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, code);
    const [r] = await tx.select({ id: risks.id, number: risks.number, impact: risks.impact }).from(risks).where(and(eq(risks.id, riskId), eq(risks.projectId, p.id)));
    if (!r) throw new RiskAnalysisError('Unknown risk');
    const [prev] = await tx.select().from(riskAnalysisDelays).where(eq(riskAnalysisDelays.riskId, r.id)).for('update');
    if ((prev?.delayDays ?? null) === delayDays) return;
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    if (delayDays == null) {
      if (prev) await tx.delete(riskAnalysisDelays).where(eq(riskAnalysisDelays.id, prev.id));
    } else if (prev) {
      await tx.update(riskAnalysisDelays).set({ delayDays, updatedByPersonId: person?.id ?? null, updatedByName: who, updatedAt: new Date() }).where(eq(riskAnalysisDelays.id, prev.id));
    } else {
      await tx.insert(riskAnalysisDelays).values({ projectId: p.id, riskId: r.id, delayDays, updatedByPersonId: person?.id ?? null, updatedByName: who });
    }
    const message = delayDays == null ? systemMessage('riskAnalysis.delayCleared', { risk: r.number }) : systemMessage('riskAnalysis.delaySet', { risk: r.number, days: delayDays });
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: `${code} · ${r.number}`, message, area: 'Risks', entityType: 'risk', entityId: r.id, projectId: p.id,
      before: { delayDays: prev?.delayDays ?? null, default: defaultRiskDelay(r.impact) }, after: { delayDays },
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, kind: 'change', projectId: p.id, message });
  });
}
