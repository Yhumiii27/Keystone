'use client';
// Client islands of the PLM screen and part drawer: the header primary "New part" (AF `plm`, generic add-form dialog)
// and the drawer's "Register equivalent" ghost button. Rendered only for viewers who may edit the catalogue; the form
// definitions arrive translated from the server (`localizePlmForm`).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { registerEquivalentAction, createPartAction } from './actions';
import s from './plm.module.css';

/** Header primary "New part" → "Create part" (toast "Part created in the catalogue"); `context` = the current project. */
export function NewPartButton({ label, form, context }: { label: string; form: FormDef; context?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => createPartAction(values)} />
    </>
  );
}

/** Part drawer "Register equivalent" (ghost, plus icon) → one select of the catalogue parts. */
export function RegisterEquivalentButton({ partRef, label, form, context }: { partRef: string; label: string; form: FormDef; context: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" icon={Plus} className={s.ghostBlock} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} zIndex={70} onSubmit={(values) => registerEquivalentAction(partRef, values)} />
    </>
  );
}
