// R-154 (WCAG 1.4.1): the mark next to a value shown in LO — a warning icon, plus text for screen readers when given — so
// an alert is never told by its colour alone. Server-compatible.
import { WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { cx } from '@/components/ds/cx';
import s from './AlertMark.module.css';

export function AlertMark({ label, className }: { /** Translated ("Alert"); read by screen readers only. */ label?: string; className?: string }) {
  return (
    <>
      <WarningCircle className={cx(s.icon, className)} weight="fill" aria-hidden />
      {label && <span className="sr-only">{` · ${label}`}</span>}
    </>
  );
}
