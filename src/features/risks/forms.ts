// The two add-forms of this feature, in English (FormDialog `translate` renders them in French):
// AF `risks` "New risk" (docs/spec/07 §3) and AF `contingency` "Contingency draw-down" (docs/spec/04 §5.5).
// Option lists are resolved per project by the pages (TEAM owners, approvers).
import type { FormDef } from '@/components/app/form-def';
import { approverLabel, type Approver } from '@/domain/contingency';
import { FORM_CATEGORIES, FORM_RESPONSES } from '@/domain/risk';
import { riskCategory, riskResponse } from '@/server/db/codes';

/** Toast suffix of AF_RESULT.risks; the action prefixes the new number ("R-21 · Risk registered"). */
export const RISK_RESULT = 'Risk registered';
/** AF_RESULT.contingency. */
export const DRAW_RESULT = 'Draw-down recorded';

/**
 * "New risk" — title · category · P · I · owner · response · EMV · response plan (select values are codes).
 * `categories` = Settings › Risk categories offered (chapter 4, A-14: active values, the form's own order first —
 * `orderedOptions`); omitted = the prototype's seven.
 */
export function riskFormDef(team: readonly string[], categories?: readonly { code: string; label: string }[]): FormDef {
  return {
    title: 'New risk',
    kind: 'create',
    submit: 'Register risk',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      {
        id: 'cat', label: 'Category', type: 'select',
        options: categories ? categories.map((c) => ({ value: c.code, label: c.label })) : FORM_CATEGORIES.map((c) => ({ value: c, label: riskCategory.label(c) })),
      },
      { id: 'p', label: 'Probability (1–5)', type: 'number', defaultValue: '3' },
      { id: 'i', label: 'Impact (1–5)', type: 'number', defaultValue: '3' },
      { id: 'owner', label: 'Owner', type: 'select', options: [...team] },
      { id: 'resp', label: 'Response', type: 'select', options: FORM_RESPONSES.map((r) => ({ value: r, label: riskResponse.label(r) })) },
      { id: 'emv', label: 'EMV (k€)', type: 'number' },
      { id: 'plan', label: 'Response plan', type: 'textarea' },
    ],
  };
}

/**
 * "Contingency draw-down" — amount · reason · linked to · approved by. "Linked to" is a placeholder here (the
 * prototype pre-fills the literal value "CR / risk / NCR", which was then stored — 04 Q8).
 */
export function drawDownFormDef(approvers: readonly Approver[]): FormDef {
  return {
    title: 'Contingency draw-down',
    kind: 'create',
    submit: 'Record draw-down',
    fields: [
      { id: 'amount', label: 'Amount (k€)', type: 'number', required: true },
      { id: 'reason', label: 'Reason', type: 'textarea', required: true },
      { id: 'link', label: 'Linked to', type: 'text', placeholder: 'CR / risk / NCR' },
      { id: 'approver', label: 'Approved by', type: 'select', options: approvers.map((a) => ({ value: a.name, label: approverLabel(a) })) },
    ],
  };
}
