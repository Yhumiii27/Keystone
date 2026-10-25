// R-158 lot A (owner's decision 9, 25 Oct 2026 — docs/delivery-9/cadrage-r158-expeditions.md § 5): the Incoterms, a reference
// table parameterisable in administration (Settings), seeded with the 11 Incoterms 2020 in both seeds. Each Incoterm splits the
// steps of a shipment between the seller (EPC2i) and the buyer (the client or the subsidiary); a shipment organises and tracks the
// seller's steps (decision 2). Pure module: no I/O, no translation (EN source labels; FR in src/i18n/extra/d9-shipments.json).
//
// Texts of an Incoterm (name, description) are reference data typed in two languages — columns `name_en` / `name_fr`,
// `description_en` / `description_fr` — shown in the viewer's language (`incotermText`), never through t(): an administrator
// may add or rewrite one, and both languages are his to write (docs/delivery-9/notes-r158-shipments.md § 3).

/** The steps of a shipment the Incoterm splits, in the order of the journey (EN source labels: `INCOTERM_STEP_LABEL`). */
export const INCOTERM_STEPS = [
  'export_packaging', 'loading_origin', 'export_clearance', 'pre_carriage', 'main_carriage', 'insurance',
  'unloading_destination', 'import_clearance', 'on_carriage', 'duties_taxes',
] as const;
export type IncotermStep = (typeof INCOTERM_STEPS)[number];
export const isIncotermStep = (v: unknown): v is IncotermStep => typeof v === 'string' && (INCOTERM_STEPS as readonly string[]).includes(v);

export const INCOTERM_STEP_LABEL: Record<IncotermStep, string> = {
  export_packaging: 'Export packaging',
  loading_origin: 'Loading at origin',
  export_clearance: 'Export clearance',
  pre_carriage: 'Pre-carriage',
  main_carriage: 'Main carriage',
  insurance: 'Insurance',
  unloading_destination: 'Unloading at destination',
  import_clearance: 'Import clearance',
  on_carriage: 'On-carriage · delivery to site',
  duties_taxes: 'Duties & taxes',
};

export type IncotermParty = 'seller' | 'buyer';
export const isIncotermParty = (v: unknown): v is IncotermParty => v === 'seller' || v === 'buyer';
export const INCOTERM_PARTY_LABEL: Record<IncotermParty, string> = { seller: 'Seller · EPC2i', buyer: 'Buyer' };

/** Who bears each step. */
export type IncotermSplit = Record<IncotermStep, IncotermParty>;

/** Transport modes an Incoterm applies to (Incoterms 2020): any mode, or sea and inland waterway only. */
export const INCOTERM_MODES = ['any', 'sea'] as const;
export type IncotermModes = (typeof INCOTERM_MODES)[number];
export const isIncotermModes = (v: unknown): v is IncotermModes => v === 'any' || v === 'sea';
export const INCOTERM_MODES_LABEL: Record<IncotermModes, string> = { any: 'Any mode of transport', sea: 'Sea and inland waterway' };

export interface IncotermDef {
  code: string;
  nameEn: string;
  nameFr: string;
  descriptionEn: string;
  descriptionFr: string;
  modes: IncotermModes;
  split: IncotermSplit;
}

/** A split from the 10 parties in `INCOTERM_STEPS` order ('S' seller, 'B' buyer). */
const split = (s: string): IncotermSplit => {
  const parts = s.split(' ');
  if (parts.length !== INCOTERM_STEPS.length) throw new Error(`Bad split ${s}`);
  return Object.fromEntries(INCOTERM_STEPS.map((k, i) => [k, parts[i] === 'S' ? 'seller' : 'buyer'])) as IncotermSplit;
};

/**
 * The 11 Incoterms 2020 (ICC). Split per step, in `INCOTERM_STEPS` order — packaging, loading, export clearance, pre-carriage,
 * main carriage, insurance, unloading at the named place, import clearance, on-carriage / delivery to site, duties & taxes.
 * Choices (docs/delivery-9/notes-r158-shipments.md § 3): export packaging is always the seller's; under FCA, FAS, FOB the seller
 * loads at its own premises and carries to the named place (pre-carriage); "insurance" is the party at risk during the main
 * carriage, an obligation only under CIF and CIP; "unloading at destination" is unloading at the named place of destination
 * (the seller's only under DPU); "on-carriage" is the delivery from the arrival point to the site (the seller's under the D rules).
 */
export const STANDARD_INCOTERMS: readonly IncotermDef[] = [
  {
    code: 'EXW', nameEn: 'Ex Works', nameFr: 'À l’usine', modes: 'any', split: split('S B B B B B B B B B'),
    descriptionEn: 'The seller makes the goods available at its premises, packed for export; the buyer loads them and bears every cost and risk from there, export clearance included.',
    descriptionFr: 'Le vendeur met la marchandise, emballée pour l’export, à disposition dans ses locaux ; l’acheteur la charge et supporte dès lors tous les frais et risques, dédouanement export compris.',
  },
  {
    code: 'FCA', nameEn: 'Free Carrier', nameFr: 'Franco transporteur', modes: 'any', split: split('S S S S B B B B B B'),
    descriptionEn: 'The seller clears the goods for export and hands them over to the buyer’s carrier at the named place; risk passes at hand-over.',
    descriptionFr: 'Le vendeur dédouane à l’export et remet la marchandise au transporteur de l’acheteur au lieu convenu ; le risque est transféré à la remise.',
  },
  {
    code: 'CPT', nameEn: 'Carriage Paid To', nameFr: 'Port payé jusqu’à', modes: 'any', split: split('S S S S S B B B B B'),
    descriptionEn: 'The seller contracts and pays the main carriage to the named destination; risk passes when the goods are handed to the first carrier.',
    descriptionFr: 'Le vendeur contracte et paie le transport principal jusqu’à la destination convenue ; le risque est transféré à la remise au premier transporteur.',
  },
  {
    code: 'CIP', nameEn: 'Carriage and Insurance Paid To', nameFr: 'Port payé, assurance comprise, jusqu’à', modes: 'any', split: split('S S S S S S B B B B'),
    descriptionEn: 'As CPT, and the seller insures the goods for the main carriage (all-risks cover, Institute Cargo Clauses A).',
    descriptionFr: 'Comme CPT, et le vendeur assure la marchandise pour le transport principal (garantie tous risques, clauses A).',
  },
  {
    code: 'DAP', nameEn: 'Delivered At Place', nameFr: 'Rendu au lieu de destination', modes: 'any', split: split('S S S S S S B B S B'),
    descriptionEn: 'The seller delivers the goods, ready for unloading, at the named place of destination; the buyer unloads, clears them for import and pays the duties.',
    descriptionFr: 'Le vendeur livre la marchandise, prête à être déchargée, au lieu de destination convenu ; l’acheteur décharge, dédouane à l’import et paie les droits.',
  },
  {
    code: 'DPU', nameEn: 'Delivered at Place Unloaded', nameFr: 'Rendu au lieu de destination déchargé', modes: 'any', split: split('S S S S S S S B S B'),
    descriptionEn: 'The seller delivers and unloads the goods at the named place of destination; the buyer clears them for import and pays the duties.',
    descriptionFr: 'Le vendeur livre et décharge la marchandise au lieu de destination convenu ; l’acheteur dédouane à l’import et paie les droits.',
  },
  {
    code: 'DDP', nameEn: 'Delivered Duty Paid', nameFr: 'Rendu droits acquittés', modes: 'any', split: split('S S S S S S B S S S'),
    descriptionEn: 'The seller delivers the goods at the named place, cleared for import with duties and taxes paid; the buyer unloads them.',
    descriptionFr: 'Le vendeur livre la marchandise au lieu convenu, dédouanée à l’import, droits et taxes acquittés ; l’acheteur la décharge.',
  },
  {
    code: 'FAS', nameEn: 'Free Alongside Ship', nameFr: 'Franco le long du navire', modes: 'sea', split: split('S S S S B B B B B B'),
    descriptionEn: 'The seller clears the goods for export and places them alongside the buyer’s vessel at the named port of shipment.',
    descriptionFr: 'Le vendeur dédouane à l’export et place la marchandise le long du navire de l’acheteur au port d’embarquement convenu.',
  },
  {
    code: 'FOB', nameEn: 'Free On Board', nameFr: 'Franco à bord', modes: 'sea', split: split('S S S S B B B B B B'),
    descriptionEn: 'The seller clears the goods for export and loads them on board the buyer’s vessel at the named port of shipment; risk passes on board.',
    descriptionFr: 'Le vendeur dédouane à l’export et charge la marchandise à bord du navire de l’acheteur au port d’embarquement convenu ; le risque est transféré à bord.',
  },
  {
    code: 'CFR', nameEn: 'Cost and Freight', nameFr: 'Coût et fret', modes: 'sea', split: split('S S S S S B B B B B'),
    descriptionEn: 'The seller pays the sea freight to the named port of destination; risk passes once the goods are on board at the port of shipment.',
    descriptionFr: 'Le vendeur paie le fret maritime jusqu’au port de destination convenu ; le risque est transféré dès la mise à bord au port d’embarquement.',
  },
  {
    code: 'CIF', nameEn: 'Cost, Insurance and Freight', nameFr: 'Coût, assurance et fret', modes: 'sea', split: split('S S S S S S B B B B'),
    descriptionEn: 'As CFR, and the seller insures the goods for the sea carriage (minimum cover, Institute Cargo Clauses C).',
    descriptionFr: 'Comme CFR, et le vendeur assure la marchandise pour le transport maritime (garantie minimale, clauses C).',
  },
];
export const STANDARD_INCOTERM_CODES: readonly string[] = STANDARD_INCOTERMS.map((i) => i.code);

/** An Incoterm code: three capital letters (the 11 of 2020, or one an administrator adds). */
export const INCOTERM_CODE_RE = /^[A-Z]{3}$/;
export const normaliseIncotermCode = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

/** Name / description in the viewer's language, falling back to the other language when one is empty. */
export const incotermText = (lang: 'en' | 'fr', en: string, fr: string) => (lang === 'fr' ? fr || en : en || fr);

/** A stored split read back: every step present with a known party, unknown or missing steps → the buyer's. */
export function readSplit(raw: unknown): IncotermSplit {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(INCOTERM_STEPS.map((k) => [k, isIncotermParty(o[k]) ? o[k] : 'buyer'])) as IncotermSplit;
}

/** The seller's steps of a split, in journey order. */
export const sellerSteps = (s: IncotermSplit): IncotermStep[] => INCOTERM_STEPS.filter((k) => s[k] === 'seller');

/** "S S S S B B …" — the split as the audit trail and the export record it. */
export const splitText = (s: IncotermSplit) => INCOTERM_STEPS.map((k) => (s[k] === 'seller' ? 'S' : 'B')).join(' ');

export const INCOTERM_NAME_MAX = 120;
export const INCOTERM_DESCRIPTION_MAX = 1000;
export const INCOTERM_PLACE_MAX = 120;

export interface IncotermInput {
  code: string;
  nameEn: string;
  nameFr: string;
  descriptionEn: string;
  descriptionFr: string;
  modes: IncotermModes;
  split: IncotermSplit;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * An Incoterm as an administrator enters it (Settings › Incoterms): code (three letters; unchanged on an edit), names and
 * descriptions in both languages (a name in at least one), modes, and a party for each of the 10 steps.
 */
export function parseIncoterm(values: Record<string, unknown>): Parsed<IncotermInput> {
  const text = (k: string) => (typeof values[k] === 'string' ? (values[k] as string).trim() : '');
  const code = normaliseIncotermCode(values.code);
  if (!INCOTERM_CODE_RE.test(code)) return { ok: false, error: 'An Incoterm code is three letters' };
  const nameEn = text('nameEn');
  const nameFr = text('nameFr');
  if (!nameEn && !nameFr) return { ok: false, error: 'Enter the Incoterm’s name' };
  if (nameEn.length > INCOTERM_NAME_MAX || nameFr.length > INCOTERM_NAME_MAX) return { ok: false, error: 'Text too long' };
  const descriptionEn = text('descriptionEn');
  const descriptionFr = text('descriptionFr');
  if (descriptionEn.length > INCOTERM_DESCRIPTION_MAX || descriptionFr.length > INCOTERM_DESCRIPTION_MAX) return { ok: false, error: 'Text too long' };
  if (!isIncotermModes(values.modes)) return { ok: false, error: 'Invalid request' };
  const out: Partial<IncotermSplit> = {};
  for (const k of INCOTERM_STEPS) {
    const v = values[`step_${k}`];
    if (!isIncotermParty(v)) return { ok: false, error: 'Invalid request' };
    out[k] = v;
  }
  return { ok: true, value: { code, nameEn, nameFr, descriptionEn, descriptionFr, modes: values.modes, split: out as IncotermSplit } };
}

/** Removing an Incoterm: an unused one an administrator added is deleted; a standard one, or one a contract uses, is deactivated. */
export const incotermRemoval = (v: { standard: boolean; usedBy: number }): 'deleted' | 'deactivated' => (v.standard || v.usedBy > 0 ? 'deactivated' : 'deleted');
