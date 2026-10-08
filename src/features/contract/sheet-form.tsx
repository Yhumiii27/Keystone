'use client';
// "Contract sheet" form (docs/spec/04 §3.4, template 820–829, `CTR_FIELDS` 4873): 12 fields in a
// repeat(auto-fit, minmax(min(100%, 230px), 1fr)) grid. The prototype wrote every keystroke into the session state;
// here a field is saved when it loses focus, on Enter (inputs) or on change (contract type), only when its value
// differs from the one shown. Escape restores it. Disabled for viewers who may not edit (read-only project and —
// unlike the prototype, 04 Q7 — outside the workspace).
import { useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { Field, Input, Select, Textarea } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { updateContractFieldAction, type ContractEditResult } from './actions';
import type { SheetFieldView } from './model';
import s from './contract.module.css';

export interface ContractSheetFormProps {
  code: string;
  fields: SheetFieldView[];
  canEdit: boolean;
}

export function ContractSheetForm({ code, fields, canEdit }: ContractSheetFormProps) {
  return (
    <div className={s.sheetGrid}>
      {fields.map((f) => (
        <SheetField key={f.key} code={code} field={f} canEdit={canEdit} />
      ))}
    </div>
  );
}

function SheetField({ code, field: f, canEdit }: { code: string; field: SheetFieldView; canEdit: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  // A new server value (after a save, or another viewer's edit) replaces the draft; focus stays in the field.
  const [shown, setShown] = useState(f.value);
  if (shown !== f.value) {
    setShown(f.value);
    setDraft(null);
  }
  const inflight = useRef(false);
  const [pending, startTransition] = useTransition();
  const value = draft ?? f.value;

  const save = (raw: string | null = draft) => {
    if (raw === null || inflight.current) return;
    if (raw === f.value) {
      setDraft(null);
      return;
    }
    inflight.current = true;
    startTransition(async () => {
      let r: ContractEditResult;
      try {
        r = await updateContractFieldAction(code, f.key, raw);
      } catch (e) {
        r = { error: e instanceof Error ? e.message : String(e) };
      }
      inflight.current = false;
      if ('error' in r) showToast(r.error);
      // Success: the refreshed server value (same transition) is shown; failure: the previous value comes back.
      setDraft(null);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') setDraft(null);
  };
  const common = {
    id,
    disabled: !canEdit,
    'aria-busy': pending || undefined,
  };

  let control;
  switch (f.type) {
    case 'select':
      control = (
        <Select
          {...common}
          value={value}
          options={f.options}
          onChange={(e) => {
            setDraft(e.target.value);
            save(e.target.value);
          }}
        />
      );
      break;
    case 'textarea':
      control = (
        <Textarea
          {...common}
          rows={2}
          className={s.textarea}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save()}
          onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
        />
      );
      break;
    default:
      control = (
        <Input
          {...common}
          type={f.type === 'number' ? 'number' : undefined}
          className={cx(f.type === 'number' && s.numInput)}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save()}
          onKeyDown={onKey}
        />
      );
  }
  return (
    <Field label={f.label} htmlFor={id} className={f.type === 'textarea' ? s.full : undefined}>
      {control}
    </Field>
  );
}
