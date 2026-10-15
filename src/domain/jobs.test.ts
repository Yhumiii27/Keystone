// R-006 — scheduled-job rules: the jobs and their intervals, the gap between two scheduled runs, what the plan-trash purge
// and the orphan-file prune remove.
import { describe, expect, it } from 'vitest';
import { JOB_NAMES, JOB_SCHEDULES, ORPHAN_FILE_GRACE_MS, isJobName, minGapMs, orphanFilesToPrune, trashEntriesToPurge } from './jobs';

const day = 86_400_000;
const NOW = new Date('2026-10-11T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * day);

describe('jobs and schedules', () => {
  it('five jobs: outboxes (Vigie, Cursus, Codex — R-124) every 5 min, plan-trash purge hourly, orphan prune daily (no Friday freeze: S-4 open)', () => {
    expect(JOB_SCHEDULES.map((j) => [j.name, j.everyMs / 60_000, j.leaseMs / 60_000])).toEqual([
      ['vigie-outbox', 5, 15], ['cursus-outbox', 5, 15], ['codex-outbox', 5, 15], ['plan-trash-purge', 60, 15], ['orphan-files-prune', 1440, 60],
      // Delivery 8 · platform-ops: backups wake every 5 min (a snapshot when due, R-004); antivirus rescan daily (R-175).
      ['backup', 5, 180], ['files-rescan', 1440, 360],
    ]);
    expect(JOB_NAMES).not.toContain('friday-freeze');
    // Staggered first runs.
    expect(new Set(JOB_SCHEDULES.map((j) => j.firstDelayMs)).size).toBe(JOB_SCHEDULES.length);
    expect([isJobName('plan-trash-purge'), isJobName('nope'), isJobName(undefined)]).toEqual([true, false, false]);
    expect(ORPHAN_FILE_GRACE_MS).toBe(day);
  });

  it('a scheduled run waits ~90 % of the interval since the last start (whatever worker started it)', () => {
    expect(minGapMs({ everyMs: 300_000 })).toBe(270_000);
    expect(minGapMs({ everyMs: 1000 })).toBe(900);
  });
});

describe('plan-trash purge', () => {
  const e = (id: string, days: number) => ({ id, deletedAt: ago(days) });

  it('purges entries older than the retention, and beyond the newest `keep`', () => {
    const entries = [e('a', 1), e('b', 31), e('c', 29.9), e('d', 2)];
    expect(trashEntriesToPurge(entries, NOW, 30, 20).map((x) => x.id)).toEqual(['b']);
    expect(trashEntriesToPurge(entries, NOW, 30, 2).map((x) => x.id)).toEqual(['b', 'c']);
    // A removal keeps room for its own entry (keep = max − 1); keep 0 purges everything.
    expect(trashEntriesToPurge(entries, NOW, 30, 0).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(trashEntriesToPurge([], NOW, 30, 20)).toEqual([]);
  });

  it('is idempotent: what is left is not purged again', () => {
    const entries = Array.from({ length: 25 }, (_, i) => e(`t${i}`, i * 0.5));
    const gone = trashEntriesToPurge(entries, NOW, 30, 20);
    expect(gone.map((x) => x.id)).toEqual(['t20', 't21', 't22', 't23', 't24']);
    const left = entries.filter((x) => !gone.includes(x));
    expect(trashEntriesToPurge(left, NOW, 30, 20)).toEqual([]);
  });
});

describe('orphan-file prune', () => {
  it('only files without a record, older than the grace period', () => {
    const now = NOW.getTime();
    const files = [
      { rel: '2026/10/a.pdf', mtimeMs: now - 2 * day },
      { rel: '2026/10/b.pdf', mtimeMs: now - 2 * day },
      { rel: '2026/10/c.pdf.part', mtimeMs: now - 60_000 },
      { rel: '2026/10/d.pdf', mtimeMs: now - day },
    ];
    expect(orphanFilesToPrune(files, new Set(['2026/10/a.pdf']), now, day).map((f) => f.rel)).toEqual(['2026/10/b.pdf', '2026/10/d.pdf']);
    expect(orphanFilesToPrune(files, new Set(), now, 0).map((f) => f.rel)).toEqual(['2026/10/a.pdf', '2026/10/b.pdf', '2026/10/c.pdf.part', '2026/10/d.pdf']);
  });
});
