'use client';
// Header primary action of Portfolio — prioritisation & capacity (docs/spec/01 §5.9, 03 §6.6): "Score a proposal"
// opens the AF `portfolio` dialog. PageHeader hides it outside the workspace; the Server Function checks it again.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { scoreProposalAction } from './actions';
import { scoreProposalForm } from './forms';

/** `options` = pipeline projects (code, EN label "#044 · Westfield Solar Array"); labels are translated by the dialog. */
export function ScoreProposalButton({ options }: { options: { value: string; label: string }[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Score a proposal')}
      </Button>
      <FormDialog {...scoreProposalForm(options)} translate open={open} onClose={() => setOpen(false)} onSubmit={scoreProposalAction} />
    </>
  );
}
