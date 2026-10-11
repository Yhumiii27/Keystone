import 'server-only';
// C-9 (R-075): currency of a purchase order. An order is in EUR or in its project's currency (with the budget rate set). While
// it is a Draft, the buyer may switch it: the line prices are converted at the project's budget rate, so the order keeps its
// value in euros (the catalogue and the quotes are priced in euros), and the order is then sent, approved and pushed to Sage
// X3 in that currency. Once sent for approval the currency is fixed.
import { and, eq } from 'drizzle-orm';
import { currencyOf, documentCurrencyError, projectFxOf, rateToEur, type CurrencyCode } from '@/domain/currency';
import { getDb } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { poLines, projects, purchaseOrders } from '@/server/db/schema';

/** Unit price converted between two currencies of a project at its budget rate, rounded to the cent. */
export const convertUnitPrice = (price: number, fromRate: number, toRate: number) => Math.round(((price * fromRate) / toRate) * 100) / 100;

/**
 * Switches a Draft order to `currency` (EUR or the project currency), converting its line prices at the budget rate. Refused
 * for an order that is no longer a draft (guarded UPDATE), an unknown currency, or a project currency without a rate. Writes an
 * audit row and an activity event. Returns false when the order was already in that currency.
 */
export async function setPurchaseOrderCurrency(number: string, currency: string, actorName: string): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ o: purchaseOrders, pCurrency: projects.currency, pRate: projects.budgetRate })
      .from(purchaseOrders)
      .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(eq(purchaseOrders.number, number))
      .for('update'); // the order and its project row: serialised with setProjectBudgetRate
    if (!row) throw new Error('Unknown purchase order');
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
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    await writeAudit(tx, {
      actorName: who, actorPersonId: actor?.id, objectRef: number, change: `currency: ${from} → ${to} · line prices converted at the budget rate`,
      area: 'Orders', entityType: 'purchase_order', entityId: row.o.id, projectId: row.o.projectId,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, text: `${number} now in ${to}`, kind: 'change', projectId: row.o.projectId });
    return true;
  });
}
