// Eyebrows / section labels (docs/spec/02 C-06). Server-compatible.
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './Eyebrow.module.css';

/**
 * - `section` 10.5px · .08em · uppercase · accent · margin-bottom 4px (inside cards/drawers)
 * - `muted` same in neutral-400 (KPI labels, panel headers)
 * - `sub` 11px · .06em · neutral-500 ("Projects & BOMs · 3")
 * - `label` 10.5px · .06em · neutral-500 (mini metric labels in project cards: SPI, CPI…)
 * - `menu` 10px · .08em · neutral-500 · padding 4px 8px 6px (popover headers)
 */
export type EyebrowVariant = 'section' | 'muted' | 'sub' | 'label' | 'menu';

export interface EyebrowProps {
  variant?: EyebrowVariant;
  /** Remove the section variant's margin-bottom (eyebrow inside a header row). */
  flush?: boolean;
  as?: 'span' | 'div';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Eyebrow({ variant = 'section', flush, as: As = 'span', className, style, children }: EyebrowProps) {
  return (
    <As className={cx(s.base, s[variant], flush && s.flush, className)} style={style}>
      {children}
    </As>
  );
}

export interface GroupDividerProps {
  label: ReactNode;
  count?: ReactNode;
  /** Spans all columns of a CSS-grid table (`grid-column:1 / -1`). */
  fullRow?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Group header: eyebrow label + tabular count (neutral-500) + rule fading from neutral-800. */
export function GroupDivider({ label, count, fullRow, className, style }: GroupDividerProps) {
  return (
    <div className={cx(s.divider, fullRow && s.fullRow, className)} style={style}>
      <span>{label}</span>
      {count != null && <span className={s.count}>{count}</span>}
      <span className={s.rule} />
    </div>
  );
}

/** Alias of `Eyebrow` (docs/spec/02 C-06 "SectionLabel"). */
export const SectionLabel = Eyebrow;
