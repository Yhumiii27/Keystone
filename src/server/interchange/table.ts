// Excel / CSV table imports (chapter 4, Activity & integrations › Imports): budget lines, project BOM, parts catalogue and
// resource assignments. Pure: decoding (UTF-8 or Windows-1252), CSV parsing (separator detection, RFC 4180 quotes), header
// detection, column auto-mapping (EN / FR synonyms), number parsing (decimal comma or point) and the per-kind normalisation
// of one row (required fields, numbers, codes). The database checks (unknown activity, part not in the catalogue, matching on
// the key) are in ./table-import.ts.
import { makeT } from '@/i18n/translate';
import { bomScope, costType, partMakeBuy, partStatus, partType, partFamily, PART_FAMILY_TYPE, type BomScope, type CostType, type PartMakeBuy, type PartStatus, type PartType, type PartUnit, type WearSpare } from '@/server/db/codes';
import { fmt } from './messages';
import { MAX_IMPORT_ROWS, clip } from './model';

export type TableKind = 'budget_lines' | 'bom' | 'parts' | 'assignments';
export const TABLE_KINDS: readonly TableKind[] = ['budget_lines', 'bom', 'parts', 'assignments'];
export const isTableKind = (v: unknown): v is TableKind => typeof v === 'string' && (TABLE_KINDS as readonly string[]).includes(v);
/** Kinds whose rows belong to a project (the parts catalogue is company-wide). */
export const PROJECT_TABLE_KINDS: readonly TableKind[] = ['budget_lines', 'bom', 'assignments'];

export type FieldType = 'text' | 'number' | 'integer';

export interface TableField {
  key: string;
  /** EN source label (column of the mapping step). */
  label: string;
  required: boolean;
  type: FieldType;
  /** Normalised header synonyms (EN and FR), exact match first, then "contains". */
  synonyms: string[];
}

const F = (key: string, label: string, type: FieldType, required: boolean, synonyms: string[]): TableField => ({ key, label, type, required, synonyms });

/** Target fields per kind, in mapping order. The first field of each kind is its matching key. */
export const TABLE_FIELDS: Readonly<Record<TableKind, readonly TableField[]>> = {
  budget_lines: [
    F('code', 'Code', 'text', false, ['code', 'category code', 'code categorie', 'cat code', 'n', 'no', 'numero']),
    F('name', 'Category', 'text', true, ['category', 'categorie', 'cost category', 'categorie de couts', 'budget line', 'ligne budgetaire', 'line', 'ligne', 'name', 'nom', 'libelle', 'designation', 'description', 'poste']),
    F('costType', 'Type', 'text', true, ['type', 'cost type', 'type de cout', 'nature', 'cost nature']),
    F('budget', 'Budget (k€)', 'number', true, ['budget', 'budget k', 'budget keur', 'budget k eur', 'montant', 'amount', 'bac', 'budget initial']),
    F('actual', 'Actual (k€)', 'number', false, ['actual', 'actuals', 'actual k', 'reel', 'realise', 'depense', 'depenses', 'ac']),
    F('committed', 'Committed (k€)', 'number', false, ['committed', 'commitment', 'commitments', 'engage', 'engagements', 'engagement']),
    F('forecast', 'Forecast (k€)', 'number', false, ['forecast', 'eac', 'prevision', 'previsions', 'estimate at completion', 'atterrissage', 'reste a faire plus realise']),
  ],
  bom: [
    F('ref', 'Reference', 'text', true, ['reference', 'ref', 'article', 'part', 'part number', 'pn', 'item', 'code article', 'numero article', 'part ref', 'ref article']),
    F('quantity', 'Quantity', 'number', true, ['quantity', 'qty', 'qte', 'quantite', 'qt', 'nombre']),
    F('activity', 'Activity ID', 'text', false, ['activity', 'activity id', 'activite', 'code activite', 'task', 'tache', 'activity code']),
    F('scope', 'Scope', 'text', false, ['scope', 'perimetre', 'supply', 'fourniture', 'supplied by', 'fourni par']),
    F('note', 'Note', 'text', false, ['note', 'notes', 'comment', 'comments', 'commentaire', 'commentaires', 'remarque', 'remarks']),
  ],
  parts: [
    F('ref', 'Reference', 'text', true, ['reference', 'ref', 'article', 'part', 'part number', 'pn', 'item', 'code article', 'numero article', 'part ref', 'ref article']),
    F('name', 'Designation', 'text', true, ['designation', 'name', 'description', 'libelle', 'nom', 'denomination']),
    F('type', 'Type', 'text', false, ['type', 'part type', 'category', 'categorie', 'family', 'famille', 'type article']),
    F('makeBuy', 'Make / buy', 'text', false, ['make buy', 'make or buy', 'fabrique achete', 'fabrication achat', 'origin', 'origine', 'mb']),
    F('unit', 'Unit of measure', 'text', false, ['unit', 'unite', 'uom', 'unit of measure', 'unite de mesure']),
    F('price', 'Unit price (€)', 'number', false, ['unit price', 'list price', 'price', 'prix', 'prix unitaire', 'pu', 'price eur', 'prix eur', 'tarif']),
    F('supplier', 'Supplier', 'text', false, ['supplier', 'manufacturer', 'fournisseur', 'fabricant', 'mfr', 'vendor', 'constructeur']),
    F('manufacturerRef', 'Manufacturer ref.', 'text', false, ['manufacturer ref', 'mfr ref', 'manufacturer reference', 'reference fabricant', 'ref fabricant', 'drawing', 'plan', 'ref constructeur']),
    F('hsCode', 'HS code', 'text', false, ['hs code', 'hs', 'customs code', 'code douanier', 'nomenclature douaniere', 'taric', 'code sh']),
    F('leadWeeks', 'Lead time (weeks)', 'integer', false, ['lead time', 'lead time weeks', 'lead weeks', 'delai', 'delai semaines', 'delai d approvisionnement', 'lt']),
    F('revision', 'Revision', 'text', false, ['revision', 'rev', 'indice']),
    F('status', 'Status', 'text', false, ['status', 'statut', 'etat']),
    F('wearSpare', 'Wear / spare', 'text', false, ['wear spare', 'pu pr', 'usure rechange', 'wear', 'spare', 'piece d usure']),
  ],
  assignments: [
    F('activity', 'Activity ID', 'text', true, ['activity', 'activity id', 'activite', 'code activite', 'task', 'tache', 'activity code']),
    F('resource', 'Resource', 'text', true, ['resource', 'ressource', 'resource name', 'nom ressource', 'person', 'personne', 'crew', 'equipe', 'name', 'nom']),
    F('detail', 'Detail', 'text', false, ['detail', 'details', 'description', 'role', 'skill', 'competence', 'fonction']),
    F('count', 'Resource count', 'number', false, ['units', 'resource count', 'count', 'nombre', 'headcount', 'effectif', 'quantite', 'qty']),
    F('hoursPerDay', 'Hours per day', 'number', false, ['hours per day', 'hours day', 'h d', 'h per day', 'heures par jour', 'heures jour', 'hpd', 'h jour']),
    F('plannedHours', 'Planned hours', 'number', false, ['planned hours', 'planned', 'budget hours', 'budgeted hours', 'work', 'travail', 'heures prevues', 'heures planifiees', 'target hours', 'hours', 'heures']),
    F('actualHours', 'Actual hours', 'number', false, ['actual hours', 'actual', 'actual work', 'heures reelles', 'realise', 'heures realisees', 'spent', 'consomme']),
  ],
};

// ── Text decoding and CSV ─────────────────────────────────────────────────────────────────────────────────────────────
/** UTF-8 (BOM removed), or Windows-1252 when the bytes are not valid UTF-8 (Excel's "CSV" in French Windows). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Separator of a CSV text: the most frequent of ';', ',', tab in the first lines (outside quotes). */
export function detectSeparator(text: string): ';' | ',' | '\t' {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n').replace(/"[^"]*"/g, '');
  const count = (c: string) => sample.split(c).length - 1;
  const counts: [';' | ',' | '\t', number][] = [[';', count(';')], ['\t', count('\t')], [',', count(',')]];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

/** RFC 4180 CSV → rows of cells (quotes, doubled quotes, separators and line breaks inside quotes). */
export function parseCsv(text: string, sep: string = detectSeparator(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > MAX_IMPORT_ROWS + 20) break;
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ── Header and mapping ────────────────────────────────────────────────────────────────────────────────────────────────
/** "Budget (k€)" → "budget k"; "Quantité" → "quantite". */
export function normHeader(v: unknown): string {
  return String(v ?? '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/€/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type Cell = string | number | boolean | null | undefined;

/** Column names of a header row, made unique ("Name", "Name (2)") and never blank ("Column C"). */
export function columnNames(header: readonly Cell[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h, i) => {
    let name = String(h ?? '').replace(/\s+/g, ' ').trim() || `Column ${columnLetter(i)}`;
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

export const columnLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : columnLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

const matchScore = (field: TableField, header: string): number => {
  const h = normHeader(header);
  if (!h) return 0;
  if (field.synonyms.includes(h)) return 3;
  if (normHeader(field.label) === h) return 3;
  if (field.synonyms.some((s) => s.length > 2 && (h.startsWith(s + ' ') || h.endsWith(' ' + s)))) return 2;
  if (field.synonyms.some((s) => s.length > 3 && h.includes(s))) return 1;
  return 0;
};

/** Index of the header row among the first rows: the one whose cells match the most target fields (default 0). */
export function detectHeaderRow(rows: readonly (readonly Cell[])[], kind: TableKind): number {
  let best = 0;
  let bestScore = 0;
  rows.slice(0, 10).forEach((r, i) => {
    const score = TABLE_FIELDS[kind].filter((f) => r.some((c) => typeof c === 'string' && matchScore(f, c) > 0)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** Proposed mapping target field → column name (null = not mapped): best synonym match, each column used once. */
export function autoMapping(columns: readonly string[], kind: TableKind): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  const candidates: { field: string; column: string; score: number; order: number }[] = [];
  TABLE_FIELDS[kind].forEach((f, order) => {
    for (const c of columns) {
      const score = matchScore(f, c);
      if (score) candidates.push({ field: f.key, column: c, score, order });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  for (const f of TABLE_FIELDS[kind]) out[f.key] = null;
  for (const c of candidates) {
    if (out[c.field] || used.has(c.column)) continue;
    out[c.field] = c.column;
    used.add(c.column);
  }
  return out;
}

/** Validates a mapping sent by the client: known fields, existing columns, required fields mapped. EN error or null. */
export function mappingError(kind: TableKind, columns: readonly string[], mapping: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(mapping)) {
    if (!TABLE_FIELDS[kind].some((f) => f.key === k)) return 'Invalid request';
    if (v != null && v !== '' && (typeof v !== 'string' || !columns.includes(v))) return 'Invalid request';
  }
  const missing = TABLE_FIELDS[kind].find((f) => f.required && !mapping[f.key]);
  return missing ? fmt('{0} is required', missing.label) : null;
}

// ── Values ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Number of a cell: numbers as they are; texts with spaces as thousands separators, a decimal comma or point, currency and
 * unit signs ("1 234,5 k€", "1,234.50", "12 %"). `decimal` is the file's decimal sign when known (CSV ';' → ',').
 */
export function parseNumberCell(v: Cell, decimal: ',' | '.' | null = null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v == null) return null;
  let s = String(v).replace(/[\s  ']/g, '').replace(/k?€|eur|\$|%|h$/gi, '').replace(/^\((.*)\)$/, '-$1').replace(/−/g, '-');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (hasComma) s = /^-?\d{1,3}(,\d{3})+$/.test(s) && decimal === '.' ? s.replace(/,/g, '') : s.replace(/,/g, (m, i) => (i === s.lastIndexOf(',') ? '.' : ''));
  else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s) && decimal === ',') s = s.replace(/\./g, '');
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const textOf = (v: Cell) => (v == null ? '' : typeof v === 'number' ? String(v) : String(v).replace(/\s+/g, ' ').trim());

/** Code of a label in EN or FR (through the prototype dictionary), or of the code itself; null when unknown. */
function codeOfLabel<C extends string>(v: string, codes: readonly C[], labelOf: (c: C) => string, extra: Record<string, C> = {}): C | null {
  const n = normHeader(v);
  if (!n) return null;
  const fr = makeT('fr');
  for (const c of codes) if (normHeader(c) === n || normHeader(labelOf(c)) === n || normHeader(fr(labelOf(c))) === n) return c;
  return extra[n] ?? null;
}

export const parseCostType = (v: string): CostType | null =>
  codeOfLabel(v, costType.codes, costType.label, {
    labour: 'labor', 'main d oeuvre': 'labor', mo: 'labor', heures: 'labor', materiel: 'material', materiaux: 'material', materials: 'material', fournitures: 'material',
    equipement: 'equipment', equipements: 'equipment', 'sous traitance': 'subcontract', subcontracting: 'subcontract', st: 'subcontract', honoraires: 'fees', frais: 'fees',
    reserve: 'reserve', provision: 'reserve', contingency: 'reserve', aleas: 'reserve',
  });

export const parsePartType = (v: string): PartType | null => {
  const direct = codeOfLabel(v, partType.codes, partType.label);
  if (direct) return direct;
  const family = codeOfLabel(v, partFamily.codes, partFamily.label);
  return family ? PART_FAMILY_TYPE[family] : null;
};

export const parseMakeBuy = (v: string): PartMakeBuy | null =>
  codeOfLabel(v, partMakeBuy.codes, partMakeBuy.label, { m: 'manufactured', make: 'manufactured', f: 'manufactured', fabrique: 'manufactured', fabrication: 'manufactured', b: 'purchased', buy: 'purchased', a: 'purchased', achete: 'purchased', achat: 'purchased' });

const UNIT_ALIASES: Record<string, PartUnit> = {
  pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc', u: 'pc', unit: 'pc', units: 'pc', unite: 'pc', ea: 'pc', each: 'pc', pce: 'pc',
  m: 'm', meter: 'm', metre: 'm', meters: 'm', metres: 'm', ml: 'm', kg: 'kg', kilo: 'kg', kilogram: 'kg', kilogramme: 'kg',
  set: 'set', sets: 'set', lot: 'set', kit: 'set', ens: 'set', ensemble: 'set',
};
export const parseUnit = (v: string): PartUnit | null => UNIT_ALIASES[normHeader(v)] ?? null;

export const parseScope = (v: string): BomScope | null => codeOfLabel(v, bomScope.codes, bomScope.label, { surcouche: 'overlay', 'fourni client': 'client', 'fourni par le client': 'client' });

export const parseStatus = (v: string): PartStatus | null => codeOfLabel(v, partStatus.codes, partStatus.label, { valide: 'validated', 'non valide': 'not_validated', perime: 'outdated', obsolete: 'obsolete' });

export function parseWearSpare(v: string): WearSpare | null | 'invalid' {
  const n = normHeader(v);
  if (!n || n === 'none' || n === 'aucun' || n === 'aucune') return null;
  if (n === 'pu' || n.startsWith('wear') || n.startsWith('usure') || n.includes('(pu)') || n.endsWith(' pu')) return 'PU';
  if (n === 'pr' || n.startsWith('spare') || n.startsWith('rechange') || n.startsWith('piece de rechange') || n.endsWith(' pr')) return 'PR';
  return 'invalid';
}

/** A source row read through the mapping: line number in the file and the raw cell per target field. */
export interface MappedRow {
  line: number;
  cells: Record<string, Cell>;
}

/** Applies a mapping to the data rows (after the header). Blank rows are dropped. */
export function mapRows(columns: readonly string[], rows: readonly (readonly Cell[])[], headerIndex: number, mapping: Record<string, string | null>): MappedRow[] {
  const idx: Record<string, number> = {};
  for (const [field, col] of Object.entries(mapping)) if (col) idx[field] = columns.indexOf(col);
  const out: MappedRow[] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    if (!r.some((c) => textOf(c) !== '')) return;
    const cells: Record<string, Cell> = {};
    for (const [field, j] of Object.entries(idx)) if (j >= 0) cells[field] = r[j];
    out.push({ line: headerIndex + 2 + i, cells });
  });
  if (out.length > MAX_IMPORT_ROWS) throw new Error(fmt('The file has more than {0} rows', MAX_IMPORT_ROWS));
  return out;
}

/** One row checked on its own (types and required fields): normalised values + EN messages; `error` when it cannot be imported. */
export interface NormalisedRow {
  line: number;
  key: string | null;
  values: Record<string, string | number | null>;
  errors: string[];
  warnings: string[];
}

/** Checks the fields of one row (no database): required, numbers, codes of the kind. */
export function normaliseRow(kind: TableKind, row: MappedRow, decimal: ',' | '.' | null): NormalisedRow {
  const values: Record<string, string | number | null> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const f of TABLE_FIELDS[kind]) {
    const raw = row.cells[f.key];
    const text = textOf(raw);
    if (!text) {
      values[f.key] = null;
      if (f.required) errors.push(fmt('{0} is required', f.label));
      continue;
    }
    if (f.type === 'number' || f.type === 'integer') {
      const n = parseNumberCell(raw, decimal);
      if (n == null) {
        errors.push(fmt('Not a number: {0}', clip(text, 30)));
        values[f.key] = null;
      } else values[f.key] = f.type === 'integer' ? Math.round(n) : n;
    } else values[f.key] = text.slice(0, 300);
  }
  const code = (key: string, parse: (v: string) => string | null, message: Parameters<typeof fmt>[0]) => {
    const v = values[key];
    if (typeof v !== 'string') return;
    const c = parse(v);
    if (c == null) errors.push(fmt(message, clip(v, 30)));
    else values[key] = c;
  };
  if (kind === 'budget_lines') {
    code('costType', parseCostType, 'Unknown cost type {0}');
    for (const k of ['budget', 'actual', 'committed', 'forecast']) if (typeof values[k] === 'number' && (values[k] as number) < 0) errors.push(fmt('Negative amount'));
    if (typeof values.code === 'string') values.code = values.code.toUpperCase().slice(0, 20);
  }
  if (kind === 'bom') {
    if (typeof values.ref === 'string') values.ref = values.ref.toUpperCase();
    if (typeof values.quantity === 'number' && values.quantity <= 0) errors.push(fmt('Quantity must be greater than 0'));
    code('scope', parseScope, 'Unknown scope {0}');
    if (typeof values.activity === 'string') values.activity = values.activity.toUpperCase();
  }
  if (kind === 'parts') {
    if (typeof values.ref === 'string') {
      values.ref = values.ref.toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(values.ref) || values.ref.length > 60) errors.push(fmt('Invalid reference {0}', clip(values.ref, 30)));
    }
    code('type', parsePartType, 'Unknown part type {0}');
    code('makeBuy', parseMakeBuy, 'Unknown make / buy value {0}');
    code('unit', parseUnit, 'Unknown unit {0}');
    code('status', parseStatus, 'Unknown status {0}');
    if (typeof values.wearSpare === 'string') {
      const w = parseWearSpare(values.wearSpare);
      if (w === 'invalid') errors.push(fmt('Unknown wear / spare value {0}', clip(values.wearSpare, 30)));
      else values.wearSpare = w;
    }
    if (typeof values.price === 'number' && values.price < 0) errors.push(fmt('Negative amount'));
    if (typeof values.leadWeeks === 'number' && values.leadWeeks < 0) errors.push(fmt('Not a number: {0}', String(values.leadWeeks)));
  }
  if (kind === 'assignments') {
    if (typeof values.activity === 'string') values.activity = values.activity.toUpperCase();
    for (const k of ['count', 'hoursPerDay', 'plannedHours', 'actualHours']) if (typeof values[k] === 'number' && (values[k] as number) < 0) errors.push(fmt('Not a number: {0}', String(values[k])));
    if (typeof values.hoursPerDay === 'number' && values.hoursPerDay > 24) errors.push(fmt('Not a number: {0}', String(values.hoursPerDay)));
  }
  const keyField = kind === 'budget_lines' ? (values.code ?? values.name) : kind === 'assignments' ? (values.activity && values.resource ? `${values.activity} · ${values.resource}` : null) : values.ref;
  return { line: row.line, key: keyField == null ? null : String(keyField), values, errors, warnings };
}
