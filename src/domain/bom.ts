// Project BOM — pure business rules (docs/spec/09 §1, logic 4206–4266; shortfall 08 §2, logic 4327–4330). Used by the
// BOM data layer (src/server/dal/bom.ts) and the screen model (src/features/bom/model.ts); golden-tested against the
// prototype's own values (src/domain/bom.test.ts).
// - Flat list: search / type / supplier filters, the five sortable columns and the header-click rule, the option
//   lists of the two selects, the KPI figures. The BOM value counts every physical article once: an assembly whose
//   components are listed in the same BOM is valued through them (the prototype added both, 09 OQ6 / 00 §7.16).
// - Assembly tree: the costed roll-up at last purchase price (leaf = last price, assembly = Σ child q × roll-up),
//   extended quantities, depth-first rows, folding, assembly paths, the node's costed roll-up.
// - Where-used part resolution, revision-comparison deltas, PU/PR system quantity and KPI figures.
// - Still-to-order shortfall (purchased BOM articles ordered less than their BOM quantity) and its grouping per
//   supplier for the draft purchase orders; the spares package still to buy (recommended quantity − stock).
// - "Add article" form parsing (AF.bom).
// - Delivery 7 (E-2a = a, A-11 = a, R-103): one valuation rule for the flat list, the tree, a node's cost and the
//   revision comparison — the project's ordered price, else the last purchase price, else the catalogue price, with the
//   source shown (`bomUnitPrice`); stock stays at the last purchase price (src/domain/stock.ts).
import type { BomScope, PartMakeBuy, PartStatus, PoStatus, WearSpare } from '@/server/db/codes';

// ── Valuation (E-2a / A-11) ────────────────────────────────────────────────────────────────────────────

/** Where a BOM unit price comes from (E-2a = a): the project's order, the last purchase, the catalogue. */
export type BomPriceSource = 'ordered' | 'last_purchase' | 'catalogue';
/** EN source labels of the price sources (the assembly roll-up of an assembly reads "Roll-up of components"). */
export const BOM_PRICE_SOURCE_LABEL: Record<BomPriceSource, string> = { ordered: 'Ordered price', last_purchase: 'Last purchase price', catalogue: 'Catalogue price' };
export const ROLLUP_SOURCE_LABEL = 'Roll-up of components';

/** Order statuses whose line prices value the BOM ("the article is ordered"): approved, partly or fully received. */
export const ORDERED_PO_STATUSES: readonly PoStatus[] = ['ordered', 'partially_received', 'received'];
export const isOrderedPoStatus = (s: PoStatus) => ORDERED_PO_STATUSES.includes(s);

/** The project's ordered unit price of a part: the quantity-weighted mean of its ordered lines; null when not ordered. */
export function orderedUnitPrice(lines: readonly { qty: number; unitPriceEur: number }[]): number | null {
  const qty = lines.reduce((a, l) => a + (l.qty > 0 ? l.qty : 0), 0);
  if (!qty) return null;
  return lines.reduce((a, l) => a + (l.qty > 0 ? l.qty * l.unitPriceEur : 0), 0) / qty;
}

/** E-2a = a: the ordered price, else the last purchase price, else the catalogue (list) price — and its source. */
export function bomUnitPrice(f: { orderedEur: number | null; lastPurchaseEur: number | null; listPriceEur: number }): { unitEur: number; source: BomPriceSource } {
  if (f.orderedEur != null) return { unitEur: f.orderedEur, source: 'ordered' };
  if (f.lastPurchaseEur != null) return { unitEur: f.lastPurchaseEur, source: 'last_purchase' };
  return { unitEur: f.listPriceEur, source: 'catalogue' };
}

/**
 * Last purchase price kept up to date from the goods received in Keystone (A-11, R-103): a receipt replaces the stored
 * price unless the stored one is from a later purchase (a seed price has no date and is always older).
 */
export const replacesLastPrice = (stored: { purchasedOn: string | null } | null | undefined, receivedOn: string) =>
  !stored || !stored.purchasedOn || stored.purchasedOn <= receivedOn;

// ── Flat list ──────────────────────────────────────────────────────────────────────────────────────────

/** Sortable columns of the flat list (BOM_SORT_KEYS 4209). */
export type BomSortKey = 'ref' | 'name' | 'type' | 'total' | 'status';
export const BOM_SORT_KEYS: readonly BomSortKey[] = ['ref', 'name', 'type', 'total', 'status'];
export type SortDir = 'asc' | 'desc';
export interface BomSort {
  key: BomSortKey;
  dir: SortDir;
}
/** Initial sort (`bomSort` 'ref', ascending). */
export const DEFAULT_BOM_SORT: BomSort = { key: 'ref', dir: 'asc' };

export const isBomSortKey = (v: unknown): v is BomSortKey => typeof v === 'string' && (BOM_SORT_KEYS as readonly string[]).includes(v);

/**
 * Header click (`bomSortBy` 4210): the active column flips its direction; another column starts ascending, except
 * the money column Total, which starts descending.
 */
export function nextBomSort(cur: BomSort, key: BomSortKey): BomSort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'total' ? 'desc' : 'asc' };
}

/** What the flat-list rules read from a BOM line (English labels: the prototype filters and sorts on them). */
export interface BomListItem {
  ref: string;
  name: string;
  /** Type code (filter key). */
  type: string;
  /** English type label ("Electrical"; sort key, option label). */
  typeLabel: string;
  manufacturer: string | null;
  manufacturerRef: string | null;
  listPriceEur: number;
  /** Delivery 7 (E-2a): the valuation unit price (`bomUnitPrice`); absent = the list price (the prototype's figure). */
  unitPriceEur?: number;
  quantity: number;
  /** English status label ("Not validated"; sort key). */
  statusLabel: string;
}

/** Line total (`price × usage`): the valuation unit price (E-2a), the list price when none is given (the prototype). */
export const bomLineTotal = (l: Pick<BomListItem, 'listPriceEur' | 'quantity'> & { unitPriceEur?: number }) => (l.unitPriceEur ?? l.listPriceEur) * l.quantity;

export interface BomFilter {
  /** Search text (reference, article, manufacturer, manufacturer ref; case-insensitive substring). */
  q?: string | null;
  /** Type code. */
  type?: string | null;
  /** Manufacturer / supplier name. */
  mfr?: string | null;
}

/** Flat-list filter (`bomRows` 4208): type, supplier and the search over "ref name mfr mfrRef". */
export function filterBomLines<T extends BomListItem>(lines: readonly T[], f: BomFilter): T[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return lines.filter(
    (l) =>
      (!f.type || l.type === f.type) &&
      (!f.mfr || l.manufacturer === f.mfr) &&
      (!q || `${l.ref} ${l.name} ${l.manufacturer ?? ''} ${l.manufacturerRef ?? ''}`.toLowerCase().includes(q)),
  );
}

const COMPARE: Record<BomSortKey, (a: BomListItem, b: BomListItem) => number> = {
  ref: (a, b) => a.ref.localeCompare(b.ref),
  name: (a, b) => a.name.localeCompare(b.name),
  type: (a, b) => a.typeLabel.localeCompare(b.typeLabel) || a.ref.localeCompare(b.ref),
  total: (a, b) => bomLineTotal(a) - bomLineTotal(b),
  status: (a, b) => a.statusLabel.localeCompare(b.statusLabel) || a.ref.localeCompare(b.ref),
};

/** Flat-list sort (`bomSorters` 4207): comparator × direction, stable (ties keep the BOM order). */
export function sortBomLines<T extends BomListItem>(lines: readonly T[], sort: BomSort): T[] {
  const d = sort.dir === 'asc' ? 1 : -1;
  const cmp = COMPARE[sort.key] ?? COMPARE.ref;
  return lines.slice().sort((a, b) => d * cmp(a, b));
}

export interface BomOption {
  /** Filter value ('' = all). */
  value: string;
  /** English label of the type or the supplier name. */
  label: string;
  count: number;
}

/** "Type" select (`bomTypeOpts` 4213): one option per type in first-appearance order, with counts. */
export function bomTypeOptions(lines: readonly BomListItem[]): BomOption[] {
  const out = new Map<string, BomOption>();
  for (const l of lines) {
    const o = out.get(l.type);
    if (o) o.count++;
    else out.set(l.type, { value: l.type, label: l.typeLabel, count: 1 });
  }
  return [...out.values()];
}

/** "Supplier" select (`bomMfrOpts` 4214): manufacturers sorted (code-unit order, as `.sort()`), with counts. */
export function bomSupplierOptions(lines: readonly BomListItem[]): BomOption[] {
  const names = [...new Set(lines.map((l) => l.manufacturer).filter((m): m is string => !!m))].sort();
  return names.map((m) => ({ value: m, label: m, count: lines.filter((l) => l.manufacturer === m).length }));
}

/** A link of the assembly structure: child reference × quantity per parent. */
export interface AssemblyLink {
  ref: string;
  q: number;
}
export type ChildrenOf = (ref: string) => readonly AssemblyLink[];

/**
 * The line is an assembly whose components are listed in the same BOM: it is valued through them, so the BOM value
 * does not count the same physical article twice (09 OQ6).
 */
export function isValuedByComponents(ref: string, childrenOf: ChildrenOf, inBom: ReadonlySet<string>): boolean {
  return childrenOf(ref).some((c) => inBom.has(c.ref));
}

export interface BomSummaryInput {
  quantity: number;
  listPriceEur: number;
  /** Valuation unit price (E-2a); absent = the list price. */
  unitPriceEur?: number;
  status: PartStatus;
  /** Restriction text; null = "None". */
  exportRestriction: string | null;
  valuedByComponents: boolean;
}

export interface BomSummary {
  articles: number;
  /** Σ quantities ("2,042 units in total"). */
  units: number;
  /** Each physical article once (assemblies valued through their components), at the valuation price (E-2a). */
  valueEur: number;
  /** Σ over every line at list price (the prototype's figure: assemblies and their components both counted). */
  listValueEur: number;
  notValidated: number;
  outdatedOrObsolete: number;
  exportRestricted: number;
}

/** KPI figures of the BOM (`bomKpis` 4222) with the fixed value. */
export function bomSummary(lines: readonly BomSummaryInput[]): BomSummary {
  return {
    articles: lines.length,
    units: lines.reduce((s, l) => s + l.quantity, 0),
    valueEur: lines.filter((l) => !l.valuedByComponents).reduce((s, l) => s + bomLineTotal(l), 0),
    listValueEur: lines.reduce((s, l) => s + l.listPriceEur * l.quantity, 0),
    notValidated: lines.filter((l) => l.status === 'not_validated').length,
    outdatedOrObsolete: lines.filter((l) => l.status === 'outdated' || l.status === 'obsolete').length,
    exportRestricted: lines.filter((l) => !!l.exportRestriction).length,
  };
}

// ── Assembly tree ──────────────────────────────────────────────────────────────────────────────────────

export interface AssemblyNode {
  ref: string;
  /** Quantity per parent (the root: systems in the project). */
  q: number;
  children: AssemblyNode[];
}

/** The structure below `ref` (TREE 3421 from parent → child links); a reference already on the path ends the branch. */
export function buildAssembly(ref: string, q: number, childrenOf: ChildrenOf, path: readonly string[] = []): AssemblyNode {
  const here = [...path, ref];
  return { ref, q, children: childrenOf(ref).filter((c) => !here.includes(c.ref)).map((c) => buildAssembly(c.ref, c.q, childrenOf, here)) };
}

/** Rolled-up unit cost (`rollup` 4231): leaf = last purchase price, assembly = Σ child q × roll-up (own price ignored). */
export function rollupCost(n: AssemblyNode, lastPrice: (ref: string) => number): number {
  return n.children.length ? n.children.reduce((s, c) => s + c.q * rollupCost(c, lastPrice), 0) : lastPrice(n.ref);
}

/** Leaf parts below a node ("N parts", `countLeaves` 4232); 1 for a leaf. */
export function leafCount(n: AssemblyNode): number {
  return n.children.length ? n.children.reduce((s, c) => s + leafCount(c), 0) : 1;
}

export interface AssemblyRow {
  ref: string;
  depth: number;
  /** Quantity per parent. */
  qty: number;
  /** Total units in the project (q × parent extended). */
  extended: number;
  unitCostEur: number;
  /** unit × extended. */
  extendedCostEur: number;
  hasChildren: boolean;
  /** Ancestor refs from the root (empty for the root). */
  path: string[];
  /** Direct children ("N direct children"). */
  childCount: number;
  leafCount: number;
}

/** Every node, depth-first (`walk` 4233–4236, unfolded): the table rows of the assembly tree. */
export function assemblyRows(root: AssemblyNode, lastPrice: (ref: string) => number): AssemblyRow[] {
  const rows: AssemblyRow[] = [];
  const walk = (n: AssemblyNode, depth: number, mult: number, path: string[]) => {
    const ext = n.q * mult;
    const unit = rollupCost(n, lastPrice);
    rows.push({ ref: n.ref, depth, qty: n.q, extended: ext, unitCostEur: unit, extendedCostEur: unit * ext, hasChildren: n.children.length > 0, path, childCount: n.children.length, leafCount: leafCount(n) });
    n.children.forEach((c) => walk(c, depth + 1, ext, [...path, n.ref]));
  };
  walk(root, 0, 1, []);
  return rows;
}

/** Rows still shown when some assemblies are folded (`bomClosed`): a folded node hides its whole subtree. */
export function visibleAssemblyRows<T extends Pick<AssemblyRow, 'path'>>(rows: readonly T[], folded: ReadonlySet<string>): T[] {
  if (!folded.size) return rows.slice();
  return rows.filter((r) => !r.path.some((p) => folded.has(p)));
}

/** Every path from the root to `ref`, both included (`findPaths` 4239). */
export function assemblyPaths(root: AssemblyNode, ref: string): AssemblyNode[][] {
  const out: AssemblyNode[][] = [];
  const walk = (n: AssemblyNode, chain: AssemblyNode[]) => {
    const here = [...chain, n];
    if (n.ref === ref) out.push(here);
    n.children.forEach((c) => walk(c, here));
  };
  walk(root, []);
  return out;
}

/** Π q along a path ("32 per project", "Per project (× 8)"). */
export const pathQuantity = (path: readonly Pick<AssemblyNode, 'q'>[]) => path.reduce((a, x) => a * x.q, 1);

export interface NodeCost {
  unitCostEur: number;
  listPriceEur: number;
  /** Rolled-up − list. */
  deltaEur: number;
  /** Rolled-up above list (Delta in the attention colour). */
  overList: boolean;
  /** Π q along the first path from the root, the node included. */
  perProjectQty: number;
  perProjectCostEur: number;
}

/** Node drawer "Costed roll-up" (`nodeVals.cost` 4245). */
export function nodeCost(root: AssemblyNode, ref: string, listPriceEur: number, lastPrice: (ref: string) => number): NodeCost | null {
  const paths = assemblyPaths(root, ref);
  if (!paths.length) return null;
  const node = paths[0][paths[0].length - 1];
  const unit = rollupCost(node, lastPrice);
  const per = pathQuantity(paths[0]);
  return { unitCostEur: unit, listPriceEur, deltaEur: unit - listPriceEur, overList: unit > listPriceEur, perProjectQty: per, perProjectCostEur: unit * per };
}

// ── Where-used ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Part shown when the Where-used search is empty or matches nothing (`usedPart` 4248, 09 OQ22). R-169: the prototype's
 * constant CR-BRG-SKF is replaced by the data — the part of the current project used by the most projects (catalogue order
 * on a tie; EL-TRF-2MVA, used by HLT-026, NDC-031 and WSA-044, on the seed), else the catalogue's most used part, else none.
 */
export function defaultWhereUsedRef(parts: readonly { ref: string; usage: readonly { projectCode: string }[] }[], projectCode: string | null): string | null {
  const pick = (xs: readonly { ref: string; usage: readonly { projectCode: string }[] }[]) =>
    xs.reduce<{ ref: string; n: number } | null>((best, p) => (p.usage.length > (best?.n ?? 0) ? { ref: p.ref, n: p.usage.length } : best), null)?.ref ?? null;
  return (projectCode ? pick(parts.filter((p) => p.usage.some((u) => u.projectCode === projectCode))) : null) ?? pick(parts);
}

/** Where-used search (`usedPart` 4248): exact reference, else the first ref / name containing the query, else the default part, else the first. */
export function resolvePartQuery<T extends { ref: string; name: string }>(parts: readonly T[], query: string, fallbackRef: string | null = null): T | null {
  const q = query.trim().toUpperCase();
  return parts.find((p) => p.ref === q) ?? parts.find((p) => !!q && (p.ref.includes(q) || p.name.toUpperCase().includes(q))) ?? parts.find((p) => p.ref === fallbackRef) ?? parts[0] ?? null;
}

// ── Compare revisions ──────────────────────────────────────────────────────────────────────────────────

/** The new part of a comparison line ("ASM-DRV-700 / EL-HMI-10 → EL-HMI-15" → EL-HMI-15). */
export const diffNewRef = (path: string) => path.split(' / ').pop()!.split(' → ').pop()!;

/** The old part of a comparison line ("ASM-DRV-700 / EL-HMI-10 → EL-HMI-15" → EL-HMI-10); without "→", the same part as `diffNewRef`. */
export const diffOldRef = (path: string) => path.split(' / ').pop()!.split(' → ')[0];

/** Quantity change of a comparison line ("—" counts 0). */
export const diffQtyDelta = (from: number | null, to: number | null) => (to ?? 0) - (from ?? 0);

/**
 * Cost delta of a line (E-2b = a, R-104 — the 09 OQ8 "substitution at equal quantity costs 0" is closed): the new quantity
 * at the new part's price minus the old quantity at the old part's price, both valued by the E-2a rule (ordered, else last
 * purchase, else catalogue). A quantity line or an added line (same part, or no old quantity) gives the quantity change ×
 * the price, as before. Default beyond E-2b (which only defines the equal-quantity case): a substitution whose quantity also
 * changes uses the same formula. When the old price is unknown (`oldUnitEur` undefined / null — a part missing from the
 * catalogue), the quantity-only rule applies: never the whole new price.
 */
export function diffCostDelta(from: number | null, to: number | null, newUnitEur: number | null, oldUnitEur?: number | null): number {
  if (newUnitEur == null) return 0;
  if (oldUnitEur == null) return diffQtyDelta(from, to) * newUnitEur;
  return (to ?? 0) * newUnitEur - (from ?? 0) * oldUnitEur;
}

// ── PU/PR list ─────────────────────────────────────────────────────────────────────────────────────────

/** Systems in the project (`sysQty` 4259): the root's q for the complete system, else Π q down to the system (its own q included). */
export function systemQuantity(root: AssemblyNode, systemRef: string): number {
  if (systemRef === root.ref) return root.q;
  const p = assemblyPaths(root, systemRef)[0];
  return p ? pathQuantity(p) : 1;
}

export interface SpareInput {
  kind: WearSpare;
  recommendedQty: number;
  /** Σ on hand across every location. */
  inStock: number;
  leadWeeks: number | null;
  underChange: boolean;
  /** last purchase price × recommended quantity. */
  totalEur: number;
}

/** Long lead threshold of the PU/PR list ("Long lead (> 8 wks)"). */
export const LONG_LEAD_WEEKS = 8;

export interface SpareSummary {
  lines: number;
  wear: number;
  spare: number;
  valueEur: number;
  /** Lines whose stock is below the recommended quantity. */
  notInStock: number;
  longLead: number;
  underChange: number;
}

/** PU/PR KPI figures (`spKpis` 4264). */
export function spareSummary(rows: readonly SpareInput[]): SpareSummary {
  return {
    lines: rows.length,
    wear: rows.filter((r) => r.kind === 'PU').length,
    spare: rows.filter((r) => r.kind === 'PR').length,
    valueEur: rows.reduce((s, r) => s + r.totalEur, 0),
    notInStock: rows.filter((r) => r.inStock < r.recommendedQty).length,
    longLead: rows.filter((r) => (r.leadWeeks ?? 0) > LONG_LEAD_WEEKS).length,
    underChange: rows.filter((r) => r.underChange).length,
  };
}

/** Kind filter of the PU/PR list (`spareFilter`: null = All). */
export const filterSpares = <T extends { kind: WearSpare }>(rows: readonly T[], kind: WearSpare | null) => (kind ? rows.filter((r) => r.kind === kind) : rows.slice());

// ── Still-to-order shortfall (feeds the draft purchase orders) ─────────────────────────────────────────

export interface ShortfallInput {
  ref: string;
  name: string;
  makeBuy: PartMakeBuy;
  /** BOM quantity. */
  quantity: number;
  listPriceEur: number;
  /** Manufacturer / supplier the draft goes to. */
  supplier: string | null;
}

export interface ShortfallLine {
  ref: string;
  name: string;
  supplier: string | null;
  bomQty: number;
  orderedQty: number;
  need: number;
  listPriceEur: number;
  /** need × list price. */
  valueEur: number;
}

/**
 * BOM shortfall (`shortfall` 4327–4329): purchased articles of the BOM ordered less than their BOM quantity on the
 * project's non-cancelled orders (drafts included, stock not considered), BOM order; value at list price.
 * `orderedQty` = Σ line quantities per reference over those orders.
 */
export function bomShortfall(lines: readonly ShortfallInput[], orderedQty: Readonly<Record<string, number>>): { lines: ShortfallLine[]; valueEur: number } {
  const out = lines
    .filter((l) => l.quantity > 0 && l.makeBuy === 'purchased' && (orderedQty[l.ref] ?? 0) < l.quantity)
    .map((l) => {
      const ordered = orderedQty[l.ref] ?? 0;
      const need = l.quantity - ordered;
      return { ref: l.ref, name: l.name, supplier: l.supplier, bomQty: l.quantity, orderedQty: ordered, need, listPriceEur: l.listPriceEur, valueEur: l.listPriceEur * need };
    });
  return { lines: out, valueEur: out.reduce((s, l) => s + l.valueEur, 0) };
}

/** Σ ordered quantity per reference over orders that are not cancelled (`orderedQty` 4327). */
export function orderedQtyByRef(orders: readonly { cancelled: boolean; lines: readonly { ref: string; qty: number }[] }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const o of orders) if (!o.cancelled) for (const l of o.lines) m[l.ref] = (m[l.ref] ?? 0) + l.qty;
  return m;
}

/** One draft order per supplier (`createDrafts` 4330), suppliers in first-appearance order. */
export function groupBySupplier<T extends { supplier: string | null }>(lines: readonly T[]): { supplier: string | null; lines: T[] }[] {
  const m = new Map<string | null, T[]>();
  for (const l of lines) m.set(l.supplier, [...(m.get(l.supplier) ?? []), l]);
  return [...m.entries()].map(([supplier, ls]) => ({ supplier, lines: ls }));
}

export interface SpareShortfallInput {
  ref: string;
  recommendedQty: number;
  inStock: number;
  lastPriceEur: number;
  supplier: string | null;
}

/**
 * Spares package still to buy ("Create spares purchase order", 09 OQ20 / E-3 — not wired yet): lines whose stock is
 * below the recommended quantity, need = recommended − on hand, at last purchase price.
 */
export function spareShortfall(rows: readonly SpareShortfallInput[]): { ref: string; supplier: string | null; need: number; unitPriceEur: number; valueEur: number }[] {
  return rows
    .filter((r) => r.inStock < r.recommendedQty)
    .map((r) => {
      const need = r.recommendedQty - Math.max(0, r.inStock);
      return { ref: r.ref, supplier: r.supplier, need, unitPriceEur: r.lastPriceEur, valueEur: need * r.lastPriceEur };
    });
}

// ── Add article (AF.bom) ───────────────────────────────────────────────────────────────────────────────

export const BOM_SCOPES: readonly BomScope[] = ['keystone', 'client', 'overlay'];
export const NOTE_MAX = 500;

export interface NewBomLine {
  ref: string;
  quantity: number;
  activityCode: string | null;
  scope: BomScope;
  note: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** "1", "2.5", "2,5" → number; anything else → NaN. */
export function parseQuantity(raw: string): number {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/**
 * "Add article" form values (ref · qty · act · scope · note). The reference must be in the catalogue and not yet in
 * the project BOM; the quantity positive; the activity one of the offered activities (or none when none is offered);
 * the scope a known code. Errors are English source strings (translated by the caller).
 */
export function parseNewBomLine(
  values: Readonly<Record<string, string | undefined>>,
  ctx: { catalogue: ReadonlySet<string>; inBom: ReadonlySet<string>; activities: readonly string[] },
): Parsed<NewBomLine> {
  const ref = (values.ref ?? '').trim().toUpperCase();
  if (!ref) return { ok: false, error: 'The article reference is required' };
  if (!ctx.catalogue.has(ref)) return { ok: false, error: 'Unknown article reference' };
  if (ctx.inBom.has(ref)) return { ok: false, error: 'This article is already in the project BOM' };
  const qRaw = (values.qty ?? '').trim();
  const quantity = qRaw === '' ? 1 : parseQuantity(qRaw);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return { ok: false, error: 'Invalid quantity' };
  const act = (values.act ?? '').trim();
  let activityCode: string | null = null;
  if (act) {
    if (!ctx.activities.includes(act)) return { ok: false, error: 'Unknown activity' };
    activityCode = act;
  } else if (ctx.activities.length) {
    activityCode = ctx.activities[0];
  }
  const scope = (values.scope ?? 'keystone').trim() || 'keystone';
  if (!(BOM_SCOPES as readonly string[]).includes(scope)) return { ok: false, error: 'Invalid scope' };
  const note = (values.note ?? '').trim();
  if (note.length > NOTE_MAX) return { ok: false, error: 'The note is too long' };
  return { ok: true, value: { ref, quantity, activityCode, scope: scope as BomScope, note: note || null } };
}
