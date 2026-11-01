// R-205: geometry of the two charts of each distribution (finish date, cost at completion) — a histogram (frequency) and an
// S-curve (cumulative probability). Two charts, never one chart with two y-scales (count and %). Pure; the labels are formatted
// by the caller (dates or k€ in the viewer's language).
import type { CurvePoint, HistogramBin } from '@/domain/monte-carlo';

export const CHART = { W: 560, H: 200, L: 44, R: 14, T: 32, B: 26 } as const;

export interface Marker {
  /** "P50", "P80", "Target"… (translated by the caller). */
  label: string;
  value: number;
  /** Dashed reference (target) or solid percentile mark. */
  kind: 'percentile' | 'target';
}

export interface ChartModel {
  bars: { x: number; y: number; w: number; h: number; tip: string }[];
  /** S-curve path (empty for a histogram). */
  path: string;
  grid: { y: number; label: string }[];
  ticks: { x: number; label: string }[];
  /** `row` 0 / 1: labels of marks closer than 40 px are staggered. */
  markers: { x: number; label: string; kind: Marker['kind']; row: number }[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function domainOf(lo: number, hi: number, markers: readonly Marker[]): [number, number] {
  let a = lo;
  let b = hi;
  for (const m of markers) {
    a = Math.min(a, m.value);
    b = Math.max(b, m.value);
  }
  if (!(b > a)) return [a - 1, b + 1];
  const pad = (b - a) * 0.03;
  return [a - pad, b + pad];
}

function axis(lo: number, hi: number, fmt: (v: number) => string, markers: readonly Marker[]) {
  const [a, b] = domainOf(lo, hi, markers);
  const x = (v: number) => r1(CHART.L + ((v - a) / (b - a)) * (CHART.W - CHART.L - CHART.R));
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const v = a + ((b - a) * (i + 0.5)) / 5;
    return { x: x(v), label: fmt(v) };
  });
  const placed = markers.map((m) => ({ x: x(m.value), label: m.label, kind: m.kind, row: 0 })).sort((p, q) => p.x - q.x);
  for (let i = 1; i < placed.length; i++) if (placed[i].x - placed[i - 1].x < 40) placed[i].row = placed[i - 1].row ? 0 : 1;
  return { x, ticks, markers: placed };
}

/** Histogram: one bar per bin (2px gap), height by count; `tip` = "<from> – <to> · <n> runs" built by `tipOf`. */
export function histogramModel(
  bins: readonly HistogramBin[],
  fmt: (v: number) => string,
  markers: readonly Marker[],
  tipOf: (b: HistogramBin) => string,
): ChartModel {
  if (!bins.length) return { bars: [], path: '', grid: [], ticks: [], markers: [] };
  const ax = axis(bins[0].from, bins[bins.length - 1].to, fmt, markers);
  const top = Math.max(...bins.map((b) => b.count));
  const plotH = CHART.H - CHART.T - CHART.B;
  const base = CHART.H - CHART.B;
  const bars = bins.map((b) => {
    const x0 = ax.x(b.from);
    const x1 = ax.x(b.to);
    const h = top ? r1((b.count / top) * plotH) : 0;
    return { x: r1(x0 + 1), y: r1(base - h), w: Math.max(1, r1(x1 - x0 - 2)), h, tip: tipOf(b) };
  });
  const grid = [0, 0.5, 1].map((f) => ({ y: r1(base - f * plotH), label: String(Math.round(f * top)) }));
  return { bars, path: '', grid, ticks: ax.ticks, markers: ax.markers };
}

/** S-curve: cumulative probability 0–100 % against the value. */
export function curveModel(curve: readonly CurvePoint[], fmt: (v: number) => string, markers: readonly Marker[]): ChartModel {
  if (!curve.length) return { bars: [], path: '', grid: [], ticks: [], markers: [] };
  const ax = axis(curve[0].x, curve[curve.length - 1].x, fmt, markers);
  const plotH = CHART.H - CHART.T - CHART.B;
  const base = CHART.H - CHART.B;
  const y = (p: number) => r1(base - p * plotH);
  const path = curve.map((c, i) => `${i ? 'L' : 'M'}${ax.x(c.x)},${y(c.p)}`).join(' ');
  const grid = [0, 0.5, 0.8, 1].map((p) => ({ y: y(p), label: `${Math.round(p * 100)}%` }));
  return { bars: [], path, grid, ticks: ax.ticks, markers: ax.markers };
}
