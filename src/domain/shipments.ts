// R-158 lot A — shipments of the equipment to the subsidiary's (or client's) site (docs/delivery-9/cadrage-r158-expeditions.md,
// owner's decisions § 5 of 25 Oct 2026; notes: docs/delivery-9/notes-r158-shipments.md). Pure rules, no I/O, no translation (EN
// source labels; FR in src/i18n/extra/d9-shipments.json): statuses and their transitions, modes, load types, the transport steps
// derived from the contract's Incoterm, the packing control (shipped quantities against the BOM of the shipment's equipment
// lines, decision 4), the per-HS-code summary and the rule of the lifecycle deliverable « Colisage & documents douaniers ».
import { INCOTERM_STEPS, type IncotermSplit, type IncotermStep } from './incoterms';

// ── Statuses ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * draft → prepared (packing list validated) → picked up → in transit → arrived → received (site reception, lot B) → closed.
 * Lot A moves "prepared" only through the packing-list validation and its reopening; the later statuses one step at a time.
 */
export const SHIPMENT_STATUSES = ['draft', 'prepared', 'picked_up', 'in_transit', 'arrived', 'received', 'closed'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const isShipmentStatus = (v: unknown): v is ShipmentStatus => typeof v === 'string' && (SHIPMENT_STATUSES as readonly string[]).includes(v);
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  draft: 'Draft', prepared: 'Prepared', picked_up: 'Picked up', in_transit: 'In transit', arrived: 'Arrived', received: 'Received on site', closed: 'Closed',
};
/** Nocturne tone of a status tag (severity is accent intensity, docs/spec/02 DS-TONES): on the road = accent. */
export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, 'accent' | 'outline' | 'neutral'> = {
  draft: 'neutral', prepared: 'outline', picked_up: 'accent', in_transit: 'accent', arrived: 'outline', received: 'neutral', closed: 'neutral',
};

/** The loads and their content are edited while the shipment is not picked up (a change on a prepared one reopens it). */
export const contentEditable = (s: ShipmentStatus) => s === 'draft' || s === 'prepared';

/** "Advance" target of a status: prepared → picked up → … → closed; none for draft (validate the packing list) and closed. */
export function nextShipmentStatus(s: ShipmentStatus): ShipmentStatus | null {
  if (s === 'draft' || s === 'closed') return null;
  return SHIPMENT_STATUSES[SHIPMENT_STATUSES.indexOf(s) + 1] ?? null;
}
/** EN source label of the "Advance" button. */
export const ADVANCE_LABEL: Partial<Record<ShipmentStatus, string>> = {
  picked_up: 'Mark picked up', in_transit: 'Mark in transit', arrived: 'Mark arrived', received: 'Mark received on site', closed: 'Close shipment',
};

// ── Transport ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const SHIPMENT_MODES = ['road', 'sea', 'air', 'multimodal'] as const;
export type ShipmentMode = (typeof SHIPMENT_MODES)[number];
export const isShipmentMode = (v: unknown): v is ShipmentMode => typeof v === 'string' && (SHIPMENT_MODES as readonly string[]).includes(v);
export const SHIPMENT_MODE_LABEL: Record<ShipmentMode, string> = { road: 'Road', sea: 'Sea', air: 'Air', multimodal: 'Multimodal' };

/** Loads EPC2i declares (decision 10). */
export const LOAD_TYPES = ['truck', 'c20', 'c40', 'c40hc', 'open_top', 'flat_rack', 'out_of_gauge'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];
export const isLoadType = (v: unknown): v is LoadType => typeof v === 'string' && (LOAD_TYPES as readonly string[]).includes(v);
export const LOAD_TYPE_LABEL: Record<LoadType, string> = {
  truck: 'Truck', c20: 'Container 20′', c40: 'Container 40′', c40hc: 'Container 40′ HC', open_top: 'Open-top', flat_rack: 'Flat-rack', out_of_gauge: 'Out of gauge',
};

/** A sea-only Incoterm (FAS, FOB, CFR, CIF) on a shipment that is not by sea: shown as a warning, not refused. */
export const incotermModeMismatch = (incotermModes: 'any' | 'sea' | null, mode: ShipmentMode | null) => incotermModes === 'sea' && !!mode && mode !== 'sea';

/** One transport step of a shipment, from the contract's Incoterm. */
export interface ShipmentStepView {
  step: IncotermStep;
  /** EPC2i organises and tracks it (the seller's under the Incoterm); the buyer's are shown, not tracked. */
  tracked: boolean;
  plannedOn: string | null;
  actualOn: string | null;
  note: string | null;
  state: 'done' | 'late' | 'planned' | 'todo' | 'buyer';
}

/** The 10 steps, the seller's tracked (planned / actual date, note) and the buyer's shown; none without an Incoterm. */
export function shipmentSteps(
  split: IncotermSplit | null,
  recorded: readonly { step: string; plannedOn: string | null; actualOn: string | null; note: string | null }[],
  today: string,
): ShipmentStepView[] {
  if (!split) return [];
  return INCOTERM_STEPS.map((step) => {
    const r = recorded.find((x) => x.step === step);
    const tracked = split[step] === 'seller';
    const plannedOn = r?.plannedOn ?? null;
    const actualOn = r?.actualOn ?? null;
    const state = !tracked ? 'buyer' : actualOn ? 'done' : plannedOn && plannedOn < today ? 'late' : plannedOn ? 'planned' : 'todo';
    return { step, tracked, plannedOn, actualOn, note: r?.note ?? null, state };
  });
}

// ── Packing control (decision 4) ─────────────────────────────────────────────────────────────────────────────────

/** A line of the project's BOM, as the packing control reads it. */
export interface ControlBomLine {
  partRef: string;
  name: string;
  /** project_equipments.id of the line; null = common to the project. */
  equipmentId: string | null;
  quantity: number;
  /** BOM valuation (ordered, else last purchase, else catalogue price), €. */
  unitValueEur: number;
  hsCode: string | null;
  hsNotApplicable: boolean;
  exportRestriction: string | null;
}

/** One content line of the shipment (in one of its loads). */
export interface ControlItem {
  id: string;
  /** Catalogue part; null = a free item (description, HS code and value typed). */
  partRef: string | null;
  description: string;
  quantity: number;
  /** Free item: typed; catalogue part outside the BOM: its catalogue values (the DAL fills them). */
  hsCode: string | null;
  hsNotApplicable?: boolean;
  unitValueEur: number | null;
  exportRestriction?: string | null;
  originCountry: string | null;
  netKg: number | null;
  grossKg: number | null;
  loadLabel: string;
}

export interface GapJustification {
  key: string;
  /** The difference (packed − expected) the reason was given for; a later change of the gap needs a new reason. */
  delta: number;
  reason: string;
  by: string | null;
  at: string | null;
}

export type ControlCategory = 'equipment' | 'common' | 'outside';
export type GapKind = 'missing' | 'excess' | 'not_in_bom';
export const GAP_LABEL: Record<GapKind, string> = { missing: 'Missing', excess: 'Excess', not_in_bom: 'Not in the BOM' };
export const CATEGORY_LABEL: Record<ControlCategory, string> = {
  equipment: 'BOM of the equipment', common: 'Common to the project', outside: 'Outside the shipment’s BOM',
};

export interface ControlLine {
  /** 'part:<ref>' or 'item:<content line id>' (a free item). */
  key: string;
  partRef: string | null;
  name: string;
  category: ControlCategory;
  /** BOM quantity of the shipment's equipment lines left after the project's earlier shipments; null outside the BOM. */
  expected: number | null;
  packed: number;
  /** packed − expected (packed for a line outside the BOM). */
  delta: number;
  gap: GapKind | null;
  /** The gap's reason, when one was given for exactly this difference. */
  justification: GapJustification | null;
}

export interface HsSummaryRow {
  /** HS code; '' for parts declared without customs code (n/a). */
  hsCode: string;
  lines: number;
  quantity: number;
  valueEur: number;
  netKg: number;
  grossKg: number;
  origins: string[];
  restricted: boolean;
}

export interface PackingControl {
  lines: ControlLine[];
  /** Content lines without an HS code (blocking — no reason clears it). */
  missingHs: { id: string; label: string; loadLabel: string }[];
  /** Content lines under an export restriction (alert). */
  restricted: { label: string; restriction: string }[];
  hsSummary: HsSummaryRow[];
  totals: { lines: number; quantity: number; valueEur: number; netKg: number; grossKg: number };
  /** Gaps without a reason for their current difference. */
  openGaps: number;
  /** Nothing packed yet. */
  empty: boolean;
  /** The packing list may be validated: content, every gap justified, every HS code known. */
  cleared: boolean;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const partKey = (ref: string) => `part:${ref}`;
export const itemKey = (id: string) => `item:${id}`;

/**
 * The packing control of one shipment (rules: docs/delivery-9/notes-r158-shipments.md § 5):
 * - a BOM line of one of the shipment's equipment lines is EXPECTED in full, less what the project's earlier shipments carry of
 *   the part: packed below → missing, above → excess;
 * - a BOM line common to the project (no equipment line) may travel with any shipment: never missing, excess above its BOM
 *   quantity less the earlier shipments' (a later shipment never reopens an earlier one);
 * - a part of another equipment line's BOM, a catalogue part outside the project's BOM, a free item → not in the BOM;
 * - each gap is cleared by a reason given for its current difference; an item without HS code blocks (decision 4).
 */
export function packingControl(input: {
  bom: readonly ControlBomLine[];
  equipmentIds: readonly string[];
  items: readonly ControlItem[];
  /** Quantity of each part the project's earlier shipments (lower EXP number) carry. */
  packedElsewhere: ReadonlyMap<string, number>;
  justifications: readonly GapJustification[];
}): PackingControl {
  const eq = new Set(input.equipmentIds);
  // One BOM line per part and project (project_bom_lines is unique on both).
  const bomOf = new Map(input.bom.map((b) => [b.partRef, b]));
  const packedByPart = new Map<string, number>();
  for (const it of input.items) if (it.partRef) packedByPart.set(it.partRef, round3((packedByPart.get(it.partRef) ?? 0) + it.quantity));
  const justified = (key: string, delta: number) => input.justifications.find((j) => j.key === key && Math.abs(j.delta - delta) < 1e-9) ?? null;
  const ofShipment = (b: ControlBomLine | undefined) => !!b && b.equipmentId != null && eq.has(b.equipmentId);

  const lines: ControlLine[] = [];
  // BOM order first (the shipment's equipment lines, then the other BOM lines packed), then the parts outside the BOM as packed.
  const refs = [
    ...input.bom.filter((b) => ofShipment(b) || packedByPart.has(b.partRef)).map((b) => b.partRef),
    ...[...packedByPart.keys()].filter((r) => !bomOf.has(r)),
  ];
  for (const ref of refs) {
    const b = bomOf.get(ref);
    const packed = packedByPart.get(ref) ?? 0;
    const elsewhere = input.packedElsewhere.get(ref) ?? 0;
    const name = b?.name ?? input.items.find((i) => i.partRef === ref)?.description ?? ref;
    let line: Omit<ControlLine, 'justification'>;
    if (b && ofShipment(b)) {
      const expected = Math.max(0, round3(b.quantity - elsewhere));
      const delta = round3(packed - expected);
      line = { key: partKey(ref), partRef: ref, name, category: 'equipment', expected, packed, delta, gap: delta < 0 ? 'missing' : delta > 0 ? 'excess' : null };
    } else if (b && b.equipmentId == null) {
      const expected = Math.max(0, round3(b.quantity - elsewhere));
      const delta = Math.max(0, round3(packed - expected));
      line = { key: partKey(ref), partRef: ref, name, category: 'common', expected, packed, delta, gap: delta > 0 ? 'excess' : null };
    } else {
      line = { key: partKey(ref), partRef: ref, name, category: 'outside', expected: null, packed, delta: packed, gap: 'not_in_bom' };
    }
    lines.push({ ...line, justification: line.gap ? justified(line.key, line.delta) : null });
  }
  for (const it of input.items) {
    if (it.partRef) continue;
    const key = itemKey(it.id);
    lines.push({ key, partRef: null, name: it.description, category: 'outside', expected: null, packed: it.quantity, delta: it.quantity, gap: 'not_in_bom', justification: justified(key, it.quantity) });
  }

  // Customs: HS code, value, weight and origin of each content line.
  const hsOf = (it: ControlItem) => {
    if (!it.partRef) return { hs: it.hsCode, na: !!it.hsNotApplicable, unit: it.unitValueEur ?? 0, restriction: it.exportRestriction ?? null };
    const b = bomOf.get(it.partRef);
    return b
      ? { hs: b.hsCode, na: b.hsNotApplicable, unit: b.unitValueEur, restriction: b.exportRestriction }
      : { hs: it.hsCode, na: !!it.hsNotApplicable, unit: it.unitValueEur ?? 0, restriction: it.exportRestriction ?? null };
  };
  const missingHs: PackingControl['missingHs'] = [];
  const restricted: PackingControl['restricted'] = [];
  const hs = new Map<string, HsSummaryRow>();
  const totals = { lines: 0, quantity: 0, valueEur: 0, netKg: 0, grossKg: 0 };
  for (const it of input.items) {
    const c = hsOf(it);
    const label = it.partRef ? `${it.partRef} · ${it.description}` : it.description;
    const code = c.hs?.trim() ?? '';
    if (!code && !c.na) missingHs.push({ id: it.id, label, loadLabel: it.loadLabel });
    if (c.restriction) restricted.push({ label, restriction: c.restriction });
    const value = c.unit * it.quantity;
    const row = hs.get(code) ?? { hsCode: code, lines: 0, quantity: 0, valueEur: 0, netKg: 0, grossKg: 0, origins: [], restricted: false };
    row.lines += 1;
    row.quantity = round3(row.quantity + it.quantity);
    row.valueEur += value;
    row.netKg = round3(row.netKg + (it.netKg ?? 0));
    row.grossKg = round3(row.grossKg + (it.grossKg ?? 0));
    if (it.originCountry && !row.origins.includes(it.originCountry)) row.origins.push(it.originCountry);
    row.restricted ||= !!c.restriction;
    hs.set(code, row);
    totals.lines += 1;
    totals.quantity = round3(totals.quantity + it.quantity);
    totals.valueEur += value;
    totals.netKg = round3(totals.netKg + (it.netKg ?? 0));
    totals.grossKg = round3(totals.grossKg + (it.grossKg ?? 0));
  }
  const hsSummary = [...hs.values()].map((r) => ({ ...r, origins: [...r.origins].sort() })).sort((a, b) => (!a.hsCode ? 1 : 0) - (!b.hsCode ? 1 : 0) || (a.hsCode < b.hsCode ? -1 : a.hsCode > b.hsCode ? 1 : 0));
  const openGaps = lines.filter((l) => l.gap && !l.justification).length;
  const empty = input.items.length === 0;
  return { lines, missingHs, restricted, hsSummary, totals, openGaps, empty, cleared: !empty && openGaps === 0 && missingHs.length === 0 };
}

/** Why the packing list cannot be validated (EN source), null when it can. */
export function packingBlocker(c: Pick<PackingControl, 'empty' | 'openGaps' | 'missingHs'>): string | null {
  if (c.empty) return 'Nothing is packed yet';
  if (c.missingHs.length) return 'An item has no HS code: complete the part in the PLM (or the item) first';
  if (c.openGaps) return 'Justify each gap of the packing control first';
  return null;
}

// ── Lifecycle deliverable « Colisage & documents douaniers » (decision 4) ─────────────────────────────────────────────

/** « Colisage & documents douaniers »: the first deliverable (0-based position 0) of the Expédition stage. */
export const PACKING_STAGE_DELIVERABLE = { stage: 'expedition', position: 0 } as const;

export const PACKING_DELIVERABLE_NO_SHIPMENT = 'Prepare the project’s shipments first (Shipments screen)';
export const PACKING_DELIVERABLE_MESSAGE = 'Validate the packing list of every shipment first (Shipments screen)';

/**
 * Ticking « Colisage & documents douaniers » needs at least one shipment and, for every shipment of the project, a validated
 * packing list whose control is still cleared. Unticking is always allowed. Returns the refusal (EN source) or null.
 */
export function packingDeliverableBlocker(
  target: { stage: string; position: number; done: boolean },
  shipments: readonly { validated: boolean; cleared: boolean }[],
): string | null {
  if (target.stage !== PACKING_STAGE_DELIVERABLE.stage || target.position !== PACKING_STAGE_DELIVERABLE.position || !target.done) return null;
  if (!shipments.length) return PACKING_DELIVERABLE_NO_SHIPMENT;
  return shipments.every((s) => s.validated && s.cleared) ? null : PACKING_DELIVERABLE_MESSAGE;
}

// ── Input rules ───────────────────────────────────────────────────────────────────────────────────────────────────

/** "EXP-01", "EXP-02"… per project. */
export const SHIPMENT_REF_RE = /^EXP-\d{2,}$/;
export function nextShipmentRef(existing: readonly string[]): string {
  const n = existing.map((r) => (SHIPMENT_REF_RE.test(r) ? parseInt(r.slice(4), 10) : 0)).reduce((a, b) => Math.max(a, b), 0);
  return `EXP-${String(n + 1).padStart(2, '0')}`;
}

/** ISO 3166-1 alpha-2 origin ("FR"). */
export const COUNTRY_RE = /^[A-Z]{2}$/;
/** HS code as typed for a free item: 4 to 10 digits, dots allowed ("8537.20", "85372091"). */
export const HS_CODE_RE = /^\d{4}(?:\.?\d{2}){0,3}$/;

export const SHIPMENT_TEXT_MAX = 120;
export const SHIPMENT_NOTE_MAX = 1000;
export const GAP_REASON_MAX = 500;
export const MAX_QUANTITY = 1_000_000;
export const MAX_KG = 1_000_000;
export const MAX_CM = 10_000;
