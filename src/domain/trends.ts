// Trends & status report logic (docs/spec/04 §2; prototype logic 4556–4568): indicator definitions (TKPI), the
// KPI row, the six selectable trend cards with their 4-week delta and sparkline, the 760×220 trend chart and the
// snapshot history. Pure functions over the weekly snapshot series; strings are the prototype's English source
// (render through t()), amounts through lib/format money(). Golden values: trends.test.ts.
//
// Deliberate deviations: chart axis labels of the day series (float, slip) are rounded to whole days (the
// prototype prints raw floats such as "+8.649999999999999 d"); the KPI subs follow the snapshots ("since 3 Jul",
// "W27 → W39") instead of literals, and the chart title counts the snapshots.
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { trendFrame, trendDelta } from '@/components/charts/primitives/geometry';

export type TrendKey = 'cpi' | 'spi' | 'eac' | 'float' | 'risk' | 'slip';
export const TREND_KEYS: readonly TrendKey[] = ['cpi', 'spi', 'eac', 'float', 'risk', 'slip'];

export type TrendSeries = Record<TrendKey, number[]>;

export interface SnapshotLike {
  /** "W39". */
  week: string;
  /** "25 Sep". */
  dateText: string;
  cpi: number;
  spi: number;
  eac: number;
  float: number;
  risk: number;
  slip: number;
}

/** `?kpi=` value → indicator (default CPI, `trendKpi` 3774). */
export const parseTrendKey = (v: unknown): TrendKey => (typeof v === 'string' && (TREND_KEYS as string[]).includes(v) ? (v as TrendKey) : 'cpi');

/** Signed day count with the U+2212 minus: "+4 d" / "−27 d" (float format, TKPI 4559). */
export const signedDays = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v) + ' d';

export interface TrendDef {
  key: TrendKey;
  /** EN label ("Critical-path float"). */
  label: string;
  /** Value format of the cards and the history (toFixed(2), money, ±n d, n d). */
  format: (v: number) => string;
  /** Axis-label format (day series rounded to whole days). */
  axis: (v: number) => string;
  /** Dashed target line; null for risk exposure. */
  target: number | null;
  /** Target text shown on the card and the chart subtitle. */
  targetText: string;
  /** EAC, risk exposure and slip get worse when they rise; CPI, SPI and float when they fall. */
  higherIsWorse: boolean;
}

/** TKPI (logic 4559): BAC is the EAC target; the risk card quotes the contingency reserve. */
export function trendDefs(bac: number, contingency: number | null, lang: Lang): TrendDef[] {
  const f = (k: number) => money(k, lang);
  const ratio = (v: number) => v.toFixed(2);
  return [
    { key: 'cpi', label: 'CPI', format: ratio, axis: ratio, target: 1, targetText: '≥ 1.00', higherIsWorse: false },
    { key: 'spi', label: 'SPI', format: ratio, axis: ratio, target: 1, targetText: '≥ 1.00', higherIsWorse: false },
    { key: 'eac', label: 'EAC', format: f, axis: f, target: bac, targetText: 'BAC ' + f(bac), higherIsWorse: true },
    { key: 'float', label: 'Critical-path float', format: signedDays, axis: (v) => signedDays(Math.round(v)), target: 0, targetText: '≥ 0', higherIsWorse: false },
    { key: 'risk', label: 'Risk exposure (EMV)', format: f, axis: f, target: null, targetText: contingency != null ? 'Contingency ' + f(contingency) : '—', higherIsWorse: true },
    { key: 'slip', label: 'Milestone slip', format: (v) => v + ' d', axis: (v) => Math.round(v) + ' d', target: 0, targetText: '0 d', higherIsWorse: true },
  ];
}

// ── KPI row (trendKpis 4568) ─────────────────────────────────────────────────────────────────────────

export interface TrendKpi {
  label: string;
  value: string;
  sub: string;
  alert: boolean;
}

export function trendKpis(snapshots: SnapshotLike[], series: TrendSeries, nextReport: string | null, lang: Lang): TrendKpi[] {
  const n = snapshots.length;
  const first = snapshots[0];
  const last = snapshots[n - 1];
  const cpiNow = series.cpi[n - 1];
  const cpiPrev = series.cpi[Math.max(0, n - 5)];
  const dCpi = cpiNow - cpiPrev;
  const dEac = series.eac[n - 1] - series.eac[0];
  const dFloat = series.float[n - 1] - series.float[0];
  return [
    { label: 'Snapshots', value: String(n), sub: `Weekly · Fridays · since ${first.dateText}`, alert: false },
    { label: 'CPI trend', value: (dCpi >= 0 ? '+' : '−') + Math.abs(dCpi).toFixed(2), sub: 'Last 4 weeks', alert: cpiNow < cpiPrev },
    { label: 'EAC drift', value: money(dEac, lang, { signed: true }), sub: 'Since first snapshot', alert: dEac > 0 },
    // Plain hyphen for the loss, as the prototype ("-31 d").
    { label: 'Float lost', value: dFloat + ' d', sub: `${first.week} → ${last.week}`, alert: dFloat < 0 },
    { label: 'Next status report', value: nextReport ?? '—', sub: 'One-page PDF + live dashboard link', alert: false },
  ];
}

// ── Indicator cards (trendCards 4565) ────────────────────────────────────────────────────────────────

export interface TrendCard {
  key: TrendKey;
  label: string;
  targetText: string;
  value: string;
  /** "−0.01 · 4 wk", "+€76k · 4 wk", "−9 d · 4 wk". */
  delta: string;
  /** Deterioration over the last 4 weeks → LO. */
  worse: boolean;
  series: number[];
  selected: boolean;
}

export function trendCards(defs: TrendDef[], series: TrendSeries, selected: TrendKey, lang: Lang): TrendCard[] {
  return defs.map((d) => {
    const a = series[d.key];
    const { last, delta, worse } = trendDelta(a, d.higherIsWorse);
    const sign = delta >= 0 ? '+' : '−';
    const text =
      d.key === 'cpi' || d.key === 'spi'
        ? sign + Math.abs(delta).toFixed(2)
        : d.key === 'eac' || d.key === 'risk'
          ? money(delta, lang, { signed: true })
          : sign + Math.abs(delta) + ' d';
    return { key: d.key, label: d.label, targetText: d.targetText, value: d.format(last), delta: text + ' · 4 wk', worse, series: a, selected: d.key === selected };
  });
}

// ── Trend chart (spark 4561–4563, CH-3) ─────────────────────────────────────────────────────────────

export const TREND_CHART = { W: 760, H: 220, L: 48, R: 16, T: 14, B: 26, labelY: 212 } as const;

export interface TrendChartModel {
  grid: { y: number; label: string }[];
  labels: { x: number; label: string }[];
  path: string;
  area: string;
  targetY: number | null;
  last: { cx: number; cy: number } | null;
}

export function trendChart(def: TrendDef, values: number[], weeks: string[]): TrendChartModel {
  const { W, H } = TREND_CHART;
  const fr = trendFrame(values, W, H, def.target);
  return {
    grid: fr.grid.map((g) => ({ y: g.y, label: def.axis(g.value) })),
    labels: weeks.map((w, i) => ({ x: fr.x(i), label: w })),
    path: fr.path,
    area: fr.area,
    targetY: fr.targetY,
    last: fr.last,
  };
}

// ── Snapshot history (snapRows 4567) ─────────────────────────────────────────────────────────────────

export interface SnapshotRowView {
  week: string;
  date: string;
  cpi: string;
  cpiLo: boolean;
  spi: string;
  spiLo: boolean;
  eac: string;
  float: string;
  floatLo: boolean;
  risk: string;
  slip: string;
}

/** History rows, newest first; CPI/SPI below 0.97 and negative float in LO. */
export function snapshotRows(snapshots: SnapshotLike[], lang: Lang): SnapshotRowView[] {
  return snapshots
    .map((s) => ({
      week: s.week,
      date: s.dateText,
      cpi: s.cpi.toFixed(2),
      cpiLo: s.cpi < 0.97,
      spi: s.spi.toFixed(2),
      spiLo: s.spi < 0.97,
      eac: money(s.eac, lang),
      float: signedDays(s.float),
      floatLo: s.float < 0,
      risk: money(s.risk, lang),
      slip: s.slip + ' d',
    }))
    .reverse();
}
