'use client';
// "Currency" of a Draft purchase order in the Orders drawer (C-9, R-075): EUR or the project currency; switching converts the
// line prices at the project's budget rate (the Server Function re-checks the rights and the draft status). Errors are toasted.
import { useId, useTransition } from 'react';
import { Field, Select } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { setOrderCurrencyAction } from './currency-actions';

export function OrderCurrencySelect({ code, number, value, options }: { code: string; number: string; value: string; options: string[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const id = useId();
  const [pending, start] = useTransition();
  return (
    <Field label={t('Order currency')} htmlFor={id} hint={t('Line prices are converted at the project’s budget rate')}>
      <Select
        id={id}
        value={value}
        options={options}
        disabled={pending}
        aria-busy={pending || undefined}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            try {
              const r = await setOrderCurrencyAction(code, number, next);
              if (!r.ok) toast.showEn(r.error);
            } catch {
              toast.showEn('The change could not be saved');
            }
          });
        }}
      />
    </Field>
  );
}
