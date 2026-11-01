// R-187 (Arche K-02): the capex connector against an in-memory demo database — the simulated source (the demo seed's mirror, a
// refresh that changes nothing), the server source read through SQL (an `arche` schema with Arche's two views built in PGlite, as
// on the shared server: `select to_jsonb(v) from arche.<view> v`), the mirror replaced by each successful read (a need that left
// the view leaves the mirror, Keystone's answers stay), malformed rows skipped, a failed read keeping the mirror, the source off,
// the connector disabled by IT, the simulation refused on a production database, and the Activity & integrations row.
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { capexMirror, capexNeeds, capexSyncRuns, connectors, needAnswers } from '@/server/db/schema';
import { writeSeedRecord } from '@/server/db/seed/mode';
import { listConnectors } from '@/server/dal/integrations';
import { capexRefreshSummary, refreshCapexMirror } from './connector';
import { SIMULATED_PUB_BESOINS_MACHINES, SIMULATED_PUB_CAPEX } from './simulation';

const needRefs = async () => (await (await getDb()).select({ r: capexNeeds.needRef, s: capexNeeds.status }).from(capexNeeds).orderBy(capexNeeds.needRef)).map((x) => `${x.r}:${x.s}`);

/** Arche's views as the shared server has them (schema `arche`), from literal rows. */
async function createArcheViews(capex: readonly Record<string, unknown>[], needs: readonly Record<string, unknown>[]) {
  const db = await getDb();
  const lit = (rows: readonly Record<string, unknown>[]) => `'${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb`;
  await db.execute(sql.raw('create schema if not exists arche'));
  await db.execute(sql.raw('drop view if exists arche.pub_capex'));
  await db.execute(sql.raw('drop view if exists arche.pub_besoins_machines'));
  // Columns of the contract (Arche docs/CONTRATS.md § 3) read from a jsonb literal, typed as Arche types them.
  await db.execute(sql.raw(`create view arche.pub_capex as select x->>'code' as code, x->>'filiale_code' as filiale_code, x->>'filiale' as filiale,
    x->>'site' as site, x->>'pays_iso2' as pays_iso2, x->>'intitule' as intitule, x->>'phase_code' as phase_code, (x->>'g1_le')::date as g1_le,
    (x->>'g2_le')::date as g2_le, (x->>'maj_le')::timestamptz as maj_le from jsonb_array_elements(${lit(capex)}) x`));
  await db.execute(sql.raw(`create view arche.pub_besoins_machines as select x->>'besoin_ref' as besoin_ref, x->>'capex_code' as capex_code, x->>'ligne' as ligne,
    x->>'catalogue_code' as catalogue_code, (x->>'catalogue_version')::int as catalogue_version, x->>'libelle_libre' as libelle_libre, (x->>'quantite')::int as quantite,
    x->'options' as options, (x->>'capacite_visee')::numeric as capacite_visee, x->>'unite_capacite' as unite_capacite, (x->>'date_besoin')::date as date_besoin,
    x->>'site' as site, x->>'statut' as statut, x->>'commentaire' as commentaire, (x->>'soumis_le')::timestamptz as soumis_le, (x->>'commande_le')::date as commande_le,
    (x->>'maj_le')::timestamptz as maj_le from jsonb_array_elements(${lit(needs)}) x`));
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('capex connector (Arche K-02)', () => {
  it('the demo seed mirrors the simulated source: 2 CAPEX, 5 needs (submitted, ordered, withdrawn), 5 answers; a refresh changes nothing', async () => {
    const db = await getDb();
    const before = await needRefs();
    expect(before).toEqual([
      'CPX-APM-2026-01/B01:submitted', 'CPX-APM-2026-01/B02:submitted', 'CPX-SAI-2026-01/B01:ordered', 'CPX-SAI-2026-01/B02:withdrawn', 'CPX-SAI-2026-01/B03:ordered',
    ]);
    const r = await refreshCapexMirror('job', { source: 'simulation' });
    expect(r).toEqual({ state: 'done', source: 'simulation', capex: 2, needs: 5, skipped: 0 });
    expect(capexRefreshSummary(r)).toBe('2 CAPEX · 5 needs (simulated)');
    expect(await needRefs()).toEqual(before);
    expect((await db.select().from(capexMirror)).map((c) => [c.code, c.subsidiaryName, c.g2On])).toEqual(expect.arrayContaining([
      ['CPX-APM-2026-01', 'Atlas Process Maroc', null], ['CPX-SAI-2026-01', 'Sahel Agro Industries', '2026-07-08'],
    ]));
    // The mirror keeps no e-mail of Arche's people (pub_capex publishes them; Keystone does not need them).
    expect(JSON.stringify(await db.select().from(capexMirror))).not.toContain('@');
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(needAnswers))[0].n).toBe(5);
  });

  it('server source: reads arche.pub_capex and arche.pub_besoins_machines through SQL; the mirror is replaced (answers stay)', async () => {
    const db = await getDb();
    const needs = SIMULATED_PUB_BESOINS_MACHINES.filter((n) => n.besoin_ref !== 'CPX-SAI-2026-01/B02')
      .map((n) => (n.besoin_ref === 'CPX-APM-2026-01/B01' ? { ...n, statut: 'ordered', commande_le: '2026-10-20' } : n));
    // One malformed row (no CAPEX of its own reference) is skipped and counted.
    await createArcheViews(SIMULATED_PUB_CAPEX, [...needs, { ...needs[0], besoin_ref: 'CPX-XXX-2026-01/B09' }]);
    const r = await refreshCapexMirror('job', { source: 'server' });
    expect(r).toEqual({ state: 'done', source: 'server', capex: 2, needs: 4, skipped: 1 });
    expect(await needRefs()).toEqual(['CPX-APM-2026-01/B01:ordered', 'CPX-APM-2026-01/B02:submitted', 'CPX-SAI-2026-01/B01:ordered', 'CPX-SAI-2026-01/B03:ordered']);
    const [b01] = await db.select().from(capexNeeds).where(eq(capexNeeds.needRef, 'CPX-APM-2026-01/B01'));
    expect([b01.options, b01.targetCapacity, b01.orderedOn, b01.catalogueCode, b01.catalogueVersion]).toEqual([['TELE'], 40, '2026-10-20', 'EMP-40T', 1]);
    // The answer to the need that left the view stays (no foreign key: Arche's references).
    expect((await db.select().from(needAnswers).where(eq(needAnswers.needRef, 'CPX-SAI-2026-01/B02'))).length).toBe(1);
    const [run] = await db.select().from(capexSyncRuns).orderBy(sql`${capexSyncRuns.syncedAt} desc`).limit(1);
    expect([run.source, run.trigger, run.ok, run.needCount, run.skipped]).toEqual(['server', 'job', true, 4, 1]);
  });

  it('a failed read keeps the mirror and is recorded', async () => {
    const db = await getDb();
    const before = await needRefs();
    await db.execute(sql.raw('drop view arche.pub_besoins_machines'));
    const r = await refreshCapexMirror('job', { source: 'server' });
    expect(r.state).toBe('failed');
    expect(await needRefs()).toEqual(before);
    const [run] = await db.select().from(capexSyncRuns).orderBy(sql`${capexSyncRuns.syncedAt} desc`).limit(1);
    expect([run.ok, run.error?.length ? 'error' : null]).toEqual([false, 'error']);
  });

  it('off, disabled by IT, or a simulation on a production database: nothing is read', async () => {
    const db = await getDb();
    const runs = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(capexSyncRuns))[0].n;
    const n = await runs();
    expect(await refreshCapexMirror('job', { source: 'off' })).toEqual({ state: 'off' });
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.name, 'Arche'));
    expect(await refreshCapexMirror('job', { source: 'simulation' })).toEqual({ state: 'disabled' });
    await db.update(connectors).set({ enabled: true }).where(eq(connectors.name, 'Arche'));
    await writeSeedRecord(db, 'production');
    expect(await refreshCapexMirror('job', { source: 'simulation' })).toEqual({ state: 'refused' });
    await writeSeedRecord(db, 'demo');
    expect(await runs()).toBe(n);
  });

  it('Activity & integrations: the Arche row is a mock over the demo source (ARCHE_SOURCE defaults to simulation without DATABASE_URL)', async () => {
    const row = (await listConnectors()).find((c) => c.name === 'Arche');
    expect(row).toMatchObject({ kind: 'static', mode: 'mock', link: 'mock', state: 'mock', canSync: true, lastSyncAt: null });
    expect(row?.lastVolume).toMatch(/^2 CAPEX · \d+ needs · 5 answers$/);
  });
});
