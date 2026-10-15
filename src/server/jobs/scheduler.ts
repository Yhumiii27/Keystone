// Timer loop of the scheduled jobs (R-006): each entry runs after its first delay, then again `everyMs` after the end of its
// previous run (a slow run never overlaps itself in one process; leases keep other processes out). `stop()` cancels the
// timers and waits for the runs in progress. No server-only import: the loop only calls the `run` it is given.

export interface ScheduledEntry {
  name: string;
  everyMs: number;
  firstDelayMs: number;
  run: () => Promise<unknown>;
}

export interface Scheduler {
  /** Cancels every timer and resolves when the runs in progress are over. */
  stop: () => Promise<void>;
}

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
        schedule(e, e.everyMs);
      });
      running.add(p);
    }, delay);
    if (opts.keepAlive === false) timer.unref?.();
    timers.add(timer);
  };
  for (const e of entries) schedule(e, e.firstDelayMs);
  return {
    stop: async () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await Promise.all([...running]);
    },
  };
}
