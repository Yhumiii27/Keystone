// Matrix D21: the demo mirror of Matrix's subsidiaries (matrix.pub_filiales) — the simulated read of
// src/server/integrations/matrix/simulation.ts (Atlas Process Maroc APM, Sahel Agro Industries SAI). The production seed has
// none: the subsidiaries come from Matrix (job `matrix-subsidiaries`).
import { sql } from 'drizzle-orm';
import { subsidiarySnapshot } from '@/domain/subsidiaries';
import { simulatedMatrixSubsidiaries } from '@/server/integrations/matrix/simulation';
import { applySubsidiarySnapshot } from '@/server/integrations/matrix/subsidiaries-mirror';
import { matrixSubsidiaries } from '../schema';
import type { DB, Tx } from '../types';

/** The demo mirror (simulated read, dated on the demo morning like the CAPEX mirror). */
export async function seedDemoMatrixSubsidiaries(tx: Tx): Promise<void> {
  await applySubsidiarySnapshot(tx, subsidiarySnapshot(simulatedMatrixSubsidiaries()).subsidiaries, new Date('2026-09-25T06:00:00Z'));
}

/** A demo database seeded before D21: its mirror is empty. Backfilled once (index.ts). */
export async function demoMatrixSubsidiariesToBackfill(db: DB | Tx): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(matrixSubsidiaries);
  return n === 0;
}
