// Callout / Notice / InsetPanel (docs/spec/02 C-24). Server-compatible.
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import { Eyebrow } from './Eyebrow';
import s from './Callout.module.css';

export interface CalloutProps {
  /**
   * - `info` flex · center · gap 8 · 12.5px neutral-300 · padding 10px 12px · neutral-900 (zone empty, read-only…)
   * - `outlined` info + padding 9px 12px + inset 1px neutral-800 ring (outside banner, fallback notice)
   * - `emphasis` align start · line-height 1.45 · neutral-200 · accent-900 ground (critical-path warning, locks)
   * - `compact` 12px · padding 8px 10px (ECO/stock notes)
   * - `note` paragraph note 12.5px · line-height 1.5 · neutral-300 (Budget TCPI note)
   */
  variant?: 'info' | 'outlined' | 'emphasis' | 'compact' | 'note';
  /** Ground: `neutral` (neutral-900) or `accent` (accent-900). Default: accent for `emphasis`, neutral otherwise. */
  tone?: 'neutral' | 'accent';
  /** 1px accent-800 border (emphasis-bordered, 2526). */
  bordered?: boolean;
  /** Align items to the top (multi-line compact notes). */
  alignStart?: boolean;
  /** Leading accent icon (Info, Warning, LockSimple, SealCheck, GlobeHemisphereEast…). */
  icon?: Icon;
  /** Icon size in px (16 for outlined notices; inherits otherwise). */
  iconSize?: number;
  /** Trailing action (e.g. a ghost button); the text then takes `margin-right:auto`. */
  action?: ReactNode;
  role?: 'status' | 'alert' | 'note';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Callout({ variant = 'info', tone, bordered, alignStart, icon: I, iconSize, action, role, className, style, children }: CalloutProps) {
  const t = tone ?? (variant === 'emphasis' ? 'accent' : 'neutral');
  const top = variant === 'emphasis' || alignStart;
  if (variant === 'note')
    return (
      <p className={cx(s.callout, s.note, t === 'accent' && s.accent, className)} style={style} role={role}>
        {children}
      </p>
    );
  return (
    <div
      role={role}
      style={style}
      className={cx(
        s.callout,
        t === 'accent' && s.accent,
        variant === 'outlined' && s.outlined,
        variant === 'emphasis' && s.emphasis,
        variant === 'compact' && s.compact,
        bordered && s.bordered,
        alignStart && s.start,
        className,
      )}
    >
      {I && <I className={cx(s.icon, top && s.iconTop)} size={iconSize ?? '1em'} aria-hidden />}
      <span className={cx(s.text, action != null && s.grow)}>{children}</span>
      {action}
    </div>
  );
}

export interface InsetPanelProps {
  /** Optional muted eyebrow ("Will be created", "Prepare"). */
  title?: ReactNode;
  /** Gap in px (4–8; default 6). */
  gap?: number;
  /** `lg` = padding 12px (wizard panels); default 10px 12px. */
  padding?: 'md' | 'lg';
  /** `bordered`: transparent with 1px neutral-800 border (transcript, add-note) instead of the neutral-900 ground. */
  bordered?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Inset panel: flex column on neutral-900, radius 8. */
export function InsetPanel({ title, gap, padding = 'md', bordered, className, style, children }: InsetPanelProps) {
  return (
    <div className={cx(s.panel, padding === 'lg' && s.panelLg, bordered && s.panelBordered, className)} style={gap != null ? ({ '--ip-gap': `${gap}px`, ...style } as CSSProperties) : style}>
      {title != null && <Eyebrow variant="muted">{title}</Eyebrow>}
      {children}
    </div>
  );
}
