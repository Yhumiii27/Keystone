'use client';
// Budget › Structure & changes — "Add category" (ghost, 12.5px, leading plus) and the row pencil "Edit category"
// (28×28 ghost icon button, neutral-400), with the prototype's look; both open the generic form dialog and save through
// ./category-actions.ts (chapter 4, A-14). Rendered only when the viewer may edit.
import { PencilSimple, Plus } from '@phosphor-icons/react/dist/ssr';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { codeFromPath } from '@/components/app/shell/nav-model';
import { Button, IconButton } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { addCostCategoryAction, editCostCategoryAction } from './category-actions';

interface CategoryButtonProps {
  /** Project code (falls back to the URL's). */
  code?: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" — the dialog sub-line. */
  context?: string;
  /** English form definition (translated by FormDialog). */
  form: FormDef;
}

const useProjectCode = (code?: string) => {
  const path = usePathname() ?? '';
  return code ?? codeFromPath(path) ?? '';
};

export function AddCategoryButton({ code, context, form }: CategoryButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const projectCode = useProjectCode(code);
  return (
    <>
      <Button variant="ghost" size="sm" icon={Plus} onClick={() => setOpen(true)}>
        {t('Add category')}
      </Button>
      <FormDialog {...form} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => addCostCategoryAction(projectCode, values)} />
    </>
  );
}

export function EditCategoryButton({ code, context, form, category, values }: CategoryButtonProps & { category: string; values: FormValues }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const projectCode = useProjectCode(code);
  return (
    <>
      <IconButton icon={PencilSimple} size={28} muted label={`${t('Edit category')} · ${category}`} onClick={() => setOpen(true)} />
      <FormDialog
        {...form}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={context ? `${context} · ${category}` : category}
        initialValues={values}
        onSubmit={(v) => editCostCategoryAction(projectCode, category, v)}
      />
    </>
  );
}
