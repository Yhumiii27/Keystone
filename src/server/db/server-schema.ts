// Keystone on a PostgreSQL server (R-002) — the shared EPC2I server (decision M-01 in Matrix: one database `epc2i`, one
// schema per tool, Keystone connects as `keystone_app`, owner of the schema `keystone` and of nothing else). Owner's decisions
// of 18 Oct 2026:
// - the published migrations (drizzle/*.sql) and the schema files (`pgTable`) stay as they are. drizzle-kit writes
//   `REFERENCES "public"."…"`: on the server, the migrator replaces that exact quoted prefix `"public".` with `"keystone".`
//   in every statement (serverStatement), and every connection sets `search_path=keystone`, so unqualified names and
//   Drizzle's queries resolve in `keystone`;
// - the journal is `keystone.__drizzle_migrations` (same table as Drizzle's), written under the advisory lock
//   `pg_advisory_lock(hashtext('keystone.migrations'))` taken before the journal is created or read;
// - the server never runs CREATE SCHEMA (keystone_app may not: the base layer creates the schema);
// - PGlite (development, tests, the Mac app) is unchanged: tables in `public`, Drizzle's journal in `drizzle`.
// No `server-only`: scripts and tests load it under plain Node.

/** Schema of Keystone's tables and migration journal on a PostgreSQL server. */
export const SERVER_SCHEMA = 'keystone';

/** Schema of the migration journal (`__drizzle_migrations`) on PGlite: Drizzle's default. */
export const PGLITE_JOURNAL_SCHEMA = 'drizzle';

/** Connection parameter of every server connection (pool, backup, restore): unqualified names resolve in `keystone`. */
export const SERVER_CONNECTION_OPTIONS = `-c search_path=${SERVER_SCHEMA}`;

/** Key text of the session advisory lock held while migrating and seeding the server (hashtext() of it, per tool schema). */
export const MIGRATION_LOCK_NAME = `${SERVER_SCHEMA}.migrations`;

/** Key text of the transaction advisory lock every server transaction takes first (writes one at a time, plan § 4.5). */
export const WRITE_LOCK_NAME = `${SERVER_SCHEMA}.ecritures`;

const PUBLIC_PREFIX = '"public".';
const SERVER_PREFIX = `"${SERVER_SCHEMA}".`;

/** A migration statement as the server runs it: every `"public".` becomes `"keystone".` (only that exact pattern). */
export function serverStatement(statement: string): string {
  return statement.split(PUBLIC_PREFIX).join(SERVER_PREFIX);
}

const JOURNAL_SCHEMA = Symbol.for('keystone.migrationJournalSchema');

/** Marks a Drizzle handle as opened on a PostgreSQL server: its migration journal is `keystone.__drizzle_migrations`. */
export function markServerDatabase<D extends object>(db: D): D {
  Object.defineProperty(db, JOURNAL_SCHEMA, { value: SERVER_SCHEMA, configurable: true });
  return db;
}

/** Schema of the migration journal of a handle: `keystone` on a server (markServerDatabase), `drizzle` on PGlite. */
export function journalSchemaOf(db: object): string {
  return (db as { [JOURNAL_SCHEMA]?: string })[JOURNAL_SCHEMA] ?? PGLITE_JOURNAL_SCHEMA;
}
