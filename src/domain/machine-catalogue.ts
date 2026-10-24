// Machine catalogue published to the subsidiaries (R-186, AC-4; framing docs/delivery-9/cadrage-r185-r186.md § 2, choice 5
// validated on 23 Oct 2026; contract K-01 of the CAPEX application, REQUESTS.md). Pure rules — no import of the server: the DAL
// (src/server/dal/machine-catalogue.ts), the Server Functions, the Machine types screen and the equipment line forms share them.
//
//   Entry      a machine type enriched for the subsidiaries: code ("EMP-40T"), variant, label, description, options (code, label,
//              indicative price k€), nominal capacity and unit, indicative price (class E50, k€), typical lead time (weeks).
//              The reference budget and the ITP template stay on the machine type (machine_type_code).
//   Versions   one row per code and version (1, 2…). A version is a draft until it is published; publishing freezes it for good
//              (content immutable — also enforced by a database trigger, migration 0046). Editing a published entry means
//              "New version": a draft copied from the latest version, numbered one after the highest.
//   Statuses   draft → published → retired. One draft and one published version at most per code (partial unique indexes):
//              publishing version n retires the code's published version (n − 1 or older) — it stays readable in
//              pub_catalogue_machines with statut 'retire', so a CAPEX need that chose it keeps it; the catalogue offers the
//              published version only. "Retire" takes the published version off the catalogue (the code is no longer offered
//              until a new version is published). A draft may be discarded (deleted: it was never shared).
//   Rights     the portfolio director and the engineering lead (choice 5); the other roles of the Machine types screen read.

import type { RoleKey } from '@/config/screens';

export type CatalogueStatus = 'draft' | 'published' | 'retired';
export const CATALOGUE_STATUSES: readonly CatalogueStatus[] = ['draft', 'published', 'retired'];
/** EN source labels (t()). */
export const CATALOGUE_STATUS_LABEL: Record<CatalogueStatus, string> = { draft: 'Draft', published: 'Published', retired: 'Retired' };
/** `statut` of pub_catalogue_machines (K-01): drafts are never published. */
export const CATALOGUE_SHARE_STATUS: Record<CatalogueStatus, 'publie' | 'retire' | null> = { draft: null, published: 'publie', retired: 'retire' };

/** Choice 5 (23 Oct 2026): the catalogue is edited by the portfolio director and the engineering lead. */
export const CATALOGUE_EDITORS: readonly RoleKey[] = ['director', 'englead'];
export const canEditCatalogue = (role: string) => (CATALOGUE_EDITORS as readonly string[]).includes(role);
export const CATALOGUE_EDITORS_ONLY = 'Only the director and the engineering lead edit the machine catalogue';

/** "EMP-40T", "MEMU-16", "SPUR-2X": upper-case letters, digits and dashes, starting with a letter or a digit. */
export const CATALOGUE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,29}$/;
export const OPTION_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
export const MAX_CATALOGUE_LABEL = 120;
export const MAX_CATALOGUE_VARIANT = 80;
export const MAX_CATALOGUE_DESCRIPTION = 2000;
export const MAX_CATALOGUE_OPTIONS = 20;
export const MAX_CATALOGUE_OPTION_LABEL = 120;
export const MAX_CATALOGUE_UNIT = 20;
export const MAX_LEAD_TIME_WEEKS = 520;
export const MAX_PRICE_KEUR = 1_000_000;

/** Code typed in "New catalogue entry": trimmed, upper-cased, spaces → "-". */
export const normaliseCatalogueCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '-');

/** An option as stored and published (K-01: `[{code, libelle, prix_indicatif_keur}]`). */
export interface CatalogueOption {
  code: string;
  libelle: string;
  prix_indicatif_keur: number | null;
}

/** The content of a version (what a draft edit sets and publication freezes). */
export interface CatalogueContent {
  variant: string | null;
  label: string;
  description: string | null;
  options: CatalogueOption[];
  nominalCapacity: number | null;
  capacityUnit: string | null;
  indicativePriceKeur: number | null;
  leadTimeWeeks: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);

/** A number typed in a form ("12,5", 12.5, ''): null when blank, NaN when not a number. */
function numberOf(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  return s === '' ? null : Number(s);
}

/**
 * Options typed one per line, "CODE | label | indicative price k€" (the price is optional): "TELE | Télécommande radio | 18".
 * An array of `{ code, libelle, prix_indicatif_keur }` is accepted as is (then validated the same way).
 */
export function parseCatalogueOptions(v: unknown): Parsed<CatalogueOption[]> {
  let raw: { code: unknown; libelle: unknown; prix: unknown }[];
  if (v == null || v === '') raw = [];
  else if (typeof v === 'string')
    raw = v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [code, libelle, prix] = l.split('|').map((x) => x.trim());
      return { code, libelle, prix };
    });
  else if (Array.isArray(v)) raw = v.map((o) => (o && typeof o === 'object' ? { code: o.code, libelle: o.libelle, prix: o.prix_indicatif_keur } : { code: null, libelle: null, prix: null }));
  else return { ok: false, error: 'Invalid catalogue options' };
  if (raw.length > MAX_CATALOGUE_OPTIONS) return { ok: false, error: `A catalogue entry has at most ${MAX_CATALOGUE_OPTIONS} options` };
  const out: CatalogueOption[] = [];
  for (const o of raw) {
    const code = typeof o.code === 'string' ? o.code.trim().toUpperCase() : '';
    const libelle = typeof o.libelle === 'string' ? o.libelle.trim() : '';
    if (!OPTION_CODE_RE.test(code) || !libelle || libelle.length > MAX_CATALOGUE_OPTION_LABEL)
      return { ok: false, error: 'An option reads “CODE | label | indicative price k€” (one per line)' };
    if (out.some((x) => x.code === code)) return { ok: false, error: 'Option codes must be distinct' };
    const prix = numberOf(o.prix ?? null);
    if (prix != null && (!Number.isFinite(prix) || prix < 0 || prix > MAX_PRICE_KEUR)) return { ok: false, error: 'An option price is a positive amount in k€' };
    out.push({ code, libelle, prix_indicatif_keur: prix == null ? null : Math.round(prix * 100) / 100 });
  }
  return { ok: true, value: out };
}

/** Options shown in the form's text area (one per line). */
export const catalogueOptionsText = (options: readonly CatalogueOption[]) =>
  options.map((o) => [o.code, o.libelle, ...(o.prix_indicatif_keur == null ? [] : [String(o.prix_indicatif_keur)])].join(' | ')).join('\n');

/** Validates the content of a draft (create or edit). Messages are English source strings. */
export function parseCatalogueContent(input: Record<string, unknown> | null | undefined): Parsed<CatalogueContent> {
  const v = input ?? {};
  const label = text(v.label);
  if (!label) return { ok: false, error: 'Label is required' };
  if (label.length > MAX_CATALOGUE_LABEL) return { ok: false, error: 'The label is too long' };
  const variant = text(v.variant);
  if (variant == null || variant.length > MAX_CATALOGUE_VARIANT) return { ok: false, error: 'The variant is too long' };
  const description = text(v.description);
  if (description == null || description.length > MAX_CATALOGUE_DESCRIPTION) return { ok: false, error: 'The description is too long' };
  const options = parseCatalogueOptions(v.options);
  if (!options.ok) return options;
  const cap = numberOf(v.nominalCapacity);
  if (cap != null && (!Number.isFinite(cap) || cap <= 0 || cap > 1e9)) return { ok: false, error: 'The nominal capacity is a positive number' };
  const unit = text(v.capacityUnit);
  if (unit == null || unit.length > MAX_CATALOGUE_UNIT) return { ok: false, error: 'The capacity unit is too long' };
  if (cap != null && !unit) return { ok: false, error: 'Enter the unit of the nominal capacity' };
  const price = numberOf(v.indicativePriceKeur);
  if (price != null && (!Number.isFinite(price) || price < 0 || price > MAX_PRICE_KEUR)) return { ok: false, error: 'The indicative price is a positive amount in k€' };
  const lead = numberOf(v.leadTimeWeeks);
  if (lead != null && (!Number.isInteger(lead) || lead < 1 || lead > MAX_LEAD_TIME_WEEKS))
    return { ok: false, error: `The typical lead time is a whole number of weeks from 1 to ${MAX_LEAD_TIME_WEEKS}` };
  return {
    ok: true,
    value: {
      variant: variant || null, label, description: description || null, options: options.value, nominalCapacity: cap,
      capacityUnit: cap != null ? unit : null, indicativePriceKeur: price == null ? null : Math.round(price * 100) / 100, leadTimeWeeks: lead,
    },
  };
}

/** What a draft still lacks to be published (the subsidiaries choose on price and lead time): [] = ready. */
export function publishBlockers(c: Pick<CatalogueContent, 'label' | 'indicativePriceKeur' | 'leadTimeWeeks'>): string[] {
  const out: string[] = [];
  if (!c.label.trim()) out.push('Label is required');
  if (c.indicativePriceKeur == null) out.push('Enter the indicative price before publishing');
  if (c.leadTimeWeeks == null) out.push('Enter the typical lead time before publishing');
  return out;
}

export type CatalogueAction = 'edit' | 'publish' | 'retire' | 'discard' | 'newVersion';

/** A version as the rules read it. */
export interface CatalogueVersionState {
  version: number;
  status: CatalogueStatus;
}

/** The next version number of a code: one after the highest (a discarded draft's number may come back: it was never shared). */
export const nextCatalogueVersion = (versions: readonly { version: number }[]) => versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;

/** The latest version of a code (highest number), or null. */
export const latestVersion = <V extends { version: number }>(versions: readonly V[]): V | null =>
  versions.reduce<V | null>((m, v) => (!m || v.version > m.version ? v : m), null);

/**
 * Whether `action` applies to version `v` of a code whose versions are `all` (`v` null for "New version" on the code). Returns
 * the refusal (an English source string) or null. Publication and immutability: only a draft is edited, published or discarded;
 * only the published version is retired; a new version needs no draft pending.
 */
export function catalogueActionBlocker(action: CatalogueAction, v: CatalogueVersionState | null, all: readonly CatalogueVersionState[]): string | null {
  if (action === 'newVersion') return all.some((x) => x.status === 'draft') ? 'This entry already has a draft version' : null;
  if (!v) return 'Unknown catalogue version';
  if (action === 'retire') return v.status === 'published' ? null : 'Only the published version can be retired';
  if (v.status !== 'draft') return 'A published version is frozen: create a new version';
  return null;
}

/**
 * Publication of draft `v`: the versions that become retired — the code's published version, superseded (at most one by the
 * partial unique index, any older one tolerated).
 */
export const supersededBy = (v: CatalogueVersionState, all: readonly CatalogueVersionState[]) =>
  all.filter((x) => x.status === 'published' && x.version !== v.version).map((x) => x.version);

/** "EMP-40T v2". */
export const catalogueRef = (code: string, version: number) => `${code} v${version}`;

/** A catalogue choice in an equipment line form: '' (none) or "EMP-40T@2". */
export const catalogueChoiceValue = (code: string, version: number) => `${code}@${version}`;

export function parseCatalogueChoice(v: unknown): Parsed<{ code: string; version: number } | null> {
  if (v == null || v === '') return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: 'Unknown catalogue entry' };
  const m = /^([A-Z0-9][A-Z0-9-]{1,29})@([1-9][0-9]{0,4})$/.exec(v.trim());
  return m ? { ok: true, value: { code: m[1], version: Number(m[2]) } } : { ok: false, error: 'Unknown catalogue entry' };
}

/**
 * An equipment line may reference version (code, version) of the catalogue when that version is published — or, on an edit, when
 * it is the line's current reference (a retired version stays on the lines that chose it) — and is of the line's machine type.
 */
export function catalogueChoiceBlocker(
  choice: { code: string; version: number } | null,
  entry: { status: CatalogueStatus; machineTypeCode: string } | null,
  lineType: string,
  current?: { code: string | null; version: number | null },
): string | null {
  if (!choice) return null;
  if (!entry || entry.status === 'draft') return 'Unknown catalogue entry';
  const kept = current?.code === choice.code && current?.version === choice.version;
  if (entry.status !== 'published' && !kept) return 'This catalogue version is retired';
  if (entry.machineTypeCode !== lineType) return 'The catalogue entry is of another machine type';
  return null;
}
