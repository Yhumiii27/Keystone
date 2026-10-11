'use client';
// "Currency & budget rate" editor of the Contract screen (C-9, R-075): the project currency and its budget rate (euros per
// unit) that Budget › Cash & recovery, Cash flow and portfolio finance use to consolidate the project in euros. The portfolio
// director edits it (the Server Function checks the role); EUR needs no rate.
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Field, Input, Select } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { setBudgetRateAction } from './actions';
import s from './contract.module.css';

export interface BudgetRateFormProps {
  code: string;
  currency: string;
  rate: string;
  options: { value: string; label: string }[];
  labels: { currency: string; rate: string; save: string; saved: string; eurNote: string };
}

export function BudgetRateForm({ code, currency, rate, options, labels }: BudgetRateFormProps) {
  const id = useId();
  const [cur, setCur] = useState(currency);
  const [value, setValue] = useState(rate);
  const [pending, startTransition] = useTransition();
  const eur = cur === 'EUR';
  const changed = cur !== currency || (!eur && value.trim() !== rate);
  return (
    <form
      className={s.rateForm}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const r = await setBudgetRateAction(code, cur, eur ? '' : value);
            showToast('error' in r ? r.error : labels.saved);
          } catch (err) {
            showToast(err instanceof Error ? err.message : String(err));
          }
        });
      }}
    >
      <Field label={labels.currency} htmlFor={`${id}-cur`}>
        <Select id={`${id}-cur`} value={cur} options={options} onChange={(e) => setCur(e.target.value)} disabled={pending} />
      </Field>
      <Field label={labels.rate} htmlFor={`${id}-rate`} hint={eur ? labels.eurNote : undefined}>
        <Input
          id={`${id}-rate`}
          className={s.numInput}
          inputMode="decimal"
          value={eur ? '1' : value}
          disabled={eur || pending}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="secondary" size="xs" disabled={pending || !changed || (!eur && !value.trim())} aria-busy={pending || undefined} nowrap>
        {labels.save}
      </Button>
    </form>
  );
}
