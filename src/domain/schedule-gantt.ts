// Schedule screen logic (docs/spec/05 §1, prototype logic 3847–3864): package Gantt geometry, milestones,
// cumulative progression and the five KPI tiles. Pure functions over the project's schedule data; every
// string is the prototype's English source (render through t()). Re-used by PM home (KPIs SPI + float),
// client home (milestones) and the client portal (progression).
// (The Plan — WBS & activities logic lives in ./schedule.ts.)
import type { MilestoneStatus } from '@/server/db/codes';
import { dateOf, pct } from '@/lib/format';
import { shortDateText } from './schedule-rollup';

/** Gantt span: 13 month columns from the project start month (`S = 13`). */
export const GANTT_SPAN = 13;
/** Slip above this many days is shown in the attention colour. */
export const SLIP_ALERT_DAYS = 14;
/** KPI tile SPI threshold (`spi < .97` → LO). */
export const SPI_KPI_ALERT = 0.97;
/** Monthly SPI label threshold of the progression chart (`s < .93` → LO) — differs from the KPI on purpose. */
export const SPI_MONTH_ALERT = 0.93;

/** `pos(m) = pct(m / 13)`: horizontal position / width of a month offset on the Gantt timeline ("67.7%"). */
export const ganttPos = (m: number) => pct(m / GANTT_SPAN);

/** Slip in days between a baseline and a forecast month offset (30-day months). */
export const slipDays = (baseline: number, forecast: number) => Math.round((forecast - baseline) * 30);

// ── Inputs ─────────────────────────────────────────────────────────────────────────────────────────────

/** Work-package bar (TASKS tuple `[name, owner, bs, be, as, ae, pct, crit]`), months from the project start. */
export interface PackageBarInput {
  name: string;
  owner: string;
  baselineStart: number;
  baselineEnd: number;
  forecastStart: number;
  forecastEnd: number;
  pct: number;
  critical: boolean;
  /**
   * Chapter 4 roll-ups (A-7, S-8): slip in working days computed from the real dates. Absent for the seeded bars, whose slip
   * is the prototype's `round((ae − be) × 30)` calendar-day approximation.
   */
  slipDays?: number;
}

/** Milestone (MILES tuple `[name, b, fc, status]`), months from the project start. */
export interface MilestoneInput {
  name: string;
  baselineMonth: number;
  forecastMonth: number;
  status: MilestoneStatus;
  /** EN label: 'Done' | 'Late' | 'At risk' | 'On track'. */
  statusLabel: string;
  /** Chapter 4 roll-ups (A-7): exact ISO dates of the anchor activity (display "1 Apr" instead of `dateOf(month)`). */
  baselineDate?: string | null;
  forecastDate?: string | null;
  /** Working days late vs the baseline (S-8); absent → `round((fc − b) × 30)`. */
  slipDays?: number;
}

/** Schedule header strings of the project (projectData() display fields). */
export interface ScheduleHeaderInput {
  /** Project start, month offset from Jan 2026. */
  start: number;
  /** Data date in months since the project start. */
  tNow: number;
  floatDays: number;
  finishText: string;
  baselineText: string;
  floatText: string;
  critText: string;
  milesText: string;
  milesSub: string;
  chartMonths: string[];
  ganttMonths: string[];
}

/** Everything the Schedule screen needs for one project. */
export interface ScheduleInput {
  header: ScheduleHeaderInput;
  bars: PackageBarInput[];
  milestones: MilestoneInput[];
  /** Cumulative k€ series: PV over 12 months, EV up to the data date. */
  pv: number[];
  ev: number[];
  /** Budget at completion (k€). */
  bac: number;
  /** Business year (R-013): the milestones' exact dates carry their year after it. */
  year: number;
}

// ── Outputs ────────────────────────────────────────────────────────────────────────────────────────────

export interface GanttTask {
  name: string;
  owner: string;
  critical: boolean;
  /** "72%" — also the width of the inner fill. */
  pctText: string;
  slip: number;
  /** "+39d", or "—" when not late. */
  slipText: string;
  /** slip > 14 days → attention colour (else neutral-300). */
  slipAlert: boolean;
  /** Baseline bar left / width, forecast bar left / width ("42.3%"). */
  bL: string;
  bW: string;
  aL: string;
  aW: string;
}

export interface ScheduleMilestone {
  name: string;
  status: MilestoneStatus;
  statusLabel: string;
  done: boolean;
  /** Baseline / forecast diamond positions on the Gantt. */
  bL: string;
  fL: string;
  /** "15 Mar", "13 Jan ’27" (dateOf of the absolute month). */
  baseDate: string;
  fcDate: string;
  slip: number;
  /** Signed "+Nd" as the prototype (even "+0d"); an early forecast reads "−Nd" (U+2212), not the prototype's "+-Nd". */
  slipText: string;
  slipAlert: boolean;
}

export interface ProgressionMonth {
  label: string;
  /** Planned / actual bar heights ("71.3%", actual "0%" for future months). */
  planH: string;
  actH: string;
  spi: number | null;
  /** "0.90", '' for future months. */
  spiText: string;
  /** SPI < 0.93 → attention colour (else neutral-400). */
  spiAlert: boolean;
}

export type ScheduleKpiKey = 'spi' | 'complete' | 'finish' | 'float' | 'milestones';

export interface ScheduleKpi {
  key: ScheduleKpiKey;
  /** EN label / value / sub (render through t()). */
  label: string;
  value: string;
  sub: string;
  /** Value in the attention colour (LO) — else OK. */
  alert: boolean;
}

export interface ScheduleView {
  kpis: ScheduleKpi[];
  tasks: GanttTask[];
  milestones: ScheduleMilestone[];
  progression: ProgressionMonth[];
  /** Today line position, `pos(tNow)` (HLT "67.7%"). */
  todayL: string;
  /** 13 timeline month labels ("Jan" … "Jan ’27"). */
  ganttMonths: string[];
}

// ── Builders ───────────────────────────────────────────────────────────────────────────────────────────

export function ganttTask(b: PackageBarInput): GanttTask {
  const slip = b.slipDays ?? slipDays(b.baselineEnd, b.forecastEnd);
  return {
    name: b.name,
    owner: b.owner,
    critical: b.critical,
    pctText: b.pct + '%',
    slip,
    slipText: slip > 0 ? '+' + slip + 'd' : '—',
    slipAlert: slip > SLIP_ALERT_DAYS,
    bL: ganttPos(b.baselineStart),
    bW: ganttPos(b.baselineEnd - b.baselineStart),
    aL: ganttPos(b.forecastStart),
    aW: ganttPos(b.forecastEnd - b.forecastStart),
  };
}

/**
 * `start` = project start month (Jan 2026 = 0), used for the absolute baseline / forecast dates; `year` = the business year
 * (exact dates show their year after it, R-013).
 */
export function scheduleMilestone(m: MilestoneInput, start: number, year: number): ScheduleMilestone {
  const slip = m.slipDays ?? slipDays(m.baselineMonth, m.forecastMonth);
  return {
    name: m.name,
    status: m.status,
    statusLabel: m.statusLabel,
    done: m.status === 'done',
    bL: ganttPos(m.baselineMonth),
    fL: ganttPos(m.forecastMonth),
    baseDate: m.baselineDate ? shortDateText(m.baselineDate, year) : dateOf(m.baselineMonth + start),
    fcDate: m.forecastDate ? shortDateText(m.forecastDate, year) : dateOf(m.forecastMonth + start),
    slip,
    slipText: (slip < 0 ? '−' + -slip : '+' + slip) + 'd',
    slipAlert: slip > SLIP_ALERT_DAYS,
  };
}

/** One column per chart month: planned vs actual cumulative % of BAC, and the monthly SPI. */
export function scheduleProgression(months: string[], pv: number[], ev: number[], bac: number): ProgressionMonth[] {
  // Guards (not in the prototype, whose data is always complete): a month without PV, or BAC 0, draws an empty
  // column instead of "NaN%"/"Infinity%", and no SPI is shown without a planned value.
  const share = (v: number | undefined) => (v != null && bac > 0 ? pct(v / bac) : '0%');
  return months.map((label, i) => {
    const e = ev[i];
    const p = pv[i];
    const has = e != null;
    const spi = has && p ? e / p : null;
    return {
      label,
      planH: share(p),
      actH: has ? share(e) : '0%',
      spi,
      spiText: spi != null ? spi.toFixed(2) : '',
      spiAlert: spi != null && spi < SPI_MONTH_ALERT,
    };
  });
}

/** The five KPI tiles (`scheduleKpis`). SPI and % complete use the last month with earned value. */
export function scheduleKpis(h: ScheduleHeaderInput, pv: number[], ev: number[], bac: number): ScheduleKpi[] {
  const n = ev.length;
  const evNow = n ? ev[n - 1] : null;
  const pvNow = n ? pv[n - 1] : null;
  const spi = evNow != null && pvNow ? evNow / pvNow : null;
  const late = h.floatDays < 0;
  return [
    spi != null
      ? { key: 'spi', label: 'SPI', value: spi.toFixed(2), sub: 'Earning ' + Math.round(spi * 100) + '¢ of planned work per $1', alert: spi < SPI_KPI_ALERT }
      : { key: 'spi', label: 'SPI', value: '—', sub: '', alert: false },
    {
      key: 'complete',
      label: 'Complete',
      value: evNow != null && bac > 0 ? Math.round((evNow / bac) * 100) + '%' : '—',
      sub: pvNow != null && bac > 0 ? 'Planned ' + Math.round((pvNow / bac) * 100) + '% by today' : '',
      alert: false,
    },
    { key: 'finish', label: 'Forecast finish', value: h.finishText, sub: 'Baseline ' + h.baselineText, alert: late },
    { key: 'float', label: 'Critical path float', value: h.floatText, sub: h.critText, alert: late },
    { key: 'milestones', label: 'Milestones', value: h.milesText, sub: h.milesSub, alert: false },
  ];
}

/** Whole Schedule screen model for one project. */
export function scheduleView(d: ScheduleInput): ScheduleView {
  return {
    kpis: scheduleKpis(d.header, d.pv, d.ev, d.bac),
    tasks: d.bars.map(ganttTask),
    milestones: d.milestones.map((m) => scheduleMilestone(m, d.header.start, d.year)),
    progression: scheduleProgression(d.header.chartMonths, d.pv, d.ev, d.bac),
    todayL: ganttPos(d.header.tNow),
    ganttMonths: d.header.ganttMonths,
  };
}
