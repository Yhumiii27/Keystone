import 'server-only';
import { getConfig, type SeedMode } from '@/server/config';
import { declareKeystoneSchema } from '@/server/integrations/matrix';
import { log } from '@/server/log';
import { PendingMigrationsError, pendingMigrations } from './migrations';
import { openDatabase } from './open';
import { databaseSeedMode } from './seed/mode';
import type { DB } from './types';

// Database of this server process (R-002), chosen by the configuration (src/server/config):
// - DATABASE_URL set → PostgreSQL server through a node-postgres pool (src/server/db/postgres.ts). Migrations and the seed
//   run at deploy time (`npm run db:migrate`); a database with pending migrations is refused.
// - otherwise → embedded PGlite in <data dir>/pg, created on first use, migrated from ./drizzle and seeded (KEYSTONE_SEED:
//   demo data set by default, reference data only with "production"). The data dir is ./.data, or KEYSTONE_DATA_DIR when
//   set (the Mac app keeps its own copy in ~/Library/Application Support/Keystone).
export type { DB, Tx } from './types';

const g = globalThis as unknown as { __ksDb?: Promise<DB> };

async function openConfigured(): Promise<DB> {
  const cfg = getConfig();
  if (cfg.database.driver === 'postgres') {
    const { openPostgres } = await import('./postgres');
    const h = await openPostgres({ url: cfg.database.url, poolMax: cfg.database.poolMax });
    try {
      const pending = await pendingMigrations(h.db);
      if (pending.length) throw new PendingMigrationsError(pending.length);
    } catch (e) {
      await h.close().catch(() => null);
      throw e;
    }
    log.info('Database opened', { component: 'db', driver: 'postgres', poolMax: cfg.database.poolMax });
    // The server never migrates PostgreSQL (`npm run db:migrate` does at deploy): its schema, checked up to date above, is
    // declared to Matrix in the background at start-up (an unchanged declaration is ignored by Matrix).
    declareKeystoneSchema((sql) => h.pool.query(sql).then((r) => r.rows as Record<string, unknown>[]), { persistent: true });
    await warnSeedMismatch(h.db, cfg.seedExplicit ? cfg.seed : null);
    return h.db;
  }
  const db = await openDatabase(cfg.database.dir, undefined, { seed: cfg.seed });
  log.info('Database opened', { component: 'db', driver: 'pglite' });
  await warnSeedMismatch(db, cfg.seedExplicit ? cfg.seed : null);
  return db;
}

/** KEYSTONE_SEED only applies to a new database: say so when an existing one was seeded otherwise (R-011). */
async function warnSeedMismatch(db: DB, wanted: SeedMode | null): Promise<void> {
  if (!wanted) return;
  const actual = await databaseSeedMode(db).catch(() => null);
  if (actual && actual !== wanted)
    log.warn(`The database holds the ${actual} data set; KEYSTONE_SEED=${wanted} only applies to a new database`, { component: 'db', seed: actual });
}

/** Database handle (singleton per server process; survives dev hot reloads). A failed open is retried by the next call. */
export function getDb(): Promise<DB> {
  if (!g.__ksDb) g.__ksDb = openConfigured().catch((e) => { g.__ksDb = undefined; throw e; });
  return g.__ksDb;
}

/** Points getDb() at another database (scripts and tests, e.g. a temporary PGlite from openDatabase()). */
export function setDb(db: DB | Promise<DB>): void {
  g.__ksDb = Promise.resolve(db);
}
