// Sparkline (docs/spec/02 CH-4): 120×32 accent path, stroke 1.5, no fill. Server-compatible.
import type { CSSProperties } from 'react';
import { sparkPath } from './geometry';

export interface SparklineProps {
  values: number[];
  /** viewBox width/height (prototype 120 × 32; rendered at the same CSS size). */
  width?: number;
  height?: number;
  /** Stroke colour (CSS value). Default accent. */
  color?: string;
  strokeWidth?: number;
  /** Accessible description (translated); decorative when omitted. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function Sparkline({ values, width = 120, height = 32, color = 'var(--color-accent)', strokeWidth = 1.5, label, className, style }: SparklineProps) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      style={{ width, height, flex: 'none', ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={sparkPath(values, width, height)} fill="none" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}
