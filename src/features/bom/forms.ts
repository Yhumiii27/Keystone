// "Add article" form of the Project BOM (AF.bom, logic 3683; docs/spec/09 §1.12, 01 §8): article reference (required),
// quantity (default 1), activity (the project's first 12, "A1250 · name"), scope (Keystone / Client / Overlay), note.
// Select values are codes; `localizeBomForm` translates the definition on the server — FormDialog renders it as is.
import { formDefFromPrototype, type FormDef, type FormOption } from '@/components/app/form-def';
import { BOM_SCOPES } from '@/domain/bom';
import { COMMON_EQUIPMENT } from '@/domain/equipment-scope';
import type { T } from '@/i18n/translate';
import { bomScope } from '@/server/db/codes';

/** AF_RESULT.bom. */
export const BOM_RESULT = 'Article added to the project BOM';

/** The prototype entry (AF.bom), kept verbatim; the scope options become codes. */
const AF_BOM = {
  title: 'Add article',
  kind: 'create',
  submit: 'Add to BOM',
  fields: [['ref', 'Article reference', 'text', '', 1], ['qty', 'Quantity', 'number', '1'], ['act', 'Activity', 'select', 'ACT'], ['scope', 'Scope', 'select', 'SCOPE'], ['note', 'Note', 'textarea', '']],
};

/**
 * Form definition (English) with the project's activities (`{ code, label: "A1250 · name" }`). R-185: with more than one
 * equipment line, an "Equipment" select (common to the project by default, or one of the lines).
 */
export function bomFormDef(activities: readonly { code: string; label: string }[], equipments?: readonly { ref: string; label: string }[]): FormDef {
  const def = formDefFromPrototype(AF_BOM, {
    ACT: activities.map((a) => ({ value: a.code, label: a.label })),
    SCOPE: BOM_SCOPES.map((c) => ({ value: c, label: bomScope.label(c) })),
  });
  if (!equipments || equipments.length < 2) return def;
  const field = {
    id: 'equipment', label: 'Equipment', type: 'select' as const, defaultValue: COMMON_EQUIPMENT,
    options: [{ value: COMMON_EQUIPMENT, label: 'Common to the project' }, ...equipments.map((e) => ({ value: e.ref, label: e.label }))],
  };
  const at = def.fields.findIndex((f) => f.id === 'note');
  return { ...def, fields: at < 0 ? [...def.fields, field] : [...def.fields.slice(0, at), field, ...def.fields.slice(at)] };
}

/** Translates title, submit, labels and the scope options; activity labels keep the code and translate the name. */
export function localizeBomForm(def: FormDef, t: T): FormDef {
  const opt = (o: FormOption): FormOption => (typeof o === 'string' ? t(o) : { value: o.value, label: t(o.label) });
  return {
    ...def,
    title: t(def.title),
    submit: t(def.submit),
    fields: def.fields.map((f) => ({
      ...f, label: t(f.label), placeholder: f.placeholder ? t(f.placeholder) : undefined,
      // R-185: the equipment lines keep their reference and type ("EQ-02 · 3 × MEMU"); only "Common to the project" is translated.
      options: f.id === 'equipment'
        ? f.options?.map((o) => (typeof o !== 'string' && o.value === COMMON_EQUIPMENT ? { value: o.value, label: t(o.label) } : o))
        : f.options?.map(opt),
    })),
  };
}
