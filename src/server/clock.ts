import 'server-only';
// Business clock of this server process (R-013). KEYSTONE_CLOCK decides ("real", or a pinned YYYY-MM-DD); unset, the clock
// follows the data like the seed does (R-011): the real clock on a production database, the demo data set's date (Fri
// 25 Sep 2026) on a demo database, whose overdue items, weeks and periods were written for that date.
//
// Server code asks `businessToday()` / `businessNow()` and passes `today` to the pure rules (src/domain/clock.ts). Inside a
// transaction pass the transaction (`businessToday(tx)`): on PGlite a query outside an open transaction waits for it.
import { DEMO_CLOCK, REAL_CLOCK, businessNowOf, todayOf, type ClockSetting } from '@/domain/clock';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db/client';
import { databaseSeedMode } from '@/server/db/seed/mode';
import type { DB, Tx } from '@/server/db/types';

const g = globalThis as unknown as { __ksClockOverride?: ClockSetting | null; __ksClockAuto?: WeakMap<object, Promise<ClockSetting>> };

/** The clock setting: test override, then KEYSTONE_CLOCK, then the database's data set. */
export async function clockSetting(q?: DB | Tx): Promise<ClockSetting> {
  if (g.__ksClockOverride) return g.__ksClockOverride;
  const configured = getConfig().clock;
  if (configured) return configured;
  const db = await getDb();
  const cache = (g.__ksClockAuto ??= new WeakMap());
  let p = cache.get(db);
  if (!p) {
    p = databaseSeedMode(q ?? db).then((mode) => (mode === 'production' ? REAL_CLOCK : DEMO_CLOCK));
    cache.set(db, p);
    p.catch(() => cache.delete(db));
  }
  return p;
}

/** Business date (ISO, Europe/Paris): lateness, due dates, dates stamped on writes, form defaults. */
export async function businessToday(q?: DB | Tx): Promise<string> {
  return todayOf(await clockSetting(q));
}

/** Business instant (the real instant, or the pinned date at the real time of day). */
export async function businessNow(q?: DB | Tx): Promise<Date> {
  return businessNowOf(await clockSetting(q));
}

/** Tests: pins (or with null, releases) the clock of this process. */
export function setClockForTests(setting: ClockSetting | null): void {
  g.__ksClockOverride = setting;
}
