import 'server-only';
// PostgreSQL server (R-002): when DATABASE_URL is set, Keystone uses drizzle-orm/node-postgres over a connection pool
// instead of the embedded PGlite. Schema, queries and DAL are the same (src/server/db/types.ts). The application never
// migrates nor seeds a server database: `npm run db:migrate` does both at deploy time under an advisory lock
// (scripts/db-migrate.ts); getDb() refuses to start on a database with pending migrations.
// Shared EPC2I server (M-01): Keystone's tables and journal live in the schema `keystone` — every connection sets
// search_path=keystone and the migrator rewrites `"public".` (./server-schema.ts, ./migrations.ts applyServerMigrations).
// `pg` is loaded only on this path, so development, tests and the Mac app (PGlite) never need it.
import type { Pool, PoolClient } from 'pg';
import { log } from '@/server/log';
import { MIGRATIONS_FOLDER, applyServerMigrations, type MigrationClient } from './migrations';
import * as schema from './schema';
import { MIGRATION_LOCK_NAME, SERVER_CONNECTION_OPTIONS, WRITE_LOCK_NAME, markServerDatabase } from './server-schema';
import { seedIfEmpty } from './seed';
import { readSeedRecord } from './seed/mode';
import { withWriteLockedTransactions } from './transactions';
import type { DB } from './types';
import type { SeedMode } from '@/server/config/parse';

export interface PostgresOptions {
  url: string;
  /** Largest number of connections of this process (DATABASE_POOL_MAX, default 10). */
  poolMax: number;
  /** Shown in pg_stat_activity. */
  applicationName?: string;
}

export interface PostgresHandle {
  db: DB;
  pool: Pool;
  /** Closes the pool (scripts). */
  close(): Promise<void>;
}

/** Pool settings: idle connections are closed after 30 s, a connection attempt fails after 10 s. */
export const POOL_TIMEOUTS = { idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 } as const;

/** Opens a pool on a PostgreSQL server and the Drizzle handle over it (transactions behind Keystone's write lock, with retry). */
export async function openPostgres(opts: PostgresOptions): Promise<PostgresHandle> {
  const [{ default: pg }, { drizzle }] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres')]);
  const pool = new pg.Pool({
    connectionString: opts.url, max: opts.poolMax, application_name: opts.applicationName ?? 'keystone', options: SERVER_CONNECTION_OPTIONS, ...POOL_TIMEOUTS,
  });
  // An idle connection dropped by the server must not crash the process: the pool replaces it.
  pool.on('error', (err) => log.error('PostgreSQL pool connection error', { component: 'db', err }));
  const raw = drizzle({ client: pool, schema });
  return { db: markServerDatabase(withWriteLockedTransactions<DB>(raw, WRITE_LOCK_NAME)), pool, close: () => pool.end() };
}

/**
 * Holds the migration lock — pg_advisory_lock(hashtext('keystone.migrations')), a key of Keystone's own on the shared database —
 * on a dedicated connection while `run` executes; `run` receives that connection (the server migrator runs on it).
 */
export async function withMigrationLock<T>(pool: Pool, run: (client: MigrationClient) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    return await run(client as unknown as MigrationClient);
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_NAME]).catch(() => null);
    client.release();
  }
}

export interface MigrateResult {
  /** Migrations applied by this run. */
  applied: number;
  /** True when this run seeded an empty database. */
  seeded: boolean;
}

/**
 * `npm run db:migrate` on PostgreSQL: applies the pending migrations, then seeds the database when it is empty (`seed`), all
 * under the migration lock. `seed: null` refuses to seed an empty database (KEYSTONE_SEED must be chosen explicitly, A-15).
 */
export async function migrateAndSeedPostgres(h: PostgresHandle, seed: SeedMode | null, migrationsFolder = MIGRATIONS_FOLDER()): Promise<MigrateResult> {
  return withMigrationLock(h.pool, async (client) => {
    const applied = await applyServerMigrations(client, migrationsFolder);
    const seeded = await seedServerDatabase(h.db, seed);
    return { applied, seeded };
  });
}

/** An empty server database needs an explicit KEYSTONE_SEED (demo or production). */
export class SeedChoiceRequiredError extends Error {
  constructor() {
    super('The database is empty: set KEYSTONE_SEED to "production" (reference data only) or "demo" (prototype data set) to seed it');
    this.name = 'SeedChoiceRequiredError';
  }
}

async function seedServerDatabase(db: DB, seed: SeedMode | null): Promise<boolean> {
  if (!seed && !(await readSeedRecord(db)) && !(await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)).length) throw new SeedChoiceRequiredError();
  // An already seeded database keeps its seed (a demo one still gets its backfills).
  return seedIfEmpty(db, { mode: seed ?? undefined });
}
