// The PLM dialogs, in English as the prototype's AF catalogue (docs/spec/09 §3.7 AF `plm`, 01 §8): "New part" (Create
// part) and "Register equivalent" (the prototype's button had no handler). Select values are codes; `localizePlmForm`
// translates a definition on the server (FormDialog renders it as is). Parsing of the raw values lives here too, so the
// Server Functions and the tests share it.
import type { FormDef } from '@/components/app/form-def';
import type { Lang, T } from '@/i18n/translate';
import { PART_UNITS, partFamily, type PartFamily, type PartUnit } from '@/server/db/codes';
import { formLabelT } from './i18n';

/** AF_RESULT.plm. */
export const NEW_PART_RESULT = 'Part created in the catalogue';

/** "New part" — Reference* · Designation* · Family · Preferred supplier · Unit price (€) · Unit (AF.plm). */
export function newPartFormDef(): FormDef {
  return {
    title: 'New part',
    kind: 'create',
    submit: 'Create part',
    fields: [
      { id: 'ref', label: 'Reference', type: 'text', required: true },
      { id: 'name', label: 'Designation', type: 'text', required: true },
      { id: 'family', label: 'Family', type: 'select', options: partFamily.codes.map((c) => ({ value: c, label: partFamily.label(c) })) },
      { id: 'supplier', label: 'Preferred supplier', type: 'text' },
      { id: 'price', label: 'Unit price (€)', type: 'number' },
      { id: 'unit', label: 'Unit', type: 'select', options: PART_UNITS.map((u) => ({ value: u, label: u })) },
    ],
  };
}

/** "Register equivalent" — one select of the catalogue parts that are not yet equivalent ("REF · name"). */
export function registerEquivalentFormDef(candidates: readonly { ref: string; name: string }[]): FormDef {
  return {
    title: 'Register equivalent',
    kind: 'create',
    submit: 'Register equivalent',
    fields: [{ id: 'equivalent', label: 'Equivalent part', type: 'select', options: candidates.map((c) => ({ value: c.ref, label: `${c.ref} · ${c.name}` })), span: 'full' }],
  };
}

/** Selects whose option labels are codes' English labels (translated); the others (units, part refs) stay as they are. */
const CODE_SELECTS = new Set(['family']);

/** Translates title, submit, labels and the code options of a definition (form-specific fixes in `formLabelT`). */
export function localizePlmForm(def: FormDef, t: T, lang: Lang): FormDef {
  return {
    ...def,
    title: t(def.title),
    submit: t(def.submit),
    fields: def.fields.map((f) => ({
      ...f,
      label: formLabelT(f.label, t, lang),
      options: f.options && CODE_SELECTS.has(f.id) ? f.options.map((o) => (typeof o === 'string' ? t(o) : { value: o.value, label: t(o.label) })) : f.options,
    })),
  };
}

export type ParseResult<V> = { ok: true; value: V } | { ok: false; error: string };

export interface NewPartValues {
  ref: string;
  name: string;
  family: PartFamily;
  supplier: string | null;
  priceEur: number | null;
  unit: PartUnit;
}

/** Validates the New part values (EN error texts; the reference is upper-cased as the DAL stores it). */
export function parseNewPart(v: Record<string, string>): ParseResult<NewPartValues> {
  const ref = (v.ref ?? '').trim().toUpperCase();
  const name = (v.name ?? '').trim();
  if (!ref) return { ok: false, error: 'Reference is required' };
  if (ref.length > 40 || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(ref)) return { ok: false, error: 'Invalid reference' };
  if (!name) return { ok: false, error: 'Designation is required' };
  const family = v.family || 'structure';
  if (!partFamily.isCode(family)) return { ok: false, error: 'Unknown family' };
  const unit = v.unit || 'pc';
  if (!PART_UNITS.includes(unit as PartUnit)) return { ok: false, error: 'Unknown unit' };
  const raw = (v.price ?? '').trim().replace(',', '.');
  const price = raw === '' ? null : Number(raw);
  if (price != null && (!Number.isFinite(price) || price < 0 || price > 1e9)) return { ok: false, error: 'Invalid unit price' };
  const supplier = (v.supplier ?? '').trim().slice(0, 120) || null;
  return { ok: true, value: { ref, name: name.slice(0, 200), family, supplier, priceEur: price, unit: unit as PartUnit } };
}
