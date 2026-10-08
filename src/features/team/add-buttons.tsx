'use client';
// Header primary actions of the two screens (docs/spec/01 §5.9, 05 §6.5, 07 §1.1 / §3): `btn btn-primary` + plus icon
// opening the generic add-form dialog — "Add stakeholder" (AF `stakeholders`) and "New interface" (AF `interfaces`).
// Rendered only when the viewer can edit the project (the page and PageHeader gate it). The form definitions arrive
// translated from the server (`localizeForm`).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { addStakeholderAction, createInterfaceAction } from './actions';

interface AddButtonProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" — the dialog sub-line. */
  context: string;
  /** Translated form definition. */
  form: FormDef;
}

/** "Add stakeholder" → "Add": toast "Stakeholder added". */
export function AddStakeholderButton({ code, context, form }: AddButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Add stakeholder')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => addStakeholderAction(code, values)} />
    </>
  );
}

/** "New interface" → "Register": toast "Interface registered". */
export function NewInterfaceButton({ code, context, form }: AddButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New interface')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => createInterfaceAction(code, values)} />
    </>
  );
}
