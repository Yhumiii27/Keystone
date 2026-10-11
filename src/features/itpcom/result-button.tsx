'use client';
// "Record result" on a plan line (R-112, Q-6a): `btn btn-secondary` 12px opening the generic form dialog — result, date,
// inspector, client representative (hold / witness points) and comment. Shown to quality, the engineering lead and the
// director on a project they may edit (the Server Function re-checks); the form arrives translated from the server.
import { ClipboardText } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { recordInspectionResultAction } from './actions';

export interface RecordResultButtonProps {
  code: string;
  /** "I-03". */
  number: string;
  /** Result code the viewer saw (stale lines are refused server-side). */
  from: string;
  /** Translated "Record result" and its accessible name ("Record result · I-03"). */
  label: string;
  ariaLabel: string;
  /** Dialog sub-line: "I-03 · Paint thickness (DFT)". */
  context: string;
  form: FormDef;
}

export function RecordResultButton({ code, number, from, label, ariaLabel, context, form }: RecordResultButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="xs" icon={ClipboardText} nowrap aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => recordInspectionResultAction(code, number, from, values)} />
    </>
  );
}
