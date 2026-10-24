'use client';
// "Client" editor of the Contract screen (R-190, Arche K-05): the project's client is external or a group subsidiary (internal
// client), with the subsidiary's code as Arche and Matrix know it. The portfolio director edits it (the Server Function checks
// the role); the flag is on the client, so every project of that client follows.
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Field, Select } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { setInternalClientAction } from './actions';
import s from './contract.module.css';

export interface InternalClientFormProps {
  code: string;
  isInternal: boolean;
  subsidiaryCode: string;
  /** Known subsidiaries: value = code, label = "SAI · Sahel Agro Industries". */
  subsidiaries: { value: string; label: string }[];
  labels: { kind: string; external: string; internal: string; subsidiary: string; unknown: string; save: string; saved: string };
}

export function InternalClientForm({ code, isInternal, subsidiaryCode, subsidiaries, labels }: InternalClientFormProps) {
  const id = useId();
  const [internal, setInternal] = useState(isInternal);
  const [sub, setSub] = useState(subsidiaryCode);
  const [pending, startTransition] = useTransition();
  const changed = internal !== isInternal || (internal && sub !== subsidiaryCode);
  return (
    <form
      className={s.rateForm}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          try {
            const r = await setInternalClientAction(code, internal, internal ? sub : '');
            showToast('error' in r ? r.error : labels.saved);
          } catch (err) {
            showToast(err instanceof Error ? err.message : String(err));
          }
        });
      }}
    >
      <Field label={labels.kind} htmlFor={`${id}-kind`}>
        <Select
          id={`${id}-kind`}
          value={internal ? 'internal' : 'external'}
          options={[{ value: 'external', label: labels.external }, { value: 'internal', label: labels.internal }]}
          onChange={(e) => setInternal(e.target.value === 'internal')}
          disabled={pending}
        />
      </Field>
      <Field label={labels.subsidiary} htmlFor={`${id}-sub`}>
        <Select
          id={`${id}-sub`}
          value={internal ? sub : ''}
          options={[{ value: '', label: labels.unknown }, ...subsidiaries]}
          onChange={(e) => setSub(e.target.value)}
          disabled={pending || !internal}
        />
      </Field>
      <Button type="submit" variant="secondary" size="xs" disabled={pending || !changed} aria-busy={pending || undefined} nowrap>
        {labels.save}
      </Button>
    </form>
  );
}
