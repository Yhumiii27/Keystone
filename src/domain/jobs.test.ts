// R-006 — scheduled-job rules: the jobs and their intervals, the gap between two scheduled runs, what the plan-trash purge
// and the orphan-file prune remove.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDERS_AT, JOB_NAMES, NIGHT_JOBS_AT, JOB_SCHEDULES, ORPHAN_FILE_GRACE_MS, dailyDelayMs, dailySlotOn, isJobName, minGapMs, nextDailySlot, orphanFilesToPrune,
  parseTimeOfDay, passedDailySlot, trashEntriesToPurge,
} from './jobs';

const day = 86_400_000;
const NOW = new Date('2026-10-11T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * day);

describe('jobs and schedules', () => {
  it('the jobs: outboxes (Vigie, Cursus, Codex — R-124) every 5 min, plan-trash purge hourly, orphan prune daily, Codex index read hourly (R-033; no Friday freeze: S-4 open)', () => {
    expect(JOB_SCHEDULES.map((j) => [j.name, j.everyMs / 60_000, j.leaseMs / 60_000])).toEqual([
      ['vigie-outbox', 5, 15], ['cursus-outbox', 5, 15], ['codex-outbox', 5, 15], ['plan-trash-purge', 60, 15], ['orphan-files-prune', 1440, 60],
      // Delivery 8 · platform-ops: backups wake every 5 min (a snapshot when due, R-004); antivirus rescan daily (R-175).
      ['backup', 5, 180], ['files-rescan', 1440, 360],
      // Delivery 8 · connectors: Cursus staff directory (R-027) and events inbox purge (R-029), daily.
      ['cursus-directory', 1440, 60], ['cursus-events-purge', 1440, 15],
      // Delivery 8 (R-033): Codex's index read by the HTTP connector, hourly (interval to confirm).
      ['codex-index', 60, 15],
      // Delivery 9 (R-121, D-4 'a'): client prerequisites late at J-15, daily — at the reminders hour (owner, 17 Oct 2026).
      ['site-prerequisite-alerts', 1440, 15],
      // Delivery 9 (R-084, owner answer 17 Oct 2026, third round, B): activities without any declared resource, daily.
      ['undeclared-resource-alerts', 1440, 15],
      // Delivery 9 (R-180): Keystone's planned tasks sent to Cursus as one snapshot, once a night.
      ['cursus-tasks', 1440, 15],
      // Delivery 9 (R-189, Arche K-04): progress and SPI kept for pub_avancement_projets, hourly.
      ['share-progress', 60, 15],
      // Delivery 9 (R-187, Arche K-02): Arche's machine needs read into the capex mirror, every 15 minutes.
      ['capex-needs', 15, 10],
      // Delivery 9 (Matrix D21): the group's subsidiaries read from matrix.pub_filiales, hourly.
      ['matrix-subsidiaries', 60, 10],
    ]);
    expect(JOB_SCHEDULES.filter((j) => j.daily === 'night').map((j) => j.name)).toEqual(['cursus-tasks']);
    expect(NIGHT_JOBS_AT).toBe('02:00');
    // Owner's answer of 17 Oct 2026 (R-121): the jobs that send reminders to people run in the morning; technical jobs keep
    // their intervals.
    expect(JOB_SCHEDULES.filter((j) => j.daily === 'reminders').map((j) => j.name)).toEqual(['site-prerequisite-alerts', 'undeclared-resource-alerts']);
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

// Owner's answer of 17 Oct 2026 to R-121: « Les alertes automatiques de rappel doivent arriver le matin » — reminder jobs run
// once a day at the reminders hour, Europe/Paris (default 07:00), whatever the time the worker started.
describe('reminders hour (daily at HH:MM, Europe/Paris)', () => {
  const utc = (s: string) => new Date(s);
  const H = 3_600_000;

  it('07:00 by default; HH:MM parsed and normalised', () => {
    expect(DEFAULT_REMINDERS_AT).toBe('07:00');
    expect(['7:00', '07:00', '23:59', '00:00', '24:00', '7:60', '7h', ''].map(parseTimeOfDay)).toEqual(['07:00', '07:00', '23:59', '00:00', null, null, null, null]);
  });

  it('07:00 Paris is 05:00 UTC in summer time, 06:00 UTC in winter time — including the days the clocks change', () => {
    expect(dailySlotOn('2026-10-17', '07:00').toISOString()).toBe('2026-10-17T05:00:00.000Z');
    expect(dailySlotOn('2026-10-25', '07:00').toISOString()).toBe('2026-10-25T06:00:00.000Z'); // back to CET at 03:00
    expect(dailySlotOn('2026-12-15', '07:00').toISOString()).toBe('2026-12-15T06:00:00.000Z');
    expect(dailySlotOn('2027-03-28', '07:00').toISOString()).toBe('2027-03-28T05:00:00.000Z'); // CEST from 02:00
  });

  it('next run: today’s slot while ahead, else tomorrow’s; across the DST change the gap is 25 h / 23 h, the hour stays 07:00', () => {
    expect(nextDailySlot(utc('2026-10-17T04:59:00Z'), '07:00').toISOString()).toBe('2026-10-17T05:00:00.000Z');
    expect(nextDailySlot(utc('2026-10-17T05:00:00Z'), '07:00').toISOString()).toBe('2026-10-18T05:00:00.000Z');
    // Sat 24 Oct 07:00 CEST → Sun 25 Oct 07:00 CET: 25 hours.
    const sat = dailySlotOn('2026-10-24', '07:00');
    expect(nextDailySlot(sat, '07:00').getTime() - sat.getTime()).toBe(25 * H);
    // Sat 27 Mar 2027 07:00 CET → Sun 28 Mar 07:00 CEST: 23 hours.
    const mar = dailySlotOn('2027-03-27', '07:00');
    expect(nextDailySlot(mar, '07:00').getTime() - mar.getTime()).toBe(23 * H);
    // 23:30 Paris on 17 Oct → 18 Oct 07:00.
    expect(nextDailySlot(utc('2026-10-17T21:30:00Z'), '07:00').toISOString()).toBe('2026-10-18T05:00:00.000Z');
    // 00:30 Paris on 18 Oct (22:30 UTC on the 17th) → 18 Oct 07:00, not 19 Oct.
    expect(nextDailySlot(utc('2026-10-17T22:30:00Z'), '07:00').toISOString()).toBe('2026-10-18T05:00:00.000Z');
  });

  it('today’s owed run: none before the hour; the slot once it has passed (Paris date, not UTC)', () => {
    expect(passedDailySlot(utc('2026-10-17T04:59:59Z'), '07:00')).toBeNull();
    expect(passedDailySlot(utc('2026-10-17T05:00:00Z'), '07:00')!.toISOString()).toBe('2026-10-17T05:00:00.000Z');
    expect(passedDailySlot(utc('2026-10-17T21:30:00Z'), '07:00')!.toISOString()).toBe('2026-10-17T05:00:00.000Z');
    expect(passedDailySlot(utc('2026-10-17T22:30:00Z'), '07:00')).toBeNull(); // 00:30 Paris on the 18th
  });

  it('worker start: before the hour → waits for it; after → the missed run at once (first delay), the lease decides; after a run → the next day', () => {
    const first = { firstDelayMs: 50_000 };
    expect(dailyDelayMs(utc('2026-10-17T03:00:00Z'), '07:00', first)).toBe(2 * H); // 05:00 Paris → 07:00
    expect(dailyDelayMs(utc('2026-10-17T08:00:00Z'), '07:00', first)).toBe(50_000); // 10:00 Paris: today's run, if not done yet
    expect(dailyDelayMs(utc('2026-10-17T05:00:30Z'), '07:00', null)).toBe(24 * H - 30_000); // after the 07:00 run
    expect(dailyDelayMs(utc('2026-10-24T05:00:30Z'), '07:00', null)).toBe(25 * H - 30_000); // DST change overnight
    expect(dailyDelayMs(utc('2026-10-17T08:00:00Z'), '06:30', null)).toBe(20.5 * H); // KEYSTONE_REMINDERS_AT=06:30
  });
});
