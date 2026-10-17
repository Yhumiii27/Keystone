'use client';
// Row actions of the Interface register (docs/spec/07 §2.5, template 898): "Mark received" (`btn-secondary`, Open or
// Late) and "Freeze" (`btn-primary`, Received), 12px. Rendered only for viewers who may edit the register; a refused
// or failed change shows its message as a toast. Each button names its interface for screen readers. Q-4 a (R-116):
// "Mark received" opens a one-field dialog "Received on" — today by default, editable when the data arrived earlier,
// never after today (checked again by the server). Once received, the row's "Freeze" button takes the keyboard focus
// instead of letting it fall back to the page.
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { freezeInterfaceAction, markInterfaceReceivedAction } from './actions';

export interface InterfaceActionsProps {
  code: string;
  /** "IF-07". */
  number: string;
  canReceive: boolean;
  canFreeze: boolean;
  /** Default of "Received on": the business date in the viewer's language ("25 Sep 2026" / "25 sept. 2026" on the demo data set). */
  receivedDefault: string;
}

/** The "Mark received" dialog (translated): one required text date field, like "Needed by". */
const receivedForm = (t: (s: string) => string, receivedDefault: string): FormDef => ({
  title: t('Mark received'),
  kind: 'create',
  submit: t('Mark received'),
  fields: [{ id: 'received', label: t('Received on'), type: 'text', required: true, defaultValue: receivedDefault }],
});

export function InterfaceActions({ code, number, canReceive, canFreeze, receivedDefault }: InterfaceActionsProps) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const freezeId = useId();
  /** Set once "Mark received" succeeded: the refreshed row's "Freeze" button takes the focus. */
  const focusFreeze = useRef(false);
  useEffect(() => {
    // Wait for both the refreshed row (canFreeze) and the end of the transition (a disabled button takes no focus).
    if (pending || !canFreeze || !focusFreeze.current) return;
    focusFreeze.current = false;
    document.getElementById(freezeId)?.focus();
  }, [canFreeze, freezeId, pending]);

  const freeze = () =>
    start(async () => {
      try {
        const r = await freezeInterfaceAction(code, number);
        if ('error' in r) showToast(r.error);
      } catch {
        showToast(t('The change could not be saved'));
      }
    });

  const receive = async (values: Record<string, string>) => {
    const r = await markInterfaceReceivedAction(code, number, values);
    if ('error' in r) return { error: r.error };
    focusFreeze.current = true;
  };

  return (
    <>
      {canReceive && (
        <Button variant="secondary" size="xs" disabled={pending} aria-label={`${t('Mark received')} · ${number}`} onClick={() => setOpen(true)}>
          {t('Mark received')}
        </Button>
      )}
      {canFreeze && (
        <Button id={freezeId} variant="primary" size="xs" disabled={pending} aria-label={`${t('Freeze')} · ${number}`} onClick={freeze}>
          {t('Freeze')}
        </Button>
      )}
      {canReceive && open && <FormDialog {...receivedForm(t, receivedDefault)} open onClose={() => setOpen(false)} context={number} onSubmit={receive} />}
    </>
  );
}
