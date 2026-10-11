// The two add-forms of the section, in English as the prototype's AF catalogue (docs/spec/07 §3 AF `fleet`, AF `sav`).
// Select values are codes (machine type, severity, coverage) or machine numbers; option labels are English source
// strings. `localizeForm` translates a definition on the server — FormDialog then renders it as is.
import type { FormDef, FormOption } from '@/components/app/form-def';
import type { Lang, T } from '@/i18n/translate';
import { NO_PART } from '@/domain/claims';
import { claimCoverage, interventionType, ncrSeverity, type ClaimCoverage } from '@/server/db/codes';
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

// ── R-143: claim follow-up and interventions; R-144: machines registered at delivery ─────────────────────

/** "Edit claim" — coverage · owner · cost (k€) · next step · diagnosis · design ECO. Defaults: the claim's values. */
export function claimEditFormDef(
  c: { coverage: ClaimCoverage; owner: string; costKeur: number; nextStep: string; diagnosis: string | null; ecoNumber: string | null },
  owners: readonly string[],
  lang: Lang,
): FormDef {
  return {
    title: 'Edit claim',
    kind: 'create',
    submit: 'Save',
    fields: [
      { id: 'cover', label: 'Coverage', type: 'select', options: claimCoverage.codes.map((x) => ({ value: x, label: claimCoverage.label(x) })), defaultValue: c.coverage },
      { id: 'owner', label: 'Owner', type: 'select', options: owners.includes(c.owner) ? [...owners] : [c.owner, ...owners], defaultValue: c.owner },
      { id: 'cost', label: 'Cost (k€)', type: 'text', defaultValue: lang === 'fr' ? String(c.costKeur).replace('.', ',') : String(c.costKeur) },
      { id: 'next', label: 'Next step', type: 'text', defaultValue: c.nextStep === '—' ? '' : c.nextStep },
      { id: 'eco', label: 'Design ECO (Vigie)', type: 'text', defaultValue: c.ecoNumber ?? '', placeholder: 'ECO-031' },
      { id: 'diagnosis', label: 'Diagnosis', type: 'textarea', defaultValue: c.diagnosis ?? '' },
    ],
  };
}

/** "Mark diagnosed" — the diagnosis (required). */
export function diagnoseFormDef(current: string | null): FormDef {
  return {
    title: 'Mark diagnosed',
    kind: 'run',
    submit: 'Mark diagnosed',
    fields: [{ id: 'diagnosis', label: 'Diagnosis', type: 'textarea', required: true, defaultValue: current ?? '' }],
  };
}

/** "Plan intervention" — machine (Interventions view only) · type · date · technicians · duration (days) · detail. */
export function planInterventionFormDef(machines: readonly { number: string; label: string }[] | null, d: { technicians: string }): FormDef {
  return {
    title: 'Plan intervention',
    kind: 'create',
    submit: 'Plan intervention',
    fields: [
      ...(machines ? [{ id: 'machine', label: 'Machine', type: 'select' as const, options: machines.map((m) => ({ value: m.number, label: m.label })) }] : []),
      { id: 'ivtype', label: 'Type', type: 'select', options: interventionType.codes.map((x) => ({ value: x, label: interventionType.label(x) })), defaultValue: machines ? 'preventive' : 'corrective' },
      { id: 'date', label: 'Date', type: 'text', required: true, placeholder: 'e.g. 8 Oct' },
      { id: 'tech', label: 'Technicians', type: 'text', required: true, defaultValue: d.technicians },
      { id: 'duration', label: 'Duration (days)', type: 'text', defaultValue: '1' },
      { id: 'detail', label: 'Detail', type: 'text' },
    ],
  };
}

/** "Mark done" — date · report · part replaced or upgraded ("—" none) · revision fitted. */
export function interventionDoneFormDef(parts: readonly string[], today: string): FormDef {
  return {
    title: 'Mark done',
    kind: 'run',
    submit: 'Mark done',
    fields: [
      { id: 'date', label: 'Date', type: 'text', required: true, defaultValue: today },
      { id: 'report', label: 'Report', type: 'textarea' },
      { id: 'part', label: 'Part replaced or upgraded', type: 'select', options: [NO_PART, ...parts] },
      { id: 'rev', label: 'Revision fitted', type: 'text' },
    ],
  };
}

/**
 * "Register delivered machines" of one project (R-144) — number of machines · name · site · delivered · warranty end. Defaults:
 * the project's assembly roots, its machine type and name, its site, the business date and the contract's warranty.
 */
export function registerMachinesFormDef(d: { project: string; count: number; name: string; site: string; delivered: string; warrantyEnd: string }): FormDef {
  return {
    title: 'Register delivered machines',
    kind: 'create',
    submit: 'Register machines',
    fields: [
      { id: 'project', label: 'Project', type: 'select', options: [d.project] },
      { id: 'count', label: 'Number of machines', type: 'number', defaultValue: String(d.count) },
      { id: 'name', label: 'Machine', type: 'text', required: true, defaultValue: d.name },
      { id: 'site', label: 'Site', type: 'text', defaultValue: d.site },
      { id: 'delivered', label: 'Delivered', type: 'text', required: true, defaultValue: d.delivered },
      { id: 'warranty', label: 'Warranty end', type: 'text', required: true, defaultValue: d.warrantyEnd },
    ],
  };
}

/** Selects whose option labels are English labels to translate (machines, machine types and people are data, kept as they are). */
const TRANSLATED_SELECTS = new Set(['sev', 'cover', 'ivtype']);

/** Fields whose default is an English date (translated). */
const DATE_DEFAULTS = new Set(['date', 'delivered', 'warranty']);

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
      // Dates proposed in English ("30 Sep 2026") are shown in the viewer's language; typed data stays as is.
      defaultValue: f.defaultValue && DATE_DEFAULTS.has(f.id) ? t(f.defaultValue) : f.defaultValue,
      options: f.options && TRANSLATED_SELECTS.has(f.id) ? f.options.map(opt) : f.options,
    })),
  };
}
