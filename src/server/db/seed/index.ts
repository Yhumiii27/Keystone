import 'server-only';
import { sql } from 'drizzle-orm';
import { calendars, parts, projects, referenceValues } from '../schema';
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
import { seedSettings } from './settings';
import { seedSite } from './site';
import { seedStock } from './stock';
import { demoReferentsToBackfill, seedDemoReferents } from './project-team';
import { backfillDemoUsers, demoUsersToBackfill } from './users';
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
 * calendar; a database seeded before delivery 7 (migration 0007) gets its demo persona users' roles, e-mails and departments
 * once (R-039), and its demo project referents once (R-041). Each backfill runs in its own transaction; a failure there is logged and leaves the database as it was.
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
    if ((await demoUsersToBackfill(db)) > 0) {
      await db.transaction(async (tx) => backfillDemoUsers(tx)).catch((e) => console.error('[seed] Delivery 7 users backfill failed:', e));
    }
    if (await demoReferentsToBackfill(db)) {
      await db.transaction(async (tx) => seedDemoReferents(tx)).catch((e) => console.error('[seed] Delivery 7 project team backfill failed:', e));
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
    await seedDemoReferents(tx);
  });
  return true;
}
