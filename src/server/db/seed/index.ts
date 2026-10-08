import 'server-only';
import { sql } from 'drizzle-orm';
import { projects } from '../schema';
import type { DB } from '../types';
import { seedChange } from './change';
import { newCtx } from './context';
import { seedControl } from './control';
import { seedCost } from './cost';
import { seedOrganisation } from './organisation';
import { seedPlanning } from './planning';
import { seedPlatform } from './platform';
import { seedPortfolio } from './portfolio';
import { seedResources } from './resources';
import { seedWork } from './work';

/**
 * Seeds the database from the prototype data set (src/server/prototype: PROTO constants + PROTO_GEN, the
 * materialised initialProjects() / projectData()) when the projects table is empty — in one transaction.
 */
export async function seedIfEmpty(db: DB): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
  if (n > 0) return false;
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
  });
  return true;
}
