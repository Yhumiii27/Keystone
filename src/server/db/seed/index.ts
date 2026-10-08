import 'server-only';
import { sql } from 'drizzle-orm';
import { parts, projects } from '../schema';
import type { DB, Tx } from '../types';
import { seedCatalogue } from './catalogue';
import { seedChange } from './change';
import { seedCollaboration } from './collaboration';
import { ctxFromDb, newCtx, type SeedCtx } from './context';
import { seedControl } from './control';
import { seedContract } from './contract';
import { seedCost } from './cost';
import { seedDocuments } from './documents';
import { seedOperations } from './operations';
import { seedOrganisation } from './organisation';
import { seedPlanning } from './planning';
import { seedPlatform } from './platform';
import { seedPortfolio } from './portfolio';
import { seedPrioritisation } from './prioritisation';
import { seedPurchasing } from './purchasing';
import { seedResources } from './resources';
import { seedStock } from './stock';
import { seedVigie } from './vigie';
import { seedWork } from './work';

/** Delivery 4 modules: technical reference, purchasing, stock and the Vigie ECO mirror. */
async function seedDelivery4(tx: Tx, ctx: SeedCtx): Promise<void> {
  await seedCatalogue(tx, ctx);
  await seedPurchasing(tx, ctx);
  await seedStock(tx, ctx);
  await seedVigie(tx);
}

/**
 * Seeds the database from the prototype data set (src/server/prototype: PROTO constants + PROTO_GEN, the
 * materialised initialProjects() / projectData()) when the projects table is empty — in one transaction.
 * A database seeded before Delivery 4 (migration 0003 applied to an existing data dir) gets the Delivery 4 modules
 * seeded once, when its catalogue is empty, against its own people, projects and activities; a failure there is
 * logged and leaves the database as it was.
 */
export async function seedIfEmpty(db: DB): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  if (n > 0) {
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(parts);
    if (c === 0) {
      await db.transaction(async (tx) => seedDelivery4(tx, await ctxFromDb(tx))).catch((e) => console.error('[seed] Delivery 4 backfill failed:', e));
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
  });
  return true;
}
