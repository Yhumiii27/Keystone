// View model of the Machine catalogue screen (R-186, AC-4; owner, 25 Oct 2026: the catalogue has its own section and screen):
// - `catalogueScreenView`: KPI tiles, the Machine type and Status filters (URL state), the list of every catalogue entry (one row
//   per code: its current version — the published one, else the latest) and the selected entry, with, read-only, the rows
//   published to the CAPEX application (pub_catalogue_machines) and the projects' equipment lines that chose each version;
// - `catalogueView`: the versions of entries (latest first), status, content and the actions the viewer may take.
// Built from the DAL rows with the pure rules of src/domain/machine-catalogue.ts; typed text (label, variant, description,
// option labels, project names) as typed (dataText), Keystone's vocabulary through t().
import type { FormDef, FormValues } from '@/components/app/form-def';
import {
  CATALOGUE_EDITORS_ONLY, CATALOGUE_STATUS_LABEL, catalogueActionBlocker, catalogueOptionsText, catalogueRef, publishBlockers, type CatalogueStatus,
} from '@/domain/machine-catalogue';
import { screenHref } from '@/config/screens';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { CatalogueEntryRow, CataloguePublicationRow, CatalogueUseRow } from '@/server/dal/machine-catalogue';
import { catalogueHref, type CatalogueStatusFilter } from './links';

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

/** "New catalogue entry": the machine type (active types; fixed for every version of the code), the code and the content. */
export const newCatalogueEntryForm = (t: T, types: { code: string; label: string }[], type?: string | null): FormDef => ({
  title: t('New catalogue entry'), submit: t('Create draft'),
  fields: [
    {
      id: 'machineType', label: t('Machine type'), type: 'select', required: true, options: types.map((m) => ({ value: m.code, label: m.label })),
      defaultValue: type && types.some((m) => m.code === type) ? type : undefined,
    },
    { id: 'code', label: t('Catalogue code'), type: 'text', required: true, placeholder: 'EMP-40T' },
    ...contentFields(t),
  ],
});

/** "Edit draft" of a version. */
export const editCatalogueDraftForm = (t: T, ref: string): FormDef => ({ title: `${t('Edit draft')} ${ref}`, submit: t('Save'), fields: contentFields(t) });

// ── Machine catalogue screen ─────────────────────────────────────────────────────────────────────────────

/**
 * State of a catalogue code for the list and the Status filter: `published` = a version is offered to the subsidiaries;
 * `retired` = none offered, at least one retired; `draft` = only a draft (never published). `hasDraft` = a draft version is in
 * progress (EMP-40T: published, v2 draft) — the "Draft" filter keeps every code with a draft.
 */
export function entryState(versions: readonly { status: CatalogueStatus }[]): { state: CatalogueStatus; hasDraft: boolean } {
  const hasDraft = versions.some((v) => v.status === 'draft');
  const state: CatalogueStatus = versions.some((v) => v.status === 'published') ? 'published' : versions.some((v) => v.status === 'retired') ? 'retired' : 'draft';
  return { state, hasDraft };
}

const matchesStatus = (f: CatalogueStatusFilter, e: { state: CatalogueStatus; hasDraft: boolean }) => f === 'all' || (f === 'draft' ? e.hasDraft : e.state === f);

export interface CatalogueState {
  /** Machine type code (stored), or null = all types. */
  type: string | null;
  status: CatalogueStatusFilter;
  /** Selected catalogue code (`?entry=`), null = the first listed. */
  entry: string | null;
}

export interface CatalogueListRow {
  code: string;
  typeLabel: string;
  variant: string;
  label: string;
  /** "v1" — the published version, else the latest. */
  current: string;
  statusText: string;
  tone: CatalogueVersionView['tone'];
  /** "v2 · Draft" when a draft is in progress beside a published or retired version. */
  draftNote: string | null;
  price: string;
  leadTime: string;
  updated: string;
  href: string;
  selected: boolean;
}

export interface CatalogueDetailView {
  code: string;
  typeCode: string;
  typeLabel: string;
  entry: CatalogueEntryView;
  /** Rows of pub_catalogue_machines for this code (what the CAPEX application reads), latest version first. */
  publication: { ref: string; statut: 'publie' | 'retire'; tone: CatalogueVersionView['tone']; majLe: string }[];
  /** Projects' equipment lines that chose a version of this code. */
  uses: { ref: string; project: string; line: string; quantity: number; projectHref: string }[];
}

export interface CatalogueScreenView {
  kpis: { label: string; value: string; sub: string }[];
  typeChips: { value: string; label: string; count: number; href: string }[];
  typeValue: string;
  statusChips: { value: CatalogueStatusFilter; label: string; count: number; href: string }[];
  status: CatalogueStatusFilter;
  rows: CatalogueListRow[];
  detail: CatalogueDetailView | null;
  canEdit: boolean;
  /** The other roles of the screen (PM, quality) read: why they cannot edit. */
  readNote: string | null;
}

export const CATALOGUE_STATUS_FILTER_LABEL: Record<CatalogueStatusFilter, string> = { all: 'All', published: 'Published', draft: 'Draft', retired: 'Retired' };

export interface CatalogueScreenInput {
  rows: CatalogueEntryRow[];
  /** Machine types (stored code + display code), registry order. */
  types: { code: string; label: string }[];
  publication: CataloguePublicationRow[];
  uses: CatalogueUseRow[];
  state: CatalogueState;
  /** Director or engineering lead inside the workspace. */
  canEdit: boolean;
  /** Inside the workspace but not an editor (PM, quality): the read note. */
  readsOnly: boolean;
}

export function catalogueScreenView(input: CatalogueScreenInput, t: T, lang: Lang): CatalogueScreenView {
  const { rows, state } = input;
  const day = (iso: string) => new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(iso));
  const codes = [...new Set(rows.map((r) => r.code))];
  const entries = codes.map((code) => {
    const all = rows.filter((r) => r.code === code).sort((a, b) => b.version - a.version);
    const current = all.find((r) => r.status === 'published') ?? all[0];
    const updatedAt = all.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), all[0].updatedAt);
    return { code, all, current, updatedAt, typeCode: all[0].machineTypeCode, typeLabel: all[0].typeLabel, ...entryState(all) };
  });
  const type = state.type && input.types.some((m) => m.code === state.type) ? state.type : null;
  const byType = entries.filter((e) => !type || e.typeCode === type);
  const listed = byType.filter((e) => matchesStatus(state.status, e));
  const selected = listed.find((e) => e.code === state.entry) ?? listed[0] ?? null;
  const href = (q: Partial<CatalogueState>) => catalogueHref({ type, status: state.status, entry: null, ...q });

  const typeChips = [
    { value: 'all', label: t('All'), count: entries.length, href: href({ type: null }) },
    ...input.types.filter((m) => entries.some((e) => e.typeCode === m.code)).map((m) => ({
      value: m.code, label: m.label, count: entries.filter((e) => e.typeCode === m.code).length, href: href({ type: m.code }),
    })),
  ];
  const statusChips = (['all', 'published', 'draft', 'retired'] as CatalogueStatusFilter[]).map((v) => ({
    value: v, label: t(CATALOGUE_STATUS_FILTER_LABEL[v]), count: byType.filter((e) => matchesStatus(v, e)).length, href: href({ status: v }),
  }));

  const list: CatalogueListRow[] = listed.map((e) => {
    const c = e.current;
    const draft = e.state !== 'draft' ? e.all.find((r) => r.status === 'draft') : undefined;
    return {
      code: e.code, typeLabel: e.typeLabel, variant: c.variant ? dataText(c.variant, lang) : '—', label: dataText(c.label, lang), current: `v${c.version}`,
      statusText: t(CATALOGUE_STATUS_LABEL[e.state]), tone: TONE[e.state], draftNote: draft ? `v${draft.version} · ${t('Draft')}` : null,
      price: c.indicativePriceKeur == null ? '—' : money(c.indicativePriceKeur, lang),
      leadTime: c.leadTimeWeeks == null ? '—' : `${c.leadTimeWeeks} ${t(c.leadTimeWeeks > 1 ? 'weeks' : 'week')}`,
      updated: day(e.updatedAt), href: href({ entry: e.code }), selected: e.code === selected?.code,
    };
  });

  const detail: CatalogueDetailView | null = selected
    ? {
        code: selected.code, typeCode: selected.typeCode, typeLabel: selected.typeLabel,
        entry: catalogueView(selected.all, input.canEdit, t, lang).entries[0],
        publication: input.publication.filter((p) => p.code === selected.code).sort((a, b) => b.version - a.version).map((p) => ({
          ref: catalogueRef(p.code, p.version), statut: p.statut, tone: p.statut === 'publie' ? TONE.published : TONE.retired, majLe: day(p.majLe),
        })),
        uses: input.uses.filter((u) => u.code === selected.code).map((u) => ({
          ref: catalogueRef(u.code, u.version), project: u.projectName ? `${u.projectCode} · ${dataText(u.projectName, lang)}` : u.projectCode,
          line: u.ref, quantity: u.quantity, projectHref: screenHref('contract', { code: u.projectCode }),
        })),
      }
    : null;

  return {
    kpis: [
      { label: t('Catalogue entries'), value: String(entries.length), sub: `${t('Machine types')} · ${new Set(entries.map((e) => e.typeCode)).size}` },
      { label: t('Offered to the subsidiaries'), value: String(entries.filter((e) => e.state === 'published').length), sub: t('One published version per entry') },
      { label: t('Drafts in progress'), value: String(entries.filter((e) => e.hasDraft).length), sub: t('Not shared until published') },
      { label: t('Retired versions'), value: String(rows.filter((r) => r.status === 'retired').length), sub: t('Kept for the needs that chose them') },
      { label: t('Equipment lines'), value: String(input.uses.length), sub: t('Project lines that chose a version') },
    ],
    typeChips, typeValue: type ?? 'all', statusChips, status: state.status, rows: list, detail, canEdit: input.canEdit,
    readNote: input.readsOnly ? t(CATALOGUE_EDITORS_ONLY) : null,
  };
}
