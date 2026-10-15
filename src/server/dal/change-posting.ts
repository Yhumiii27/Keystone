import 'server-only';
// Posting of an approved change request to the budget and the contract (delivery 7, R-068; owner decision A-4 "Registre
// unique, propagation automatique": "dès l'approbation, le BAC est révisé et l'avenant est préparé pour signature").
// Called by the Change control writer (decideChangeStep) inside the approval transaction, whichever screen approves —
// Change control or My approvals. Rules (src/domain/cost-control.ts):
//  - the project's BAC moves by the request's amount (an atomic increment);
//  - the split over the work packages is recorded (the Budget re-derives its "Changes" column from the register);
//  - a contractual change (the client approved it) on a project with a contract gets a DRAFT amendment for the same amount,
//    linked to the request — counted in the contract value once signed — unless the contract already has one for it; the
//    amendment is in the contract's currency (C-9, R-075), the request's k€ converted at the project's budget rate;
//  - one posting per request: the unique row of `change_request_postings` makes a re-run, a retry or a concurrent approval
//    a no-op (idempotent); every posting is audited (Budget, Contract) and traced in the activity feed.
// Delivery 8: the amendment is prepared only when the contractual impact includes the price (R-069, P-6c / A-4); the amount moves
// the budget of the request's cost category when one was chosen (R-081, C-3a: after BL1 a category's amount changes only through
// an approved change request), its forecast too while nothing is spent or committed on it; never below 0 (clamped).
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { allocateChange, amendmentOutcome, amendmentSubject, postedCategoryBudget, type AmendmentOutcome } from '@/domain/cost-control';
import { currencyOf, eurRate, projectFxOf, thousandsUnit } from '@/domain/currency';
import type { Tx } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import {
  changeRequestPostings, changeRequestSteps, changeRequestWbs, changeRequests, contractAmendments, contracts, costCategories, projects, wpBudgets,
} from '@/server/db/schema';

export interface ChangePosting {
  amount: number;
  bacBefore: number;
  bacAfter: number;
  allocations: { code: string; amountKeur: number }[];
  amendment: AmendmentOutcome;
  /** Label of the prepared amendment ("Amendment 3 — Second steel crew — schedule recovery (CR-008)"). */
  amendmentLabel: string | null;
  /** R-081: the cost category whose budget moved (k€ before → after; after ≥ 0), null when the request names none. */
  category: { code: string; before: number; after: number } | null;
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v)} k€`;

/**
 * Posts an approved change request (by id) once; returns what was posted, or null when the request had been posted already
 * (or is not approved). Must run inside the approval's transaction.
 */
export async function postApprovedChange(tx: Tx, changeRequestId: string, actorName: string): Promise<ChangePosting | null> {
  const [cr] = await tx.select().from(changeRequests).where(eq(changeRequests.id, changeRequestId));
  if (!cr || cr.status !== 'approved') return null;
  const [already] = await tx.select({ id: changeRequestPostings.id }).from(changeRequestPostings).where(eq(changeRequestPostings.changeRequestId, cr.id));
  if (already) return null;
  const [proj] = await tx
    .select({ code: projects.code, bac: projects.budgetKeur, currency: projects.currency, budgetRate: projects.budgetRate })
    .from(projects)
    .where(eq(projects.id, cr.projectId))
    .for('update');
  const [wbs, packages, steps, [contract]] = await Promise.all([
    tx.select({ code: changeRequestWbs.wbsCode, amount: changeRequestWbs.amountKeur }).from(changeRequestWbs).where(eq(changeRequestWbs.changeRequestId, cr.id)).orderBy(asc(changeRequestWbs.position)),
    tx.select({ code: wpBudgets.wbsCode, original: wpBudgets.originalKeur }).from(wpBudgets).where(eq(wpBudgets.projectId, cr.projectId)).orderBy(asc(wpBudgets.position)),
    tx.select({ step: changeRequestSteps.step, decision: changeRequestSteps.decision }).from(changeRequestSteps).where(eq(changeRequestSteps.changeRequestId, cr.id)),
    tx.select({ id: contracts.id, reference: contracts.reference, currency: contracts.currency }).from(contracts).where(eq(contracts.projectId, cr.projectId)),
  ]);
  const amount = cr.amountKeur || 0;
  const allocations = allocateChange(amount, wbs, packages).map((a) => ({ code: a.code, amountKeur: a.amount }));
  const existing = contract
    ? (
        await tx
          .select({ id: contractAmendments.id })
          .from(contractAmendments)
          .where(and(eq(contractAmendments.contractId, contract.id), or(eq(contractAmendments.changeRequestId, cr.id), eq(contractAmendments.changeRequestRef, cr.number))))
      )[0]
    : undefined;
  const clientStep = steps.find((s) => s.step === 'client')?.decision ?? null;
  const outcome = amendmentOutcome({ clientStep, amount, contractImpact: cr.contractImpact ?? null }, { hasContract: !!contract, amendmentExists: !!existing });
  const actor = await findPerson(tx, actorName);
  const who = actor ? nameOf(actor) : actorName;
  const bacBefore = proj.bac;
  const bacAfter = Math.round((bacBefore + amount) * 100) / 100;
  // The unique key on the request: a concurrent posting of the same request inserts nothing and stops here.
  const [posting] = await tx
    .insert(changeRequestPostings)
    .values({
      changeRequestId: cr.id, projectId: cr.projectId, amountKeur: amount, bacBeforeKeur: bacBefore, bacAfterKeur: bacAfter, allocations,
      amendmentOutcome: outcome, amendmentId: existing?.id ?? null, postedByPersonId: actor?.id ?? null, postedByName: who,
    })
    .onConflictDoNothing({ target: changeRequestPostings.changeRequestId })
    .returning({ id: changeRequestPostings.id });
  if (!posting) return null;
  // A request without amount (a re-baseline, a scope precision) moves nothing: the posting row only records it.
  if (!amount) return { amount, bacBefore, bacAfter, allocations, amendment: outcome, amendmentLabel: null, category: null };
  await tx.update(projects).set({ budgetKeur: sql`${projects.budgetKeur} + ${amount}`, updatedAt: new Date() }).where(eq(projects.id, cr.projectId));
  // R-081 (C-3a, A-4): the request's cost category takes the amount — once, inside this idempotent posting.
  let category: ChangePosting['category'] = null;
  if (cr.costCategoryCode) {
    const [cat] = await tx.select().from(costCategories).where(and(eq(costCategories.projectId, cr.projectId), eq(costCategories.code, cr.costCategoryCode))).for('update');
    if (cat) {
      const after = postedCategoryBudget(cat.budgetKeur, amount);
      await tx.update(costCategories)
        .set({ budgetKeur: after, ...(!cat.actualKeur && !cat.committedKeur ? { forecastKeur: after } : {}), updatedAt: new Date() })
        .where(eq(costCategories.id, cat.id));
      category = { code: cat.code, before: cat.budgetKeur, after };
      await writeAudit(tx, {
        actorName: who, actorPersonId: actor?.id, objectRef: `${proj.code} · ${cat.code}`, area: 'Budget', entityType: 'cost_category', entityId: cat.id, projectId: cr.projectId,
        change: `budget: ${cat.budgetKeur} → ${after} k€ · from ${cr.number}`,
      });
    }
  }
  await writeAudit(tx, {
    actorName: who, actorPersonId: actor?.id, objectRef: cr.number, area: 'Budget', entityType: 'change_request', entityId: cr.id, projectId: cr.projectId,
    change: `posted to the budget · BAC ${bacBefore} → ${bacAfter} k€${allocations.length ? ' · ' + allocations.map((a) => `${a.code} ${signed(a.amountKeur)}`).join(', ') : ''}`
      + (category ? ` · category ${category.code} ${category.before} → ${category.after} k€` : ''),
  });
  let amendmentLabel: string | null = null;
  if (outcome === 'prepared' && contract) {
    const [{ n, maxPos }] = await tx
      .select({ n: sql<number>`count(*)::int`, maxPos: sql<number>`coalesce(max(${contractAmendments.position}), -1)::int` })
      .from(contractAmendments)
      .where(eq(contractAmendments.contractId, contract.id));
    const subject = amendmentSubject(n + 1, cr.title);
    // C-9: every amount of the contract is in its currency — the request's k€ at the project's budget rate (1 for EUR).
    const currency = currencyOf(contract.currency);
    const amendmentAmount = Math.round((amount / eurRate(currency, projectFxOf(proj))) * 100) / 100;
    const [a] = await tx
      .insert(contractAmendments)
      .values({ contractId: contract.id, position: maxPos + 1, subject, changeRequestRef: cr.number, changeRequestId: cr.id, amountKeur: amendmentAmount, status: 'draft' })
      .returning({ id: contractAmendments.id });
    await tx.update(changeRequestPostings).set({ amendmentId: a.id }).where(eq(changeRequestPostings.id, posting.id));
    amendmentLabel = `${subject} (${cr.number})`;
    await writeAudit(tx, {
      actorName: who, actorPersonId: actor?.id, objectRef: contract.reference, area: 'Contract', entityType: 'contract_amendment', entityId: a.id, projectId: cr.projectId,
      change: `amendment prepared from ${cr.number} · ${amendmentLabel} · ${amendmentAmount} ${thousandsUnit(currency)} · Draft`,
    });
  }
  await recordActivity(tx, {
    actorName: who, actorPersonId: actor?.id, kind: 'change', projectId: cr.projectId,
    text: `Posted ${cr.number} to the budget · BAC ${signed(amount)}${amendmentLabel ? ' · amendment prepared' : ''}`,
  });
  return { amount, bacBefore, bacAfter, allocations, amendment: outcome, amendmentLabel, category };
}
