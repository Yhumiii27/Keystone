import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { APP_SETTING_DEFAULTS } from '@/domain/settings-defaults';
import { appSettings, calendars, parts, projects, referenceValues } from '../schema';
import type { DB, Tx } from '../types';
import { seedAftersales } from './aftersales';
import { seedCatalogue } from './catalogue';
import { seedChange } from './change';
import { seedChapter4 } from './chapter4';
import { seedClient } from './client';
import { seedCollaboration } from './collaboration';
import { ctxFromDb, newCtx, type SeedCtx } from './context';
import { seedControl } from './control';
import { seedContract } from './contract';
import { seedCost } from './cost';
import { seedCursus } from './cursus';
import { seedDocuments } from './documents';
import { seedEngineering } from './engineering';
import { seedExecution } from './execution';
import { seedOperations } from './operations';
import { seedOrganisation } from './organisation';
import { seedPlanning } from './planning';
import { seedPlatform } from './platform';
import { seedPortfolio } from './portfolio';
import { seedPrioritisation } from './prioritisation';
import { seedPurchasing } from './purchasing';
import { seedQuality } from './quality';
import { seedResources } from './resources';
import { seedSettings, seedSettingsDefaults } from './settings';
import { seedSite } from './site';
import { seedStock } from './stock';
import { seedVigie, seedVigieQuality } from './vigie';
import { seedWork } from './work';

/** Delivery 4 modules: technical reference, purchasing, stock and the Vigie ECO mirror. */
async function seedDelivery4(tx: Tx, ctx: SeedCtx): Promise<void> {
  await seedCatalogue(tx, ctx);
  await seedPurchasing(tx, ctx);
  await seedStock(tx, ctx);
  await seedVigie(tx);
}

/**
 * Delivery 5 modules: quality deliverables, execution (ITP, punch lists, commissioning, REX), installed base and
 * after-sales, site, client portal, engineering register and P&ID, machine-type aggregate, administration, and the Vigie
 * NCR / HSE and Cursus mirrors.
 */
async function seedDelivery5(tx: Tx, ctx: SeedCtx): Promise<void> {
  await seedQuality(tx, ctx);
  await seedExecution(tx, ctx);
  await seedAftersales(tx, ctx);
  await seedSite(tx, ctx);
  await seedClient(tx, ctx);
  await seedEngineering(tx, ctx);
  await seedSettings(tx);
  await seedVigieQuality(tx);
  await seedCursus(tx);
}

/**
 * Seeds the database from the prototype data set (src/server/prototype: PROTO constants + PROTO_GEN, the
 * materialised initialProjects() / projectData()) when the projects table is empty — in one transaction.
 * A database seeded before Delivery 4 (migration 0003 applied to an existing data dir) gets the Delivery 4 modules
 * seeded once, when its catalogue is empty, against its own people, projects and activities; a database seeded before
 * Delivery 5 (migration 0004) gets the Delivery 5 modules once, when its Settings lists are empty; a database seeded before
 * chapter 4 (migration 0005) gets the chapter 4 data (calendars, BL1 snapshots, assignment quantities) once, when it has no
 * calendar. Each backfill runs in its own transaction; a failure there is logged and leaves the database as it was.
 */
export async function seedIfEmpty(db: DB): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  if (n > 0) {
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(parts);
    if (c === 0) {
      await db.transaction(async (tx) => seedDelivery4(tx, await ctxFromDb(tx))).catch((e) => console.error('[seed] Delivery 4 backfill failed:', e));
    }
    const [{ r }] = await db.select({ r: sql<number>`count(*)::int` }).from(referenceValues);
    if (r === 0) {
      await db.transaction(async (tx) => seedDelivery5(tx, await ctxFromDb(tx))).catch((e) => console.error('[seed] Delivery 5 backfill failed:', e));
    }
    const [{ k }] = await db.select({ k: sql<number>`count(*)::int` }).from(calendars);
    if (k === 0) {
      await db.transaction(async (tx) => seedChapter4(tx)).catch((e) => console.error('[seed] Chapter 4 backfill failed:', e));
    }
    // Delivery 7 (R-170): the stored "Reset to defaults" document (idempotent, never overwrites an existing one).
    const [{ d }] = await db.select({ d: sql<number>`count(*)::int` }).from(appSettings).where(eq(appSettings.key, APP_SETTING_DEFAULTS));
    if (d === 0) {
      await db.transaction(async (tx) => seedSettingsDefaults(tx)).catch((e) => console.error('[seed] Settings defaults backfill failed:', e));
    }
    return false;
  }
  await db.transaction(async (tx) => {
    const ctx = newCtx();
    await seedOrganisation(tx, ctx);
    await seedPortfolio(tx, ctx);
    await seedPlanning(tx, ctx);
    await seedCost(tx, ctx);
    await seedChange(tx, ctx);
    await seedControl(tx, ctx);
    await seedWork(tx, ctx);
    await seedResources(tx, ctx);
    await seedPlatform(tx, ctx);
    await seedDocuments(tx, ctx);
    await seedContract(tx, ctx);
    await seedCollaboration(tx, ctx);
    await seedOperations(tx, ctx);
    await seedPrioritisation(tx, ctx);
    await seedDelivery4(tx, ctx);
    await seedDelivery5(tx, ctx);
    await seedChapter4(tx);
  });
  return true;
}
