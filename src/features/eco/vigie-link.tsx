// Links to Vigie, the QHSE application that owns the ECOs: "Open in Vigie" (rows, drawer, My approvals), "Manage in
// Vigie" (every prototype control Vigie now owns: interchangeability, dispositions, effectivity, release, editing) and
// the header's "New ECO". They open outside Keystone (target=_blank; the Mac app hands such links to the browser), so
// each one ends with the "opens outside" arrow. URLs come from src/server/integrations/vigie/links.ts.
// Server-compatible (plain anchors, no hooks).
import { ArrowSquareOut, Plus } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import { VIGIE_LINK_ATTRS } from '@/server/integrations/vigie/links';
import s from './eco.module.css';

export interface VigieLinkProps {
  href: string;
  /** Visible label (translated). */
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  /** `md` header primary · `sm` drawer (12.5px) · `row` row action (12px, 3px 10px) · `compact` ghost (12px, 3px 8px). */
  size?: 'md' | 'sm' | 'row' | 'compact';
  /** Leading plus icon (New ECO). */
  plus?: boolean;
  /** Accessible name when the visible label is not enough ("Open in Vigie ECO-2026-015"). */
  label?: string;
  className?: string;
}

/** `.btn` anchor opening Vigie in a new window. */
export function VigieLink({ href, children, variant = 'secondary', size = 'sm', plus, label, className }: VigieLinkProps) {
  return (
    <a href={href} {...VIGIE_LINK_ATTRS} aria-label={label} className={cx('btn', `btn-${variant}`, s.link, size !== 'md' && s[size], className)}>
      {plus && <Plus aria-hidden />}
      {children}
      <ArrowSquareOut aria-hidden />
    </a>
  );
}

/** Icon-only "Open in Vigie" of a register row (26 px ghost). */
export function VigieIconLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} {...VIGIE_LINK_ATTRS} aria-label={label} title={label} className={cx('btn', 'btn-icon', 'btn-ghost', s.iconLink)}>
      <ArrowSquareOut aria-hidden />
    </a>
  );
}
