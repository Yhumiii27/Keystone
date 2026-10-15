import 'server-only';
// C-9 (R-075): currency of a purchase order. An order is in EUR or in its project's currency (with the budget rate set). While
// it is a Draft, the buyer may switch it: the line prices are converted at the project's budget rate, so the order keeps its
// value in euros (the catalogue and the quotes are priced in euros), and the order is then sent, approved and pushed to Sage
// X3 in that currency. Once sent for approval the currency is fixed.
// Who (re-checked here as `setOrderCurrencyAction` checks it, R-041): Purchase orders in the actor's workspace and the actor on
// the project's team, or the portfolio director — `getProjectContext(code).canEdit('orders')`.
import { and, eq } from 'drizzle-orm';
import { currencyOf, documentCurrencyError, projectFxOf, rateToEur, type CurrencyCode } from '@/domain/currency';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { poLines, projects, purchaseOrders } from '@/server/db/schema';
import type { Actor } from './ops-common';
import { editsProjectScreen } from './team-guard';

/** Unit price converted between two currencies of a project at its budget rate, rounded to the cent. */
export const convertUnitPrice = (price: number, fromRate: number, toRate: number) => Math.round(((price * fromRate) / toRate) * 100) / 100;

/** Refusal of a currency change by someone who may not edit the project's orders (EN source; FR in orders.json). */
export const ORDERS_READ_ONLY = 'Purchase orders are read-only for you';

/**
 * Switches a Draft order to `currency` (EUR or the project currency), converting its line prices at the budget rate. Refused
 * for an actor who may not edit the project's orders, an order that is no longer a draft (guarded UPDATE), an unknown
 * currency, or a project currency without a rate. Writes an audit row and an activity event. Returns false when the order was
 * already in that currency.
 */
export async function setPurchaseOrderCurrency(number: string, currency: string, actor: Actor): Promise<boolean> {
  const actorName = actor.name;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ o: purchaseOrders, pCurrency: projects.currency, pRate: projects.budgetRate })
      .from(purchaseOrders)
      .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(eq(purchaseOrders.number, number))
      .for('update'); // the order and its project row: serialised with setProjectBudgetRate
    if (!row) throw new Error('Unknown purchase order');
    if (!(await editsProjectScreen(tx, actor, row.o.projectId, 'orders'))) throw new Error(ORDERS_READ_ONLY);
    const fx = projectFxOf({ currency: row.pCurrency, budgetRate: row.pRate });
    const err = documentCurrencyError(currency, fx);
    if (err) throw new Error(err);
    const to = currency as CurrencyCode;
    const from = currencyOf(row.o.currency);
    if (from === to) return false;
    const fromRate = rateToEur(from, fx);
    const toRate = rateToEur(to, fx);
    if (fromRate == null || toRate == null) throw new Error('Ask the portfolio director to set the project’s budget rate first');
    const [moved] = await tx.update(purchaseOrders).set({ currency: to, updatedAt: new Date() })
      .where(and(eq(purchaseOrders.id, row.o.id), eq(purchaseOrders.status, 'draft'))).returning({ id: purchaseOrders.id });
    if (!moved) throw new Error('This order is no longer a draft');
    const lines = await tx.select().from(poLines).where(eq(poLines.poId, row.o.id));
    for (const l of lines) await tx.update(poLines).set({ unitPriceEur: convertUnitPrice(l.unitPriceEur, fromRate, toRate) }).where(eq(poLines.id, l.id));
    const person = await findPerson(tx, actorName);
    const who = person ? nameOf(person) : actorName;
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: number, change: `currency: ${from} → ${to} · line prices converted at the budget rate`,
      area: 'Orders', entityType: 'purchase_order', entityId: row.o.id, projectId: row.o.projectId,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, text: `${number} now in ${to}`, kind: 'change', projectId: row.o.projectId });
    return true;
  });
}
