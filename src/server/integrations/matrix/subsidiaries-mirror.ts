// Read-only mirror of Matrix's view matrix.pub_filiales (Matrix D21): matrix_subsidiaries. Matrix publishes the view in full (no
// deletion feed), so a successful read REPLACES the mirror in one transaction: a subsidiary that left the view leaves the mirror.
// Each row is checked (src/domain/subsidiaries.ts parseSubsidiaryRow); a malformed row is skipped and counted, never stored. A
// client keeps its subsidiary code when that subsidiary leaves the mirror (no foreign key: Matrix's codes).
import { asc } from 'drizzle-orm';
import type { SubsidiaryRecord } from '@/domain/subsidiaries';
import { matrixSubsidiaries } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** Replaces the mirror by the read's subsidiaries (in the caller's transaction). */
export async function applySubsidiarySnapshot(tx: Tx, subsidiaries: readonly SubsidiaryRecord[], at: Date): Promise<void> {
  await tx.delete(matrixSubsidiaries);
  if (subsidiaries.length) await tx.insert(matrixSubsidiaries).values(subsidiaries.map((s) => ({ ...s, syncedAt: at })));
}

/** The mirrored subsidiaries (active or not), code order. */
export async function mirroredSubsidiaries(q: DB | Tx): Promise<SubsidiaryRecord[]> {
  const m = matrixSubsidiaries;
  return q
    .select({ code: m.code, name: m.name, countryIso2: m.countryIso2, zoneCode: m.zoneCode, currency: m.currency, position: m.position, active: m.active })
    .from(m).orderBy(asc(m.code));
}
