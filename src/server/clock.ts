import 'server-only';
// Business clock of this server process (R-013). KEYSTONE_CLOCK decides: unset or "real" = the real date (Europe/Paris), on
// every database — owner, 17 Oct 2026: « Bêta fonctionnelle, c'est maintenant »; a pinned YYYY-MM-DD for demonstrations,
// reproducible screenshots and the tests (vitest, the end-to-end runner and db-check pin the demo data set's date, Fri 25 Sep
// 2026, DEMO_TODAY_ISO).
//
// Server code asks `businessToday()` / `businessNow()` and passes `today` to the pure rules (src/domain/clock.ts). The optional
// database handle is kept for callers inside a transaction (the clock no longer reads the database).
import { REAL_CLOCK, businessNowOf, todayOf, type ClockSetting } from '@/domain/clock';
import { getConfig } from '@/server/config';
import type { DB, Tx } from '@/server/db/types';

const g = globalThis as unknown as { __ksClockOverride?: ClockSetting | null };

/** The clock setting: test override, then KEYSTONE_CLOCK, else the real clock. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function clockSetting(_q?: DB | Tx): Promise<ClockSetting> {
  return g.__ksClockOverride ?? getConfig().clock ?? REAL_CLOCK;
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
