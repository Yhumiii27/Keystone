// S-33 (owner, 5 Nov 2026): the portfolio alerts (Overview "Needs attention", the director's Home, the dashboards' "Alerts" widget)
// are ordered by urgency and importance instead of by alert kind; the list keeps its cap (8). Pure and deterministic.
//
// Rule (written for the owner in docs/delivery-9/notes-s-alerts.md):
//   1. a class of importance first —
//      class 1 "the project's end date or its contract is hit": off track (A-13), critical-path slip (negative float), a supplier
//              slip that pushes the project's forecast finish by at least the S-34 impact threshold;
//      class 2 "a project indicator is drifting": cost overrun, billing late, late milestone, low Monte-Carlo chance, any other
//              supplier slip;
//      class 3 "the portfolio's organisation": over-allocation of the shared pool, approvals waiting;
//   2. inside a class, the magnitude: how far the alert is from "fine", as a share (0–100 %) of a reference size —
//      days of slip, money, days late, missing chance —, the bigger first (`ALERT_MAGNITUDE_SCALES`);
//   3. equal scores: the former kind order (off track, critical slip, cost, billing, pool, approvals, milestone, supplier,
//      Monte-Carlo), then the register order of the project, then the alert key.
import type { AlertKind } from './portfolio-alerts';

export type AlertClass = 1 | 2 | 3;

/** Reference size of each magnitude: at this size the alert reaches 100 % of its class. */
export const ALERT_MAGNITUDE_SCALES = {
  /** Off track: the weaker index this far under the "Off track below" threshold. */
  offTrackIndexGap: 0.2,
  /** Critical-path slip: working days of negative float. */
  criticalSlipDays: 60,
  /** Supplier slip pushing the project's finish (class 1): working days of finish impact. */
  supplierFinishImpactDays: 60,
  /** Supplier slip without (enough) finish impact (class 2): working days of slip against the supplier's commitment. */
  supplierSlipDays: 60,
  /** Cost overrun: forecast over budget, share of the budget. */
  costOverrunShare: 0.2,
  /** Billing late: calendar days since the oldest due date. */
  billingLateDays: 60,
  /** Late milestones: number of milestones flagged Late. */
  lateMilestones: 3,
  /** Monte-Carlo: missing chance, share of the alert threshold (0 % chance = 100 %). */
  chanceGapShare: 1,
  /** Over-allocation: people above the threshold. */
  overAllocatedPeople: 5,
  /** Approvals: calendar days the oldest one has been waiting. */
  approvalDays: 30,
} as const;

/** Former kind order (R-130), now the tie-break between equal scores. */
export const ALERT_KIND_ORDER: Record<AlertKind, number> = {
  off_track: 0, critical_slip: 1, cost_overrun: 2, billing_late: 3, over_allocation: 4, approvals_waiting: 5, milestone_late: 6, supplier_slip: 7, risk_forecast: 8,
};

/** Class of each kind; a supplier slip is class 1 only when its finish impact reaches the threshold (`alertClass`). */
const KIND_CLASS: Record<AlertKind, AlertClass> = {
  off_track: 1, critical_slip: 1, cost_overrun: 2, billing_late: 2, milestone_late: 2, supplier_slip: 2, risk_forecast: 2, over_allocation: 3, approvals_waiting: 3,
};

export function alertClass(kind: AlertKind, opts: { finishImpact?: boolean } = {}): AlertClass {
  return kind === 'supplier_slip' && opts.finishImpact ? 1 : KIND_CLASS[kind];
}

/** Share of a reference size, 0–1 (negative, missing or invalid → 0; beyond the size → 1). */
export function magnitude(value: number | null | undefined, scale: number): number {
  if (value == null || !Number.isFinite(value) || !(scale > 0) || value <= 0) return 0;
  return Math.min(1, value / scale);
}

/**
 * Score of an alert: its class first (class 1 = 3 000 to 4 000, class 2 = 2 000 to 3 000, class 3 = 1 000 to 2 000), then its
 * magnitude in thousandths. A class-2 alert never passes a class-1 alert.
 */
export function alertScore(cls: AlertClass, share: number): number {
  const m = Math.round(Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 1000);
  return (4 - cls) * 1000 + m;
}

export interface RankedAlert {
  key: string;
  kind: AlertKind;
  score: number;
  /** Register order of the alert's project (0 for the portfolio-wide alerts). */
  order: number;
}

/** Highest score first; then the former kind order, the register order, the key. */
export function compareAlerts(a: RankedAlert, b: RankedAlert): number {
  return b.score - a.score || ALERT_KIND_ORDER[a.kind] - ALERT_KIND_ORDER[b.kind] || a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
