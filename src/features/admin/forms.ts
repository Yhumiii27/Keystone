// Add-forms of the administration screens (docs/spec/01 §8.4): `AF.mtype` "New machine type", as a FormDef in English
// (FormDialog `translate`). `AF.plumbing` "Add connector" is gone (D-7a, R-020: IT configures the connectors outside Keystone). Pure: built by the pages, rendered by client islands.
// Select values are codes where the domain has them (base template, calendar, direction); labels stay the prototype's.
import type { FormDef } from '@/components/app/form-def';
import { MT_FORM_BASES, MT_FORM_CALENDARS } from '@/domain/admin';

/** AF.mtype: Code*, Label*, Copy template from, Default calendar, Description. */
export function newMachineTypeForm(): FormDef {
  return {
    title: 'New machine type',
    submit: 'Create machine type',
    kind: 'create',
    fields: [
      { id: 'code', label: 'Code', type: 'text', required: true },
      { id: 'label', label: 'Label', type: 'text', required: true },
      { id: 'base', label: 'Copy template from', type: 'select', options: MT_FORM_BASES.map((o) => ({ value: o.value, label: o.label })) },
      { id: 'cal', label: 'Default calendar', type: 'select', options: MT_FORM_CALENDARS.map((o) => ({ value: o.value, label: o.label })) },
      { id: 'desc', label: 'Description', type: 'textarea' },
    ],
  };
}
