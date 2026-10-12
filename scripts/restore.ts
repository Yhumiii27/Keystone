// npm run restore -- <snapshot> --target <new data folder | empty postgresql:// database> [--data-dir <folder>] [--from <dir>]
// Restores a backup snapshot (R-004) into an EMPTY target — never over existing data — then checks every stored file
// (sha256) and every table's row count, reports pending migrations (next step: npm run db:migrate) and the elapsed time.
// Usage and rules: src/server/backup/cli.ts and restore.ts; procedure and quarterly drill: docs/EXPLOITATION.md.
// Exit code 0 when restored and checked, 1 when a check failed or the restore failed, 2 when refused.
import { loadEnvFiles } from '@/server/config/env-files';

async function main(): Promise<number> {
  loadEnvFiles(process.cwd());
  const [{ getConfig }, { parseRestoreArgs, snapshotLocation }, { restoreSnapshot, RestoreRefusedError }] = await Promise.all([
    import('@/server/config'), import('@/server/backup/cli'), import('@/server/backup/restore'),
  ]);
  const args = parseRestoreArgs(process.argv.slice(2), process.cwd());
  if (!args.ok) {
    console.error(args.error);
    return 2;
  }
  const where = snapshotLocation(args.snapshot, args.from ?? getConfig().backup.dir, process.cwd());
  if (!where) {
    console.error('Give the snapshot folder path, or --from <backup folder> (KEYSTONE_BACKUP_DIR is not set).');
    return 2;
  }
  console.log(`Restoring ${where.snapshotPath}`);
  try {
    const r = await restoreSnapshot({ snapshotPath: where.snapshotPath, backupDir: where.backupDir, target: args.target, progress: (l) => console.log(`  ${l}`) });
    console.log(`Snapshot ${r.snapshot}: ${r.files.restored} files restored, ${r.counts.checked} tables checked.`);
    for (const p of r.files.problems) console.error(`  file problem: ${p}`);
    for (const m of r.counts.mismatches) console.error(`  row count: ${m}`);
    for (const n of r.notes) console.log(`  ${n}`);
    console.log(`${r.ok ? 'Restore checked' : 'Restore done with problems'} in ${(r.durationMs / 1000).toFixed(1)} s.`);
    return r.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof RestoreRefusedError) {
      console.error(`Refused: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
