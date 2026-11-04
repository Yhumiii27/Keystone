// S-27 (owner, follow-up questionnaire of delivery 9): a supplier schedule (R-204) that slips by 5 working days or more alerts
// the order's buyer and the project's leads — a bell notification (kind "alert": e-mail by each person's choice, R-036), once
// per slip level: at 5, 10, 15… working days; a schedule back under 5 working days clears its levels, so a new slip is told
// again. Pure rules; the DAL runs them every morning (src/server/dal/supplier-slip-notices.ts, job "indicator-alerts").
import { orderBuyer } from './receipt-notices';

/** The owner's threshold (working days); one level per further step of the same size. */
export const SUPPLIER_SLIP_ALERT_DAYS = 5;

/** Slip level of a schedule: 0 under the threshold, then 1 from 5 working days, 2 from 10… */
export function supplierSlipLevel(slipDays: number, step: number = SUPPLIER_SLIP_ALERT_DAYS): number {
  if (!(slipDays >= step) || step <= 0) return 0;
  return Math.floor(slipDays / step);
}

/**
 * The persons alerted: the order's buyer — the first of [submitted by, created by, RFQ owner] with an active account (the
 * rule of the receipt notices) — else the procurement users, and the project's leads; active accounts only, no duplicates.
 */
export function supplierSlipRecipients(
  input: { buyerChain: readonly (string | null | undefined)[]; procurement: readonly string[]; leads: readonly string[] }, active: ReadonlySet<string>,
): string[] {
  const buyer = orderBuyer(input.buyerChain, active);
  const buyers = buyer ? [buyer] : input.procurement;
  return [...new Set([...buyers, ...input.leads])].filter((id) => active.has(id));
}

/** Send-log slots of a level: one per level reached ("level:1" … "level:n"); the notice goes with the highest one only. */
export const supplierSlipSlots = (level: number): string[] => Array.from({ length: Math.max(0, level) }, (_, i) => `level:${i + 1}`);

/** Fixed EN title (FR in src/i18n/extra/d9-s-quality.json); the order number and the slip follow after " · ". */
export const SUPPLIER_SLIP_TITLE = 'Supplier schedule slipping';
export const supplierSlipTitle = (po: string, slipDays: number) => `${SUPPLIER_SLIP_TITLE} · ${po} · +${slipDays} working days`;
