// Delivery 8 (lot cost-change, R-069) backfill of a database seeded before the contractual impact existed: each change request
// without one gets the impact its stored chain and figures imply (`inferredContractImpact`: client step "n/a" → internal, else
// price / dates / both from the amount and the days; none of them → left null). The stored decisions are kept as they are.
// Idempotent (only rows without an impact), cheap, safe to run on every start.
import { and, eq, isNull } from 'drizzle-orm';
import { inferredContractImpact } from '@/domain/change-control';
import { changeRequestSteps, changeRequests } from '../schema';
import type { DB, Tx } from '../types';

export async function backfillContractImpacts(q: DB | Tx): Promise<number> {
  const rows = await q
    .select({ id: changeRequests.id, amount: changeRequests.amountKeur, days: changeRequests.scheduleDays, client: changeRequestSteps.decision })
    .from(changeRequests)
    .leftJoin(changeRequestSteps, and(eq(changeRequestSteps.changeRequestId, changeRequests.id), eq(changeRequestSteps.step, 'client')))
    .where(isNull(changeRequests.contractImpact));
  let n = 0;
  for (const r of rows) {
    const impact = inferredContractImpact({ clientStep: r.client ?? null, amountKeur: r.amount, scheduleDays: r.days });
    if (!impact) continue;
    await q.update(changeRequests).set({ contractImpact: impact }).where(and(eq(changeRequests.id, r.id), isNull(changeRequests.contractImpact)));
    n++;
  }
  return n;
}
