'use client';
// R-196 (K-196): the project's category editor of the Contract screen — client project or R&D project. The Server Function checks
// the viewer's rights again; the change is saved on click.
import { useState, useTransition } from 'react';
import { Segmented } from '@/components/ds/Segmented';
import { showToast } from '@/components/ds/Toast';
import type { ProjectCategory } from '@/domain/project-category';
import { setProjectCategoryAction } from './category-actions';

export interface CategoryFormProps {
  code: string;
  category: ProjectCategory;
  labels: { title: string; saved: string; options: { value: ProjectCategory; label: string }[] };
}

export function CategoryForm({ code, category, labels }: CategoryFormProps) {
  const [value, setValue] = useState(category);
  const [pending, startTransition] = useTransition();
  return (
    <Segmented
      label={labels.title}
      value={value}
      options={labels.options.map((o) => ({ ...o, disabled: pending }))}
      onChange={(next) => {
        if (next === value) return;
        const previous = value;
        setValue(next);
        startTransition(async () => {
          try {
            const r = await setProjectCategoryAction(code, next);
            if ('error' in r) {
              setValue(previous);
              showToast(r.error);
            } else showToast(labels.saved);
          } catch (err) {
            setValue(previous);
            showToast(err instanceof Error ? err.message : String(err));
          }
        });
      }}
    />
  );
}
