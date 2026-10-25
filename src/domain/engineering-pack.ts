// R-191 (Arche K-08; DIG-PRODI G2 criterion "engineering pack > 80 %"): EPC2i's share of the engineering pack of a project and
// its weighted % completeness, shown on the Engineering synthesis and published to the CAPEX application by the view
// pub_pack_ingenierie (migration 0060; docs/delivery-9/notes-r191-engineering-pack.md). Pure rules — no import of the server:
// the DAL (src/server/dal/engineering-pack.ts), the Server Functions, the Machine types and Engineering screens share them.
//
//   Families      a fixed code list, the five families of Arche's contract (pid, bom, layout, electrique,
//                 analyse_fonctionnelle) — extensible: a new code goes at the end of PACK_FAMILIES, of the database check
//                 (machine_type_pack_families_family_check, document_types_pack_family_check) and of the view's readers' list.
//   Standard list one row per machine type and family (machine_type_pack_families): weight (whole %, the type's weights total
//                 100 %) and the minimum number of documents expected. PROVISIONAL (owner, 25 Oct 2026): the five families at
//                 20 % each and one document expected per family, for every machine type, until the owner gives the real list
//                 (CDC point C-9); editable on the Standard machine types screen.
//   Mapping       a document of the Codex index counts in a family through its document type (document_types.pack_family,
//                 Keystone's classification of Codex's types): PID → pid, BOM → bom, GA → layout, SCH → electrique,
//                 FDS → analyse_fonctionnelle. Expected = the project's documents of the family, obsolete ones excluded, and at
//                 least the standard minimum; validated = those Released (BPE: the approval circuit is complete).
//   Formula       % = Σ weight × validated / expected ÷ Σ weight, over the families with something expected (re-normalised:
//                 a family with no document expected and a minimum of 0 does not count), rounded to 0.1; 0 when nothing is
//                 expected at all. With the provisional minimum of 1, a family without any document counts 0 % — the pack is
//                 measured against the standard list, not against what happens to be indexed. G2 target: above 80 %.
//   Multi-equipment (R-185) the families of the project are the union of those of its equipment lines' types (weight > 0); a
//                 family takes the weight of the main line's type (the first line), else of the first line whose type has it,
//                 and the highest minimum among the lines' types.

/** Arche's five families, in contract order (K-08). */
export const PACK_FAMILIES = ['pid', 'bom', 'layout', 'electrique', 'analyse_fonctionnelle'] as const;
export type PackFamily = (typeof PACK_FAMILIES)[number];
export const isPackFamily = (v: unknown): v is PackFamily => typeof v === 'string' && (PACK_FAMILIES as readonly string[]).includes(v);

/** EN source labels (t()). */
export const PACK_FAMILY_LABELS: Record<PackFamily, string> = {
  pid: 'P&ID',
  bom: 'Bill of materials',
  layout: 'Layout · machine plot plan',
  electrique: 'Electrical schematics & power balance',
  analyse_fonctionnelle: 'Functional analysis',
};

/** G2 target of DIG-PRODI (pack above 80 %). */
export const PACK_TARGET_PCT = 80;
/** Upper bound of a family's minimum number of expected documents. */
export const MAX_PACK_MIN_EXPECTED = 99;

/** One row of a machine type's standard list. */
export interface PackStandardRow {
  family: PackFamily;
  /** Whole percentage 0–100 (0 = the family is not in this type's pack). */
  weight: number;
  /** Documents expected at least, whatever is indexed. */
  minExpected: number;
}

/** The provisional standard list (owner, 25 Oct 2026, pending C-9): the five families, 20 % each, one document expected. */
export const PROVISIONAL_PACK: readonly PackStandardRow[] = PACK_FAMILIES.map((family) => ({ family, weight: 20, minExpected: 1 }));

/** Provisional mapping of Codex's document types to the families (document_types.pack_family). */
export const PACK_DOCUMENT_TYPES: Readonly<Record<string, PackFamily>> = { PID: 'pid', BOM: 'bom', GA: 'layout', SCH: 'electrique', FDS: 'analyse_fonctionnelle' };

/** Document statuses (codes of documentStatus) that count as validated: Released (BPE). */
export const PACK_VALIDATED_STATUSES: readonly string[] = ['released'];
/** Statuses that are not expected any more: a withdrawn (obsolete) record. */
export const PACK_EXCLUDED_STATUSES: readonly string[] = ['obsolete'];

export const PACK_WEIGHTS_ERROR = 'The weights of the engineering pack must total 100 %';
export const PACK_INVALID_ERROR = 'Each family needs a whole weight from 0 to 100 % and a minimum from 0 to 99';

/**
 * Validation of a type's standard list as typed: every family once, whole weights 0–100 totalling 100, whole minimums 0–99.
 * Returns the English refusal, or null.
 */
export function packStandardError(rows: readonly { family: unknown; weight: unknown; minExpected: unknown }[]): string | null {
  if (rows.length !== PACK_FAMILIES.length) return PACK_INVALID_ERROR;
  const seen = new Set<string>();
  for (const r of rows) {
    if (!isPackFamily(r.family) || seen.has(r.family)) return PACK_INVALID_ERROR;
    seen.add(r.family);
    if (typeof r.weight !== 'number' || !Number.isInteger(r.weight) || r.weight < 0 || r.weight > 100) return PACK_INVALID_ERROR;
    if (typeof r.minExpected !== 'number' || !Number.isInteger(r.minExpected) || r.minExpected < 0 || r.minExpected > MAX_PACK_MIN_EXPECTED) return PACK_INVALID_ERROR;
  }
  return packWeightTotal(rows as readonly PackStandardRow[]) === 100 ? null : PACK_WEIGHTS_ERROR;
}

export const packWeightTotal = (rows: readonly { weight: number }[]) => rows.reduce((s, r) => s + (Number.isFinite(r.weight) ? r.weight : 0), 0);

/** Rows in contract order, missing families at weight 0 (a type always shows the five families). */
export function normalisePackRows(rows: readonly PackStandardRow[]): PackStandardRow[] {
  return PACK_FAMILIES.map((family) => rows.find((r) => r.family === family) ?? { family, weight: 0, minExpected: 0 });
}

/**
 * The standard list of a project: its equipment lines' types in line order (the main line first), each with its rows. A family
 * is in the pack when one of the types weighs it; weight of the main type, else of the first line whose type has it; minimum =
 * the highest among those types.
 */
export function projectPackStandard(typesInLineOrder: readonly (readonly PackStandardRow[])[]): PackStandardRow[] {
  const out: PackStandardRow[] = [];
  for (const family of PACK_FAMILIES) {
    const having = typesInLineOrder.map((rows) => rows.find((r) => r.family === family)).filter((r): r is PackStandardRow => !!r && r.weight > 0);
    if (!having.length) continue;
    out.push({ family, weight: having[0].weight, minExpected: Math.max(...having.map((r) => r.minExpected)) });
  }
  return out;
}

/** A document of the project's Codex index counted by the pack (its type maps to a family). */
export interface PackDocument {
  family: PackFamily;
  /** documentStatus code. */
  status: string;
}

export interface PackFamilyResult {
  family: PackFamily;
  weight: number;
  expected: number;
  validated: number;
  /** validated / expected, 0–1 (0 when nothing is expected). */
  ratio: number;
}

export interface PackCompleteness {
  families: PackFamilyResult[];
  /** Weighted % 0–100, one decimal. */
  pct: number;
  /** Something is expected (the % means something). */
  measured: boolean;
  meetsTarget: boolean;
}

const round1 = (x: number) => Math.round(x * 10 + 1e-9) / 10;

/** The weighted completeness of a project's pack (same formula as pub_pack_ingenierie.pct_pondere). */
export function packCompleteness(standard: readonly PackStandardRow[], documents: readonly PackDocument[]): PackCompleteness {
  const families = standard.map((s) => {
    const mine = documents.filter((d) => d.family === s.family && !PACK_EXCLUDED_STATUSES.includes(d.status));
    const expected = Math.max(s.minExpected, mine.length);
    const validated = mine.filter((d) => PACK_VALIDATED_STATUSES.includes(d.status)).length;
    return { family: s.family, weight: s.weight, expected, validated, ratio: expected > 0 ? validated / expected : 0 };
  });
  const counted = families.filter((f) => f.expected > 0);
  const den = counted.reduce((s, f) => s + f.weight, 0);
  const pct = den > 0 ? round1((100 * counted.reduce((s, f) => s + f.weight * f.ratio, 0)) / den) : 0;
  return { families, pct, measured: den > 0, meetsTarget: den > 0 && pct > PACK_TARGET_PCT };
}
