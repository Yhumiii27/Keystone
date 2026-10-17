// Timer loop of the scheduled jobs (R-006): each entry runs after its first delay, then again `everyMs` after the end of its
// previous run (a slow run never overlaps itself in one process; leases keep other processes out). `stop()` cancels the
// timers and waits for the runs in progress. No server-only import: the loop only calls the `run` it is given.
//
// A reminder entry (`dailyAt`, HH:MM Europe/Paris — owner's answer of 17 Oct 2026 to R-121) runs once a day at that hour
// instead: at start, after its first delay when today's hour has passed (the missed run; the runner's lease skips it when the
// day's run already happened, so a restart never sends twice), else at today's hour; after each run, at the next day's hour —
// recomputed from the real instant each time, so a DST change or a long run never shifts it. The business clock pins only the
// date (KEYSTONE_CLOCK), never the time of day: the real instant gives the same hour.
import { dailyDelayMs } from '@/domain/jobs';

export interface ScheduledEntry {
  name: string;
  everyMs: number;
  firstDelayMs: number;
  /** Reminder job: once a day at this Paris time (HH:MM) instead of every `everyMs`. */
  dailyAt?: string | null;
  run: () => Promise<unknown>;
}

export interface Scheduler {
  /** Cancels every timer and resolves when the runs in progress are over. */
  stop: () => Promise<void>;
}

/** Delay of an entry's next timer: at start (`first`) or after a run. */
const nextDelay = (e: ScheduledEntry, first: ScheduledEntry | null) =>
  e.dailyAt ? dailyDelayMs(new Date(), e.dailyAt, first) : first ? e.firstDelayMs : e.everyMs;

/**
 * Starts the loop. `keepAlive: false` lets the process exit while only these timers are pending (the web server's
 * in-process scheduler); the worker keeps them alive.
 */
export function startScheduler(entries: readonly ScheduledEntry[], opts: { keepAlive?: boolean } = {}): Scheduler {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const running = new Set<Promise<unknown>>();
  const schedule = (e: ScheduledEntry, delay: number) => {
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopped) return;
      const p = e.run().catch(() => null).finally(() => {
        running.delete(p);
        schedule(e, nextDelay(e, null));
      });
      running.add(p);
    }, delay);
    if (opts.keepAlive === false) timer.unref?.();
    timers.add(timer);
  };
  for (const e of entries) schedule(e, nextDelay(e, e));
  return {
    stop: async () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await Promise.all([...running]);
    },
  };
}
