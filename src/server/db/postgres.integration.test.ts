// R-002 / R-010 against a real PostgreSQL server — opt-in: runs only when KEYSTONE_TEST_DATABASE_URL names a server where the
// test may create and drop a database (e.g. postgresql://postgres@localhost/postgres?host=/var/run/postgresql). Skipped
// otherwise (the default test run needs no server and never reaches the network).
// - `npm run db:migrate` logic: migrations under the advisory lock, the explicit seed choice, idempotent re-run;
// - driver parity: the DAL reads the same values from PostgreSQL (node-postgres) as from PGlite;
// - concurrent writes on separate connections: business numbers stay unique (SERIALIZABLE + retry), the S-3 rule holds;
// - shared-server layout (M-01): tables, journal and pub_ views in the schema `keystone`, nothing in `public`;
// - Arche K-11 (R-193): the maj_le indexes are in `keystone` and an incremental read reaches them through the security_barrier views;
// - Arche K-02 (R-187): the capex connector reads Arche's views arche.pub_capex and arche.pub_besoins_machines on the shared
//   server (schema-qualified, from Keystone's connection in search_path=keystone) into its mirror;
// - Matrix D21 / D22: the subsidiaries connector reads matrix.pub_filiales on the shared server; pub_rex and pub_clients
//   (filiale_code) in `keystone`.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCostControl } from '@/server/dal/cost';
import { getChangeControl } from '@/server/dal/changes';
import { getContract } from '@/server/dal/contract';
import { getHomeView } from '@/server/dal/home';
import { getStageHistory } from '@/server/dal/lifecycle';
import { listMeetings } from '@/server/dal/meetings';
import { getPlanData } from '@/server/dal/plan';
import { getPortfolioOverview } from '@/server/dal/portfolio';
import { createProject, getProjectData, listProjects } from '@/server/dal/projects';
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
import { EXPEDITIONS_VIEW_TYPES, PACK_VIEW_TYPES, REX_VIEW_TYPES, SHARE_MAJ_LE_INDEXES, SHARE_VIEW_COUNT } from './share-contracts';
import { refreshCapexMirror } from '@/server/integrations/capex/connector';
import { SIMULATED_PUB_FILIALES } from '@/server/integrations/matrix/simulation';
import { refreshSubsidiaryMirror } from '@/server/integrations/matrix/subsidiaries';
import { SIMULATED_PUB_BESOINS_MACHINES, SIMULATED_PUB_CAPEX } from '@/server/integrations/capex/simulation';
import type { DB } from './types';

const ADMIN_URL = process.env.KEYSTONE_TEST_DATABASE_URL?.trim();

/** URL of database `name` on the admin URL's server. */
function urlOf(name: string): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin(sqlText: string, database?: string): Promise<void> {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: database ? urlOf(database) : ADMIN_URL });
  await c.connect();
  try {
    await c.query(sqlText);
  } finally {
    await c.end();
  }
}

/** JSON copy with the generated ids (random UUIDs, different in each seeded database) replaced by a placeholder. */
const plain = (v: unknown) =>
  JSON.parse(JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    // R-010: a version token carries the time of its read (src/domain/record-version.ts); the versions are compared.
    .replace(/"version":"(\d+)\.\d+"/g, '"version":"$1"'));

describe.skipIf(!ADMIN_URL)('PostgreSQL server (KEYSTONE_TEST_DATABASE_URL)', () => {
  const name = `ks_test_${randomBytes(4).toString('hex')}`;
  let pg: PostgresHandle;
  let lite: DB;

  beforeAll(async () => {
    await admin(`create database ${name}`);
    // The `keystone` schema, as the shared server's base layer creates it (Keystone never creates a schema).
    await admin('create schema keystone', name);
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

  it('shared-server layout: tables, journal and share views in "keystone", nothing in "public"', async () => {
    const { rows } = await pg.pool.query<{ schema: string; kind: string; n: number }>(`select n.nspname as schema, c.relkind::text as kind, count(*)::int as n
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'keystone', 'drizzle') and c.relkind in ('r', 'v')
      group by 1, 2 order by 1, 2`);
    expect(rows.filter((r) => r.schema !== 'keystone')).toEqual([]);
    const tables = rows.find((r) => r.kind === 'r')?.n ?? 0;
    expect(tables).toBeGreaterThan(200);
    expect(rows.find((r) => r.kind === 'v')?.n).toBe(SHARE_VIEW_COUNT);
    const journal = await pg.pool.query<{ n: number }>('select count(*)::int as n from keystone.__drizzle_migrations');
    expect(journal.rows[0].n).toBeGreaterThan(30);
    const counts = await pg.pool.query<{ v: number; t: number }>('select (select count(*)::int from pub_projets) as v, (select count(*)::int from projects) as t');
    expect(counts.rows[0].v).toBe(counts.rows[0].t);
    // R-190 (0052_internal_client_share): the internal client at the end of pub_projets in `keystone`, never null; R-196
    // (0071_project_category_share): the project category appended after it.
    const cols = await pg.pool.query<{ c: string; t: string }>(`select column_name as c, data_type as t from information_schema.columns
      where table_schema = 'keystone' and table_name = 'pub_projets' order by ordinal_position desc limit 3`);
    expect(cols.rows.reverse()).toEqual([{ c: 'client_interne', t: 'boolean' }, { c: 'filiale_code', t: 'text' }, { c: 'categorie', t: 'text' }]);
    const nulls = await pg.pool.query<{ n: number }>('select count(*)::int as n from pub_projets where client_interne is null');
    expect(nulls.rows[0].n).toBe(0);
    // R-191 (Arche K-08, 0058-0060): pub_pack_ingenierie in `keystone` with the K-08 types; the provisional standard list and the
    // mapping of the document types are reference data of the production seed.
    const pack = await pg.pool.query<{ c: string; t: string }>(`select column_name as c, data_type as t from information_schema.columns
      where table_schema = 'keystone' and table_name = 'pub_pack_ingenierie' order by ordinal_position`);
    expect(Object.fromEntries(pack.rows.map((r) => [r.c, r.t]))).toEqual(PACK_VIEW_TYPES);
    const ref = await pg.pool.query<{ lists: number; types: number; mapped: number }>(`select (select count(*)::int from machine_type_pack_families) as lists,
      (select count(*)::int from machine_types) as types, (select count(*)::int from document_types where pack_family is not null) as mapped`);
    expect(ref.rows[0]).toEqual({ lists: 5 * ref.rows[0].types, types: ref.rows[0].types, mapped: 5 });
    // R-158 lot B (0063-0064): pub_expeditions in `keystone` with its types.
    const exp = await pg.pool.query<{ c: string; t: string }>(`select column_name as c, data_type as t from information_schema.columns
      where table_schema = 'keystone' and table_name = 'pub_expeditions' order by ordinal_position`);
    expect(Object.fromEntries(exp.rows.map((r) => [r.c, r.t]))).toEqual(EXPEDITIONS_VIEW_TYPES);
  });

  it('R-187 (Arche K-02): the capex connector reads arche.pub_capex and arche.pub_besoins_machines on the shared server', async () => {
    // Arche's schema and views, as Arche's migrations create them on the shared server (literal rows of the simulated source).
    const lit = (rows: readonly Record<string, unknown>[]) => `'${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb`;
    await admin(`create schema arche;
      create view arche.pub_capex as select x->>'code' as code, x->>'filiale' as filiale, x->>'intitule' as intitule, (x->>'g2_le')::date as g2_le,
        (x->>'maj_le')::timestamptz as maj_le from jsonb_array_elements(${lit(SIMULATED_PUB_CAPEX)}) x;
      create view arche.pub_besoins_machines as select x->>'besoin_ref' as besoin_ref, x->>'capex_code' as capex_code, x->>'ligne' as ligne,
        x->>'catalogue_code' as catalogue_code, (x->>'catalogue_version')::int as catalogue_version, (x->>'quantite')::int as quantite, x->'options' as options,
        (x->>'capacite_visee')::numeric as capacite_visee, x->>'unite_capacite' as unite_capacite, x->>'statut' as statut, (x->>'maj_le')::timestamptz as maj_le
        from jsonb_array_elements(${lit(SIMULATED_PUB_BESOINS_MACHINES)}) x;`, name);
    expect(await refreshCapexMirror('job', { source: 'server', db: pg.db, checkEnabled: false })).toEqual({ state: 'done', source: 'server', capex: 2, needs: 5, skipped: 0 });
    const { rows } = await pg.pool.query<{ n: number; s: string }>(`select count(*)::int as n, string_agg(status, ',' order by need_ref) as s from capex_needs`);
    expect(rows[0]).toEqual({ n: 5, s: 'submitted,submitted,ordered,withdrawn,ordered' });
    const mirror = await pg.pool.query<{ schema: string }>(`select table_schema as schema from information_schema.tables where table_name = 'capex_needs'`);
    expect(mirror.rows).toEqual([{ schema: 'keystone' }]);
    await admin('drop schema arche cascade', name);
  });

  it('Matrix D21 / D22: matrix.pub_filiales read on the shared server; pub_rex and pub_clients.filiale_code in "keystone"', async () => {
    const lit = `'${JSON.stringify(SIMULATED_PUB_FILIALES).replace(/'/g, "''")}'::jsonb`;
    await admin(`create schema matrix;
      create view matrix.pub_filiales as select x->>'code' as code, x->>'nom' as nom, x->>'pays_iso2' as pays_iso2, x->>'zone_code' as zone_code,
        x->>'devise' as devise, (x->>'ordre')::int as ordre, (x->>'actif')::boolean as actif from jsonb_array_elements(${lit}) x;`, name);
    expect(await refreshSubsidiaryMirror({ source: 'server', db: pg.db })).toEqual({ state: 'done', source: 'server', subsidiaries: 2, active: 2, skipped: 0 });
    const mirror = await pg.pool.query<{ schema: string; n: number }>(`select table_schema as schema, (select count(*)::int from matrix_subsidiaries) as n
      from information_schema.tables where table_name = 'matrix_subsidiaries'`);
    expect(mirror.rows).toEqual([{ schema: 'keystone', n: 2 }]);
    await admin('drop schema matrix cascade', name);
    const rex = await pg.pool.query<{ c: string; t: string }>(`select column_name as c, data_type as t from information_schema.columns
      where table_schema = 'keystone' and table_name = 'pub_rex' order by ordinal_position`);
    expect(Object.fromEntries(rex.rows.map((r) => [r.c, r.t]))).toEqual(REX_VIEW_TYPES);
    const clientsView = await pg.pool.query<{ c: string }>(`select column_name as c from information_schema.columns
      where table_schema = 'keystone' and table_name = 'pub_clients' order by ordinal_position`);
    expect(clientsView.rows.map((r) => r.c)).toEqual(['id', 'name', 'code3', 'filiale_code']);
  });

  it('K-11: the maj_le indexes are in "keystone"; an incremental read of the view reaches them', async () => {
    const wanted = Object.values(SHARE_MAJ_LE_INDEXES);
    const { rows } = await pg.pool.query<{ s: string; t: string; i: string }>('select schemaname as s, tablename as t, indexname as i from pg_indexes where indexname = any($1) order by 3',
      [wanted.map((x) => x.index)]);
    expect(rows).toEqual(wanted.map((x) => ({ s: 'keystone', t: x.table, i: x.index })).sort((a, b) => a.i.localeCompare(b.i)));
    const client = await pg.pool.connect();
    try {
      await client.query('set enable_seqscan = off');
      for (const [view, { index }] of Object.entries(SHARE_MAJ_LE_INDEXES)) {
        const plan = await client.query<{ 'QUERY PLAN': string }>(`explain select * from ${view} where maj_le > $1::timestamptz`, ['2026-10-01T00:00:00Z']);
        expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n'), view).toContain(index);
      }
    } finally {
      await client.query('reset enable_seqscan');
      client.release();
    }
  });

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

  it('concurrent project creations get distinct numbers and analytic codes (inside the write transaction, behind the write lock)', async () => {
    setDb(pg.db);
    const codes = await Promise.all(Array.from({ length: 10 }, (_, i) => createProject({
      name: `Concurrent project ${i}`, client: 'Logistics BU', das: '2', machineType: 'EMP', currency: 'EUR', templateCode: 'EMP',
      categories: [{ name: 'Études', type: 'labor', budget: 100 }], contingencyPct: 5, calendar: 'standard_5x8_workshop',
    })));
    expect(new Set(codes).size).toBe(10);
    const { rows } = await pg.pool.query<{ number: string; analytic_code: string }>('select number, analytic_code from projects where code = any($1)', [codes]);
    expect(new Set(rows.map((r) => r.number)).size).toBe(10);
    expect(new Set(rows.map((r) => r.analytic_code)).size).toBe(10);
  }, 120_000);

  it('write lock: one transaction at a time; a transaction opened inside another one does not wait for its caller', async () => {
    const order: string[] = [];
    const slow = pg.db.transaction(async (tx) => {
      order.push('first:start');
      await tx.execute(sql`select pg_sleep(0.3)`);
      order.push('first:end');
    });
    await new Promise((r) => setTimeout(r, 50));
    const second = pg.db.transaction(async () => void order.push('second'));
    const nested = pg.db.transaction(async () => pg.db.transaction(async () => 'nested'));
    await Promise.all([slow, second]);
    expect(order.slice(0, 2)).toEqual(['first:start', 'first:end']);
    expect(await nested).toBe('nested');
  }, 60_000);

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

  it('R-010 on separate connections: two saves of a risk read on the same version → one saved, one refused; the version trigger runs in "keystone"', async () => {
    setDb(pg.db);
    const { listRisks, updateRisk } = await import('@/server/dal/risks');
    const { StaleRecordError } = await import('@/server/dal/record-version');
    const token = (await listRisks('HLT-026')).find((r) => r.id === 'R-03')!.version;
    const results = await Promise.allSettled([
      updateRisk('HLT-026', 'R-03', { probability: 1 }, 'Romain Aubert', { version: token }),
      updateRisk('HLT-026', 'R-03', { probability: 5 }, 'Léa Marchand', { version: token }),
      updateRisk('HLT-026', 'R-03', { impact: 1 }, 'Marie Lefebvre', { version: token }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(StaleRecordError);
    const { rows } = await pg.pool.query<{ version: number }>("select r.version from risks r join projects p on p.id = r.project_id where p.code = 'HLT-026' and r.number = 'R-03'");
    expect(rows[0].version).toBe(Number(token.split('.')[0]) + 1);
  }, 120_000);

  it('R-010 on separate connections: a business number taken meanwhile is drawn again (unique violation → retry)', async () => {
    setDb(pg.db);
    const { nextNumber, requireProject } = await import('./helpers');
    const { risks } = await import('./schema');
    const p = await requireProject(pg.db, 'HLT-026');
    const stale = await nextNumber(pg.db, risks, risks.number, 'R-', 2, 20);
    await createRisk('HLT-026', { title: 'Taken meanwhile', category: 'technical', response: 'mitigate' }, 'System');
    let attempts = 0;
    const got = await pg.db.transaction(async (tx) => {
      attempts++;
      const number = attempts === 1 ? stale : await nextNumber(tx, risks, risks.number, 'R-', 2, 20);
      await tx.insert(risks).values({
        projectId: p.id, number, title: 'Collision', category: 'technical', probability: 1, impact: 1, response: 'accept', responsePlan: '—', trigger: '—',
        status: 'open', trend: 'flat', sortOrder: -1000, costKeur: 0,
      });
      return number;
    });
    expect([attempts, got]).toEqual([2, `R-${Number(stale.slice(2)) + 1}`]);
  }, 120_000);

  it('R-010: the connectors\' refresh slot is claimed by exactly one of several instances', async () => {
    const { claimRefresh } = await import('@/server/integrations/refresh-claims');
    const others = await Promise.all(Array.from({ length: 3 }, () => openPostgres({ url: urlOf(name), poolMax: 2 })));
    try {
      const won = await Promise.all([pg, ...others].flatMap((h) => [claimRefresh('vigie-ecos', 60_000, h.db), claimRefresh('vigie-ecos', 60_000, h.db)]));
      expect(won.filter(Boolean)).toHaveLength(1);
    } finally {
      await Promise.all(others.map((h) => h.close()));
    }
  }, 120_000);
});
