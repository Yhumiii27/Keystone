// R-158 lot A — input rules of the Shipments screen's forms (the Server Functions parse with them, the DAL re-checks rights and
// states). Pure, no I/O: form values arrive as strings (FormDialog); EN source error messages (FR in d9-shipments.json).
import { isIncotermStep, type IncotermStep } from './incoterms';
import {
  COUNTRY_RE, GAP_REASON_MAX, HS_CODE_RE, MAX_CM, MAX_KG, MAX_QUANTITY, SHIPMENT_NOTE_MAX, SHIPMENT_TEXT_MAX, isLoadType, isShipmentMode,
  type LoadType, type ShipmentMode,
} from './shipments';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Values = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realIso = (s: string) => ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Optional text (≤ max): '' → null; too long → error. */
function text(v: unknown, max: number): { ok: true; v: string | null } | { ok: false } {
  const s = str(v);
  return s.length > max ? { ok: false } : { ok: true, v: s || null };
}
/** Optional ISO date: '' → null. */
function day(v: unknown): { ok: true; v: string | null } | { ok: false } {
  const s = str(v);
  if (!s) return { ok: true, v: null };
  return realIso(s) ? { ok: true, v: s } : { ok: false };
}
/** Optional number in [min, max] ("1 250,5" accepted): '' → null. */
function number(v: unknown, min: number, max: number): { ok: true; v: number | null } | { ok: false } {
  const s = str(v).replace(/[\s  ]/g, '').replace(',', '.');
  if (!s) return { ok: true, v: null };
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return { ok: false };
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? { ok: true, v: n } : { ok: false };
}

export interface ShipmentInput {
  label: string | null;
  /** Equipment line refs ("EQ-02"), at least one. */
  equipment: string[];
  mode: ShipmentMode | null;
  forwarder: string | null;
  origin: string | null;
  destination: string | null;
  etd: string | null;
  eta: string | null;
  atd: string | null;
  ata: string | null;
  note: string | null;
}

/** "New shipment" / "Edit shipment": equipment refs as a comma list ("EQ-01, EQ-02") or a single select value. */
export function parseShipmentForm(v: Values): Parsed<ShipmentInput> {
  const equipment = [...new Set(str(v.equipment).split(/[,\s]+/).filter(Boolean).map((r) => r.toUpperCase()))];
  if (!equipment.length) return { ok: false, error: 'Choose the equipment line(s) of the shipment' };
  if (equipment.some((r) => !/^EQ-\d{2,}$/.test(r)) || equipment.length > 20) return { ok: false, error: 'Invalid request' };
  const mode = str(v.mode);
  if (mode && !isShipmentMode(mode)) return { ok: false, error: 'Invalid request' };
  const label = text(v.label, SHIPMENT_TEXT_MAX);
  const forwarder = text(v.forwarder, SHIPMENT_TEXT_MAX);
  const origin = text(v.origin, SHIPMENT_TEXT_MAX);
  const destination = text(v.destination, SHIPMENT_TEXT_MAX);
  const note = text(v.note, SHIPMENT_NOTE_MAX);
  if (!label.ok || !forwarder.ok || !origin.ok || !destination.ok || !note.ok) return { ok: false, error: 'Text too long' };
  const etd = day(v.etd);
  const eta = day(v.eta);
  const atd = day(v.atd);
  const ata = day(v.ata);
  if (!etd.ok || !eta.ok || !atd.ok || !ata.ok) return { ok: false, error: 'Enter dates as YYYY-MM-DD' };
  if (etd.v && eta.v && eta.v < etd.v) return { ok: false, error: 'The arrival cannot be before the departure' };
  if (atd.v && ata.v && ata.v < atd.v) return { ok: false, error: 'The arrival cannot be before the departure' };
  return {
    ok: true,
    value: {
      label: label.v, equipment, mode: (mode || null) as ShipmentMode | null, forwarder: forwarder.v, origin: origin.v, destination: destination.v,
      etd: etd.v, eta: eta.v, atd: atd.v, ata: ata.v, note: note.v,
    },
  };
}

export interface LoadInput {
  type: LoadType;
  identifier: string | null;
  seal: string | null;
  grossKg: number | null;
  note: string | null;
}

/** "Add load" / "Edit load". */
export function parseLoadForm(v: Values): Parsed<LoadInput> {
  if (!isLoadType(v.type)) return { ok: false, error: 'Invalid request' };
  const identifier = text(v.identifier, 40);
  const seal = text(v.seal, 40);
  const note = text(v.note, SHIPMENT_NOTE_MAX);
  if (!identifier.ok || !seal.ok || !note.ok) return { ok: false, error: 'Text too long' };
  const gross = number(v.grossKg, 0, MAX_KG);
  if (!gross.ok) return { ok: false, error: 'Enter a weight in kg' };
  return { ok: true, value: { type: v.type, identifier: identifier.v, seal: seal.v, grossKg: gross.v, note: note.v } };
}

export interface ItemInput {
  /** Catalogue part ref, or null for a free item. */
  partRef: string | null;
  description: string | null;
  hsCode: string | null;
  unitValueEur: number | null;
  quantity: number;
  packages: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  netKg: number | null;
  grossKg: number | null;
  originCountry: string | null;
}

/**
 * "Add content" / "Edit content": a part of the BOM or the catalogue (`part` = its reference), or a free item (`part` empty:
 * description required, HS code and unit value optional — a free item without HS code blocks the validation like any other).
 */
export function parseItemForm(v: Values): Parsed<ItemInput> {
  const part = str(v.part).toUpperCase();
  if (part && (part.length > 40 || !/^[A-Z0-9][A-Z0-9._/-]*$/.test(part))) return { ok: false, error: 'Invalid request' };
  const description = text(v.description, SHIPMENT_TEXT_MAX);
  if (!description.ok) return { ok: false, error: 'Text too long' };
  if (!part && !description.v) return { ok: false, error: 'Choose a BOM article or describe the item' };
  const hs = str(v.hsCode);
  if (hs && !HS_CODE_RE.test(hs)) return { ok: false, error: 'An HS code reads 8537.20 (4 to 10 digits)' };
  const unit = number(v.unitValueEur, 0, 100_000_000);
  if (!unit.ok) return { ok: false, error: 'Enter a value in euros' };
  const qty = number(v.quantity, 0, MAX_QUANTITY);
  if (!qty.ok || qty.v == null || qty.v <= 0) return { ok: false, error: 'Enter a quantity above zero' };
  const packages = number(v.packages, 0, 100_000);
  if (!packages.ok || (packages.v != null && !Number.isInteger(packages.v))) return { ok: false, error: 'Enter a whole number of packages' };
  const dims = [number(v.lengthCm, 0, MAX_CM), number(v.widthCm, 0, MAX_CM), number(v.heightCm, 0, MAX_CM)];
  if (dims.some((d) => !d.ok)) return { ok: false, error: 'Enter dimensions in cm' };
  const net = number(v.netKg, 0, MAX_KG);
  const gross = number(v.grossKg, 0, MAX_KG);
  if (!net.ok || !gross.ok) return { ok: false, error: 'Enter a weight in kg' };
  if (net.v != null && gross.v != null && net.v > gross.v) return { ok: false, error: 'The net weight cannot exceed the gross weight' };
  const origin = str(v.originCountry).toUpperCase();
  if (origin && !COUNTRY_RE.test(origin)) return { ok: false, error: 'An origin is a two-letter country code (FR)' };
  const [l, w, h] = dims.map((d) => (d.ok ? d.v : null));
  return {
    ok: true,
    value: {
      partRef: part || null, description: part ? null : description.v, hsCode: part ? null : hs || null, unitValueEur: part ? null : unit.v,
      quantity: qty.v, packages: packages.v, lengthCm: l, widthCm: w, heightCm: h, netKg: net.v, grossKg: gross.v, originCountry: origin || null,
    },
  };
}

export interface StepInput {
  step: IncotermStep;
  plannedOn: string | null;
  actualOn: string | null;
  note: string | null;
}

/** "Edit step" of a tracked (seller's) step. */
export function parseStepForm(step: unknown, v: Values): Parsed<StepInput> {
  if (!isIncotermStep(step)) return { ok: false, error: 'Invalid request' };
  const planned = day(v.plannedOn);
  const actual = day(v.actualOn);
  if (!planned.ok || !actual.ok) return { ok: false, error: 'Enter dates as YYYY-MM-DD' };
  const note = text(v.note, SHIPMENT_NOTE_MAX);
  if (!note.ok) return { ok: false, error: 'Text too long' };
  return { ok: true, value: { step, plannedOn: planned.v, actualOn: actual.v, note: note.v } };
}

/** A gap's reason (decision 4): required, ≤ 500 characters. */
export function parseGapReason(v: unknown): Parsed<string> {
  const s = str(v);
  if (!s) return { ok: false, error: 'Give the reason of the gap' };
  return s.length > GAP_REASON_MAX ? { ok: false, error: 'Text too long' } : { ok: true, value: s };
}

/** A content line or gap key from the client: 'part:<ref>' or 'item:<uuid>'. */
export const isGapKey = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 80 && (/^part:[A-Z0-9][A-Z0-9._/-]*$/.test(v) || /^item:[0-9a-f-]{36}$/.test(v));
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
