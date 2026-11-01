// R-205: histogram and S-curve of a Monte-Carlo distribution (geometry: chart-model.ts). Single series in the accent colour,
// recessive grid, P50 / P80 marks solid and the target dashed, each named on the chart (never by colour alone). Hover: a native
// tooltip on each bar and on each S-curve point. Server-compatible.
import { ChartFrame, HGrid } from '@/components/charts/primitives/Frame';
import { CHART, type ChartModel } from './chart-model';

export interface DistributionChartProps {
  model: ChartModel;
  /** Accessible title (translated). */
  label: string;
  /** Tooltips of the S-curve points (same order as the path's points); omitted for a histogram. */
  pointTips?: { x: number; y: number; tip: string }[];
}

export function DistributionChart({ model, label, pointTips }: DistributionChartProps) {
  const base = CHART.H - CHART.B;
  return (
    <ChartFrame width={CHART.W} height={CHART.H} label={label}>
      <HGrid rows={model.grid} x1={CHART.L} x2={CHART.W - CHART.R} labelX={CHART.L - 6} fontSize={10.5} baseline="middle" />
      {model.bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(3, b.w / 2)} fill="var(--color-accent)" opacity={0.85}>
          <title>{b.tip}</title>
        </rect>
      ))}
      {model.path && <path d={model.path} fill="none" stroke="var(--color-accent)" strokeWidth={2} />}
      {pointTips?.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={6} fill="transparent">
          <title>{p.tip}</title>
        </circle>
      ))}
      {model.markers.map((m, i) => (
        <g key={i}>
          <line x1={m.x} x2={m.x} y1={CHART.T - 4 - m.row * 12} y2={base} stroke="var(--color-neutral-300)" strokeWidth={1} strokeDasharray={m.kind === 'target' ? '4 3' : undefined} />
          <text x={m.x} y={CHART.T - 8 - m.row * 12} fill="var(--color-neutral-300)" style={{ fontSize: 10.5, textAnchor: 'middle' }}>
            {m.label}
          </text>
        </g>
      ))}
      {model.ticks.map((tk, i) => (
        <text key={i} x={tk.x} y={CHART.H - 8} fill="var(--color-neutral-500)" style={{ fontSize: 10.5, textAnchor: 'middle' }}>
          {tk.label}
        </text>
      ))}
    </ChartFrame>
  );
}
