// "Create spares purchase order" of the Project BOM's PU/PR list (chapter 4; docs/spec/00 E-3, 09 OQ20). Pure rules — the
// chapter-5 questionnaire may change any of them here:
// - the candidates are the lines of the list as displayed (system and PU/PR filter);
// - the suggested quantity tops the stock up to the recommended quantity: recommended − on hand (Σ every location, E-3)
//   − still to receive on the project's open spares orders, never below 0;
// - lines are pre-selected when something is missing, the part has a preferred supplier and no open ECO freezes it;
// - one DRAFT purchase order per preferred supplier (the part's manufacturer), origin 'spares' — so it never counts
//   against the BOM shortfall — at the list's unit price (last purchase price, else list price), expected "To confirm";
//   the PM then sends it for approval on Purchase orders, as any draft.
import type { PartStatus, WearSpare } from '@/server/db/codes';

export interface SpareOrderCandidate {
  ref: string;
  /** EN data text. */
  name: string;
  kind: WearSpare;
  /** Preferred supplier (the part's manufacturer); null = cannot be ordered from here. */
  supplier: string | null;
  recommendedQty: number;
  inStock: number;
  /** Still to receive on the project's open spares orders (ordered − received, not cancelled / received). */
  onOrder: number;
  /** € per unit (the PU/PR list's "Unit price"). */
  unitPriceEur: number;
  leadWeeks: number | null;
  status: PartStatus;
  /** Frozen by an open ECO. */
  underChange: boolean;
}

/** Largest quantity accepted on one line. */
export const SPARES_ORDER_MAX_QTY = 9999;

/** Quantity that tops the stock up to the recommended quantity (0 when nothing is missing). */
export const suggestedSpareQty = (c: Pick<SpareOrderCandidate, 'recommendedQty' | 'inStock' | 'onOrder'>) =>
  Math.max(0, Math.ceil(c.recommendedQty - c.inStock - c.onOrder));

/** Pre-selected in the dialog: something is missing, the part has a supplier, no open ECO freezes it. */
export const isPreselected = (c: SpareOrderCandidate) => suggestedSpareQty(c) > 0 && !!c.supplier && !c.underChange;

export interface SparesOrderLine {
  ref: string;
  qty: number;
}

export interface ValidSparesOrderLine extends SparesOrderLine {
  supplier: string;
  unitPriceEur: number;
}

/**
 * Validates the lines the user kept (raw input): at least one, each a candidate of the list with a supplier, once, with an
 * integer quantity 1…SPARES_ORDER_MAX_QTY. Errors are EN source strings.
 */
export function validateSparesOrder(raw: unknown, candidates: readonly SpareOrderCandidate[]): { ok: true; lines: ValidSparesOrderLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'Select at least one line to order' };
  if (raw.length > candidates.length) return { ok: false, error: 'Invalid request' };
  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const seen = new Set<string>();
  const lines: ValidSparesOrderLine[] = [];
  for (const x of raw as unknown[]) {
    const ref = x && typeof x === 'object' && typeof (x as SparesOrderLine).ref === 'string' ? (x as SparesOrderLine).ref : '';
    const qty = x && typeof x === 'object' ? (x as SparesOrderLine).qty : NaN;
    const c = byRef.get(ref);
    if (!c || seen.has(ref)) return { ok: false, error: 'This line is not in the list any more' };
    if (!c.supplier) return { ok: false, error: 'This part has no preferred supplier' };
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > SPARES_ORDER_MAX_QTY) return { ok: false, error: 'Enter a whole quantity of at least 1' };
    seen.add(ref);
    lines.push({ ref, qty, supplier: c.supplier, unitPriceEur: c.unitPriceEur });
  }
  return { ok: true, lines };
}

/** One draft per supplier, in the order the suppliers first appear; lines keep the list order. */
export function groupBySupplier<L extends { supplier: string }>(lines: readonly L[]): { supplier: string; lines: L[] }[] {
  const out: { supplier: string; lines: L[] }[] = [];
  for (const l of lines) {
    const g = out.find((x) => x.supplier === l.supplier);
    if (g) g.lines.push(l);
    else out.push({ supplier: l.supplier, lines: [l] });
  }
  return out;
}

/** Σ quantity × unit price, € (dialog total and per-supplier totals). */
export const sparesOrderValue = (lines: readonly { qty: number; unitPriceEur: number }[]) => lines.reduce((s, l) => s + l.qty * l.unitPriceEur, 0);
