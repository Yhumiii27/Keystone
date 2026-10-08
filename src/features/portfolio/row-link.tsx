'use client';
// Table row that opens another screen (Overview "Active projects" row → project Plan). Unlike ClickableRow
// (drawer rows, scroll kept), this is a page navigation: scroll resets and the target is prefetched on hover.
import { useRouter } from 'next/navigation';
import type { KeyboardEvent, ReactNode } from 'react';
import s from './portfolio.module.css';

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const go = () => router.push(href);
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) go();
  };
  return (
    <tr tabIndex={0} className={s.row} onClick={go} onKeyDown={onKeyDown} onMouseEnter={() => router.prefetch(href)}>
      {children}
    </tr>
  );
}
