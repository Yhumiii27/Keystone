'use client';
// "Sync vault" — the Drawings header primary action (docs/spec/09 §5.8, AF `drawings`, kind run): `btn btn-primary` + plus icon (template 123)
// opening the generic action-form dialog (Source, Scope; submit "Synchronise" with the play icon). The
// Server Function records the PDM sync (simulated connector) and returns the translated toast. Rendered only when the
// screen is inside the viewer's workspace (PageHeader also hides it outside); the form arrives translated.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { syncVaultAction } from '../actions';

export function SyncVaultButton({ label, form, context }: { label: string; form: FormDef; context?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => syncVaultAction(values)} />
    </>
  );
}
