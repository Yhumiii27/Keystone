import 'server-only';
// PostgreSQL server (R-002): when DATABASE_URL is set, Keystone uses drizzle-orm/node-postgres over a connection pool
// instead of the embedded PGlite. Schema, queries and DAL are the same (src/server/db/types.ts). The application never
// migrates nor seeds a server database: `npm run db:migrate` does both at deploy time under an advisory lock
// (scripts/db-migrate.ts); getDb() refuses to start on a database with pending migrations.
// `pg` is loaded only on this path, so development, tests and the Mac app (PGlite) never need it.
import type { Pool, PoolClient } from 'pg';
import { log } from '@/server/log';
import { MIGRATIONS_FOLDER, MIGRATION_LOCK_KEY, pendingMigrations } from './migrations';
import * as schema from './schema';
import { seedIfEmpty } from './seed';
import { readSeedRecord } from './seed/mode';
import { withSerializableTransactions } from './transactions';
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
  /** Applies the pending migrations of `migrationsFolder` (drizzle's node-postgres migrator). */
  migrate(migrationsFolder: string): Promise<void>;
  /** Closes the pool (scripts). */
  close(): Promise<void>;
}

/** Pool settings: idle connections are closed after 30 s, a connection attempt fails after 10 s. */
export const POOL_TIMEOUTS = { idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 } as const;

/** Opens a pool on a PostgreSQL server and the Drizzle handle over it (SERIALIZABLE transactions with retry, R-010). */
export async function openPostgres(opts: PostgresOptions): Promise<PostgresHandle> {
  const [{ default: pg }, { drizzle }, { migrate }] = await Promise.all([
    import('pg'), import('drizzle-orm/node-postgres'), import('drizzle-orm/node-postgres/migrator'),
  ]);
  const pool = new pg.Pool({
    connectionString: opts.url, max: opts.poolMax, application_name: opts.applicationName ?? 'keystone', ...POOL_TIMEOUTS,
  });
  // An idle connection dropped by the server must not crash the process: the pool replaces it.
  pool.on('error', (err) => log.error('PostgreSQL pool connection error', { component: 'db', err }));
  const raw = drizzle({ client: pool, schema });
  return {
    db: withSerializableTransactions<DB>(raw),
    pool,
    migrate: (migrationsFolder) => migrate(raw, { migrationsFolder }),
    close: () => pool.end(),
  };
}

/** Holds the migration lock on a dedicated connection while `run` executes. */
export async function withMigrationLock<T>(pool: Pool, run: () => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    return await run();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => null);
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
  return withMigrationLock(h.pool, async () => {
    const pending = await pendingMigrations(h.db, migrationsFolder);
    if (pending.length) await h.migrate(migrationsFolder);
    const seeded = await seedServerDatabase(h.db, seed);
    return { applied: pending.length, seeded };
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
