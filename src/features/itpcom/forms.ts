// The three action forms of the feature, in English as the prototype's AF catalogue (docs/spec/07 §3: AF `itp` "Add
// inspection", AF `punch` "Add punch item", AF `commissioning` "Plan SAT", a run form). Select values are codes; the
// system options are the plan's template systems (ITPSYS) or, for Plan SAT, the systems of the commissioning plan;
// owner options are the project TEAM (full names). `localizeForm` translates a definition on the server — FormDialog
// then renders it as is.
import type { FormDef, FormOption } from '@/components/app/form-def';
import { ITP_POINT_TYPES, ITP_STAGES, PUNCH_CATEGORIES, PUNCH_SOURCES, witnessFieldOf } from '@/domain/itpcom';
import type { Lang, T } from '@/i18n/translate';
import { ITP_RECORDED_RESULTS, itpPointType, itpResult, itpStage, punchCategory, punchSource, type ItpPointType, type ItpResult } from '@/server/db/codes';
import { dataT } from './i18n';

/** AF_RESULT.itp. */
export const INSPECTION_RESULT = 'Inspection added to the plan';
/** AF_RESULT.punch. */
export const PUNCH_RESULT = 'Punch item added';
/** AF_RESULT.commissioning (the invitation is recorded with the plan; no mail connector sends it yet). */
export const SAT_RESULT = 'SAT planned · invitation sent to the client';
/** Default "Prerequisites" of the Plan SAT form. */
export const SAT_PREREQUISITES = 'Punch A items closed · pre-commissioning reports issued';

/** "Add inspection" — inspection / test · system · type · stage · standard / reference · planned date. */
export function inspectionFormDef(systems: readonly string[]): FormDef {
  return {
    title: 'Add inspection',
    kind: 'create',
    submit: 'Add to plan',
    fields: [
      { id: 'name', label: 'Inspection / test', type: 'text', required: true },
      { id: 'system', label: 'System', type: 'select', options: [...systems] },
      { id: 'type', label: 'Type', type: 'select', options: ITP_POINT_TYPES.map((c) => ({ value: c, label: itpPointType.label(c) })) },
      { id: 'stage', label: 'Stage', type: 'select', options: ITP_STAGES.map((c) => ({ value: c, label: itpStage.label(c) })) },
      { id: 'ref', label: 'Standard / reference', type: 'text' },
      { id: 'date', label: 'Planned date', type: 'text' },
    ],
  };
}

/** "Add punch item" — item · system / location · category · source · owner · due. */
export function punchFormDef(team: readonly string[]): FormDef {
  return {
    title: 'Add punch item',
    kind: 'create',
    submit: 'Add item',
    fields: [
      { id: 'item', label: 'Item', type: 'text', required: true },
      { id: 'loc', label: 'System / location', type: 'text' },
      { id: 'cat', label: 'Category', type: 'select', options: PUNCH_CATEGORIES.map((c) => ({ value: c, label: punchCategory.label(c) })) },
      { id: 'src', label: 'Source', type: 'select', options: PUNCH_SOURCES.map((c) => ({ value: c, label: punchSource.label(c) })) },
      { id: 'owner', label: 'Owner', type: 'select', options: [...team] },
      { id: 'due', label: 'Due', type: 'text' },
    ],
  };
}

export interface PlanSatDefaults {
  /** "10 Dec 2026" (English; translated by localizeForm). */
  date: string;
  /** Client contacts of the project, "N. Bensaïd, K. Doucouré". */
  witnesses: string;
}

/** "Plan SAT" (run) — system · date (required) · client witnesses · prerequisites. */
export function planSatFormDef(systems: readonly string[], defaults: PlanSatDefaults): FormDef {
  return {
    title: 'Plan SAT',
    kind: 'run',
    submit: 'Plan & invite',
    fields: [
      { id: 'system', label: 'System', type: 'select', options: [...systems] },
      { id: 'date', label: 'Date', type: 'text', required: true, defaultValue: defaults.date },
      { id: 'client', label: 'Client witnesses', type: 'text', defaultValue: defaults.witnesses },
      { id: 'note', label: 'Prerequisites', type: 'textarea', defaultValue: SAT_PREREQUISITES },
    ],
  };
}

/** Toast of "Record result" (R-112). */
export const RESULT_RESULT = 'Inspection result recorded';

export interface ResultFormDefaults {
  /** Result code proposed (the recorded one, else Passed). */
  result: ItpResult;
  /** "30 Sep" (English; translated by localizeForm). */
  date: string;
  inspector: string;
  witness: string;
  comment: string;
}

/**
 * "Record result" (R-112, Q-6a) — result · date · inspector · client representative (hold point: required; witness point:
 * optional; absent otherwise) · comment (required for a failure or reservations; checked on submit).
 */
export function resultFormDef(pointType: ItpPointType, d: ResultFormDefaults): FormDef {
  const witness = witnessFieldOf(pointType);
  return {
    title: 'Record result',
    kind: 'create',
    submit: 'Record result',
    fields: [
      {
        id: 'result', label: 'Result', type: 'select', options: ITP_RECORDED_RESULTS.map((c) => ({ value: c, label: itpResult.label(c) })),
        defaultValue: (ITP_RECORDED_RESULTS as readonly string[]).includes(d.result) ? d.result : 'passed',
      },
      { id: 'date', label: 'Date', type: 'text', required: true, defaultValue: d.date },
      { id: 'inspector', label: 'Inspector', type: 'text', required: true, defaultValue: d.inspector },
      ...(witness ? [{ id: 'witness', label: 'Client representative present', type: 'text' as const, required: witness === 'required', defaultValue: d.witness }] : []),
      { id: 'comment', label: 'Comment', type: 'textarea', defaultValue: d.comment, placeholder: 'Required for a failure or reservations' },
    ],
  };
}

/** Selects whose option labels are codes' English labels (translated). */
const CODE_SELECTS = new Set(['type', 'stage', 'cat', 'src', 'result']);
/** Selects listing systems: data text (exact dictionary matches), the value stays the English system name. */
const SYSTEM_SELECTS = new Set(['system']);
/** Defaults that are prototype text (translated); the witnesses' names are kept as is. */
const TEXT_DEFAULTS = new Set(['date', 'note']);

/** Translates title, submit, labels, option labels and the text defaults of a definition. */
export function localizeForm(def: FormDef, t: T, lang: Lang): FormDef {
  const opt = (id: string) => (o: FormOption): FormOption => {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    if (CODE_SELECTS.has(id)) return { value, label: t(label) };
    if (SYSTEM_SELECTS.has(id)) return { value, label: dataT(label, lang) };
    return o;
  };
  return {
    ...def,
    title: t(def.title),
    submit: t(def.submit),
    fields: def.fields.map((f) => ({
      ...f,
      label: t(f.label),
      placeholder: f.placeholder ? t(f.placeholder) : undefined,
      defaultValue: f.defaultValue && TEXT_DEFAULTS.has(f.id) ? t(f.defaultValue) : f.defaultValue,
      options: f.options?.map(opt(f.id)),
    })),
  };
}
