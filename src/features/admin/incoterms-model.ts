// R-158 lot A: view model and form of Settings › Incoterms (texts in the viewer's language; the split as chips).
import type { FormDef } from '@/components/app/form-def';
import {
  INCOTERM_MODES, INCOTERM_MODES_LABEL, INCOTERM_PARTY_LABEL, INCOTERM_STEPS, INCOTERM_STEP_LABEL, incotermText,
} from '@/domain/incoterms';
import type { Lang, T } from '@/i18n/translate';
import type { IncotermRow } from '@/server/dal/incoterms';
import type { IncotermRowView } from './incoterms-card';

export function incotermsView(rows: IncotermRow[], t: T, lang: Lang): IncotermRowView[] {
  return rows.map((r) => ({
    code: r.code, name: incotermText(lang, r.nameEn, r.nameFr), description: incotermText(lang, r.descriptionEn, r.descriptionFr),
    modes: t(INCOTERM_MODES_LABEL[r.modes]), standard: r.standard, active: r.active, usedBy: r.usedBy,
    split: INCOTERM_STEPS.map((k) => ({ label: t(INCOTERM_STEP_LABEL[k]), seller: r.split[k] === 'seller' })),
    form: {
      code: r.code, nameEn: r.nameEn, nameFr: r.nameFr, descriptionEn: r.descriptionEn, descriptionFr: r.descriptionFr, modes: r.modes,
      ...Object.fromEntries(INCOTERM_STEPS.map((k) => [`step_${k}`, r.split[k]])),
    },
  }));
}

/** "Add Incoterm" (with the code) / "Edit" (code fixed). */
export function incotermFormDef(t: T, create: boolean): FormDef {
  const party = (['seller', 'buyer'] as const).map((p) => ({ value: p, label: t(INCOTERM_PARTY_LABEL[p]) }));
  return {
    title: t(create ? 'Add Incoterm' : 'Edit Incoterm'),
    submit: t(create ? 'Add Incoterm' : 'Save'),
    fields: [
      ...(create ? [{ id: 'code', label: t('Code (three letters)'), type: 'text' as const, required: true }] : []),
      { id: 'modes', label: t('Modes of transport'), type: 'select', options: INCOTERM_MODES.map((m) => ({ value: m, label: t(INCOTERM_MODES_LABEL[m]) })) },
      { id: 'nameEn', label: t('Name (English)'), type: 'text' },
      { id: 'nameFr', label: t('Name (French)'), type: 'text' },
      { id: 'descriptionEn', label: t('Description (English)'), type: 'textarea' },
      { id: 'descriptionFr', label: t('Description (French)'), type: 'textarea' },
      ...INCOTERM_STEPS.map((k) => ({ id: `step_${k}`, label: t(INCOTERM_STEP_LABEL[k]), type: 'select' as const, options: party, defaultValue: 'buyer' })),
    ],
  };
}
