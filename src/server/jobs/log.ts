// Log lines of the scheduled jobs (R-006), written by the server logger (R-009, src/server/log): one record per event with
// the job name, the holder and the outcome — JSON on stdout (info) or stderr (warn, error) in production, so the hosting
// platform collects them with the server's logs; secrets are scrubbed and logging never throws.
import { log } from '@/server/log';

export type JobLogLevel = 'info' | 'warn' | 'error';

export type JobLogFields = Record<string, string | number | boolean | null | undefined>;

const jobs = log.child({ component: 'jobs' });

/** Writes one record; never throws. */
export function jobLog(level: JobLogLevel, msg: string, fields: JobLogFields = {}): void {
  jobs[level](msg, fields);
}

/** Message of a caught error, single line and bounded. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 500);
