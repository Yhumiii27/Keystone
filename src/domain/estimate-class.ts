// Estimate class of a budget or an offer (R-188; DIG-PRODI v4.0 precision funnel ±50 % → ±30 % → +10/−5 %, docs/dig-prodi/
// ANALYSE-DIG-PRODI.md §3 and D-6, Arche request K-03 in REQUESTS.md). Pure: the Budget screen, the Portfolio overview, the
// "Set baseline" / "Re-baseline" Server Functions and — later — the answers to the subsidiaries' machine needs (R-187) share it.
//
// Bounds (same as Arche, src/domain/budget.ts `CLASS_RANGE`, and the K-03 contract): E50 −50 / +50 %, E30 −30 / +30 %,
// E10 −5 / +10 %. Funnel by lifecycle stage (ANALYSE-DIG-PRODI §3 table): Initiative (catalogue price) ±50 %, APS (budgetary
// quote) ±30 %, APD (BL1, BAC) +10/−5 %.
import type { EstimateClass, StageCode } from '@/server/db/codes';

export type { EstimateClass };

/** From the widest to the narrowest. */
export const ESTIMATE_CLASSES: readonly EstimateClass[] = ['E50', 'E30', 'E10'];

/** Range of each class around the central amount, in % (DIG-PRODI: ±50 %, ±30 %, +10/−5 %). */
export const ESTIMATE_CLASS_RANGE: Readonly<Record<EstimateClass, { lowPct: number; highPct: number }>> = {
  E50: { lowPct: -50, highPct: 50 },
  E30: { lowPct: -30, highPct: 30 },
  E10: { lowPct: -5, highPct: 10 },
};

/** Labels (EN source strings, translated through t()): the form options and the Budget screen. */
export const ESTIMATE_CLASS_LABEL: Readonly<Record<EstimateClass, string>> = {
  E50: 'E50 — order of magnitude (±50 %)',
  E30: 'E30 — budgetary (±30 %)',
  E10: 'E10 — firm (+10 % / −5 %)',
};

export const isEstimateClass = (v: unknown): v is EstimateClass => typeof v === 'string' && (ESTIMATE_CLASSES as readonly string[]).includes(v);

/** Precision rank: higher = narrower (E50 0, E30 1, E10 2). */
export const estimateClassRank = (c: EstimateClass) => ESTIMATE_CLASSES.indexOf(c);

/** `c` is at least as precise as `needed` (an E10 meets E30; null never meets). */
export const meetsEstimateClass = (c: EstimateClass | null | undefined, needed: EstimateClass) => !!c && estimateClassRank(c) >= estimateClassRank(needed);

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface EstimateRange {
  low: number;
  central: number;
  high: number;
}

/** Low / central / high amounts of a central amount (k€) in a class, rounded to 0.1. */
export function estimateRange(amount: number, c: EstimateClass): EstimateRange {
  const r = ESTIMATE_CLASS_RANGE[c];
  return { low: round1(amount * (1 + r.lowPct / 100)), central: round1(amount), high: round1(amount * (1 + r.highPct / 100)) };
}

/** Uncertainty gap of an amount in a class: high − low (E50 → 100 % of the amount, E30 → 60 %, E10 → 15 %). */
export const uncertaintyGap = (amount: number, c: EstimateClass) => {
  const r = estimateRange(amount, c);
  return round1(r.high - r.low);
};

// ── Default class by lifecycle stage ─────────────────────────────────────────────────────────────────────────────────

/**
 * Class proposed when a budget version (baseline) is frozen at this stage: Initiative E50 (indicative budget from catalogue
 * prices, G1), APS E30 (budgetary quote), APD and later E10 (BL1 is frozen at the end of APD, L-2, with the APD precision
 * +10/−5 %). Warranty, closed and cancelled projects keep E10. The person freezing the version may choose another class.
 */
export function stageEstimateClass(stage: StageCode): EstimateClass {
  if (stage === 'initiative') return 'E50';
  if (stage === 'aps') return 'E30';
  return 'E10';
}

/**
 * Class of a working budget that no frozen version covers yet (no current baseline): Initiative E50, APS and APD E30 (the
 * +10/−5 % precision is reached when BL1 is frozen at the end of APD). From Études on, a budget without a current baseline is
 * not classified (null): Keystone does not claim a precision nobody stated.
 */
export function workingEstimateClass(stage: StageCode): EstimateClass | null {
  if (stage === 'initiative') return 'E50';
  if (stage === 'aps' || stage === 'apd') return 'E30';
  return null;
}

/**
 * Class of a baseline recorded before R-188 (migration 0048_baseline_estimate_class_backfill, and the demo seed): BL1 and later
 * E10 (BL1 is frozen at the end of APD, L-2; later ones re-baseline an approved budget); BL0 — the proposal estimate — E30, E50
 * while the project is still at Initiative; any other code null.
 */
export function legacyBaselineClass(code: string, stage: StageCode): EstimateClass | null {
  const m = /^BL(\d+)$/.exec(code);
  if (!m) return null;
  if (parseInt(m[1], 10) >= 1) return 'E10';
  return stage === 'initiative' ? 'E50' : 'E30';
}

/** Where a budget's class comes from: its current baseline, the stage (working budget), or nowhere. */
export type EstimateClassSource = 'baseline' | 'stage' | 'none';

export interface BudgetEstimate {
  estimateClass: EstimateClass | null;
  source: EstimateClassSource;
  /** Code of the current baseline when the class comes from it ("BL1"). */
  baselineCode: string | null;
}

/**
 * Class of a project's current budget: the class of its current baseline when it has one, else the working-budget class of its
 * stage. A current baseline left unclassified (null) is not replaced by the stage default.
 */
export function budgetEstimate(stage: StageCode, current: { code: string; estimateClass: EstimateClass | null } | null): BudgetEstimate {
  if (current) return { estimateClass: current.estimateClass, source: current.estimateClass ? 'baseline' : 'none', baselineCode: current.code };
  const w = workingEstimateClass(stage);
  return { estimateClass: w, source: w ? 'stage' : 'none', baselineCode: null };
}

// ── Offers (R-187) ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Nature of an answer to a subsidiary's machine need (K-03 `pub_reponses_besoins.nature`). */
export type OfferNature = 'qualification' | 'indicatif' | 'devis' | 'offre_ferme';

/** Minimum class of each nature: a firm offer is E10 (K-03); the others accept any class. */
export const OFFER_NATURE_MIN_CLASS: Readonly<Record<OfferNature, EstimateClass | null>> = {
  qualification: null,
  indicatif: null,
  devis: null,
  offre_ferme: 'E10',
};

export const FIRM_OFFER_CLASS_MESSAGE = 'A firm offer requires estimate class E10 (+10 % / −5 %)';

/**
 * Refusal of an amount's class for an offer of this nature (null = accepted): a firm offer needs E10; a priced answer of another
 * nature needs a class too. `priced` false = an answer without amount (a qualification), which needs no class.
 */
export function offerClassError(nature: OfferNature, c: EstimateClass | null | undefined, priced = true): string | null {
  const min = OFFER_NATURE_MIN_CLASS[nature];
  if (min && !meetsEstimateClass(c, min)) return FIRM_OFFER_CLASS_MESSAGE;
  if (priced && !c) return 'A priced answer needs an estimate class';
  return null;
}

// ── Portfolio indicator ──────────────────────────────────────────────────────────────────────────────────────────────

export interface UncertaintyTotals {
  /** Σ (high − low) of the classified budgets, k€. */
  gap: number;
  /** Σ of the classified budgets, k€. */
  classified: number;
  /** Budgets not at E10: E50, E30 or not classified. */
  notFirm: number;
  /** Budgets without a class. */
  unclassified: number;
}

/** "Uncertainty gap" of a set of budgets (Portfolio overview): Σ (high − low) and the budgets not yet at E10. */
export function uncertaintyTotals(budgets: readonly { amount: number; estimateClass: EstimateClass | null }[]): UncertaintyTotals {
  let gap = 0;
  let classified = 0;
  let notFirm = 0;
  let unclassified = 0;
  for (const b of budgets) {
    if (b.estimateClass !== 'E10') notFirm++;
    if (!b.estimateClass) {
      unclassified++;
      continue;
    }
    gap += uncertaintyGap(b.amount, b.estimateClass);
    classified += b.amount;
  }
  return { gap: round1(gap), classified: round1(classified), notFirm, unclassified };
}
