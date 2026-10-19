// R-004 — backups and restore on PGlite (the PostgreSQL variant is opt-in: KEYSTONE_TEST_DATABASE_URL, needs pg_dump and
// pg_restore ≥ the server's major version): a snapshot of the seeded database and its stored files, the shared content store
// (a file copied once), files deleted or changed meanwhile listed as missing / mismatch, the retention and the garbage
// collection by reference, the folder's lock; the restore into an empty target only, with identical DAL reads and file
// hashes, the row counts, the pending migrations of an older snapshot; the scheduled job (off without a folder, due every
// 10 minutes on a 5-minute tick, skipped while another backup runs, the stale error line) and the command lines.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlanData } from '@/server/dal/plan';
import { getProjectData, listProjects } from '@/server/dal/projects';
import { getRiskRegister } from '@/server/dal/risks';
import { listTasks } from '@/server/dal/tasks';
import { listTaskFiles, attachTaskFile } from '@/server/dal/task-files';
import { listJobLocks } from '@/server/dal/job-locks';
import { getDb, setDb } from '@/server/db/client';
import { MIGRATIONS_FOLDER, migrationFiles } from '@/server/db/migrations';
import { closeDatabase, openDatabase } from '@/server/db/open';
import type { DB } from '@/server/db/types';
import { jobDefinition } from '@/server/jobs/definitions';
import { runJob } from '@/server/jobs/runner';
import { deleteStoredFile, setFilesRoot, storeFile } from '@/server/storage/files';
import { backupDatabaseGuard, parseRestoreArgs, snapshotLocation } from './cli';
import { backupNow, runBackupJob } from './job';
import { RestoreRefusedError, restoreSnapshot } from './restore';
import { createSnapshot, type PgliteLike } from './snapshot';
import { BackupBusyError, applyRetention, blobPath, listSnapshots, lockBackupFolder, readManifest } from './store';

const MIN = 60_000;
const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex');
const actor = { name: 'Marie Lefebvre' };
const RETENTION = { allHours: 48, dailyDays: 30, monthlyMonths: 12 };
let tmp: string;
let db: DB;
const clientOf = (d: DB) => (d as unknown as { $client: PgliteLike }).$client;
const filesRoot = () => path.join(tmp, 'data', 'files');

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-r004-'));
  db = await openDatabase();
  setDb(db);
  setFilesRoot(filesRoot());
}, 60_000);
afterAll(() => {
  setFilesRoot(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setDb(db);
  setFilesRoot(filesRoot());
});
const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
};

/** DAL reads compared before and after a restore. */
async function reads() {
  const projects = await listProjects();
  return {
    projects,
    data: await getProjectData('HLT-026'),
    plan: await getPlanData('HLT-026'),
    risks: await getRiskRegister('HLT-026'),
    tasks: await listTasks(),
    files: await listTaskFiles('T-2314'),
  };
}

describe('snapshot and restore (PGlite)', () => {
  let snapPath = '';

  it('writes the database, then the files into the content store, then the manifest; a second snapshot copies nothing again', async () => {
    const dir = path.join(tmp, 'backups');
    await attachTaskFile('T-2314', { name: 'Torque report.pdf', data: enc('%PDF-1.4 torque') }, 'Marie Lefebvre');
    await storeFile({ purpose: 'attachment', name: 'Plan.pdf', data: enc('%PDF-1.4 plan'), actor });
    const first = await createSnapshot({ dir, source: { kind: 'pglite', client: clientOf(db) }, filesRoot: filesRoot(), now: new Date('2026-10-12T10:00:00Z') });
    snapPath = first.path;
    const m = first.manifest;
    expect(m).toMatchObject({ format: 'keystone-backup/1', name: '20261012T100000000Z', driver: 'pglite', seed: 'demo', keystoneVersion: '0.1.0', database: { file: 'database.tar.gz' } });
    expect(m.migrations.applied).toBe(migrationFiles().length);
    expect(m.counts['public.projects']).toBe((await listProjects()).length);
    expect(m.counts['public.stored_files']).toBe(2);
    expect(m.filesSummary).toEqual({ stored: 2, copied: 2, missing: 0, mismatch: 0 });
    for (const f of m.files) expect(sha(fs.readFileSync(blobPath(dir, f.sha256)))).toBe(f.sha256);
    expect(sha(fs.readFileSync(path.join(first.path, 'database.tar.gz')))).toBe(m.database.sha256);
    expect(fs.existsSync(`${first.path}.partial`)).toBe(false);
    const second = await createSnapshot({ dir, source: { kind: 'pglite', client: clientOf(db) }, filesRoot: filesRoot(), now: new Date('2026-10-12T10:10:00Z') });
    expect(second.manifest.filesSummary).toMatchObject({ stored: 2, copied: 0 });
    expect((await listSnapshots(dir)).map((s) => s.name)).toEqual(['20261012T100000000Z', '20261012T101000000Z']);
  }, 60_000);

  it('restores into a new data folder: identical DAL reads and file hashes, every count checked, nothing pending', async () => {
    const before = await reads();
    const target = path.join(tmp, 'restored-1');
    const lines: string[] = [];
    const report = await restoreSnapshot({ snapshotPath: snapPath, target: { kind: 'pglite', dataDir: target }, progress: (l) => lines.push(l) });
    expect(report).toMatchObject({ ok: true, snapshot: '20261012T100000000Z', files: { restored: 2, missingAtBackup: 0, problems: [] }, counts: { mismatches: [] }, pendingMigrations: 0 });
    expect(report.counts.checked).toBeGreaterThan(100);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.notes.join(' ')).toContain(`point KEYSTONE_DATA_DIR at ${target}`);
    expect(lines[0]).toContain('Loading the database');
    const restored = await openDatabase(path.join(target, 'pg'));
    try {
      setDb(restored);
      setFilesRoot(path.join(target, 'files'));
      expect(await reads()).toEqual(before);
      const manifest = await readManifest(snapPath);
      for (const f of manifest.files) expect(sha(fs.readFileSync(path.join(target, 'files', f.path)))).toBe(f.sha256);
    } finally {
      await closeDatabase(restored);
    }
  }, 60_000);

  it('refuses a non-empty target, the wrong kind of target and a damaged snapshot — before writing anything', async () => {
    const busy = path.join(tmp, 'busy');
    fs.mkdirSync(busy);
    fs.writeFileSync(path.join(busy, 'x'), 'x');
    await expect(restoreSnapshot({ snapshotPath: snapPath, target: { kind: 'pglite', dataDir: busy } })).rejects.toThrow(RestoreRefusedError);
    await expect(restoreSnapshot({ snapshotPath: snapPath, target: { kind: 'postgres', url: 'postgresql://nowhere/x', dataDir: path.join(tmp, 'n') } })).rejects.toThrow(/PGlite data folder/);
    const damaged = path.join(tmp, 'backups-damaged', '20261012T100000000Z');
    fs.mkdirSync(damaged, { recursive: true });
    fs.cpSync(snapPath, damaged, { recursive: true });
    fs.appendFileSync(path.join(damaged, 'database.tar.gz'), 'x');
    await expect(restoreSnapshot({ snapshotPath: damaged, target: { kind: 'pglite', dataDir: path.join(tmp, 'never') } })).rejects.toThrow(/damaged/);
    expect(fs.existsSync(path.join(tmp, 'never'))).toBe(false);
    await expect(restoreSnapshot({ snapshotPath: path.join(tmp, 'nope'), target: { kind: 'pglite', dataDir: path.join(tmp, 'never') } })).rejects.toThrow(RestoreRefusedError);
  }, 60_000);

  it('a file deleted between the database and the file copy is listed missing (tolerated at restore); a changed one mismatch (a problem)', async () => {
    const dir = path.join(tmp, 'backups-race');
    const gone = await storeFile({ purpose: 'attachment', name: 'gone.pdf', data: enc('%PDF-1.4 gone'), actor });
    const changed = await storeFile({ purpose: 'attachment', name: 'changed.pdf', data: enc('%PDF-1.4 changed'), actor });
    const rows = (await readManifest(snapPath)).files.length; // the 2 earlier files are in the store of another folder
    const pathOf = async (id: string) => (await (await getDb()).execute(`select storage_path from stored_files where id = '${id}'`)).rows[0] as { storage_path: string };
    fs.rmSync(path.join(filesRoot(), (await pathOf(gone.id)).storage_path));
    fs.writeFileSync(path.join(filesRoot(), (await pathOf(changed.id)).storage_path), 'tampered');
    const snap = await createSnapshot({ dir, source: { kind: 'pglite', client: clientOf(db) }, filesRoot: filesRoot() });
    expect(snap.manifest.filesSummary).toEqual({ stored: rows, copied: rows, missing: 1, mismatch: 1 });
    const report = await restoreSnapshot({ snapshotPath: snap.path, target: { kind: 'pglite', dataDir: path.join(tmp, 'restored-2') } });
    expect(report.files.missingAtBackup).toBe(1);
    expect(report.files.problems).toEqual([expect.stringContaining('its content differed from the database when the snapshot was taken')]);
    expect(report.ok).toBe(false);
    await deleteStoredFile(gone.id);
    await deleteStoredFile(changed.id);
  }, 60_000);

  it('an older snapshot restored with a newer Keystone: pending migrations reported with the next step, not a failure', async () => {
    const folder = path.join(tmp, 'migrations-old');
    fs.cpSync(MIGRATIONS_FOLDER(), folder, { recursive: true });
    const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'));
    journal.entries.pop();
    fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
    // Migrated, not seeded: today's seed writes today's schema, which the older migrations may not have yet (R-083's last
    // migration drops the undated rate columns the older schema still requires).
    const old = new PGlite();
    await migrate(drizzle(old), { migrationsFolder: folder });
    try {
      const snap = await createSnapshot({ dir: path.join(tmp, 'backups-old'), source: { kind: 'pglite', client: old }, filesRoot: path.join(tmp, 'no-files') });
      expect(snap.manifest.migrations.applied).toBe(migrationFiles().length - 1);
      const report = await restoreSnapshot({ snapshotPath: snap.path, target: { kind: 'pglite', dataDir: path.join(tmp, 'restored-old') } });
      expect([report.ok, report.pendingMigrations]).toEqual([true, 1]);
      expect(report.notes.join(' ')).toContain('npm run db:migrate');
    } finally {
      await old.close();
    }
  }, 60_000);
});

describe('retention, garbage collection, lock', () => {
  it('prunes by the retention, then removes the blobs only pruned snapshots referenced; stale partial folders go too', async () => {
    const dir = path.join(tmp, 'backups-gc');
    const now = new Date('2026-10-12T12:00:00Z');
    const a = await storeFile({ purpose: 'attachment', name: 'only-old.pdf', data: enc(`%PDF-1.4 old ${randomBytes(4).toString('hex')}`), actor });
    const old = await createSnapshot({ dir, source: { kind: 'pglite', client: clientOf(db) }, filesRoot: filesRoot(), now: new Date(now.getTime() - 3 * 3_600_000) });
    const blob = blobPath(dir, a.sha256);
    expect(fs.existsSync(blob)).toBe(true);
    await deleteStoredFile(a.id);
    await createSnapshot({ dir, source: { kind: 'pglite', client: clientOf(db) }, filesRoot: filesRoot(), now });
    fs.mkdirSync(path.join(dir, '20261012T000000000Z.partial'));
    const out = await applyRetention(dir, { allHours: 1, dailyDays: 0, monthlyMonths: 0 }, now);
    expect(out).toEqual({ snapshots: 1, partials: 1, blobs: 1 });
    expect(fs.existsSync(old.path)).toBe(false);
    expect(fs.existsSync(blob)).toBe(false);
    // The kept snapshot's blobs stay.
    for (const f of (await readManifest((await listSnapshots(dir))[0].path)).files) expect(fs.existsSync(blobPath(dir, f.sha256))).toBe(true);
    expect(await applyRetention(dir, RETENTION, now)).toEqual({ snapshots: 0, partials: 0, blobs: 0 });
  }, 60_000);

  it('one writer at a time on a folder; a lock left by a crash is taken over', async () => {
    const dir = path.join(tmp, 'backups-lock');
    const release = await lockBackupFolder(dir);
    await expect(lockBackupFolder(dir)).rejects.toThrow(BackupBusyError);
    await release();
    const again = await lockBackupFolder(dir);
    await again();
    fs.writeFileSync(path.join(dir, 'backup.lock'), 'host:1:0');
    const old = new Date(Date.now() - 4 * 3_600_000);
    fs.utimesSync(path.join(dir, 'backup.lock'), old, old);
    await (await lockBackupFolder(dir))();
  });
});

describe('the scheduled job', () => {
  it('off unless KEYSTONE_BACKUP_DIR is set', async () => {
    expect(await runBackupJob()).toEqual({ summary: 'backups off (KEYSTONE_BACKUP_DIR not set)', counts: {} });
  });

  it('a snapshot when due (every 10 min on the 5-min tick), "not due" in between, retention applied; recorded through the runner', async () => {
    quiet();
    const dir = path.join(tmp, 'backups-job');
    vi.stubEnv('KEYSTONE_BACKUP_DIR', dir);
    const t0 = new Date(Date.now() - 20 * MIN);
    const first = await runBackupJob(t0);
    expect(first.summary).toMatch(/^snapshot \d{8}T\d{9}Z · \d+ files \(\d+ copied, 0 missing, 0 mismatched\) · 0 old snapshots pruned$/);
    expect(first.counts).toMatchObject({ missing: 0, mismatch: 0, pruned: 0 });
    expect((await runBackupJob(new Date(t0.getTime() + 5 * MIN))).summary).toMatch(/^not due · last snapshot /);
    expect((await runBackupJob(new Date(t0.getTime() + 10 * MIN))).summary).toMatch(/^snapshot /);
    expect((await listSnapshots(dir)).length).toBe(2);
    vi.stubEnv('KEYSTONE_BACKUP_EVERY_MIN', '5');
    const r = await runJob(jobDefinition('backup'), 'test-holder', { force: true });
    expect(r.status).toBe('ok');
    const [lock] = (await listJobLocks()).filter((l) => l.job === 'backup');
    expect([lock.lastOk, lock.lastSummary?.startsWith('snapshot ')]).toEqual([true, true]);
  }, 60_000);

  it('skipped while another backup holds the folder; a failure is thrown (the runner records it) with the stale error line', async () => {
    quiet();
    const error = vi.spyOn(console, 'error');
    const dir = path.join(tmp, 'backups-busy');
    vi.stubEnv('KEYSTONE_BACKUP_DIR', dir);
    const release = await lockBackupFolder(dir);
    expect((await runBackupJob()).summary).toMatch(/^skipped · A backup is already running/);
    await release();
    // A folder that cannot be written (a file in its place): the snapshot fails, no good snapshot → stale.
    const blocked = path.join(tmp, 'not-a-folder');
    fs.writeFileSync(blocked, 'x');
    vi.stubEnv('KEYSTONE_BACKUP_DIR', blocked);
    await expect(runBackupJob()).rejects.toThrow();
    expect(error.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Backups are stale');
  }, 60_000);

  it('backupNow writes a snapshot at any time (npm run backup)', async () => {
    const r = await backupNow({ dir: path.join(tmp, 'backups-now'), source: { kind: 'pglite', client: clientOf(db) }, filesRoot: filesRoot(), retention: RETENTION });
    expect(r.summary).toMatch(/^snapshot /);
  }, 60_000);
});

describe('command lines', () => {
  it('restore: a snapshot and a target; a database URL needs --data-dir; unknown options refused', () => {
    expect(parseRestoreArgs(['20261012T100000000Z', '--target', 'restored'], '/srv')).toEqual({ ok: true, snapshot: '20261012T100000000Z', from: null, target: { kind: 'pglite', dataDir: '/srv/restored' } });
    expect(parseRestoreArgs(['s', '--target', 'postgresql://u@db/ks_restored', '--data-dir', '/data2', '--from', 'b'], '/srv')).toEqual({
      ok: true, snapshot: 's', from: '/srv/b', target: { kind: 'postgres', url: 'postgresql://u@db/ks_restored', dataDir: '/data2' },
    });
    expect(parseRestoreArgs(['s', '--target', 'postgres://db/x'], '/srv')).toMatchObject({ ok: false, error: expect.stringContaining('--data-dir') });
    expect(parseRestoreArgs(['s', '--target', 'folder', '--data-dir', 'x'], '/srv')).toMatchObject({ ok: false });
    expect(parseRestoreArgs(['--target', 'folder'], '/srv')).toMatchObject({ ok: false, error: expect.stringContaining('Usage') });
    expect(parseRestoreArgs(['s', '--force', '--target', 'x'], '/srv')).toEqual({ ok: false, error: 'Unknown option --force' });
    expect(parseRestoreArgs(['s', 't', '--target', 'x'], '/srv')).toEqual({ ok: false, error: 'Unexpected argument t' });
  });

  it('a snapshot by name in the backup folder, or by path', () => {
    expect(snapshotLocation('20261012T100000000Z', '/b', '/srv')).toEqual({ snapshotPath: '/b/20261012T100000000Z', backupDir: '/b' });
    expect(snapshotLocation('/mnt/b/20261012T100000000Z/', null, '/srv')).toEqual({ snapshotPath: '/mnt/b/20261012T100000000Z', backupDir: '/mnt/b' });
    expect(snapshotLocation('x', null, '/srv')).toBeNull();
  });

  it('npm run backup: PostgreSQL at any time; PGlite only with the server stopped (KEYSTONE_WORKER_PGLITE=exclusive)', () => {
    expect(backupDatabaseGuard({ DATABASE_URL: 'postgresql://db/ks' })).toEqual({ ok: true, driver: 'postgres' });
    expect(backupDatabaseGuard({ KEYSTONE_WORKER_PGLITE: 'exclusive' })).toEqual({ ok: true, driver: 'pglite' });
    expect(backupDatabaseGuard({})).toMatchObject({ ok: false, error: expect.stringContaining('KEYSTONE_JOBS=inprocess') });
  });
});

// ── PostgreSQL (opt-in) ────────────────────────────────────────────────────────────────────────────────────────────────
const ADMIN_URL = process.env.KEYSTONE_TEST_DATABASE_URL?.trim();
const urlOf = (name: string) => {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  return u.toString();
};
async function admin(sqlText: string, database?: string): Promise<void> {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: database ? urlOf(database) : ADMIN_URL });
  await c.connect();
  try {
    await c.query(sqlText);
  } finally {
    await c.end();
  }
}

describe.skipIf(!ADMIN_URL)('snapshot and restore (PostgreSQL, KEYSTONE_TEST_DATABASE_URL)', () => {
  const src = `ks_bk_${randomBytes(4).toString('hex')}`;
  const dst = `${src}_restored`;
  let close: (() => Promise<void>) | null = null;
  let pgDb: DB;

  beforeAll(async () => {
    // Each database gets the `keystone` schema, as the shared server's base layer creates it (Keystone never creates a schema).
    for (const name of [src, dst]) {
      await admin(`create database ${name}`);
      await admin('create schema keystone', name);
    }
    const { openPostgres, migrateAndSeedPostgres } = await import('@/server/db/postgres');
    const h = await openPostgres({ url: urlOf(src), poolMax: 4 });
    await migrateAndSeedPostgres(h, 'demo');
    pgDb = h.db;
    close = () => h.close();
  }, 120_000);
  afterAll(async () => {
    await close?.();
    await admin(`drop database if exists ${dst} with (force)`);
    await admin(`drop database if exists ${src} with (force)`);
  });

  it('pg_dump on an exported snapshot, pg_restore --no-owner into an empty database: identical DAL reads, hashes and counts', async () => {
    setDb(pgDb);
    await storeFile({ purpose: 'attachment', name: 'pg.pdf', data: enc('%PDF-1.4 pg'), actor });
    const before = await reads();
    const dir = path.join(tmp, 'backups-pg');
    const snap = await createSnapshot({ dir, source: { kind: 'postgres', url: urlOf(src) }, filesRoot: filesRoot() });
    expect(snap.manifest).toMatchObject({ driver: 'postgres', database: { file: 'database.dump' }, seed: 'demo' });
    const target = path.join(tmp, 'restored-pg');
    await expect(restoreSnapshot({ snapshotPath: snap.path, target: { kind: 'postgres', url: urlOf(src), dataDir: path.join(tmp, 'pg-x') } })).rejects.toThrow(/not empty/);
    const report = await restoreSnapshot({ snapshotPath: snap.path, target: { kind: 'postgres', url: urlOf(dst), dataDir: target } });
    expect(report).toMatchObject({ ok: true, pendingMigrations: 0, counts: { mismatches: [] }, files: { problems: [] } });
    const { openPostgres } = await import('@/server/db/postgres');
    const h = await openPostgres({ url: urlOf(dst), poolMax: 2 });
    try {
      setDb(h.db);
      setFilesRoot(path.join(target, 'files'));
      expect(await reads()).toEqual(before);
    } finally {
      await h.close();
    }
  }, 120_000);
});
