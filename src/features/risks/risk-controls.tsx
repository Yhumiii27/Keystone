'use client';
// Editable parts of the risk drawer (docs/spec/07 §2.1 riskVals): Probability and Impact segments (1–5), the
// Response strategy segment and the "Close risk" / "Reopen" toggle. Each click calls updateRiskAction with
// an optimistic value; the server re-render then moves the row, the heat-map cell, the level tag and the KPIs.
// Read-only viewers (outside the workspace, read-only project) see the selected values only.
import { useOptimistic, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Segmented } from '@/components/ds/Segmented';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import type { RiskResponse, RiskStatus } from '@/domain/risk';
import { updateRiskAction } from './actions';
import s from './risks.module.css';

interface Values {
  probability: number;
  impact: number;
  response: RiskResponse;
  status: RiskStatus;
}

const SCALE = [1, 2, 3, 4, 5].map(String);
/** RESPONSES (3496) display order. */
const RESPONSES: { value: RiskResponse; label: string }[] = [
  { value: 'avoid', label: 'Avoid' },
  { value: 'mitigate', label: 'Mitigate' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'accept', label: 'Accept' },
];

function useRiskEdit(code: string, riskId: string, server: Values) {
  const [values, apply] = useOptimistic(server, (cur: Values, patch: Partial<Values>) => ({ ...cur, ...patch }));
  const [pending, start] = useTransition();
  const edit = (patch: Partial<Values>) =>
    start(async () => {
      apply(patch);
      const r = await updateRiskAction(code, riskId, patch);
      if ('error' in r) showToast(r.error);
    });
  return { values, pending, edit };
}

export interface RiskScalesProps {
  code: string;
  riskId: string;
  values: Values;
  canEdit: boolean;
}

/** Probability · Impact (two-column grid) and Response strategy. */
export function RiskScales({ code, riskId, values: server, canEdit }: RiskScalesProps) {
  const { t } = useI18n();
  const { values, pending, edit } = useRiskEdit(code, riskId, server);
  const scale = (cur: number) =>
    SCALE.map((v) => ({ value: v, label: v, disabled: !canEdit && Number(v) !== cur }));
  return (
    <>
      <div className={s.scales} aria-busy={pending || undefined}>
        <div className={s.field}>
          <span className={s.fieldLabel}>{t('Probability')}</span>
          <Segmented
            label={t('Probability')}
            className={!canEdit ? s.readOnly : undefined}
            options={scale(values.probability)}
            value={String(values.probability)}
            onChange={canEdit ? (v) => Number(v) !== values.probability && edit({ probability: Number(v) }) : undefined}
          />
        </div>
        <div className={s.field}>
          <span className={s.fieldLabel}>{t('Impact')}</span>
          <Segmented
            label={t('Impact')}
            className={!canEdit ? s.readOnly : undefined}
            options={scale(values.impact)}
            value={String(values.impact)}
            onChange={canEdit ? (v) => Number(v) !== values.impact && edit({ impact: Number(v) }) : undefined}
          />
        </div>
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('Response strategy')}</span>
        <Segmented
          wrap
          label={t('Response strategy')}
          className={!canEdit ? s.readOnly : undefined}
          options={RESPONSES.map((o) => ({ value: o.value, label: t(o.label), disabled: !canEdit && o.value !== values.response }))}
          value={values.response}
          onChange={canEdit ? (v) => v !== values.response && edit({ response: v }) : undefined}
        />
      </div>
    </>
  );
}

export interface RiskStatusToggleProps {
  code: string;
  riskId: string;
  /** Translated "Close risk" / "Reopen". */
  label: string;
  next: RiskStatus;
}

/** `btn btn-ghost` 12.5px: "Close risk" when open, "Reopen" when closed. */
export function RiskStatusToggle({ code, riskId, label, next }: RiskStatusToggleProps) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          const r = await updateRiskAction(code, riskId, { status: next });
          if ('error' in r) showToast(r.error);
        })
      }
    >
      {label}
    </Button>
  );
}
