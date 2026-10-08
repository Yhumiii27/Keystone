// In-card list row (docs/spec/02 C-12): `grid minmax(0,1fr) auto; gap 12px; padding 8px 0; border-top neutral-900`.
// Server-compatible: `href` renders a Link, `onClick` (Client Components) a button.
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './ListRow.module.css';

export interface ListRowProps {
  /** 13px title (translated). */
  title: ReactNode;
  /** 11.5px neutral-400 sub-line. */
  sub?: ReactNode;
  /** Right part (tag, amount, buttons…). */
  right?: ReactNode;
  /** Leading 28px column (IconTile, Avatar, CheckCircle) — template becomes `28px minmax(0,1fr)[ auto]`. */
  leading?: ReactNode;
  /** Leading column width in px (28 default; 20 for check toggles, 18 for small icons). */
  leadingWidth?: number;
  /** Explicit grid-template-columns (overrides the computed one), e.g. "minmax(0,1fr) auto auto". */
  columns?: string;
  /** Vertical padding in px: 8 (default), 5, 6, 7, 9, 10. */
  padding?: number;
  /** Column gap in px (12 default; 10 for icon rows). */
  gap?: number;
  /** `start` aligns items to the top (icon rows with multi-line text). */
  align?: 'center' | 'start';
  /** Title weight 500. */
  strong?: boolean;
  /** No top rule (first row under a header). */
  noBorder?: boolean;
  /** Hover: `bg` neutral-900 · `soft` text 3% · `text` accent-300 · `none` (default). */
  hover?: 'none' | 'bg' | 'soft' | 'text';
  href?: string;
  onClick?: () => void;
  /** Extra content under the title/sub (e.g. an inline "Action →" button). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function ListRow({
  title,
  sub,
  right,
  leading,
  leadingWidth = 28,
  columns,
  padding,
  gap,
  align = 'center',
  strong,
  noBorder,
  hover = 'none',
  href,
  onClick,
  children,
  className,
  style,
}: ListRowProps) {
  const cols = columns ?? [leading != null ? `${leadingWidth}px` : null, 'minmax(0,1fr)', right != null ? 'auto' : null].filter(Boolean).join(' ');
  const vars = {
    '--lr-cols': cols,
    ...(padding != null ? { '--lr-pad': `${padding}px` } : null),
    ...(gap != null ? { '--lr-gap': `${gap}px` } : null),
    ...(align !== 'center' ? { '--lr-align': align } : null),
    ...(children != null ? { '--lr-stack-gap': '2px' } : null),
    ...style,
  } as CSSProperties;
  const cls = cx(
    s.row,
    noBorder && s.noBorder,
    (href || onClick) && s.clickable,
    hover === 'bg' && s.hoverBg,
    hover === 'soft' && s.hoverSoft,
    hover === 'text' && s.hoverText,
    className,
  );
  const inner = (
    <>
      {leading}
      <div className={s.left}>
        <span className={cx(s.title, strong && s.titleStrong)}>{title}</span>
        {sub != null && sub !== '' && <span className={s.sub}>{sub}</span>}
        {children}
      </div>
      {right != null && <div className={s.right}>{right}</div>}
    </>
  );
  if (href)
    return (
      <Link href={href} className={cls} style={vars}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className={cls} style={vars} onClick={onClick}>
        {inner}
      </button>
    );
  return (
    <div className={cls} style={vars}>
      {inner}
    </div>
  );
}
