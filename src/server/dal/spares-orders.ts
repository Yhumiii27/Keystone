import 'server-only';
// Spares purchase orders (chapter 4; Project BOM › PU/PR list › "Create spares purchase order", E-3): the candidate lines
// of the list as displayed, with their preferred supplier, stock and what is still to receive on open spares orders, and
// the writer drafting one purchase order per supplier (origin 'spares', Keystone purchasing). Rules: src/domain/spares-order.ts.
// Permission checks and revalidation belong to the calling Server Function.
import { eq, inArray } from 'drizzle-orm';
import { filterSpares } from '@/domain/bom';
import { groupBySupplier, type SpareOrderCandidate, type ValidSparesOrderLine } from '@/domain/spares-order';
import { getDb } from '@/server/db/client';
import type { WearSpare } from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import { parts, suppliers } from '@/server/db/schema';
import { getSpareList } from './bom';
import { getPartsByRef } from './parts';
import { insertOrder, listPurchaseOrders } from './purchasing';

export interface SparesOrderScope {
  /** System actually listed (the complete system for an unknown / stale reference). */
  system: string;
  /** EN data text. */
  systemName: string;
  candidates: SpareOrderCandidate[];
}

/** Units still to receive on the project's open spares orders, per part reference. */
export async function spareUnitsOnOrder(projectCode: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const o of await listPurchaseOrders(projectCode)) {
    if (o.origin !== 'spares' || o.status === 'cancelled' || o.status === 'received') continue;
    for (const l of o.lines) out[l.ref] = (out[l.ref] ?? 0) + Math.max(0, l.orderedQty - l.receivedQty);
  }
  return out;
}

/** The PU/PR list of a system (null = complete system) filtered like the screen (`kind`), as order candidates; null without a list. */
export async function getSparesOrderScope(projectCode: string, system: string | null, kind: WearSpare | null): Promise<SparesOrderScope | null> {
  const sl = await getSpareList(projectCode, system);
  if (!sl) return null;
  const rows = filterSpares(sl.rows, kind);
  const [info, onOrder] = await Promise.all([getPartsByRef(rows.map((r) => r.ref)), spareUnitsOnOrder(projectCode)]);
  const byRef = new Map(info.map((p) => [p.ref, p]));
  return {
    system: sl.system,
    systemName: sl.systemName,
    candidates: rows.map((r) => {
      const p = byRef.get(r.ref);
      // An in-house manufacturer is not ordered through a purchase order.
      const supplier = p?.manufacturer && !p.manufacturerIsInternal ? p.manufacturer : null;
      return {
        ref: r.ref, name: r.name, kind: r.kind, supplier, recommendedQty: r.recommendedQty, inStock: r.inStock, onOrder: onOrder[r.ref] ?? 0,
        unitPriceEur: r.lastPriceEur, leadWeeks: r.leadWeeks, status: r.status, underChange: r.underChange,
      };
    }),
  };
}

/**
 * Drafts one purchase order per preferred supplier from validated lines (origin 'spares', dated the status date, expected
 * "To confirm", at the given unit prices). Audited per order, one activity event. Returns the numbers in supplier order.
 */
export async function createSparesPurchaseOrders(projectCode: string, lines: readonly ValidSparesOrderLine[], actorName: string, systemName?: string): Promise<string[]> {
  if (!lines.length) return [];
  const db = await getDb();
  return db.transaction(async (tx) => {
    const p = await requireProject(tx, projectCode);
    const actor = await findPerson(tx, actorName);
    const who = actor ? nameOf(actor) : actorName;
    const partIds = new Map((await tx.select({ id: parts.id, ref: parts.ref }).from(parts).where(inArray(parts.ref, lines.map((l) => l.ref)))).map((x) => [x.ref, x.id]));
    const numbers: string[] = [];
    for (const g of groupBySupplier(lines)) {
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, g.supplier));
      if (!s) throw new Error(`Unknown supplier ${g.supplier}`);
      const number = await insertOrder(tx, {
        projectId: p.id, supplierId: s.id, origin: 'spares', createdBy: actor?.id ?? null,
        lines: g.lines.map((l) => {
          const partId = partIds.get(l.ref);
          if (!partId) throw new Error(`Unknown part ${l.ref}`);
          return { partId, qty: l.qty, unitPriceEur: l.unitPriceEur };
        }),
      });
      numbers.push(number);
      await writeAudit(tx, {
        actorName: who, actorPersonId: actor?.id, objectRef: number, area: 'Purchase orders', entityType: 'purchase_order', projectId: p.id,
        change: `draft created from the PU/PR list${systemName ? ` (${systemName})` : ''} · ${g.supplier} · ${g.lines.map((l) => `${l.ref} × ${l.qty}`).join(', ')}`,
      });
    }
    await recordActivity(tx, { actorName: who, actorPersonId: actor?.id, kind: 'change', projectId: p.id, text: `Drafted spares purchase orders · ${numbers.join(', ')}` });
    return numbers;
  });
}
