// Command line and start-up rules of `npm run worker` (R-006). Pure, so they are unit-tested; scripts/worker.ts applies them.
//
//   npm run worker                          run every job on its schedule until SIGINT / SIGTERM
//   npm run worker -- --once                run every job once now (ignoring the gap since their last run), then exit
//   npm run worker -- --once --job plan-trash-purge [--job …]   only those jobs
//
// Database: with PostgreSQL (DATABASE_URL, R-002) the worker runs beside the web servers. The embedded PGlite database is a
// folder that only one process may open: the worker refuses it while the web server may be running, unless
// KEYSTONE_WORKER_PGLITE=exclusive says the server is stopped (a maintenance run). With PGlite, run the jobs inside the web
// server instead: KEYSTONE_JOBS=inprocess (src/instrumentation.ts).
import { isJobName, type JobName } from '@/domain/jobs';

export interface WorkerArgs {
  once: boolean;
  jobs: JobName[];
}

export type ParsedArgs = { ok: true; args: WorkerArgs } | { ok: false; error: string };

export function parseWorkerArgs(argv: readonly string[]): ParsedArgs {
  let once = false;
  const jobs: JobName[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') once = true;
    else if (a === '--job') {
      const name = argv[++i];
      if (!isJobName(name)) return { ok: false, error: `Unknown job ${name ?? '(missing)'}` };
      if (!jobs.includes(name)) jobs.push(name);
    } else return { ok: false, error: `Unknown option ${a}` };
  }
  return { ok: true, args: { once, jobs } };
}

export type DatabaseGuard = { ok: true; driver: 'postgres' | 'pglite' } | { ok: false; error: string };

/** Whether the worker may open the database (see the header). */
export function workerDatabaseGuard(env: Readonly<Record<string, string | undefined>>): DatabaseGuard {
  if (env.DATABASE_URL?.trim()) return { ok: true, driver: 'postgres' };
  if (env.KEYSTONE_WORKER_PGLITE === 'exclusive') return { ok: true, driver: 'pglite' };
  return {
    ok: false,
    error:
      'The worker needs PostgreSQL (DATABASE_URL): the embedded PGlite database can only be opened by one process. ' +
      'Run the jobs inside the web server with KEYSTONE_JOBS=inprocess, or — with the server stopped — set KEYSTONE_WORKER_PGLITE=exclusive.',
  };
}

/** KEYSTONE_JOBS: "inprocess" starts the scheduler inside the web server; anything else (default) does not. */
export const jobsInProcess = (env: Readonly<Record<string, string | undefined>>) => env.KEYSTONE_JOBS === 'inprocess';
