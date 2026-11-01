// Keystone job worker (R-006) — `npm run worker` (tsx --conditions=react-server scripts/worker.ts).
// Runs the scheduled jobs of src/server/jobs on their intervals (reminder jobs once a day at KEYSTONE_REMINDERS_AT, Paris): outbox redelivery to Vigie and Cursus, plan-trash purge of
// expired entries for every project, orphan stored-file prune. Each job is idempotent, logged (one JSON line per run on
// stdout / stderr) and leased in the database (table job_locks) so two workers never run the same job at once.
// Options and database rules: src/server/jobs/cli.ts. Stops cleanly on SIGINT / SIGTERM (waits for the runs in progress).
// The Friday freeze is not a job yet (S-4 open).
// First: Next's react-server resolution of next/navigation (src/server/jobs/next-shims.ts, R-199 reports).
import '@/server/jobs/next-shims';
import path from 'node:path';
import { getConfig } from '@/server/config';
import { lockPgliteFolder } from '@/server/db/pglite-lock';
import { JOB_DEFINITIONS, jobDefinition } from '@/server/jobs/definitions';
import { parseWorkerArgs, workerDatabaseGuard } from '@/server/jobs/cli';
import { jobLog } from '@/server/jobs/log';
import { holderId, runJob, scheduledEntries } from '@/server/jobs/runner';
import { startScheduler } from '@/server/jobs/scheduler';

const dataDir = () => (process.env.KEYSTONE_DATA_DIR ? path.resolve(process.env.KEYSTONE_DATA_DIR) : path.join(process.cwd(), '.data'));

async function main(): Promise<number> {
  const parsed = parseWorkerArgs(process.argv.slice(2));
  if (!parsed.ok) {
    jobLog('error', 'Worker not started', { error: parsed.error });
    return 2;
  }
  const guard = workerDatabaseGuard(process.env);
  if (!guard.ok) {
    jobLog('error', 'Worker not started', { error: guard.error });
    return 2;
  }
  // PGlite (exclusive maintenance run): a lock file in the data folder keeps a second worker (or `npm run backup`) out.
  const release = guard.driver === 'pglite' ? lockPgliteFolder(dataDir()) : () => {};
  try {
    const holder = holderId('worker');
    const jobs = parsed.args.jobs.length ? parsed.args.jobs.map(jobDefinition) : [...JOB_DEFINITIONS];
    if (parsed.args.once) {
      jobLog('info', 'Worker run once', { holder, driver: guard.driver, jobs: jobs.map((j) => j.name).join(',') });
      let failed = 0;
      for (const job of jobs) if ((await runJob(job, holder, { force: true })).status === 'failed') failed++;
      return failed ? 1 : 0;
    }
    const scheduler = startScheduler(scheduledEntries(jobs, holder), { keepAlive: true });
    jobLog('info', 'Worker started', { holder, driver: guard.driver, remindersAt: getConfig().remindersAt, jobs: jobs.map((j) => j.name).join(',') });
    await new Promise<void>((resolve) => {
      const stop = (signal: string) => {
        jobLog('info', 'Worker stopping', { holder, signal });
        scheduler.stop().then(resolve, resolve);
      };
      process.once('SIGINT', () => stop('SIGINT'));
      process.once('SIGTERM', () => stop('SIGTERM'));
    });
    jobLog('info', 'Worker stopped', { holder });
    return 0;
  } finally {
    release();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    jobLog('error', 'Worker crashed', { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  },
);
