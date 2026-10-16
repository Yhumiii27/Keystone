// Stock & storages — pure business logic (docs/spec/08 §4; prototype logic 4469–4492: stockRows, stockKpis,
// stockLocChips, applyOp, stockSel, importX3). Positions per article and storage location are imported from Sage X3;
// movements recorded in Keystone flag the touched lines "Local" until they are pushed back (X3 stays the accounting
// reference). No I/O, no translation: labels are the prototype's English source strings.
//
// Rules settled here (open questions 08 OQ13–16, 00 §10 SC-5), applied by the data layer and the Server Functions:
// - a count (adjust) may be 0; every other operation needs a whole quantity > 0;
// - no movement takes more than the quantity on hand (transfer, issue, scrap), a reservation never exceeds it;
// - a reservation belongs to one project: reserving for another project is refused, and a reservation that drops to 0
//   is released;
// - Delivery 7 (SC-5a = a, R-098): an issue names the activity of the project's plan that consumes the parts — required;
//   its value (quantity × the stock unit cost, A-11: last purchase price, else list price) is charged to the activity's
//   work package in the cost tracking;
// - Delivery 7 (NEW-D4-2 / SC-5b = a, R-099): an issue or a scrap never takes units reserved for another project: the
//   reserving project's PM releases them first ("Release reservation", that project's PM or the director), unless the
//   portfolio director overrides (audited, the other project's reservation drops by what is taken);
// - a transfer that moves reserved goods (more than the free quantity) moves their reservation with them to the
//   destination, which must not hold another project's reservation (the prototype left it behind, available < 0);
// - "Import from X3" merges: lines changed in Keystone and not yet pushed keep their values (the prototype
//   discarded them);
// - transfer destinations are the configured locations except the current one, labelled with the short name
//   unless two locations share it (the prototype showed "Magasin chantier" twice).
// Golden values: src/domain/stock.test.ts (src/features/stock/stock.golden.json, scripts/proto-golden-stock.ts).
import type { LocationType, StockMovementType, StockOperation, StockSource } from '@/server/db/codes';

export type { LocationType, StockMovementType, StockOperation, StockSource };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** STOCK_OPS (3483) order: the segmented control of the stock-line drawer. */
export const STOCK_OPS: readonly StockOperation[] = ['adjust', 'transfer', 'reserve', 'release', 'issue', 'return', 'scrap'];
/** The prototype's six operations (STOCK_OPS 3483); "Release reservation" is Delivery 7's (R-099). */
export const PROTOTYPE_STOCK_OPS: readonly StockOperation[] = STOCK_OPS.filter((op) => op !== 'release');
/** Operations offered on a line: "Release reservation" only while the line holds a reservation. */
export const lineStockOps = (reserved: number): StockOperation[] => STOCK_OPS.filter((op) => op !== 'release' || reserved > 0);

export const isStockOperation = (v: unknown): v is StockOperation => typeof v === 'string' && (STOCK_OPS as readonly string[]).includes(v);

/** Largest quantity accepted in the quantity field (guards against typos such as 1e9). */
export const MAX_STOCK_QTY = 1_000_000;

// ── Lines, KPIs, filters (stockRows / stockKpis / stockLocChips 4471–4477) ─────────────────────────────

export interface StockLineFacts {
  ref: string;
  name: string;
  location: string;
  locationType: LocationType;
  onHand: number;
  reserved: number;
  minQty: number;
  /** Last purchase price, else list price (`lastPrice`). */
  unitCostEur: number;
  source: StockSource;
}

/** On hand − reserved (may be negative on X3 data: shown in the attention colour). */
export const availableQty = (l: Pick<StockLineFacts, 'onHand' | 'reserved'>) => l.onHand - l.reserved;
/** `min > 0 ∧ onHand < min` (warning icon, "Below minimum", sidebar badge). */
export const isBelowMin = (l: Pick<StockLineFacts, 'onHand' | 'minQty'>) => l.minQty > 0 && l.onHand < l.minQty;
/** onHand × unit cost, in euros. */
export const lineValueEur = (l: Pick<StockLineFacts, 'onHand' | 'unitCostEur'>) => l.onHand * l.unitCostEur;

/** Sidebar badge of Stock & storages: lines below their minimum ('' when none, as every nav badge). */
export const stockBadge = (lines: readonly Pick<StockLineFacts, 'onHand' | 'minQty'>[]) => {
  const n = lines.filter(isBelowMin).length;
  return n ? String(n) : '';
};

export interface StockFigures {
  /** Σ onHand × unit cost (euros). KPI "Stock value" shows it in k€ (`f(v / 1000)`). */
  valueEur: number;
  lines: number;
  /** Configured storage locations (Settings). */
  locations: number;
  belowMin: number;
  /** Σ on hand at quarantine locations ("In quarantine"). */
  quarantineQty: number;
  /** Lines as imported from / pushed to Sage X3. */
  x3Lines: number;
  /** Lines changed in Keystone, to push back to X3. */
  localLines: number;
}

export function stockFigures(lines: readonly StockLineFacts[], configuredLocations: number): StockFigures {
  return {
    valueEur: lines.reduce((a, l) => a + lineValueEur(l), 0),
    lines: lines.length,
    locations: configuredLocations,
    belowMin: lines.filter(isBelowMin).length,
    quarantineQty: lines.filter((l) => l.locationType === 'quarantine').reduce((a, l) => a + l.onHand, 0),
    x3Lines: lines.filter((l) => l.source === 'x3').length,
    localLines: lines.filter((l) => l.source === 'local').length,
  };
}

/** Search box: case-insensitive match on "ref name location" (`stockQ`); blank matches everything. */
export function matchesStockQuery(l: Pick<StockLineFacts, 'ref' | 'name' | 'location'>, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || `${l.ref} ${l.name} ${l.location}`.toLowerCase().includes(s);
}

/** Rows shown: location chip (`stockLoc`, null = all) and search. */
export function filterStockLines<L extends Pick<StockLineFacts, 'ref' | 'name' | 'location'>>(lines: readonly L[], f: { location: string | null; q: string }): L[] {
  return lines.filter((l) => (!f.location || l.location === f.location) && matchesStockQuery(l, f.q));
}

/** Location chips: "All locations" (every line) then one chip per configured location with its line count. */
export function locationChipCounts(lines: readonly Pick<StockLineFacts, 'location'>[], locations: readonly string[]): { location: string | null; count: number }[] {
  return [{ location: null, count: lines.length }, ...locations.map((location) => ({ location, count: lines.filter((l) => l.location === location).length }))];
}

/** A `?loc=` value is kept only when it names a configured location. */
export const parseLocationFilter = (v: string | null | undefined, locations: readonly string[]) => (v && locations.includes(v) ? v : null);

/** Reserved cell: "4 · HLT" (the reservation's 3-letter project key) or "—". `fmt` formats the quantity. */
export function reservedText(reserved: number, projectShort: string | null, fmt: (n: number) => string = String): string {
  return reserved ? fmt(reserved) + (projectShort ? ` · ${projectShort}` : '') : '—';
}

/** Short label of a location: the part before " — " ("Magasin chantier — Le Havre" → "Magasin chantier"). */
export const locationShortLabel = (name: string) => name.split(' — ')[0];

/**
 * Transfer destinations: every configured location except the current one, in Settings order. Labelled with the
 * short name, or the full name when two configured locations share the short name (08 OQ16).
 */
export function transferTargetOptions(locations: readonly string[], current: string): { name: string; label: string }[] {
  const shorts = locations.map(locationShortLabel);
  const shared = new Set(shorts.filter((s, i) => shorts.indexOf(s) !== i));
  return locations.filter((l) => l !== current).map((name) => ({ name, label: shared.has(locationShortLabel(name)) ? name : locationShortLabel(name) }));
}

// ── Installed-base pins (pinnedText 4199, scrapWarnText 4489) ───────────────────────────────────────────

/** "Keep for the installed base · 1 machine · ECO-2026-015" ('' when the part is not pinned). */
export function pinnedText(pin: { machines: number; ecos: readonly string[] } | null): string {
  if (!pin) return '';
  return `Keep for the installed base · ${pin.machines} ${pin.machines === 1 ? 'machine' : 'machines'} · ${pin.ecos.join(', ')}`;
}

/** Scrap warning of a pinned part (shown when the Scrap / rework operation is selected). */
export const scrapWarningText = (pinned: string) => `Pinned revision in service — ${pinned}. Scrapping is allowed but After-sales must confirm spare coverage first.`;

/** Quantity label of the drawer (`qtyLabel`). */
export const quantityLabel = (op: StockOperation) => (op === 'adjust' ? 'Counted quantity' : 'Quantity');

// ── Movements (applyOp 4479–4487) ──────────────────────────────────────────────────────────────────────

export interface PositionFacts {
  location: string;
  onHand: number;
  reserved: number;
  /** Project the reservation is held for (code), null when none. */
  reservedFor: string | null;
}

export interface ProjectRef {
  code: string;
  /** 3-letter key shown in the texts ("HLT"). */
  short: string;
}

export interface MovementRequest {
  op: StockOperation;
  /** Counted quantity (adjust) or quantity moved. */
  qty: number;
  /** Transfer destination (location name). */
  target?: string | null;
  /** Project holding a reservation on the destination line of a transfer (null when none). */
  targetReservedFor?: string | null;
  /** Current project (reserve, issue, return, scrap — the prototype's `PD.p3`). */
  project?: ProjectRef | null;
  /** Activity issued to (required for an issue, SC-5a; optional on a return: credits its work package). */
  activity?: { code: string; name: string } | null;
  /**
   * The portfolio director takes units reserved for another project (issue or scrap beyond the free quantity, R-099).
   * The caller checks the role; the plan records how many were taken (`overrideTaken`).
   */
  override?: boolean;
}

export interface MovementPlan {
  type: StockOperation;
  qty: number;
  /** The line after the movement. */
  onHand: number;
  reserved: number;
  reservedFor: string | null;
  /** Transfer destination (receives `qty`). */
  transferTo: string | null;
  /** Reserved quantity moved with the goods to the destination (transfer of reserved goods), 0 otherwise. */
  transferReserved: number;
  /** Project of that reservation (the source line's). */
  transferReservedFor: string | null;
  /** Project of the movement (reserve, release, issue, return). */
  projectCode: string | null;
  /** "Where" text of the movement lists (MOVES0 format). */
  whereText: string;
  /** Units reserved for another project taken by the director's override (0 when none) and that project. */
  overrideTaken: number;
  overrideFrom: string | null;
}

/** Refusal of an issue / scrap that would take units reserved for another project (EN source, R-099). */
export const reservedForOtherText = (n: number, project: string) =>
  `${n} reserved for ${project} — its project manager must release them first`;

/**
 * Units of a line held for another project than `project` (every reserved unit of a project when none is given, e.g. a
 * scrap); a reservation without a project (X3 data) belongs to nobody and counts as free.
 */
export const reservedForOthers = (pos: Pick<PositionFacts, 'reserved' | 'reservedFor'>, project: string | null | undefined) =>
  pos.reserved > 0 && pos.reservedFor && pos.reservedFor !== project ? pos.reserved : 0;

/** Validates a whole quantity for an operation: ≥ 0 for a count, > 0 otherwise. */
export function checkQuantity(op: StockOperation, qty: number): string | null {
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_STOCK_QTY || (op !== 'adjust' && qty === 0)) return 'Invalid quantity';
  return null;
}

/**
 * Plans one movement on a line (`applyOp`), with the stock rules above. `locations` = the configured locations
 * (transfer destinations). Every accepted movement flags the line Local and stamps it on the business date (caller, R-013).
 */
export function planStockMovement(pos: PositionFacts, req: MovementRequest, locations: readonly string[]): ParseResult<MovementPlan> {
  const { op, qty } = req;
  if (!isStockOperation(op)) return { ok: false, error: 'Invalid movement' };
  const bad = checkQuantity(op, qty);
  if (bad) return { ok: false, error: bad };
  const loc = pos.location;
  const project = req.project ?? null;
  const takeOut = () => (qty > pos.onHand ? `Only ${pos.onHand} on hand at ${loc}` : null);
  let onHand = pos.onHand;
  let reserved = pos.reserved;
  let reservedFor = pos.reservedFor;
  let transferTo: string | null = null;
  let transferReserved = 0;
  let overrideTaken = 0;
  let whereText: string;
  /**
   * An issue / scrap never takes units reserved for another project, unless the director overrides (R-099): then the
   * other project's reservation drops by what is taken. Otherwise an issue consumes its own project's reservation first
   * (as before), a scrap the free units first (the final cap trims the own reservation when needed). Returns the
   * refusal, or null with the reservation set.
   */
  const takeFree = (ownFirst: boolean): string | null => {
    const others = reservedForOthers(pos, project?.code);
    const free = Math.max(0, pos.onHand - others);
    if (qty > free) {
      if (!req.override) return reservedForOtherText(others, pos.reservedFor ?? '—');
      overrideTaken = qty - free;
    }
    reserved = others ? pos.reserved - overrideTaken : ownFirst ? Math.max(0, pos.reserved - qty) : pos.reserved;
    return null;
  };
  switch (op) {
    case 'adjust':
      onHand = qty;
      whereText = `${loc} · counted`;
      break;
    case 'transfer': {
      const target = req.target?.trim();
      if (!target || !locations.includes(target)) return { ok: false, error: 'Choose a destination' };
      if (target === loc) return { ok: false, error: 'The destination is the current location' };
      const e = takeOut();
      if (e) return { ok: false, error: e };
      onHand -= qty;
      // Goods beyond the free quantity are reserved ones: their reservation travels with them.
      transferReserved = Math.min(qty, Math.max(0, pos.reserved - onHand));
      if (transferReserved > 0 && req.targetReservedFor && req.targetReservedFor !== pos.reservedFor) {
        return { ok: false, error: 'The destination is reserved for another project' };
      }
      reserved -= transferReserved;
      transferTo = target;
      whereText = `${loc} → ${target}`;
      break;
    }
    case 'reserve': {
      if (!project) return { ok: false, error: 'A project is required' };
      if (pos.reserved > 0 && pos.reservedFor && pos.reservedFor !== project.code) return { ok: false, error: 'This line is already reserved for another project' };
      if (pos.reserved + qty > pos.onHand) return { ok: false, error: `Only ${Math.max(0, pos.onHand - pos.reserved)} available at ${loc}` };
      reserved += qty;
      reservedFor = project.code;
      whereText = `${loc} · ${project.short}`;
      break;
    }
    case 'release': {
      // "Release reservation" (R-099): the reserving project gives units back to the free stock.
      if (!project) return { ok: false, error: 'A project is required' };
      if (!pos.reserved || pos.reservedFor !== project.code) return { ok: false, error: 'This line holds no reservation for this project' };
      if (qty > pos.reserved) return { ok: false, error: `Only ${pos.reserved} reserved at ${loc}` };
      reserved -= qty;
      whereText = `${loc} · ${project.short} released`;
      break;
    }
    case 'issue': {
      if (!project) return { ok: false, error: 'A project is required' };
      // SC-5a = a: the activity of the plan that consumes the parts is required.
      if (!req.activity) return { ok: false, error: 'Choose the activity the parts are issued to' };
      const e = takeOut() ?? takeFree(true);
      if (e) return { ok: false, error: e };
      onHand -= qty;
      whereText = `${loc} → ${req.activity.code} ${req.activity.name}`;
      break;
    }
    case 'return':
      if (!project) return { ok: false, error: 'A project is required' };
      onHand += qty;
      whereText = req.activity ? `${project.short} ${req.activity.code} → ${loc}` : `${project.short} → ${loc}`;
      break;
    case 'scrap': {
      const e = takeOut() ?? takeFree(false);
      if (e) return { ok: false, error: e };
      onHand -= qty;
      whereText = `${loc} · rework / scrap`;
      break;
    }
  }
  // A reservation never exceeds what is on hand; a released reservation belongs to no project.
  if (reserved > onHand) reserved = onHand;
  if (reserved === 0) reservedFor = null;
  return {
    ok: true,
    value: {
      type: op, qty, onHand, reserved, reservedFor, transferTo, transferReserved, transferReservedFor: transferReserved ? pos.reservedFor : null,
      projectCode: op === 'reserve' || op === 'release' || op === 'issue' || op === 'return' ? project!.code : null, whereText,
      overrideTaken, overrideFrom: overrideTaken ? pos.reservedFor : null,
    },
  };
}

/** Activity code of the plan ("A1250"): letters, digits, dots, dashes, underscores (≤ 40). */
export const isActivityCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v);

/** Value of a movement in euros (quantity × stock unit cost; A-11: last purchase price, else list price), cents kept. */
export const movementValueEur = (qty: number, unitCostEur: number) => Math.round(qty * unitCostEur * 100) / 100;

/** Raw drawer input (Server Function payload) → movement fields. The quantity field accepts digits only. */
export function parseMovementInput(raw: { op?: unknown; qty?: unknown; target?: unknown }): ParseResult<{ op: StockOperation; qty: number; target: string | null }> {
  if (!isStockOperation(raw.op)) return { ok: false, error: 'Invalid movement' };
  const text = typeof raw.qty === 'number' ? String(raw.qty) : typeof raw.qty === 'string' ? raw.qty.trim() : '';
  if (!/^\d{1,7}$/.test(text)) return { ok: false, error: 'Enter a whole quantity' };
  const qty = Number(text);
  const bad = checkQuantity(raw.op, qty);
  if (bad) return { ok: false, error: raw.op === 'adjust' ? bad : 'Enter a quantity above 0' };
  const target = typeof raw.target === 'string' && raw.target.trim() ? raw.target.trim() : null;
  if (raw.op === 'transfer' && !target) return { ok: false, error: 'Choose a destination' };
  return { ok: true, value: { op: raw.op, qty, target: raw.op === 'transfer' ? target : null } };
}

// ── Import from X3 (importX3 4492, merged) ──────────────────────────────────────────────────────────────

export interface X3SnapshotLine {
  ref: string;
  location: string;
  onHand: number;
  reserved: number;
  /** Reservation project (code) or null. */
  reservedFor: string | null;
  minQty: number;
  lastMovementOn: string;
}

export interface X3PositionState {
  id: string;
  ref: string;
  location: string;
  onHand: number;
  reserved: number;
  reservedFor: string | null;
  minQty: number;
  lastMovementOn: string;
  source: StockSource;
  /** Keystone already pushed this line to X3: X3 holds Keystone's values (the snapshot is older). */
  pushedFromKeystone: boolean;
}

export interface X3ImportPlan {
  /** Lines reset to the snapshot values (X3 lines whose values differ from it). */
  update: { id: string; line: X3SnapshotLine }[];
  /** Snapshot lines without a position yet (created as X3 lines). */
  create: X3SnapshotLine[];
  /** Local lines kept as they are (pending push). */
  keptLocal: number;
}

/**
 * "Import from X3": every X3 line takes the snapshot values; lines changed in Keystone and not yet pushed (Local)
 * are kept — the prototype replaced the whole stock with the snapshot (08 OQ15). Lines Keystone pushed after the
 * snapshot keep their values too (X3 has them).
 */
export function planX3Import(positions: readonly X3PositionState[], snapshot: readonly X3SnapshotLine[]): X3ImportPlan {
  const key = (ref: string, loc: string) => `${ref}\u0000${loc}`;
  const byKey = new Map(positions.map((p) => [key(p.ref, p.location), p]));
  const update: X3ImportPlan['update'] = [];
  const create: X3SnapshotLine[] = [];
  for (const line of snapshot) {
    const p = byKey.get(key(line.ref, line.location));
    if (!p) {
      create.push(line);
      continue;
    }
    if (p.source === 'local' || p.pushedFromKeystone) continue;
    const same = p.onHand === line.onHand && p.reserved === line.reserved && p.reservedFor === line.reservedFor && p.minQty === line.minQty && p.lastMovementOn === line.lastMovementOn;
    if (!same) update.push({ id: p.id, line });
  }
  return { update, create, keptLocal: positions.filter((p) => p.source === 'local').length };
}
