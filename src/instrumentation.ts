// Next.js instrumentation (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
// - register(): runs once when a server instance starts, before it handles requests — configuration check and, in
//   production, database check (src/server/startup.ts, R-007 / R-002). In production a failure stops the process (exit 1)
//   so the hosting platform sees a failed start instead of a server that errors on every page.
// - onRequestError(): every error Next catches while rendering a page, running a Route Handler or a Server Function is
//   written as one structured log line (src/server/log, R-009) — path without query string, no header, no secret.
// Node.js only: the server modules are imported under the NEXT_RUNTIME check, as the guide recommends.
import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeServer } = await import('./server/startup');
    await registerNodeServer();
    // R-006: with KEYSTONE_JOBS=inprocess the scheduled jobs (outbox redelivery, plan-trash purge, orphan-file prune —
    // src/server/jobs) run inside this server — the way to run them with the embedded PGlite database; with PostgreSQL,
    // `npm run worker` runs them in a process of its own (both may run: leases keep a job to one runner).
    const { jobsInProcess } = await import('./server/jobs/cli');
    if (jobsInProcess(process.env)) {
      const { startInProcessJobs } = await import('./server/jobs/in-process');
      startInProcessJobs();
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logRequestError } = await import('./server/log');
    logRequestError(err, { path: request.path, method: request.method }, context);
  }
};
