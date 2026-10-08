// Portfolio schedule — projects in progress & pipeline (docs/spec/05 §3, docs/spec/02 CH-9; prototype template
// 972–1023, logic 4523–4555). A 24-month portfolio Gantt (Jan 2026 – Dec 2027) with one line per live project:
//  - pipeline projects (Initiative → APS → APD): stage bars, group-board windows and decision diamonds, then the
//    dashed "execution if approved" bar;
//  - projects in execution: the pre-execution stages from their stage history, the execution bar with its progress
//    fill, the baseline-finish line when slipping and the forecast finish.
// Pure: the stage windows are resolved by the DAL (`getPortfolioSchedule`), this module turns them into geometry,
// gate texts and KPI tiles. Strings are the prototype's English source (render through t()); money is formatted for
// `lang` as the prototype does before translation. "Now" is `PG_NOW` (≈ 30 Sep 2026).
import type { Lang } from '@/i18n/translate';
import { MO, fmtD, money, monthDate } from '@/lib/format';
import { PG_NOW, type PipelineWindow, type StageCode } from '@/server/db/codes';
import { projectIndicators, type EvmInput, type ScheduleSummary } from './portfolio';

export { PG_NOW };

/** Horizon of the Gantt in months from Jan 2026 (`PG_MONTHS`). */
export const PG_MONTHS = 24;
/** Board waits above three weeks are shown in the attention colour. */
export const BOARD_WAIT_TARGET_DAYS = 21;

/** `pgPct(m)`: position of a month offset on the 24-month timeline, clamped, 2 decimals ("37.38%"). */
export const pgPct = (m: number) => ((Math.max(0, Math.min(PG_MONTHS, m)) / PG_MONTHS) * 100).toFixed(2) + '%';

/** `pgSeg(a, b)`: segment clipped to the horizon, null when nothing is left. `w` = visible width in months. */
export function pgSeg(a: number, b: number): { left: string; width: string; w: number } | null {
  const L = Math.max(0, a);
  const R = Math.min(PG_MONTHS, b);
  return R > L ? { left: pgPct(L), width: (((R - L) / PG_MONTHS) * 100).toFixed(2) + '%', w: R - L } : null;
}

/** Today line (`pgTodayL`). */
export const PG_TODAY_L = pgPct(PG_NOW);

// ── Inputs (structurally compatible with the DAL `PortfolioSchedule`) ─────────────────────────────────

export interface PgWindowInput {
  window: PipelineWindow;
  /** Month offsets from Jan 2026. */
  start: number;
  end: number;
}

export interface PgProjectInput extends EvmInput {
  code: string;
  /** "#026", or the code when the project has no number. */
  displayId: string;
  /** English name. */
  name: string;
  /** "R. Aubert". */
  pm: string;
  client: string;
  /** Lifecycle label (French domain value, e.g. "Fabrication & Assemblage"). */
  status: string;
  stage: StageCode;
  /** "Dec 2026" or "—". */
  finish: string;
  /** Has planning data (the prototype's DEFS projects): the row opens its Plan. */
  hasData: boolean;
}

export interface PgRowInput {
  project: PgProjectInput;
  pipeline: boolean;
  /** End of the finish month (mIdx(finish) + 1), null when the finish is "—". */
  finishMonth: number | null;
  /** Stage plan: Initiative, Board, APS, Board, APD, Board (pipeline plan, defaults or stage history). */
  windows: PgWindowInput[];
  /** End of the last board = start of execution. */
  execStart: number;
  /** Planning summary (float, forecast finish, milestones) of projects with data, else null. */
  schedule: ScheduleSummary | null;
}

export interface PgInput {
  /** Live projects of the zone (not Clos / Annulé), register order. */
  rows: PgRowInput[];
  /** Mean duration in days of the completed boards of every pipeline plan (all zones). */
  averageBoardWaitDays: number;
}

// ── View model ─────────────────────────────────────────────────────────────────────────────────────────

export type PgFilter = 'all' | 'exec' | 'pipe';
/** Stage filter segment (`pgSegCtl`); EN labels. */
export const PG_FILTERS: { value: PgFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'exec', label: 'In progress' },
  { value: 'pipe', label: 'Pipeline' },
];
export const isPgFilter = (v: unknown): v is PgFilter => v === 'all' || v === 'exec' || v === 'pipe';

/** Group board state at PG_NOW: ended (approved), running (decision pending) or ahead (planned). */
export type PgBoardState = 'approved' | 'pending' | 'planned';

const STAGE_TITLE: Record<PipelineWindow, string> = { initiative: 'Initiative', board: 'Board', aps: 'APS', apd: 'APD' };
const STAGE_SHORT: Record<Exclude<PipelineWindow, 'board'>, string> = { initiative: 'INI', aps: 'APS', apd: 'APD' };
const BOARD_STATE_LABEL: Record<PgBoardState, string> = { approved: 'Approved', pending: 'Decision pending', planned: 'Planned' };
/** Tooltip of a board window and its diamond: "Group board · Approved". */
export const boardTitle = (s: PgBoardState) => 'Group board · ' + BOARD_STATE_LABEL[s];

export type PgSegment =
  /** Initiative / APS / APD bar; `label` only when wider than 0.8 month. */
  | { kind: 'stage'; left: string; width: string; done: boolean; label: string; title: string }
  /** Group board window (hatched, dashed border; glows while pending). */
  | { kind: 'board'; left: string; width: string; state: PgBoardState; title: string }
  /** Board decision diamond at the end of the window. */
  | { kind: 'diamond'; left: string; state: PgBoardState; title: string };

/**
 * Gate sub-line colour. The prototype paints a pending board LO when it waited more than three weeks and accent-300
 * otherwise — the same token — so both are `lo`; `n400` = neutral-400.
 */
export type PgTint = 'lo' | 'n400';

/** Lifecycle tag tone (`statusTag`, logic 3917): Clos/Annulé neutral · Garantie and pipeline stages outline · else accent. */
export type PgTone = 'accent' | 'outline' | 'neutral';

export type PgTarget = { screen: 'plan'; code: string } | { screen: 'projects'; q: string };

export interface PgRow {
  code: string;
  displayId: string;
  /** English name (the screen shows `displayId · t(name)`). */
  name: string;
  /** "R. Aubert · Port authority". */
  pmLine: string;
  status: string;
  tone: PgTone;
  pipeline: boolean;
  segments: PgSegment[];
  /** Execution bar; `ifApproved` = pipeline project (transparent, dashed accent-700, empty fill). */
  exec: { left: string; width: string; fill: string; ifApproved: boolean } | null;
  /** Baseline finish line (execution rows with a known finish that slip). */
  baseline: { left: string; width: string } | null;
  /** "→ Aug 2028" when the bar runs past the horizon, else ''. */
  clipText: string;
  /** "Group board → APS" / "14 Jan 2027" / "finish not planned" / "—". */
  gate: string;
  /** "Decision pending · 8 d" / "12 Nov" / "−27 d" / ''. */
  gateSub: string;
  gateTint: PgTint;
  /** A board of this pipeline project is running at PG_NOW. */
  decisionPending: boolean;
  /** Row click: Plan of a project with data, else the Projects register searched by code. */
  target: PgTarget;
}

export interface PgGroup {
  key: Exclude<PgFilter, 'all'>;
  label: 'In progress' | 'Pipeline';
  count: number;
  rows: PgRow[];
}

/** KPI tile colour: `ok` = text, `n200` = neutral-200, `lo` = accent-300. */
export type PgKpiTint = 'ok' | 'n200' | 'lo';

export interface PgKpi {
  key: 'exec' | 'pipe' | 'pending' | 'wait';
  label: string;
  value: string;
  sub: string;
  tint: PgKpiTint;
}

export interface PgMonth {
  /** "Jan". */
  label: string;
  /** "2026" on January, else ''. */
  year: string;
  /** January: stronger left border (neutral-700). */
  yearStart: boolean;
}

export interface PortfolioScheduleModel {
  kpis: PgKpi[];
  /** Groups shown for the filter (empty groups dropped). */
  groups: PgGroup[];
  months: PgMonth[];
  todayL: string;
  /** No live project in the selection (the screen shows the zone notice when a zone is selected). */
  empty: boolean;
}

/** `pgMonths` (4552): 24 month headers, the year on each January. */
export const pgMonths = (): PgMonth[] =>
  Array.from({ length: PG_MONTHS }, (_, i) => ({
    label: MO[i % 12],
    year: i % 12 === 0 ? String(2026 + Math.floor(i / 12)) : '',
    yearStart: i % 12 === 0,
  }));

const toneOf = (r: PgRowInput): PgTone =>
  r.project.stage === 'clos' || r.project.stage === 'annule' ? 'neutral' : r.project.stage === 'garantie' || r.pipeline ? 'outline' : 'accent';

const boardStateAt = (a: number, b: number): PgBoardState => (b <= PG_NOW ? 'approved' : a <= PG_NOW ? 'pending' : 'planned');

/** `pgRow(p)` (4529–4548). */
export function pgRow(r: PgRowInput): PgRow {
  const p = r.project;
  const pipe = r.pipeline;
  const plan = r.windows;
  const execStart = r.execStart;

  const ind = pipe ? null : projectIndicators(p, r.schedule, true, 'en');
  const floatDays = ind?.floatDays ?? 0;
  const slipM = ind && floatDays < 0 ? -floatDays / 30 : 0;
  const finM = r.finishMonth;
  const base = finM !== null ? finM : pipe ? execStart + 8 : Math.max(execStart + 1, PG_NOW);
  const fc = finM !== null || pipe ? base + slipM : base;

  const segments: PgSegment[] = [];
  for (const w of plan) {
    const g = pgSeg(w.start, w.end);
    if (!g) continue;
    if (w.window === 'board') {
      const state = boardStateAt(w.start, w.end);
      segments.push({ kind: 'board', left: g.left, width: g.width, state, title: boardTitle(state) });
      segments.push({ kind: 'diamond', left: pgPct(w.end), state, title: boardTitle(state) });
    } else {
      segments.push({
        kind: 'stage', left: g.left, width: g.width, done: w.end <= PG_NOW,
        label: g.w > 0.8 ? STAGE_SHORT[w.window] : '', title: STAGE_TITLE[w.window],
      });
    }
  }

  const exec = pgSeg(execStart, fc);
  const execBase = pgSeg(execStart, base);
  const pendingB = plan.find((w) => w.window === 'board' && w.start <= PG_NOW && w.end > PG_NOW);
  const nextB = plan.find((w) => w.window === 'board' && w.end > PG_NOW);
  const after = nextB ? plan[plan.indexOf(nextB) + 1] : undefined;
  const nextStage = nextB ? (after ? STAGE_TITLE[after.window] : 'Execution') : '';
  const waitDays = pendingB ? Math.round((PG_NOW - pendingB.start) * 30) : 0;

  let gate: string, gateSub: string, gateTint: PgTint;
  if (pipe) {
    gate = nextB ? 'Group board → ' + nextStage : '—';
    gateSub = pendingB ? `Decision pending · ${waitDays} d` : nextB ? fmtD(monthDate(nextB.end)) : '';
    gateTint = pendingB ? 'lo' : 'n400';
  } else {
    gate = finM === null ? 'finish not planned' : ind!.finishForecast;
    gateSub = finM === null ? '' : ind!.floatText !== '—' ? ind!.floatText : '';
    gateTint = finM !== null && floatDays < 0 ? 'lo' : 'n400';
  }

  return {
    code: p.code,
    displayId: p.displayId,
    name: p.name,
    pmLine: `${p.pm} · ${p.client}`,
    status: p.status,
    tone: toneOf(r),
    pipeline: pipe,
    segments,
    exec: exec ? { left: exec.left, width: exec.width, fill: pipe ? '0%' : Math.round(p.progress * 100) + '%', ifApproved: pipe } : null,
    baseline: !pipe && execBase && slipM > 0 && finM !== null ? { left: execBase.left, width: execBase.width } : null,
    clipText: fc > PG_MONTHS ? '→ ' + (p.finish || '') : '',
    gate,
    gateSub,
    gateTint,
    decisionPending: pipe && !!pendingB,
    target: p.hasData ? { screen: 'plan', code: p.code } : { screen: 'projects', q: p.code },
  };
}

/** `pgKpis` (4555): counts and budgets over every live row of the zone (the stage filter does not apply). */
export function pgKpis(rows: PgRow[], input: PgInput, lang: Lang): PgKpi[] {
  const budget = (pipe: boolean) => input.rows.filter((r) => r.pipeline === pipe).reduce((a, r) => a + r.project.budget, 0);
  const pending = rows.filter((r) => r.decisionPending);
  const wait = input.averageBoardWaitDays;
  return [
    { key: 'exec', label: 'Projects in progress', value: String(rows.filter((r) => !r.pipeline).length), sub: money(budget(false), lang), tint: 'ok' },
    { key: 'pipe', label: 'Projects in pipeline', value: String(rows.filter((r) => r.pipeline).length), sub: money(budget(true), lang), tint: 'n200' },
    { key: 'pending', label: 'Group decisions pending', value: String(pending.length), sub: pending.map((r) => r.code).join(' · ') || '—', tint: pending.length ? 'lo' : 'ok' },
    { key: 'wait', label: 'Average board wait', value: `${wait} d`, sub: 'target 3 weeks', tint: wait > BOARD_WAIT_TARGET_DAYS ? 'lo' : 'ok' },
  ];
}

/** Screen model: KPI tiles, the groups of the stage filter, month header, today line. */
export function portfolioScheduleModel(input: PgInput, opts: { filter: PgFilter; lang: Lang }): PortfolioScheduleModel {
  const rows = input.rows.map(pgRow);
  const groups: PgGroup[] = (
    [
      { key: 'exec', label: 'In progress', rows: rows.filter((r) => !r.pipeline) },
      { key: 'pipe', label: 'Pipeline', rows: rows.filter((r) => r.pipeline) },
    ] as const
  )
    .filter((g) => g.rows.length && (opts.filter === 'all' || opts.filter === g.key))
    .map((g) => ({ ...g, count: g.rows.length }));
  return { kpis: pgKpis(rows, input, opts.lang), groups, months: pgMonths(), todayL: PG_TODAY_L, empty: rows.length === 0 };
}
