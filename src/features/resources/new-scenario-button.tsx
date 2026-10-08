'use client';
// Header primary action "New scenario" (docs/spec/05 §4.5): `btn btn-primary` + plus icon opening the AF `whatif`
// form dialog. Rendered only when the viewer can edit what-if levelling (the page and PageHeader gate it).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { createWhatIfScenario } from './actions';
import { NEW_SCENARIO_FORM } from './whatif-form';

export function NewScenarioButton({ code, context }: { code: string; /** Translated "#026 · Harbor Line…" */ context: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New scenario')}
      </Button>
      <FormDialog
        {...NEW_SCENARIO_FORM}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        onSubmit={(values) => createWhatIfScenario(code, values)}
      />
    </>
  );
}
