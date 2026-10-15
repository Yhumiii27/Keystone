'use client';
// Generic schema-driven add-form dialog (docs/spec/01 §8, docs/spec/02 C-21 FormDialog).
// Fields text / number / textarea / select in a 2-column grid; required marks `*`; submit disabled until
// every required non-select field is non-blank; calls `onSubmit`, then toasts and closes on success.
// Values are rebuilt on every opening (no carry-over). An optional `note` (R-122) shows a line with an outside link under
// the fields (new tab, rel noopener); forms without it render as before.
import { ArrowSquareOut, Check, Play, Warning } from '@phosphor-icons/react/dist/ssr';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input, Select, Textarea } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { Callout } from './Callout';
import {
  initialFormValues,
  isFormValid,
  isFullSpan,
  optionLabel,
  optionValue,
  resolveFormValues,
  type FormDef,
  type FormFieldDef,
  type FormValues,
} from './form-def';
import s from './FormDialog.module.css';

/** What `onSubmit` may return: nothing (success), a toast message, or `{ toast?, error? }`. */
export type FormDialogResult = void | undefined | string | { toast?: string; error?: string };

export interface FormDialogProps extends FormDef {
  open: boolean;
  onClose: () => void;
  /** Called with the resolved values (selects default to their first option). May be a Server Function. */
  onSubmit: (values: FormValues) => Promise<FormDialogResult> | FormDialogResult;
  /** Values merged over the defaults on opening (afOpenWith init, e.g. `{ ms: 'M4' }`). */
  initialValues?: FormValues;
  /** Context before the sub-line, usually the project name: "{context} · Required fields are marked · *". */
  context?: string;
  /** Toast shown on success when `onSubmit` returns no message (already translated). */
  successToast?: string;
  /** Translate title, submit, labels, placeholders and option labels with t() (definitions in English). */
  translate?: boolean;
  /** Overrides of the built-in labels (translated). */
  labels?: { cancel?: string; requiredNote?: string; close?: string };
  /** z-index of the backdrop (50). */
  zIndex?: number;
}

export function FormDialog(props: FormDialogProps) {
  const { t } = useI18n();
  const tr = props.translate ? t : (x: string) => x;
  const { open, onClose, title, context, labels, zIndex } = props;
  const note = labels?.requiredNote ?? t('Required fields are marked ·');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr(title)}
      subtitleSize={12}
      subtitle={
        <>
          {context ? `${context} · ` : ''}
          {note} <span className={s.star}>*</span>
        </>
      }
      closeLabel={labels?.close}
      width={640}
      offsetTop="8vh"
      maxHeight="84vh"
      zIndex={zIndex}
    >
      <FormBody {...props} tr={tr} />
    </Dialog>
  );
}

function FormBody({ fields, submit, kind = 'create', note, onClose, onSubmit, initialValues, successToast, labels, tr }: FormDialogProps & { tr: (s: string) => string }) {
  const { t } = useI18n();
  const baseId = useId();
  const [values, setValues] = useState<FormValues>(() => initialFormValues(fields, initialValues));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const valid = isFormValid(fields, values);
  const set = (id: string, v: string) => setValues((cur) => ({ ...cur, [id]: v }));

  const submitForm = () => {
    if (!valid || pending) return;
    setError(null);
    const resolved = resolveFormValues(fields, values);
    startTransition(async () => {
      try {
        const r = await onSubmit(resolved);
        if (r && typeof r === 'object' && r.error) {
          setError(r.error);
          return;
        }
        const msg = typeof r === 'string' ? r : r && typeof r === 'object' ? r.toast : undefined;
        onClose();
        if (msg ?? successToast) showToast((msg ?? successToast) as string);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const control = (f: FormFieldDef) => {
    const id = `${baseId}-${f.id}`;
    const v = values[f.id] ?? '';
    const ph = f.placeholder ? tr(f.placeholder) : undefined;
    switch (f.type) {
      case 'number':
        return <Input id={id} type="number" value={v} placeholder={ph} aria-required={f.required || undefined} onChange={(e) => set(f.id, e.target.value)} />;
      case 'textarea':
        return <Textarea id={id} short value={v} placeholder={ph} aria-required={f.required || undefined} onChange={(e) => set(f.id, e.target.value)} />;
      case 'select':
        return (
          <Select
            id={id}
            value={v || (f.options?.length ? optionValue(f.options[0]) : '')}
            onChange={(e) => set(f.id, e.target.value)}
            options={(f.options ?? []).map((o) => ({ value: optionValue(o), label: tr(optionLabel(o)) }))}
          />
        );
      default:
        return <Input id={id} value={v} placeholder={ph} aria-required={f.required || undefined} onChange={(e) => set(f.id, e.target.value)} />;
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitForm();
      }}
      className={s.form}
      noValidate
    >
      <div className={s.grid}>
        {fields.map((f) => (
          <Field key={f.id} label={tr(f.label)} required={f.required} htmlFor={`${baseId}-${f.id}`} span={isFullSpan(f) ? 'full' : 'auto'}>
            {control(f)}
          </Field>
        ))}
      </div>
      {note && (
        <p className={s.note}>
          {tr(note.text)}{' '}
          <a href={note.href} target="_blank" rel="noopener noreferrer" className={s.noteLink}>
            {tr(note.linkLabel)}
            <ArrowSquareOut aria-hidden className={s.noteIcon} />
          </a>
        </p>
      )}
      {error && (
        <Callout variant="emphasis" icon={Warning} role="alert" className={s.error}>
          {error}
        </Callout>
      )}
      <DialogActions variant="form">
        <Button variant="secondary" onClick={onClose}>
          {labels?.cancel ?? t('Cancel')}
        </Button>
        <Button type="submit" variant="primary" icon={kind === 'run' ? Play : Check} disabled={!valid || pending} aria-busy={pending || undefined}>
          {tr(submit)}
        </Button>
      </DialogActions>
    </form>
  );
}
