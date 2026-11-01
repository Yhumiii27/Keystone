'use client';
// R-205: the edit controls of the « Analyse de risques » section, rendered for the project's leads only (the page gates them,
// the Server Functions re-check): "Run analysis" (iterations), the three-point estimates of an activity, the delay of a risk.
import { PencilSimple, Play } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { runRiskAnalysisAction, saveActivityRangeAction, saveRiskDelayAction } from './actions';

const RUN_FORM = (choices: readonly number[], fallback: number): FormDef => ({
  title: 'Run the risk analysis',
  submit: 'Run analysis',
  kind: 'run',
  fields: [{ id: 'iterations', label: 'Iterations', type: 'select', defaultValue: String(fallback), options: choices.map((n) => ({ value: String(n), label: String(n) })) }],
});

export function RunAnalysisButton({ code, context, choices, fallback, rerun }: { code: string; context: string; choices: readonly number[]; fallback: number; rerun: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={rerun ? 'secondary' : 'primary'} size="sm" icon={Play} onClick={() => setOpen(true)}>
        {t(rerun ? 'Run again' : 'Run analysis')}
      </Button>
      <FormDialog {...RUN_FORM(choices, fallback)} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={(v) => runRiskAnalysisAction(code, v)} />
    </>
  );
}

const RANGE_FORM: FormDef = {
  title: 'Three-point estimate',
  submit: 'Save',
  fields: [
    { id: 'dMin', label: 'Duration · minimum (working days)', type: 'number' },
    { id: 'dLikely', label: 'Duration · most likely', type: 'number' },
    { id: 'dMax', label: 'Duration · maximum', type: 'number' },
    { id: 'cMin', label: 'Cost at completion · minimum (k€)', type: 'number' },
    { id: 'cLikely', label: 'Cost at completion · most likely', type: 'number' },
    { id: 'cMax', label: 'Cost at completion · maximum', type: 'number' },
  ],
};

/** Edit the three-point estimates of an activity: prefilled with the entered values, else the default range. */
export function EditRangeButton({ code, activityId, context, initial }: { code: string; activityId: string; context: string; initial: FormValues }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="xs" icon={PencilSimple} onClick={() => setOpen(true)} aria-label={`${t('Edit')} · ${context}`}>
        {t('Edit')}
      </Button>
      <FormDialog
        {...RANGE_FORM}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        initialValues={initial}
        onSubmit={(v) => saveActivityRangeAction(code, activityId, v)}
      />
    </>
  );
}

const DELAY_FORM: FormDef = {
  title: 'Delay if the risk occurs',
  submit: 'Save',
  fields: [{ id: 'delay', label: 'Delay (working days) · empty = impact × 5', type: 'number', span: 'full' }],
};

export function EditDelayButton({ code, riskId, context, initial }: { code: string; riskId: string; context: string; initial: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="xs" icon={PencilSimple} onClick={() => setOpen(true)} aria-label={`${t('Edit')} · ${context}`}>
        {t('Edit')}
      </Button>
      <FormDialog
        {...DELAY_FORM}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        initialValues={{ delay: initial }}
        onSubmit={(v) => saveRiskDelayAction(code, riskId, v)}
      />
    </>
  );
}
