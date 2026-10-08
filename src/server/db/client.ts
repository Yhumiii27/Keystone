import 'server-only';
import path from 'node:path';
import { openDatabase } from './open';
import type { DB } from './types';

// Local database: embedded Postgres (PGlite) in <data dir>/pg, created on first use, migrated from ./drizzle and
// seeded from the prototype data set. The data dir is ./.data, or KEYSTONE_DATA_DIR when set (the Mac app keeps its
// own copy in ~/Library/Application Support/Keystone). Production targets Postgres (swap the driver to
// drizzle-orm/node-postgres; schema and queries stay the same).
export type { DB, Tx } from './types';

const DATA_DIR = process.env.KEYSTONE_DATA_DIR ? path.resolve(process.env.KEYSTONE_DATA_DIR) : path.join(process.cwd(), '.data');
const g = globalThis as unknown as { __ksDb?: Promise<DB> };

/** Database handle (singleton per server process; survives dev hot reloads). */
export function getDb(): Promise<DB> {
  if (!g.__ksDb) g.__ksDb = openDatabase(path.join(DATA_DIR, 'pg')).catch((e) => { g.__ksDb = undefined; throw e; });
  return g.__ksDb;
}

/** Points getDb() at another database (scripts and tests, e.g. a temporary PGlite from openDatabase()). */
export function setDb(db: DB | Promise<DB>): void {
  g.__ksDb = Promise.resolve(db);
}
