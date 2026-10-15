// npm run db:migrate — applies the migrations of ./drizzle and seeds an empty database (R-002, R-011):
//   DATABASE_URL set   → the PostgreSQL server, under an advisory lock (run it at deploy time, before the new version
//                        starts); an empty database needs KEYSTONE_SEED=production (reference data only) or demo.
//   DATABASE_URL unset → the PGlite database of KEYSTONE_DATA_DIR (default ./.data), as the server does on its first start
//                        (stop the server first). KEYSTONE_SEED defaults to demo.
// The .env files are read as Next reads them. Exit code 0 when the database is ready, 1 otherwise.
//   npx tsx --conditions=react-server scripts/db-migrate.ts
import { loadEnvFiles } from '@/server/config/env-files';

async function main(): Promise<void> {
  loadEnvFiles(process.cwd());
  const { runMigrateCommand } = await import('@/server/db/migrate-command');
  await runMigrateCommand();
}

main().then(
  () => process.exit(0),
  async (e) => {
    const { logError } = await import('@/server/log');
    logError('db:migrate', e, { component: 'db' });
    process.exit(1);
  },
);
