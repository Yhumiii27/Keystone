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
//
// Reminder jobs (owner's answer of 17 Oct 2026 to R-121: « Les alertes automatiques de rappel doivent arriver le matin »): a job
// that sends reminders or notices to people (`daily: 'reminders'`) runs once a day at the reminders hour, Europe/Paris
// (KEYSTONE_REMINDERS_AT, default DEFAULT_REMINDERS_AT = 07:00), instead of every 24 h from the worker's start. Technical jobs
// (outboxes, backups, purges, rescans, directory and index reads) keep their intervals.

import { addDaysIso, parisInstant, parisParts } from '@/server/db/codes';

export type JobName =
  | 'vigie-outbox'
  | 'cursus-outbox'
  | 'codex-outbox'
  | 'plan-trash-purge'
  | 'orphan-files-prune'
  // ── Delivery 8 · platform-ops jobs ──
  // Backups (R-004): wakes every BACKUP_DEFAULTS.tickMin; a snapshot is taken when due (KEYSTONE_BACKUP_EVERY_MIN, default
  // 10 min) and only when KEYSTONE_BACKUP_DIR is set — otherwise the run does nothing.
  | 'backup'
  // Antivirus rescan of the stored files and purge of expired quarantine copies (R-175), daily.
  | 'files-rescan'
  // ── Delivery 8 · connectors jobs ──
  | 'cursus-directory'
  | 'cursus-events-purge'
  // ── Delivery 8 · docs-client-portfolio jobs ──
  | 'codex-index'
  // ── Delivery 9 · R-121 (D-4 'a'): client prerequisites late at J-15 → the PM of record notified, a risk proposed; daily.
  | 'site-prerequisite-alerts'
  ;

export interface JobSchedule {
  name: JobName;
  /** Interval between two runs. */
  everyMs: number;
  /** Lease taken for one run: longer than any run, so a crashed worker's job is picked up again after it. */
  leaseMs: number;
  /** Delay before the first run after the worker starts (staggered, so jobs do not all start at once). */
  firstDelayMs: number;
  /**
   * 'reminders': a reminder job — once a day at the reminders hour (Europe/Paris) instead of every `everyMs`; a worker started
   * after that hour runs the day's missed run at once (after `firstDelayMs`) unless it already ran that day.
   */
  daily?: 'reminders';
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const JOB_SCHEDULES: readonly JobSchedule[] = [
  { name: 'vigie-outbox', everyMs: 5 * MIN, leaseMs: 15 * MIN, firstDelayMs: 5_000 },
  { name: 'cursus-outbox', everyMs: 5 * MIN, leaseMs: 15 * MIN, firstDelayMs: 10_000 },
  { name: 'codex-outbox', everyMs: 5 * MIN, leaseMs: 15 * MIN, firstDelayMs: 12_000 },
  { name: 'plan-trash-purge', everyMs: HOUR, leaseMs: 15 * MIN, firstDelayMs: 15_000 },
  { name: 'orphan-files-prune', everyMs: 24 * HOUR, leaseMs: HOUR, firstDelayMs: 20_000 },
  // ── Delivery 8 · platform-ops jobs ──
  { name: 'backup', everyMs: 5 * MIN, leaseMs: 3 * HOUR, firstDelayMs: 25_000 },
  { name: 'files-rescan', everyMs: 24 * HOUR, leaseMs: 6 * HOUR, firstDelayMs: 30_000 },
  // ── Delivery 8 · connectors jobs ──
  // R-027: Cursus's staff directory, daily (a no-op until CURSUS_DIRECTORY=on); R-029: the events inbox kept 13 months.
  { name: 'cursus-directory', everyMs: 24 * HOUR, leaseMs: HOUR, firstDelayMs: 35_000 },
  { name: 'cursus-events-purge', everyMs: 24 * HOUR, leaseMs: 15 * MIN, firstDelayMs: 40_000 },
  // ── Delivery 8 · docs-client-portfolio jobs ──
  // R-033: Codex's index read every hour with the HTTP connector (interval to confirm — the spec's Codex row says real time /
  // webhooks, which Codex does not offer yet); with the mock it reads nothing.
  { name: 'codex-index', everyMs: HOUR, leaseMs: 15 * MIN, firstDelayMs: 45_000 },
  // ── Delivery 9 · R-121: once a day (the J-15 rule moves by days); one alert per prerequisite and need date, so a run after a
  // restart, or two workers, alert nothing twice.
  // Owner's answer of 17 Oct 2026: reminders arrive in the morning — at the reminders hour (07:00 Paris by default).
  { name: 'site-prerequisite-alerts', everyMs: 24 * HOUR, leaseMs: 15 * MIN, firstDelayMs: 50_000, daily: 'reminders' },
];

export const JOB_NAMES: readonly JobName[] = JOB_SCHEDULES.map((j) => j.name);

export const isJobName = (v: unknown): v is JobName => typeof v === 'string' && (JOB_NAMES as readonly string[]).includes(v);

// ── Reminders hour (owner's answer of 17 Oct 2026 to R-121) ────────────────────────────────────────────

/** Default hour of the reminder jobs, Europe/Paris wall clock (KEYSTONE_REMINDERS_AT overrides it). */
export const DEFAULT_REMINDERS_AT = '07:00';

/** "7:00" / "07:00" → "07:00"; null unless a time of day HH:MM (00:00–23:59). */
export function parseTimeOfDay(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * Instant of `at` (HH:MM, Paris wall clock) on the Paris date `iso`. DST-safe: the offset is the one of that day (07:00 is
 * 05:00 UTC in summer time, 06:00 UTC in winter time). A time that does not exist on the spring-forward night (02:00–02:59)
 * falls an hour earlier.
 */
export const dailySlotOn = (iso: string, at: string): Date => parisInstant(iso, at);

/** Today's slot (the Paris date of `now`) when it has passed — the run a reminder job owes today; null before the hour. */
export function passedDailySlot(now: Date, at: string): Date | null {
  const slot = dailySlotOn(parisParts(now).iso, at);
  return slot.getTime() <= now.getTime() ? slot : null;
}

/** The next slot strictly after `now`: today's when still ahead, else tomorrow's (each day's own UTC offset). */
export function nextDailySlot(now: Date, at: string): Date {
  const today = parisParts(now).iso;
  const slot = dailySlotOn(today, at);
  return slot.getTime() > now.getTime() ? slot : dailySlotOn(addDaysIso(today, 1), at);
}

/**
 * Delay of a reminder job's next timer after the worker starts (`first`) or after a run: at start, `firstDelayMs` when today's
 * slot has passed (the missed run — the lease skips it when the day's run already happened), else until today's slot; after a
 * run, until the next slot.
 */
export function dailyDelayMs(now: Date, at: string, first: { firstDelayMs: number } | null): number {
  if (first && passedDailySlot(now, at)) return first.firstDelayMs;
  return nextDailySlot(now, at).getTime() - now.getTime();
}

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
