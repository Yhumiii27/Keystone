'use client';
// Header primary action "Re-baseline" (docs/spec/05 §1.5): `btn btn-primary` + plus icon opening the AF
// `schedule` form dialog. Rendered only when the viewer can edit the project (the page and PageHeader gate it).
import { FlagBanner, Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import { Button, ButtonLink } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { rebaselineSchedule } from './actions';
import type { EstimateClass } from '@/domain/estimate-class';
import { rebaselineForm } from './rebaseline';

export function RebaselineButton({
  code, context, defaultClass, changeRequestHref,
}: {
  code: string;
  /** Translated "#026 · Harbor Line…" */ context: string;
  /** R-188: preset estimate class. */ defaultClass: EstimateClass;
  /** D9-12: after BL1 the button opens this Change control form (a new request proposing the next baseline). */
  changeRequestHref?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (changeRequestHref)
    return (
      <ButtonLink variant="primary" icon={FlagBanner} href={changeRequestHref} title={t('After BL1, a new baseline goes through a change request')}>
        {t('Re-baseline')}
      </ButtonLink>
    );
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Re-baseline')}
      </Button>
      <FormDialog
        {...rebaselineForm(defaultClass)}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        onSubmit={(values) => rebaselineSchedule(code, values)}
      />
    </>
  );
}
