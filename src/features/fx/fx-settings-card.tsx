'use client';
// R-162 (P4, D9-34) — Settings › Reference exchange rates: dated rates (euros per unit, valid from a date; the rate of a day is
// the latest valid on it) and the two thresholds of the hedging alerts (net exposure in k€, rate drift against the budget rate
// in %). Finance and the portfolio director edit (`canEdit`); the other roles read.
import { CurrencyEur, Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { SectionCard } from '@/components/app/SectionCard';
import { Button } from '@/components/ds/Button';
import { Input } from '@/components/ds/Field';
import { Table, Th } from '@/components/ds/Table';
import { showToast } from '@/components/ds/Toast';
import { FX_THRESHOLD_KEYS, FX_THRESHOLD_LABEL, FX_THRESHOLDS_STANDARD, type FxThresholds } from '@/domain/fx-exposure';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { intlLocale } from '@/i18n/translate';
import { addReferenceRateAction, removeReferenceRateAction, setFxThresholdAction, type FxActionResult } from './actions';
import s from './fx.module.css';

export interface FxRateRowView {
  id: string;
  currency: string;
  rate: number;
  validFrom: string;
  by: string;
  /** The rate in force today for its currency. */
  current: boolean;
}

export function FxSettingsCard({ rates, thresholds, currencies, canEdit }: { rates: FxRateRowView[]; thresholds: FxThresholds; currencies: string[]; canEdit: boolean }) {
  const { t, lang } = useI18n();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const day = (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`));
  const num = (v: number) => (lang === 'fr' ? String(v).replace('.', ',') : String(v));
  const act = (fn: () => Promise<FxActionResult>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if ('error' in r) showToast(r.error);
      else if (ok) showToast(ok);
    });
  const form: FormDef = {
    title: t('Add a reference rate'),
    submit: t('Add'),
    fields: [
      { id: 'currency', label: t('Currency'), type: 'select', options: currencies },
      { id: 'rate', label: t('Euros per unit'), type: 'text', required: true, placeholder: '0.92' },
      { id: 'validFrom', label: t('Valid from'), type: 'date', defaultValue: '' },
    ],
  };
  return (
    <SectionCard icon={CurrencyEur} title={t('Reference exchange rates')} subtitle={t('Value the projects’ FX exposure against their budget rate · the rate of a day is the latest valid on it')}
      actions={canEdit ? <Button variant="secondary" size="sm" icon={Plus} onClick={() => setAdding(true)}>{t('Add a reference rate')}</Button> : undefined}>
      <div className={s.scroll}>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Currency')}</Th>
              <Th align="right">{t('Euros per unit')}</Th>
              <Th>{t('Valid from')}</Th>
              <Th>{t('Entered by')}</Th>
              {canEdit && <Th aria-label={t('Actions')} />}
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.currency} {r.current && <span className="tag tag-neutral">{t('In force')}</span>}
                </td>
                <td className={s.num}>{num(r.rate)}</td>
                <td className={s.nowrap}>{day(r.validFrom)}</td>
                <td>{dataText(r.by, lang)}</td>
                {canEdit && (
                  <td className={s.actions}>
                    <Button variant="ghost" size="mini" icon={X} disabled={pending} aria-label={`${t('Remove')} · ${r.currency} · ${day(r.validFrom)}`} onClick={() => act(() => removeReferenceRateAction(r.id), t('Reference rate removed'))}>
                      {t('Remove')}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {!rates.length && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className={s.muted}>
                  {t('No reference rate yet')}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
      <div className={s.thresholds}>
        <span className={s.sub}>{t('Hedging alerts')}</span>
        {FX_THRESHOLD_KEYS.map((k) => (
          <label key={k} className={s.threshold}>
            <span>{t(FX_THRESHOLD_LABEL[k])}</span>
            <Input
              key={`${k}:${thresholds[k]}`}
              defaultValue={num(thresholds[k])}
              disabled={!canEdit || pending}
              inputMode="decimal"
              aria-label={t(FX_THRESHOLD_LABEL[k])}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (canEdit && v !== num(thresholds[k])) act(() => setFxThresholdAction(k, v), t('Threshold saved'));
              }}
            />
            <span className={s.muted}>
              {t('Default')} · {num(FX_THRESHOLDS_STANDARD[k])}
            </span>
          </label>
        ))}
      </div>
      {adding && <FormDialog open {...form} successToast={t('Reference rate added')} onClose={() => setAdding(false)} onSubmit={async (v) => { const r = await addReferenceRateAction(v); return 'error' in r ? { error: r.error } : undefined; }} />}
    </SectionCard>
  );
}
