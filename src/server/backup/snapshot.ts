import 'server-only';
// One backup snapshot (R-004) into KEYSTONE_BACKUP_DIR/<UTC stamp>/ (layout: ./store.ts):
// 1. the database, consistently with the list of its stored files and its row counts:
//    - PostgreSQL: one REPEATABLE READ READ ONLY transaction exports its snapshot; `pg_dump --format=custom --snapshot=…`
//      dumps exactly that state while the same transaction reads stored_files and the row counts (pg_dump must be at least
//      the server's major version and on the PATH of the process — the worker's image ships postgresql-client-16);
//    - PGlite: inside one PGlite transaction (every other query and transaction of the process waits for it), the stored
//      files and the counts are read, a CHECKPOINT is taken and the data folder is dumped as a gzipped tar (`dumpDataDir`). It runs in the web server (KEYSTONE_JOBS=inprocess) and
//      holds the whole tar in memory: fine for the single-container beta, PostgreSQL for production;
// 2. then the files that snapshot lists, copied once into the shared content store (named by sha256). A file deleted
//    between the two steps, and not already in the store, is listed as missing; a file whose content no longer matches its
//    recorded hash is listed as mismatch (never stored under the wrong name);
// 3. manifest.json (time, Keystone version, applied migrations, seed, counts, every file's path, sha256, size and status),
//    then the folder is renamed from <stamp>.partial to <stamp>: a snapshot without a manifest does not exist.
// The caller holds the folder's lock (./store.ts) and applies the retention afterwards.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { snapshotStamp } from '@/domain/backup';
import type { SeedMode } from '@/server/config/parse';
import { MANIFEST_FORMAT, blobPath, type ManifestFile, type SnapshotManifest } from './store';

/** What the snapshot reads the database from. */
export type BackupSource =
  /** A PGlite instance (the server's own in-process database, or one opened by `npm run backup` with the server stopped). */
  | { kind: 'pglite'; client: PgliteLike }
  /** A PostgreSQL server (pg_dump). */
  | { kind: 'postgres'; url: string };

/** The PGlite methods a snapshot uses. */
export interface PgliteLike {
  transaction<T>(fn: (tx: { query<R>(sql: string): Promise<{ rows: R[] }> }) => Promise<T>): Promise<T>;
  dumpDataDir(compression?: 'gzip' | 'none' | 'auto'): Promise<Blob>;
}

type Rows = <T>(sql: string) => Promise<T[]>;

interface DbState {
  files: { id: string; storage_path: string; sha256: string; size_bytes: number }[];
  counts: Record<string, number>;
  migrations: { applied: number; last: number | null };
  seed: SeedMode | null;
}

const qid = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** stored_files, row counts, migrations and seed — read with `rows` inside the snapshot's consistent view. */
async function readState(rows: Rows): Promise<DbState> {
  const files = await rows<DbState['files'][number]>('select id::text as id, storage_path, sha256, size_bytes from stored_files order by storage_path');
  const tables = await rows<{ s: string; t: string }>(
    "select table_schema as s, table_name as t from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('public', 'drizzle') order by 1, 2",
  );
  const counts: Record<string, number> = {};
  for (const { s, t } of tables) counts[`${s}.${t}`] = Number((await rows<{ n: number | string }>(`select count(*) as n from ${qid(s)}.${qid(t)}`))[0]?.n ?? 0);
  let migrations: DbState['migrations'] = { applied: 0, last: null };
  if (tables.some((x) => x.s === 'drizzle' && x.t === '__drizzle_migrations')) {
    const [m] = await rows<{ n: number | string; last: string | null }>('select count(*) as n, max(created_at)::text as last from drizzle.__drizzle_migrations');
    migrations = { applied: Number(m?.n ?? 0), last: m?.last == null ? null : Number(m.last) };
  }
  const [seedRow] = await rows<{ mode: string | null }>("select value->>'mode' as mode from app_settings where key = 'keystone.seed'");
  const seed = seedRow?.mode === 'demo' || seedRow?.mode === 'production' ? seedRow.mode : null;
  return { files, counts, migrations, seed };
}

/** Runs a command; rejects with its stderr when it fails. Never passes secrets on the command line (env only). */
export function runCommand(cmd: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b: Buffer) => (err = (err + b.toString('utf8')).slice(-4000)));
    child.on('error', (e) => reject(new Error(`${cmd} could not be started (${(e as NodeJS.ErrnoException).code ?? e.message}): install the PostgreSQL ${cmd === 'pg_dump' || cmd === 'pg_restore' ? 'client tools' : 'tools'}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (exit ${code}): ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
}

/** A postgres:// URL without its password (for the command line) and the password (for PGPASSWORD). */
export function splitPassword(url: string): { url: string; password: string | null } {
  const u = new URL(url);
  const password = u.password ? decodeURIComponent(u.password) : null;
  u.password = '';
  return { url: u.toString(), password };
}

async function sha256File(file: string): Promise<{ sha256: string; bytes: number }> {
  const data = await fs.readFile(file);
  return { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.byteLength };
}

async function dumpPostgres(url: string, out: string): Promise<DbState> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, application_name: 'keystone-backup' });
  await client.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const { rows } = await client.query<{ s: string }>('select pg_export_snapshot() as s');
    const { url: bare, password } = splitPassword(url);
    const dump = runCommand('pg_dump', ['--format=custom', `--snapshot=${rows[0].s}`, `--file=${out}`, `--dbname=${bare}`], password ? { PGPASSWORD: password } : {});
    // Read in the same snapshot while pg_dump runs (it imports the snapshot at its start; the transaction stays open until it
    // ends). Promise.all also handles pg_dump's failure when the reads fail first.
    const [state] = await Promise.all([readState(async <T,>(q: string) => (await client.query(q)).rows as T[]), dump]);
    await client.query('commit');
    return state;
  } finally {
    await client.end().catch(() => null);
  }
}

async function dumpPglite(client: PgliteLike, out: string): Promise<DbState> {
  // PGlite runs one transaction at a time and its plain queries wait for it: nothing changes the data until the dump ends.
  return client.transaction(async (tx) => {
    const state = await readState(async <T,>(q: string) => (await tx.query<T>(q)).rows);
    await tx.query('checkpoint');
    const tar = await client.dumpDataDir('gzip');
    await fs.writeFile(out, new Uint8Array(await tar.arrayBuffer()), { mode: 0o600 });
    return state;
  });
}

/** Copies a stored file into the content store when it is not there yet. */
async function storeBlob(dir: string, filesRoot: string, f: DbState['files'][number], copied: { n: number }): Promise<ManifestFile['status']> {
  const blob = blobPath(dir, f.sha256);
  if (await fs.access(blob).then(() => true, () => false)) return 'stored';
  const root = path.resolve(/*turbopackIgnore: true*/ filesRoot);
  const src = path.resolve(/*turbopackIgnore: true*/ root, f.storage_path);
  if (!src.startsWith(root + path.sep)) return 'missing';
  let data: Buffer;
  try {
    data = await fs.readFile(src);
  } catch {
    return 'missing';
  }
  if (createHash('sha256').update(data).digest('hex') !== f.sha256) return 'mismatch';
  await fs.mkdir(path.dirname(blob), { recursive: true, mode: 0o700 });
  await fs.writeFile(`${blob}.part`, data, { mode: 0o600 });
  await fs.rename(`${blob}.part`, blob);
  copied.n++;
  return 'stored';
}

/** Keystone's version (package.json of the working directory: no git at run time). */
async function keystoneVersion(): Promise<string> {
  try {
    return (JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface SnapshotOptions {
  /** KEYSTONE_BACKUP_DIR. */
  dir: string;
  source: BackupSource;
  /** The files folder (<data dir>/files). */
  filesRoot: string;
  now?: Date;
}

/** Writes one snapshot (see the header). Returns its name and manifest. */
export async function createSnapshot(opts: SnapshotOptions): Promise<{ name: string; path: string; manifest: SnapshotManifest }> {
  const started = opts.now ?? new Date();
  const t0 = Date.now();
  const name = snapshotStamp(started);
  const final = path.join(/*turbopackIgnore: true*/ opts.dir, name);
  const partial = `${final}.partial`;
  // Owner-only: a snapshot holds the whole database and every stored file.
  await fs.mkdir(partial, { recursive: true, mode: 0o700 });
  try {
    const dbFile = opts.source.kind === 'postgres' ? 'database.dump' : 'database.tar.gz';
    const dbPath = path.join(/*turbopackIgnore: true*/ partial, dbFile);
    const state = opts.source.kind === 'postgres' ? await dumpPostgres(opts.source.url, dbPath) : await dumpPglite(opts.source.client, dbPath);
    const dbHash = await sha256File(dbPath);
    const copied = { n: 0 };
    const files: ManifestFile[] = [];
    for (const f of state.files) files.push({ id: f.id, path: f.storage_path, sha256: f.sha256, size: Number(f.size_bytes), status: await storeBlob(opts.dir, opts.filesRoot, f, copied) });
    const count = (s: ManifestFile['status']) => files.filter((f) => f.status === s).length;
    const manifest: SnapshotManifest = {
      format: MANIFEST_FORMAT, name, keystoneVersion: await keystoneVersion(), startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0, driver: opts.source.kind, database: { file: dbFile, bytes: dbHash.bytes, sha256: dbHash.sha256 }, migrations: state.migrations,
      seed: state.seed, counts: state.counts, files, filesSummary: { stored: count('stored'), copied: copied.n, missing: count('missing'), mismatch: count('mismatch') },
    };
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ partial, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(partial, final);
    return { name, path: final, manifest };
  } catch (e) {
    await fs.rm(partial, { recursive: true, force: true }).catch(() => null);
    throw e;
  }
}
