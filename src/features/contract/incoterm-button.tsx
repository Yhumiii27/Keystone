'use client';
// R-158 lot A: "Set Incoterm" / "Edit" of the contract's Incoterm card (the contract editors; the Server Function re-checks).
import { PencilSimple } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { setContractIncotermAction } from './actions';

export function IncotermButton({ code, context, form, label, values }: { code: string; context: string; form: FormDef; label: string; values: FormValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="mini" icon={PencilSimple} nowrap onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} initialValues={values} onSubmit={(v) => setContractIncotermAction(code, v)} />
    </>
  );
}
