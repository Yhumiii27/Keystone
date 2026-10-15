import 'server-only';
// R-088 (R-6b): the hours-variance threshold of Settings — app_settings "hours.variance" = { pct } (an integer % of the planned
// hours, 1–50, default 10). Kept in its own light module (db client + schema only), like health-thresholds.ts, so the Hours page
// and the hr DAL read it without importing the Settings DAL. Memoised per request; a missing row (databases seeded before
// delivery 8) or an invalid value falls back to the default.
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { usableHoursVariance } from '@/domain/hr';
import { getDb } from '@/server/db/client';
import { APP_SETTING_HOURS_VARIANCE } from '@/server/db/codes';
import { appSettings } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** Stored threshold (uncached; `q` = a transaction when reading inside one). */
export async function readHoursVariance(q?: DB | Tx): Promise<number> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_HOURS_VARIANCE));
  return usableHoursVariance(row?.v ?? null);
}

/** Threshold for the current request (one read per request). */
export const hoursVariancePct = cache(async (): Promise<number> => readHoursVariance());
