// npm run backup — takes a backup snapshot now into KEYSTONE_BACKUP_DIR (R-004), then applies the retention:
//   PostgreSQL (DATABASE_URL): at any time — pg_dump reads a consistent snapshot (pg_dump ≥ the server's major version on PATH);
//   PGlite: only with the server stopped and KEYSTONE_WORKER_PGLITE=exclusive (one process per database folder); with the
//   server running, its in-process "backup" job (KEYSTONE_JOBS=inprocess) takes the snapshots.
// The .env files are read as Next reads them. Exit code 0 when the snapshot is written, 1 when it failed, 2 when refused.
// Rules and layout: src/server/backup (snapshot.ts, store.ts), docs/EXPLOITATION.md § Sauvegardes.
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFiles } from '@/server/config/env-files';

async function main(): Promise<number> {
  loadEnvFiles(process.cwd());
  const [{ assertValidConfig }, { backupDatabaseGuard }, { backupNow }, { lockPgliteFolder }] = await Promise.all([
    import('@/server/config'), import('@/server/backup/cli'), import('@/server/backup/job'), import('@/server/db/pglite-lock'),
  ]);
  const { config } = assertValidConfig({ strict: true });
  if (!config.backup.dir) {
    console.error('KEYSTONE_BACKUP_DIR is not set: backups are off.');
    return 2;
  }
  const guard = backupDatabaseGuard(process.env);
  if (!guard.ok) {
    console.error(guard.error);
    return 2;
  }
  const filesRoot = path.join(config.dataDir, 'files');
  const started = Date.now();
  if (config.database.driver === 'postgres') {
    const r = await backupNow({ dir: config.backup.dir, source: { kind: 'postgres', url: config.database.url }, filesRoot, retention: config.backup.retention });
    console.log(`${r.summary} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return 0;
  }
  if (!fs.existsSync(path.join(config.database.dir, 'PG_VERSION'))) {
    console.error(`No PGlite database in ${config.database.dir}.`);
    return 2;
  }
  const release = lockPgliteFolder(config.dataDir);
  const { PGlite } = await import('@electric-sql/pglite');
  // Opened as it is: no migration, no seed (a backup never changes the database).
  const client = new PGlite(config.database.dir);
  try {
    await client.waitReady;
    const r = await backupNow({ dir: config.backup.dir, source: { kind: 'pglite', client }, filesRoot, retention: config.backup.retention });
    console.log(`${r.summary} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return 0;
  } finally {
    await client.close().catch(() => null);
    release();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Backup failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
