// Chart legend items (docs/spec/02 C-28). Server-compatible.
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import { SHADE_SCALE } from './tones';
import s from './Legend.module.css';

export type SwatchKind = 'line' | 'block' | 'bar' | 'baseline' | 'diamond' | 'tick' | 'hatched' | 'dashedOutline' | 'dot';

export interface SwatchProps {
  kind: SwatchKind;
  /** Fill / stroke colour (CSS value). */
  color?: string;
  /** `bar`: inset 1px edge colour. */
  edge?: string;
  /** `line`: stroke style. */
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  /** Override the default size of the kind (px). */
  width?: number;
  height?: number;
}

const SIZE: Record<SwatchKind, [number, number]> = {
  line: [14, 0],
  block: [10, 10],
  bar: [16, 8],
  baseline: [16, 4],
  diamond: [8, 8],
  tick: [2, 10],
  hatched: [18, 8],
  dashedOutline: [18, 8],
  dot: [10, 10],
};

/**
 * Swatch kinds: `line` 14px 2px border-top (solid/dashed/dotted) · `block` 10×10 r2 (12×6, 12×5 via width/height) ·
 * `bar` 16×8 r2 + inset edge · `baseline` 16×4 · `diamond` 8×8 rotated · `tick` 2×10 · `hatched` 18×8 dashed neutral-600
 * hatch · `dashedOutline` 18×8 dashed border · `dot` 10px circle.
 */
export function Swatch({ kind, color, edge, lineStyle = 'solid', width, height }: SwatchProps) {
  const [dw, dh] = SIZE[kind];
  const vars = {
    '--sw-w': `${width ?? dw}px`,
    '--sw-h': `${height ?? dh}px`,
    '--sw-bg': kind === 'line' || kind === 'hatched' || kind === 'dashedOutline' ? undefined : color,
    '--sw-color': color,
    '--sw-style': lineStyle,
    '--sw-edge': kind === 'bar' && edge ? `inset 0 0 0 1px ${edge}` : undefined,
    '--sw-r': kind === 'tick' || kind === 'baseline' ? '0' : undefined,
  } as CSSProperties;
  return <span className={cx(s.sw, kind === 'line' && s.line, kind === 'diamond' && s.diamond, kind === 'hatched' && s.hatched, kind === 'dashedOutline' && s.dashedOutline, kind === 'dot' && s.dot)} style={vars} aria-hidden />;
}

export interface LegendProps {
  /** `header` 12px neutral-300 · gap 14 (chart headers) · `footer` 11.5px neutral-400 · gap 16 · padding-top 4px. */
  variant?: 'header' | 'footer';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Legend({ variant = 'header', className, style, children }: LegendProps) {
  return (
    <div className={cx(s.legend, variant === 'footer' && s.footer, className)} style={style}>
      {children}
    </div>
  );
}

export interface LegendItemProps extends SwatchProps {
  children: ReactNode;
}

/** `display:flex;align-items:center;gap:6px` swatch + translated label. */
export function LegendItem({ children, ...swatch }: LegendItemProps) {
  return (
    <span className={s.item}>
      <Swatch {...swatch} />
      {children}
    </span>
  );
}

/** Allocation heat scale: "Under" · 5 swatches 16×10 r2 (shade() steps) · "Over" (labels translated by the caller). */
export function HeatScale({ under, over }: { under: ReactNode; over: ReactNode }) {
  return (
    <span className={s.item}>
      {under}
      <span className={s.scale}>
        {SHADE_SCALE.map((c) => (
          <Swatch key={c} kind="block" color={c} width={16} height={10} />
        ))}
      </span>
      {over}
    </span>
  );
}
