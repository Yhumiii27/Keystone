'use client';
// "CAPEX link" editor of the Contract screen (R-190, Arche K-05): the subsidiary CAPEX the project delivers and the first machine
// need at its origin, as Arche numbers them. The Server Function checks the viewer's rights and the formats; empty clears.
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Field, Input } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { setCapexLinkAction } from './actions';
import s from './contract.module.css';

export interface CapexLinkFormProps {
  code: string;
  capexCode: string;
  needRef: string;
  labels: { capex: string; need: string; save: string; saved: string };
}

export function CapexLinkForm({ code, capexCode, needRef, labels }: CapexLinkFormProps) {
  const id = useId();
  const [capex, setCapex] = useState(capexCode);
  const [need, setNeed] = useState(needRef);
  const [pending, startTransition] = useTransition();
  const changed = capex.trim().toUpperCase() !== capexCode || need.trim().toUpperCase() !== needRef;
  return (
    <form
      className={s.rateForm}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const r = await setCapexLinkAction(code, capex, need);
            showToast('error' in r ? r.error : labels.saved);
          } catch (err) {
            showToast(err instanceof Error ? err.message : String(err));
          }
        });
      }}
    >
      <Field label={labels.capex} htmlFor={`${id}-capex`}>
        <Input id={`${id}-capex`} value={capex} placeholder="CPX-SAI-2026-01" maxLength={40} disabled={pending} onChange={(e) => setCapex(e.target.value)} />
      </Field>
      <Field label={labels.need} htmlFor={`${id}-need`}>
        <Input id={`${id}-need`} value={need} placeholder="CPX-SAI-2026-01/B01" maxLength={50} disabled={pending} onChange={(e) => setNeed(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" size="xs" disabled={pending || !changed} aria-busy={pending || undefined} nowrap>
        {labels.save}
      </Button>
    </form>
  );
}
