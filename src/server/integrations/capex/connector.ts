import 'server-only';
// The capex connector (R-187, Arche K-02): reads Arche's views into Keystone's read-only mirror (./mirror.ts). Run by the job
// `capex-needs` (every 15 minutes, as Arche reads Keystone's views), by "Refresh" on the "Subsidiaries' machine needs" card and by
// "Sync now" on Activity & integrations. Never writes anything in Arche: Keystone's answers go back through its own view
// pub_reponses_besoins.
// Sources (ARCHE_SOURCE, ./config.ts):
//   server      `select to_jsonb(v) from arche.pub_capex v` and `… arche.pub_besoins_machines v` on the shared PostgreSQL server,
//               through Keystone's own connection (role keystone_app, SELECT granted by Matrix). A failure (view missing, grant
//               missing, server down) keeps the mirror and is recorded: the connector row shows a warning.
//   simulation  the demo source (./simulation.ts), applied to a DEMO database only — a production database never receives it.
//   off         nothing is read.
// IT can disable the "Arche" connector (connectors file, R-020): nothing is read either.
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { databaseSeedMode } from '@/server/db/seed/mode';
import type { DB } from '@/server/db/types';
import { connectorEnabled } from '@/server/integrations/connector-enabled';
import { log } from '@/server/log';
import { ARCHE_CONNECTOR_NAME, archeSource, type ArcheSource } from './config';
import { applyCapexSnapshot, recordCapexRun, snapshotOf, type CapexSyncTrigger } from './mirror';
import { simulatedArcheViews } from './simulation';

type Row = Record<string, unknown>;

/** The two views read on the shared server (schema `arche`: Arche's tables and views, M-01). */
export const ARCHE_VIEWS = { capex: 'arche.pub_capex', needs: 'arche.pub_besoins_machines' } as const;

/** Reads both of Arche's views on the server (each row as `to_jsonb`, so a new column at the end of a view never breaks the read). */
export async function readArcheServerViews(db: DB): Promise<{ capex: Row[]; needs: Row[] }> {
  const read = async (view: string) => ((await db.execute(sql.raw(`select to_jsonb(v) as r from ${view} v`))).rows as { r: Row | string }[])
    .map((x) => (typeof x.r === 'string' ? (JSON.parse(x.r) as Row) : x.r));
  return { capex: await read(ARCHE_VIEWS.capex), needs: await read(ARCHE_VIEWS.needs) };
}

export type CapexRefresh =
  | { state: 'off' }
  | { state: 'disabled' }
  /** Simulation asked on a database that is not the demo one. */
  | { state: 'refused' }
  | { state: 'done'; source: Exclude<ArcheSource, 'off'>; capex: number; needs: number; skipped: number }
  | { state: 'failed'; source: Exclude<ArcheSource, 'off'>; error: string };

/** "2 CAPEX · 5 needs" (· "1 row skipped") — the run's EN summary (job log, connector volume). */
export function capexRefreshSummary(r: CapexRefresh): string {
  switch (r.state) {
    case 'off': return 'Arche connector off';
    case 'disabled': return 'Arche connector disabled';
    case 'refused': return 'Arche simulation refused on a non-demo database';
    case 'failed': return `Arche read failed · ${r.error}`;
    default: return `${r.capex} CAPEX · ${r.needs} needs${r.skipped ? ` · ${r.skipped} rows skipped` : ''}${r.source === 'simulation' ? ' (simulated)' : ''}`;
  }
}

/**
 * Reads Arche's views and replaces the mirror. `opts.source` overrides ARCHE_SOURCE (tests); `opts.db` the database (tests, the
 * seed). Never throws: a failure is returned (and recorded).
 */
export async function refreshCapexMirror(trigger: CapexSyncTrigger, opts: { source?: ArcheSource; db?: DB; checkEnabled?: boolean } = {}): Promise<CapexRefresh> {
  const source = opts.source ?? archeSource();
  if (source === 'off') return { state: 'off' };
  if ((opts.checkEnabled ?? true) && !(await connectorEnabled(ARCHE_CONNECTOR_NAME))) return { state: 'disabled' };
  const db = opts.db ?? (await getDb());
  if (source === 'simulation' && (await databaseSeedMode(db)) !== 'demo') return { state: 'refused' };
  const at = new Date();
  try {
    const raw = source === 'server' ? await readArcheServerViews(db) : simulatedArcheViews();
    const snap = snapshotOf(raw);
    await db.transaction(async (tx) => {
      await applyCapexSnapshot(tx, snap, at);
      await recordCapexRun(tx, { source, trigger, ok: true, capexCount: snap.capex.length, needCount: snap.needs.length, skipped: snap.skipped, at });
    });
    if (snap.skipped) log.warn('Arche rows skipped (malformed)', { component: 'capex', skipped: snap.skipped });
    return { state: 'done', source, capex: snap.capex.length, needs: snap.needs.length, skipped: snap.skipped };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn('Arche views not read', { component: 'capex', source, error });
    await recordCapexRun(db, { source, trigger, ok: false, error, at }).catch(() => null);
    return { state: 'failed', source, error };
  }
}
