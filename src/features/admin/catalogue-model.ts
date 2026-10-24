// View model of the machine catalogue section of the Machine types screen (R-186, AC-4): the catalogue codes of the selected
// machine type, each with its versions (latest first), status, content and the actions the viewer may take. Built from the DAL
// rows with the pure rules of src/domain/machine-catalogue.ts; typed text (label, variant, description, option labels) as typed
// (dataText), Keystone's vocabulary through t().
import type { FormDef, FormValues } from '@/components/app/form-def';
import {
  CATALOGUE_STATUS_LABEL, catalogueActionBlocker, catalogueOptionsText, catalogueRef, publishBlockers, type CatalogueStatus,
} from '@/domain/machine-catalogue';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { CatalogueEntryRow } from '@/server/dal/machine-catalogue';

export interface CatalogueVersionView {
  code: string;
  version: number;
  /** "EMP-40T v2". */
  ref: string;
  status: CatalogueStatus;
  statusText: string;
  tone: 'outline' | 'accent' | 'neutral';
  label: string;
  variant: string | null;
  description: string | null;
  capacity: string;
  price: string;
  leadTime: string;
  options: { code: string; label: string; price: string }[];
  /** "Published 23 Oct 2026" / "Retired …" / "Updated …". */
  stamp: string;
  /** "Chosen by 2 equipment lines", null when none. */
  usedBy: string | null;
  canEdit: boolean;
  canPublish: boolean;
  /** Why the draft cannot be published yet (translated), else null. */
  publishBlocker: string | null;
  canRetire: boolean;
  canDiscard: boolean;
  /** The edit form's values (drafts). */
  values: FormValues;
}

export interface CatalogueEntryView {
  code: string;
  versions: CatalogueVersionView[];
  canNewVersion: boolean;
}

export interface CatalogueView {
  entries: CatalogueEntryView[];
  canEdit: boolean;
  /** "2 entries · 1 published" sub-line. */
  sub: string;
}

const TONE: Record<CatalogueStatus, CatalogueVersionView['tone']> = { draft: 'outline', published: 'accent', retired: 'neutral' };

/** `rows` = the catalogue versions of one machine type; `canEdit` = director or engineering lead in the workspace. */
export function catalogueView(rows: CatalogueEntryRow[], canEdit: boolean, t: T, lang: Lang): CatalogueView {
  const nf = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 2 });
  const day = (iso: string) => new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(iso));
  const codes = [...new Set(rows.map((r) => r.code))];
  const entries = codes.map((code) => {
    const all = rows.filter((r) => r.code === code).sort((a, b) => b.version - a.version);
    const states = all.map((r) => ({ version: r.version, status: r.status }));
    const versions = all.map((r): CatalogueVersionView => {
      const st = { version: r.version, status: r.status };
      const missing = r.status === 'draft' ? publishBlockers(r) : [];
      return {
        code, version: r.version, ref: catalogueRef(code, r.version), status: r.status, statusText: t(CATALOGUE_STATUS_LABEL[r.status]), tone: TONE[r.status],
        label: dataText(r.label, lang), variant: r.variant ? dataText(r.variant, lang) : null, description: r.description ? dataText(r.description, lang) : null,
        capacity: r.nominalCapacity == null ? '—' : `${nf.format(r.nominalCapacity)} ${r.capacityUnit ?? ''}`.trim(),
        price: r.indicativePriceKeur == null ? '—' : money(r.indicativePriceKeur, lang),
        leadTime: r.leadTimeWeeks == null ? '—' : `${r.leadTimeWeeks} ${t(r.leadTimeWeeks > 1 ? 'weeks' : 'week')}`,
        options: r.options.map((o) => ({ code: o.code, label: dataText(o.libelle, lang), price: o.prix_indicatif_keur == null ? '—' : money(o.prix_indicatif_keur, lang) })),
        stamp: r.status === 'published' && r.publishedAt
          ? `${t('Published')} ${day(r.publishedAt)}`
          : r.status === 'retired' && r.retiredAt
            ? `${t('Retired')} ${day(r.retiredAt)}`
            : `${t('Updated')} ${day(r.updatedAt)}`,
        usedBy: r.projectLines ? `${t('Equipment lines')} · ${r.projectLines}` : null,
        canEdit: canEdit && !catalogueActionBlocker('edit', st, states),
        canPublish: canEdit && !catalogueActionBlocker('publish', st, states),
        publishBlocker: missing.length ? t(missing[0]) : null,
        canRetire: canEdit && !catalogueActionBlocker('retire', st, states),
        canDiscard: canEdit && !catalogueActionBlocker('discard', st, states),
        values: {
          variant: r.variant ?? '', label: r.label, description: r.description ?? '', nominalCapacity: r.nominalCapacity == null ? '' : String(r.nominalCapacity),
          capacityUnit: r.capacityUnit ?? '', indicativePriceKeur: r.indicativePriceKeur == null ? '' : String(r.indicativePriceKeur),
          leadTimeWeeks: r.leadTimeWeeks == null ? '' : String(r.leadTimeWeeks), options: catalogueOptionsText(r.options),
        },
      };
    });
    return { code, versions, canNewVersion: canEdit && !catalogueActionBlocker('newVersion', null, states) };
  });
  const published = rows.filter((r) => r.status === 'published').length;
  return { entries, canEdit, sub: `${t('Catalogue entries')} · ${codes.length} · ${t('Published')} · ${published}` };
}

/** The content fields of a catalogue version (New catalogue entry adds the code). */
function contentFields(t: T): FormDef['fields'] {
  return [
    { id: 'label', label: t('Label'), type: 'text', required: true, span: 'full' },
    { id: 'variant', label: t('Variant'), type: 'text', placeholder: t('Optional') },
    { id: 'nominalCapacity', label: t('Nominal capacity'), type: 'number', placeholder: t('Optional') },
    { id: 'capacityUnit', label: t('Capacity unit'), type: 'text', placeholder: 't, t/h, m³…' },
    { id: 'indicativePriceKeur', label: t('Indicative price (k€, class E50)'), type: 'number' },
    { id: 'leadTimeWeeks', label: t('Typical lead time (weeks)'), type: 'number' },
    { id: 'description', label: t('Description'), type: 'textarea' },
    { id: 'options', label: t('Options — one per line: CODE | label | indicative price k€'), type: 'textarea', placeholder: 'TELE | Télécommande radio | 18' },
  ];
}

/** "New catalogue entry" on the selected machine type. */
export const newCatalogueEntryForm = (t: T): FormDef => ({
  title: t('New catalogue entry'), submit: t('Create draft'),
  fields: [{ id: 'code', label: t('Catalogue code'), type: 'text', required: true, placeholder: 'EMP-40T' }, ...contentFields(t)],
});

/** "Edit draft" of a version. */
export const editCatalogueDraftForm = (t: T, ref: string): FormDef => ({ title: `${t('Edit draft')} ${ref}`, submit: t('Save'), fields: contentFields(t) });
