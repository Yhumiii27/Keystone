'use client';
// Row actions of the Contract screen (R-079): an amendment's signature cycle — "Send for signature" on a draft (no dialog,
// toast), "Mark signed" on an amendment sent for signature (dialog: signature date, signed document) — and "Release" on a
// guarantee in force (dialog: release date). Shown to editors only; the Server Functions re-check everything.
import { PaperPlaneTilt, Seal, LockKeyOpen } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { releaseBondAction, sendAmendmentAction, signAmendmentAction } from './actions';

export function SendAmendmentButton({ code, position, label, ariaLabel }: { code: string; position: number; label: string; ariaLabel: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      size="mini"
      icon={PaperPlaneTilt}
      nowrap
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      title={label}
      onClick={() =>
        startTransition(async () => {
          try {
            const r = await sendAmendmentAction(code, position);
            showToast('error' in r ? r.error : r.toast);
          } catch (e) {
            showToast(e instanceof Error ? e.message : String(e));
          }
        })
      }
    >
      {label}
    </Button>
  );
}

interface DialogActionProps {
  code: string;
  position: number;
  context: string;
  form: FormDef;
  label: string;
  ariaLabel: string;
}

export function SignAmendmentButton({ code, position, context, form, label, ariaLabel }: DialogActionProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="mini" icon={Seal} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={label}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => signAmendmentAction(code, position, values)} />
    </>
  );
}

export function ReleaseBondButton({ code, position, context, form, label, ariaLabel }: DialogActionProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="mini" icon={LockKeyOpen} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={label}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => releaseBondAction(code, position, values)} />
    </>
  );
}
