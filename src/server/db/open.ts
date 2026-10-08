import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';
import { seedIfEmpty } from './seed';
import type { DB } from './types';

/**
 * Opens (creating if needed) a PGlite database in `dataDir` — in memory when omitted — applies the migrations
 * of ./drizzle and seeds it from the prototype data set when the projects table is empty.
 */
export async function openDatabase(
  dataDir?: string,
  migrationsFolder = path.join(process.cwd(), 'drizzle'),
): Promise<DB> {
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  await seedIfEmpty(db);
  return db;
}
