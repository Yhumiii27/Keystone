// Progress-bar family (docs/spec/02 C-18). Values are fractions 0..1 (clamped for widths) unless noted.
// Server-compatible.
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './Progress.module.css';

const w = (v: number, max = 1) => `${Math.round((Math.max(0, Math.min(v, max)) / max) * 1000) / 10}%`;

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  /**
   * `inline` 64×5 table cell · `card` 4px gradient (My projects) · `thin` 3px (checklist, board) · `md` 6px
   * (task progress, plan cell). Default `md`.
   */
  variant?: 'inline' | 'card' | 'thin' | 'md';
  /** Fill colour (CSS value) — `p.barColor` in the prototype. Default accent. */
  color?: string;
  /** Track width in px for `inline` (56 for stage deliverables). */
  trackWidth?: number;
  /** Trailing label (e.g. "64.4%"), tabular; `labelSize="sm"` = 12px, `labelTone="muted"` = neutral-300. */
  label?: ReactNode;
  labelSize?: 'inherit' | 'sm';
  labelTone?: 'text' | 'muted';
  /** Accessible name (translated). */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export function ProgressBar({ value, variant = 'md', color, trackWidth, label, labelSize = 'inherit', labelTone = 'text', ariaLabel, className, style }: ProgressBarProps) {
  const bar = (
    <div
      className={cx(s.track, s[variant], variant === 'md' && s.clip, label == null && className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label={ariaLabel}
      style={{ '--pb-w': w(value), '--pb-color': color, ...(trackWidth ? { '--pb-track-w': `${trackWidth}px` } : null), ...(label == null ? style : null) } as CSSProperties}
    >
      <div className={s.fill} />
    </div>
  );
  if (label == null) return bar;
  return (
    <div className={cx(s.withLabel, className)} style={style}>
      {bar}
      <span className={cx(s.label, labelSize === 'sm' && s.labelSm, labelTone === 'muted' && s.labelMuted)}>{label}</span>
    </div>
  );
}

export interface SpendVsEarnedProps {
  /** Budget spent share 0..1 (fill, neutral-300). */
  spent: number;
  /** Work earned share 0..1 (accent tick). */
  earned: number;
  /** Trailing label (12px neutral-300), e.g. "58.0%". */
  label?: ReactNode;
}

/** Overview "Spend vs earned": 84×5 track, spent fill neutral-300, earned tick 2×11 accent at top −3px. */
export function SpendVsEarned({ spent, earned, label }: SpendVsEarnedProps) {
  return (
    <div className={s.withLabel}>
      <div className={cx(s.track, s.spend)} style={{ '--pb-w': w(spent) } as CSSProperties}>
        <div className={s.fill} />
        <div className={s.tick} style={{ '--tk-left': w(earned) } as CSSProperties} />
      </div>
      {label != null && <span className={cx(s.label, s.labelSm, s.labelMuted)}>{label}</span>}
    </div>
  );
}

export interface CapacityBarProps {
  demand: number;
  capacity: number;
  /** Scale max; default `max(capacity, demand) × 1.1` (Resources). */
  scale?: number;
}

/** Resources capacity bar: 8px neutral-900 track; demand accent when over capacity else neutral-600; capacity tick 2×14 neutral-300. */
export function CapacityBar({ demand, capacity, scale }: CapacityBarProps) {
  const max = scale ?? Math.max(capacity, demand) * 1.1;
  return (
    <div className={cx(s.track, s.capacity)} style={{ '--pb-w': w(demand, max), '--pb-color': demand > capacity ? 'var(--color-accent)' : 'var(--color-neutral-600)' } as CSSProperties}>
      <div className={s.fill} />
      <div className={s.tick} style={{ '--tk-left': w(capacity, max), '--tk-h': '14px', '--tk-color': 'var(--color-neutral-300)' } as CSSProperties} />
    </div>
  );
}

export interface CapacityStackProps {
  committed: number;
  candidate: number;
  capacity: number;
  scale?: number;
}

/** Portfolio what-if: committed neutral-600 (radius 4 0 0 4) + candidate accent (0 4 4 0) + capacity tick. */
export function CapacityStack({ committed, candidate, capacity, scale }: CapacityStackProps) {
  const max = scale ?? Math.max(capacity, committed + candidate) * 1.1;
  return (
    <div className={cx(s.track, s.capacity, s.capacityStack)}>
      <div className={cx(s.seg, s.segFirst)} style={{ '--seg-w': w(committed, max), '--seg-color': 'var(--color-neutral-600)' } as CSSProperties} />
      <div className={cx(s.seg, s.segLast)} style={{ '--seg-w': w(candidate, max), '--seg-color': 'var(--color-accent)' } as CSSProperties} />
      <div className={s.tick} style={{ '--tk-left': w(capacity, max), '--tk-h': '14px', '--tk-color': 'var(--color-neutral-300)' } as CSSProperties} />
    </div>
  );
}

export interface BulletBarProps {
  /** Amounts in the same unit (k€). */
  actual: number;
  committed?: number;
  budget: number;
  /** Forecast at completion — accent diamond. */
  forecast?: number;
  /** Track height in px: 10 (Budget cost breakdown) or 8 (WBS variant). */
  height?: 10 | 8;
}

/**
 * Cost breakdown bullet (Budget 365–370, logic 3844): scale = budget × 1.4; actual neutral-300, committed
 * neutral-700, budget tick 2×16 neutral-500 at 1/1.4, forecast diamond at min(fc/b, 1.4)/1.4.
 */
export function BulletBar({ actual, committed = 0, budget, forecast, height = 10 }: BulletBarProps) {
  const b = budget || 1;
  return (
    <div className={cx(s.track, s.bullet)} style={{ '--bl-h': `${height}px`, '--bl-a': w(actual / b / 1.4), '--bl-c': w(committed / b / 1.4) } as CSSProperties}>
      <div className={s.bulletActual} />
      {committed > 0 && <div className={s.bulletCommitted} />}
      <div className={s.tick} style={{ '--tk-left': w(1 / 1.4), '--tk-h': '16px', '--tk-color': 'var(--color-neutral-500)' } as CSSProperties} />
      {forecast != null && <div className={s.diamond} style={{ '--dm-left': w(Math.min(forecast / b, 1.4) / 1.4) } as CSSProperties} />}
    </div>
  );
}

export interface StackedShareProps {
  /** Segments as fractions 0..1 of the total, drawn left to right. */
  segments: { value: number; color: string; title?: string }[];
}

/** Billing share bar: 10px, radius 5, neutral-800; e.g. paid accent then invoiced accent-700. */
export function StackedShare({ segments }: StackedShareProps) {
  return (
    <div className={s.share}>
      {segments.map((g, i) => (
        <div key={i} className={s.seg} title={g.title} style={{ '--seg-w': w(g.value), '--seg-color': g.color } as CSSProperties} />
      ))}
    </div>
  );
}

export interface OverlayBarProps {
  /** Layers drawn in order (later on top), fractions 0..1 — e.g. invoiced neutral-400 then paid accent. */
  layers: { value: number; color: string; title?: string }[];
}

/** Cash overlay bar: 6px, radius 3, neutral-800 with absolutely overlaid fills. */
export function OverlayBar({ layers }: OverlayBarProps) {
  return (
    <div className={cx(s.track, s.overlay)}>
      {layers.map((l, i) => (
        <div key={i} className={s.overlayFill} title={l.title} style={{ '--ov-w': w(l.value), '--ov-color': l.color } as CSSProperties} />
      ))}
    </div>
  );
}

export interface HatchedBarProps {
  /** Expected monetary value share 0..1 (hatched accent-800). */
  exposure: number;
  /** Used share 0..1 (accent, on top). */
  used: number;
}

/** Contingency bar: 8px, radius 4, neutral-800; EMV hatch + used accent on top. */
export function HatchedBar({ exposure, used }: HatchedBarProps) {
  return (
    <div className={cx(s.track, s.hatched)}>
      <div className={s.hatch} style={{ '--ht-w': w(exposure) } as CSSProperties} />
      <div className={s.overlayFill} style={{ '--ov-w': w(used), '--ov-color': 'var(--color-accent)' } as CSSProperties} />
    </div>
  );
}
