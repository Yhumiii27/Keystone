import 'server-only';
// R-010 — the connectors' read-through refreshes with several Keystone instances. Each read of a Vigie / Cursus screen
// refreshes the local mirror at most once a minute; the time of the last refresh is kept in the process (globalThis), so with N
// instances on the shared PostgreSQL server Vigie and Cursus were called N times a minute for the same data. The mirror itself
// is shared (one database), so one refresh per minute is enough: the instance that claims the slot refreshes, the others read
// the mirror it writes.
//
// The slot is one row of `connector_refresh_claims`, claimed by a single conditional upsert (atomic on PostgreSQL: of two
// instances claiming at the same moment exactly one gets the row back). Not inside a transaction and not behind Keystone's write
// lock: it must not wait for the writers, and it writes nothing else. A failed refresh may give its slot back (`releaseRefresh`)
// so the next read retries at once (Vigie), or keep it until it expires (Cursus: a timeout per minute, not per page view).
//
// On PGlite (development, the Mac app, the tests) one process owns the database (src/server/db/pglite-lock.ts): the per-process
// throttle is exact and the slots are not used (`sharedRefreshSlots`).
import { sql } from 'drizzle-orm';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import type { DB } from '@/server/db/types';

/** The slots are shared between instances only on a PostgreSQL server (one PGlite database = one process). */
export const sharedRefreshSlots = (): boolean => getConfig().database.driver === 'postgres';

/**
 * Claims the refresh of `key` for `everyMs`: true when this caller should refresh (no claim, or the last one is older than
 * `everyMs`), false when another instance refreshed (or is refreshing) it within that time. Database clock.
 */
export async function claimRefresh(key: string, everyMs: number, db?: DB): Promise<boolean> {
  const q = db ?? (await getDb());
  const ms = Math.max(0, Math.round(everyMs));
  const r = await q.execute<{ key: string }>(sql`
    insert into connector_refresh_claims (key, claimed_at) values (${key}, now())
    on conflict (key) do update set claimed_at = now()
    where connector_refresh_claims.claimed_at <= now() - make_interval(secs => ${ms / 1000})
    returning key`);
  return r.rows.length > 0;
}

/** Gives a claimed slot back (a failed refresh the next read should retry). */
export async function releaseRefresh(key: string, db?: DB): Promise<void> {
  const q = db ?? (await getDb());
  await q.execute(sql`update connector_refresh_claims set claimed_at = 'epoch' where key = ${key}`);
}

/**
 * The connectors' gate: on a PostgreSQL server, `claimRefresh`; elsewhere always true (the per-process throttle decides). A
 * database error never blocks a read: the caller refreshes as before.
 */
export async function mayRefresh(key: string, everyMs: number): Promise<boolean> {
  if (!sharedRefreshSlots()) return true;
  return claimRefresh(key, everyMs).catch(() => true);
}

/** `releaseRefresh` on a PostgreSQL server; nothing elsewhere. Never throws. */
export async function giveBackRefresh(key: string): Promise<void> {
  if (!sharedRefreshSlots()) return;
  await releaseRefresh(key).catch(() => undefined);
}
