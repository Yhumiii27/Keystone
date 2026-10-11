import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

type Schema = typeof schema;

/** The part of a raw query result Keystone reads. */
export interface QueryRows<T> {
  rows: T[];
}

/**
 * Raw query results common to both drivers (R-002): PGlite's `Results` and node-postgres's `QueryResult` both carry `rows`,
 * which is all Keystone reads from `db.execute()`.
 */
export interface KeystoneQueryResultHKT extends PgQueryResultHKT {
  type: QueryRows<this['row']>;
}

/** Typed Drizzle handle over the Keystone schema — PGlite (embedded) or PostgreSQL (node-postgres pool), same query API. */
export type DB = PgDatabase<KeystoneQueryResultHKT, Schema>;

/** Transaction handle (same query API as DB). */
export type Tx = PgTransaction<KeystoneQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
