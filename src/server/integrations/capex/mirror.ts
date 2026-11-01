// Read-only mirror of Arche's views (R-187, Arche K-02): capex_mirror ← arche.pub_capex, capex_needs ← arche.pub_besoins_machines.
// Arche publishes each view in full (no deletion feed), so a successful read REPLACES the mirror in one transaction: a CAPEX or a
// need that left the view (back to draft in Arche) leaves the mirror. Keystone's answers (need_answers) refer to a need by its
// reference, without foreign key: they stay when the need leaves. Each row is checked (src/domain/capex-needs.ts parseCapexRow /
// parseNeedRow); a malformed row is skipped and counted, never stored. Every read — successful or not — is one capex_sync_runs row.
import { sql } from 'drizzle-orm';
import { parseCapexRow, parseNeedRow, type CapexRecord, type NeedRecord } from '@/domain/capex-needs';
import { capexMirror, capexNeeds, capexSyncRuns } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

type Row = Record<string, unknown>;

export interface CapexSnapshot {
  capex: CapexRecord[];
  needs: NeedRecord[];
  /** Rows left out because they were malformed (both views). */
  skipped: number;
}

/** The checked rows of a read of both views. A need whose CAPEX is not in the read is kept (its CAPEX sheet stays unknown). */
export function snapshotOf(raw: { capex: readonly Row[]; needs: readonly Row[] }): CapexSnapshot {
  const capex = raw.capex.map(parseCapexRow);
  const needs = raw.needs.map(parseNeedRow);
  const byCode = new Map<string, CapexRecord>();
  for (const c of capex) if (c) byCode.set(c.code, c);
  const byRef = new Map<string, NeedRecord>();
  for (const n of needs) if (n) byRef.set(n.needRef, n);
  // Duplicated keys count as skipped (the last row read wins).
  return { capex: [...byCode.values()], needs: [...byRef.values()], skipped: raw.capex.length + raw.needs.length - byCode.size - byRef.size };
}

const instant = (iso: string | null) => (iso ? new Date(iso) : null);

/** Replaces the mirror by the snapshot (in the caller's transaction). */
export async function applyCapexSnapshot(tx: Tx, snap: CapexSnapshot, at: Date): Promise<void> {
  await tx.delete(capexNeeds);
  await tx.delete(capexMirror);
  if (snap.capex.length)
    await tx.insert(capexMirror).values(snap.capex.map((c) => ({
      code: c.code, subsidiaryCode: c.subsidiaryCode, subsidiaryName: c.subsidiaryName, zone: c.zone, site: c.site, countryIso2: c.countryIso2, title: c.title,
      investmentType: c.investmentType, status: c.status, phaseCode: c.phaseCode, typology: c.typology, sponsorName: c.sponsorName, leadName: c.leadName,
      g1On: c.g1On, g2On: c.g2On, g3On: c.g3On, commissioningOn: c.commissioningOn, sourceUpdatedAt: instant(c.sourceUpdatedAt), syncedAt: at,
    })));
  if (snap.needs.length)
    await tx.insert(capexNeeds).values(snap.needs.map((n) => ({
      needRef: n.needRef, capexCode: n.capexCode, line: n.line, catalogueCode: n.catalogueCode, catalogueVersion: n.catalogueVersion, freeLabel: n.freeLabel,
      quantity: n.quantity, options: n.options, targetCapacity: n.targetCapacity, capacityUnit: n.capacityUnit, neededOn: n.neededOn, site: n.site, status: n.status,
      comment: n.comment, submittedAt: instant(n.submittedAt), orderedOn: n.orderedOn, sourceUpdatedAt: instant(n.sourceUpdatedAt), syncedAt: at,
    })));
}

export type CapexSyncTrigger = 'job' | 'refresh' | 'sync' | 'seed';

/** Records one read of the source (the connector's state on Activity & integrations and on the card). */
export async function recordCapexRun(
  q: DB | Tx, run: { source: 'server' | 'simulation'; trigger: CapexSyncTrigger; ok: boolean; capexCount?: number; needCount?: number; skipped?: number; error?: string | null; at: Date },
): Promise<void> {
  await q.insert(capexSyncRuns).values({
    source: run.source, trigger: run.trigger, ok: run.ok, capexCount: run.capexCount ?? 0, needCount: run.needCount ?? 0, skipped: run.skipped ?? 0,
    error: run.error ? run.error.slice(0, 500) : null, syncedAt: run.at,
  });
}

/** The last read (any outcome) and the last successful one. */
export async function lastCapexRuns(q: DB | Tx): Promise<{ last: typeof capexSyncRuns.$inferSelect | null; lastOk: typeof capexSyncRuns.$inferSelect | null }> {
  const [last] = await q.select().from(capexSyncRuns).orderBy(sql`${capexSyncRuns.syncedAt} desc`).limit(1);
  const [lastOk] = await q.select().from(capexSyncRuns).where(sql`${capexSyncRuns.ok}`).orderBy(sql`${capexSyncRuns.syncedAt} desc`).limit(1);
  return { last: last ?? null, lastOk: lastOk ?? null };
}
