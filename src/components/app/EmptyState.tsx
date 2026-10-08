// Empty states (docs/spec/02 C-25). Server-compatible; text is passed in translated.
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './EmptyState.module.css';

export interface EmptyStateProps {
  /**
   * - `inline` 12.5px neutral-500 · padding 8px 0 (below lists/tables; `pad` 4/6/10 variants)
   * - `boxed` 12.5px neutral-400 · padding 14 · centred · neutral-900 ground
   * - `boxedLg` 13px · padding 16 (Approvals)
   * - `column` 12px neutral-500 · padding 8px 2px (board columns)
   * - `menu` 12px neutral-500 · padding 6px 8px (popovers)
   * - `dropzone` 5:1 dashed neutral-700 box, 12px neutral-500 ("Drop a file or click to choose")
   * - `drop` dashed box with a 26px accent icon (import dialogs)
   */
  variant?: 'inline' | 'boxed' | 'boxedLg' | 'column' | 'menu' | 'dropzone' | 'drop';
  /** Vertical padding for `inline` in px (4, 6, 8 default, 10). */
  pad?: number;
  /** Icon for `drop`. */
  icon?: Icon;
  /** Click handler for drop zones (Client Components only) — renders a button. */
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function EmptyState({ variant = 'inline', pad, icon: I, onClick, className, children }: EmptyStateProps) {
  const cls = cx(
    variant === 'boxedLg' ? cx(s.boxed, s.boxedLg) : s[variant],
    onClick && s.clickable,
    className,
  );
  const style = variant === 'inline' && pad != null ? ({ '--es-pad': `${pad}px` } as CSSProperties) : undefined;
  const inner = (
    <>
      {variant === 'drop' && I && <I className={s.dropIcon} aria-hidden />}
      {children}
    </>
  );
  if (onClick)
    return (
      <button type="button" className={cls} style={style} onClick={onClick}>
        {inner}
      </button>
    );
  return variant === 'boxed' || variant === 'boxedLg' || variant === 'drop' || variant === 'dropzone' ? (
    <div className={cls} style={style}>
      {inner}
    </div>
  ) : (
    <span className={cls} style={style}>
      {inner}
    </span>
  );
}
