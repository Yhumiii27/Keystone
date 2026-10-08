// PLM — parts catalogue and part record: pure business logic (docs/spec/09 §2–§3; prototype logic 4176–4181,
// 4199–4201, 4267–4304). Catalogue URL state, filters (search, type, status, PU/PR, make / buy, export-restricted),
// the sortable columns (`plmSortBy`: a money column starts descending), the KPI tiles (`plmKpis`), the filter option
// counts (`plm*Opts`), the row texts (`partRow`), the part record's Identification and Commercial & export rows
// (`partVals`), the stock of a part by location (the prototype's STOCK_BY_REF read tuple indexes on objects and always
// found 0 — 00 §7.16, 09 OQ1: here Σ on hand over every location), and the revision events of a part (REV_DIFF).
// No I/O, no translation: texts are the prototype's English source strings; money and thousands are formatted by the
// caller. Golden values: src/domain/parts.test.ts (prototype render values, src/features/plm/plm.golden.json).
import {
  PART_STATUS_NOTE, partMakeBuy, partStatus, partType, wearSpare,
  type PartMakeBuy, type PartStatus, type PartType, type RevisionDiffKind, type WearSpare,
} from '@/server/db/codes';

export type { PartMakeBuy, PartStatus, PartType, WearSpare };

/** What the catalogue logic needs from a part (a subset of the DAL's PartRow). */
export interface PartFacts {
  ref: string;
  /** EN data text. */
  name: string;
  makeBuy: PartMakeBuy;
  type: PartType;
  status: PartStatus;
  /** List / standard unit price, €. */
  listPriceEur: number;
  manufacturer: string | null;
  manufacturerRef: string | null;
  /** Customs (HS) code; null = "n/a". */
  hsCode: string | null;
  /** Restriction text (EN source); null = "None". */
  exportRestriction: string | null;
  /** Letter / index; null = "—". */
  revision: string | null;
  /** Weeks; null = none. */
  leadWeeks: number | null;
  wearSpare: WearSpare | null;
  /** Projects whose BOM lists the part, with their quantity (`usage`, quantities > 0). */
  usage: readonly { projectCode: string; shortCode: string; quantity: number }[];
}

// ── URL state ──────────────────────────────────────────────────────────────────────────────────────────

/** PU/PR filter: wear parts, spare parts, or parts with neither flag (`plm.pu === 'none'`). */
export type PuFilter = WearSpare | 'none';
export type PlmSortKey = 'ref' | 'name' | 'type' | 'price' | 'status';
export const PLM_SORT_KEYS: readonly PlmSortKey[] = ['ref', 'name', 'type', 'price', 'status'];
export type SortDir = 1 | -1;

export interface PlmFilter {
  /** Search text as typed (the prototype lower-cases it, no trim). */
  q: string;
  type: PartType | null;
  status: PartStatus | null;
  pu: PuFilter | null;
  mb: PartMakeBuy | null;
  /** "Export-restricted only". */
  restricted: boolean;
}

export interface PlmSort {
  key: PlmSortKey;
  dir: SortDir;
}

export interface PlmState {
  filter: PlmFilter;
  sort: PlmSort;
}

/** Initial state (`plm: {q:'', type:null, mb:null, status:null, restricted:false}`, sort `ref` ascending). */
export const DEFAULT_PLM_FILTER: PlmFilter = { q: '', type: null, status: null, pu: null, mb: null, restricted: false };
export const DEFAULT_PLM_SORT: PlmSort = { key: 'ref', dir: 1 };

export interface PlmParams {
  q?: string | null;
  type?: string | null;
  status?: string | null;
  pu?: string | null;
  mb?: string | null;
  /** "1" = export-restricted only. */
  restr?: string | null;
  sort?: string | null;
  /** "asc" / "desc". */
  dir?: string | null;
}

/** Search params → state; unknown values fall back to the defaults (no filter, ref ascending). */
export function parsePlmState(p: PlmParams): PlmState {
  const pu = p.pu === 'PU' || p.pu === 'PR' || p.pu === 'none' ? p.pu : null;
  const key = PLM_SORT_KEYS.includes(p.sort as PlmSortKey) ? (p.sort as PlmSortKey) : 'ref';
  return {
    filter: {
      q: (p.q ?? '').slice(0, 120),
      type: partType.isCode(p.type) ? p.type : null,
      status: partStatus.isCode(p.status) ? p.status : null,
      pu,
      mb: partMakeBuy.isCode(p.mb) ? p.mb : null,
      restricted: p.restr === '1',
    },
    sort: { key, dir: p.dir === 'desc' ? -1 : 1 },
  };
}

/** State → search params (defaults omitted), in a stable order. */
export function plmParams(s: PlmState): Record<string, string> {
  const out: Record<string, string> = {};
  const f = s.filter;
  if (f.q) out.q = f.q;
  if (f.type) out.type = f.type;
  if (f.status) out.status = f.status;
  if (f.pu) out.pu = f.pu;
  if (f.mb) out.mb = f.mb;
  if (f.restricted) out.restr = '1';
  if (s.sort.key !== 'ref' || s.sort.dir !== 1) {
    out.sort = s.sort.key;
    out.dir = s.sort.dir === 1 ? 'asc' : 'desc';
  }
  return out;
}

/** `plmHasFilter`: any filter or search set ("Clear filters" shows). */
export const hasPlmFilter = (f: PlmFilter) => !!(f.type || f.status || f.pu || f.mb || f.restricted || f.q);

/** "Clear filters" (`plmClear`): every filter and the search reset, the sort kept. */
export const clearPlmFilter = (s: PlmState): PlmState => ({ ...s, filter: { ...DEFAULT_PLM_FILTER } });

/**
 * `plmSortBy[k]`: the active column flips its direction; another column starts ascending, except the money column
 * (price) which starts descending.
 */
export function nextPlmSort(current: PlmSort, key: PlmSortKey): PlmSort {
  if (current.key === key) return { key, dir: current.dir === 1 ? -1 : 1 };
  return { key, dir: key === 'price' ? -1 : 1 };
}

// ── Filtering & sorting (plmRows 4271) ─────────────────────────────────────────────────────────────────

/** Search haystack (`ref + name + mfr + mfrRef`, EN source), plus an optional displayed text (the French name). */
export const partHaystack = (p: Pick<PartFacts, 'ref' | 'name' | 'manufacturer' | 'manufacturerRef'>, display = '') =>
  `${p.ref} ${p.name} ${p.manufacturer ?? ''} ${p.manufacturerRef ?? ''}${display ? ` ${display}` : ''}`.toLowerCase();

export function matchesPlmFilter(p: PartFacts, f: PlmFilter, display = ''): boolean {
  if (f.type && p.type !== f.type) return false;
  if (f.pu && (f.pu === 'none' ? !!p.wearSpare : p.wearSpare !== f.pu)) return false;
  if (f.mb && p.makeBuy !== f.mb) return false;
  if (f.status && p.status !== f.status) return false;
  if (f.restricted && !p.exportRestriction) return false;
  const q = f.q.toLowerCase();
  return !q || partHaystack(p, display).includes(q);
}

/**
 * `plmSorters` — on the English labels, as the prototype compares them: ref, name, type (then ref), price, status
 * (then ref). Stable: equal rows keep the catalogue order.
 */
export function comparePlm(key: PlmSortKey): (a: PartFacts, b: PartFacts) => number {
  switch (key) {
    case 'name':
      return (a, b) => a.name.localeCompare(b.name);
    case 'type':
      return (a, b) => partType.label(a.type).localeCompare(partType.label(b.type)) || a.ref.localeCompare(b.ref);
    case 'price':
      return (a, b) => a.listPriceEur - b.listPriceEur;
    case 'status':
      return (a, b) => partStatus.label(a.status).localeCompare(partStatus.label(b.status)) || a.ref.localeCompare(b.ref);
    default:
      return (a, b) => a.ref.localeCompare(b.ref);
  }
}

/** The rows of the catalogue table: filtered, then sorted (catalogue order as the tie-break). */
export function plmRows<P extends PartFacts>(parts: readonly P[], s: PlmState, display?: (p: P) => string): P[] {
  const cmp = comparePlm(s.sort.key);
  return parts.filter((p) => matchesPlmFilter(p, s.filter, display?.(p))).sort((a, b) => s.sort.dir * cmp(a, b));
}

/** "54 of 54 parts" (`plmCount`). */
export const plmCountText = (shown: number, total: number) => `${shown} of ${total} parts`;

// ── KPI tiles (plmKpis 4281) ───────────────────────────────────────────────────────────────────────────

export interface PlmKpiFigures {
  total: number;
  manufactured: number;
  purchased: number;
  validated: number;
  notValidated: number;
  /** Outdated / obsolete parts still listed in a project BOM (catalogue order). */
  outdatedInUse: string[];
  exportRestricted: number;
  /** round(mean lead time of the parts with one), weeks; null when none. */
  avgLeadWeeks: number | null;
}

export function plmKpiFigures(parts: readonly PartFacts[]): PlmKpiFigures {
  const withLead = parts.filter((p) => p.leadWeeks);
  return {
    total: parts.length,
    manufactured: parts.filter((p) => p.makeBuy === 'manufactured').length,
    purchased: parts.filter((p) => p.makeBuy === 'purchased').length,
    validated: parts.filter((p) => p.status === 'validated').length,
    notValidated: parts.filter((p) => p.status === 'not_validated').length,
    outdatedInUse: parts.filter((p) => (p.status === 'outdated' || p.status === 'obsolete') && p.usage.length > 0).map((p) => p.ref),
    exportRestricted: parts.filter((p) => p.exportRestriction).length,
    avgLeadWeeks: withLead.length ? Math.round(withLead.reduce((s, p) => s + (p.leadWeeks ?? 0), 0) / withLead.length) : null,
  };
}

export interface PlmKpi {
  /** EN source strings. */
  label: string;
  value: string;
  sub: string;
  /** Value in the attention colour (LO). */
  alert: boolean;
}

/** The five tiles: Parts in catalogue · Validated · Outdated still in use · Export-restricted · Avg lead time. */
export function plmKpis(parts: readonly PartFacts[]): PlmKpi[] {
  const k = plmKpiFigures(parts);
  return [
    { label: 'Parts in catalogue', value: String(k.total), sub: `${k.manufactured} manufactured · ${k.purchased} purchased`, alert: false },
    { label: 'Validated', value: `${k.total ? Math.round((k.validated / k.total) * 100) : 0}%`, sub: `${k.notValidated} awaiting qualification`, alert: false },
    { label: 'Outdated still in use', value: String(k.outdatedInUse.length), sub: k.outdatedInUse.join(' · ') || 'None', alert: k.outdatedInUse.length > 0 },
    { label: 'Export-restricted', value: String(k.exportRestricted), sub: 'Licence or notification needed', alert: false },
    { label: 'Avg lead time', value: k.avgLeadWeeks == null ? '—' : leadShortText(k.avgLeadWeeks), sub: 'Purchased & manufactured', alert: false },
  ];
}

// ── Filter options (plmTypeOpts, plmStatusOpts, plmPuOpts, plmMbOpts 4285–4288) ─────────────────────────

export interface PlmOption {
  /** '' = no filter. */
  value: string;
  /** EN source ("Electrical · 12"). */
  label: string;
}

export interface PlmOptions {
  types: PlmOption[];
  statuses: PlmOption[];
  pu: PlmOption[];
  mb: PlmOption[];
}

/** Statuses of the Status select, in the prototype's order (all four, even when empty). */
export const PLM_STATUSES: readonly PartStatus[] = ['validated', 'not_validated', 'outdated', 'obsolete'];

/** Options with their counts over the whole catalogue; the types in catalogue first-appearance order. */
export function plmOptions(parts: readonly PartFacts[]): PlmOptions {
  const n = parts.length;
  const cnt = (fn: (p: PartFacts) => boolean) => parts.filter(fn).length;
  const types = [...new Set(parts.map((p) => p.type))];
  return {
    types: [{ value: '', label: `All types · ${n}` }, ...types.map((t) => ({ value: t, label: `${partType.label(t)} · ${cnt((p) => p.type === t)}` }))],
    statuses: [{ value: '', label: `Any status · ${n}` }, ...PLM_STATUSES.map((st) => ({ value: st, label: `${partStatus.label(st)} · ${cnt((p) => p.status === st)}` }))],
    pu: [
      { value: '', label: `All parts · ${n}` },
      { value: 'PU', label: `Wear parts (PU) · ${cnt((p) => p.wearSpare === 'PU')}` },
      { value: 'PR', label: `Spare parts (PR) · ${cnt((p) => p.wearSpare === 'PR')}` },
      { value: 'none', label: `Neither · ${cnt((p) => !p.wearSpare)}` },
    ],
    mb: [
      { value: '', label: `All · ${n}` },
      { value: 'manufactured', label: `Manufactured · ${cnt((p) => p.makeBuy === 'manufactured')}` },
      { value: 'purchased', label: `Purchased · ${cnt((p) => p.makeBuy === 'purchased')}` },
    ],
  };
}

// ── Row and record texts (partRow 4199, partVals 4293) ─────────────────────────────────────────────────

export type PartTone = 'neutral' | 'accent' | 'outline';

/** `partTag`: Validated → neutral · Not validated → outline · Outdated / Obsolete → accent. */
export const partStatusTone = (s: PartStatus): PartTone => (s === 'validated' ? 'neutral' : s === 'not_validated' ? 'outline' : 'accent');
/** `puTag`: PU → accent · PR → outline · none → neutral. */
export const wearSpareTone = (w: WearSpare | null): PartTone => (w === 'PU' ? 'accent' : w === 'PR' ? 'outline' : 'neutral');

/** Lead time in the table ("9 wks", "1 wk"; "—" without one). The prototype wrote "1 wks". */
export const leadShortText = (weeks: number | null | undefined) => (weeks ? `${weeks} ${weeks === 1 ? 'wk' : 'wks'}` : '—');
/** Lead time in the part record ("9 weeks", "1 week"; "—"). */
export const leadLongText = (weeks: number | null | undefined) => (weeks ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : '—');
/** "Used in": "1 project" / "3 projects" / "—". */
export const usedCountText = (n: number) => (n ? `${n} ${n === 1 ? 'project' : 'projects'}` : '—');
/** Σ BOM quantities of the part (`spQty`). */
export const totalQuantity = (p: Pick<PartFacts, 'usage'>) => p.usage.reduce((s, u) => s + u.quantity, 0);
/** "Committed value": list price × Σ quantities (`money$(price × spQty)`). */
export const committedValueEur = (p: Pick<PartFacts, 'usage' | 'listPriceEur'>) => p.listPriceEur * totalQuantity(p);

const enQty = (n: number) => n.toLocaleString('en-US');
/** Projects equipped sub-line quantity: "6 units" (`fmt` formats the thousands; "1 unit" — the prototype wrote "1 units"). */
export const unitsText = (qty: number, fmt: (n: number) => string = enQty) => `${fmt(qty)} ${qty === 1 ? 'unit' : 'units'}`;
/** "Total quantity": "6 units · 1 project", "400 units · 2 projects". */
export const totalQuantityText = (qty: number, projects: number, fmt: (n: number) => string = enQty) =>
  `${unitsText(qty, fmt)} · ${projects} ${projects === 1 ? 'project' : 'projects'}`;

/** Banner of a part that cannot be bought as is (STATUS_NOTE); null for validated parts. */
export const partStatusNote = (s: PartStatus): string | null => PART_STATUS_NOTE[s] ?? null;

/** "Restrictions" cell: the text, or "—". */
export const restrictionCell = (p: Pick<PartFacts, 'exportRestriction'>) => p.exportRestriction ?? '—';

export interface PartLine {
  /** EN source key. */
  k: string;
  /** EN source value, or a pre-formatted value (money). */
  v: string;
  /** Translate the value (codes' labels, "None", "n/a"); false for data (refs, codes, amounts). */
  translate: boolean;
  /** Value in the attention colour (LO). */
  alert: boolean;
}

/** Identification rows: Make / buy · Wear / spare (PU/PR) · Type of part · Manufacturer · Manufacturer ref. · Revision · Lead time. */
export function identificationLines(p: PartFacts): PartLine[] {
  return [
    { k: 'Make / buy', v: partMakeBuy.label(p.makeBuy), translate: true, alert: false },
    { k: 'Wear / spare (PU/PR)', v: p.wearSpare ? wearSpare.label(p.wearSpare) : '—', translate: true, alert: false },
    { k: 'Type of part', v: partType.label(p.type), translate: true, alert: false },
    { k: 'Manufacturer', v: p.manufacturer ?? '—', translate: false, alert: false },
    { k: 'Manufacturer ref.', v: p.manufacturerRef ?? '—', translate: false, alert: false },
    { k: 'Revision', v: p.revision ?? '—', translate: false, alert: false },
    { k: 'Lead time', v: leadLongText(p.leadWeeks), translate: true, alert: false },
  ];
}

/**
 * Commercial & export rows: Unit price · Customs (HS) code · Export restrictions (attention colour unless None) ·
 * Total quantity · Committed value. Money and thousands are formatted by the caller (`money`, `qty`).
 */
export function commercialLines(p: PartFacts, money: (eur: number) => string, qty: (n: number) => string): PartLine[] {
  return [
    { k: 'Unit price', v: money(p.listPriceEur), translate: false, alert: false },
    { k: 'Customs (HS) code', v: p.hsCode ?? 'n/a', translate: !p.hsCode, alert: false },
    { k: 'Export restrictions', v: p.exportRestriction ?? 'None', translate: true, alert: !!p.exportRestriction },
    { k: 'Total quantity', v: totalQuantityText(totalQuantity(p), p.usage.length, qty), translate: true, alert: false },
    { k: 'Committed value', v: money(committedValueEur(p)), translate: false, alert: false },
  ];
}

// ── Stock by location (fixes STOCK_BY_REF, 09 OQ1) ─────────────────────────────────────────────────────

export interface StockFacts {
  onHand: number;
  reserved: number;
  minQty: number;
}

export interface StockSummary {
  locations: number;
  /** Σ on hand over every location (the PU/PR list's "N in stock"). */
  onHand: number;
  reserved: number;
  /** Σ (on hand − reserved). */
  available: number;
  /** Locations below their minimum (min > 0 and on hand < min). */
  belowMin: number;
}

export function stockSummary(rows: readonly StockFacts[]): StockSummary {
  const onHand = rows.reduce((s, r) => s + r.onHand, 0);
  const reserved = rows.reduce((s, r) => s + r.reserved, 0);
  return { locations: rows.length, onHand, reserved, available: onHand - reserved, belowMin: rows.filter((r) => r.minQty > 0 && r.onHand < r.minQty).length };
}

/** Σ on hand per reference across every location (what `STOCK_BY_REF` meant to compute). */
export function stockOnHandByRef(rows: readonly (StockFacts & { ref: string })[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[r.ref] = (m[r.ref] ?? 0) + r.onHand;
  return m;
}

// ── Revisions (REV_DIFF 3427) ──────────────────────────────────────────────────────────────────────────

export interface RevisionDiffFacts {
  assemblyRef: string;
  fromRevision: string;
  toRevision: string;
  /** ISO date. */
  date: string;
  ecoNumber: string | null;
  lines: { path: string; name: string; qtyFrom: number | null; qtyTo: number | null; kind: RevisionDiffKind }[];
}

/** Refs a revision line touches: the parent, the child — and for a substitution the old and the new part. */
export function diffLineRefs(path: string): { parent: string; from: string; to: string } {
  const [parent, child = ''] = path.split(' / ');
  const [from, to = from] = child.split(' → ');
  return { parent, from, to };
}

export interface PartRevisionEvent {
  assemblyRef: string;
  fromRevision: string;
  toRevision: string;
  date: string;
  ecoNumber: string | null;
  /** The part is the compared assembly itself (every line is listed). */
  isAssembly: boolean;
  /** Lines of the comparison that concern the part (all of them for the assembly). */
  lines: RevisionDiffFacts['lines'];
}

/** Revision comparisons in which a part appears: as the assembly compared, or as a line's old / new part. */
export function revisionEventsOf(ref: string, diffs: readonly RevisionDiffFacts[]): PartRevisionEvent[] {
  const out: PartRevisionEvent[] = [];
  for (const d of diffs) {
    const isAssembly = d.assemblyRef === ref;
    const lines = isAssembly ? d.lines : d.lines.filter((l) => {
      const r = diffLineRefs(l.path);
      return r.from === ref || r.to === ref;
    });
    if (isAssembly || lines.length) out.push({ assemblyRef: d.assemblyRef, fromRevision: d.fromRevision, toRevision: d.toRevision, date: d.date, ecoNumber: d.ecoNumber, isAssembly, lines });
  }
  return out;
}

/** Quantity of a revision line ("—" when absent), and the "2 → 3" change text. */
export const diffQtyText = (q: number | null) => (q == null ? '—' : String(q));
export const diffChangeText = (l: { qtyFrom: number | null; qtyTo: number | null }) => `${diffQtyText(l.qtyFrom)} → ${diffQtyText(l.qtyTo)}`;
/** Comparison line kind tag (cmpVals 4266): Added → accent · Substitution → outline · Quantity → neutral. */
export const diffKindTone = (k: RevisionDiffKind): PartTone => (k === 'added' ? 'accent' : k === 'substitution' ? 'outline' : 'neutral');

// ── Where-used in the product structure ────────────────────────────────────────────────────────────────

/**
 * Assembly chains above a part ("ASM-RMG-250 › ASM-DRV-700"), from the parent → child links of the catalogue: every
 * path from a top-level assembly down to the part's direct parent. Empty for a top-level part or a part used nowhere.
 */
export function parentChains(ref: string, links: readonly { parent: string; child: string }[]): string[][] {
  const parentsOf = new Map<string, string[]>();
  for (const l of links) parentsOf.set(l.child, [...(parentsOf.get(l.child) ?? []), l.parent]);
  const out: string[][] = [];
  const walk = (node: string, chain: string[], seen: Set<string>) => {
    const ps = parentsOf.get(node) ?? [];
    if (!ps.length) {
      if (chain.length) out.push(chain);
      return;
    }
    for (const p of ps) if (!seen.has(p)) walk(p, [p, ...chain], new Set([...seen, p]));
  };
  walk(ref, [], new Set([ref]));
  return out;
}
