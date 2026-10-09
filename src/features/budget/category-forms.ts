// Budget › Structure & changes — "Add category" / "Edit category" forms (chapter 4, A-14; the prototype's controls had
// no behaviour, 04 §1.7 Q4). English definitions, translated by FormDialog. "Add" offers Settings › Cost categories
// (active values; the type follows the category unless chosen); "Edit" changes the name, the type and the budget.
import type { FormDef, FormValues } from '@/components/app/form-def';
import type { ListOption } from '@/domain/settings-rules';
import { costType, type CostType } from '@/server/db/codes';

/** Type option meaning "the cost type of the chosen Settings category". */
export const TYPE_FROM_CATEGORY = 'auto';

/** Cost type labels of the forms ("Reserve" alone reads « Réservation » in the shared dictionary — a stock word). */
const typeLabel = (c: CostType) => (c === 'reserve' ? 'Reserve (contingency)' : costType.label(c));
const TYPE_OPTIONS = costType.codes.map((c) => ({ value: c, label: typeLabel(c) }));

export function addCategoryFormDef(options: readonly ListOption[]): FormDef {
  return {
    title: 'Add category',
    submit: 'Add category',
    kind: 'create',
    fields: [
      { id: 'cat', label: 'Category', type: 'select', options: options.map((o) => ({ value: o.code, label: o.label })) },
      { id: 'type', label: 'Type', type: 'select', options: [{ value: TYPE_FROM_CATEGORY, label: 'From the category' }, ...TYPE_OPTIONS] },
      { id: 'name', label: 'Name in this project', type: 'text', placeholder: 'Same as the category' },
      { id: 'budget', label: 'Budget (k€)', type: 'number', required: true },
    ],
  };
}

export function editCategoryFormDef(): FormDef {
  return {
    title: 'Edit category',
    submit: 'Save',
    kind: 'create',
    fields: [
      { id: 'name', label: 'Category', type: 'text', required: true },
      { id: 'type', label: 'Type', type: 'select', options: TYPE_OPTIONS },
      { id: 'budget', label: 'Budget (k€)', type: 'number', required: true },
    ],
  };
}

/** Values the edit form opens with. */
export const editCategoryValues = (c: { name: string; costType: CostType; budget: number }): FormValues => ({
  name: c.name, type: c.costType, budget: String(c.budget),
});

/** Budget typed in k€ ("120", "120,5"); null when not a number. */
export function parseCategoryBudget(raw: string | undefined): number | null {
  const v = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!v || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}
