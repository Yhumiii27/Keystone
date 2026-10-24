// Portfolio overview and My projects logic (docs/spec/03 §2, §4, §5.5).
// Ports of the prototype's `projects`/`portfolioKpis`/`alerts` (lines 3790–3813), `pvExtra` (3924) and
// `myProjRole`/`myProjects`/`myProjKpis` (5063–5070). Pure: strings are the prototype's English source
// strings (render them through t()); money is formatted for `lang` before translation, as the prototype does.
import type { RoleKey } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { fmtD, mIdx, money, monthDate } from '@/lib/format';
import { STAGES, type StageCode } from '@/server/db/codes';
import type { UncertaintyTotals } from './estimate-class';
import { DEFAULT_HEALTH_THRESHOLDS, HEALTH_LABEL, clampHealthCpi, healthOf, indexAlert, type Health, type HealthThresholds } from './health';
import type { ProjectTeamRole } from './rights';

// ── Population (A-3) ───────────────────────────────────────────────────────────────────────────────

/**
 * A-3 (owner answer "Projets en exécution (Études → Mise en service)"): the Portfolio overview, the director's Home and My
 * projects count the projects whose lifecycle stage belongs to the "execution" group, read live from the register — no
 * longer the projects that have seeded control data. The pipeline (Initiative, APS, APD) and the warranty appear elsewhere
 * (Portfolio planning, after-sales). Cash flow and Prioritisation use the same set.
 */
export const EXECUTION_STAGES: ReadonlySet<StageCode> = new Set(STAGES.filter((s) => s.group === 'execution').map((s) => s.code));
/** The project's stage is in the execution group (Études → Mise en service). */
export const inExecution = (p: { stage: StageCode }) => EXECUTION_STAGES.has(p.stage);

/**
 * "FY2026" — the fiscal year shown in the Overview card hint and the portfolio breadcrumbs, from the portfolio data date, the
 * business date (R-129, R-013; it was a fixed "FY2026"). The fiscal year is the calendar year of that date until the owner
 * says otherwise.
 */
export const fiscalYearLabel = (dataDate: string) => `FY${dataDate.slice(0, 4)}`;

/** EVM inputs of a project record (ProjectRow subset). Amounts in k€. */
export interface EvmInput {
  budget: number;
  actual: number;
  progress: number;
  spi: number | null;
}

/** CPI / SPI alert of the Settings thresholds — moved to ./health (delivery 8, R-080: the Budget reads it without this module). */
export { indexAlert };
/** @deprecated The default "At risk below" threshold (0.97); screens pass the Settings thresholds to `indexAlert`. */
export const INDEX_ALERT = DEFAULT_HEALTH_THRESHOLDS.risk;

// ── Portfolio overview (§4) ────────────────────────────────────────────────────────────────────────

/** One "Active projects" row (line 3793): EV = budget × progress, CPI = EV / AC (unclamped), EAC = budget / CPI. */
export interface OverviewMetrics {
  earned: number;
  cpi: number;
  spi: number;
  eac: number;
  /** budget − EAC (k€); negative = overrun. */
  variance: number;
  /**
   * The one health rule (A-13, src/domain/health.ts): min(CPI clamped to [0.70, 1.25], SPI) against the Settings
   * thresholds; null without actuals or progress. (The prototype's Overview used the unclamped CPI, 03 §0.4.)
   */
  health: Health | null;
  /** CPI / SPI below the Settings "At risk below" threshold (LO colour, A-13). */
  cpiAlert: boolean;
  spiAlert: boolean;
  /** round(progress × 100) + '%' — also the "Work earned" tick position. */
  progressPct: string;
  /** round(actual / budget × 100) + '%'. */
  spentPct: string;
  /** Bar geometry as the prototype draws it (widths/left from the rounded percent strings), 0..1. */
  progressBar: number;
  spentBar: number;
}

/** Fraction rounded to a whole percent — the prototype sizes bars with its rounded "64%" strings. */
export const wholePct = (x: number) => Math.round(x * 100) / 100;

export function overviewMetrics(p: EvmInput, th: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): OverviewMetrics {
  const spi = p.spi ?? 1;
  const earned = p.budget * p.progress;
  // A project without actuals yet has no cost performance: CPI 1, EAC = budget (the prototype divides by 0).
  const cpi = p.actual ? earned / p.actual : 1;
  const eac = cpi ? p.budget / cpi : p.budget;
  return {
    earned,
    cpi,
    spi,
    eac,
    variance: p.budget - eac,
    health: healthOf(p, th),
    cpiAlert: indexAlert(cpi, th),
    spiAlert: indexAlert(spi, th),
    progressPct: Math.round(p.progress * 100) + '%',
    spentPct: (p.budget ? Math.round((p.actual / p.budget) * 100) : 0) + '%',
    progressBar: wholePct(p.progress),
    spentBar: p.budget ? wholePct(p.actual / p.budget) : 0,
  };
}

export interface PortfolioTotals {
  /** Number of projects (nAct). */
  count: number;
  budget: number;
  actual: number;
  earned: number;
  eac: number;
  /** ΣEV / ΣAC (1 when no actuals). */
  cpi: number;
  /** Σ(spiᵢ × budgetᵢ) / Σbudget (1 when no budget). */
  spi: number;
  /** Projects not On track. */
  atRisk: number;
  offTrack: number;
}

export function portfolioTotals(rows: (EvmInput & { metrics: OverviewMetrics })[]): PortfolioTotals {
  let budget = 0, actual = 0, earned = 0, eac = 0, spiW = 0, atRisk = 0, offTrack = 0;
  for (const r of rows) {
    budget += r.budget;
    actual += r.actual;
    earned += r.metrics.earned;
    eac += r.metrics.eac;
    spiW += r.metrics.spi * r.budget;
    if (r.metrics.health && r.metrics.health !== 'on_track') atRisk++;
    if (r.metrics.health === 'off_track') offTrack++;
  }
  return { count: rows.length, budget, actual, earned, eac, cpi: actual ? earned / actual : 1, spi: budget ? spiW / budget : 1, atRisk, offTrack };
}

export type KpiIcon = 'briefcase' | 'receipt' | 'trend-up' | 'gauge' | 'timer' | 'warning' | 'range';

/** KPI tile view: label/value/sub are EN source strings (money already formatted for `lang`); `alert` = value in LO. */
export interface KpiView {
  key: string;
  label: string;
  value: string;
  sub: string;
  alert: boolean;
  icon?: KpiIcon;
}

/** `portfolioKpis` (lines 3802–3808). Home (director) shows the first four. CPI / SPI alert below the Settings threshold (A-13). */
export function portfolioKpis(t: PortfolioTotals, lang: Lang, th: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS): KpiView[] {
  const n = t.count;
  return [
    { key: 'budget', label: 'Total budget', value: money(t.budget, lang), sub: n === 1 ? '1 active project' : `${n} active projects`, icon: 'briefcase', alert: false },
    { key: 'actual', label: 'Actual cost', value: money(t.actual, lang), sub: `${t.budget ? Math.round((t.actual / t.budget) * 100) : 0}% of budget spent`, icon: 'receipt', alert: false },
    // The prototype always paints the forecast in LO.
    { key: 'eac', label: 'Forecast (EAC)', value: money(t.eac, lang), sub: `${money(t.budget - t.eac, lang, { signed: true })} vs budget`, icon: 'trend-up', alert: true },
    { key: 'cpi', label: 'Cost perf. (CPI)', value: t.cpi.toFixed(2), sub: 'Earned per $1 spent', icon: 'gauge', alert: indexAlert(t.cpi, th) },
    { key: 'spi', label: 'Schedule perf. (SPI)', value: t.spi.toFixed(2), sub: 'Weighted by budget', icon: 'timer', alert: indexAlert(t.spi, th) },
    { key: 'risk', label: 'Projects at risk', value: `${t.atRisk} of ${n}`, sub: `${t.offTrack} off track`, icon: 'warning', alert: t.atRisk > 0 },
  ];
}

/**
 * R-188 (DIG-PRODI D-6): "Uncertainty gap" tile of the Portfolio overview, after the prototype's six — Σ (high − low) of the active
 * projects' budgets in their estimate class (src/domain/estimate-class.ts `uncertaintyTotals`), alert while a budget is not at
 * E10 (+10 / −5 %) or not classified: a project in execution has passed APD, whose budget precision is +10 / −5 %.
 */
export function uncertaintyKpi(u: UncertaintyTotals, lang: Lang): KpiView {
  return {
    key: 'uncertainty', label: 'Uncertainty gap', value: money(u.gap, lang), sub: u.notFirm ? `${u.notFirm} not at class E10` : 'All budgets at class E10', icon: 'range',
    alert: u.notFirm > 0,
  };
}

/** "6 projects · FY2026" — the prototype's static card hint, here counting the rows shown (zone filter), fiscal year of the data date. */
export const activeProjectsHint = (n: number, dataDate: string) =>
  `${n === 1 ? '1 project' : `${n} projects`} · ${fiscalYearLabel(dataDate)}`;

// "Needs attention" items are computed by rules since R-130 (NEW-D1-1): src/domain/portfolio-alerts.ts.
export type { AlertIcon, PortfolioAlert } from './portfolio-alerts';

// ── Per-project indicators (pvExtra, line 3924) ────────────────────────────────────────────────────

/** Schedule header + milestones of a project with planning data (DAL `listScheduleSummaries`). */
export interface ScheduleSummary {
  /** Project start, month offset from Jan 2026. */
  start: number;
  floatDays: number;
  /** "14 Jan 2027". */
  finishText: string;
  /** "18 Dec 2026". */
  baselineText: string;
  milestones: { name: string; forecastMonth: number; statusLabel: string }[];
}

/** Text colours used by the indicators; the UI maps them to tokens (lo = accent-300, ok = text, nNNN = neutral-NNN). */
export type Tint = 'lo' | 'ok' | 'accent' | 'n300' | 'n400' | 'n500' | 'n600';

export interface ProjectIndicators {
  spiText: string;
  cpiText: string;
  spiTint: Tint;
  cpiTint: Tint;
  /** Next open milestone (or the last one), '—' when none. */
  msName: string;
  /** EN date ("23 Oct", "14 Jan 2027") or ''. */
  msDate: string;
  /** 'Done' | 'Late' | 'At risk' | 'On track' | ''. */
  msState: string;
  /** "23 Oct · Late" or ''. */
  msLine: string;
  msTint: Tint;
  /** Attention items, EN segments ("SPI 0.90", "Structure topped out · Late", "27 d slip"); joined with " · ". */
  attention: string[];
  finishPlanned: string;
  finishForecast: string;
  finishTint: Tint;
  floatDays: number | null;
  floatText: string;
  spentText: string;
  earnedText: string;
  eacText: string;
  vacText: string;
  vacTint: Tint;
  spentPct: string;
  spentTint: Tint;
}

/**
 * `pvExtra(p, live)`: display indicators of a project. `live` = the project has a health (actuals and progress);
 * otherwise everything shows "—". CPI is clamped to [0.70, 1.25] for display and EAC — the same clamp as the health
 * rule (A-13, src/domain/health.ts). `sched` = planning data of the project, null when it has none. CPI / SPI colours and
 * attention items follow the Settings "At risk below" threshold `th` (A-13).
 */
export function projectIndicators(
  p: EvmInput & { finish: string },
  sched: ScheduleSummary | null,
  live: boolean,
  lang: Lang,
  th: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): ProjectIndicators {
  if (!live)
    return {
      spiText: '—', cpiText: '—', spiTint: 'n500', cpiTint: 'n500', msName: '—', msDate: '', msState: '', msLine: '', msTint: 'n500',
      attention: [], finishPlanned: p.finish, finishForecast: '—', finishTint: 'n400', floatDays: null, floatText: '—',
      spentText: p.actual ? money(p.actual, lang) : '—', earnedText: '—', eacText: '—', vacText: '—', vacTint: 'n400',
      spentPct: p.actual ? Math.round((p.actual / p.budget) * 100) + '%' : '0%', spentTint: 'n600',
    };
  const cpi = p.actual ? clampHealthCpi((p.budget * p.progress) / p.actual) : 1;
  const spi = p.spi || 1;
  const eac = p.budget / cpi;
  const vac = p.budget - eac;
  const earned = p.budget * p.progress;

  const miles = sched?.milestones ?? [];
  const next = miles.find((m) => m.statusLabel !== 'Done') ?? miles[miles.length - 1];
  const msName = next ? next.name : '—';
  const msDate = next && sched
    ? sched.finishText && next === miles[miles.length - 1] ? sched.finishText : fmtD(monthDate((sched.start || 0) + next.forecastMonth))
    : '';
  const msState = next ? next.statusLabel : '';
  const floatDays = sched ? sched.floatDays : Math.round((spi - 1) * 180);

  const attention: string[] = [];
  if (indexAlert(spi, th)) attention.push('SPI ' + spi.toFixed(2));
  if (indexAlert(cpi, th)) attention.push('CPI ' + cpi.toFixed(2));
  if (msState === 'Late') attention.push(msName + ' · Late');
  if (floatDays < 0) attention.push(Math.abs(floatDays) + ' d slip');

  const late = floatDays < 0;
  const noFinish = p.finish === '—';
  const finishIdx = mIdx(p.finish);
  return {
    spiText: spi.toFixed(2),
    cpiText: cpi.toFixed(2),
    spiTint: indexAlert(spi, th) ? 'lo' : 'ok',
    cpiTint: indexAlert(cpi, th) ? 'lo' : 'ok',
    msName,
    msDate,
    msState,
    msLine: msDate ? msDate + ' · ' + msState : '',
    msTint: msState === 'Late' || msState === 'At risk' ? 'lo' : 'n400',
    attention,
    finishPlanned: sched?.baselineText ? sched.baselineText : noFinish ? 'finish not planned' : p.finish,
    finishForecast: sched?.finishText
      ? sched.finishText
      : noFinish ? 'finish not planned' : late && finishIdx !== null ? fmtD(monthDate(finishIdx + 1 - floatDays / 30)) : p.finish,
    finishTint: late ? 'lo' : 'n300',
    floatDays,
    floatText: noFinish ? '—' : (floatDays > 0 ? '+' : floatDays < 0 ? '−' : '') + Math.abs(floatDays) + ' d',
    spentText: money(p.actual || 0, lang),
    earnedText: money(earned, lang),
    eacText: money(eac, lang),
    vacText: money(vac, lang, { signed: true }),
    vacTint: vac < 0 ? 'lo' : 'n300',
    spentPct: Math.round(((p.actual || 0) / p.budget) * 100) + '%',
    spentTint: (p.actual || 0) > earned * 1.03 ? 'lo' : 'accent',
  };
}

// ── My projects (§2) ───────────────────────────────────────────────────────────────────────────────

/** EN labels of the viewer's role on a project (FR: Directrice de portefeuille, Client, Chef de projet…). */
export type MyProjectRole =
  | 'Portfolio director' | 'Client' | 'Project manager' | 'Deputy project manager' | 'Referent' | 'Team member' | 'Assigned tasks' | 'Department involved';

/** Named-team role → My projects tag (R-041). */
const TEAM_ROLE_TAG: Record<ProjectTeamRole, MyProjectRole> = { pm: 'Project manager', deputy: 'Deputy project manager', referent: 'Referent', team: 'Team member' };

/** Open-task record (TODOS: `project` is the 3-letter key the project code starts with). */
export interface TodoLite {
  person: string;
  status: string;
  project: string;
}

export interface MyProjectsViewer {
  role: RoleKey;
  /** Full name ("Romain Aubert"). */
  name: string;
  /** "R. Aubert" — how projects store their manager. */
  short: string;
  /** Organisation of the client persona ("Port authority"). */
  clientOrg: string;
  /** Department headed by the viewer (department heads), else null. */
  dept: string | null;
}

export interface MyProjectsData {
  /** Person full name → department name (DEPT_OF). */
  deptOf: Record<string, string>;
  todos: TodoLite[];
}

const isOpenTodoOf = (name: string, code?: string) => (t: TodoLite) =>
  t.person === name && t.status !== 'done' && (code === undefined || code.startsWith(t.project));

/**
 * `myProjRole` (line 5065), first match wins; null = not one of my projects. `team` = full names (DEFS.team); `teamRole` = the
 * viewer's role in the project's named team (R-041: PM, co-PM, deputy, referent, member) when known.
 */
export function myProjectRole(
  v: MyProjectsViewer,
  p: { code: string; pm: string; client: string; team: string[] | null; teamRole?: ProjectTeamRole | null },
  data: MyProjectsData,
): MyProjectRole | null {
  if (v.role === 'director') return 'Portfolio director';
  if (v.role === 'client') return p.client === v.clientOrg ? 'Client' : null;
  if (p.teamRole) return TEAM_ROLE_TAG[p.teamRole];
  if (p.pm === v.short) return 'Project manager';
  if (p.team?.includes(v.name)) return 'Team member';
  if (data.todos.some(isOpenTodoOf(v.name, p.code))) return 'Assigned tasks';
  if (v.role === 'depthead' && p.team?.some((n) => data.deptOf[n] === v.dept)) return 'Department involved';
  return null;
}

/** Card of the My projects wall, before translation. */
export interface MyProjectCard<P> {
  project: P;
  /** Health; null renders "—" in a neutral tag. */
  health: Health | null;
  /** '' in fallback mode (role tag hidden). */
  myRole: MyProjectRole | '';
  /** pm/depthead/member… on a project they do not manage. */
  readOnly: boolean;
  /** round(progress × 100) + '%'. */
  progressPct: string;
  /** Bar width, 0..1 rounded to a whole percent. */
  progressBar: number;
  ind: ProjectIndicators;
  /** My open tasks on this project. */
  myOpen: number;
}

export interface MyProjectsModel<P> {
  /** No project matches the viewer: the whole pool is shown without role tags. */
  fallback: boolean;
  cards: MyProjectCard<P>[];
  kpis: KpiView[];
}

/**
 * `myProjects` + `myProjKpis` (lines 5066–5070). `pool` = projects in execution (A-3), register order.
 * `personaTitle` = EN persona title (KPI sub); `pendingDecisions` = size of the viewer's My approvals queue.
 */
export function myProjectsModel<P extends EvmInput & { code: string; pm: string; client: string; finish: string }>(
  v: MyProjectsViewer,
  pool: P[],
  sched: Record<string, ScheduleSummary & { team: string[] }>,
  data: MyProjectsData,
  opts: {
    personaTitle: string; pendingDecisions: number; lang: Lang; thresholds?: HealthThresholds;
    /** The viewer's rights per project (R-041): team role and read-only; default = the prototype's rule (PM by short name). */
    access?: (p: P) => { teamRole: ProjectTeamRole | null; readOnly: boolean };
  },
): MyProjectsModel<P> {
  let list: (readonly [P, MyProjectRole | ''])[] = pool
    .map((p) => [p, myProjectRole(v, { ...p, team: sched[p.code]?.team ?? null, teamRole: opts.access?.(p).teamRole }, data) ?? ''] as const)
    .filter((x) => x[1]);
  const fallback = !list.length;
  if (fallback) list = pool.map((p) => [p, ''] as const);

  const cards = list.map(([p, role]): MyProjectCard<P> => {
    const health = healthOf(p, opts.thresholds);
    return {
      project: p,
      health,
      myRole: role,
      readOnly: opts.access ? opts.access(p).readOnly : v.role !== 'director' && v.role !== 'client' && p.pm !== v.short,
      progressPct: Math.round(p.progress * 100) + '%',
      progressBar: wholePct(p.progress),
      ind: projectIndicators(p, sched[p.code] ?? null, !!health, opts.lang, opts.thresholds),
      myOpen: data.todos.filter(isOpenTodoOf(v.name, p.code)).length,
    };
  });

  const risky = cards.filter((c) => c.health && c.health !== 'on_track').length;
  const off = cards.filter((c) => c.health === 'off_track').length;
  const openAll = data.todos.filter(isOpenTodoOf(v.name)).length;
  const kpis: KpiView[] = [
    { key: 'mine', label: 'My projects', value: String(cards.length), sub: fallback ? 'Whole portfolio' : opts.personaTitle, alert: false },
    { key: 'risk', label: 'At risk', value: String(risky), sub: `${off} off track`, alert: risky > 0 },
    { key: 'tasks', label: 'My open tasks', value: String(openAll), sub: openAll ? 'Across my projects' : 'Nothing assigned', alert: false },
    { key: 'decisions', label: 'Pending decisions', value: String(opts.pendingDecisions), sub: 'In my approvals', alert: opts.pendingDecisions > 0 },
  ];
  return { fallback, cards, kpis };
}

/** EN label of a health, '—' when none. */
export const healthLabel = (h: Health | null) => (h ? HEALTH_LABEL[h] : '—');
