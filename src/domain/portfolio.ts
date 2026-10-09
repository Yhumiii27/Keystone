// Portfolio overview and My projects logic (docs/spec/03 §2, §4, §5.5).
// Ports of the prototype's `projects`/`portfolioKpis`/`alerts` (lines 3790–3813), `pvExtra` (3924) and
// `myProjRole`/`myProjects`/`myProjKpis` (5063–5070). Pure: strings are the prototype's English source
// strings (render them through t()); money is formatted for `lang` before translation, as the prototype does.
import type { RoleKey, ScreenId } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { fmtD, mIdx, money, monthDate } from '@/lib/format';
import { DEFAULT_HEALTH_THRESHOLDS, HEALTH_LABEL, healthOf, type Health, type HealthThresholds } from './health';

/** EVM inputs of a project record (ProjectRow subset). Amounts in k€. */
export interface EvmInput {
  budget: number;
  actual: number;
  progress: number;
  spi: number | null;
}

/** CPI/SPI below this value are shown in LO (attention colour). */
export const INDEX_ALERT = 0.97;

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

export type KpiIcon = 'briefcase' | 'receipt' | 'trend-up' | 'gauge' | 'timer' | 'warning';

/** KPI tile view: label/value/sub are EN source strings (money already formatted for `lang`); `alert` = value in LO. */
export interface KpiView {
  key: string;
  label: string;
  value: string;
  sub: string;
  alert: boolean;
  icon?: KpiIcon;
}

/** `portfolioKpis` (lines 3802–3808). Home (director) shows the first four. */
export function portfolioKpis(t: PortfolioTotals, lang: Lang): KpiView[] {
  const n = t.count;
  return [
    { key: 'budget', label: 'Total budget', value: money(t.budget, lang), sub: n === 1 ? '1 active project' : `${n} active projects`, icon: 'briefcase', alert: false },
    { key: 'actual', label: 'Actual cost', value: money(t.actual, lang), sub: `${t.budget ? Math.round((t.actual / t.budget) * 100) : 0}% of budget spent`, icon: 'receipt', alert: false },
    // The prototype always paints the forecast in LO.
    { key: 'eac', label: 'Forecast (EAC)', value: money(t.eac, lang), sub: `${money(t.budget - t.eac, lang, { signed: true })} vs budget`, icon: 'trend-up', alert: true },
    { key: 'cpi', label: 'Cost perf. (CPI)', value: t.cpi.toFixed(2), sub: 'Earned per $1 spent', icon: 'gauge', alert: t.cpi < INDEX_ALERT },
    { key: 'spi', label: 'Schedule perf. (SPI)', value: t.spi.toFixed(2), sub: 'Weighted by budget', icon: 'timer', alert: t.spi < INDEX_ALERT },
    { key: 'risk', label: 'Projects at risk', value: `${t.atRisk} of ${n}`, sub: `${t.offTrack} off track`, icon: 'warning', alert: t.atRisk > 0 },
  ];
}

/** "6 projects · FY2026" — the prototype's static card hint, here counting the rows shown (zone filter). */
export const activeProjectsHint = (n: number) => (n === 1 ? '1 project · FY2026' : `${n} projects · FY2026`);

export type AlertIcon = 'lightning' | 'coins' | 'users-three' | 'clock-countdown';

/** "Needs attention" item (line 3809). `target` is the screen opened by the action button. */
export interface PortfolioAlert {
  key: string;
  icon: AlertIcon;
  /** Project the alert is about; alerts with a code are hidden when that project is outside the selected zone. */
  code: string | null;
  title: string;
  detail: string;
  action: string;
  target: { screen: ScreenId; code?: string };
}

/**
 * The prototype's static alert list (spec §4.4). TODO: generate from rules (critical-path slip, cost overrun,
 * over-allocation, SPI threshold) once those modules are modelled.
 */
export function portfolioAlerts(lang: Lang): PortfolioAlert[] {
  return [
    {
      key: 'hlt-slip', icon: 'lightning', code: 'HLT-026', title: 'Harbor Line — critical path slip',
      detail: 'Steel structure forecast 39 days late; handover moves to 14 Jan 2027.', action: 'Open schedule',
      target: { screen: 'schedule', code: 'HLT-026' },
    },
    {
      key: 'hlt-labor', icon: 'coins', code: 'HLT-026', title: 'Harbor Line — labor overrun',
      detail: `Labor forecast ${money(160, lang, { signed: true })} over its line budget; contingency 139% drawn.`, action: 'Open budget',
      target: { screen: 'budget', code: 'HLT-026' },
    },
    {
      key: 'people', icon: 'users-three', code: null, title: '3 people over 115% in October',
      detail: 'Engineering demand exceeds capacity by 150 h across weeks 41–43.', action: 'Rebalance',
      target: { screen: 'resources' },
    },
    {
      key: 'rcf-spi', icon: 'clock-countdown', code: 'RCF-019', title: 'Clinique Pasteur Lyon — SPI 0.84',
      detail: 'Electrical subcontractor three weeks behind; recovery plan due Friday.', action: 'Open schedule',
      target: { screen: 'schedule', code: 'RCF-019' },
    },
  ];
}

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
 * rule (A-13, src/domain/health.ts). `sched` = planning data of the project, null when it has none.
 */
export function projectIndicators(
  p: EvmInput & { finish: string },
  sched: ScheduleSummary | null,
  live: boolean,
  lang: Lang,
): ProjectIndicators {
  if (!live)
    return {
      spiText: '—', cpiText: '—', spiTint: 'n500', cpiTint: 'n500', msName: '—', msDate: '', msState: '', msLine: '', msTint: 'n500',
      attention: [], finishPlanned: p.finish, finishForecast: '—', finishTint: 'n400', floatDays: null, floatText: '—',
      spentText: p.actual ? money(p.actual, lang) : '—', earnedText: '—', eacText: '—', vacText: '—', vacTint: 'n400',
      spentPct: p.actual ? Math.round((p.actual / p.budget) * 100) + '%' : '0%', spentTint: 'n600',
    };
  const cpi = p.actual ? Math.min(1.25, Math.max(0.7, (p.budget * p.progress) / p.actual)) : 1;
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
  if (spi < INDEX_ALERT) attention.push('SPI ' + spi.toFixed(2));
  if (cpi < INDEX_ALERT) attention.push('CPI ' + cpi.toFixed(2));
  if (msState === 'Late') attention.push(msName + ' · Late');
  if (floatDays < 0) attention.push(Math.abs(floatDays) + ' d slip');

  const late = floatDays < 0;
  const noFinish = p.finish === '—';
  const finishIdx = mIdx(p.finish);
  return {
    spiText: spi.toFixed(2),
    cpiText: cpi.toFixed(2),
    spiTint: spi < INDEX_ALERT ? 'lo' : 'ok',
    cpiTint: cpi < INDEX_ALERT ? 'lo' : 'ok',
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
export type MyProjectRole = 'Portfolio director' | 'Client' | 'Project manager' | 'Team member' | 'Assigned tasks' | 'Department involved';

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

/** `myProjRole` (line 5065), first match wins; null = not one of my projects. `team` = full names (DEFS.team). */
export function myProjectRole(
  v: MyProjectsViewer,
  p: { code: string; pm: string; client: string; team: string[] | null },
  data: MyProjectsData,
): MyProjectRole | null {
  if (v.role === 'director') return 'Portfolio director';
  if (v.role === 'client') return p.client === v.clientOrg ? 'Client' : null;
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
 * `myProjects` + `myProjKpis` (lines 5066–5070). `pool` = projects with planning data, register order.
 * `personaTitle` = EN persona title (KPI sub); `pendingDecisions` = size of the viewer's My approvals queue.
 */
export function myProjectsModel<P extends EvmInput & { code: string; pm: string; client: string; finish: string }>(
  v: MyProjectsViewer,
  pool: P[],
  sched: Record<string, ScheduleSummary & { team: string[] }>,
  data: MyProjectsData,
  opts: { personaTitle: string; pendingDecisions: number; lang: Lang; thresholds?: HealthThresholds },
): MyProjectsModel<P> {
  let list: (readonly [P, MyProjectRole | ''])[] = pool
    .map((p) => [p, myProjectRole(v, { ...p, team: sched[p.code]?.team ?? null }, data) ?? ''] as const)
    .filter((x) => x[1]);
  const fallback = !list.length;
  if (fallback) list = pool.map((p) => [p, ''] as const);

  const cards = list.map(([p, role]): MyProjectCard<P> => {
    const health = healthOf(p, opts.thresholds);
    return {
      project: p,
      health,
      myRole: role,
      readOnly: v.role !== 'director' && v.role !== 'client' && p.pm !== v.short,
      progressPct: Math.round(p.progress * 100) + '%',
      progressBar: wholePct(p.progress),
      ind: projectIndicators(p, sched[p.code] ?? null, !!health, opts.lang),
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
