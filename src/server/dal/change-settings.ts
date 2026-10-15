import 'server-only';
// Change control board threshold of Settings (delivery 8, R-069 — P-6c "au-delà d'un seuil réglable dans les Paramètres"):
// app_settings "change.ccbThreshold" = { keur }. A change request whose |amount| is strictly greater than the threshold in force
// when it is submitted needs the board's step. Kept in its own light module (db client + schema only), like health-thresholds.ts,
// so the change-control writers read it without the Settings DAL. Invalid or missing stored values fall back to the default
// (50 k€, the prototype's highlight — a value Keystone chose until management sets it).
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { DEFAULT_CCB_THRESHOLD_KEUR, isCcbThreshold } from '@/domain/change-control';
import { getDb } from '@/server/db/client';
import { APP_SETTING_CCB } from '@/server/db/codes';
import { appSettings } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** Stored threshold, k€ (uncached; `q` = a transaction when reading inside one). */
export async function readCcbThreshold(q?: DB | Tx): Promise<number> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_CCB));
  const keur = row?.v && typeof row.v === 'object' ? (row.v as Record<string, unknown>).keur : undefined;
  return isCcbThreshold(keur) ? keur : DEFAULT_CCB_THRESHOLD_KEUR;
}

/** Threshold for the current request (one read per request). */
export const ccbThreshold = cache(async (): Promise<number> => readCcbThreshold());
