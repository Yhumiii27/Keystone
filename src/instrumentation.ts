// Next.js instrumentation (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md): register() runs once when a
// server instance starts. R-006: with KEYSTONE_JOBS=inprocess the scheduled jobs (outbox redelivery, plan-trash purge,
// orphan-file prune — src/server/jobs) run inside this server — the way to run them with the embedded PGlite database;
// with PostgreSQL, `npm run worker` runs them in a process of its own (both may run: leases keep a job to one runner).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { jobsInProcess } = await import('./server/jobs/cli');
  if (!jobsInProcess(process.env)) return;
  const { startInProcessJobs } = await import('./server/jobs/in-process');
  startInProcessJobs();
}
