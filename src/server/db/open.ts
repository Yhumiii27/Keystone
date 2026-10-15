import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { SeedMode } from '@/server/config/parse';
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
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const pglite = drizzle(client, { schema });
  const db: DB = withSerializableTransactions<DB>(pglite);
  const applied = (await pendingMigrations(db, migrationsFolder)).length;
  if (applied) await migrate(pglite, { migrationsFolder });
  const seeded = await seedIfEmpty(db, { mode: opts.seed });
  return { db, applied, seeded };
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
