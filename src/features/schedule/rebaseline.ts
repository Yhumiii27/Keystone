// "Re-baseline" action form (AF `schedule`, docs/spec/05 §1.5): definition + input validation. Pure module,
// shared by the client button (FormDialog) and the Server Function. Definitions are the prototype's English
// source strings (FormDialog `translate`); select values are codes, labels are EN.
import type { FormDef, FormValues } from '@/components/app/form-def';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { EstimateClass } from '@/domain/estimate-class';
import { estimateClassField, parseEstimateClassInput } from '@/features/budget/estimate-class-field';

export type RebaselineApprover = 'director' | 'pm';
export type RebaselineScope = 'dates_budget' | 'dates' | 'budget';

export const REBASELINE_APPROVERS: RebaselineApprover[] = ['director', 'pm'];

/** "Marie Lefebvre · Portfolio director", "Romain Aubert · Project manager". */
export const approverLabel = (r: RebaselineApprover) => `${PERSONA_BY_ROLE[r].name} · ${PERSONA_BY_ROLE[r].title}`;

export const REBASELINE_SCOPES: { value: RebaselineScope; label: string }[] = [
  { value: 'dates_budget', label: 'Dates & budget' },
  { value: 'dates', label: 'Dates only' },
  { value: 'budget', label: 'Budget only' },
];

/** Prototype default of the name field. */
export const REBASELINE_DEFAULT_NAME = 'BL2 — after CR-006';
export const NAME_MAX = 80;
export const REASON_MAX = 2000;

export const REBASELINE_FORM: FormDef = {
  title: 'Re-baseline',
  submit: 'Freeze new baseline',
  kind: 'run',
  fields: [
    { id: 'name', label: 'Baseline name', type: 'text', required: true, defaultValue: REBASELINE_DEFAULT_NAME },
    { id: 'reason', label: 'Reason', type: 'textarea', required: true },
    { id: 'approver', label: 'Approver', type: 'select', options: REBASELINE_APPROVERS.map((r) => ({ value: r, label: approverLabel(r) })) },
    { id: 'scope', label: 'Scope', type: 'select', options: REBASELINE_SCOPES },
  ],
};

/** R-188: the prototype form plus the version's estimate class, preset to the class of the project's stage. */
export const rebaselineForm = (defaultClass: EstimateClass): FormDef => ({ ...REBASELINE_FORM, fields: [...REBASELINE_FORM.fields, estimateClassField(defaultClass)] });

export interface RebaselineRequest {
  name: string;
  reason: string;
  approver: RebaselineApprover;
  scope: RebaselineScope;
  /** R-188: undefined = the class of the project's stage. */
  estimateClass?: EstimateClass;
}

export type RebaselineParse = { ok: true; value: RebaselineRequest } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Validates the submitted values (untrusted). Errors are EN source strings (render through t()). */
export function parseRebaseline(values: FormValues | unknown): RebaselineParse {
  const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  const name = str(v.name);
  const reason = str(v.reason);
  const approver = str(v.approver) || REBASELINE_APPROVERS[0];
  const scope = str(v.scope) || REBASELINE_SCOPES[0].value;
  if (!name) return { ok: false, error: 'Baseline name is required' };
  if (name.length > NAME_MAX) return { ok: false, error: 'Baseline name is too long' };
  if (!reason) return { ok: false, error: 'Reason is required' };
  if (reason.length > REASON_MAX) return { ok: false, error: 'Reason is too long' };
  if (!REBASELINE_APPROVERS.includes(approver as RebaselineApprover)) return { ok: false, error: 'Unknown approver' };
  if (!REBASELINE_SCOPES.some((o) => o.value === scope)) return { ok: false, error: 'Unknown scope' };
  const cls = parseEstimateClassInput(v.estimateClass);
  if (!cls.ok) return cls;
  const value: RebaselineRequest = { name, reason, approver: approver as RebaselineApprover, scope: scope as RebaselineScope };
  return { ok: true, value: cls.value ? { ...value, estimateClass: cls.value } : value };
}

/** Toast of the prototype (`get('name') + ' · ' + AF_RESULT.schedule`), EN fixed part. */
export const REBASELINE_RESULT = 'Baseline frozen';
