// R-004 (I-1b: RPO ≤ 15 min, RTO ≤ 4 h) — the pure backup rules: retention syntax, snapshot names, when a snapshot is due
// (the job's 5-minute tick against the 10-minute interval), when the last good one is stale, which snapshots the retention
// removes (48 h, then daily for 30 days, then monthly for 12 months — stable from one run to the next), and the content-store
// garbage collection by reference.
import { describe, expect, it } from 'vitest';
import {
  BACKUP_DEFAULTS, backupDue, backupStale, backupsToPrune, blobsToCollect, parseBackupRetention, parseSnapshotStamp, retentionText, snapshotStamp, type SnapshotRef,
} from './backup';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-12T12:00:00.000Z');

describe('settings', () => {
  it('defaults: every 10 min (under the 15-min RPO), 48h,30d,12m, stale after 30 min', () => {
    expect([BACKUP_DEFAULTS.everyMin, retentionText(BACKUP_DEFAULTS.retention), BACKUP_DEFAULTS.staleAfterMin, BACKUP_DEFAULTS.rpoMin]).toEqual([10, '48h,30d,12m', 30, 15]);
    expect(BACKUP_DEFAULTS.everyMin + BACKUP_DEFAULTS.tickMin / 2).toBeLessThan(BACKUP_DEFAULTS.rpoMin);
  });

  it('parses the retention; refuses malformed or out-of-range values', () => {
    expect(parseBackupRetention('48h,30d,12m')).toEqual({ allHours: 48, dailyDays: 30, monthlyMonths: 12 });
    expect(parseBackupRetention(' 24H , 7D , 0M ')).toEqual({ allHours: 24, dailyDays: 7, monthlyMonths: 0 });
    for (const bad of ['', '48h', '48h,30d', '0h,30d,12m', '48h,30d,12', '48 hours', '999h,1d,1m', '48h,400d,1m', '48h,30d,121m', 'h,d,m']) expect(parseBackupRetention(bad)).toBeNull();
  });

  it('snapshot names are UTC, sortable and parsed back; other names are not snapshots', () => {
    const at = new Date('2026-10-12T08:05:09.007Z');
    expect(snapshotStamp(at)).toBe('20261012T080509007Z');
    expect(parseSnapshotStamp('20261012T080509007Z')?.toISOString()).toBe(at.toISOString());
    for (const n of ['content', '20261012T080509007Z.partial', '20261312T080509007Z', 'backup.lock', '20261012T080509Z']) expect(parseSnapshotStamp(n)).toBeNull();
    expect([snapshotStamp(new Date('2026-01-02T00:00:00Z')), snapshotStamp(new Date('2025-12-31T23:59:59.999Z'))].sort()[0]).toBe('20251231T235959999Z');
  });
});

describe('scheduling', () => {
  const every = 10 * MIN;
  const tick = 5 * MIN;
  it('a snapshot is due with none yet, then every second 5-minute tick for a 10-minute interval', () => {
    expect(backupDue(null, NOW, every, tick)).toBe(true);
    const last = new Date(NOW.getTime() - 5 * MIN);
    expect(backupDue(last, NOW, every, tick)).toBe(false);
    expect(backupDue(new Date(NOW.getTime() - 7.5 * MIN), NOW, every, tick)).toBe(true);
    expect(backupDue(new Date(NOW.getTime() - 10 * MIN - 2_000), NOW, every, tick)).toBe(true);
  });

  it('simulated ticks with drift: snapshots never more than interval + half a tick apart', () => {
    let t = NOW.getTime();
    let last: number | null = null;
    const gaps: number[] = [];
    for (let i = 0; i < 100; i++) {
      if (backupDue(last == null ? null : new Date(last), new Date(t), every, tick)) {
        if (last != null) gaps.push(t - last);
        last = t;
      }
      t += tick + 3_000; // the run time and the timer drift
    }
    expect(Math.max(...gaps)).toBeLessThanOrEqual(every + tick / 2 + 6_000);
    expect(Math.max(...gaps) / MIN).toBeLessThan(BACKUP_DEFAULTS.rpoMin);
  });

  it('stale: none, or older than the threshold', () => {
    expect(backupStale(null, NOW)).toBe(true);
    expect(backupStale(new Date(NOW.getTime() - 29 * MIN), NOW)).toBe(false);
    expect(backupStale(new Date(NOW.getTime() - 31 * MIN), NOW)).toBe(true);
    expect(backupStale(new Date(NOW.getTime() - 50 * MIN), NOW, 60 * MIN)).toBe(false);
  });
});

describe('retention', () => {
  const R = { allHours: 48, dailyDays: 30, monthlyMonths: 12 };
  const snap = (at: Date): SnapshotRef => ({ name: snapshotStamp(at), at });
  /** One snapshot every `stepMin` minutes over `days` days up to `now`. */
  const series = (days: number, stepMin: number, now = NOW) => {
    const out: SnapshotRef[] = [];
    for (let t = now.getTime() - days * DAY; t <= now.getTime(); t += stepMin * MIN) out.push(snap(new Date(t)));
    return out;
  };

  it('keeps everything within 48 h, the newest of each day for 30 days, the newest of each month for 12 months', () => {
    const all = series(400, 6 * 60); // every 6 hours over 400 days
    const pruned = new Set(backupsToPrune(all, NOW, R).map((s) => s.name));
    const kept = all.filter((s) => !pruned.has(s.name));
    const recent = kept.filter((s) => NOW.getTime() - s.at.getTime() < 48 * HOUR);
    expect(recent.length).toBe(all.filter((s) => NOW.getTime() - s.at.getTime() < 48 * HOUR).length);
    const daily = kept.filter((s) => NOW.getTime() - s.at.getTime() > 48 * HOUR && NOW.getTime() - s.at.getTime() < 30 * DAY);
    expect(new Set(daily.map((s) => s.at.toISOString().slice(0, 10))).size).toBe(daily.length);
    expect(daily.every((s) => s.at.getUTCHours() === 18)).toBe(true); // the newest of its day
    const monthly = kept.filter((s) => NOW.getTime() - s.at.getTime() >= 30 * DAY);
    expect(new Set(monthly.map((s) => s.at.toISOString().slice(0, 7))).size).toBe(monthly.length);
    expect(monthly.length).toBeLessThanOrEqual(12);
    expect(kept.some((s) => s.at < new Date('2025-10-01T00:00:00Z'))).toBe(false);
    // The 10-minute default over 48 h: 288 snapshots, all kept.
    expect(backupsToPrune(series(2, 10).slice(1), NOW, R)).toEqual([]);
  });

  it('is stable: pruning again later only removes what has aged out, never a day or month representative still in its window', () => {
    let kept = series(60, 60);
    let now = NOW;
    for (let day = 0; day < 40; day++) {
      const next = new Date(now.getTime() + DAY);
      kept = [...kept, ...series(1, 60, next).filter((s) => s.at > now)];
      now = next;
      const pruned = new Set(backupsToPrune(kept, now, R).map((s) => s.name));
      kept = kept.filter((s) => !pruned.has(s.name));
      // Every day of the last 30 still has its snapshot.
      for (let d = 3; d < 30; d++) {
        const key = new Date(now.getTime() - d * DAY).toISOString().slice(0, 10);
        expect(kept.some((s) => s.at.toISOString().slice(0, 10) === key)).toBe(true);
      }
    }
  });

  it('always keeps the newest snapshot, even beyond every window; nothing to prune on an empty folder', () => {
    const old = snap(new Date('2024-01-01T00:00:00Z'));
    expect(backupsToPrune([old], NOW, R)).toEqual([]);
    expect(backupsToPrune([snap(new Date('2023-06-01T00:00:00Z')), old], NOW, R).map((s) => s.name)).toEqual([snapshotStamp(new Date('2023-06-01T00:00:00Z'))]);
    expect(backupsToPrune([], NOW, R)).toEqual([]);
  });
});

describe('content-store garbage collection', () => {
  it('collects the blobs no kept manifest stores (missing / mismatch entries do not keep a blob)', () => {
    const m1 = { files: [{ sha256: 'a', status: 'stored' }, { sha256: 'b', status: 'stored' }] };
    const m2 = { files: [{ sha256: 'b', status: 'stored' }, { sha256: 'c', status: 'missing' }, { sha256: 'd', status: 'mismatch' }] };
    expect(blobsToCollect(['a', 'b', 'c', 'd', 'e'], [m1, m2])).toEqual(['c', 'd', 'e']);
    expect(blobsToCollect(['a', 'b'], [m2])).toEqual(['a']);
    expect(blobsToCollect(new Set(['x']), [])).toEqual(['x']);
  });
});
