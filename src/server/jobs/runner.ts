import 'server-only';
// One run of a scheduled job (R-006): take its lease (src/server/dal/job-locks.ts), run it, record the outcome, log one line.
// A job whose lease another worker holds — or that another worker started less than ~one interval ago — is skipped.
// A failure is caught, logged and recorded: it never stops the worker; the job runs again at its next turn.
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { minGapMs } from '@/domain/jobs';
import { acquireJobLock, releaseJobLock } from '@/server/dal/job-locks';
import type { JobDefinition } from './definitions';
import { errorText, jobLog } from './log';

export type JobRunResult =
  | { status: 'ok'; summary: string; durationMs: number }
  | { status: 'failed'; error: string; durationMs: number }
  | { status: 'skipped' };

/** Identity of a worker in the leases and the log: "worker@host:pid:1a2b". */
export const holderId = (kind: 'worker' | 'server') => `${kind}@${os.hostname()}:${process.pid}:${randomBytes(2).toString('hex')}`;

/** Runs `job` once if its lease is free. `force` (a manual `--once` run) ignores the gap since its last start. */
export async function runJob(job: JobDefinition, holder: string, opts: { force?: boolean } = {}): Promise<JobRunResult> {
  let acquired: boolean;
  try {
    acquired = await acquireJobLock(job.name, holder, job.leaseMs, opts.force ? 0 : minGapMs(job));
  } catch (e) {
    jobLog('error', 'Job lease failed', { job: job.name, holder, error: errorText(e) });
    return { status: 'failed', error: errorText(e), durationMs: 0 };
  }
  if (!acquired) {
    jobLog('info', 'Job skipped', { job: job.name, holder, reason: 'running elsewhere or ran recently' });
    return { status: 'skipped' };
  }
  const started = Date.now();
  jobLog('info', 'Job started', { job: job.name, holder });
  try {
    const out = await job.run();
    const durationMs = Date.now() - started;
    await releaseJobLock(job.name, holder, { ok: true, summary: out.summary });
    jobLog(out.warn ? 'warn' : 'info', 'Job finished', { job: job.name, holder, durationMs, summary: out.summary, ...out.counts });
    return { status: 'ok', summary: out.summary, durationMs };
  } catch (e) {
    const durationMs = Date.now() - started;
    const error = errorText(e);
    await releaseJobLock(job.name, holder, { ok: false, error }).catch((r) => jobLog('error', 'Job lease release failed', { job: job.name, holder, error: errorText(r) }));
    jobLog('error', 'Job failed', { job: job.name, holder, durationMs, error });
    return { status: 'failed', error, durationMs };
  }
}
