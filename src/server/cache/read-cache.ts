import 'server-only';
// In-process read caches (R-017: hold the load with real data volumes). Two kinds, for two needs:
//
// 1. `versionedRead` — derived figures shown as page content (earned value of every project, the planning load, the portfolio's
//    rebalancing suggestions): cached in this process and valid only while the database has not changed. The validity token is
//    PostgreSQL's `pg_current_snapshot()` (xmin:xmax:in-progress xids): it moves as soon as any transaction that wrote something
//    commits or rolls back — on this instance, on another instance of Keystone, or another tool on the shared server — and never
//    for reads. A hit is therefore exactly what a fresh read would return; the price is one tiny query per read. Never for
//    anything that depends on who is asking (rights are applied by the callers, after the cached read).
//
// 2. `ttlRead` — the navigation badges of the shell, computed on every page: cached per viewer key for a short time (TTL) and
//    dropped as soon as this process writes (`writeGeneration`, bumped by every committed transaction and every write
//    statement, src/server/db/write-generation.ts — the writes behind the Server Functions' revalidatePath). Another instance's
//    writes show at the latest after the TTL. The key must carry everything the value depends on (role, user / person,
//    organisation, business date): a value is never served to a viewer with other rights.
//
// Values are handed out as structured clones, so a caller that sorts or edits what it got never changes the cache — or, for a
// large list read as is (`shared: true`, the 20 000 records of the vault), deep-frozen once and shared: a caller that tried to
// change it would fail at once instead of changing the cache. Errors are not cached. The caches are emptied when the database handle changes (setDb in tests and scripts).
import { sql } from 'drizzle-orm';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import { writeGeneration } from '@/server/db/write-generation';

interface Entry {
  token: string;
  at: number;
  value: Promise<unknown>;
}

const MAX_ENTRIES = 500;
const g = globalThis as unknown as { __ksReadCache?: Map<string, Entry>; __ksReadCacheDb?: unknown };
const store = () => (g.__ksReadCache ??= new Map());

/** Empties the read caches (every key, or the keys starting with `prefix`). */
export function clearReadCache(prefix?: string): void {
  if (!prefix) return store().clear();
  for (const k of [...store().keys()]) if (k.startsWith(prefix)) store().delete(k);
}

/** The database handle the entries were computed on: another one (tests, scripts) empties the caches. */
async function sameDatabase(): Promise<Awaited<ReturnType<typeof getDb>>> {
  const db = await getDb();
  if (g.__ksReadCacheDb !== db) {
    store().clear();
    g.__ksReadCacheDb = db;
  }
  return db;
}

/** Read caching is off with KEYSTONE_READ_CACHE=off (diagnosis: every read goes to the database; src/server/config). */
const disabled = () => !getConfig().readCache;

const clone = <T,>(v: T): T => (v === null || typeof v !== 'object' ? v : structuredClone(v));

/** Freezes a plain value (objects and arrays) and everything it holds. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

async function cached<T>(key: string, token: string, maxAgeMs: number, compute: () => Promise<T>, shared = false): Promise<T> {
  const map = store();
  const hit = map.get(key);
  const now = Date.now();
  const out = (v: T) => (shared ? v : clone(v));
  if (hit && hit.token === token && now - hit.at < maxAgeMs) return out((await hit.value) as T);
  const value = shared ? compute().then(deepFreeze) : compute();
  const entry: Entry = { token, at: now, value };
  if (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value!);
  map.set(key, entry);
  value.catch(() => {
    if (map.get(key) === entry) map.delete(key);
  });
  return out(await value);
}

/** The database's data version (see the header): changes whenever a writing transaction ends, anywhere on the server. */
export async function dataVersion(): Promise<string> {
  const db = await sameDatabase();
  const r = await db.execute<{ v: string }>(sql`select pg_current_snapshot()::text as v`);
  return String(r.rows[0]?.v ?? '');
}

/**
 * `compute()`, cached under `key` while the database has not changed (exact: see the header). `maxAgeMs` bounds the life of
 * an entry (memory; default 10 min); `shared` hands out the frozen value itself (large plain lists — see the header).
 */
export async function versionedRead<T>(key: string, compute: () => Promise<T>, opts: { maxAgeMs?: number; shared?: boolean } = {}): Promise<T> {
  if (disabled()) return compute();
  const version = await dataVersion();
  return cached(`v|${key}`, version, opts.maxAgeMs ?? 600_000, compute, opts.shared);
}

/** `compute()`, cached under `key` for `ttlMs` unless this process writes meanwhile (see the header). */
export async function ttlRead<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  if (disabled()) return compute();
  await sameDatabase();
  return cached(`t|${key}`, String(writeGeneration()), ttlMs, compute);
}
