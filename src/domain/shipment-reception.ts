// R-158 lot B — site reception of a shipment and what follows it (owner's decisions 5 and 6, docs/delivery-9/
// cadrage-r158-expeditions.md § 5; notes docs/delivery-9/notes-r158-shipments.md § Lot B). Pure rules, no I/O, EN source labels
// (FR in src/i18n/extra/d9-shipments-b.json):
// - the pointing of each load (received, missing, damaged) and each content line (quantities received, missing, damaged — their
//   sum is the quantity shipped), once the shipment has arrived;
// - every gap raises a punch item (réserve) on the equipment line, of a default category per gap kind (`RECEPTION_PUNCH_CATEGORY`,
//   the pointer may choose another one);
// - the reception completed (every load and line pointed) makes the shipment "received"; it is "closed" once all its punch items
//   are closed, or by hand with a reason while some are still open;
// - the freight-delay warning (ETA later than the site need date) and the "Freight delay" risk proposed from it — never automatic.
import type { PunchCategory } from '@/server/db/codes';
import type { ShipmentStatus } from './shipments';

export const RECEPTION_LOAD_STATES = ['received', 'missing', 'damaged'] as const;
export type ReceptionLoadState = (typeof RECEPTION_LOAD_STATES)[number];
export const isReceptionLoadState = (v: unknown): v is ReceptionLoadState => typeof v === 'string' && (RECEPTION_LOAD_STATES as readonly string[]).includes(v);
export const RECEPTION_LOAD_STATE_LABEL: Record<ReceptionLoadState, string> = { received: 'Received', missing: 'Missing', damaged: 'Damaged' };

/** A gap found at the reception: something missing, or damaged. */
export type ReceptionGap = 'missing' | 'damaged';
export const RECEPTION_GAP_LABEL: Record<ReceptionGap, string> = { missing: 'Missing', damaged: 'Damaged' };

/**
 * Default category of the punch item a gap raises (decision taken without the owner, notes § Lot B): damaged equipment is
 * blocking (A) — it must be assessed, repaired or replaced before it is installed (safety); a missing item must be delivered
 * before the SAT (B). The pointer may choose another category in the reception dialog.
 */
export const RECEPTION_PUNCH_CATEGORY: Record<ReceptionGap, PunchCategory> = { missing: 'B', damaged: 'A' };

/** The reception is pointed while the shipment is "arrived" (and frozen once received). */
export const receptionOpen = (s: ShipmentStatus) => s === 'arrived';
/** The reception (pointing, punch items) is shown from the arrival on. */
export const receptionShown = (s: ShipmentStatus) => s === 'arrived' || s === 'received' || s === 'closed';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ── Input ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const RECEPTION_NOTE_MAX = 500;
export const CLOSE_REASON_MAX = 500;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const CATEGORIES: readonly PunchCategory[] = ['A', 'B', 'C'];
const category = (v: unknown, gap: ReceptionGap): PunchCategory | null => {
  const s = str(v).toUpperCase();
  if (!s) return RECEPTION_PUNCH_CATEGORY[gap];
  return (CATEGORIES as readonly string[]).includes(s) ? (s as PunchCategory) : null;
};
const qty = (v: unknown): number | null => {
  const s = str(v).replace(/[\s  ]/g, '').replace(',', '.');
  if (!s) return 0;
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 1_000_000 ? round3(n) : null;
};

export interface LoadReceptionInput {
  state: ReceptionLoadState;
  note: string | null;
  /** Category of the punch item of a missing or damaged load. */
  category: PunchCategory | null;
}

/** "Point the load": its state, a note (required for a gap), the punch category of a gap (default per kind). */
export function parseLoadReception(v: Record<string, unknown>): Parsed<LoadReceptionInput> {
  const state = str(v.state);
  if (!isReceptionLoadState(state)) return { ok: false, error: 'Invalid request' };
  const note = str(v.note);
  if (note.length > RECEPTION_NOTE_MAX) return { ok: false, error: 'Text is too long' };
  if (state !== 'received' && !note) return { ok: false, error: 'Describe the gap found at the reception' };
  const cat = state === 'received' ? null : category(v.category, state);
  if (state !== 'received' && !cat) return { ok: false, error: 'Unknown category' };
  return { ok: true, value: { state, note: note || null, category: cat } };
}

export interface ItemReceptionInput {
  received: number;
  missing: number;
  damaged: number;
  note: string | null;
  missingCategory: PunchCategory;
  damagedCategory: PunchCategory;
}

/**
 * "Point the content line": quantities received, missing and damaged (blank = 0) whose sum is the quantity shipped; a note is
 * required when there is a gap; the punch categories of the gaps (default per kind).
 */
export function parseItemReception(v: Record<string, unknown>, shipped: number): Parsed<ItemReceptionInput> {
  const received = qty(v.received);
  const missing = qty(v.missing);
  const damaged = qty(v.damaged);
  if (received == null || missing == null || damaged == null) return { ok: false, error: 'Invalid quantity' };
  if (Math.abs(received + missing + damaged - shipped) > 1e-9) return { ok: false, error: 'Received, missing and damaged must add up to the quantity shipped' };
  const note = str(v.note);
  if (note.length > RECEPTION_NOTE_MAX) return { ok: false, error: 'Text is too long' };
  if ((missing > 0 || damaged > 0) && !note) return { ok: false, error: 'Describe the gap found at the reception' };
  const missingCategory = category(v.missingCategory, 'missing');
  const damagedCategory = category(v.damagedCategory, 'damaged');
  if (!missingCategory || !damagedCategory) return { ok: false, error: 'Unknown category' };
  return { ok: true, value: { received, missing, damaged, note: note || null, missingCategory, damagedCategory } };
}

/** "Close shipment" by hand: the reason (required while punch items are still open). */
export function parseCloseReason(v: unknown, openPunch: number): Parsed<string | null> {
  const s = str(v);
  if (s.length > CLOSE_REASON_MAX) return { ok: false, error: 'Text is too long' };
  if (!s && openPunch > 0) return { ok: false, error: 'Give the reason for closing with open punch items' };
  return { ok: true, value: s || null };
}

// ── Progress and closure ────────────────────────────────────────────────────────────────────────────────────────────

export interface ReceptionFacts {
  loads: { id: string; items: { id: string }[] }[];
  /** Pointed load ids and content-line ids. */
  pointedLoads: ReadonlySet<string>;
  pointedItems: ReadonlySet<string>;
}

export interface ReceptionProgress {
  loads: number;
  loadsPointed: number;
  items: number;
  itemsPointed: number;
  complete: boolean;
}

/** How far the pointing is: every load and every content line pointed = complete (a shipment without load cannot be received). */
export function receptionProgress(f: ReceptionFacts): ReceptionProgress {
  const items = f.loads.flatMap((l) => l.items);
  const loadsPointed = f.loads.filter((l) => f.pointedLoads.has(l.id)).length;
  const itemsPointed = items.filter((i) => f.pointedItems.has(i.id)).length;
  return {
    loads: f.loads.length, loadsPointed, items: items.length, itemsPointed,
    complete: f.loads.length > 0 && loadsPointed === f.loads.length && itemsPointed === items.length,
  };
}

/** Why the reception cannot be completed yet (EN source), null when it can. */
export function receptionBlocker(status: ShipmentStatus, p: ReceptionProgress): string | null {
  if (status !== 'arrived') return 'The reception is pointed once the shipment has arrived';
  if (p.loadsPointed < p.loads) return 'Point every load first';
  if (p.itemsPointed < p.items) return 'Point every content line first';
  return null;
}

/** A received shipment closes by itself when its last punch item is closed (it stays received while one is open). */
export const closesWithPunch = (status: ShipmentStatus, openPunch: number) => status === 'received' && openPunch === 0;

// ── Freight delay (risk suggestion) ─────────────────────────────────────────────────────────────────────────────────

/** The site need date and where it comes from: the site sheet's start, else the schedule milestone tagged `arrivee_site`. */
export interface SiteNeed {
  date: string;
  source: 'site_sheet' | 'milestone';
}
export const SITE_NEED_SOURCE_LABEL: Record<SiteNeed['source'], string> = { site_sheet: 'site sheet start', milestone: 'site arrival milestone' };

/**
 * Days by which the shipment's ETA is later than the site need date, while the shipment is not on site yet (draft … in transit);
 * null when it is not late, has no ETA or the project has no need date.
 */
export function freightDelayDays(s: { status: ShipmentStatus; eta: string | null }, need: SiteNeed | null): number | null {
  if (!need || !s.eta || receptionShown(s.status)) return null;
  if (s.eta <= need.date) return null;
  return Math.round((Date.parse(`${s.eta}T00:00:00Z`) - Date.parse(`${need.date}T00:00:00Z`)) / 86_400_000);
}

export const FREIGHT_RISK_TITLE = 'Freight delay';
export const FREIGHT_RISK_CAUSE = 'Shipment ETA later than the site need date';
export const FREIGHT_RISK_CATEGORY = 'supplier_delivery';
export const FREIGHT_RISK_RESPONSE = 'mitigate';

/**
 * The "New risk" values proposed (field ids of `riskFormDef`): "Freight delay — EXP-01 · {title}", category Supplier / delivery
 * (else the first offered), owner the PM of record when on the owner list, response Mitigate; P and I keep the form's defaults.
 */
export function freightRiskDraft(
  s: { ref: string; label: string | null },
  ctx: { pmName: string | null; owners: readonly string[]; categories: readonly string[] },
  t: (english: string) => string,
): Record<string, string> {
  const cat = ctx.categories.includes(FREIGHT_RISK_CATEGORY) ? FREIGHT_RISK_CATEGORY : (ctx.categories[0] ?? FREIGHT_RISK_CATEGORY);
  const owner = ctx.pmName && ctx.owners.includes(ctx.pmName) ? ctx.pmName : (ctx.owners[0] ?? '');
  return { title: `${t(FREIGHT_RISK_TITLE)} — ${s.ref}${s.label ? ` · ${s.label}` : ''}`, cat, owner, resp: FREIGHT_RISK_RESPONSE };
}

/** The risk's trigger: "{cause} · EXP-01 · ETA {eta} · {need source} {need}" (in the language of the lead who raises it). */
export const freightRiskTrigger = (ref: string, etaText: string, need: SiteNeed, needText: string, t: (english: string) => string) =>
  [t(FREIGHT_RISK_CAUSE), ref, `ETA ${etaText}`, `${t(SITE_NEED_SOURCE_LABEL[need.source])} ${needText}`].join(' · ');

export const FREIGHT_RISK_LEADS_ONLY = 'Only the project’s leads raise a risk from a shipment';
export const FREIGHT_RISK_NOT_LATE = 'The shipment’s ETA is not later than the site need date';
export const FREIGHT_RISK_RAISED = 'A risk was already raised from this shipment';
