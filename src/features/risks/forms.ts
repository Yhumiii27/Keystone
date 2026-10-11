// The two add-forms of this feature, in English (FormDialog `translate` renders them in French):
// AF `risks` "New risk" (docs/spec/07 §3) and AF `contingency` "Contingency draw-down" (docs/spec/04 §5.5).
// Option lists are resolved per project by the pages (TEAM owners; the change requests, risks and NCRs a draw-down covers).
// Delivery 7: "New risk" asks the cost if it occurs instead of the EMV (Q-1: EMV = cost × P / 5); the draw-down form links
// to an item chosen from a list and offers no approver — the portfolio director validates it in My approvals (C-4).
import type { FormDef } from '@/components/app/form-def';
import type { DrawLinkOption } from '@/domain/contingency';
import { FORM_CATEGORIES, FORM_RESPONSES } from '@/domain/risk';
import { riskCategory, riskResponse } from '@/server/db/codes';

/** Toast suffix of AF_RESULT.risks; the action prefixes the new number ("R-21 · Risk registered"). */
export const RISK_RESULT = 'Risk registered';
/** AF_RESULT.contingency (delivery 7: the draw-down now waits for the director's validation). */
export const DRAW_RESULT = 'Draw-down recorded · Awaiting the director’s validation';

/**
 * "New risk" — title · category · P · I · owner · response · cost if it occurs · response plan (select values are codes).
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
      { id: 'cost', label: 'Cost if it occurs (k€)', type: 'number', placeholder: 'EMV = cost × P / 5' },
      { id: 'plan', label: 'Response plan', type: 'textarea' },
    ],
  };
}

/**
 * "Contingency draw-down" — amount · reason · linked to (C-4: required, one of the project's change requests, risks or NCRs;
 * the prototype pre-filled the literal "CR / risk / NCR" — 04 Q8). No approver: the draw-down waits for the portfolio
 * director's validation in My approvals.
 */
export function drawDownFormDef(links: readonly DrawLinkOption[]): FormDef {
  return {
    title: 'Contingency draw-down',
    kind: 'create',
    submit: 'Record draw-down',
    fields: [
      { id: 'amount', label: 'Amount (k€)', type: 'number', required: true },
      { id: 'reason', label: 'Reason', type: 'textarea', required: true },
      // A first empty choice: nothing is linked by default (the server refuses a draw-down without a link).
      { id: 'link', label: 'Linked to', type: 'select', required: true, options: [{ value: '', label: 'Choose a change request, risk or NCR' }, ...links.map((l) => ({ value: l.value, label: l.label }))] },
    ],
  };
}
