// R-002 / R-010 against a real PostgreSQL server — opt-in: runs only when KEYSTONE_TEST_DATABASE_URL names a server where the
// test may create and drop a database (e.g. postgresql://postgres@localhost/postgres?host=/var/run/postgresql). Skipped
// otherwise (the default test run needs no server and never reaches the network).
// - `npm run db:migrate` logic: migrations under the advisory lock, the explicit seed choice, idempotent re-run;
// - driver parity: the DAL reads the same values from PostgreSQL (node-postgres) as from PGlite;
// - concurrent writes on separate connections: business numbers stay unique (SERIALIZABLE + retry), the S-3 rule holds.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCostControl } from '@/server/dal/cost';
import { getChangeControl } from '@/server/dal/changes';
import { getContract } from '@/server/dal/contract';
import { getHomeView } from '@/server/dal/home';
import { getStageHistory } from '@/server/dal/lifecycle';
import { listMeetings } from '@/server/dal/meetings';
import { getPlanData } from '@/server/dal/plan';
import { getPortfolioOverview } from '@/server/dal/portfolio';
import { getProjectData, listProjects } from '@/server/dal/projects';
import { listPurchaseOrders } from '@/server/dal/purchasing';
import { getResourcePool } from '@/server/dal/resources';
import { createRisk, getRiskRegister } from '@/server/dal/risks';
import { getScheduleData } from '@/server/dal/schedule';
import { getSite } from '@/server/dal/site';
import { listStock } from '@/server/dal/stock';
import { listTasks } from '@/server/dal/tasks';
import { addActivityTodo } from '@/server/dal/activity-todos';
import { BaselinePolicyError, createBaselineSnapshot, listProjectBaselines } from '@/server/dal/baselines';
import { PERSONAS } from '@/config/personas';
import { setDb } from './client';
import { pendingMigrations } from './migrations';
import { openDatabase } from './open';
import { SeedChoiceRequiredError, migrateAndSeedPostgres, openPostgres, type PostgresHandle } from './postgres';
import { readSeedRecord } from './seed/mode';
import type { DB } from './types';

const ADMIN_URL = process.env.KEYSTONE_TEST_DATABASE_URL?.trim();

/** URL of database `name` on the admin URL's server. */
function urlOf(name: string): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin(sqlText: string): Promise<void> {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    await c.query(sqlText);
  } finally {
    await c.end();
  }
}

/** JSON copy with the generated ids (random UUIDs, different in each seeded database) replaced by a placeholder. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'));

describe.skipIf(!ADMIN_URL)('PostgreSQL server (KEYSTONE_TEST_DATABASE_URL)', () => {
  const name = `ks_test_${randomBytes(4).toString('hex')}`;
  let pg: PostgresHandle;
  let lite: DB;

  beforeAll(async () => {
    await admin(`create database ${name}`);
    pg = await openPostgres({ url: urlOf(name), poolMax: 8 });
    lite = await openDatabase();
  }, 120_000);

  afterAll(async () => {
    await pg?.close();
    if (ADMIN_URL) await admin(`drop database if exists ${name} with (force)`);
  });

  it('db:migrate: an empty database needs an explicit seed; then migrations + demo seed; a second run does nothing', async () => {
    await expect(migrateAndSeedPostgres(pg, null)).rejects.toBeInstanceOf(SeedChoiceRequiredError);
    // The migrations of the refused run are applied; the seed waits for the choice.
    expect(await pendingMigrations(pg.db)).toEqual([]);
    expect(await migrateAndSeedPostgres(pg, 'demo')).toEqual({ applied: 0, seeded: true });
    expect(await readSeedRecord(pg.db)).toMatchObject({ mode: 'demo' });
    expect(await migrateAndSeedPostgres(pg, null)).toEqual({ applied: 0, seeded: false });
    expect(await migrateAndSeedPostgres(pg, 'production')).toEqual({ applied: 0, seeded: false });
  }, 120_000);

  it('two db:migrate at the same time: the advisory lock serialises them', async () => {
    const other = await openPostgres({ url: urlOf(name), poolMax: 2 });
    try {
      const results = await Promise.all([migrateAndSeedPostgres(pg, 'demo'), migrateAndSeedPostgres(other, 'demo')]);
      expect(results).toEqual([{ applied: 0, seeded: false }, { applied: 0, seeded: false }]);
    } finally {
      await other.close();
    }
  });

  it('driver parity: the DAL reads the same values from PostgreSQL as from PGlite', async () => {
    const read = async (db: DB) => {
      setDb(db);
      const projects = await listProjects();
      const withData = projects.filter((p) => p.hasData).map((p) => p.code);
      return plain({
        projects,
        data: await Promise.all(withData.map((c) => getProjectData(c))),
        stages: await Promise.all(projects.map((p) => getStageHistory(p.code))),
        cost: await getCostControl('HLT-026'),
        plan: await getPlanData('HLT-026'),
        schedule: await getScheduleData('HLT-026'),
        changes: await getChangeControl('HLT-026'),
        risks: await getRiskRegister('HLT-026'),
        contract: await getContract('HLT-026'),
        meetings: await listMeetings('HLT-026'),
        orders: await listPurchaseOrders('HLT-026'),
        site: await getSite('HLT-026'),
        stock: await listStock(),
        tasks: await listTasks(),
        pool: await getResourcePool(),
        overview: await getPortfolioOverview(null, 'en'),
        homes: await Promise.all(PERSONAS.map((p) => getHomeView({ role: p.role, persona: p, projectCode: 'HLT-026', zone: null, lang: 'en' }))),
      });
    };
    const fromLite = await read(lite);
    const fromPg = await read(pg.db);
    for (const k of Object.keys(fromLite)) expect(fromPg[k], k).toEqual(fromLite[k]);
  }, 120_000);

  it('concurrent creations on separate connections get distinct business numbers (R-21…, T-2341…)', async () => {
    setDb(pg.db);
    const risks = await Promise.all(Array.from({ length: 8 }, (_, i) => createRisk('NDC-031', { title: `Concurrent ${i}`, category: 'technical', response: 'mitigate' }, 'System')));
    expect(new Set(risks).size).toBe(8);
    expect([...risks].sort()).toEqual(['R-21', 'R-22', 'R-23', 'R-24', 'R-25', 'R-26', 'R-27', 'R-28']);
    const todos = await Promise.all(Array.from({ length: 6 }, (_, i) => addActivityTodo('HLT-026', 'A1250', { title: `To-do ${i}` }, 'System')));
    expect(new Set(todos).size).toBe(6);
  }, 120_000);

  it('S-3 under real concurrency: simultaneous snapshots at BL0 create BL1 once, the others are refused', async () => {
    setDb(pg.db);
    const { eq } = await import('drizzle-orm');
    const { baselines, projects } = await import('./schema');
    const [p] = await pg.db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'EWA-051'));
    await pg.db.delete(baselines).where(eq(baselines.projectId, p.id));
    await createBaselineSnapshot('EWA-051', { actorName: 'System', makeCurrent: true });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => createBaselineSnapshot('EWA-051', { actorName: 'System', makeCurrent: true, enforcePolicy: true })));
    expect(results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ code: string }>).value.code)).toEqual(['BL1']);
    for (const r of results.filter((x) => x.status === 'rejected')) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BaselinePolicyError);
    expect((await listProjectBaselines('EWA-051')).map((b) => b.code)).toEqual(['BL0', 'BL1']);
  }, 120_000);
});
