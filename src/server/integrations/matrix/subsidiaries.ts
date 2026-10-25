import 'server-only';
// The subsidiaries connector (Matrix D21): reads Matrix's view matrix.pub_filiales into Keystone's read-only mirror
// (./subsidiaries-mirror.ts). Run by the job `matrix-subsidiaries` (hourly — the list changes rarely), by "Refresh the list" on
// the Contract screen's "Client" card (the director) and by the demo seed. Never writes anything in Matrix.
// Sources (MATRIX_SOURCE, src/server/config):
//   server      `select to_jsonb(v) from matrix.pub_filiales v` on the shared PostgreSQL server, through Keystone's own connection
//               (role keystone_app, SELECT granted by Matrix, partage/90-droits.sql). A failure (view missing, grant missing,
//               server down) keeps the mirror and is logged as a warning (the job's run too).
//   simulation  the demo subsidiaries (./simulation.ts), applied to a DEMO database only — a production database never receives it.
//   off         nothing is read.
import { sql } from 'drizzle-orm';
import { subsidiarySnapshot } from '@/domain/subsidiaries';
import { getConfig } from '@/server/config';
import type { MatrixSource } from '@/server/config/parse';
import { getDb } from '@/server/db/client';
import { databaseSeedMode } from '@/server/db/seed/mode';
import type { DB } from '@/server/db/types';
import { log } from '@/server/log';
import { simulatedMatrixSubsidiaries } from './simulation';
import { applySubsidiarySnapshot } from './subsidiaries-mirror';

type Row = Record<string, unknown>;

/** The view read on the shared server (schema `matrix`: Matrix's referentials, D21). */
export const MATRIX_SUBSIDIARIES_VIEW = 'matrix.pub_filiales';

export const matrixSource = (): MatrixSource => getConfig().matrix.source;

/** Reads matrix.pub_filiales on the server (each row as `to_jsonb`, so a new column at the end of the view never breaks the read). */
export async function readMatrixSubsidiaries(db: DB): Promise<Row[]> {
  return ((await db.execute(sql.raw(`select to_jsonb(v) as r from ${MATRIX_SUBSIDIARIES_VIEW} v`))).rows as { r: Row | string }[])
    .map((x) => (typeof x.r === 'string' ? (JSON.parse(x.r) as Row) : x.r));
}

export type SubsidiaryRefresh =
  | { state: 'off' }
  /** Simulation asked on a database that is not the demo one. */
  | { state: 'refused' }
  | { state: 'done'; source: Exclude<MatrixSource, 'off'>; subsidiaries: number; active: number; skipped: number }
  | { state: 'failed'; source: Exclude<MatrixSource, 'off'>; error: string };

/** "2 subsidiaries · 2 active" (· "1 row skipped") — the run's EN summary (job log). */
export function subsidiaryRefreshSummary(r: SubsidiaryRefresh): string {
  switch (r.state) {
    case 'off': return 'Matrix subsidiaries connector off';
    case 'refused': return 'Matrix subsidiaries simulation refused on a non-demo database';
    case 'failed': return `Matrix subsidiaries read failed · ${r.error}`;
    default:
      return `${r.subsidiaries} subsidiaries · ${r.active} active${r.skipped ? ` · ${r.skipped} rows skipped` : ''}${r.source === 'simulation' ? ' (simulated)' : ''}`;
  }
}

/**
 * Reads matrix.pub_filiales and replaces the mirror. `opts.source` overrides MATRIX_SOURCE (tests); `opts.db` the database
 * (tests). Never throws: a failure is returned and logged, the mirror kept.
 */
export async function refreshSubsidiaryMirror(opts: { source?: MatrixSource; db?: DB } = {}): Promise<SubsidiaryRefresh> {
  const source = opts.source ?? matrixSource();
  if (source === 'off') return { state: 'off' };
  const db = opts.db ?? (await getDb());
  if (source === 'simulation' && (await databaseSeedMode(db)) !== 'demo') return { state: 'refused' };
  try {
    const raw = source === 'server' ? await readMatrixSubsidiaries(db) : simulatedMatrixSubsidiaries();
    const snap = subsidiarySnapshot(raw);
    const at = new Date();
    await db.transaction(async (tx) => applySubsidiarySnapshot(tx, snap.subsidiaries, at));
    if (snap.skipped) log.warn('Matrix subsidiaries skipped (malformed)', { component: 'matrix', skipped: snap.skipped });
    return { state: 'done', source, subsidiaries: snap.subsidiaries.length, active: snap.subsidiaries.filter((s) => s.active).length, skipped: snap.skipped };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn('Matrix subsidiaries not read', { component: 'matrix', source, error });
    return { state: 'failed', source, error: error.slice(0, 500) };
  }
}
