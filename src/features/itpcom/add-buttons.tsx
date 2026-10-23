'use client';
// Header primary actions (docs/spec/01 §5.9, 07 §1.1 / §3): `btn btn-primary` + plus icon opening the generic action-form
// dialog — "Add inspection" (AF `itp`, plan view), "Add punch item" (AF `punch`, punch view) and "Plan SAT" (AF
// `commissioning`, a run form). Rendered only when the viewer can edit the project (the page and PageHeader gate it).
// The form definitions and the label arrive translated from the server.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog, type FormDialogResult } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { addInspectionAction, addPunchItemAction, planSatAction } from './actions';

type Kind = 'inspection' | 'punch' | 'sat';

const submit = (kind: Kind, code: string, values: FormValues, equipment?: string): Promise<FormDialogResult> =>
  kind === 'inspection' ? addInspectionAction(code, values, equipment) : kind === 'punch' ? addPunchItemAction(code, values) : planSatAction(code, values);

export interface ItpFormButtonProps {
  kind: Kind;
  code: string;
  /** Translated button label ("Add inspection"). */
  label: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" — the dialog sub-line. */
  context: string;
  /** Translated form definition. */
  form: FormDef;
  /** R-185: the equipment line whose plan "Add inspection" adds to ("EQ-02"); absent = the main line. */
  equipment?: string;
}

export function ItpFormButton({ kind, code, label, context, form, equipment }: ItpFormButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => submit(kind, code, values, equipment)} />
    </>
  );
}
