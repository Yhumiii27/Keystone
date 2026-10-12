// Command lines of `npm run backup` and `npm run restore` (R-004). Pure, so they are unit-tested; scripts/backup.ts and
// scripts/restore.ts apply them.
//
//   npm run backup                                    a snapshot now into KEYSTONE_BACKUP_DIR (then the retention)
//   npm run restore -- <snapshot> --target <folder>   a PGlite snapshot into a new data folder
//   npm run restore -- <snapshot> --target postgresql://…/keystone_restored --data-dir <folder>
//                                                     a PostgreSQL snapshot into an empty database (files into the folder)
//   … --from <backup dir>                             where to find <snapshot> by name (default KEYSTONE_BACKUP_DIR)
//
// Database rule of `npm run backup`: with PostgreSQL it runs at any time (pg_dump reads a consistent snapshot); the
// embedded PGlite folder can be opened by one process only, so it refuses unless KEYSTONE_WORKER_PGLITE=exclusive says the
// server is stopped (the same guard as the worker). With the server running, the in-process job takes the snapshots.
import path from 'node:path';

export type RestoreArgs =
  | { ok: true; snapshot: string; from: string | null; target: { kind: 'pglite'; dataDir: string } | { kind: 'postgres'; url: string; dataDir: string } }
  | { ok: false; error: string };

export const RESTORE_USAGE =
  'Usage: npm run restore -- <snapshot> --target <new data folder | empty postgresql:// database> [--data-dir <new folder for the files>] [--from <backup folder>]';

const isPgUrl = (s: string) => /^postgres(ql)?:\/\//i.test(s);

export function parseRestoreArgs(argv: readonly string[], cwd: string): RestoreArgs {
  let snapshot: string | null = null;
  let target: string | null = null;
  let dataDir: string | null = null;
  let from: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      return v && !v.startsWith('--') ? v : null;
    };
    if (a === '--target') target = value();
    else if (a === '--data-dir') dataDir = value();
    else if (a === '--from') from = value();
    else if (a.startsWith('--')) return { ok: false, error: `Unknown option ${a}` };
    else if (!snapshot) snapshot = a;
    else return { ok: false, error: `Unexpected argument ${a}` };
  }
  if (!snapshot || !target) return { ok: false, error: RESTORE_USAGE };
  if (isPgUrl(target)) {
    if (!dataDir) return { ok: false, error: 'A PostgreSQL target needs --data-dir <new folder> for the files' };
    return { ok: true, snapshot, from: from ? path.resolve(cwd, from) : null, target: { kind: 'postgres', url: target, dataDir: path.resolve(cwd, dataDir) } };
  }
  if (dataDir) return { ok: false, error: '--data-dir is only for a PostgreSQL target (a folder target holds the files itself)' };
  return { ok: true, snapshot, from: from ? path.resolve(cwd, from) : null, target: { kind: 'pglite', dataDir: path.resolve(cwd, target) } };
}

/** Where the snapshot folder is: a path to it, or its name inside the backup folder. */
export function snapshotLocation(snapshot: string, backupDir: string | null, cwd: string): { snapshotPath: string; backupDir: string } | null {
  if (snapshot.includes('/') || snapshot.includes(path.sep)) {
    const p = path.resolve(cwd, snapshot.replace(/[\\/]+$/, ''));
    return { snapshotPath: p, backupDir: path.dirname(p) };
  }
  if (!backupDir) return null;
  return { snapshotPath: path.join(backupDir, snapshot), backupDir };
}

export type BackupGuard = { ok: true; driver: 'postgres' | 'pglite' } | { ok: false; error: string };

/** May `npm run backup` open the database? (see the header) */
export function backupDatabaseGuard(env: Readonly<Record<string, string | undefined>>): BackupGuard {
  if (env.DATABASE_URL?.trim()) return { ok: true, driver: 'postgres' };
  if (env.KEYSTONE_WORKER_PGLITE === 'exclusive') return { ok: true, driver: 'pglite' };
  return {
    ok: false,
    error:
      'The embedded PGlite database can only be opened by one process: with the server running, its in-process "backup" job ' +
      '(KEYSTONE_JOBS=inprocess) takes the snapshots. To back up with the server stopped, set KEYSTONE_WORKER_PGLITE=exclusive.',
  };
}
