import 'server-only';
// Leases of the scheduled jobs (R-006, table job_locks): a worker runs a job only while it holds the job's lease, so two
// workers — or a worker and the in-process scheduler of a web server — never run the same job at once, and N workers run
// a scheduled job about once per interval (`minGapMs` since its last start). The lease is taken and compared on the
// database clock (one clock for every host) in a single upsert, so two workers racing for it cannot both win. A worker
// that crashes keeps the lease until it expires; the next worker then takes the job over.
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { jobLocks } from '@/server/db/schema';

export type JobLockRow = typeof jobLocks.$inferSelect;

const ms = (n: number) => sql`(${Math.max(0, Math.round(n))}::int * interval '1 millisecond')`;

/**
 * Takes the lease of `job` for `leaseMs` when it is free (never taken, released, or expired) and the job has not started
 * less than `minGapMs` ago. True when this holder now holds it.
 */
export async function acquireJobLock(job: string, holder: string, leaseMs: number, minGapMs = 0): Promise<boolean> {
  const db = await getDb();
  const until = sql`now() + ${ms(leaseMs)}`;
  const rows = await db
    .insert(jobLocks)
    .values({ job, holder, lockedUntil: until, lastStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: jobLocks.job,
      set: { holder, lockedUntil: until, lastStartedAt: sql`now()` },
      setWhere: sql`(${jobLocks.lockedUntil} is null or ${jobLocks.lockedUntil} <= now()) and (${jobLocks.lastStartedAt} is null or ${jobLocks.lastStartedAt} <= now() - ${ms(minGapMs)})`,
    })
    .returning({ job: jobLocks.job });
  return rows.length === 1;
}

/**
 * Ends this holder's run: frees the lease and records the outcome. Nothing happens when the lease went to another holder
 * meanwhile (it had expired): that holder's run is the one recorded.
 */
export async function releaseJobLock(job: string, holder: string, result: { ok: boolean; summary?: string | null; error?: string | null }): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(jobLocks)
    .set({
      lockedUntil: null, lastFinishedAt: sql`now()`, lastOk: result.ok, lastSummary: result.summary?.slice(0, 500) ?? null, lastError: result.error?.slice(0, 500) ?? null,
      runCount: sql`${jobLocks.runCount} + 1`,
    })
    .where(and(eq(jobLocks.job, job), eq(jobLocks.holder, holder)))
    .returning({ job: jobLocks.job });
  return rows.length === 1;
}

/** Every job's lease and last outcome, by name. */
export async function listJobLocks(): Promise<JobLockRow[]> {
  const db = await getDb();
  return db.select().from(jobLocks).orderBy(asc(jobLocks.job));
}
