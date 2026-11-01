import 'server-only';
// R-206 (K-206b): the thresholds of the schedule quality checks — app_settings "schedule.dcma" = DcmaThresholds (the DCMA
// standard by default, src/domain/schedule-quality.ts). Own light module (db client + schema only), like hours-variance.ts, so
// the Schedule page reads it without importing the Settings DAL. A missing row or an invalid value gives the standard.
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { usableDcmaThresholds, type DcmaThresholds } from '@/domain/schedule-quality';
import { getDb } from '@/server/db/client';
import { APP_SETTING_DCMA } from '@/server/db/codes';
import { appSettings } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** Stored thresholds over the standard (uncached; `q` = a transaction when reading inside one). */
export async function readDcmaThresholds(q?: DB | Tx): Promise<DcmaThresholds> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_DCMA));
  return usableDcmaThresholds(row?.v ?? null);
}

/** Thresholds for the current request (one read per request). */
export const dcmaThresholds = cache(async (): Promise<DcmaThresholds> => readDcmaThresholds());
