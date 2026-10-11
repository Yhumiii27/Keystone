import 'server-only';
// Health check of a server instance (R-009) for the hosting platform's probes — GET /api/health:
// the database answers a query within HEALTH_TIMEOUT_MS and its schema is up to date (no pending migration). The report
// carries no detail an outsider could use (no host, driver, version or error text); the cause of a failure is logged.
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { pendingMigrations } from '@/server/db/migrations';
import { logError } from '@/server/log';

/** Longest wait for the database before the instance is reported unavailable. */
export const HEALTH_TIMEOUT_MS = 5000;

export interface HealthReport {
  status: 'ok' | 'unavailable';
  checks: {
    database: { status: 'ok' | 'error' | 'timeout' | 'migrations_pending'; latencyMs: number; pendingMigrations?: number };
  };
  /** ISO instant of the check. */
  time: string;
}

class HealthTimeout extends Error {}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new HealthTimeout('timeout')), ms)))]).finally(() => clearTimeout(timer));
}

export async function checkHealth(opts: { timeoutMs?: number; now?: () => number } = {}): Promise<HealthReport> {
  const now = opts.now ?? (() => performance.now());
  const started = now();
  const done = (status: HealthReport['checks']['database']['status'], extra: { pendingMigrations?: number } = {}): HealthReport => ({
    status: status === 'ok' ? 'ok' : 'unavailable',
    checks: { database: { status, latencyMs: Math.round(now() - started), ...extra } },
    time: new Date().toISOString(),
  });
  try {
    const pending = await within(
      (async () => {
        const db = await getDb();
        await db.execute(sql`select 1`);
        return (await pendingMigrations(db)).length;
      })(),
      opts.timeoutMs ?? HEALTH_TIMEOUT_MS,
    );
    return pending ? done('migrations_pending', { pendingMigrations: pending }) : done('ok');
  } catch (e) {
    if (e instanceof HealthTimeout) {
      logError('Health check', new Error(`The database did not answer within ${opts.timeoutMs ?? HEALTH_TIMEOUT_MS} ms`), { component: 'health' });
      return done('timeout');
    }
    logError('Health check', e, { component: 'health' });
    return done('error');
  }
}
