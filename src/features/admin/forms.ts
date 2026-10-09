// Add-forms of the administration screens (docs/spec/01 §8.4): `AF.mtype` "New machine type" and `AF.plumbing` "Add
// connector", as FormDefs in English (FormDialog `translate`). Pure: built by the pages, rendered by client islands.
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

/**
 * AF.plumbing: System, Direction, Frequency, Technical owner. `systems` / `frequencies` = the options the connectors DAL
 * accepts (the prototype's lists).
 */
export function addConnectorForm(systems: readonly string[], frequencies: readonly string[]): FormDef {
  return {
    title: 'Add connector',
    submit: 'Connect',
    kind: 'create',
    fields: [
      { id: 'system', label: 'System', type: 'select', options: [...systems] },
      { id: 'direction', label: 'Direction', type: 'select', options: [{ value: 'import', label: 'Import' }, { value: 'export', label: 'Export' }, { value: 'both', label: 'Both' }] },
      { id: 'freq', label: 'Frequency', type: 'select', options: [...frequencies] },
      { id: 'owner', label: 'Technical owner', type: 'text' },
    ],
  };
}

/** The system the form opens on: the first one not connected yet (the prototype's first option, Sage X3, already is). */
export const firstFreeSystem = (systems: readonly string[], connected: readonly string[]) =>
  systems.find((s) => !connected.some((c) => c.toLowerCase() === s.toLowerCase())) ?? systems[0] ?? '';
