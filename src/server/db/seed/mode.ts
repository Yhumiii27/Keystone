// Seed of a database (R-011): which data set it was created with, recorded in app_settings when it is seeded.
// - demo: the prototype data set (17 projects, HLT-026…) — the default, used by development, tests and demonstrations;
// - production: reference data only (A-15 "Données réelles seulement").
// The record follows the data, not the environment: a database keeps the seed it was created with whatever KEYSTONE_SEED says
// later. A database seeded before delivery 7 has no record and is a demo database.
import { eq } from 'drizzle-orm';
import type { SeedMode } from '@/server/config/parse';
import { appSettings } from '../schema';
import type { DB, Tx } from '../types';

type Q = DB | Tx;

export const SEED_SETTING_KEY = 'keystone.seed';

export interface SeedRecord {
  mode: SeedMode;
  /** ISO instant of the seed. */
  seededAt: string;
}

const isSeedMode = (v: unknown): v is SeedMode => v === 'demo' || v === 'production';

/** The recorded seed, or null (a database seeded before delivery 7, or not seeded yet). */
export async function readSeedRecord(q: Q): Promise<SeedRecord | null> {
  const [row] = await q.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, SEED_SETTING_KEY));
  const v = row?.v as Partial<SeedRecord> | undefined;
  return v && isSeedMode(v.mode) ? { mode: v.mode, seededAt: typeof v.seededAt === 'string' ? v.seededAt : '' } : null;
}

/** Records the seed of the database (in the seeding transaction). */
export async function writeSeedRecord(q: Q, mode: SeedMode, at = new Date()): Promise<void> {
  const value: SeedRecord = { mode, seededAt: at.toISOString() };
  await q.insert(appSettings).values({ key: SEED_SETTING_KEY, value, updatedAt: at, updatedByName: 'System' })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: at, updatedByName: 'System' } });
}

/** The data set of the database: its record, else demo (every database seeded before delivery 7 is a demo database). */
export async function databaseSeedMode(q: Q): Promise<SeedMode> {
  return (await readSeedRecord(q))?.mode ?? 'demo';
}

/**
 * Floor of a business numbering sequence: the prototype continued its registers from fixed numbers (risks after R-20, tasks
 * after T-2340, change requests after CR-010…). A demo database keeps those floors so the demonstration shows the same
 * numbers; a production database numbers from 1 (R-011).
 */
export async function demoFloor(q: Q, floor: number): Promise<number> {
  if (!floor) return floor;
  return (await databaseSeedMode(q)) === 'demo' ? floor : 0;
}
