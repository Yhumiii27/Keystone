'use client';
// Buttons opening the generic add-form dialog of the two screens (docs/spec/04 §3.5, §4.5; 01 §8):
// "Add amendment" (header primary + Amendments card), "Add guarantee", "Add payment milestone" (Contract) and
// "Issue invoice" (Billing header primary + one per "To invoice" row, which pre-selects its milestone like
// `afOpenWith('billing', {ms})`). The form definitions come translated from the page; the Server Function answers
// the toast or an error shown in the dialog.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ds/Button';
import { addAmendmentAction, addBondAction, addPaymentMilestoneAction, issueInvoiceAction } from './actions';

const ACTIONS = {
  amendment: addAmendmentAction,
  bond: addBondAction,
  milestone: addPaymentMilestoneAction,
  invoice: issueInvoiceAction,
} as const;

export interface FormButtonProps {
  kind: keyof typeof ACTIONS;
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" — the dialog sub-line. */
  context: string;
  /** Translated form definition. */
  form: FormDef;
  /** Translated button label. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon; default Plus (header primaries and card "Add …" buttons). `null` for none. */
  icon?: Icon | null;
  /** margin-left:auto in a card header. */
  push?: boolean;
  /** white-space:nowrap (card and row buttons; not the header primary). */
  nowrap?: boolean;
  /** Values merged over the defaults on opening (e.g. `{ ms: 'M5' }`). */
  initialValues?: FormValues;
  /** Accessible name when the label alone is ambiguous ("Issue invoice M5"). */
  ariaLabel?: string;
}

export function FormButton({ kind, code, context, form, label, variant = 'ghost', size, icon = Plus, push, nowrap, initialValues, ariaLabel }: FormButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} icon={icon ?? undefined} push={push} nowrap={nowrap} onClick={() => setOpen(true)} aria-label={ariaLabel}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} initialValues={initialValues} onSubmit={(values) => ACTIONS[kind](code, values)} />
    </>
  );
}
