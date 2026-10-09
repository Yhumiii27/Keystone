'use client';
// Header primary actions of the two screens (docs/spec/01 §5.9, 07 §1.1 / §3): `btn btn-primary` + plus icon opening the
// generic add-form dialog — "Add machine" (AF `fleet`) and "New claim" (AF `sav`). Rendered only for viewers whose
// workspace includes the screen (the page and PageHeader gate it; the Server Functions refuse the others). The form
// definitions arrive translated from the server (`localizeForm`).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { addMachineAction, openClaimAction } from './actions';

interface AddButtonProps {
  /** Translated button label. */
  label: string;
  /** Translated dialog sub-line context (the current project, as every add-form of the prototype), when known. */
  context?: string;
  /** Translated form definition. */
  form: FormDef;
}

/** "Add machine" → "Add machine": toast "Machine added to the installed base". */
export function AddMachineButton({ label, context, form }: AddButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => addMachineAction(values)} />
    </>
  );
}

/** "New claim" → "Open claim": toast "Warranty claim opened". */
export function NewClaimButton({ label, context, form }: AddButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => openClaimAction(values)} />
    </>
  );
}
