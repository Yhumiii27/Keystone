import 'server-only';
// The scheduled backup (R-004, job "backup" of src/server/jobs): OFF unless KEYSTONE_BACKUP_DIR is set — the Mac app and a
// development machine never write snapshots by themselves. The job wakes every BACKUP_DEFAULTS.tickMin minutes and takes a
// snapshot when one is due (KEYSTONE_BACKUP_EVERY_MIN, default 10), then applies the retention (KEYSTONE_BACKUP_RETENTION).
// It runs in the worker with PostgreSQL (pg_dump) and inside the web server with PGlite (KEYSTONE_JOBS=inprocess: the
// database is the server's own). Monitoring: the outcome in job_locks and the job's log line; an error line "Backups are
// stale" when the last good snapshot is older than 30 minutes (or twice the interval) — no e-mail (no mail relay, R-036).
// `npm run backup` (scripts/backup.ts) takes a snapshot now through `backupNow`.
import { BACKUP_DEFAULTS, backupDue, backupStale } from '@/domain/backup';
import { getConfig, type KeystoneConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import { log } from '@/server/log';
import { filesRoot } from '@/server/storage/files';
import { createSnapshot, type BackupSource, type PgliteLike } from './snapshot';
import { BackupBusyError, applyRetention, listSnapshots, lockBackupFolder } from './store';

const MIN = 60_000;

export interface BackupOutcome {
  summary: string;
  counts: Record<string, number>;
  warn?: boolean;
}

/** Stale threshold: 30 minutes, or twice the interval when it is longer than 15 minutes. */
const staleAfterMs = (everyMin: number) => Math.max(BACKUP_DEFAULTS.staleAfterMin, 2 * everyMin) * MIN;

/** The server's own database as a backup source. */
async function configuredSource(cfg: KeystoneConfig): Promise<BackupSource> {
  if (cfg.database.driver === 'postgres') return { kind: 'postgres', url: cfg.database.url };
  const db = await getDb();
  const client = (db as unknown as { $client?: PgliteLike }).$client;
  if (!client || typeof client.dumpDataDir !== 'function') throw new Error('The database handle is not a PGlite instance');
  return { kind: 'pglite', client };
}

/** Takes a snapshot now (lock, snapshot, retention). */
export async function backupNow(opts: { dir: string; source: BackupSource; filesRoot: string; retention: KeystoneConfig['backup']['retention']; now?: Date }): Promise<BackupOutcome> {
  const release = await lockBackupFolder(opts.dir);
  try {
    const snap = await createSnapshot({ dir: opts.dir, source: opts.source, filesRoot: opts.filesRoot, now: opts.now });
    const kept = await applyRetention(opts.dir, opts.retention, opts.now ?? new Date());
    const s = snap.manifest.filesSummary;
    const counts = {
      databaseBytes: snap.manifest.database.bytes, files: snap.manifest.files.length, copied: s.copied, missing: s.missing, mismatch: s.mismatch,
      pruned: kept.snapshots, blobsCollected: kept.blobs, durationMs: snap.manifest.durationMs,
    };
    const summary = `snapshot ${snap.name} · ${snap.manifest.files.length} files (${s.copied} copied, ${s.missing} missing, ${s.mismatch} mismatched) · ${kept.snapshots} old snapshots pruned`;
    if (s.mismatch) log.warn('Backup: stored files whose content differs from their record', { component: 'backup', snapshot: snap.name, mismatch: s.mismatch });
    return { summary, counts, warn: s.mismatch > 0 };
  } finally {
    await release();
  }
}

/** One tick of the scheduled job (see the header). Throws when a due snapshot fails (the runner records and logs it). */
export async function runBackupJob(now = new Date()): Promise<BackupOutcome> {
  const cfg = getConfig();
  const { dir, everyMin, retention } = cfg.backup;
  if (!dir) return { summary: 'backups off (KEYSTONE_BACKUP_DIR not set)', counts: {} };
  const last = (await listSnapshots(dir)).at(-1) ?? null;
  const stale = () => {
    if (backupStale(last?.at ?? null, now, staleAfterMs(everyMin)))
      log.error('Backups are stale: the last good snapshot is too old', { component: 'backup', last: last?.name ?? null, staleAfterMin: staleAfterMs(everyMin) / MIN });
  };
  if (!backupDue(last?.at ?? null, now, everyMin * MIN, BACKUP_DEFAULTS.tickMin * MIN)) {
    stale();
    return { summary: `not due · last snapshot ${last?.name}`, counts: {} };
  }
  try {
    return await backupNow({ dir, source: await configuredSource(cfg), filesRoot: filesRoot(), retention, now });
  } catch (e) {
    stale();
    // `npm run backup` (or another host sharing the folder) is writing one: this tick leaves it alone.
    if (e instanceof BackupBusyError) return { summary: `skipped · ${e.message}`, counts: {} };
    throw e;
  }
}
