import 'server-only';
// Concurrent writes (R-010). Every DAL writer runs its checks and writes in one `db.transaction()`. With several users (and
// several server instances on PostgreSQL) two transactions may read the same state and both write — two "max + 1" numbers,
// two approvals of the same request, a second BL1. Keystone runs every transaction SERIALIZABLE: PostgreSQL aborts one of
// two transactions whose reads and writes overlap (SQLSTATE 40001, or 40P01 for a deadlock) and the transaction is run
// again from the start on fresh data, up to TX_RETRY.attempts times. On PGlite transactions already run one at a time;
// the same setting applies so both drivers behave alike. On a PostgreSQL server, transactions also take Keystone's write
// lock first and run one at a time (withWriteLockedTransactions below, shared EPC2I server).
//
// Consequence for writers: a transaction callback may run more than once. It must only touch the database through `tx`
// (no HTTP call, no e-mail) and must not accumulate into variables declared outside the callback without resetting them.
// Files stored inside a transaction (src/server/storage/files.ts) are safe: a rolled-back attempt leaves an orphan file
// that pruneOrphanFiles() removes.
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { log } from '@/server/log';
import type { DB } from './types';
import { bumpWriteGeneration } from './write-generation';

/** R-017: a transaction that committed moves the write generation (its writes are visible now: src/server/cache/read-cache.ts). */
const committed = <T,>(p: Promise<T>): Promise<T> => p.then((v) => {
  bumpWriteGeneration();
  return v;
});

export const TX_RETRY = {
  /** Runs of one transaction (first try included). */
  attempts: 6,
  /** Back-off before the n-th retry: random in [0, min(maxDelayMs, baseDelayMs × 2^n)]. */
  baseDelayMs: 10,
  maxDelayMs: 400,
} as const;

/** serialization_failure, deadlock_detected. */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

/** SQLSTATE of a database error, looking through Drizzle's DrizzleQueryError and `cause` chains; null when none. */
export function sqlStateOf(e: unknown): string | null {
  let cur: unknown = e;
  for (let depth = 0; cur && typeof cur === 'object' && depth < 6; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** True for the errors after which a transaction is run again (serialization failure, deadlock). */
export const isRetryableTransactionError = (e: unknown) => RETRYABLE_SQLSTATES.has(sqlStateOf(e) ?? '');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `attempt` until it succeeds, retrying the retryable errors with a jittered exponential back-off. */
export async function runWithRetry<T>(
  attempt: (n: number) => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? TX_RETRY.attempts;
  const wait = opts.wait ?? sleep;
  for (let n = 1; ; n++) {
    try {
      return await attempt(n);
    } catch (e) {
      if (n >= attempts || !isRetryableTransactionError(e)) throw e;
      const cap = Math.min(opts.maxDelayMs ?? TX_RETRY.maxDelayMs, (opts.baseDelayMs ?? TX_RETRY.baseDelayMs) * 2 ** n);
      log.debug('Transaction retried after a concurrent write', { attempt: n, sqlState: sqlStateOf(e) });
      await wait(Math.random() * cap);
    }
  }
}

const WRAPPED = Symbol.for('keystone.serializableTransactions');

/**
 * Makes every `db.transaction()` of this handle SERIALIZABLE (unless the caller asks for another isolation level) and
 * re-runs it after a serialization failure or a deadlock. Nested `tx.transaction()` (savepoints) are not affected.
 */
export function withSerializableTransactions<D extends DB>(db: D): D {
  const holder = db as D & { [WRAPPED]?: true };
  if (holder[WRAPPED]) return db;
  const original: DB['transaction'] = db.transaction.bind(db);
  const transaction: DB['transaction'] = (cb, config?: PgTransactionConfig) => committed(runWithRetry(() => original(cb, { isolationLevel: 'serializable', ...config })));
  Object.defineProperty(db, 'transaction', { value: transaction, configurable: true, writable: true });
  Object.defineProperty(db, WRAPPED, { value: true });
  return db;
}

const inWriteLock = new AsyncLocalStorage<true>();

/**
 * PostgreSQL server (shared EPC2I server, plan § 4.5 in Matrix): every `db.transaction()` of this handle first takes Keystone's
 * write lock — pg_advisory_xact_lock(hashtext(lockName)), released at commit or rollback — so Keystone's transactions run one
 * after the other, as on PGlite, while plain reads stay parallel. Why on top of R-010: SERIALIZABLE + retry keeps the numbers
 * right, but many simultaneous writers of the same "max + 1" (20 project creations at once on the test server) exhaust the
 * retries and some fail with a serialization error; behind the lock none fails.
 * The transaction runs READ COMMITTED (unless the caller asks for another level): under SERIALIZABLE the snapshot would be taken
 * by the lock statement itself, before the wait, and the transaction would then read the state from before the previous
 * holder's commit. Behind the lock the transactions are executed serially, which is at least as strong. A deadlock is still
 * retried (runWithRetry). A top-level transaction opened inside the callback of another one (same async context) does not
 * wait for the lock its caller holds.
 */
export function withWriteLockedTransactions<D extends DB>(db: D, lockName: string): D {
  const holder = db as D & { [WRAPPED]?: true };
  if (holder[WRAPPED]) return db;
  const original: DB['transaction'] = db.transaction.bind(db);
  const lock = sql`select pg_advisory_xact_lock(hashtext(${lockName}))`;
  const transaction: DB['transaction'] = (cb, config?: PgTransactionConfig) => {
    if (inWriteLock.getStore()) return committed(runWithRetry(() => original(cb, { isolationLevel: 'read committed', ...config })));
    return committed(runWithRetry(() =>
      original(async (tx) => {
        await tx.execute(lock);
        return inWriteLock.run(true, () => cb(tx));
      }, { isolationLevel: 'read committed', ...config }),
    ));
  };
  Object.defineProperty(db, 'transaction', { value: transaction, configurable: true, writable: true });
  Object.defineProperty(db, WRAPPED, { value: true });
  return db;
}
