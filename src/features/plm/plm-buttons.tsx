'use client';
// Client islands of the PLM screen and part drawer: the header primary "New part" (AF `plm`, generic add-form dialog),
// the drawer's "Register equivalent" ghost button and, R-102, "Complete the record" / "Validate part". Rendered only for viewers who may edit the catalogue; the form
// definitions arrive translated from the server (`localizePlmForm`).
import { CheckCircle, PencilSimple, Plus } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { completePartRecordAction, registerEquivalentAction, createPartAction, validatePartAction } from './actions';
import s from './plm.module.css';

/** Header primary "New part" → "Create part" (toast "Part created in the catalogue"); no project sub-line (R-153, X-10). */
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

/** R-102: part drawer "Complete the record" (HS code, export restriction, lead time, manufacturer ref.), prefilled. */
export function CompleteRecordButton({ partRef, label, form, context }: { partRef: string; label: string; form: FormDef; context: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" icon={PencilSimple} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} zIndex={70} onSubmit={(values) => completePartRecordAction(partRef, values)} />
    </>
  );
}

/** R-102: part drawer "Validate part" (engineering lead, director): disabled while the record is incomplete (`title` says why). */
export function ValidatePartButton({ partRef, label, disabled, title }: { partRef: string; label: string; disabled: boolean; title?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size="sm"
      icon={CheckCircle}
      disabled={disabled || pending}
      title={title}
      aria-label={`${label} · ${partRef}`}
      onClick={() =>
        start(async () => {
          try {
            const r = await validatePartAction(partRef);
            toast.show(r.error ?? r.toast ?? '');
          } catch {
            toast.show(t('The change could not be saved'));
          }
        })
      }
    >
      {label}
    </Button>
  );
}
