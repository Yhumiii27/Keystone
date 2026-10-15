// Stock seed (docs/spec/11 §8.5): stock positions (STOCK0 3475, 18 lines — reservations' 3-letter project keys resolved
// to projects), the recent movements (MOVES0 3484, 5 rows, "where" parsed into locations / project / activity /
// receipt when it names them) and the last Sage X3 import ("07:15 · 15 lines"). A movement is pending push to X3 when
// it touched a position flagged Local (the others came from X3).
import { PROTO } from '@/server/prototype';
import { X3_LAST_IMPORT } from '@/server/integrations/x3/prototype-snapshot';
import { STATUS_ISO, isoOfDisplayDate, parisInstant, parseStampText, stockMovementType, stockSource } from '../codes';
import { stockMovements, stockPositions, x3SyncRuns } from '../schema';
import type { Tx } from '../types';
import { must, newId, personIdOrNull, projectCodeOfShort, type SeedCtx } from './context';

/** Time of the last X3 stock import (`x3Sync` initial state 3774: "07:15"), from the X3 mock connector. */
export { X3_LAST_IMPORT };

interface ProtoStock { ref: string; loc: string; onHand: number; reserved: number; proj: string; min: number; source: string; last: string }

export async function seedStock(tx: Tx, ctx: SeedCtx): Promise<void> {
  const rows = PROTO.STOCK0 as ProtoStock[];
  const projectOf = (p3: string) => (p3 ? must(ctx.projectByCode, projectCodeOfShort(ctx, p3), 'project') : null);
  await tx.insert(stockPositions).values(rows.map((r, position) => ({
    id: newId(), partId: must(ctx.partByRef, r.ref, 'part'), locationId: must(ctx.locationByName, r.loc, 'storage location'), onHand: r.onHand, reserved: r.reserved,
    reservedForProjectId: projectOf(r.proj), minQty: r.min, source: stockSource.code(r.source), lastMovementOn: isoOfDisplayDate(r.last)!, position,
  })));
  const importedAt = parisInstant(STATUS_ISO, X3_LAST_IMPORT);
  await tx.insert(x3SyncRuns).values({ id: newId(), kind: 'stock_import', occurredAt: importedAt, lineCount: rows.filter((r) => r.source === 'X3').length });

  const local = new Set(rows.filter((r) => r.source === 'Local').map((r) => `${r.ref}|${r.loc}`));
  const loc = (name: string) => ctx.locationByName.get(name.trim()) ?? null;
  await tx.insert(stockMovements).values((PROTO.MOVES0 as [string, string, string, number, string, string][]).map(([when, type, ref, qty, where, who]) => {
    let from: string | null = null;
    let to: string | null = null;
    let projectId: string | null = null;
    let activityId: string | null = null;
    let receiptId: string | null = null;
    const arrow = where.split(' → ');
    if (arrow.length === 2) {
      // "A → B" (transfer), "BL-… → B" (receipt), "A → A1250 Steel erection" (issue).
      if (ctx.receipt.has(arrow[0])) receiptId = ctx.receipt.get(arrow[0])!;
      else from = loc(arrow[0]);
      to = loc(arrow[1]);
      const act = /^(A\d{4})\b/.exec(arrow[1]);
      if (act) {
        for (const [code, acts] of ctx.activity) if (acts.has(act[1]) && !activityId) { activityId = acts.get(act[1])!; projectId = ctx.projectByCode.get(code)!; }
      }
    } else {
      // "Atelier mécanique — Lyon · MSR" (reserve), "QC failed · BL-2026-0533" (scrap).
      const [a, b] = where.split(' · ');
      from = loc(a);
      if (b && ctx.receipt.has(b)) receiptId = ctx.receipt.get(b)!;
      else if (b && /^[A-Z]{3}$/.test(b)) projectId = projectOf(b);
    }
    const locNames = [from, to].filter(Boolean).map((id) => [...ctx.locationByName].find(([, v]) => v === id)![0]);
    const pending = locNames.some((n) => local.has(`${ref}|${n}`));
    return {
      id: newId(), occurredAt: parseStampText(when), type: stockMovementType.code(type), partId: must(ctx.partByRef, ref, 'part'), qty, fromLocationId: from, toLocationId: to,
      projectId, activityId, receiptId, whereText: where, personName: who, personId: personIdOrNull(ctx, who), pushedToX3At: pending ? null : importedAt,
    };
  }));
}
