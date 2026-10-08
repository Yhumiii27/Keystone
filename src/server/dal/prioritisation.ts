import 'server-only';
// Portfolio prioritisation & capacity DAL (docs/spec/03 §6; 11 §3.2 PortfolioScore / ScoreWeight). Score =
// 100 × Σ (s_i / 5) × (w_i / Σw) (logic 4499). Ranked population: zone projects with scores, excluding Clos and
// Annulé (the prototype compared legacy English statuses and so excluded nothing, 03 A.1). SCORES' obsolete keys are
// remapped at seed (00 §7.16). Margin comes from the billing plan, i.e. the contract when one exists (A-5): HLT-026
// shows 13 % (contract €5.52M) where the prototype's BILLING gave 11 % (€5.40M).
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { scoreAxis, type ScoreAxis, type StageCode } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { capacityDemandRates, departmentCapacities, departments, portfolioScores, projects, scoreAxes, scoreWeights, users } from '@/server/db/schema';
import type { ZoneKey } from '@/server/session';
import { listBillingPlans, marginPct } from './cashflow';
import { listProjects, type ProjectRow } from './projects';

export interface ScoreAxisRow {
  code: ScoreAxis;
  /** EN source label ("Strategic fit"). */
  label: string;
  defaultWeight: number;
}

/** SCORE_AXES order. */
export async function listScoreAxes(): Promise<ScoreAxisRow[]> {
  const db = await getDb();
  const rows = await db.select().from(scoreAxes).orderBy(asc(scoreAxes.position));
  return rows.map((r) => ({ code: r.code, label: r.label, defaultWeight: r.defaultWeight }));
}

/** Weights of a viewer (role) — their saved weights over the defaults (`pfWeights`). */
export async function getScoreWeights(role: string): Promise<Record<ScoreAxis, number>> {
  const db = await getDb();
  const axes = await listScoreAxes();
  const saved = await db
    .select({ axis: scoreWeights.axis, weight: scoreWeights.weight })
    .from(scoreWeights)
    .innerJoin(users, eq(users.id, scoreWeights.userId))
    .where(eq(users.role, role));
  const w = Object.fromEntries(axes.map((a) => [a.code, a.defaultWeight])) as Record<ScoreAxis, number>;
  for (const s of saved) w[s.axis] = s.weight;
  return w;
}

/** Weight input of the Weights card (`setW`: NaN → 0, saved per user). Weights are not normalised (the sum is shown). */
export async function setScoreWeight(role: string, axis: ScoreAxis, weight: number): Promise<void> {
  if (!scoreAxis.isCode(axis)) throw new Error(`Unknown axis ${axis}`);
  const w = Number.isFinite(weight) ? Math.max(0, weight) : 0;
  const db = await getDb();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.role, role));
  if (!u) throw new Error(`Unknown role ${role}`);
  await db.insert(scoreWeights).values({ userId: u.id, axis, weight: w })
    .onConflictDoUpdate({ target: [scoreWeights.userId, scoreWeights.axis], set: { weight: w, updatedAt: new Date() } });
}

/** Back to the SCORE_AXES defaults for a viewer. */
export async function resetScoreWeights(role: string): Promise<void> {
  const db = await getDb();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.role, role));
  if (u) await db.delete(scoreWeights).where(eq(scoreWeights.userId, u.id));
}

/** Scores per project code, in axis order ([fit, margin, risk, res, client]). */
export async function listPortfolioScores(): Promise<Record<string, number[]>> {
  const db = await getDb();
  const [axes, rows] = await Promise.all([
    listScoreAxes(),
    db.select({ code: projects.code, axis: portfolioScores.axis, score: portfolioScores.score }).from(portfolioScores).innerJoin(projects, eq(projects.id, portfolioScores.projectId)),
  ]);
  const out: Record<string, number[]> = {};
  for (const r of rows) (out[r.code] ??= axes.map(() => 0))[axes.findIndex((a) => a.code === r.axis)] = r.score;
  return out;
}

/** 100 × Σ (s_i / 5) × (w_i / Σw), unrounded; Σw = 0 counts as 1 (`wSum || 1`). */
export function priorityScore(scores: number[], weights: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return scores.reduce((a, s, i) => a + (s / 5) * ((weights[i] ?? 0) / sum), 0) * 100;
}

export interface RankedProject {
  rank: number;
  project: ProjectRow;
  /** Axis order. */
  scores: number[];
  /** Rounded score (0–100). */
  score: number;
  /** Margin % from the billing plan; null = internal or no plan. */
  marginPct: number | null;
  pipeline: boolean;
}

export interface Prioritisation {
  axes: ScoreAxisRow[];
  /** Viewer's weights in axis order and their sum. */
  weights: number[];
  weightSum: number;
  ranking: RankedProject[];
  /** Zone projects in execution / pipeline (KPI tiles). */
  active: ProjectRow[];
  pipeline: ProjectRow[];
}

const PIPELINE: ReadonlySet<StageCode> = new Set(['initiative', 'aps', 'apd']);
const EXECUTION: ReadonlySet<StageCode> = new Set(['etudes', 'approvisionnements', 'fabrication_assemblage', 'fat', 'expedition', 'chantier', 'mise_en_service_sat']);
const CLOSED: ReadonlySet<StageCode> = new Set(['clos', 'annule']);

/** Ranking, weights and KPI populations of the Prioritisation tab for a viewer (role) and zone. */
export async function getPrioritisation(role: string, zone: ZoneKey | null): Promise<Prioritisation> {
  const [axes, w, scores, plans, all] = await Promise.all([listScoreAxes(), getScoreWeights(role), listPortfolioScores(), listBillingPlans(), listProjects()]);
  const zp = all.filter((p) => !zone || p.zone === zone);
  const weights = axes.map((a) => w[a.code]);
  const ranking = zp
    .filter((p) => scores[p.code] && !CLOSED.has(p.stage))
    .map((p) => ({ project: p, scores: scores[p.code], score: Math.round(priorityScore(scores[p.code], weights)), marginPct: marginPct(plans[p.code], p.budget), pipeline: PIPELINE.has(p.stage) }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ rank: i + 1, ...r }));
  return {
    axes, weights, weightSum: weights.reduce((a, b) => a + b, 0), ranking,
    active: zp.filter((p) => EXECUTION.has(p.stage)), pipeline: zp.filter((p) => PIPELINE.has(p.stage)),
  };
}

export interface CapacityDepartment {
  department: string;
  capacityH: number;
  /** Current commitments over the 8-week window. */
  committedH: number;
  /** Candidate demand = round(budget / 1000 × hours per €1M). */
  addH: number;
  totalH: number;
  /** max(0, total − capacity). */
  gapH: number;
}

/** Capacity what-if for a candidate project (logic 4505–4512): demand by department vs capacity. */
export async function getCapacityWhatIf(projectCode: string): Promise<{ project: ProjectRow; departments: CapacityDepartment[]; gapH: number } | null> {
  const project = (await listProjects()).find((p) => p.code === projectCode);
  if (!project) return null;
  const db = await getDb();
  const rows = await db
    .select({ name: departments.name, cap: departmentCapacities.capacityH, cur: departmentCapacities.demandH, rate: capacityDemandRates.hoursPerMeur })
    .from(departmentCapacities)
    .innerJoin(departments, eq(departments.id, departmentCapacities.departmentId))
    .leftJoin(capacityDemandRates, eq(capacityDemandRates.departmentId, departments.id))
    .orderBy(asc(departmentCapacities.position));
  const k = project.budget / 1000;
  const depts = rows.map((r) => {
    const addH = Math.round((r.rate ?? 0) * k);
    const totalH = r.cur + addH;
    return { department: r.name, capacityH: r.cap, committedH: r.cur, addH, totalH, gapH: Math.max(0, totalH - r.cap) };
  });
  return { project, departments: depts, gapH: depts.reduce((s, d) => s + d.gapH, 0) };
}

export interface ProposalScore {
  /** Strategic fit, financial return (margin axis), risk (5 = low) — 1–5 each (AF.portfolio). */
  fit: number;
  margin: number;
  risk: number;
  comment?: string | null;
}

/**
 * "Score a proposal" (AF.portfolio, "Save score"): records the three axes of the form on a pipeline project (the
 * prototype only toasted, OPEN QUESTION L-5) with the scorer and comment; the other axes keep their values (1 when new).
 */
export async function saveProposalScore(projectCode: string, input: ProposalScore, actorName: string, at: Date = new Date()): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const actor = await findPerson(tx, actorName);
    const clamp = (v: number) => Math.max(1, Math.min(5, Math.round(Number.isFinite(v) ? v : 3)));
    const values: [ScoreAxis, number][] = [['fit', clamp(input.fit)], ['margin', clamp(input.margin)], ['risk', clamp(input.risk)]];
    const axes = await tx.select({ code: scoreAxes.code }).from(scoreAxes);
    for (const a of axes) {
      const v = values.find(([k]) => k === a.code);
      if (v) {
        await tx.insert(portfolioScores)
          .values({ projectId: p.id, axis: a.code, score: v[1], scoredByPersonId: actor?.id ?? null, scoredAt: at, comment: input.comment?.trim() || null })
          .onConflictDoUpdate({ target: [portfolioScores.projectId, portfolioScores.axis], set: { score: v[1], scoredByPersonId: actor?.id ?? null, scoredAt: at, comment: input.comment?.trim() || null } });
      } else {
        const [cur] = await tx.select().from(portfolioScores).where(and(eq(portfolioScores.projectId, p.id), eq(portfolioScores.axis, a.code)));
        if (!cur) await tx.insert(portfolioScores).values({ projectId: p.id, axis: a.code, score: 1 });
      }
    }
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: projectCode,
      change: `score: fit ${values[0][1]} · margin ${values[1][1]} · risk ${values[2][1]}`, area: 'Prioritisation', entityType: 'project', entityId: p.id, projectId: p.id,
    });
  });
}
