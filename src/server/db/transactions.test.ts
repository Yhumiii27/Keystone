// R-010: every db.transaction() runs SERIALIZABLE and is run again after a serialization failure or a deadlock.
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { openDatabase } from './open';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { NUMBERING_CONSTRAINTS, TX_RETRY, constraintOf, isRetryableTransactionError, runWithRetry, sqlStateOf, withSerializableTransactions, withWriteLockedTransactions } from './transactions';
import type { DB } from './types';

const pgError = (code: string, message = 'pg error') => Object.assign(new Error(message), { code });
/** Drizzle wraps driver errors (DrizzleQueryError) and keeps the driver's error as `cause`. */
const drizzleError = (cause: Error) => Object.assign(new Error('Failed query: update …'), { cause });
const noWait = async () => {};

describe('sqlStateOf / isRetryableTransactionError', () => {
  it('finds the SQLSTATE on the error or in its cause chain', () => {
    expect(sqlStateOf(pgError('40001'))).toBe('40001');
    expect(sqlStateOf(drizzleError(pgError('40P01')))).toBe('40P01');
    expect(sqlStateOf(drizzleError(drizzleError(pgError('23505'))))).toBe('23505');
    expect(sqlStateOf(new Error('plain'))).toBeNull();
    expect(sqlStateOf(Object.assign(new Error('node'), { code: 'ECONNREFUSED' }))).toBeNull();
    expect(sqlStateOf(null)).toBeNull();
  });

  it('retries serialization failures, deadlocks and a business number taken meanwhile (another unique violation or a business error is final)', () => {
    expect(isRetryableTransactionError(drizzleError(pgError('40001')))).toBe(true);
    expect(isRetryableTransactionError(pgError('40P01'))).toBe(true);
    expect(isRetryableTransactionError(pgError('23505'))).toBe(false);
    expect(isRetryableTransactionError(new Error('CR-011 is not in review'))).toBe(false);
    // R-010: the numbering's unique constraints (the attempt is run again and draws the next number).
    const taken = (constraint: string) => drizzleError(Object.assign(pgError('23505'), { constraint }));
    expect(isRetryableTransactionError(taken('risks_project_id_number_unique'))).toBe(true);
    expect(isRetryableTransactionError(taken('tasks_number_unique'))).toBe(true);
    expect(isRetryableTransactionError(taken('projects_code_unique'))).toBe(false);
    expect(constraintOf(taken('tasks_number_unique'))).toBe('tasks_number_unique');
    expect(constraintOf(pgError('23505'))).toBeNull();
  });

  it('every numbering constraint exists in the schema (a renamed constraint would silently stop the retry)', async () => {
    const names = new Set<string>();
    for (const t of Object.values(await import('./schema')))
      if (t && typeof t === 'object' && Symbol.for('drizzle:IsDrizzleTable') in t)
        for (const cfg of [getTableConfig(t as PgTable)]) {
          for (const u of cfg.uniqueConstraints) { const n = u.getName(); if (n) names.add(n); }
          for (const c of cfg.columns) if (c.isUnique && c.uniqueName) names.add(c.uniqueName);
        }
    for (const c of NUMBERING_CONSTRAINTS) expect(names.has(c), c).toBe(true);
  });
});

describe('runWithRetry', () => {
  it('runs again after a serialization failure, then returns the result', async () => {
    let n = 0;
    const r = await runWithRetry(async (attempt) => {
      n++;
      if (attempt < 3) throw drizzleError(pgError('40001'));
      return 'R-21';
    }, { wait: noWait });
    expect([r, n]).toEqual(['R-21', 3]);
  });

  it('gives up after TX_RETRY.attempts and rethrows the last error', async () => {
    let n = 0;
    await expect(runWithRetry(async () => {
      n++;
      throw pgError('40001', `attempt ${n}`);
    }, { wait: noWait })).rejects.toThrow(`attempt ${TX_RETRY.attempts}`);
    expect(n).toBe(TX_RETRY.attempts);
  });

  it('never retries other errors', async () => {
    let n = 0;
    await expect(runWithRetry(async () => {
      n++;
      throw new Error('After BL1, a new baseline goes through a change request');
    }, { wait: noWait })).rejects.toThrow('After BL1');
    expect(n).toBe(1);
  });

  it('waits a jittered, bounded back-off between attempts', async () => {
    const waits: number[] = [];
    await runWithRetry(async (a) => {
      if (a < 4) throw pgError('40P01');
      return 1;
    }, { wait: async (ms) => void waits.push(ms), baseDelayMs: 10, maxDelayMs: 50 });
    expect(waits).toHaveLength(3);
    waits.forEach((w, i) => expect(w).toBeLessThanOrEqual(Math.min(50, 10 * 2 ** (i + 1))));
  });
});

describe('withSerializableTransactions (PGlite)', () => {
  let db: DB;
  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  it('runs transactions SERIALIZABLE unless the caller asks otherwise; savepoints still work', async () => {
    const level = async (tx: Pick<DB, 'execute'>) => ((await tx.execute(sql`show transaction_isolation`)).rows[0] as { transaction_isolation: string }).transaction_isolation;
    expect(await db.transaction((tx) => level(tx))).toBe('serializable');
    expect(await db.transaction((tx) => level(tx), { isolationLevel: 'read committed' })).toBe('read committed');
    expect(await db.transaction(async (tx) => tx.transaction((sp) => level(sp)))).toBe('serializable');
  });

  it('wraps a handle once', async () => {
    const t = db.transaction;
    expect(withSerializableTransactions(db).transaction).toBe(t);
  });

  it('re-runs the callback after a serialization failure; the first attempt is rolled back', async () => {
    await db.execute(sql`create table if not exists tx_retry_probe (n int)`);
    let runs = 0;
    await db.transaction(async (tx) => {
      runs++;
      await tx.execute(sql`insert into tx_retry_probe values (${runs})`);
      if (runs === 1) throw drizzleError(pgError('40001'));
    });
    expect(runs).toBe(2);
    expect((await db.execute(sql`select n from tx_retry_probe order by n`)).rows).toEqual([{ n: 2 }]);
  });
});

// Shared EPC2I server (plan § 4.5 in Matrix): the server handle takes Keystone's write lock in every transaction. Checked here
// on a bare PGlite (advisory locks are PostgreSQL's); the real concurrency is in postgres.integration.test.ts.
describe('withWriteLockedTransactions', () => {
  it('takes the write lock first and runs READ COMMITTED unless the caller asks otherwise', async () => {
    const db = withWriteLockedTransactions(drizzle(new PGlite()) as unknown as DB, 'keystone.ecritures');
    const state = async (tx: Pick<DB, 'execute'>) =>
      (await tx.execute(sql`select current_setting('transaction_isolation') as level,
        (select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) as locks`)).rows[0];
    expect(await db.transaction((tx) => state(tx))).toEqual({ level: 'read committed', locks: 1 });
    expect(await db.transaction((tx) => state(tx), { isolationLevel: 'serializable' })).toEqual({ level: 'serializable', locks: 1 });
    expect(withWriteLockedTransactions(db, 'other').transaction).toBe(db.transaction);
  }, 60_000);
});
