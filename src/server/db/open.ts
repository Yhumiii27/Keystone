import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { SeedMode } from '@/server/config/parse';
import { declareKeystoneSchema } from '@/server/integrations/matrix';
import { MIGRATIONS_FOLDER, pendingMigrations } from './migrations';
import * as schema from './schema';
import { seedIfEmpty } from './seed';
import { withSerializableTransactions } from './transactions';
import type { DB } from './types';

export interface OpenDatabaseOptions {
  /** Seed of a new (empty) database: the prototype data set (default) or reference data only (R-011). */
  seed?: SeedMode;
}

export interface OpenedDatabase {
  db: DB;
  /** Migrations applied by this open. */
  applied: number;
  /** True when this open seeded an empty database. */
  seeded: boolean;
}

/**
 * Opens (creating if needed) a PGlite database in `dataDir` — in memory when omitted — applies the migrations of ./drizzle
 * and seeds it when it is empty (demo data set unless `opts.seed` is 'production'). PGlite is the embedded single-process
 * database of development, tests and the Mac app; a PostgreSQL server is opened by ./postgres.ts instead (R-002).
 */
export async function openPglite(dataDir?: string, migrationsFolder = MIGRATIONS_FOLDER(), opts: OpenDatabaseOptions = {}): Promise<OpenedDatabase> {
  if (dataDir) {
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    assertWritable(dataDir);
  }
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const pglite = drizzle(client, { schema });
  const db: DB = withSerializableTransactions<DB>(pglite);
  const applied = (await pendingMigrations(db, migrationsFolder)).length;
  if (applied) await migrate(pglite, { migrationsFolder });
  // Declares the migrated schema to Matrix in the background (never awaited, never fails the open). Only for a persistent
  // database or when MATRIX_URL is set: the tests' in-memory databases (no MATRIX_URL) send and read nothing.
  declareKeystoneSchema((sql) => client.query<Record<string, unknown>>(sql).then((r) => r.rows), { persistent: !!dataDir });
  const seeded = await seedIfEmpty(db, { mode: opts.seed });
  return { db, applied, seeded };
}

/**
 * An existing PGlite folder this process cannot write (a volume written by an image that ran as root, a host folder) makes
 * PGlite fail with a bare "PGlite failed to initialize properly": name the folder and the fix instead.
 */
function assertWritable(dataDir: string): void {
  for (const target of [dataDir, path.join(dataDir, 'PG_VERSION')]) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.accessSync(target, fs.constants.W_OK);
    } catch {
      const uid = typeof process.getuid === 'function' ? process.getuid() : '?';
      throw new Error(`The PGlite data folder ${dataDir} is not writable by this process (uid ${uid}): give the folder and its files to this user (chown -R), or start the container as root so its entrypoint does it`);
    }
  }
}

/** openPglite() returning the handle only (the app, tests and scripts). */
export async function openDatabase(dataDir?: string, migrationsFolder = MIGRATIONS_FOLDER(), opts: OpenDatabaseOptions = {}): Promise<DB> {
  return (await openPglite(dataDir, migrationsFolder, opts)).db;
}

/** Closes the PGlite behind a handle from openDatabase() (scripts: the data directory is left consistent). */
export async function closeDatabase(db: DB): Promise<void> {
  const client = (db as DB & { $client?: { close?: () => Promise<void> } }).$client;
  if (client?.close) await client.close();
}
