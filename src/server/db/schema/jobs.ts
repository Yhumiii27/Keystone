// Scheduled jobs (R-006): one row per job of the worker (src/server/jobs) — the lease that keeps two workers (or a worker
// and the in-process scheduler) from running the same job at once, and the outcome of its last run. Relative imports only
// (drizzle-kit loads this file directly).
import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const jobLocks = pgTable('job_locks', {
  /** Job name ("vigie-outbox", "plan-trash-purge"…, src/domain/jobs.ts). */
  job: text('job').primaryKey(),
  /** Worker holding (or last holding) the lease: "worker@host:pid". */
  holder: text('holder'),
  /** End of the lease (database clock); null or past = free. A crashed worker's lease simply expires. */
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastFinishedAt: timestamp('last_finished_at', { withTimezone: true }),
  lastOk: boolean('last_ok'),
  /** "3 delivered · 0 failed · 0 pending" (EN, for the log and IT). */
  lastSummary: text('last_summary'),
  lastError: text('last_error'),
  runCount: integer('run_count').notNull().default(0),
});
