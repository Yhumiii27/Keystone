// K-14 (Arche, approved 2 Nov 2026): the demo database publishes the project delivering CPX-APM-2025-01/B01 (APM-008) in pub_projets,
// its oven MCH-045 in pub_parc_machines, its accepted offer RB-006 in pub_reponses_besoins, and RCF-019's planned SAT in
// pub_jalons_projets; a demo database seeded before K-14 gets them once at its next opening (seedIfEmpty's demo backfills).
import { eq, inArray, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { capexMirror, capexNeeds, clients, machines, needAnswers, projects, satPlans } from '@/server/db/schema';
import type { DB } from '@/server/db/types';
import { SIMULATED_PUB_BESOINS_MACHINES, SIMULATED_PUB_CAPEX } from '@/server/integrations/capex/simulation';
import { demoK14ProjectToBackfill, demoK14RcfSatToBackfill, K14_MACHINE, K14_PROJECT } from './capex-k14';
import { seedIfEmpty } from './index';

let db: DB;

beforeAll(async () => {
  db = await openDatabase();
  setDb(db);
}, 60_000);

type Row = Record<string, unknown>;
const view = async (name: string, where: string): Promise<Row[]> =>
  (await db.execute(sql.raw(`select to_jsonb(v) as r from ${name} v where ${where}`))).rows.map((x) => (x as { r: Row }).r);

describe('K-14 simulated source', () => {
  it('has Arche’s five published demo CAPEX and the oven’s free need ordered at the G2 of 15 Sep 2025', () => {
    expect(SIMULATED_PUB_CAPEX.map((c) => [c.code, c.site, c.phase_code, c.g1_le, c.g2_le, c.debut_mes_le])).toEqual([
      ['CPX-APM-2026-01', 'Kénitra plant', 'avant_projet', '2026-05-12', null, null],
      ['CPX-SAI-2026-01', 'Thiès site', 'execution', '2026-01-20', '2026-07-08', null],
      ['CPX-APM-2025-01', 'Kénitra plant', 'demarrage', '2025-05-20', '2025-09-15', '2026-07-01'],
      ['CPX-SAI-2026-02', 'Kaolack plant', 'cadrage', null, null, null],
      ['CPX-SAI-2026-03', 'Thiès site', 'avant_projet', '2026-09-24', null, null],
    ]);
    expect(SIMULATED_PUB_BESOINS_MACHINES.find((n) => n.besoin_ref === 'CPX-APM-2025-01/B01')).toMatchObject({
      capex_code: 'CPX-APM-2025-01', catalogue_code: null, libelle_libre: 'Ageing oven 2 × 6 m', quantite: 1, statut: 'ordered', commande_le: '2025-09-15',
    });
  });
});

describe('K-14 demo database', () => {
  it('mirrors the five CAPEX and six needs', async () => {
    expect((await db.select({ code: capexMirror.code }).from(capexMirror)).map((r) => r.code).sort()).toEqual([
      'CPX-APM-2025-01', 'CPX-APM-2026-01', 'CPX-SAI-2026-01', 'CPX-SAI-2026-02', 'CPX-SAI-2026-03',
    ]);
    const [oven] = await db.select().from(capexNeeds).where(eq(capexNeeds.needRef, 'CPX-APM-2025-01/B01'));
    expect(oven).toMatchObject({ status: 'ordered', freeLabel: 'Ageing oven 2 × 6 m', orderedOn: '2025-09-15' });
  });

  it('publishes APM-008 with the CAPEX link, its internal client, its machine and its accepted offer', async () => {
    const [p] = await view('pub_projets', `code = '${K14_PROJECT.code}'`);
    expect(p).toMatchObject({
      code: 'APM-008', numero: '#008', nom: 'Ageing oven and finishing line — Ageing oven 2 × 6 m', client: 'Atlas Process Maroc', client_code3: 'APM',
      phase_code: 'garantie', ville: 'Kénitra', pays: 'Morocco', capex_code: 'CPX-APM-2025-01', besoin_ref: 'CPX-APM-2025-01/B01', client_interne: true, filiale_code: 'APM',
    });
    expect(await view('pub_parc_machines', `project_code = '${K14_PROJECT.code}'`)).toEqual([expect.objectContaining({
      number: K14_MACHINE, name: 'Ageing oven 2 × 6 m', client_name: 'Atlas Process Maroc', warranty_status: 'in_warranty', type_machine_code: 'AUTRE', livree_le: '2026-05-11',
    })]);
    expect(await view('pub_reponses_besoins', `besoin_ref = 'CPX-APM-2025-01/B01'`)).toEqual([expect.objectContaining({
      numero: 'RB-006', nature: 'offre_ferme', classe_estimation: 'E10', montant_central_keur: 663, statut: 'acceptee', projet_code: 'APM-008',
    })]);
    const ms = Object.fromEntries((await view('pub_jalons_projets', `projet_code = '${K14_PROJECT.code}'`)).map((r) => [r.jalon_code, [r.prevu_le, r.reel_le]]));
    expect(ms).toMatchObject({
      commande: ['2025-09-15', '2025-09-15'], arrivee_site: ['2026-05-11', '2026-05-11'], sat: ['2026-06-19', '2026-06-19'], fin_garantie: ['2028-05-10', null],
    });
  });

  it('plans RCF-019’s SAT (pub_jalons_projets sat.prevu_le, read by Arche’s criterion K3)', async () => {
    const [sat] = await view('pub_jalons_projets', `projet_code = 'RCF-019' and jalon_code = 'sat'`);
    expect(sat).toMatchObject({ prevu_le: '2026-11-16', reel_le: null });
  });

  it('a demo database seeded before K-14 gets APM-008 and RCF-019’s SAT once; then never again', async () => {
    expect(await demoK14ProjectToBackfill(db)).toBe(false);
    expect(await demoK14RcfSatToBackfill(db)).toBe(false);
    // As a database seeded before K-14 (the internal client stays: a client is never removed).
    await db.delete(needAnswers).where(eq(needAnswers.needRef, K14_PROJECT.needRef));
    await db.delete(machines).where(eq(machines.number, K14_MACHINE));
    await db.delete(projects).where(eq(projects.code, K14_PROJECT.code));
    const [rcf] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'RCF-019'));
    await db.delete(satPlans).where(eq(satPlans.projectId, rcf.id));
    await db.delete(capexNeeds).where(eq(capexNeeds.capexCode, 'CPX-APM-2025-01'));
    await db.delete(capexMirror).where(inArray(capexMirror.code, ['CPX-APM-2025-01', 'CPX-SAI-2026-02', 'CPX-SAI-2026-03']));
    expect(await demoK14ProjectToBackfill(db)).toBe(true);
    expect(await demoK14RcfSatToBackfill(db)).toBe(true);
    expect(await seedIfEmpty(db)).toBe(false);
    expect(await view('pub_projets', `besoin_ref = 'CPX-APM-2025-01/B01'`)).toEqual([expect.objectContaining({ code: 'APM-008', client_interne: true })]);
    expect(await view('pub_parc_machines', `number = '${K14_MACHINE}'`)).toHaveLength(1);
    expect(await view('pub_reponses_besoins', `besoin_ref = 'CPX-APM-2025-01/B01'`)).toEqual([expect.objectContaining({ numero: 'RB-006', projet_code: 'APM-008' })]);
    expect((await db.select().from(capexMirror)).length).toBe(5);
    expect((await view('pub_jalons_projets', `projet_code = 'RCF-019' and jalon_code = 'sat'`))[0]).toMatchObject({ prevu_le: '2026-11-16' });
    expect((await db.select().from(clients).where(eq(clients.subsidiaryCode, 'APM'))).length).toBe(1);
    expect(await demoK14ProjectToBackfill(db)).toBe(false);
    expect(await demoK14RcfSatToBackfill(db)).toBe(false);
    await seedIfEmpty(db);
    expect((await db.select().from(projects).where(eq(projects.code, K14_PROJECT.code))).length).toBe(1);
    expect((await db.select().from(satPlans).where(eq(satPlans.projectId, rcf.id))).length).toBe(1);
  });
});
