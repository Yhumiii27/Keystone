// Matrix D21: the subsidiaries connector against an in-memory demo database — the simulated source (the demo seed's mirror, a
// refresh that changes nothing), the server source read through SQL (a `matrix` schema with Matrix's view pub_filiales built in
// PGlite, as on the shared server: `select to_jsonb(v) from matrix.pub_filiales v`), the mirror replaced by each successful read
// (malformed rows skipped, an inactive subsidiary neither offered nor reserved), a failed read keeping the mirror, the source off,
// the simulation refused on a production database, the CAPEX mirror as fallback while Matrix publishes none, and the client codes
// reserved to a subsidiary (a new project's proposed code, an internal client's code3).
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
import { RESERVED_CLIENT_CODE } from '@/domain/subsidiaries';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { clients, matrixSubsidiaries, projects } from '@/server/db/schema';
import { writeSeedRecord } from '@/server/db/seed/mode';
import { assertClientCodeFree, listSubsidiaries, setProjectClientInternal } from '@/server/dal/internal-client';
import { createProject } from '@/server/dal/projects';
import { SIMULATED_PUB_FILIALES } from './simulation';
import { refreshSubsidiaryMirror, subsidiaryRefreshSummary } from './subsidiaries';

const mirror = async () => (await (await getDb()).select().from(matrixSubsidiaries).orderBy(matrixSubsidiaries.code)).map((s) => `${s.code}:${s.active ? 'active' : 'inactive'}`);

/** Matrix's view as the shared server has it (schema `matrix`, columns of the D21 v1 contract), from literal rows. */
async function createMatrixView(rows: readonly Record<string, unknown>[]) {
  const db = await getDb();
  const lit = `'${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb`;
  await db.execute(sql.raw('create schema if not exists matrix'));
  await db.execute(sql.raw('drop view if exists matrix.pub_filiales'));
  await db.execute(sql.raw(`create view matrix.pub_filiales as select x->>'code' as code, x->>'nom' as nom, x->>'pays_iso2' as pays_iso2,
    x->>'zone_code' as zone_code, x->>'devise' as devise, (x->>'ordre')::int as ordre, (x->>'actif')::boolean as actif from jsonb_array_elements(${lit}) x`));
}

const DIRECTOR = { name: 'Hélène Marchetti', role: 'director' };
const newProject = (client: string) => createProject({
  name: 'D21 check', client, das: '2', machineType: 'EMP', currency: 'EUR', templateCode: 'EMP', categories: [{ name: 'Labor', type: 'labor', budget: 10 }],
  contingencyPct: 0, calendar: 'standard_5x8',
});

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('subsidiaries connector (Matrix D21)', () => {
  it('the demo seed mirrors the simulated source (APM, SAI); a refresh changes nothing; the subsidiaries offered are Matrix’s', async () => {
    expect(await mirror()).toEqual(['APM:active', 'SAI:active']);
    const r = await refreshSubsidiaryMirror({ source: 'simulation' });
    expect(r).toEqual({ state: 'done', source: 'simulation', subsidiaries: 2, active: 2, skipped: 0 });
    expect(subsidiaryRefreshSummary(r)).toBe('2 subsidiaries · 2 active (simulated)');
    expect(await mirror()).toEqual(['APM:active', 'SAI:active']);
    const [sai] = await (await getDb()).select().from(matrixSubsidiaries).where(eq(matrixSubsidiaries.code, 'SAI'));
    expect(sai).toMatchObject({ name: 'Sahel Agro Industries', countryIso2: 'SN', zoneCode: 'AFO', currency: 'XOF', position: 2 });
    expect(await listSubsidiaries()).toEqual({ source: 'matrix', list: [{ code: 'APM', name: 'Atlas Process Maroc' }, { code: 'SAI', name: 'Sahel Agro Industries' }] });
  });

  it('server source: reads matrix.pub_filiales through SQL; the mirror is replaced, malformed rows skipped, inactive ones not offered', async () => {
    await createMatrixView([
      ...SIMULATED_PUB_FILIALES,
      { code: 'KIV', nom: 'Kivu Mining Services', pays_iso2: 'CD', zone_code: 'AFC', devise: 'CDF', ordre: 0, actif: true },
      { code: 'OLD', nom: 'Former subsidiary', pays_iso2: 'FR', zone_code: 'EUR', devise: 'EUR', ordre: 9, actif: false },
      { code: 'ab1', nom: 'Malformed', actif: true },
    ]);
    const r = await refreshSubsidiaryMirror({ source: 'server' });
    expect(r).toEqual({ state: 'done', source: 'server', subsidiaries: 4, active: 3, skipped: 1 });
    expect(await mirror()).toEqual(['APM:active', 'KIV:active', 'OLD:inactive', 'SAI:active']);
    // Matrix's order (ordre), active subsidiaries only.
    expect((await listSubsidiaries()).list.map((s) => s.code)).toEqual(['KIV', 'APM', 'SAI']);
  });

  it('a failed read keeps the mirror; off, or a simulation on a production database, reads nothing', async () => {
    const db = await getDb();
    const before = await mirror();
    await db.execute(sql.raw('drop view matrix.pub_filiales'));
    const failed = await refreshSubsidiaryMirror({ source: 'server' });
    expect(failed.state).toBe('failed');
    expect(await mirror()).toEqual(before);
    expect(await refreshSubsidiaryMirror({ source: 'off' })).toEqual({ state: 'off' });
    await writeSeedRecord(db, 'production');
    expect(await refreshSubsidiaryMirror({ source: 'simulation' })).toEqual({ state: 'refused' });
    await writeSeedRecord(db, 'demo');
    expect(await mirror()).toEqual(before);
  });

  it('a new project’s proposed client code may not be an offered subsidiary’s; a registered or free code is kept', async () => {
    // "Kivu tools" → KIV (Kivu Mining Services, active in Matrix): refused, nothing written.
    const db = await getDb();
    const count = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(projects))[0].n;
    const n = await count();
    await expect(newProject('Kivu tools')).rejects.toThrow(RESERVED_CLIENT_CODE);
    expect(await count()).toBe(n);
    expect((await db.select().from(clients).where(eq(clients.name, 'Kivu tools'))).length).toBe(0);
    // "Old town works" → OLD: the subsidiary is inactive, the code is free.
    expect(await newProject('Old town works')).toMatch(/^OLD-\d+$/);
    // A registered client keeps its code (Port authority, HAV); the subsidiary's own client is never refused.
    expect(await newProject('Port authority')).toMatch(/^HAV-\d+$/);
    await expect(assertClientCodeFree(db, 'SAI', 'Sahel Agro Industries')).resolves.toBeUndefined();
    await expect(assertClientCodeFree(db, 'SAI', 'Saint-Ail works')).rejects.toThrow(RESERVED_CLIENT_CODE);
  });

  it('an internal client takes its subsidiary’s code as code3 — refused when another client already has that code', async () => {
    const db = await getDb();
    await db.update(clients).set({ code3: 'KIV' }).where(eq(clients.name, 'Logistics BU'));
    await expect(setProjectClientInternal('HLT-026', { isInternal: true, subsidiaryCode: 'KIV' }, DIRECTOR)).rejects.toThrow('Code KIV is already the code of the client Logistics BU');
    await db.update(clients).set({ code3: 'LOG' }).where(eq(clients.name, 'Logistics BU'));
    expect(await setProjectClientInternal('HLT-026', { isInternal: true, subsidiaryCode: 'KIV' }, DIRECTOR)).toEqual({ isInternal: true, subsidiaryCode: 'KIV' });
    expect((await db.execute(sql`select code3, filiale_code from pub_clients where name = 'Port authority'`)).rows).toEqual([{ code3: 'KIV', filiale_code: 'KIV' }]);
    // An inactive or unknown subsidiary is refused while Matrix publishes subsidiaries.
    await expect(setProjectClientInternal('NDC-031', { isInternal: true, subsidiaryCode: 'OLD' }, DIRECTOR)).rejects.toThrow('Choose a subsidiary published by Matrix');
  });

  it('while Matrix publishes no subsidiary, the CAPEX mirror’s and the registered codes are offered (fallback, R-190)', async () => {
    const db = await getDb();
    await db.delete(matrixSubsidiaries);
    expect(await listSubsidiaries()).toEqual({
      source: 'capex',
      list: [{ code: 'APM', name: 'Atlas Process Maroc' }, { code: 'KIV', name: 'Port authority' }, { code: 'SAI', name: 'Sahel Agro Industries' }],
    });
  });
});
