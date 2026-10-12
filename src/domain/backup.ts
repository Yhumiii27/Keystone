// Backups and restore (R-004, I-1b: RPO ≤ 15 min, RTO ≤ 4 h) — the pure rules: when a snapshot is due, which snapshots the
// retention keeps, which blobs of the shared content store no kept snapshot references any more, when the last good
// snapshot is too old, and the snapshot folder names. The I/O is in src/server/backup.
//
// Defaults (owner and IT to confirm, docs/delivery-8/notes-platform-ops.md):
// - a snapshot every 10 minutes (KEYSTONE_BACKUP_EVERY_MIN): the data lost on a crash is at most the interval plus the run
//   time and the scheduler's tick, which stays under the 15-minute RPO — and only once the folder is copied off-site (I-1a);
// - retention 48h,30d,12m (KEYSTONE_BACKUP_RETENTION): every snapshot of the last 48 hours, then the newest of each day for
//   30 days, then the newest of each month for 12 months;
// - an error log line when the last good snapshot is older than 30 minutes (no e-mail: no mail relay, R-036).

export interface BackupRetention {
  /** Every snapshot is kept for this many hours. */
  allHours: number;
  /** Then the newest snapshot of each UTC day, for this many days. */
  dailyDays: number;
  /** Then the newest snapshot of each UTC month, for this many months. */
  monthlyMonths: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const BACKUP_DEFAULTS = {
  /** Minutes between two snapshots. */
  everyMin: 10,
  retention: { allHours: 48, dailyDays: 30, monthlyMonths: 12 } as BackupRetention,
  /** Recovery point objective of I-1b (minutes). */
  rpoMin: 15,
  /** The last good snapshot older than this (minutes) is reported as an error. */
  staleAfterMin: 30,
  /** The scheduler wakes the backup job this often (minutes); a snapshot is taken at the tick where it is due. */
  tickMin: 5,
  /** A snapshot folder left half-written (a crash) is removed once older than this (minutes). */
  partialMaxAgeMin: 180,
} as const;

/** Accepted values of KEYSTONE_BACKUP_EVERY_MIN. */
export const BACKUP_EVERY_MIN_RANGE = { min: 5, max: 1440 } as const;

/** "48h,30d,12m" → retention; null when malformed or out of range (hours 1–720, days 0–366, months 0–120). */
export function parseBackupRetention(text: string): BackupRetention | null {
  const m = /^\s*(\d{1,4})\s*h\s*,\s*(\d{1,4})\s*d\s*,\s*(\d{1,4})\s*m\s*$/i.exec(text);
  if (!m) return null;
  const [allHours, dailyDays, monthlyMonths] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (allHours < 1 || allHours > 720 || dailyDays > 366 || monthlyMonths > 120) return null;
  return { allHours, dailyDays, monthlyMonths };
}

/** "48h,30d,12m". */
export const retentionText = (r: BackupRetention) => `${r.allHours}h,${r.dailyDays}d,${r.monthlyMonths}m`;

// ── Snapshot names ─────────────────────────────────────────────────────────────────────────────────────────────────────
const STAMP_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/;

/** Folder name of a snapshot started at `at`: UTC, sortable, e.g. "20261012T101500123Z". */
export function snapshotStamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace('.', '');
}

/** Start time of a snapshot folder name; null when the name is not a snapshot's. */
export function parseSnapshotStamp(name: string): Date | null {
  const m = STAMP_RE.exec(name);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]));
  return Number.isNaN(d.getTime()) || snapshotStamp(d) !== name ? null : d;
}

// ── Scheduling ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Is a snapshot due at this tick? The job wakes every `tickMs`; a snapshot is taken when the last one started at least
 * `everyMs − tickMs / 2` ago, so the real interval stays within half a tick of the one asked (never a tick longer).
 */
export function backupDue(lastStartedAt: Date | null, now: Date, everyMs: number, tickMs: number): boolean {
  if (!lastStartedAt) return true;
  return now.getTime() - lastStartedAt.getTime() >= everyMs - tickMs / 2;
}

/** The last good snapshot is too old (or there is none) — logged as an error for IT's alerting. */
export function backupStale(lastGoodAt: Date | null, now: Date, staleAfterMs = BACKUP_DEFAULTS.staleAfterMin * MIN): boolean {
  return !lastGoodAt || now.getTime() - lastGoodAt.getTime() > staleAfterMs;
}

// ── Retention ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SnapshotRef {
  name: string;
  at: Date;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** `at` minus `months` calendar months (UTC), clamped to the month's last day. */
function monthsBefore(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * Snapshots the retention removes. Kept: every snapshot younger than `allHours`; the newest snapshot of each UTC day younger
 * than `dailyDays`; the newest of each UTC month younger than `monthlyMonths`; and always the newest snapshot. "Newest of its
 * day / month" is judged over every snapshot, so the one that represents a day today is the one that will represent it once
 * it leaves the 48-hour window (the rule is stable from one run to the next).
 */
export function backupsToPrune<S extends SnapshotRef>(snapshots: readonly S[], now: Date, retention: BackupRetention): S[] {
  if (!snapshots.length) return [];
  const newestOf = (key: (d: Date) => string) => {
    const best = new Map<string, S>();
    for (const s of snapshots) {
      const k = key(s.at);
      const b = best.get(k);
      if (!b || s.at.getTime() > b.at.getTime() || (s.at.getTime() === b.at.getTime() && s.name > b.name)) best.set(k, s);
    }
    return new Set([...best.values()]);
  };
  const newestOfDay = newestOf(dayKey);
  const newestOfMonth = newestOf(monthKey);
  const newest = [...snapshots].sort((a, b) => b.at.getTime() - a.at.getTime() || b.name.localeCompare(a.name))[0];
  const allSince = now.getTime() - retention.allHours * HOUR;
  const dailySince = now.getTime() - retention.dailyDays * DAY;
  const monthlySince = monthsBefore(now, retention.monthlyMonths).getTime();
  return snapshots.filter((s) => {
    const t = s.at.getTime();
    if (s === newest || t >= allSince) return false;
    if (t >= dailySince && newestOfDay.has(s)) return false;
    if (t >= monthlySince && newestOfMonth.has(s)) return false;
    return true;
  });
}

/**
 * Content-store garbage collection: the blobs (named by their sha256) that no kept snapshot's manifest references. Run only
 * while no snapshot is being written (the backup lease), since a snapshot in progress copies blobs before its manifest exists.
 */
export function blobsToCollect(blobs: Iterable<string>, keptManifests: readonly { files: readonly { sha256: string; status: string }[] }[]): string[] {
  const used = new Set<string>();
  for (const m of keptManifests) for (const f of m.files) if (f.status === 'stored') used.add(f.sha256);
  return [...blobs].filter((b) => !used.has(b));
}
