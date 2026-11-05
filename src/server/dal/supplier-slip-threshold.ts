import 'server-only';
// S-31 (owner, 5 Nov 2026): the supplier schedule slip threshold — app_settings "purchasing.supplierSlip" = { days } (default 5
// working days, src/domain/supplier-slip-alerts.ts). Read by the daily supplier slip alerts (S-27) and the portfolio alerts
// (S-30); written from Settings (src/server/dal/settings.ts `setSupplierSlipDays`). Own light module (db client + schema only).
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { usableSupplierSlipDays } from '@/domain/supplier-slip-alerts';
import { getDb } from '@/server/db/client';
import { APP_SETTING_SUPPLIER_SLIP } from '@/server/db/codes';
import { appSettings } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** Stored threshold over the default (uncached; `q` = a transaction when reading inside one). */
export async function readSupplierSlipDays(q?: DB | Tx): Promise<number> {
  const db = q ?? (await getDb());
  const [row] = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, APP_SETTING_SUPPLIER_SLIP));
  return usableSupplierSlipDays(row?.v ?? null);
}

/** Threshold for the current request (one read per request). */
export const supplierSlipDays = cache(async (): Promise<number> => readSupplierSlipDays());
