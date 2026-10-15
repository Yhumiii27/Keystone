import 'server-only';
// Restore of a backup snapshot (R-004, RTO ≤ 4 h) — `npm run restore -- <snapshot> --target <empty database URL | new data
// folder>` (scripts/restore.ts). Never over existing data:
// - the target must be empty: a PostgreSQL database without any table (create it first, with the roles and extensions the
//   managed server needs), or a data folder that does not exist yet / is empty;
// - the database: `pg_restore --no-owner --no-acl --exit-on-error` (PostgreSQL), or a new PGlite folder loaded from the
//   tarball (<folder>/pg). The snapshot's file is checked against its recorded sha256 first;
// - then the files: each one the snapshot stored is copied from the content store to <data folder>/files/<path> after its
//   hash is checked;
// - the check: every stored_files row of the restored database has its file with a matching sha256 (files the snapshot
//   recorded as missing — deleted while it was taken — are reported, not failed), and every table has the row count the
//   snapshot recorded;
// - pending migrations (a snapshot older than this build) are reported with the next step, `npm run db:migrate`, rather
//   than failing; the application refuses a PostgreSQL database with pending migrations until it runs (PGlite migrates on
//   its first open);
// - the elapsed time is reported (the quarterly drill measures the RTO on real volumes).
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pendingMigrations } from '@/server/db/migrations';
import type { DB } from '@/server/db/types';
import { runCommand, splitPassword } from './snapshot';
import { blobPath, readManifest, type SnapshotManifest } from './store';

export type RestoreTarget =
  | { kind: 'pglite'; dataDir: string }
  | { kind: 'postgres'; url: string; dataDir: string };

export interface RestoreReport {
  ok: boolean;
  snapshot: string;
  durationMs: number;
  files: { restored: number; missingAtBackup: number; problems: string[] };
  counts: { checked: number; mismatches: string[] };
  pendingMigrations: number;
  /** EN sentences for the operator. */
  notes: string[];
}

export class RestoreRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreRefusedError';
  }
}

const sha256Of = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw e;
  }
}

interface Opened {
  rows: <T>(q: string) => Promise<T[]>;
  db: DB;
  close: () => Promise<void>;
}

async function openRestoredPglite(dir: string, tarball?: Uint8Array<ArrayBuffer>): Promise<Opened> {
  const [{ PGlite }, { drizzle }, schema] = await Promise.all([import('@electric-sql/pglite'), import('drizzle-orm/pglite'), import('@/server/db/schema')]);
  const client = new PGlite(dir, tarball ? { loadDataDir: new Blob([tarball]) } : undefined);
  await client.waitReady;
  return {
    rows: async <T,>(q: string) => (await client.query<T>(q)).rows,
    db: drizzle(client, { schema }) as unknown as DB,
    close: () => client.close(),
  };
}

async function openRestoredPostgres(url: string): Promise<Opened> {
  const [{ default: pg }, { drizzle }, schema] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres'), import('@/server/db/schema')]);
  const pool = new pg.Pool({ connectionString: url, max: 2, application_name: 'keystone-restore' });
  return {
    rows: async <T,>(q: string) => (await pool.query(q)).rows as T[],
    db: drizzle({ client: pool, schema }) as unknown as DB,
    close: () => pool.end(),
  };
}

/** Throws RestoreRefusedError when the target is not empty. */
async function checkTargetEmpty(target: RestoreTarget): Promise<void> {
  if (!(await isEmptyDir(target.dataDir))) throw new RestoreRefusedError(`The target folder ${target.dataDir} is not empty: restore into a new folder`);
  if (target.kind === 'postgres') {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: target.url, application_name: 'keystone-restore' });
    await client.connect();
    try {
      const { rows } = await client.query<{ n: string }>("select count(*) as n from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')");
      if (Number(rows[0]?.n ?? 0) > 0) throw new RestoreRefusedError('The target database is not empty: restore into a new, empty database');
    } finally {
      await client.end().catch(() => null);
    }
  }
}

export interface RestoreOptions {
  /** The snapshot folder (<backup dir>/<stamp>). */
  snapshotPath: string;
  /** The backup folder holding the content store (default: the snapshot's parent). */
  backupDir?: string;
  target: RestoreTarget;
  /** Progress lines (EN). */
  progress?: (line: string) => void;
}

/** Restores a snapshot into an empty target and checks it (see the header). Throws RestoreRefusedError before writing anything. */
export async function restoreSnapshot(opts: RestoreOptions): Promise<RestoreReport> {
  const t0 = Date.now();
  const say = opts.progress ?? (() => {});
  const backupDir = opts.backupDir ?? path.dirname(opts.snapshotPath);
  let manifest: SnapshotManifest;
  try {
    manifest = await readManifest(opts.snapshotPath);
  } catch (e) {
    throw new RestoreRefusedError(e instanceof Error ? e.message : 'The snapshot cannot be read');
  }
  if ((manifest.driver === 'pglite') !== (opts.target.kind === 'pglite'))
    throw new RestoreRefusedError(`This snapshot is a ${manifest.driver === 'pglite' ? 'PGlite data folder' : 'PostgreSQL dump'}: restore it into ${manifest.driver === 'pglite' ? 'a new data folder' : 'an empty PostgreSQL database'}`);
  const dbFile = path.join(/*turbopackIgnore: true*/ opts.snapshotPath, manifest.database.file);
  const dbBytes = new Uint8Array(await fs.readFile(dbFile));
  if (sha256Of(dbBytes) !== manifest.database.sha256) throw new RestoreRefusedError(`${manifest.database.file} does not match the hash its manifest recorded: the snapshot is damaged`);
  await checkTargetEmpty(opts.target);

  // 1. Database.
  await fs.mkdir(opts.target.dataDir, { recursive: true });
  let opened: Opened;
  if (opts.target.kind === 'pglite') {
    say(`Loading the database into ${path.join(opts.target.dataDir, 'pg')}`);
    opened = await openRestoredPglite(path.join(/*turbopackIgnore: true*/ opts.target.dataDir, 'pg'), dbBytes);
  } else {
    say('Restoring the database with pg_restore');
    const { url, password } = splitPassword(opts.target.url);
    await runCommand('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', `--dbname=${url}`, dbFile], password ? { PGPASSWORD: password } : {});
    opened = await openRestoredPostgres(opts.target.url);
  }

  const report: RestoreReport = {
    ok: true, snapshot: manifest.name, durationMs: 0, files: { restored: 0, missingAtBackup: 0, problems: [] }, counts: { checked: 0, mismatches: [] }, pendingMigrations: 0, notes: [],
  };
  try {
    // 2. Files.
    say(`Restoring ${manifest.filesSummary.stored} files`);
    const filesDir = path.join(/*turbopackIgnore: true*/ opts.target.dataDir, 'files');
    const root = path.resolve(/*turbopackIgnore: true*/ filesDir);
    const inManifest = new Map(manifest.files.map((f) => [f.path, f]));
    for (const f of manifest.files) {
      if (f.status !== 'stored') continue;
      const dest = path.resolve(/*turbopackIgnore: true*/ root, f.path);
      if (!dest.startsWith(root + path.sep)) {
        report.files.problems.push(`${f.path}: path outside the files folder`);
        continue;
      }
      let data: Uint8Array;
      try {
        data = new Uint8Array(await fs.readFile(blobPath(backupDir, f.sha256)));
      } catch {
        report.files.problems.push(`${f.path}: not in the content store`);
        continue;
      }
      if (sha256Of(data) !== f.sha256) {
        report.files.problems.push(`${f.path}: the stored copy is damaged`);
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, data);
      report.files.restored++;
    }

    // 3. Check: every stored_files row has its file with its hash.
    say('Checking the restored files and row counts');
    const rows = await opened.rows<{ storage_path: string; sha256: string }>('select storage_path, sha256 from stored_files');
    for (const r of rows) {
      const at = path.resolve(/*turbopackIgnore: true*/ root, r.storage_path);
      const data = at.startsWith(root + path.sep) ? await fs.readFile(at).catch(() => null) : null;
      if (data && sha256Of(data) === r.sha256) continue;
      const m = inManifest.get(r.storage_path);
      if (!data && m && m.status === 'missing') report.files.missingAtBackup++;
      else report.files.problems.push(`${r.storage_path}: ${data ? 'hash differs from the database' : m?.status === 'mismatch' ? 'its content differed from the database when the snapshot was taken' : 'missing'}`);
    }
    // Row counts.
    for (const [key, expected] of Object.entries(manifest.counts)) {
      const [schema, table] = key.split('.');
      const q = `select count(*) as n from "${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      const n = Number((await opened.rows<{ n: number | string }>(q).catch(() => [{ n: -1 }]))[0]?.n ?? -1);
      report.counts.checked++;
      if (n !== expected) report.counts.mismatches.push(`${key}: ${n < 0 ? 'missing' : n} instead of ${expected}`);
    }
    // Migrations.
    report.pendingMigrations = (await pendingMigrations(opened.db)).length;
  } finally {
    await opened.close().catch(() => null);
  }
  if (report.files.missingAtBackup)
    report.notes.push(`${report.files.missingAtBackup} files were deleted while the snapshot was taken: their records point to nothing (as in production at that moment)`);
  if (report.pendingMigrations)
    report.notes.push(`${report.pendingMigrations} migrations of this Keystone version are not applied: run "npm run db:migrate" with this database before starting Keystone`);
  if (opts.target.kind === 'pglite')
    report.notes.push(`Stop Keystone, then point KEYSTONE_DATA_DIR at ${opts.target.dataDir} (or move its pg and files folders in place of the old ones) and start it again`);
  else report.notes.push(`Set DATABASE_URL to the restored database and KEYSTONE_DATA_DIR to ${opts.target.dataDir} (or move its files folder in place), then start Keystone`);
  report.ok = report.files.problems.length === 0 && report.counts.mismatches.length === 0;
  report.durationMs = Date.now() - t0;
  return report;
}
