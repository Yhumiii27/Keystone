// Field model of the generic add-form dialog (docs/spec/01 §8.2). Pure helpers, shared by FormDialog and
// by whoever builds form definitions from the prototype `AF` catalogue (server or client).

export type FormFieldType = 'text' | 'number' | 'textarea' | 'select' | 'date';
export type FormOption = string | { value: string; label: string };

export interface FormFieldDef {
  id: string;
  /** Label (translated, or English source when FormDialog `translate` is set). */
  label: string;
  type: FormFieldType;
  required?: boolean;
  /** Initial value; selects default to their first option. */
  defaultValue?: string;
  /** Select options (value = label for plain strings). Store codes as values where the domain has them. */
  options?: FormOption[];
  placeholder?: string;
  /** Grid span; default: full width for textareas and ids title/name/progress/reason/why, else auto. */
  span?: 'full' | 'auto';
}

/**
 * Optional note under the fields with a link opening outside Keystone (new tab): "HSE incident? Declare it in Vigie"
 * (NEW-SITE-2 'a', R-122). Serialisable; texts already translated (Keystone vocabulary, or English with `translate`).
 */
export interface FormNoteLink {
  text: string;
  linkLabel: string;
  href: string;
}

export interface FormDef {
  title: string;
  submit: string;
  /** `create` → Check icon on submit, `run` → Play icon. Default create. */
  kind?: 'create' | 'run';
  fields: FormFieldDef[];
  /** Note with an outside link shown under the fields; forms without it are unchanged. */
  note?: FormNoteLink;
}

export type FormValues = Record<string, string>;

const FULL_IDS = new Set(['title', 'name', 'progress', 'reason', 'why']);

export const optionValue = (o: FormOption) => (typeof o === 'string' ? o : o.value);
export const optionLabel = (o: FormOption) => (typeof o === 'string' ? o : o.label);

/** `'1 / -1'` span rule of afForm (logic 5119). */
export const isFullSpan = (f: FormFieldDef) => (f.span ? f.span === 'full' : f.type === 'textarea' || FULL_IDS.has(f.id));

/** Values on opening (afOpenWith): defaults (selects → first option) merged with `init`. */
export function initialFormValues(fields: FormFieldDef[], init: FormValues = {}): FormValues {
  const v: FormValues = {};
  for (const f of fields) v[f.id] = f.type === 'select' ? (f.defaultValue ?? (f.options?.length ? optionValue(f.options[0]) : '')) : (f.defaultValue ?? '');
  return { ...v, ...init };
}

/** Resolved value (`get(id)`): typed value, or the first option for an empty select. */
export function resolveFormValues(fields: FormFieldDef[], values: FormValues): FormValues {
  const out: FormValues = { ...values };
  for (const f of fields) if (f.type === 'select' && !out[f.id] && f.options?.length) out[f.id] = optionValue(f.options[0]);
  return out;
}

/** afValid (logic 5120): every required non-select field is non-blank after trim. */
export function isFormValid(fields: FormFieldDef[], values: FormValues): boolean {
  return fields.every((f) => !f.required || f.type === 'select' || !!(values[f.id] ?? '').trim());
}

/**
 * Converts a prototype `AF` entry (`{title, kind, submit, fields: [id, label, type, default, required?][]}`)
 * into a FormDef. `sources` resolves dynamic option tokens (WP, TEAM, ACT, ACTOPEN, PIPE, RCAT, ITPSYS,
 * FLEET, MSPLAN) to option lists; unknown tokens give an empty list.
 */
export function formDefFromPrototype(
  af: { title: string; kind?: string; submit: string; fields: (string | number | string[] | undefined)[][] },
  sources: Record<string, FormOption[]> = {},
): FormDef {
  return {
    title: af.title,
    submit: af.submit,
    kind: af.kind === 'run' ? 'run' : 'create',
    fields: af.fields.map(([id, label, type, def, req]) => {
      const t = String(type) as FormFieldType;
      const f: FormFieldDef = { id: String(id), label: String(label), type: t, required: !!req };
      if (Array.isArray(def)) f.options = def;
      else if (t === 'select' && typeof def === 'string') f.options = sources[def] ?? [];
      else if (def != null && def !== '') f.defaultValue = String(def);
      return f;
    }),
  };
}
