// Budget › Structure & changes — "Add category" / "Edit category" forms (chapter 4, A-14; the prototype's controls had
// no behaviour, 04 §1.7 Q4). English definitions, translated by FormDialog. "Add" offers Settings › Cost categories
// (active values; the type follows the category unless chosen); "Edit" changes the name, the type and the budget.
// Delivery 8 (R-081, C-3a): once the project has BL1 (`frozen`) both forms drop the budget field — a new category starts at 0 and
// an amount changes only through an approved change request (FormDef has no read-only field).
import type { FormDef, FormValues } from '@/components/app/form-def';
import type { ListOption } from '@/domain/settings-rules';
import { costType, type CostType } from '@/server/db/codes';

/** Type option meaning "the cost type of the chosen Settings category". */
export const TYPE_FROM_CATEGORY = 'auto';

/** Cost type labels of the forms ("Reserve" alone reads « Réservation » in the shared dictionary — a stock word). */
const typeLabel = (c: CostType) => (c === 'reserve' ? 'Reserve (contingency)' : costType.label(c));
const TYPE_OPTIONS = costType.codes.map((c) => ({ value: c, label: typeLabel(c) }));
const BUDGET_FIELD = { id: 'budget', label: 'Budget (k€)', type: 'number' as const, required: true };

export function addCategoryFormDef(options: readonly ListOption[], opts?: { frozen?: boolean }): FormDef {
  return {
    title: 'Add category',
    submit: 'Add category',
    kind: 'create',
    fields: [
      { id: 'cat', label: 'Category', type: 'select', options: options.map((o) => ({ value: o.code, label: o.label })) },
      { id: 'type', label: 'Type', type: 'select', options: [{ value: TYPE_FROM_CATEGORY, label: 'From the category' }, ...TYPE_OPTIONS] },
      { id: 'name', label: 'Name in this project', type: 'text', placeholder: 'Same as the category' },
      ...(opts?.frozen ? [] : [BUDGET_FIELD]),
    ],
  };
}

export function editCategoryFormDef(opts?: { frozen?: boolean }): FormDef {
  return {
    title: 'Edit category',
    submit: 'Save',
    kind: 'create',
    fields: [
      { id: 'name', label: 'Category', type: 'text', required: true },
      { id: 'type', label: 'Type', type: 'select', options: TYPE_OPTIONS },
      ...(opts?.frozen ? [] : [BUDGET_FIELD]),
    ],
  };
}

/** Values the edit form opens with (no budget once frozen: the field is not in the form, R-081). */
/** `version` (R-010): the category's token as the page read it — a hidden value of the form, sent back on save. */
export const editCategoryValues = (c: { name: string; costType: CostType; budget: number; version?: string }, opts?: { frozen?: boolean }): FormValues => ({
  name: c.name, type: c.costType, ...(opts?.frozen ? {} : { budget: String(c.budget) }), ...(c.version ? { version: c.version } : {}),
});

/** Budget typed in k€ ("120", "120,5"); null when not a number. */
export function parseCategoryBudget(raw: string | undefined): number | null {
  const v = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!v || !/^-?\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}
