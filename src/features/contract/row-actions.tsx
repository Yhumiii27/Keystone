'use client';
// Row actions of the Contract screen (R-079): an amendment's signature cycle — "Send for signature" on a draft (no dialog,
// toast), "Mark signed" on an amendment sent for signature (dialog: signature date, signed document) — and "Release" on a
// guarantee in force (dialog: release date). Delivery 8 (R-077): "Edit" and "Remove" of a planned payment milestone. Shown to
// editors only; the Server Functions re-check everything.
import { LockKeyOpen, PaperPlaneTilt, PencilSimple, Seal, Trash } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { showToast } from '@/components/ds/Toast';
import { releaseBondAction, removePaymentMilestoneAction, sendAmendmentAction, signAmendmentAction, updatePaymentMilestoneAction } from './actions';
import s from './contract.module.css';

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

/** Delivery 8 (R-077, C-7a): "Edit" of a planned payment milestone — the milestone form without "Applies to", opened with its values. */
export function EditMilestoneButton({ code, number, context, form, values, label, ariaLabel }: Omit<DialogActionProps, 'position'> & { number: string; values: FormValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="mini" icon={PencilSimple} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={label}>
        {label}
      </Button>
      <FormDialog
        {...form} open={open} onClose={() => setOpen(false)} context={context} initialValues={values}
        onSubmit={(v) => updatePaymentMilestoneAction(code, number, v)}
      />
    </>
  );
}

/**
 * Delivery 8 (R-077): "Remove" of a planned payment milestone after a confirmation (S-5); the number is never reused. The toast
 * says what happened, or why it was refused.
 */
export function RemoveMilestoneButton(
  { code, number, label, ariaLabel, title, text, cancel }: { code: string; number: string; label: string; ariaLabel: string; title: string; text: string; cancel: string },
) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      try {
        const r = await removePaymentMilestoneAction(code, number);
        showToast('error' in r ? r.error : r.toast);
        if (!('error' in r)) setOpen(false);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <>
      <Button variant="ghost" size="mini" icon={Trash} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={label}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} width={440}>
        <p className={s.confirmText}>{text}</p>
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {cancel}
          </Button>
          <Button variant="primary" disabled={pending} aria-busy={pending || undefined} onClick={confirm}>
            {label}
          </Button>
        </DialogActions>
      </Dialog>
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
