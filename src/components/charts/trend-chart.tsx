// Trend chart of the Trends & status report screen (docs/spec/04 §2.4, docs/spec/02 CH-3; template 1752–1759):
// 760×220 SVG — 5 grid rows with value labels, week labels, dashed target line, gradient area, 2.5px series line
// and a ground-filled marker on the last snapshot. Geometry comes from `trendChart()` (src/domain/trends.ts).
// Prototype hex colours map to tokens: #292b31 neutral-900, #9397ab neutral-500, #75798c neutral-600, #9184d9 accent.
import type { TrendChartModel } from '@/domain/trends';
import { AreaGradient, ChartFrame, HGrid, PointMarker, XLabels } from './primitives/Frame';

export interface TrendChartProps {
  model: TrendChartModel;
  /** Accessible title (translated), e.g. "CPI — 13 weekly snapshots". */
  label?: string;
}

const L = 48;
const X2 = 744;

export function TrendChart({ model, label }: TrendChartProps) {
  return (
    <ChartFrame width={760} height={220} label={label}>
      <AreaGradient id="trfill" color="var(--color-accent)" opacity={0.25} />
      <HGrid rows={model.grid} x1={L} x2={X2} labelX={42} fontSize={10.5} baseline="middle" />
      <XLabels labels={model.labels} y={212} fontSize={10.5} />
      {model.targetY != null && <line x1={L} x2={X2} y1={model.targetY} y2={model.targetY} stroke="var(--color-neutral-600)" strokeDasharray="5 4" />}
      <path d={model.area} fill="url(#trfill)" />
      <path d={model.path} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} />
      {model.last && <PointMarker cx={model.last.cx} cy={model.last.cy} />}
    </ChartFrame>
  );
}
