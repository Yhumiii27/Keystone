// View models of Stock & storages (docs/spec/08 §4, template 1658–1714, logic 4469–4492): KPI tiles, location chips,
// stock rows, recent movements and the stock-line drawer, translated. Built from the DAL rows with the pure rules of
// src/domain/stock.ts.
import { LO, OK } from '@/components/app/tones';
import {
  availableQty, filterStockLines, isBelowMin, lineStockOps, lineValueEur, locationChipCounts, pinnedText, quantityLabel, reservedForOthers, reservedText,
  stockFigures, transferTargetOptions, type StockOperation,
} from '@/domain/stock';
import type { Lang, T } from '@/i18n/translate';
import { money, moneyEur } from '@/lib/format';
import { fmtDOfIso, stockOperation } from '@/server/db/codes';
import type { InstalledBasePin } from '@/server/dal/eco';
import type { MovementRow, StockPositionDetail, StockRow, X3StockSync } from '@/server/dal/stock';
import type { StorageLocationRow } from '@/server/dal/suppliers';
import { linesLocationsText, moveTypeT, qtyText, scrapWarnT, whereT, x3LinesText } from './i18n';
import { ecoHref, stockHref, type StockUrlState } from './links';
import { PRICE_MASK } from '@/domain/rights';
import { dataText } from '@/i18n/data-text';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ChipView {
  value: string;
  label: string;
  count: string;
  href: string;
}

export interface StockRowView {
  id: string;
  ref: string;
  name: string;
  /** "Keep for the installed base · 1 machine · ECO-2026-015" (translated) or null. */
  pinned: string | null;
  location: string;
  locationType: string;
  onHand: string;
  /** "4 · HLT" or "—". */
  reserved: string;
  available: string;
  availableColor: string;
  /** Min or "—". */
  min: string;
  belowMin: boolean;
  value: string;
  source: string;
  sourceTone: 'neutral' | 'accent';
  last: string;
  selected: boolean;
  /** Toggles the drawer (`?stock=`). */
  href: string;
}

export interface MoveView {
  key: string;
  type: string;
  ref: string;
  qty: string;
  where: string;
  who: string;
  when: string;
}

export interface StockScreenView {
  kpis: KpiView[];
  chips: ChipView[];
  /** Selected chip value ('' = All locations). */
  chipValue: string;
  rows: StockRowView[];
  /** "No stock line matches" or null. */
  empty: string | null;
  moves: MoveView[];
}

/** Display date of a stock line / movement day ("12 Sep" → FR "12 sept."). */
const dayT = (iso: string, t: T) => t(fmtDOfIso(iso));

const pinOf = (pins: Record<string, InstalledBasePin[]>, ref: string) => {
  const ps = pins[ref];
  if (!ps?.length) return null;
  const ecos = [...new Set(ps.map((p) => p.eco))];
  return { text: pinnedText({ machines: new Set(ps.map((p) => p.machine)).size, ecos }), firstEco: ecos[0] };
};

export function moveView(m: MovementRow, t: T, lang: Lang, i: number): MoveView {
  return { key: `${m.occurredAt}-${i}`, type: moveTypeT(m.typeLabel, t, lang), ref: m.ref, qty: qtyText(m.qty, lang), where: whereT(m.where, lang), who: m.who, when: t(m.when) };
}

/** R-034: KPI sub-line and drawer note when Sage X3 is not connected (production database). */
export const X3_OFF_TEXT = 'Sage X3 not connected';
export const X3_OFF_NOTE = 'Sage X3 not connected · movements are recorded in Keystone only';

export function stockScreenView(
  input: {
    rows: StockRow[]; locations: StorageLocationRow[]; sync: X3StockSync | null; moves: MovementRow[]; pins: Record<string, InstalledBasePin[]>; state: StockUrlState;
    /** Stock values at purchase price shown (R-046, NEW-D2-1: director, PMs, procurement); masked otherwise. Default true. */
    prices?: boolean;
    /** R-034: the simulated X3 exchange is available (demo database); false = "Sage X3 not connected". Default true. */
    x3?: boolean;
  },
  t: T,
  lang: Lang,
): StockScreenView {
  const { rows, locations, sync, moves, pins, state } = input;
  const prices = input.prices !== false;
  const x3 = input.x3 !== false;
  const names = locations.map((l) => l.name);
  const f = stockFigures(rows, names.length);
  const kpis: KpiView[] = [
    { label: t('Stock value'), value: prices ? money(f.valueEur / 1000, lang) : PRICE_MASK, sub: linesLocationsText(f.lines, f.locations, lang), color: OK },
    { label: t('Below minimum'), value: String(f.belowMin), sub: t('Reorder or transfer'), color: f.belowMin ? LO : OK },
    { label: t('In quarantine'), value: qtyText(f.quarantineQty, lang), sub: t('Awaiting quality decision'), color: OK },
    // R-034: without the X3 simulation (production database) nothing is imported from nor pushed back to Sage X3.
    { label: t('X3 import'), value: sync?.time ?? '—', sub: x3 ? x3LinesText(f.x3Lines, lang) : t(X3_OFF_TEXT), color: OK },
    { label: t('Local changes'), value: String(f.localLines), sub: x3 ? t('To push back to X3') : t(X3_OFF_TEXT), color: f.localLines && x3 ? LO : OK },
  ];
  const chips = locationChipCounts(rows, names).map((c) => ({
    value: c.location ?? '',
    label: c.location ?? t('All locations'),
    count: String(c.count),
    href: stockHref({ ...state, loc: c.location, part: null }),
  }));
  // The search matches the part name as stored and as shown (its exact French entry, if any — R-148).
  const searchable = rows.map((r) => ({ id: r.id, ref: r.ref, location: r.location, name: lang === 'en' ? r.name : `${r.name} ${dataText(r.name, lang)}` }));
  const keep = new Set(filterStockLines(searchable, { location: state.loc, q: state.q }).map((r) => r.id));
  const shown = rows.filter((r) => keep.has(r.id));
  return {
    kpis,
    chips,
    chipValue: state.loc ?? '',
    rows: shown.map((r) => rowView(r, pins, state, t, lang, prices)),
    empty: shown.length ? null : t('No stock line matches'),
    moves: moves.slice(0, 8).map((m, i) => moveView(m, t, lang, i)),
  };
}

function rowView(r: StockRow, pins: Record<string, InstalledBasePin[]>, state: StockUrlState, t: T, lang: Lang, prices = true): StockRowView {
  const selected = state.stock === r.id;
  const pin = pinOf(pins, r.ref);
  const avail = availableQty(r);
  return {
    id: r.id,
    ref: r.ref,
    name: dataText(r.name, lang),
    pinned: pin ? t(pin.text) : null,
    location: r.location,
    locationType: t(r.locationTypeLabel),
    onHand: qtyText(r.onHand, lang),
    reserved: reservedText(r.reserved, r.reservedForShort, (n) => qtyText(n, lang)),
    available: qtyText(avail, lang),
    availableColor: avail < 0 ? LO : OK,
    min: r.minQty ? String(r.minQty) : '—',
    belowMin: isBelowMin(r),
    value: prices ? moneyEur(lineValueEur(r), lang) : PRICE_MASK,
    source: t(r.sourceLabel),
    sourceTone: r.source === 'x3' ? 'neutral' : 'accent',
    last: dayT(r.lastMovementOn, t),
    selected,
    href: stockHref({ ...state, stock: selected ? null : r.id, part: null }),
  };
}

// ── Stock-line drawer ──────────────────────────────────────────────────────────────────────────────────

export interface StockDrawerView {
  id: string;
  ref: string;
  /** "KS-STL-0450 · Entrepôt central — Lyon". */
  header: string;
  name: string;
  locationType: string;
  source: string;
  sourceTone: 'neutral' | 'accent';
  /** Changed in Keystone, not yet pushed ("Push to X3" has something to send). */
  isLocal: boolean;
  /** R-034: "Push to X3" offered at all (the simulated exchange is available: demo database). */
  canPush: boolean;
  /** Note under the movement form (the X3 hand-back, or "Sage X3 not connected"). */
  x3Note: string;
  meta: { k: string; v: string }[];
  ops: { value: StockOperation; label: string; qtyLabel: string }[];
  targets: { value: string; label: string; title: string }[];
  /** Activities of the current project's plan an issue names (required, SC-5a) or a return credits (optional). */
  activities: { value: string; label: string }[];
  /** Current project code (reserve, issue, return), null when none. */
  projectCode: string | null;
  /**
   * The line holds units reserved for another project than the current one (R-099): its code and the quantity —
   * an issue / scrap takes only the free units unless the director overrides (`canOverride`). Null otherwise.
   */
  reservedForOther: { project: string; qty: number } | null;
  /** The viewer is the portfolio director (override of another project's reservation, audited). */
  canOverride: boolean;
  /** Pinned by an ECO for the installed base: scrap warning + "ECO →". */
  scrapWarning: { text: string; ecoHref: string } | null;
  moves: MoveView[];
  partHref: string;
  closeHref: string;
}

export function stockDrawerView(
  input: {
    detail: StockPositionDetail; locations: StorageLocationRow[]; pins: Record<string, InstalledBasePin[]>; state: StockUrlState; prices?: boolean;
    /** Delivery 7: the current project, its plan's activities, and the viewer's rights on reservations (R-098 / R-099). */
    projectCode?: string | null; activities?: { code: string; name: string }[]; canRelease?: boolean; canOverride?: boolean;
    /** R-034: the simulated X3 exchange is available (demo database). Default true. */
    x3?: boolean;
  },
  t: T,
  lang: Lang,
): StockDrawerView {
  const { detail: d, locations, pins, state } = input;
  const pin = pinOf(pins, d.ref);
  const projectCode = input.projectCode ?? null;
  const others = reservedForOthers({ reserved: d.reserved, reservedFor: d.reservedForProject }, projectCode);
  return {
    id: d.id,
    ref: d.ref,
    header: `${d.ref} · ${d.location}`,
    name: dataText(d.name, lang),
    locationType: t(d.locationTypeLabel),
    source: t(d.sourceLabel),
    sourceTone: d.source === 'x3' ? 'neutral' : 'accent',
    isLocal: d.source === 'local',
    canPush: input.x3 !== false,
    x3Note: t(input.x3 !== false ? 'Local movements are flagged until the next push to X3 · X3 remains the accounting reference' : X3_OFF_NOTE),
    meta: [
      { k: t('On hand'), v: qtyText(d.onHand, lang) },
      { k: t('Reserved'), v: reservedText(d.reserved, d.reservedForShort, (n) => qtyText(n, lang)) },
      { k: t('Available'), v: qtyText(availableQty(d), lang) },
      { k: t('Minimum level'), v: d.minQty ? String(d.minQty) : '—' },
      { k: t('Unit cost (last purchase)'), v: input.prices !== false ? moneyEur(d.unitCostEur, lang) : PRICE_MASK },
      { k: t('Last movement'), v: dayT(d.lastMovementOn, t) },
    ],
    // "Release reservation" (R-099) only on a reserved line, for the reserving project's PM or the director.
    ops: lineStockOps(input.canRelease ? d.reserved : 0).map((op) => ({ value: op, label: t(stockOperation.label(op)), qtyLabel: t(quantityLabel(op)) })),
    targets: transferTargetOptions(locations.map((l) => l.name), d.location).map((o) => ({ value: o.name, label: o.label, title: o.name })),
    activities: (input.activities ?? []).map((a) => ({ value: a.code, label: `${a.code} · ${dataText(a.name, lang)}` })),
    projectCode,
    reservedForOther: others && d.reservedForProject ? { project: d.reservedForProject, qty: others } : null,
    canOverride: input.canOverride === true,
    scrapWarning: pin ? { text: scrapWarnT(pin.text, t, lang), ecoHref: ecoHref(pin.firstEco) } : null,
    moves: d.movements.map((m, i) => moveView(m, t, lang, i)),
    partHref: stockHref({ ...state, stock: null, part: d.ref }),
    closeHref: stockHref({ ...state, stock: null, part: null }),
  };
}
