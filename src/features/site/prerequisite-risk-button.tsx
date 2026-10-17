'use client';
// R-121 (owner's decision D-4 'a' ★): "Raise as a risk" on a pending client prerequisite, late at J-15 or not yet (owner, 17 Oct
// 2026, second round) — the existing "New
// risk" form (AF `risks`), pre-filled from the prerequisite, which the lead confirms or corrects. Opened directly when the page
// is reached from the J-15 notification (`?prereq=`), and scrolled into view. Rendered for the project's leads only (the Server
// Function and the writer re-check).
import { ShieldWarning } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useRef, useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { raisePrerequisiteRiskAction } from './prerequisite-risk-actions';

export interface RaiseRiskButtonProps {
  code: string;
  position: number;
  /** The line as the page shows it (refused when changed meanwhile). */
  stamp: string;
  /** The prerequisite as displayed (dialog sub-line, accessible name). */
  title: string;
  /** "New risk" form (English definition, translated by the dialog) and the values proposed. */
  form: FormDef;
  values: FormValues;
  /** Open on arrival (the notification's link). */
  autoOpen?: boolean;
}

export function RaiseRiskButton({ code, position, stamp, title, form, values, autoOpen = false }: RaiseRiskButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(autoOpen);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (autoOpen) ref.current?.scrollIntoView({ block: 'center' });
  }, [autoOpen]);
  return (
    <span ref={ref}>
      <Button variant="secondary" size="row" icon={ShieldWarning} aria-label={`${t('Raise as a risk')} — ${title}`} onClick={() => setOpen(true)}>
        {t('Raise as a risk')}
      </Button>
      <FormDialog
        {...form}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={title}
        initialValues={values}
        onSubmit={(v) => raisePrerequisiteRiskAction(code, position, stamp, v)}
      />
    </span>
  );
}
