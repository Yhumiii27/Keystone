import 'server-only';
// Project health thresholds of Settings (A-13): app_settings "health.thresholds" = { risk, off }. Kept in its own light
// module (db client + schema only) so the projects DAL can read it without importing the Settings DAL. Memoised per
// request; invalid stored values fall back to the defaults (0.97 / 0.90, src/domain/health.ts).
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { usableThresholds, type HealthThresholds } from '@/domain/health';
import { getDb } from '@/server/db/client';
import { APP_SETTING_HEALTH } from '@/server/db/codes';
import { appSettings } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

export type { HealthThresholds };

/** Stored thresholds (uncached; `q` = a transaction when reading inside one). */
export async function readHealthThresholds(q?: DB | Tx): Promise<HealthThresholds> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_HEALTH));
  return usableThresholds((row?.v ?? null) as Partial<HealthThresholds> | null);
}

/** Thresholds for the current request (one read per request). */
export const healthThresholds = cache(async (): Promise<HealthThresholds> => readHealthThresholds());
