import 'server-only';
// C-9 (R-075): project currency and budget rate. A project has a currency (`projects.currency`, EUR when null) and, when it is
// not EUR, a budget rate (euros per unit) that the portfolio director and Finance set (R-044 default); the project's contract, purchase orders and
// invoices are in EUR or in that currency, and every consolidation in euros (Budget › Cash & recovery, Cash flow,
// Prioritisation, portfolio margin, alerts) converts at that rate (`toEur`, src/domain/currency.ts).
// Write rule: the currency of a project changes only while none of its documents uses the current one (else they would be
// left without a rate); the rate itself can change at any time (the consolidated figures follow).
import { and, eq, sql } from 'drizzle-orm';
import { cache } from 'react';
import { BASE_CURRENCY, isCurrency, parseBudgetRate, projectFxOf, type CurrencyCode, type ProjectFx } from '@/domain/currency';
import { canSetBudgetRate } from '@/domain/rights';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { contracts, customerInvoices, paymentMilestones, projects, purchaseOrders, supplierInvoices } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import type { Actor } from './ops-common';

/** Currency and budget rate of every project, keyed by code (one read per request). */
export const listProjectFx = cache(async (): Promise<Record<string, ProjectFx>> => {
  const db = await getDb();
  const rows = await db.select({ code: projects.code, currency: projects.currency, budgetRate: projects.budgetRate }).from(projects);
  return Object.fromEntries(rows.map((r) => [r.code, projectFxOf(r)]));
});

/** Currency and budget rate of a project (EUR without rate when the code is unknown). */
export async function getProjectFx(code: string, q?: DB | Tx): Promise<ProjectFx> {
  const db = q ?? (await getDb());
  const [r] = await db.select({ currency: projects.currency, budgetRate: projects.budgetRate }).from(projects).where(eq(projects.code, code));
  return projectFxOf(r ?? {});
}

/** Documents of the project in `currency` (contract, purchase orders, customer invoices, supplier invoices on its orders). */
async function documentsIn(tx: Tx, projectId: string, currency: CurrencyCode): Promise<number> {
  const [[a], [b], [c], [d]] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.projectId, projectId), eq(contracts.currency, currency))),
    tx.select({ n: sql<number>`count(*)::int` }).from(purchaseOrders).where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.currency, currency))),
    tx.select({ n: sql<number>`count(*)::int` }).from(customerInvoices).innerJoin(paymentMilestones, eq(paymentMilestones.id, customerInvoices.paymentMilestoneId))
      .where(and(eq(paymentMilestones.projectId, projectId), eq(customerInvoices.currency, currency))),
    tx.select({ n: sql<number>`count(*)::int` }).from(supplierInvoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, supplierInvoices.poId))
      .where(and(eq(purchaseOrders.projectId, projectId), eq(supplierInvoices.currency, currency))),
  ]);
  return a.n + b.n + c.n + d.n;
}

export interface BudgetRateInput {
  currency: string;
  /** Euros per unit, as typed ("0.92" / "0,92"); ignored for EUR. */
  rate: string | number | null;
}

/**
 * Refusal of a budget-rate change by anyone but the portfolio director and Finance (C-9; R-044 default, DELIVERY-7 §8 open
 * question). EN source; FR in d8-roles-rates-hr.json.
 */
export const BUDGET_RATE_REFUSED = 'Only the portfolio director and Finance set the budget rate';

/**
 * Sets a project's currency and budget rate (portfolio director and Finance — `canSetBudgetRate`, checked by the Server
 * Function and re-checked here with `actor`). EUR clears the rate. Another currency needs a rate (0.0001–10 000 € per unit). Changing the currency is refused
 * while a document of the project is in the current non-EUR currency. Writes an audit row and an activity event. Returns
 * the stored values.
 */
export async function setProjectBudgetRate(projectCode: string, input: BudgetRateInput, actor: Actor): Promise<ProjectFx> {
  if (!canSetBudgetRate(actor.role)) throw new Error(BUDGET_RATE_REFUSED);
  const actorName = actor.name;
  if (!isCurrency(input.currency)) throw new Error('Unknown currency');
  const currency = input.currency;
  const rate = currency === BASE_CURRENCY ? null : parseBudgetRate(input.rate);
  if (currency !== BASE_CURRENCY && rate == null) throw new Error('Enter a budget rate in euros per unit');
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    // Locked: a document moving to the project currency (contract, order) reads the project row under the same lock.
    const [cur] = await tx.select({ currency: projects.currency, budgetRate: projects.budgetRate }).from(projects).where(eq(projects.id, p.id)).for('update');
    const old = projectFxOf(cur);
    if (old.currency === currency && old.budgetRate === rate) return old;
    if (old.currency !== currency && old.currency !== BASE_CURRENCY && (await documentsIn(tx, p.id, old.currency)) > 0)
      throw new Error('Documents of this project are in its currency: it cannot change');
    await tx.update(projects).set({ currency, budgetRate: rate, updatedAt: new Date() }).where(eq(projects.id, p.id));
    const person = await findPerson(tx, actorName);
    const who = person ? nameOf(person) : actorName;
    const text = (fx: ProjectFx) => (fx.currency === BASE_CURRENCY ? 'EUR' : `${fx.currency} · 1 ${fx.currency} = ${fx.budgetRate ?? '—'} €`);
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: projectCode, change: `budget rate: ${text(old)} → ${text({ currency, budgetRate: rate })}`,
      area: 'Contract', entityType: 'project', entityId: p.id, projectId: p.id,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, text: `Budget rate ${text({ currency, budgetRate: rate })}`, kind: 'change', projectId: p.id });
    return { currency, budgetRate: rate };
  });
}
