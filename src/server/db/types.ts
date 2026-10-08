import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type * as schema from './schema';

/** Typed Drizzle handle over the Keystone schema. */
export type DB = PgliteDatabase<typeof schema>;

/** Transaction handle (same query API as DB). */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
