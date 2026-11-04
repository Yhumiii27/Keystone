import 'server-only';
// S-25 (follow-up questionnaire of delivery 9): the thresholds of the drift forecast and of the portfolio's Monte-Carlo alert —
// app_settings "forecast.drift" = DriftThresholds (the R-208 defaults, src/domain/drift-forecast.ts). Own light module (db
// client + schema only), like dcma-thresholds.ts. A missing row or an invalid value gives the default.
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { usableDriftThresholds, type DriftThresholds } from '@/domain/drift-forecast';
import { getDb } from '@/server/db/client';
import { APP_SETTING_DRIFT } from '@/server/db/codes';
import { appSettings } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** Stored thresholds over the defaults (uncached; `q` = a transaction when reading inside one). */
export async function readDriftThresholds(q?: DB | Tx): Promise<DriftThresholds> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_DRIFT));
  return usableDriftThresholds(row?.v ?? null);
}

/** Thresholds for the current request (one read per request). */
export const driftThresholds = cache(async (): Promise<DriftThresholds> => readDriftThresholds());
