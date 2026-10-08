'use client';
// Row actions of the Interface register (docs/spec/07 §2.5, template 898): "Mark received" (`btn-secondary`, Open or
// Late) and "Freeze" (`btn-primary`, Received), 12px. Rendered only for viewers who may edit the register; a refused
// or failed change shows its message as a toast. Each button names its interface for screen readers. "Mark received"
// replaces itself with "Freeze": keyboard focus moves to that button instead of falling back to the page.
import { useEffect, useId, useRef, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { freezeInterfaceAction, markInterfaceReceivedAction, type InterfaceActionResult } from './actions';

export interface InterfaceActionsProps {
  code: string;
  /** "IF-07". */
  number: string;
  canReceive: boolean;
  canFreeze: boolean;
}

export function InterfaceActions({ code, number, canReceive, canFreeze }: InterfaceActionsProps) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const freezeId = useId();
  /** Set while "Mark received" runs: the refreshed row's "Freeze" button takes the focus. */
  const focusFreeze = useRef(false);
  useEffect(() => {
    // Wait for both the refreshed row (canFreeze) and the end of the transition (a disabled button takes no focus).
    if (pending || !canFreeze || !focusFreeze.current) return;
    focusFreeze.current = false;
    document.getElementById(freezeId)?.focus();
  }, [canFreeze, freezeId, pending]);

  const run = (action: (code: string, number: string) => Promise<InterfaceActionResult>) =>
    start(async () => {
      focusFreeze.current = action === markInterfaceReceivedAction;
      try {
        const r = await action(code, number);
        if ('error' in r) {
          focusFreeze.current = false;
          showToast(r.error);
        }
      } catch {
        focusFreeze.current = false;
        showToast(t('The change could not be saved'));
      }
    });
  return (
    <>
      {canReceive && (
        <Button variant="secondary" size="xs" disabled={pending} aria-label={`${t('Mark received')} · ${number}`} onClick={() => run(markInterfaceReceivedAction)}>
          {t('Mark received')}
        </Button>
      )}
      {canFreeze && (
        <Button id={freezeId} variant="primary" size="xs" disabled={pending} aria-label={`${t('Freeze')} · ${number}`} onClick={() => run(freezeInterfaceAction)}>
          {t('Freeze')}
        </Button>
      )}
    </>
  );
}
