'use client';
// One inbox row (template 1724): opens the item's own page on click / Enter (`a.open`), like ClickableRow does for
// table rows; clicks on the inline decision buttons do not navigate (the prototype's stopPropagation).
import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './myapprovals.module.css';

const INTERACTIVE = 'a, button, input, select, textarea, label';

export function ApprovalRow({ href, children }: { href: string | null; children: ReactNode }) {
  const router = useRouter();
  if (!href) return <div className={s.row}>{children}</div>;
  const go = () => router.push(href);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    go();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) go();
  };
  return (
    <div className={cx(s.row, s.open)} tabIndex={0} data-href={href} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
