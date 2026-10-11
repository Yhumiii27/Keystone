// R-006 — the worker's timer loop and command line: staggered first runs, the next run counted from the end of the previous
// one (never overlapping), stop() waiting for the runs in progress; options and the database guard of `npm run worker`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobsInProcess, parseWorkerArgs, workerDatabaseGuard } from './cli';
import { startScheduler } from './scheduler';

describe('scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first run after its delay, then every interval after the end of the previous run', async () => {
    const runs: [string, number][] = [];
    let release: (() => void) | null = null;
    const slow = vi.fn(() => new Promise<void>((r) => (release = r)));
    const s = startScheduler([
      { name: 'a', everyMs: 1000, firstDelayMs: 100, run: async () => void runs.push(['a', Date.now()]) },
      { name: 'b', everyMs: 1000, firstDelayMs: 200, run: slow },
    ]);
    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(99);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toEqual([['a', t0 + 100]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(slow).toHaveBeenCalledTimes(1);
    // b's run lasts 5 s: no second run meanwhile, the next one comes 1 s after it ends.
    await vi.advanceTimersByTimeAsync(5000);
    expect(slow).toHaveBeenCalledTimes(1);
    release!();
    await vi.advanceTimersByTimeAsync(999);
    expect(slow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(slow).toHaveBeenCalledTimes(2);
    expect(runs.map(([, at]) => at - t0)).toEqual([100, 1100, 2100, 3100, 4100, 5100, 6100]);
    // b's second run is in progress: stop() waits for it.
    const stopping = s.stop();
    release!();
    await stopping;
  });

  it('a failing run does not stop the loop', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const s = startScheduler([{ name: 'x', everyMs: 50, firstDelayMs: 0, run }]);
    await vi.advanceTimersByTimeAsync(120);
    expect(run).toHaveBeenCalledTimes(3);
    await s.stop();
  });

  it('stop() cancels the timers and waits for the run in progress', async () => {
    let release: (() => void) | null = null;
    let done = false;
    const run = vi.fn(() => new Promise<void>((r) => (release = () => { done = true; r(); })));
    const s = startScheduler([{ name: 'x', everyMs: 10, firstDelayMs: 0, run }], { keepAlive: false });
    await vi.advanceTimersByTimeAsync(1);
    let stopped = false;
    const p = s.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(stopped).toBe(false);
    release!();
    await p;
    expect([stopped, done, run.mock.calls.length]).toEqual([true, true, 1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('npm run worker', () => {
  it('options: --once, --job <name> (repeatable, deduplicated); anything else refused', () => {
    expect(parseWorkerArgs([])).toEqual({ ok: true, args: { once: false, jobs: [] } });
    expect(parseWorkerArgs(['--once', '--job', 'plan-trash-purge', '--job', 'vigie-outbox', '--job', 'plan-trash-purge']))
      .toEqual({ ok: true, args: { once: true, jobs: ['plan-trash-purge', 'vigie-outbox'] } });
    expect(parseWorkerArgs(['--job', 'friday-freeze'])).toEqual({ ok: false, error: 'Unknown job friday-freeze' });
    expect(parseWorkerArgs(['--job'])).toEqual({ ok: false, error: 'Unknown job (missing)' });
    expect(parseWorkerArgs(['--every', '5'])).toEqual({ ok: false, error: 'Unknown option --every' });
  });

  it('PostgreSQL: always; PGlite (one process only): only when the operator says the server is stopped', () => {
    expect(workerDatabaseGuard({ DATABASE_URL: 'postgres://keystone@db/keystone' })).toEqual({ ok: true, driver: 'postgres' });
    expect(workerDatabaseGuard({ KEYSTONE_WORKER_PGLITE: 'exclusive' })).toEqual({ ok: true, driver: 'pglite' });
    const refused = workerDatabaseGuard({ DATABASE_URL: ' ', KEYSTONE_WORKER_PGLITE: 'yes' });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/KEYSTONE_JOBS=inprocess/);
  });

  it('KEYSTONE_JOBS=inprocess runs the jobs inside the web server; off by default', () => {
    expect([jobsInProcess({ KEYSTONE_JOBS: 'inprocess' }), jobsInProcess({}), jobsInProcess({ KEYSTONE_JOBS: 'worker' })]).toEqual([true, false, false]);
  });
});
