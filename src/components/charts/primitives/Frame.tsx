// SVG chart frame, grid rows and axis labels shared by the hand-made charts (docs/spec/02 DS-CHARTS).
// Colours are tokens (the prototype's raw hex #292b31 → neutral-900, #9397ab → neutral-500…). Server-compatible.
import type { CSSProperties, ReactNode } from 'react';

export interface ChartFrameProps {
  /** viewBox width × height (e.g. 760 × 290 EVM, 760 × 220 trend). Rendered `width:100%;height:auto;display:block`. */
  width: number;
  height: number;
  /** Optional min-width (CSS px) for charts inside a horizontally scrolling card (cash chart: 560). */
  minWidth?: number;
  /** Accessible title (translated). */
  label?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function ChartFrame({ width, height, minWidth, label, className, style, children }: ChartFrameProps) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block', minWidth, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

export interface HGridProps {
  /** Rows: y coordinate and label text. */
  rows: { y: number; label?: ReactNode }[];
  /** Line extent. */
  x1: number;
  x2: number;
  /** Label anchor x (text-anchor end). */
  labelX: number;
  /** Label font size (11 EVM, 10.5 trend). */
  fontSize?: number;
  /** `middle` (trend: dominant-baseline middle) or `offset` (EVM: y + 4). */
  baseline?: 'middle' | 'offset';
  lineColor?: string;
  labelColor?: string;
}

/** Horizontal grid lines (neutral-900) with right-aligned value labels (neutral-500). */
export function HGrid({ rows, x1, x2, labelX, fontSize = 11, baseline = 'offset', lineColor = 'var(--color-neutral-900)', labelColor = 'var(--color-neutral-500)' }: HGridProps) {
  return (
    <g>
      {rows.map((r, i) => (
        <g key={i}>
          <line x1={x1} x2={x2} y1={r.y} y2={r.y} stroke={lineColor} />
          {r.label != null && (
            <text
              x={labelX}
              y={baseline === 'offset' ? r.y + 4 : r.y}
              fill={labelColor}
              style={{ fontSize, textAnchor: 'end', dominantBaseline: baseline === 'middle' ? 'middle' : undefined }}
            >
              {r.label}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

export interface XLabelsProps {
  labels: { x: number; label: ReactNode }[];
  y: number;
  fontSize?: number;
  color?: string;
}

/** Centred x-axis labels (month names, snapshot dates). */
export function XLabels({ labels, y, fontSize = 11, color = 'var(--color-neutral-500)' }: XLabelsProps) {
  return (
    <g>
      {labels.map((l, i) => (
        <text key={i} x={l.x} y={y} fill={color} style={{ fontSize, textAnchor: 'middle' }}>
          {l.label}
        </text>
      ))}
    </g>
  );
}

/** Vertical fade gradient for area fills (EV area `evfill` .28→0, trend `trfill` .25→0). Reference with `fill="url(#id)"`. */
export function AreaGradient({ id, color = 'var(--color-accent)', opacity = 0.25 }: { id: string; color?: string; opacity?: number }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity={opacity} />
        <stop offset="1" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

/** End-point marker: circle r 4, ground fill, coloured stroke 2 (trend last point, EAC marker). */
export function PointMarker({ cx, cy, r = 4, color = 'var(--color-accent)', strokeWidth = 2, title }: { cx: number; cy: number; r?: number; color?: string; strokeWidth?: number; title?: string }) {
  return (
    <circle cx={cx} cy={cy} r={r} fill="var(--color-bg)" stroke={color} strokeWidth={strokeWidth}>
      {title && <title>{title}</title>}
    </circle>
  );
}
