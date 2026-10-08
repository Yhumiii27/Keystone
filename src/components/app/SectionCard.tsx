// Section card + page layout helpers (docs/spec/02 C-05, DS-LAYOUT › Page rhythm & Grids). Server-compatible.
import Link from 'next/link';
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import s from './SectionCard.module.css';

export interface SectionCardProps {
  /** `.card-title` (translated). */
  title?: ReactNode;
  /** Stacked header: 12px neutral-400 line under the title. */
  subtitle?: ReactNode;
  /** Inline header: 12px neutral-400 hint on the right of the title (e.g. "6 projects · FY2026"). */
  hint?: ReactNode;
  /** Header actions on the right (ghost buttons, legends, segmented…). */
  actions?: ReactNode;
  /** Leading accent icon (16px, margin-top 2px) — iconic header. */
  icon?: Icon;
  /** Compact 15px title (Task screen). */
  compactTitle?: boolean;
  /** margin-bottom under a lone title in px (Home lists use 4). */
  titleGap?: number;
  /** Card gap in px. Default 8. */
  gap?: number;
  /** `overflow:auto` — cards holding a table or a wide grid. */
  scroll?: boolean;
  /** Flex shorthand when the card sits in a flex row, e.g. "3 1 950px" (adds min-width:0). */
  flex?: string;
  /** `tinted` (accent-900 ground) · `highlight` (row layout + accent-800 border) · `groupList` (padding 10px 16px 4px, gap 0). */
  variant?: 'default' | 'tinted' | 'highlight' | 'groupList';
  /** Clickable card (My projects): renders a Link with the accent-700 hover ring. */
  href?: string;
  /** Clickable card handler (Client Components only); renders a `<button>`. */
  onClick?: () => void;
  as?: 'div' | 'section' | 'article';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** `.card.elev-sm` · padding 14px 16px · gap 8px, with an optional inline/stacked/iconic header. */
export function SectionCard({
  title,
  subtitle,
  hint,
  actions,
  icon: I,
  compactTitle,
  titleGap,
  gap,
  scroll,
  flex,
  variant = 'default',
  href,
  onClick,
  as: As = 'div',
  className,
  style,
  children,
}: SectionCardProps) {
  const vars = {
    ...(gap != null ? { '--sc-gap': `${gap}px` } : null),
    ...(flex ? { '--sc-flex': flex } : null),
    ...style,
  } as CSSProperties;
  const cls = cx(
    'card',
    'elev-sm',
    s.root,
    scroll && s.scroll,
    flex && s.flexItem,
    variant !== 'default' && s[variant],
    (href || onClick) && s.clickable,
    className,
  );

  let header: ReactNode = null;
  if (title != null || actions || hint) {
    const t = title != null ? (
      <CardTitle compact={compactTitle} push={!subtitle} className={titleGap ? s.titleGap : undefined} style={titleGap ? ({ '--sc-title-gap': `${titleGap}px` } as CSSProperties) : undefined}>
        {title}
      </CardTitle>
    ) : null;
    if (subtitle) {
      header = (
        <div className={I ? s.iconic : s.stacked}>
          {I && <I className={s.icon} aria-hidden />}
          <div className={s.titleCol}>
            {t}
            <span className={s.subtitle}>{subtitle}</span>
          </div>
          {hint && <span className={s.hint}>{hint}</span>}
          {actions}
        </div>
      );
    } else if (hint || actions || I) {
      header = (
        <div className={I ? s.iconic : s.inline}>
          {I && <I className={s.icon} aria-hidden />}
          {t}
          {hint && <span className={s.hint}>{hint}</span>}
          {actions}
        </div>
      );
    } else {
      header = t;
    }
  }

  if (href)
    return (
      <Link href={href} className={cls} style={vars}>
        {header}
        {children}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className={cls} style={vars} onClick={onClick}>
        {header}
        {children}
      </button>
    );
  return (
    <As className={cls} style={vars}>
      {header}
      {children}
    </As>
  );
}

/** Vertical page/section stack: `display:flex;flex-direction:column;gap:14px` (screen body; Overview uses 18). */
export function Stack({ gap = 14, className, style, children }: { gap?: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={cx(s.stack, className)} style={{ '--stack-gap': `${gap}px`, ...style } as CSSProperties}>
      {children}
    </div>
  );
}

/**
 * Responsive card columns: `repeat(auto-fit, minmax(min(100%, {min}px), 1fr))`, gap 14 —
 * min ∈ {220, 230, 260, 300, 340, 360, 380, 400, 420, 460, 540, 620}.
 */
export function CardGrid({
  min = 360,
  gap = 14,
  fill,
  align = 'start',
  className,
  style,
  children,
}: {
  min?: number;
  gap?: number | string;
  /** `auto-fill` instead of `auto-fit` (My projects cards). */
  fill?: boolean;
  align?: 'start' | 'stretch';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const vars = {
    '--grid-min': `${min}px`,
    '--grid-gap': typeof gap === 'number' ? `${gap}px` : gap,
    '--grid-fit': fill ? 'auto-fill' : 'auto-fit',
    '--grid-align': align,
    ...style,
  } as CSSProperties;
  return (
    <div className={cx(s.grid, className)} style={vars}>
      {children}
    </div>
  );
}

/** Wrapping flex row of cards: `display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start|stretch`; give children `flex` (see SectionCard). */
export function FlexRow({ gap = 14, align = 'flex-start', className, style, children }: { gap?: number; align?: 'flex-start' | 'stretch' | 'center'; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={cx(s.row, className)} style={{ '--row-gap': `${gap}px`, '--row-align': align, ...style } as CSSProperties}>
      {children}
    </div>
  );
}

/** Alias of `Stack` for screen bodies (`display:flex;flex-direction:column;gap:14px`). */
export const PageSection = Stack;
