'use client';
// Header primary "New RFQ" (docs/spec/01 §5.9, 08 §1.4.5): `btn btn-primary` + plus icon opening the generic add-form
// (AF.procurement). Rendered only when the screen is in the viewer's workspace (the page and PageHeader gate it). The
// form arrives translated from the server; "Send RFQ" records the RFQ and toasts "RFQ sent to suppliers · RFQ-…".
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { createRfqAction } from './actions';

export function NewRfqButton({ form, context }: { form: FormDef; context?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New RFQ')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => createRfqAction(values)} />
    </>
  );
}
