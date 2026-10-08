// Pure chart geometry helpers ported from the prototype's hand-made SVG charts (docs/spec/02 DS-CHARTS).
// No React — usable on the server, in client islands and in tests.

export interface Margins {
  L: number;
  R: number;
  T: number;
  B: number;
}

/** Linear map from [d0, d1] to [r0, r1]. Degenerate domains map to the range midpoint. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  return (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
}

/** One-decimal coordinate as the prototype writes it (`toFixed(1)`). */
export const fx = (n: number) => n.toFixed(1);

/** SVG path "M x y L x y …" through the points (coordinates with one decimal). */
export function linePath(points: [number, number][]): string {
  return points.length ? 'M' + points.map(([x, y]) => `${fx(x)} ${fx(y)}`).join(' L') : '';
}

/** Closed area under a line down to `baseY` (trend chart area: line, then L lastX baseY L firstX baseY Z). */
export function areaPath(points: [number, number][], baseY: number, baseX0?: number): string {
  if (!points.length) return '';
  const last = points[points.length - 1];
  return `${linePath(points)} L${fx(last[0])} ${baseY} L${baseX0 ?? points[0][0]} ${baseY} Z`;
}

/**
 * EVM grid step (CH-1, logic 3820): first of [100, 200, 250, 500, 1000, 2000] with ymax/step ≤ 6.5,
 * fallback 2000. Returns the step and the tick values 0..ymax.
 */
export function evmGrid(ymax: number, steps: number[] = [100, 200, 250, 500, 1000, 2000]): { step: number; ticks: number[] } {
  const step = steps.find((st) => ymax / st <= 6.5) ?? steps[steps.length - 1];
  const ticks: number[] = [];
  for (let v = 0; v <= ymax + 1e-9; v += step) ticks.push(v);
  return { step, ticks };
}

/**
 * Trend chart frame (CH-3 `spark(arr, W, H, target)`, logic 4561): margins L48 R16 T14 B26, range padded
 * by 15 % (or 1 when flat), five grid rows at t ∈ {0, .25, .5, .75, 1}.
 */
export function trendFrame(values: number[], W = 760, H = 220, target?: number | null, m: Margins = { L: 48, R: 16, T: 14, B: 26 }) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (target != null) {
    lo = Math.min(lo, target);
    hi = Math.max(hi, target);
  }
  const pad = (hi - lo) * 0.15 || 1;
  lo -= pad;
  hi += pad;
  const n = values.length;
  const x = (i: number) => m.L + (n > 1 ? i / (n - 1) : 0) * (W - m.L - m.R);
  const y = (v: number) => m.T + (1 - (v - lo) / (hi - lo)) * (H - m.T - m.B);
  const pts = values.map((v, i) => [x(i), y(v)] as [number, number]);
  return {
    lo,
    hi,
    x,
    y,
    path: linePath(pts),
    area: areaPath(pts, H - m.B, m.L),
    targetY: target != null ? y(target) : null,
    grid: [0, 0.25, 0.5, 0.75, 1].map((t) => ({ y: m.T + t * (H - m.T - m.B), value: hi - t * (hi - lo) })),
    last: n ? { cx: x(n - 1), cy: y(values[n - 1]) } : null,
  };
}

/** Sparkline path (CH-4 `mini(arr)`, logic 4564): W 120 × H 32, 2px vertical inset, flat series centred. */
export function sparkPath(values: number[], W = 120, H = 32): string {
  if (!values.length) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const n = values.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => (hi === lo ? H / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (H - 4));
  return linePath(values.map((v, i) => [x(i), y(v)]));
}

/**
 * Trend-card delta (logic 4565): last value vs. the value 4 snapshots earlier (`a[a.length − 5]`).
 * `higherIsWorse` for EAC, risk exposure and slip.
 */
export function trendDelta(values: number[], higherIsWorse: boolean): { last: number; prev: number; delta: number; worse: boolean } {
  const last = values[values.length - 1];
  const prev = values[Math.max(0, values.length - 5)];
  return { last, prev, delta: last - prev, worse: higherIsWorse ? last > prev : last < prev };
}

/** Month-float position as a CSS percentage of a timeline of `span` months (Gantt `pos(m) = pct(m/13)`). */
export const timelinePct = (m: number, span: number) => Math.round((m / span) * 1000) / 10 + '%';
