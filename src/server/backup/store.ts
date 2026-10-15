import 'server-only';
// The backup folder (R-004, KEYSTONE_BACKUP_DIR):
//   <dir>/<UTC stamp>/              one snapshot: database.tar.gz (PGlite) or database.dump (pg_dump custom format) and
//                                   manifest.json — written as <stamp>.partial and renamed once complete
//   <dir>/content/<aa>/<sha256>     the stored files, content-addressed and shared by every snapshot (a file is copied once)
//   <dir>/backup.lock               held while a snapshot, the retention or a garbage collection runs (one writer at a time,
//                                   also across hosts sharing the folder); a lock older than the job's lease is taken over
// Pure rules (due, retention, garbage collection): src/domain/backup.ts.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { blobsToCollect, backupsToPrune, parseSnapshotStamp, BACKUP_DEFAULTS, type BackupRetention, type SnapshotRef } from '@/domain/backup';
import type { SeedMode } from '@/server/config/parse';

export const MANIFEST_FORMAT = 'keystone-backup/1';

export type BackupFileStatus = 'stored' | 'missing' | 'mismatch';

export interface ManifestFile {
  /** stored_files.id */
  id: string;
  /** stored_files.storage_path (relative to the files folder). */
  path: string;
  sha256: string;
  size: number;
  /** stored: in the content store; missing: deleted (or absent) on disk when the files were copied; mismatch: content differs from its recorded hash. */
  status: BackupFileStatus;
}

export interface SnapshotManifest {
  format: typeof MANIFEST_FORMAT;
  name: string;
  /** Keystone version (package.json) of the process that wrote the snapshot. */
  keystoneVersion: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  driver: 'pglite' | 'postgres';
  database: { file: string; bytes: number; sha256: string };
  /** Migrations recorded in the database (drizzle.__drizzle_migrations) and the newest one's creation time. */
  migrations: { applied: number; last: number | null };
  /** Data set the database was created with (app_settings keystone.seed). */
  seed: SeedMode | null;
  /** Row count of every table at the snapshot (the restore compares them). */
  counts: Record<string, number>;
  files: ManifestFile[];
  filesSummary: { stored: number; copied: number; missing: number; mismatch: number };
}

export const contentDir = (dir: string) => path.join(/*turbopackIgnore: true*/ dir, 'content');
export const blobPath = (dir: string, sha256: string) => path.join(/*turbopackIgnore: true*/ contentDir(dir), sha256.slice(0, 2), sha256);

/** Complete snapshots of the folder, oldest first (a folder without a readable manifest is not one). */
export async function listSnapshots(dir: string): Promise<(SnapshotRef & { path: string })[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: (SnapshotRef & { path: string })[] = [];
  for (const name of names) {
    const at = parseSnapshotStamp(name);
    if (!at) continue;
    const p = path.join(/*turbopackIgnore: true*/ dir, name);
    if (await fs.access(path.join(/*turbopackIgnore: true*/ p, 'manifest.json')).then(() => true, () => false)) out.push({ name, at, path: p });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function readManifest(snapshotPath: string): Promise<SnapshotManifest> {
  const m = JSON.parse(await fs.readFile(path.join(/*turbopackIgnore: true*/ snapshotPath, 'manifest.json'), 'utf8')) as SnapshotManifest;
  if (m.format !== MANIFEST_FORMAT || !Array.isArray(m.files) || !m.database?.file) throw new Error(`${snapshotPath} is not a Keystone snapshot`);
  return m;
}

// ── Lock ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export class BackupBusyError extends Error {
  constructor(holder: string) {
    super(`A backup is already running (${holder})`);
    this.name = 'BackupBusyError';
  }
}

/** Takes the folder's lock (see the header); returns its release. A lock older than `staleMs` (a crash) is taken over. */
export async function lockBackupFolder(dir: string, staleMs = 3 * 3_600_000): Promise<() => Promise<void>> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(/*turbopackIgnore: true*/ dir, 'backup.lock');
  const me = `${os.hostname()}:${process.pid}:${Date.now()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(file, me, { flag: 'wx' });
      return async () => {
        const cur = await fs.readFile(file, 'utf8').catch(() => '');
        if (cur === me) await fs.rm(file, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const st = await fs.stat(file).catch(() => null);
      if (st && Date.now() - st.mtimeMs < staleMs) throw new BackupBusyError((await fs.readFile(file, 'utf8').catch(() => '?')).split(':').slice(0, 2).join(':'));
      await fs.rm(file, { force: true });
    }
  }
  throw new BackupBusyError('lock not taken');
}

// ── Retention and garbage collection ───────────────────────────────────────────────────────────────────────────────────
export interface RetentionOutcome {
  /** Snapshots removed by the retention. */
  snapshots: number;
  /** Half-written snapshot folders removed (a crash). */
  partials: number;
  /** Content-store blobs no kept snapshot references any more. */
  blobs: number;
}

/** Applies the retention, removes stale partial folders, then collects the blobs no kept manifest references. Hold the lock. */
export async function applyRetention(dir: string, retention: BackupRetention, now = new Date()): Promise<RetentionOutcome> {
  const out: RetentionOutcome = { snapshots: 0, partials: 0, blobs: 0 };
  const snaps = await listSnapshots(dir);
  for (const s of backupsToPrune(snaps, now, retention)) {
    await fs.rm(s.path, { recursive: true, force: true });
    out.snapshots++;
  }
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const m = /^(.+)\.partial$/.exec(name);
    const at = m ? parseSnapshotStamp(m[1]) : null;
    if (at && now.getTime() - at.getTime() > BACKUP_DEFAULTS.partialMaxAgeMin * 60_000) {
      await fs.rm(path.join(/*turbopackIgnore: true*/ dir, name), { recursive: true, force: true });
      out.partials++;
    }
  }
  // Garbage collection: by reference from the manifests that remain. A manifest that cannot be read keeps everything.
  const kept = await listSnapshots(dir);
  const manifests: SnapshotManifest[] = [];
  for (const s of kept) {
    try {
      manifests.push(await readManifest(s.path));
    } catch {
      return out;
    }
  }
  const blobs = new Map<string, string>();
  for (const sub of await fs.readdir(contentDir(dir)).catch(() => [] as string[]))
    for (const name of await fs.readdir(path.join(/*turbopackIgnore: true*/ contentDir(dir), sub)).catch(() => [] as string[])) {
      const p = path.join(/*turbopackIgnore: true*/ contentDir(dir), sub, name);
      if (/^[0-9a-f]{64}$/.test(name)) blobs.set(name, p);
      // A copy cut short by a crash.
      else if (name.endsWith('.part') && now.getTime() - ((await fs.stat(p).catch(() => null))?.mtimeMs ?? now.getTime()) > BACKUP_DEFAULTS.partialMaxAgeMin * 60_000)
        await fs.rm(p, { force: true });
    }
  for (const sha of blobsToCollect(blobs.keys(), manifests)) {
    await fs.rm(blobs.get(sha)!, { force: true });
    out.blobs++;
  }
  return out;
}
