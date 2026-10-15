// Delivery 7 (lot cost-control) backfill of a database seeded before migration 0007: the cost if it occurs of the risks
// recorded when only their EMV was stored (Q-1: cost = EMV × 5 / P to two decimals, so the EMV shown is unchanged — the
// same rule as src/domain/risk.ts costOfLegacyEmv). Contingency draw-downs need nothing: the migration's column default
// makes the recorded ones `validated`. Idempotent (only rows without a cost), cheap, safe to run on every start.
import { and, isNotNull, isNull, sql } from 'drizzle-orm';
import { risks } from '../schema';
import type { DB, Tx } from '../types';

export async function backfillCostControl(q: DB | Tx): Promise<void> {
  await q
    .update(risks)
    .set({ costKeur: sql`round(${risks.emvKeur} * 5 / greatest(1, least(5, ${risks.probability})), 2)` })
    .where(and(isNull(risks.costKeur), isNotNull(risks.emvKeur)));
  await q.update(risks).set({ costKeur: 0 }).where(isNull(risks.costKeur));
}
