// Screen model of the Project BOM — equipment & parts (docs/spec/09 §1, template 1167–1311, logic 4206–4266): builds
// the translated, formatted view of the KPI tiles, the Display segment and the five displays (flat list, assembly tree
// + node drawer, where-used, compare revisions, PU/PR list) from the screen data (src/server/dal/bom-screen.ts) and
// the URL state (./links.ts). Pure: no I/O; golden-tested against the prototype's render values (bom.golden.json).
// Deliberate fixes (docs/spec/00 §7.16, 09 §13): the BOM value counts each article once; PU/PR stock is the real
// on-hand quantity; the lead-time column is titled "Lead time" (was "Discipline lead"); "Raise ECO" opens Vigie's
// new-ECO form (Vigie owns the ECOs) instead of setting an unused `ecoNew`; projects without a BOM show an empty list.
import { LO, OK, TAG_CLASS, lifecycleTone, statusTone } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  BOM_PRICE_SOURCE_LABEL, BOM_SORT_KEYS, ROLLUP_SOURCE_LABEL, assemblyPaths, bomSupplierOptions, bomTypeOptions, filterBomLines, filterSpares, nextBomSort, nodeCost,
  sortBomLines, spareSummary,
  type AssemblyNode, type BomSortKey,
} from '@/domain/bom';
import type { Lang, T } from '@/i18n/translate';
import { money, moneyEur } from '@/lib/format';
import { PART_STATUS_TAG, type PartStatus, type RevisionDiffKind, type WearSpare } from '@/server/db/codes';
import type { BomScreenData } from '@/server/dal/bom-screen';
import type { BomLine, BomTreeNode } from '@/server/dal/bom';
import { VIGIE_LINK_ATTRS, vigieNewEcoUrl } from '@/server/integrations/vigie/links';
import { bomHref, type BomState, type BomView } from './links';
import { PRICE_MASK } from '@/domain/rights';
import {
  bomTitleText, componentsText, countText, dataT, keepForInstalledBaseText, perCraneText, perProjectText, qtyText, signedEur, stockText, systemsText,
  unitsInTotalText, unitsText, wearSpareText, weeksText, wksText,
} from './i18n';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface TagView {
  label: string;
  /** "tag tag-accent" … */
  cls: string;
}

export interface LinkOption {
  value: string;
  label: string;
  href: string;
  active: boolean;
}

/** Part status tag (`partTag` 4176). */
const partTag = (status: PartStatus, label: string, t: T): TagView => ({ label: t(label), cls: `tag ${PART_STATUS_TAG[status]}` });
/** PU/PR tag (`puTag` 4181): PU accent, PR outline, "—" neutral. */
const puTag = (v: WearSpare | null): TagView => ({ label: v ?? '—', cls: v ? TAG_CLASS[statusTone('wearSpare', v)] : 'tag tag-neutral' });
/** Keystone's ECO screen with the ECO selected (`openEcoScreen`): progress is recorded there and sent to Vigie. */
export const ecoScreenHref = (number: string) => `${screenHref('eco')}?eco=${encodeURIComponent(number)}`;

// ── Header: KPI tiles and Display segment ──────────────────────────────────────────────────────────────

/** KPI tiles (`bomKpis` 4222) — the BOM value counts each article once (09 OQ6). */
export function bomKpiView(s: BomScreenData['bom']['summary'], t: T, lang: Lang, prices = true): KpiView[] {
  return [
    { label: t('Articles'), value: String(s.articles), sub: unitsInTotalText(s.units, lang), color: OK },
    // E-2a = a (R-103): valued at the ordered price, else the last purchase price, else the catalogue price; R-046 masks it.
    { label: t('BOM value'), value: prices ? money(s.valueEur / 1000, lang) : PRICE_MASK, sub: t('Ordered, else last purchase, else catalogue price'), color: OK },
    { label: t('Not validated'), value: String(s.notValidated), sub: t('Blocked for purchasing'), color: s.notValidated ? LO : OK },
    { label: t('Outdated / obsolete'), value: String(s.outdatedOrObsolete), sub: t('Replace before ordering'), color: s.outdatedOrObsolete ? LO : OK },
    { label: t('Export-restricted'), value: String(s.exportRestricted), sub: t('Lines needing customs review'), color: OK },
  ];
}

const VIEW_LABEL: Record<BomView, string> = { flat: 'Flat list', tree: 'Assembly tree', used: 'Where-used', compare: 'Compare revisions', spares: 'PU/PR list' };

/** Display segment (`bomViewSeg` 4227): switching view closes the node and part drawers, keeps the filters. */
export function viewSegView(code: string, state: BomState, t: T): LinkOption[] {
  return (Object.keys(VIEW_LABEL) as BomView[]).map((v) => ({
    value: v, label: t(VIEW_LABEL[v]), href: bomHref(code, { ...state, view: v, node: null, part: null }), active: state.view === v,
  }));
}

// ── Flat list ──────────────────────────────────────────────────────────────────────────────────────────

export interface SortHeaderView {
  key: BomSortKey;
  label: string;
  href: string;
  /** Active column and its direction; null = inactive (caret up-down). */
  dir: 'asc' | 'desc' | null;
  align?: 'right';
}

export interface FlatRowView {
  ref: string;
  /** Toggles the part record drawer (`selectPart`). */
  href: string;
  selected: boolean;
  name: string;
  /** "Manufacturer · manufacturer ref". */
  sub: string;
  type: string;
  makeBuy: string;
  pu: TagView;
  qty: string;
  /** Valuation unit price (E-2a) and where it comes from ("Ordered price", "Last purchase price", "Catalogue price"). */
  price: string;
  priceSource: string;
  /** "Catalogue price: €48" when the valuation is not the catalogue price; null otherwise. */
  priceTitle: string | null;
  total: string;
  /** Assembly valued through its components: its total is not added to the BOM value (09 OQ6). */
  totalNote: string | null;
  status: TagView;
  /** Open ECO touching the part (Vigie), opened on the ECO screen. */
  eco: { number: string; href: string } | null;
  restriction: string;
  restricted: boolean;
  alsoUsedIn: string;
}

export interface FlatView {
  q: string;
  searchPlaceholder: string;
  typeLabel: string;
  typeOptions: LinkOption[];
  supplierLabel: string;
  supplierOptions: LinkOption[];
  /** "Clear filters" target when a filter is set. */
  clearHref: string | null;
  clearLabel: string;
  count: string;
  title: string;
  hint: string;
  headers: SortHeaderView[];
  /** Static headers (Make / buy, PU/PR, Qty, Unit price, Restrictions, Also used in). */
  labels: Record<'makeBuy' | 'pu' | 'qty' | 'price' | 'restrictions' | 'alsoUsedIn', string>;
  rows: FlatRowView[];
  /** Empty-list message (project without a BOM, or no match). */
  empty: string | null;
}

const SORT_LABEL: Record<BomSortKey, string> = { ref: 'Reference', name: 'Article', type: 'Type', total: 'Total', status: 'Status' };

/** Flat list (1179–1209; `bomRows`, `bomFilterVals` 4206–4220). */
export function flatView(code: string, state: BomState, lines: readonly BomLine[], t: T, lang: Lang, prices = true): FlatView {
  const eur = priceText(prices, lang);
  const types = bomTypeOptions(lines);
  const suppliers = bomSupplierOptions(lines);
  // A type or supplier the BOM does not have (stale link, other project) falls back to "All".
  const type = types.some((o) => o.value === state.type) ? state.type : null;
  const mfr = suppliers.some((o) => o.value === state.mfr) ? state.mfr : null;
  const shown = sortBomLines(filterBomLines(lines, { q: state.q, type, mfr }), state.sort);
  const keep = { ...state, type, mfr, part: null, node: null };
  const typeOptions: LinkOption[] = [
    { value: '', label: t(`All types · ${lines.length}`), href: bomHref(code, { ...keep, type: null }), active: !type },
    ...types.map((o) => ({ value: o.value, label: t(`${o.label} · ${o.count}`), href: bomHref(code, { ...keep, type: o.value }), active: type === o.value })),
  ];
  const supplierOptions: LinkOption[] = [
    { value: '', label: t(`All suppliers · ${lines.length}`), href: bomHref(code, { ...keep, mfr: null }), active: !mfr },
    ...suppliers.map((o) => ({ value: o.value, label: `${o.label} · ${o.count}`, href: bomHref(code, { ...keep, mfr: o.value }), active: mfr === o.value })),
  ];
  const hasFilter = !!(state.q || type || mfr);
  const headers = BOM_SORT_KEYS.map((key) => ({
    key, label: t(SORT_LABEL[key]), href: bomHref(code, { ...keep, sort: nextBomSort(state.sort, key) }),
    dir: state.sort.key === key ? state.sort.dir : null, ...(key === 'total' ? { align: 'right' as const } : {}),
  }));
  const rows = shown.map((l): FlatRowView => ({
    ref: l.ref,
    href: bomHref(code, { ...state, node: null, part: state.part === l.ref ? null : l.ref }),
    selected: state.part === l.ref,
    name: dataT(l.name, lang),
    sub: `${l.manufacturer ?? ''} · ${l.manufacturerRef ?? ''}`,
    type: t(l.typeLabel),
    makeBuy: t(l.makeBuyLabel),
    pu: puTag(l.wearSpare),
    qty: qtyText(l.quantity, lang),
    price: eur(l.unitPriceEur),
    priceSource: t(BOM_PRICE_SOURCE_LABEL[l.priceSource]),
    priceTitle: prices && l.priceSource !== 'catalogue' ? `${t('Catalogue price')}: ${moneyEur(l.listPriceEur, lang)}` : null,
    total: eur(l.totalEur),
    totalNote: l.valuedByComponents ? t('Valued through its components — not added to the BOM value') : null,
    status: partTag(l.status, l.statusLabel, t),
    eco: l.openEco ? { number: l.openEco, href: ecoScreenHref(l.openEco) } : null,
    restriction: l.exportRestriction ? dataT(l.exportRestriction, lang) : '—',
    restricted: !!l.exportRestriction,
    alsoUsedIn: l.alsoUsedIn.join(', ') || '—',
  }));
  return {
    q: state.q,
    searchPlaceholder: t('Search reference, article, manufacturer ref'),
    typeLabel: t('Type'),
    typeOptions,
    supplierLabel: t('Supplier'),
    supplierOptions,
    clearHref: hasFilter ? bomHref(code, { ...keep, q: '', type: null, mfr: null }) : null,
    clearLabel: t('Clear filters'),
    count: countText(shown.length, lines.length, t),
    title: bomTitleText(shown.length, t),
    hint: t('Click an article for its full record'),
    headers,
    labels: { makeBuy: t('Make / buy'), pu: 'PU/PR', qty: t('Qty'), price: t('Unit price'), restrictions: t('Restrictions'), alsoUsedIn: t('Also used in') },
    rows,
    empty: !lines.length ? t('No article is registered in this project’s BOM yet') : !rows.length ? t('No article matches') : null,
  };
}

// ── Assembly tree and node drawer ──────────────────────────────────────────────────────────────────────

export interface TreeRowView {
  ref: string;
  name: string;
  depth: number;
  /** Ancestor refs (folding hides a row whose ancestor is folded). */
  path: string[];
  hasChildren: boolean;
  qty: string;
  ext: string;
  makeBuy: string;
  pu: TagView;
  rev: string;
  status: TagView;
  unit: string;
  /** Source of the unit cost (E-2a): a leaf's price basis, "Roll-up of components" for an assembly. */
  unitSource: string;
  total: string;
  /** Opens the node drawer (`bomNode`). */
  href: string;
  selected: boolean;
}

export interface TreeView {
  title: string;
  hint: string;
  labels: Record<'refArticle' | 'qty' | 'ext' | 'makeBuy' | 'pu' | 'rev' | 'status' | 'unit' | 'total' | 'fold' | 'unfold', string>;
  rows: TreeRowView[];
}

/** Assembly tree (1210–1232; `treeRows` 4231–4237). */
export function treeView(code: string, state: BomState, rows: readonly BomTreeNode[], t: T, lang: Lang, prices = true): TreeView {
  const eur = priceText(prices, lang);
  return {
    title: t('Assembly tree'),
    hint: t('Click a line for its detail · caret to fold'),
    labels: {
      refArticle: t('Reference · article'), qty: t('Qty'), ext: t('Extended'), makeBuy: t('Make / buy'), pu: 'PU/PR', rev: t('Rev'), status: t('Status'),
      unit: t('Unit cost'), total: t('Extended cost'), fold: t('Fold'), unfold: t('Unfold'),
    },
    rows: rows.map((n) => ({
      ref: n.ref, name: dataT(n.name, lang), depth: n.depth, path: n.path, hasChildren: n.children.length > 0, qty: qtyText(n.qty, lang), ext: qtyText(n.extended, lang),
      makeBuy: t(n.makeBuyLabel), pu: puTag(n.wearSpare), rev: n.revision ?? '—', status: partTag(n.status, n.statusLabel, t),
      unit: eur(n.unitCostEur), unitSource: t(n.priceSource === 'rollup' ? ROLLUP_SOURCE_LABEL : BOM_PRICE_SOURCE_LABEL[n.priceSource]),
      total: eur(n.extendedCostEur),
      href: bomHref(code, { ...state, part: null, node: n.ref }), selected: state.node === n.ref,
    })),
  };
}

export interface KeyValueView {
  k: string;
  v: string;
  color?: string;
}

export interface NodeDrawerView {
  ref: string;
  name: string;
  status: TagView;
  identTitle: string;
  ident: KeyValueView[];
  costTitle: string;
  cost: KeyValueView[];
  usedInTitle: string;
  parents: string[];
  closeHref: string;
  /** "Part record": the part drawer over the flat list (`{part, bomView:'flat'}`). */
  partHref: string;
  partLabel: string;
  /** "Drawings": the PDM vault searched on the reference (`{screen:'drawings', dwgQ}`). */
  drawingsHref: string;
  drawingsLabel: string;
  /**
   * "Raise ECO": Vigie's new-ECO form prefilled with the part and the project (opens outside Keystone, title says so);
   * null when the viewer's workspace has no ECO screen — the same rule as the part drawer's "Raise ECO".
   */
  raiseEco: { href: string; label: string; title: string; target: string; rel: string } | null;
}

/** Node drawer (1233–1243; `nodeVals` 4242–4247). */
export function nodeDrawerView(
  code: string,
  state: BomState,
  data: { rows: readonly BomTreeNode[]; structure: AssemblyNode },
  opts: Pick<BomViewOpts, 'canRaiseEco' | 'prices'>,
  t: T,
  lang: Lang,
): NodeDrawerView | null {
  const prices = opts.prices !== false;
  const eur = priceText(prices, lang);
  const n = state.node ? data.rows.find((r) => r.ref === state.node) : undefined;
  if (!n) return null;
  // A leaf's roll-up is its valuation (E-2a: ordered, else last purchase, else catalogue); the domain rolls the assembly up.
  const rolled = new Map(data.rows.map((r) => [r.ref, r.unitCostEur]));
  const c = nodeCost(data.structure, n.ref, n.listPriceEur, (r) => rolled.get(r) ?? 0)!;
  const paths = assemblyPaths(data.structure, n.ref);
  return {
    ref: n.ref,
    name: dataT(n.name, lang),
    status: partTag(n.status, n.statusLabel, t),
    identTitle: t('Identification'),
    ident: [
      { k: t('Revision'), v: n.revision ?? '—' },
      { k: t('Make / buy'), v: t(n.makeBuyLabel) },
      { k: t('Manufacturer'), v: n.manufacturer ?? '—' },
      { k: t('Drawing / ref.'), v: n.manufacturerRef ?? '—' },
      { k: t('Lead time'), v: weeksText(n.leadWeeks, lang) },
      { k: t('Components'), v: componentsText(n.leafCount, n.children.length, t, lang) },
    ],
    costTitle: t('Costed roll-up'),
    cost: [
      { k: t('Rolled-up cost'), v: eur(c.unitCostEur) },
      { k: t('Price basis'), v: t(n.priceSource === 'rollup' ? ROLLUP_SOURCE_LABEL : BOM_PRICE_SOURCE_LABEL[n.priceSource]) },
      { k: t('List / standard price'), v: eur(c.listPriceEur) },
      { k: t('Delta'), v: prices ? signedEur(c.deltaEur, lang) : PRICE_MASK, color: prices && c.overList ? LO : undefined },
      { k: t(`Per project (× ${c.perProjectQty})`), v: eur(c.perProjectCostEur) },
    ],
    usedInTitle: t('Used in'),
    parents: paths.map((p) => p.slice(0, -1).map((x) => x.ref).join(' › ') || t('Top level')),
    closeHref: bomHref(code, { ...state, node: null }),
    partHref: bomHref(code, { ...state, view: 'flat', node: null, part: n.ref }),
    partLabel: t('Part record'),
    drawingsHref: `${screenHref('drawings')}?q=${encodeURIComponent(n.ref)}`,
    drawingsLabel: t('Drawings'),
    raiseEco: opts.canRaiseEco
      ? { href: vigieNewEcoUrl({ partRef: n.ref, projectCode: code }), label: t('Raise ECO'), title: t('Opens Vigie’s new ECO form, prefilled with this part'), ...VIGIE_LINK_ATTRS }
      : null,
  };
}

// ── Where-used ─────────────────────────────────────────────────────────────────────────────────────────

export interface WhereUsedView {
  title: string;
  sub: string;
  placeholder: string;
  q: string;
  part: { ref: string; name: string; status: TagView; equivalents: string };
  equivalentsLabel: string;
  pathsTitle: string;
  paths: { chain: string; qty: string }[];
  noPaths: string | null;
  projectsTitle: string;
  projects: { code: string; name: string; qty: string; stage: TagView }[];
  ordersTitle: string;
  orders: { number: string; text: string; status: string }[];
  noOrders: string | null;
}

/** Where-used (1247–1265; `usedVals` 4248–4254). */
export function whereUsedView(state: BomState, w: NonNullable<BomScreenData['whereUsed']>, t: T, lang: Lang): WhereUsedView {
  return {
    title: t('Where-used'),
    sub: t('Every assembly path, project and open order that carries the part'),
    placeholder: t('Part reference or name'),
    q: state.used,
    part: { ref: w.part.ref, name: dataT(w.part.name, lang), status: partTag(w.part.status, w.part.statusLabel, t), equivalents: w.part.equivalents.join(', ') || '—' },
    equivalentsLabel: t('Equivalents:'),
    pathsTitle: t('Assembly paths'),
    paths: w.paths.map((p) => ({ chain: p.chain.map((c) => `${c.ref} ×${c.qty}`).join('  ›  '), qty: perProjectText(p.perProject, lang) })),
    noPaths: w.paths.length ? null : t('Not part of an assembly in this project'),
    projectsTitle: t('Projects'),
    projects: w.projects.map((p) => ({ code: p.code, name: dataT(p.name, lang), qty: unitsText(p.quantity, lang), stage: { label: t(p.stageLabel), cls: TAG_CLASS[lifecycleTone(p.stage)] } })),
    ordersTitle: t('Purchase orders'),
    orders: w.purchaseOrders.map((o) => ({ number: o.number, text: `${o.supplier} · ${o.projectCode}`, status: t(o.statusLabel) })),
    noOrders: w.purchaseOrders.length ? null : t('No open order'),
  };
}

// ── Compare revisions ──────────────────────────────────────────────────────────────────────────────────

export interface CompareView {
  title: string;
  sub: string;
  totalLabel: string;
  total: string;
  labels: Record<'line' | 'article' | 'from' | 'to' | 'change' | 'delta', string>;
  /** `deltaTitle`: the unit price and its basis behind the delta (E-2a), null when the line has no price. */
  rows: { line: string; name: string; a: string; b: string; kind: TagView; delta: string; deltaTitle: string | null }[];
}

const DIFF_TAG: Record<RevisionDiffKind, string> = { added: 'tag tag-accent', substitution: 'tag tag-outline', quantity: 'tag tag-neutral' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-12" → "12 Sep 2026". */
const dayMonthYear = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** Compare revisions (1266–1276; `cmpVals` 4266). */
export function compareView(c: NonNullable<BomScreenData['comparison']>, t: T, lang: Lang, prices = true): CompareView {
  const rev = t('Rev');
  return {
    title: t(`${c.assemblyRef} · rev ${c.fromRevision} → rev ${c.toRevision}`),
    sub: t(c.ecoNumber ? `${dayMonthYear(c.date)} · ${c.ecoNumber}` : dayMonthYear(c.date)),
    totalLabel: t('Cost delta'),
    total: prices ? perCraneText(c.totalDeltaEur, lang) : PRICE_MASK,
    labels: { line: t('Line'), article: t('Article'), from: `${rev} ${c.fromRevision}`, to: `${rev} ${c.toRevision}`, change: t('Change'), delta: t('Cost delta') },
    rows: c.lines.map((l) => ({
      line: l.path, name: dataT(l.name, lang), a: l.qtyFrom == null ? '—' : qtyText(l.qtyFrom, lang), b: l.qtyTo == null ? '—' : qtyText(l.qtyTo, lang),
      kind: { label: t(l.kindLabel), cls: DIFF_TAG[l.kind] }, delta: l.deltaEur ? (prices ? signedEur(l.deltaEur, lang) : PRICE_MASK) : '—',
      deltaTitle: prices && l.unitPriceEur != null && l.priceSource ? `${moneyEur(l.unitPriceEur, lang)} · ${t(BOM_PRICE_SOURCE_LABEL[l.priceSource])}` : null,
    })),
  };
}

// ── PU/PR list ─────────────────────────────────────────────────────────────────────────────────────────

export interface SpareRowView {
  ref: string;
  href: string;
  selected: boolean;
  name: string;
  /** "Keep for the installed base · 2 machines · ECO-2026-014" → the first pinning ECO. */
  pinned: { text: string; href: string } | null;
  kind: TagView;
  qPer: string;
  qTotal: string;
  note: string;
  price: string;
  total: string;
  lead: string;
  stock: string;
  /** Stock below the recommended quantity (attention colour). */
  stockShort: boolean;
  status: TagView;
}

export interface SparesView {
  kpis: KpiView[];
  systemLabel: string;
  systems: LinkOption[];
  kindLabel: string;
  kinds: LinkOption[];
  legend: string;
  title: string;
  sub: string;
  createOrderLabel: string;
  exportLabel: string;
  labels: Record<'ref' | 'article' | 'pu' | 'qPer' | 'qTotal' | 'note' | 'price' | 'total' | 'lead' | 'stock' | 'status', string>;
  rows: SpareRowView[];
  empty: string | null;
}

/** PU/PR list (1277–1307; `spKpis`, `spSeg`, `spChips`, `spareRows` 4255–4265) — stock is Σ on hand (00 §7.16). */
export function sparesView(code: string, state: BomState, sl: NonNullable<BomScreenData['spares']>, t: T, lang: Lang, prices = true): SparesView {
  const eur = priceText(prices, lang);
  const rows = filterSpares(sl.rows, state.kind);
  const s = spareSummary(rows);
  const root = sl.systems.find((x) => x.isRoot)?.ref ?? null;
  // Links carry the system actually shown (a stale `?sys=` resolved to the complete system is dropped).
  const keep = { ...state, sys: sl.system === root ? null : sl.system, part: null, node: null };
  return {
    kpis: [
      { label: t('Lines'), value: String(s.lines), sub: wearSpareText(s.wear, s.spare, lang), color: OK },
      { label: t('Recommended package'), value: prices ? money(s.valueEur / 1000, lang) : PRICE_MASK, sub: systemsText(sl.systemQty, t), color: OK },
      { label: t('Not in stock'), value: String(s.notInStock), sub: t('Lines below recommended quantity'), color: s.notInStock ? LO : OK },
      { label: t('Long lead (> 8 wks)'), value: String(s.longLead), sub: t('Order with the main equipment'), color: OK },
      { label: t('Under change'), value: String(s.underChange), sub: t('Frozen by an open ECO'), color: s.underChange ? LO : OK },
    ],
    systemLabel: t('System'),
    systems: sl.systems.map((x) => ({
      value: x.ref, label: x.isRoot ? t('Complete system') : dataT(x.name, lang), href: bomHref(code, { ...keep, sys: x.ref === root ? null : x.ref }), active: x.ref === sl.system,
    })),
    kindLabel: t('Kind'),
    kinds: ([null, 'PU', 'PR'] as const).map((k) => ({
      value: k ?? '', label: t(k === 'PU' ? 'Wear parts (PU)' : k === 'PR' ? 'Spare parts (PR)' : 'All'), href: bomHref(code, { ...keep, kind: k }), active: state.kind === k,
    })),
    legend: t('PU = wear part, replaced on a schedule · PR = spare part, held for breakdowns · quantities per system × systems in the project'),
    title: `${t('Recommended wear & spare parts')} — ${dataT(sl.systemName, lang)}`,
    sub: t('Linked to the system in the catalogue · handed over with the equipment · stock checked against recommended quantity'),
    createOrderLabel: t('Create spares purchase order'),
    exportLabel: t('Export list'),
    labels: {
      ref: t('Reference'), article: t('Article'), pu: 'PU/PR', qPer: t('Qty per system'), qTotal: t('Recommended qty'), note: t('Replacement / note'),
      price: t('Unit price'), total: t('Total'), lead: t('Lead time'), stock: t('Stock'), status: t('Status'),
    },
    rows: rows.map((r) => ({
      ref: r.ref,
      href: bomHref(code, { ...keep, part: state.part === r.ref ? null : r.ref }),
      selected: state.part === r.ref,
      name: dataT(r.name, lang),
      pinned: r.pinSummary ? { text: keepForInstalledBaseText(r.pinSummary.machines, r.pinSummary.ecos, t), href: ecoScreenHref(r.pinSummary.firstEco!) } : null,
      kind: puTag(r.kind),
      qPer: qtyText(r.qtyPerSystem, lang),
      qTotal: qtyText(r.recommendedQty, lang),
      note: r.note ? dataT(r.note, lang) : '—',
      price: eur(r.lastPriceEur),
      total: eur(r.totalEur),
      lead: wksText(r.leadWeeks, lang),
      stock: stockText(r.inStock, t, lang),
      stockShort: r.inStock < r.recommendedQty,
      status: partTag(r.status, r.statusLabel, t),
    })),
    empty: rows.length ? null : t('No wear or spare part registered for this system'),
  };
}

// ── The whole screen ───────────────────────────────────────────────────────────────────────────────────

export interface BomScreenView {
  code: string;
  state: BomState;
  kpis: KpiView[];
  displayLabel: string;
  views: LinkOption[];
  note: string;
  flat: FlatView | null;
  tree: TreeView | null;
  node: NodeDrawerView | null;
  used: WhereUsedView | null;
  compare: CompareView | null;
  spares: SparesView | null;
  /** "No multi-level assembly is registered…" (`bomNoTree`: no structure and a view other than the flat list). */
  noTree: string | null;
}

export interface BomViewOpts {
  /** The viewer may edit the BOM (not outside, project not read-only). */
  canEdit: boolean;
  /**
   * The viewer may raise an ECO — in Vigie, which owns the ECOs: the ECO screen is in their workspace (ECOs are
   * portfolio-wide, so a read-only project does not prevent it). Same rule as the part drawer.
   */
  canRaiseEco: boolean;
  /** Prices, costs and values shown (R-046, NEW-D2-1: director, PMs, procurement); masked otherwise. Default true. */
  prices?: boolean;
}

/** A price, or the mask for a viewer who may not see supplier prices (R-046). */
const priceText = (prices: boolean, lang: Lang) => (v: number) => (prices ? moneyEur(v, lang) : PRICE_MASK);

/** View model of /projects/[code]/bom. */
export function bomScreenView(code: string, state: BomState, data: BomScreenData, opts: BomViewOpts, t: T, lang: Lang): BomScreenView {
  const v = state.view;
  const prices = opts.prices !== false;
  return {
    code,
    state,
    kpis: bomKpiView(data.bom.summary, t, lang, prices),
    displayLabel: t('Display'),
    views: viewSegView(code, state, t),
    // E-2a (R-103): the roll-ups use the BOM valuation (the prototype's template said "the last purchase price").
    note: t('Roll-ups use the ordered price, else the last purchase price, else the catalogue price'),
    flat: v === 'flat' ? flatView(code, state, data.bom.lines, t, lang, prices) : null,
    tree: v === 'tree' && data.assembly ? treeView(code, state, data.assembly.rows, t, lang, prices) : null,
    node: v === 'tree' && data.assembly ? nodeDrawerView(code, state, data.assembly, opts, t, lang) : null,
    used: v === 'used' && data.whereUsed ? whereUsedView(state, data.whereUsed, t, lang) : null,
    compare: v === 'compare' && data.comparison ? compareView(data.comparison, t, lang, prices) : null,
    spares: v === 'spares' && data.spares ? sparesView(code, state, data.spares, t, lang, prices) : null,
    noTree: !data.bom.hasTree && v !== 'flat' ? t('No multi-level assembly is registered for this project — the flat list is the full BOM.') : null,
  };
}
