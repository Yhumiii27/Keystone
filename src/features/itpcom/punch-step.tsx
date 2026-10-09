'use client';
// Row step of the punch list (docs/spec/07 §2.4, template 888): "Start" (Open → In progress) and "Close" (In progress →
// Closed), `btn btn-secondary` 12px. Rendered only for viewers who may edit the register; a refused or failed change
// shows its message as a toast. The button names its punch item for screen readers. It stays mounted while the row
// refreshes ("Start" becomes "Close" on the same, still focused, button); once the item is closed the button goes and
// keyboard focus moves to the next row's step instead of falling back to the page.
import { useEffect, useRef, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { advancePunchItemAction } from './actions';

export interface PunchStepProps {
  code: string;
  /** "P-02". */
  number: string;
  /** Translated "Start" / "Close"; null once the item is closed. */
  label: string | null;
  /** "Start · P-02". */
  ariaLabel: string | null;
  /** Status code the step starts from (sent so a stale row is refused rather than stepped twice). */
  from: string | null;
}

export function PunchStep({ code, number, label, ariaLabel, from }: PunchStepProps) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const anchor = useRef<HTMLSpanElement>(null);
  /** Set when the step ran from the focused button: focus follows once the row has no step left. */
  const keepFocus = useRef(false);

  useEffect(() => {
    if (pending || label || !keepFocus.current) return;
    keepFocus.current = false;
    const row = anchor.current?.closest('tr');
    const steps = [...(row?.closest('tbody')?.querySelectorAll<HTMLButtonElement>('button[data-punch-step]') ?? [])];
    const next = steps.find((b) => row && row.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ?? steps.at(-1);
    next?.focus();
  }, [label, pending]);

  const run = () => {
    if (pending || !from) return;
    const row = anchor.current?.closest('tr');
    keepFocus.current = !!row && !!document.activeElement && row.contains(document.activeElement);
    start(async () => {
      try {
        const r = await advancePunchItemAction(code, number, from);
        if ('error' in r) {
          keepFocus.current = false;
          showToast(r.error);
        }
      } catch {
        keepFocus.current = false;
        showToast(t('The change could not be saved'));
      }
    });
  };

  return (
    <>
      {label && (
        <Button variant="secondary" size="xs" data-punch-step="" aria-label={ariaLabel ?? undefined} aria-disabled={pending || undefined} onClick={run}>
          {label}
        </Button>
      )}
      <span ref={anchor} hidden />
    </>
  );
}
