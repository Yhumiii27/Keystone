// Log lines of the scheduled jobs (R-006): one JSON object per line on stdout (info) or stderr (warn, error), with the job
// name, the holder and the outcome, so the hosting platform collects them with the server's logs. When the structured logger
// of R-009 (src/server/log) is merged, these lines go through it instead (same fields).

export type JobLogLevel = 'info' | 'warn' | 'error';

export type JobLogFields = Record<string, string | number | boolean | null | undefined>;

/** Writes one line; never throws. `sink` is for tests. */
export function jobLog(level: JobLogLevel, msg: string, fields: JobLogFields = {}, sink: (line: string) => void = level === 'info' ? console.log : console.error): void {
  try {
    sink(JSON.stringify({ time: new Date().toISOString(), level, msg, component: 'jobs', ...fields }));
  } catch {
    // nothing left to do
  }
}

/** Message of a caught error, single line and bounded. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 500);
