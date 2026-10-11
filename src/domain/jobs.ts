// Scheduled jobs (R-006) — pure rules of the worker (src/server/jobs): which jobs exist and how often they run, what the
// plan-trash purge and the orphan-file prune remove, and when a lease is free. The Friday freeze is not a job yet: what it
// records and what moves the data date wait for the owner's answer to S-4 (DELIVERY-6 §8).
//
// Defaults (owner to confirm, docs/delivery-7/notes-platform-web.md):
// - outbox redelivery (Vigie, Cursus): every 5 minutes — what Keystone recorded reaches Vigie / Cursus within minutes
//   once their API is configured; with the mock connectors nothing is sent and the job only reports what waits;
// - plan-trash purge: every hour — removals older than 30 days (beyond 20 per project) leave "Recently deleted" even
//   on a project nobody edits (before: only at the project's next removal);
// - orphan-file prune: every day — files on disk without a record (a rolled-back upload) older than 24 hours.
// Every job is idempotent: running it twice, or after a crash, removes or sends nothing more than once.

export type JobName = 'vigie-outbox' | 'cursus-outbox' | 'plan-trash-purge' | 'orphan-files-prune';

export interface JobSchedule {
  name: JobName;
  /** Interval between two runs. */
  everyMs: number;
  /** Lease taken for one run: longer than any run, so a crashed worker's job is picked up again after it. */
  leaseMs: number;
  /** Delay before the first run after the worker starts (staggered, so jobs do not all start at once). */
  firstDelayMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const JOB_SCHEDULES: readonly JobSchedule[] = [
  { name: 'vigie-outbox', everyMs: 5 * MIN, leaseMs: 15 * MIN, firstDelayMs: 5_000 },
  { name: 'cursus-outbox', everyMs: 5 * MIN, leaseMs: 15 * MIN, firstDelayMs: 10_000 },
  { name: 'plan-trash-purge', everyMs: HOUR, leaseMs: 15 * MIN, firstDelayMs: 15_000 },
  { name: 'orphan-files-prune', everyMs: 24 * HOUR, leaseMs: HOUR, firstDelayMs: 20_000 },
];

export const JOB_NAMES: readonly JobName[] = JOB_SCHEDULES.map((j) => j.name);

export const isJobName = (v: unknown): v is JobName => typeof v === 'string' && (JOB_NAMES as readonly string[]).includes(v);

/** Files on disk younger than this are never pruned (an upload writes the file before its record is committed). */
export const ORPHAN_FILE_GRACE_MS = 24 * HOUR;

/**
 * Minimum gap between two scheduled runs of a job across workers: a little under its interval (timers drift), so N workers
 * still run it about once per interval. A manual run (`npm run worker -- --once`) ignores it.
 */
export const minGapMs = (s: Pick<JobSchedule, 'everyMs'>) => Math.floor(s.everyMs * 0.9);

/**
 * Plan-trash entries of one project to purge: older than `retentionDays`, or beyond the `keep` most recent. The project's
 * next removal keeps `maxEntries - 1` (room for the new one); the scheduled purge keeps `maxEntries`.
 */
export function trashEntriesToPurge<E extends { id: string; deletedAt: Date }>(entries: readonly E[], now: Date, retentionDays: number, keep: number): E[] {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const newest = [...entries].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime()).slice(0, Math.max(0, keep));
  const kept = new Set(newest.map((e) => e.id));
  return entries.filter((e) => e.deletedAt.getTime() < cutoff || !kept.has(e.id));
}

/** Files on disk (path relative to the files root, last modification) that no record references and that are old enough. */
export function orphanFilesToPrune<F extends { rel: string; mtimeMs: number }>(files: readonly F[], known: ReadonlySet<string>, now: number, graceMs: number): F[] {
  return files.filter((f) => !known.has(f.rel) && f.mtimeMs <= now - graceMs);
}
