import 'server-only';
// `npm run db:migrate` (scripts/db-migrate.ts): applies the migrations of ./drizzle and seeds an empty database (R-002, R-011).
// - DATABASE_URL set → the PostgreSQL server: pending migrations, then the seed of an empty database, under an advisory lock
//   (deploy step, before the new version starts; two deploys never interleave). An empty database needs KEYSTONE_SEED.
// - DATABASE_URL unset → the PGlite database of KEYSTONE_DATA_DIR (default ./.data): migrations and seed (KEYSTONE_SEED,
//   default demo), what the server does when it opens it. Stop the server first: one process owns a PGlite directory.
// The configuration is checked strictly (an invalid variable stops the command, whatever NODE_ENV).
import { assertValidConfig, formatIssues, redactUrl } from '@/server/config';
import { log } from '@/server/log';
import { MIGRATIONS_FOLDER, migrationFiles } from './migrations';
import { closeDatabase, openPglite } from './open';
import { readSeedRecord } from './seed/mode';

export interface MigrateCommandResult {
  driver: 'pglite' | 'postgres';
  applied: number;
  seeded: boolean;
  /** Seed recorded in the database after the run. */
  seed: string | null;
}

export async function runMigrateCommand(migrationsFolder = MIGRATIONS_FOLDER()): Promise<MigrateCommandResult> {
  const { config, warnings } = assertValidConfig({ strict: true });
  for (const w of formatIssues(warnings)) log.warn(w, { component: 'config' });
  const total = migrationFiles(migrationsFolder).length;

  if (config.database.driver === 'postgres') {
    const { migrateAndSeedPostgres, openPostgres } = await import('./postgres');
    log.info('Migrating the PostgreSQL database', { component: 'db', database: redactUrl(config.database.url), migrations: total });
    const h = await openPostgres({ url: config.database.url, poolMax: 2, applicationName: 'keystone-migrate' });
    try {
      const r = await migrateAndSeedPostgres(h, config.seedExplicit ? config.seed : null, migrationsFolder);
      const seed = (await readSeedRecord(h.db))?.mode ?? null;
      log.info('Database ready', { component: 'db', applied: r.applied, seeded: r.seeded, seed });
      return { driver: 'postgres', applied: r.applied, seeded: r.seeded, seed };
    } finally {
      await h.close().catch(() => null);
    }
  }

  log.info('Migrating the PGlite database', { component: 'db', dir: config.database.dir, migrations: total });
  const { db, applied, seeded } = await openPglite(config.database.dir, migrationsFolder, { seed: config.seed });
  try {
    const seed = (await readSeedRecord(db))?.mode ?? null;
    log.info('Database ready', { component: 'db', applied, seeded, seed });
    return { driver: 'pglite', applied, seeded, seed };
  } finally {
    await closeDatabase(db).catch(() => null);
  }
}
