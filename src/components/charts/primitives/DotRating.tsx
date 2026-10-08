// Dot rating (docs/spec/02 CH-12 DotRating; skills use lvColor). Server-compatible.
import { cx } from '@/components/ds/cx';
import s from './DotRating.module.css';

export interface DotRatingProps {
  /** Filled dots (0..max). */
  value: number;
  max?: number;
  /** Fill colour of a filled dot (CSS value) or a function of the value (e.g. `levelColor`). Default accent. */
  color?: string | ((value: number) => string);
  /** Empty dot colour. Default neutral-900. */
  empty?: string;
  /** Accessible text, e.g. "3 / 5" (translated). */
  label?: string;
  className?: string;
}

export function DotRating({ value, max = 5, color = 'var(--color-accent)', empty = 'var(--color-neutral-900)', label, className }: DotRatingProps) {
  const fill = typeof color === 'function' ? color(value) : color;
  return (
    <span className={cx(s.row, className)} role={label ? 'img' : undefined} aria-label={label}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={s.dot} style={{ background: i < value ? fill : empty }} />
      ))}
    </span>
  );
}
