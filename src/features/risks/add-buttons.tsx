'use client';
// Header primary actions of the two screens (docs/spec/07 §1.1 / §3, 04 §0.1 / §5.5): `btn btn-primary` + plus icon
// opening the generic add-form dialog — "New risk" (AF `risks`) and "Draw-down" (AF `contingency`). Rendered only
// when the viewer can edit the project (the page and PageHeader gate it).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { createRiskAction, recordDrawDownAction } from './actions';

interface AddButtonProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" — the dialog sub-line. */
  context: string;
  /** English form definition (translated by FormDialog). */
  form: FormDef;
}

/** "New risk" → "Register risk": toast "R-21 · Risk registered". */
export function NewRiskButton({ code, context, form }: AddButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New risk')}
      </Button>
      <FormDialog {...form} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => createRiskAction(code, values)} />
    </>
  );
}

/** "Draw-down" → "Record draw-down": toast "Draw-down recorded". */
export function DrawDownButton({ code, context, form }: AddButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Draw-down')}
      </Button>
      <FormDialog {...form} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => recordDrawDownAction(code, values)} />
    </>
  );
}
