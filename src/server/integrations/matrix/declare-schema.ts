// Declaration of Keystone's database schema to Matrix (the EPC2i data catalogue, contract matrix.schema/1).
// TypeScript port of Matrix's reference module integration/declarer-schema.mjs (docs/declaration-des-tables.md in Matrix):
// right after the migrations, the real schema (information_schema + pg_constraint, without drizzle's migration table) is
// read and POSTed to {MATRIX_URL}/api/declarations. Matrix adds every new table to its library and flags possible duplicates
// of other applications' tables; an unchanged declaration (same fingerprint) is ignored.
// No screen: Keystone only sends. Never blocking — the call is not awaited and any failure is a warning.
//   MATRIX_URL               Matrix's base URL; unset → nothing is sent (tests, the Mac app without Matrix). Credentials in
//                            the URL (https://user:password@matrix…, HTTP auth of the host) are sent as Basic authentication.
//   MATRIX_TOKEN             shared token, sent in the X-Matrix-Token header
//   MATRIX_DECLARATIONS_DIR  optional: also writes the declaration to <dir>/keystone.json (shared volume, offline machine)
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MATRIX_SCHEMA_CONTRACT = 'matrix.schema/1';

export interface MatrixColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  default: string | null;
}

export interface MatrixForeignKey {
  columns: string[];
  table: string;
  refColumns: string[];
  onDelete: string | null;
  declared: true;
}

export interface MatrixTable {
  name: string;
  columns: MatrixColumn[];
  pk: string[];
  fks: MatrixForeignKey[];
  uniques: string[][];
}

/** The matrix.schema/1 document (field names are Matrix's contract). */
export interface MatrixSchemaDocument {
  schema: typeof MATRIX_SCHEMA_CONTRACT;
  app: string;
  version: string | null;
  declareLe: string;
  empreinte: string;
  tables: MatrixTable[];
}

/** Runs a query and returns its rows (PGlite: `client.query(sql).then(r => r.rows)`, node-postgres: `pool.query`). */
export type RowQuery = (sql: string) => Promise<Record<string, unknown>[]>;

export interface MatrixLogger {
  info?(msg: string): void;
  warn?(msg: string): void;
}

export type MatrixEnv = Record<string, string | undefined>;

const PG_TABLES = `
  select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = current_schema() and t.table_type = 'BASE TABLE'
    and c.table_name not in ('__drizzle_migrations', 'schema_migrations')
  order by c.table_name, c.ordinal_position`;

const PG_CONSTRAINTS = `
  select rel.relname as table_name, con.contype as kind,
    array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as cols,
    ref.relname as ref_table,
    array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as ref_cols,
    con.confdeltype as on_delete
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  left join pg_class ref on ref.oid = con.confrelid
  where n.nspname = current_schema() and con.contype in ('p', 'u', 'f')
  order by rel.relname, con.conname`;

const ON_DELETE: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };

/** A text[] column as an array (drivers return either an array or its '{a,b}' literal). */
const toArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);

const str = (v: unknown): string => String(v ?? '');

/** Reads the current schema of a PostgreSQL or PGlite database. */
export async function introspectPostgres(query: RowQuery): Promise<MatrixTable[]> {
  const tables = new Map<string, MatrixTable>();
  for (const r of await query(PG_TABLES)) {
    const name = str(r.table_name);
    let t = tables.get(name);
    if (!t) tables.set(name, (t = { name, columns: [], pk: [], fks: [], uniques: [] }));
    const dataType = str(r.data_type);
    const udt = str(r.udt_name);
    const type = dataType === 'USER-DEFINED' ? udt : dataType === 'ARRAY' ? `${udt.replace(/^_/, '')}[]` : dataType;
    t.columns.push({
      name: str(r.column_name), type, nullable: r.is_nullable === 'YES', pk: false,
      default: r.column_default == null ? null : str(r.column_default),
    });
  }
  for (const r of await query(PG_CONSTRAINTS)) {
    const t = tables.get(str(r.table_name));
    if (!t) continue;
    const cols = toArray(r.cols);
    if (r.kind === 'p') {
      t.pk = cols;
      if (cols.length === 1) {
        const c = t.columns.find((col) => col.name === cols[0]);
        if (c) c.pk = true;
      }
    } else if (r.kind === 'u') t.uniques.push(cols);
    else t.fks.push({ columns: cols, table: str(r.ref_table), refColumns: toArray(r.ref_cols), onDelete: ON_DELETE[str(r.on_delete)] ?? null, declared: true });
  }
  return [...tables.values()];
}

/** Builds the matrix.schema/1 document. The fingerprint lets Matrix ignore an unchanged declaration. */
export function schemaDocument({ app, version = null, tables, now = new Date() }: {
  app: string; version?: string | null; tables: MatrixTable[]; now?: Date;
}): MatrixSchemaDocument {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const empreinte = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return { schema: MATRIX_SCHEMA_CONTRACT, app, version, declareLe: now.toISOString(), empreinte, tables: sorted };
}

/** True when a declaration has somewhere to go (Matrix's URL or a declarations folder). */
export const matrixDeclarationEnabled = (env: MatrixEnv = process.env): boolean =>
  Boolean(env.MATRIX_URL?.trim() || env.MATRIX_DECLARATIONS_DIR?.trim());

/** Sends the declaration to Matrix and/or writes it to MATRIX_DECLARATIONS_DIR. Never throws. */
export async function declareSchema({ app, version = null, tables, env = process.env, log = console, fetchImpl = fetch }: {
  app: string; version?: string | null; tables: MatrixTable[]; env?: MatrixEnv; log?: MatrixLogger; fetchImpl?: typeof fetch;
}): Promise<MatrixSchemaDocument> {
  const doc = schemaDocument({ app, version, tables });
  try {
    const dir = env.MATRIX_DECLARATIONS_DIR?.trim();
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${app}.json`), JSON.stringify(doc, null, 1));
    }
    const base = env.MATRIX_URL?.trim();
    if (base) {
      // Credentials in MATRIX_URL (HTTP authentication of the host) go as Basic; the token goes in X-Matrix-Token.
      const url = new URL('/api/declarations', base);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const token = env.MATRIX_TOKEN?.trim();
      if (token) headers['x-matrix-token'] = token;
      if (url.username) {
        headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
        url.username = '';
        url.password = '';
      }
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(doc), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Matrix answered ${res.status}: ${await res.text()}`);
      const r = (await res.json()) as { nouvellesTables?: string[] };
      if (r.nouvellesTables?.length) log.info?.(`[matrix] new tables declared: ${r.nouvellesTables.join(', ')}`);
    }
  } catch (e) {
    log.warn?.(`[matrix] schema declaration of ${app} not sent: ${e instanceof Error ? e.message : String(e)}`);
  }
  return doc;
}
