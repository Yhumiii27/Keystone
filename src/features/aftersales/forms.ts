// The two add-forms of the section, in English as the prototype's AF catalogue (docs/spec/07 §3 AF `fleet`, AF `sav`).
// Select values are codes (machine type, severity, coverage) or machine numbers; option labels are English source
// strings. `localizeForm` translates a definition on the server — FormDialog then renders it as is.
import type { FormDef, FormOption } from '@/components/app/form-def';
import type { Lang, T } from '@/i18n/translate';
import { claimCoverage, ncrSeverity } from '@/server/db/codes';
import { formText } from './i18n';

/** AF_RESULT.fleet. */
export const MACHINE_RESULT = 'Machine added to the installed base';
/** AF_RESULT.sav. */
export const CLAIM_RESULT = 'Warranty claim opened';

/** "Add machine" — machine · type · client · site · delivered · warranty end. */
export function machineFormDef(types: readonly { code: string; label: string }[]): FormDef {
  return {
    title: 'Add machine',
    kind: 'create',
    submit: 'Add machine',
    fields: [
      { id: 'name', label: 'Machine', type: 'text', required: true },
      { id: 'type', label: 'Type', type: 'select', options: types.map((m) => ({ value: m.code, label: m.label })) },
      { id: 'client', label: 'Client', type: 'text', required: true },
      { id: 'site', label: 'Site', type: 'text' },
      { id: 'delivered', label: 'Delivered', type: 'text' },
      { id: 'warranty', label: 'Warranty end', type: 'text' },
    ],
  };
}

/** "New warranty claim" — machine · issue · severity · coverage · owner · description. */
export function claimFormDef(machines: readonly { number: string; label: string }[], owners: readonly string[]): FormDef {
  return {
    title: 'New warranty claim',
    kind: 'create',
    submit: 'Open claim',
    fields: [
      { id: 'machine', label: 'Machine', type: 'select', options: machines.map((m) => ({ value: m.number, label: m.label })) },
      { id: 'issue', label: 'Issue', type: 'text', required: true },
      { id: 'sev', label: 'Severity', type: 'select', options: ncrSeverity.codes.map((c) => ({ value: c, label: ncrSeverity.label(c) })) },
      { id: 'cover', label: 'Coverage', type: 'select', options: claimCoverage.codes.map((c) => ({ value: c, label: claimCoverage.label(c) })) },
      { id: 'owner', label: 'Owner', type: 'select', options: [...owners] },
      { id: 'desc', label: 'Description', type: 'textarea' },
    ],
  };
}

/** Selects whose option labels are English labels to translate (machines, machine types and people are data, kept as they are). */
const TRANSLATED_SELECTS = new Set(['sev', 'cover']);

/** Translates title, submit, labels and the translatable options of a definition. */
export function localizeForm(def: FormDef, t: T, lang: Lang): FormDef {
  const opt = (o: FormOption): FormOption => (typeof o === 'string' ? o : { value: o.value, label: t(o.label) });
  return {
    ...def,
    title: formText(def.title, t, lang),
    submit: formText(def.submit, t, lang),
    fields: def.fields.map((f) => ({
      ...f,
      label: formText(f.label, t, lang),
      placeholder: f.placeholder ? t(f.placeholder) : undefined,
      options: f.options && TRANSLATED_SELECTS.has(f.id) ? f.options.map(opt) : f.options,
    })),
  };
}
