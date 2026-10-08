import 'server-only';
// Screen data of Portfolio — prioritisation & capacity and Cash flow & billing (docs/spec/03 §6, §7), assembled from
// the Delivery 3 DAL (prioritisation.ts, cashflow.ts) into the view-model inputs of src/features/pfinance/model.ts.
// Margins are removed here for viewers without margin rights (director, pm): they never reach the browser.
import { canSeeMargins } from '@/domain/portfolio-finance';
import type { CapacityInput, CashData, PrioritisationData } from '@/features/pfinance/model';
import type { ZoneKey } from '@/server/session';
import { getCashFlow } from './cashflow';
import { getCapacityWhatIf, getPrioritisation } from './prioritisation';
import { listProjects, projectLabel, type ProjectRow } from './projects';

const PIPELINE = new Set(['initiative', 'aps', 'apd']);

export interface PrioritisationScreen extends PrioritisationData {
  /** Zone projects in the pipeline (capacity what-if candidates), register order. */
  candidates: Pick<ProjectRow, 'code' | 'name'>[];
}

/** Ranking population, weights and KPI figures for a viewer (role) and zone. */
export async function getPrioritisationScreen(role: string, zone: ZoneKey | null): Promise<PrioritisationScreen> {
  const [pf, all] = await Promise.all([getPrioritisation(role, zone), listProjects()]);
  const see = canSeeMargins(role);
  const order = new Map(all.map((p, i) => [p.code, i]));
  const budget = (ps: ProjectRow[]) => ps.reduce((a, p) => a + p.budget, 0);
  return {
    axes: pf.axes.map((a) => ({ code: a.code, label: a.label })),
    weights: pf.weights,
    // Register order, so that ties keep the prototype's order whatever the weights.
    projects: [...pf.ranking]
      .sort((a, b) => (order.get(a.project.code) ?? 0) - (order.get(b.project.code) ?? 0))
      .map((r) => ({
        code: r.project.code,
        name: r.project.name,
        status: r.project.status,
        stage: r.project.stage,
        budget: r.project.budget,
        scores: r.scores,
        marginPct: see ? r.marginPct : null,
      })),
    active: { count: pf.active.length, budgetKeur: budget(pf.active) },
    pipeline: { count: pf.pipeline.length, budgetKeur: budget(pf.pipeline) },
    canSeeMargin: see,
    zoneSelected: !!zone,
    candidates: pf.pipeline.map((p) => ({ code: p.code, name: p.name })),
  };
}

/** Capacity what-if of a candidate project; null when the project does not exist. */
export async function getCapacityScreen(code: string): Promise<CapacityInput | null> {
  const w = await getCapacityWhatIf(code);
  if (!w) return null;
  const p = w.project;
  return {
    project: { code: p.code, name: p.name, status: p.status, stage: p.stage, budget: p.budget, start: p.start },
    departments: w.departments.map((d) => ({ department: d.department, capacityH: d.capacityH, committedH: d.committedH, addH: d.addH })),
  };
}

/** "Score a proposal" choices: every pipeline project (all zones, `PIPE`), "#044 · Westfield Solar Array" (EN). */
export async function listProposalOptions(): Promise<{ value: string; label: string }[]> {
  return (await listProjects()).filter((p) => PIPELINE.has(p.stage)).map((p) => ({ value: p.code, label: projectLabel(p) }));
}

/** Billing rows and the zone-scaled forecast of the Cash flow screen for a viewer (role) and zone. */
export async function getCashScreen(role: string, zone: ZoneKey | null): Promise<CashData> {
  const cf = await getCashFlow(zone);
  const see = canSeeMargins(role);
  return {
    rows: cf.rows.map(({ project: p, plan, marginPct }) => ({
      code: p.code,
      name: p.name,
      actual: p.actual,
      modelLabel: plan.modelLabel,
      contractKeur: plan.contractValueKeur,
      milestones: plan.milestones.map((m) => ({ label: m.label, amountKeur: m.amountKeur, status: m.status })),
      marginPct: see ? marginPct : null,
    })),
    forecast: cf.forecast.map((m) => ({ label: m.label, cashInKeur: m.cashInKeur, cashOutKeur: m.cashOutKeur })),
    canSeeMargin: see,
    zoneSelected: !!zone,
  };
}
