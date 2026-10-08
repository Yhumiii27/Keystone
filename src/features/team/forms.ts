// The two add-forms of the feature, in English as the prototype's AF catalogue (docs/spec/05 §6.5 AF `stakeholders`,
// 07 §3 AF `interfaces`). Select values are codes; owner options are the project TEAM (full names). `localizeForm`
// translates a definition on the server with the feature's overrides ("Register" is the verb) — FormDialog then
// renders it as is.
import type { FormDef, FormOption } from '@/components/app/form-def';
import { KEYSTONE_SIDES, STAKEHOLDER_TYPES } from '@/domain/team';
import type { T } from '@/i18n/translate';
import { keystoneSide, stakeholderType } from '@/server/db/codes';

/** AF_RESULT.stakeholders. */
export const STAKEHOLDER_RESULT = 'Stakeholder added';
/** AF_RESULT.interfaces. */
export const INTERFACE_RESULT = 'Interface registered';

/** "Add stakeholder" — name · organisation · role · type · contact (e-mail) · relationship owner. */
export function stakeholderFormDef(team: readonly string[]): FormDef {
  return {
    title: 'Add stakeholder',
    kind: 'create',
    submit: 'Add',
    fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'org', label: 'Organisation', type: 'text', required: true },
      { id: 'role', label: 'Role', type: 'text' },
      { id: 'type', label: 'Type', type: 'select', options: STAKEHOLDER_TYPES.map((c) => ({ value: c, label: stakeholderType.label(c) })) },
      { id: 'contact', label: 'Contact (e-mail)', type: 'text' },
      { id: 'owner', label: 'Relationship owner', type: 'select', options: [...team] },
    ],
  };
}

/** "New interface" — interface · Keystone side · other party · data expected · needed by · owner. */
export function interfaceFormDef(team: readonly string[]): FormDef {
  return {
    title: 'New interface',
    kind: 'create',
    submit: 'Register',
    fields: [
      { id: 'title', label: 'Interface', type: 'text', required: true },
      { id: 'a', label: 'Keystone side', type: 'select', options: KEYSTONE_SIDES.map((c) => ({ value: c, label: keystoneSide.label(c) })) },
      { id: 'b', label: 'Other party', type: 'text', required: true },
      { id: 'data', label: 'Data expected', type: 'text', required: true },
      { id: 'needed', label: 'Needed by', type: 'text', required: true },
      { id: 'owner', label: 'Owner', type: 'select', options: [...team] },
    ],
  };
}

/** Selects whose option labels are codes' English labels (translated); other selects list people (kept as is). */
const CODE_SELECTS = new Set(['type', 'a']);

/** Translates title, submit, labels, placeholders and the code options of a definition. */
export function localizeForm(def: FormDef, t: T): FormDef {
  const opt = (o: FormOption): FormOption => (typeof o === 'string' ? o : { value: o.value, label: t(o.label) });
  return {
    ...def,
    title: t(def.title),
    submit: t(def.submit),
    fields: def.fields.map((f) => ({
      ...f,
      label: t(f.label),
      placeholder: f.placeholder ? t(f.placeholder) : undefined,
      options: f.options && CODE_SELECTS.has(f.id) ? f.options.map(opt) : f.options,
    })),
  };
}
