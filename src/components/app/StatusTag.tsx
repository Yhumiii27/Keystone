// Status tag (docs/spec/02 C-07): a DS tag whose tone comes from the DS-TONES mappings in ./tones.
// Server-compatible.
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Tag, type TagSize } from '@/components/ds/Tag';
import { cx } from '@/components/ds/cx';
import { healthTone, lifecycleTone, statusTone, type HealthCode, type StatusKind, type Tone } from './tones';
import s from './StatusTag.module.css';

export interface StatusTagProps {
  /** `accent` alert · `outline` watch · `neutral` calm · `muted` = `text-muted` "—" (no tag). */
  tone: Tone;
  /** `md` 11px (DS) · `sm` 10.5px · `xs` 10px + 1px 7px · `micro` 10px. */
  size?: TagSize;
  icon?: Icon;
  title?: string;
  className?: string;
  /** Translated label. For `muted`, defaults to "—". */
  children?: ReactNode;
}

export function StatusTag({ tone, size = 'md', icon, title, className, children }: StatusTagProps) {
  if (tone === 'muted')
    return (
      <span className={cx('text-muted', s.muted, className)} title={title}>
        {children ?? '—'}
      </span>
    );
  return (
    <Tag tone={tone} size={size} icon={icon} title={title} className={className}>
      {children}
    </Tag>
  );
}

/** Health tag: Off track accent · At risk outline · On track neutral · none → muted "—". Pass the translated label. */
export function HealthTag({ health, label, size, className }: { health: HealthCode | null | undefined; label?: ReactNode; size?: TagSize; className?: string }) {
  return (
    <StatusTag tone={healthTone(health)} size={size} className={className}>
      {health ? label : '—'}
    </StatusTag>
  );
}

/** Lifecycle status tag (statusTag 3917). `status` = stage code or French domain label; `label` defaults to it. */
export function LifecycleTag({ status, label, size, className }: { status: string; label?: ReactNode; size?: TagSize; className?: string }) {
  return (
    <StatusTag tone={lifecycleTone(status)} size={size} className={className}>
      {label ?? status}
    </StatusTag>
  );
}

/** Tag for an object status code (`kind` from STATUS_TONES, e.g. 'po', 'ncr', 'eco'). */
export function ObjectStatusTag({ kind, code, label, size, className }: { kind: StatusKind; code: string | null | undefined; label: ReactNode; size?: TagSize; className?: string }) {
  return (
    <StatusTag tone={statusTone(kind, code)} size={size} className={className}>
      {label}
    </StatusTag>
  );
}

/**
 * Class string for a tag rendered as a `<button>` (status "Move to" menu trigger): pass it as
 * `<Popover triggerClassName={statusTagButtonClass(tone)} trigger={<>{label}<CaretDown/></>}>`.
 */
export function statusTagButtonClass(tone: Exclude<Tone, 'muted'>): string {
  return cx('tag', `tag-${tone}`, s.button);
}
