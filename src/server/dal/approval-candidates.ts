import 'server-only';
// Candidate projects of the project-bound approval kinds (R-017, src/server/approvals/types.ts `candidates`): one query per kind
// gives the projects where an item can exist, so the shell's per-project "My approvals" badges and the director's queue of
// the portfolio alerts ask the providers for those projects only (they asked every project of the portfolio). Supersets: the
// provider's `items` keeps the final word (approver, step, outbox). Memoised per request.
import { and, eq } from 'drizzle-orm';
import { cache } from 'react';
import { getDb } from '@/server/db/client';
import { changeRequestSteps, changeRequests, goodsReceipts, projects, purchaseOrders, vigieNcrs } from '@/server/db/schema';

const codes = (rows: { code: string }[]): ReadonlySet<string> => new Set(rows.map((r) => r.code));

/** Projects with a change request holding a pending step (the only ones with a current step to decide). */
export const projectsWithPendingChangeSteps = cache(async (): Promise<ReadonlySet<string>> => {
  const db = await getDb();
  return codes(await db.selectDistinct({ code: projects.code }).from(changeRequestSteps)
    .innerJoin(changeRequests, eq(changeRequests.id, changeRequestSteps.changeRequestId))
    .innerJoin(projects, eq(projects.id, changeRequests.projectId))
    .where(eq(changeRequestSteps.decision, 'pending')));
});

/** Projects with a purchase order awaiting approval. */
export const projectsWithOrdersAwaitingApproval = cache(async (): Promise<ReadonlySet<string>> => {
  const db = await getDb();
  return codes(await db.selectDistinct({ code: projects.code }).from(purchaseOrders).innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(eq(purchaseOrders.status, 'awaiting_approval')));
});

/** Projects with a goods receipt waiting for its quality check. */
export const projectsWithReceiptsInQc = cache(async (): Promise<ReadonlySet<string>> => {
  const db = await getDb();
  return codes(await db.selectDistinct({ code: projects.code }).from(goodsReceipts).innerJoin(projects, eq(projects.id, goodsReceipts.projectId))
    .where(eq(goodsReceipts.status, 'qc_pending')));
});

/** Projects with an NCR in Verification in the Vigie mirror (never a call to Vigie). */
export const projectsWithNcrsInVerification = cache(async (): Promise<ReadonlySet<string>> => {
  const db = await getDb();
  return codes(await db.selectDistinct({ code: vigieNcrs.projectCode }).from(vigieNcrs).where(and(eq(vigieNcrs.status, 'verification'))));
});
