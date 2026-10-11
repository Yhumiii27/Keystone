import 'server-only';
// Scheduled jobs inside the web server (R-006, KEYSTONE_JOBS=inprocess, started by src/instrumentation.ts): the way to run
// them with the embedded PGlite database, which only the server process may open. Same jobs, leases and logs as
// `npm run worker`; one scheduler per process (a development hot reload does not start a second one).
import { JOB_DEFINITIONS } from './definitions';
import { jobLog } from './log';
import { holderId, runJob } from './runner';
import { startScheduler, type Scheduler } from './scheduler';

const g = globalThis as unknown as { __ksJobs?: Scheduler };

export function startInProcessJobs(): void {
  if (g.__ksJobs) return;
  const holder = holderId('server');
  g.__ksJobs = startScheduler(
    JOB_DEFINITIONS.map((d) => ({ name: d.name, everyMs: d.everyMs, firstDelayMs: d.firstDelayMs, run: () => runJob(d, holder) })),
    { keepAlive: false },
  );
  jobLog('info', 'Scheduler started', { holder, mode: 'inprocess', jobs: JOB_DEFINITIONS.map((d) => d.name).join(',') });
}
