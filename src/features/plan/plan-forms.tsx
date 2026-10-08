'use client';
// Add-form host of the Plan screen (AF plan / wp / progress) and the buttons that open it: the header primary
// action ("Update progress" / "Add activity"), "+ Add work package" and the per-WP "+". Those live in
// different islands (the header is rendered by the shell), so they share a tiny module-level store.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useSyncExternalStore } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { addActivity, addWorkPackage, saveProgress } from './actions';
import type { PlanFormKey } from './forms';
import s from './plan.module.css';

// ── Store ──────────────────────────────────────────────────────────────────────────────────────────────
type OpenForm = { key: PlanFormKey; init?: FormValues; seq: number } | null;
let current: OpenForm = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Opens an add-form (`afOpenWith(key, init)`). */
export function openPlanForm(key: PlanFormKey, init?: FormValues) {
  current = { key, init, seq: ++seq };
  emit();
}

function closePlanForm() {
  current = null;
  emit();
}

// ── Host ───────────────────────────────────────────────────────────────────────────────────────────────
export interface PlanFormsProps {
  code: string;
  /** "#026 · Harbor Line Terminal Expansion" (translated) — the dialog sub-line. */
  context: string;
  /** English definitions (translated by FormDialog). */
  defs: Record<PlanFormKey, FormDef>;
}

export function PlanForms({ code, context, defs }: PlanFormsProps) {
  const open = useSyncExternalStore(subscribe, () => current, () => null);
  if (!open) return null;
  const submit = (values: FormValues) =>
    open.key === 'plan' ? addActivity(code, values) : open.key === 'wp' ? addWorkPackage(code, values) : saveProgress(code, values);
  return (
    <FormDialog key={open.seq} open {...defs[open.key]} translate context={context} initialValues={open.init} onClose={closePlanForm} onSubmit={submit} />
  );
}

// ── Openers ────────────────────────────────────────────────────────────────────────────────────────────

/** Header primary action: `btn btn-primary` + plus icon (label translated). */
export function PlanPrimaryButton({ form, label }: { form: PlanFormKey; label: string }) {
  return (
    <Button variant="primary" icon={Plus} onClick={() => openPlanForm(form)}>
      {label}
    </Button>
  );
}

/** "+ Add work package" (Structure card header, ghost 12px nowrap). */
export function AddWorkPackageButton({ label }: { label: string }) {
  return (
    <Button variant="ghost" icon={Plus} className={s.addWp} onClick={() => openPlanForm('wp')}>
      {label}
    </Button>
  );
}
