'use client';
// Table row that navigates on click / Enter (drawer opening through a search param, e.g. `?risk=R-07`).
// Clicks on inner links, buttons and form controls are ignored.
import { useRouter } from 'next/navigation';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from '@/components/ds/Table.module.css';

export interface ClickableRowProps {
  href: string;
  selected?: boolean;
  /** Use router.replace instead of push (default push, no scroll). */
  replace?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"]';

export function ClickableRow({ href, selected, replace, className, style, children }: ClickableRowProps) {
  const router = useRouter();
  const go = () => (replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }));
  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    go();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) go();
  };
  return (
    <tr tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} aria-selected={selected || undefined} className={cx(s.clickable, selected && s.selected, className)} style={style}>
      {children}
    </tr>
  );
}
