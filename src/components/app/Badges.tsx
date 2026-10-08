// CountBadge (C-14), Avatar (C-15), StatusDot (C-16), IconTile (C-17). Server-compatible.
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import { initials as initialsOf } from '@/lib/format';
import s from './Badges.module.css';

export interface CountBadgeProps {
  /**
   * `nav` 11px · 1px 7px (sidebar items) · `section` 10.5px · 0 6px · `group` 10px · 0 6px (accent-800/accent-100 pills) ·
   * `bell` 16px accent circle positioned top/right −4px (parent must be position:relative) ·
   * `outline` 11px pill with a coloured border and a 7px dot (engineering matrix).
   */
  variant?: 'nav' | 'section' | 'group' | 'bell' | 'outline';
  /** outline: border / text / dot colours (CSS values). */
  borderColor?: string;
  color?: string;
  dotColor?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function CountBadge({ variant = 'nav', borderColor, color, dotColor, title, className, children }: CountBadgeProps) {
  if (variant === 'outline')
    return (
      <span
        className={cx(s.outline, className)}
        title={title}
        style={{ '--badge-border': borderColor, '--badge-color': color, '--badge-dot': dotColor } as CSSProperties}
      >
        <span className={s.outlineDot} />
        {children}
      </span>
    );
  return (
    <span className={cx(variant === 'bell' ? s.bell : cx(s.badge, s[variant]), className)} title={title}>
      {children}
    </span>
  );
}

const AV_FONT: Record<number, number> = { 30: 11, 28: 11, 26: 10, 24: 10, 22: 9.5, 20: 9 };

export interface AvatarProps {
  /** Initials to show; computed from `name` when omitted (first letter of each word). */
  initials?: string;
  name?: string;
  /** 20 · 22 · 24 · 26 · 28 · 30 px. */
  size?: 20 | 22 | 24 | 26 | 28 | 30;
  /** `neutral` neutral-800/neutral-200 · `accent` accent-800/accent-200 · `soft` accent-900/accent-200 + 500 (keyed bubbles). */
  tone?: 'neutral' | 'accent' | 'soft';
  /** Override the font size (e.g. 10.5 for 28px comment avatars, 9.5 for 24px plan owners). */
  fontSize?: number;
  title?: string;
  className?: string;
}

/** Round initials avatar (`border-radius:50%; display:grid; place-items:center; flex:none`). */
export function Avatar({ initials, name, size = 28, tone = 'neutral', fontSize, title, className }: AvatarProps) {
  const text = initials ?? (name ? initialsOf(name) : '');
  return (
    <span
      className={cx(s.avatar, tone === 'accent' ? s.avAccent : tone === 'soft' ? s.avSoft : s.avNeutral, className)}
      style={{ '--av-size': `${size}px`, '--av-font': `${fontSize ?? AV_FONT[size] ?? 10}px` } as CSSProperties}
      title={title ?? name}
      aria-label={title ?? name}
      role={title ?? name ? 'img' : undefined}
    >
      {text}
    </span>
  );
}

export interface StatusDotProps {
  /** 6 · 7 · 8 (default) · 10 px. */
  size?: number;
  /** Fill (CSS value). Default accent. */
  color?: string;
  /** Optional box-shadow ring/glow (e.g. STEP_GLOW, or 'inset 0 0 0 1px var(--color-neutral-700)' for hollow dots). */
  ring?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function StatusDot({ size = 8, color, ring, title, className, style }: StatusDotProps) {
  return (
    <span
      className={cx(s.dot, className)}
      title={title}
      aria-hidden={title ? undefined : true}
      style={{ '--dot-size': `${size}px`, '--dot-color': color, '--dot-ring': ring, ...style } as CSSProperties}
    />
  );
}

export interface IconTileProps {
  icon?: Icon;
  /**
   * `alert` 28×28 radius 7 accent-900/accent-300 (notifications, Needs attention) · `file` 30×30 radius 6
   * neutral-900/accent-300 · `brand` 26×26 radius 7 accent outline + glow · `mark` 34×34 text tile (Codex "Cx").
   */
  variant?: 'alert' | 'file' | 'brand' | 'mark';
  /** Glyph size in px (inherits the surrounding font size when omitted). */
  iconSize?: number;
  /** Text content instead of an icon (`mark`). */
  children?: ReactNode;
  className?: string;
}

export function IconTile({ icon: I, variant = 'alert', iconSize, children, className }: IconTileProps) {
  const v = { alert: s.tileAlert, file: s.tileFile, brand: s.tileBrand, mark: s.tileMark }[variant];
  return (
    <span className={cx(s.tile, v, className)} aria-hidden={children ? undefined : true}>
      {I ? <I size={iconSize ? iconSize : '1em'} /> : children}
    </span>
  );
}
