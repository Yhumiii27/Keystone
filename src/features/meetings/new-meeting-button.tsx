'use client';
// Header primary "New meeting" (docs/spec/05 §5.5, primary map 5137: `btn btn-primary` + plus icon) opening the
// generic add-form dialog with AF `meetings` → "Create & invite". Rendered only when the viewer can edit the
// project's meetings (the page and PageHeader gate it). The form definition arrives translated.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { createMeetingAction } from './actions';

export function NewMeetingButton({ code, context, form }: { code: string; context: string; form: FormDef }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New meeting')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => createMeetingAction(code, values)} />
    </>
  );
}
