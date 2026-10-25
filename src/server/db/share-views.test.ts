// Share views of delivery 9 (migration 0038_share_followup; docs/delivery-9/notes-share-views.md) on a seeded PGlite: the
// contracts' columns in order (existing columns of pub_projets and pub_livrables unchanged, new ones at the end), what each
// view publishes from the demo data set, and — Arche's open question P-05 / AC-2 — that pub_avancement_projets publishes no
// internal cost, rate, actual cost, CPI, EAC or margin. The progress and SPI come from the `share-progress` job's table.
// Arche K-07 / K-11 (R-193; 0039_share_maj_le_indexes, 0040_share_installed_base): pub_parc_machines' machine columns at the end,
// one row per machine for Arche's DISTINCT read, maj_le moved by a configuration change; the maj_le indexes reached through the views.
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { D7_PROGRESS_PCT, D7_SPI } from '@/test/d7-cost-control';
import { setCapexLink } from '@/server/dal/capex-link';
import { completeIntervention, planIntervention } from '@/server/dal/claims';
import { refreshShareProgress } from '@/server/dal/share-progress';
import { setDb } from './client';
import { openDatabase } from './open';
import { clients, contractAmendments, contracts, lessonsLearned, machines, milestones, projects, punchItems } from './schema';
import { INTERNAL_MONEY_COLUMN, REX_VIEW_TYPES, SHARE_MAJ_LE_INDEXES, SHARE_VIEW_COLUMNS, SHARE_VIEW_COUNT } from './share-contracts';
import type { DB } from './types';

let db: DB;
const rows = async <R,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as R[];

beforeAll(async () => {
  db = await openDatabase();
  setDb(db);
}, 60_000);

describe('share views of delivery 9 (0038_share_followup)', () => {
  it('20 pub_ views (R-186: pub_catalogue_machines; R-187: pub_reponses_besoins; Matrix D22: pub_rex); each contract has its columns in order', async () => {
    const views = await rows<{ v: string }>(sql`select table_name as v from information_schema.views where table_schema = current_schema() and table_name like 'pub\_%' order by 1`);
    expect(views.map((r) => r.v)).toHaveLength(SHARE_VIEW_COUNT);
    for (const [view, cols] of Object.entries(SHARE_VIEW_COLUMNS)) {
      const got = await rows<{ c: string }>(sql`select column_name as c from information_schema.columns where table_schema = current_schema() and table_name = ${view} order by ordinal_position`);
      expect(got.map((r) => r.c), view).toEqual(cols);
    }
  });

  it('pub_avancement_projets is sales side only: no internal cost, rate, actual cost, CPI, EAC or margin (P-05 / AC-2)', async () => {
    const got = await rows<{ c: string }>(sql`select column_name as c from information_schema.columns where table_schema = current_schema() and table_name = 'pub_avancement_projets'`);
    expect(got.length).toBe(9);
    expect(got.map((r) => r.c).filter((c) => INTERNAL_MONEY_COLUMN.test(c))).toEqual([]);
    // Nor does the table behind it.
    const table = await rows<{ c: string }>(sql`select column_name as c from information_schema.columns where table_schema = current_schema() and table_name = 'share_project_progress'`);
    expect(table.map((r) => r.c).filter((c) => INTERNAL_MONEY_COLUMN.test(c))).toEqual([]);
  });

  it('pub_jalons: every schedule milestone, with its linked activity when set (Crucible, R-195)', async () => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(milestones);
    const v = await rows<{ projet_code: string; nom: string; position: number; mois_reference: number; statut: string; activite_code: string | null; maj_le: unknown }>(
      sql`select * from pub_jalons order by projet_code, position`,
    );
    expect(v).toHaveLength(n);
    const hlt = v.filter((r) => r.projet_code === 'HLT-026');
    expect(hlt.map((r) => [r.nom, r.mois_reference, r.statut])).toEqual([
      ['Permits approved', 2.5, 'done'], ['Foundations complete', 6, 'done'], ['Structure topped out', 8.5, 'late'], ['Cranes operational', 9, 'late'],
      ['Systems energised', 10.5, 'at_risk'], ['Handover', 11.6, 'at_risk'],
    ]);
    expect(v.every((r) => r.maj_le != null)).toBe(true);
    // A milestone anchored on an activity publishes its code and finish date.
    const [m] = await db.select({ id: milestones.id }).from(milestones).innerJoin(projects, eq(projects.id, milestones.projectId)).where(eq(projects.code, 'HLT-026')).limit(1);
    const [a] = await rows<{ id: string; code: string; finish_date: string }>(sql`select a.id, a.code, a.finish_date::text from activities a join projects p on p.id = a.project_id where p.code = 'HLT-026' and a.finish_date is not null limit 1`);
    await db.update(milestones).set({ activityId: a.id }).where(eq(milestones.id, m.id));
    const [linked] = await rows<{ activite_code: string; date_fin_activite: string }>(sql`select activite_code, date_fin_activite::text from pub_jalons where jalon_id = ${m.id}`);
    expect(linked).toEqual({ activite_code: a.code, date_fin_activite: a.finish_date });
  });

  it('pub_jalons_projets: 8 CAPEX milestones per project, mapped to stages, ITP, commissioning, PV and warranty', async () => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(projects);
    const v = await rows<{ projet_code: string; jalon_code: string; prevu_le: string | null; reference_le: string | null; reel_le: string | null }>(
      sql`select projet_code, jalon_code, prevu_le::text, reference_le::text, reel_le::text from pub_jalons_projets`,
    );
    expect(v).toHaveLength(8 * n);
    expect([...new Set(v.map((r) => r.jalon_code))]).toEqual(['commande', 'fin_etudes', 'fat', 'expedition', 'arrivee_site', 'sat', 'pv_reception', 'fin_garantie']);
    expect(v.every((r) => r.reference_le === null)).toBe(true);
    const hlt = Object.fromEntries(v.filter((r) => r.projet_code === 'HLT-026').map((r) => [r.jalon_code, r]));
    // The contract signed on 14 Jan 2026 is the order.
    expect(hlt.commande).toMatchObject({ prevu_le: '2026-01-14', reel_le: '2026-01-14' });
    // A milestone not reached has no actual date; a planned SAT keeps its planned date.
    expect(hlt.fin_garantie.reel_le).toBeNull();
    expect(hlt.sat.reel_le).toBeNull();
    // A reached milestone's planned date defaults to its actual date.
    for (const r of v) if (r.reel_le && !r.prevu_le) throw new Error(`${r.projet_code} ${r.jalon_code}: reached without a planned date`);
  });

  it('pub_avancement_projets: progress and SPI from the share-progress job (null before its first run), sales amounts in k€', async () => {
    const before = await rows<{ projet_code: string; spi: number | null; date_situation: string | null }>(sql`select projet_code, spi, date_situation from pub_avancement_projets`);
    expect(before.every((r) => r.spi === null && r.date_situation === null)).toBe(true);
    const first = await refreshShareProgress();
    expect(first.changed).toBe(first.projects);
    expect(await refreshShareProgress()).toEqual({ projects: first.projects, changed: 0 });
    const v = await rows<{ projet_code: string; date_situation: string; avancement_physique_pct: string; spi: string | null; montant_contrat_keur: string | null; montant_avenants_keur: string | null; facture_keur: string | null }>(
      sql`select projet_code, date_situation::text, avancement_physique_pct::text, spi::text, montant_contrat_keur::text, montant_avenants_keur::text, facture_keur::text from pub_avancement_projets`,
    );
    const by = Object.fromEntries(v.map((r) => [r.projet_code, r]));
    // The figures the projects register shows (delivery 7, R-073): SPI to two decimals, progress to one.
    for (const [code, spi] of Object.entries(D7_SPI)) {
      expect(Number(by[code].spi), code).toBe(spi);
      expect(Math.round(Number(by[code].avancement_physique_pct)), code).toBe(D7_PROGRESS_PCT[code]);
      expect(by[code].date_situation, code).toBe('2026-09-25');
    }
    // HLT-026: 5 400 k€ base, amendment 1 signed (120 k€; amendment 2 awaits signature), M1–M3 invoiced (10 + 20 + 25 % of 5 400).
    expect(by['HLT-026']).toMatchObject({ montant_contrat_keur: '5400.000', montant_avenants_keur: '120.000', facture_keur: '2970.000' });
  });

  it('pub_avenants: amendments sent to the client (drafts stay internal), proposed until signed', async () => {
    const v = await rows<{ projet_code: string; numero: string; montant_keur: string; statut: string; signe_le: string | null; delai_jours: number | null }>(
      sql`select projet_code, numero, montant_keur::text, statut, signe_le::text, delai_jours from pub_avenants where projet_code = 'HLT-026' order by numero`,
    );
    expect(v.map((r) => [r.numero, r.montant_keur, r.statut, r.signe_le])).toEqual([['AV-01', '120.000', 'signe', '2026-07-08'], ['AV-02', '260.000', 'propose', null]]);
    const [c] = await db.select({ id: contracts.id }).from(contracts);
    await db.insert(contractAmendments).values({ contractId: c.id, position: 9, subject: 'Draft', amountKeur: 10, status: 'draft' });
    expect((await rows(sql`select 1 from pub_avenants where projet_code = 'HLT-026'`)).length).toBe(2);
  });

  it('pub_reserves: the project punch list with category, origin, status and responsible party', async () => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(punchItems);
    const v = await rows<{ origine: string; statut: string; responsable: string | null; ouverte_le: string }>(sql`select origine, statut, responsable, ouverte_le::text from pub_reserves`);
    expect(v).toHaveLength(n);
    expect(new Set(v.map((r) => r.origine))).toEqual(new Set(['itp', 'site']));
    expect(v.every((r) => ['open', 'in_progress', 'closed'].includes(r.statut) && /^\d{4}-\d{2}-\d{2}$/.test(r.ouverte_le))).toBe(true);
  });

  it('pub_livrables: type, acceptance date and last change at the end', async () => {
    const v = await rows<{ type: string; status: string; accepte_le: string | null; maj_le: unknown }>(sql`select type, status, accepte_le::text, maj_le from pub_livrables`);
    expect(v.length).toBeGreaterThan(0);
    expect(v.filter((r) => r.status === 'accepted').every((r) => r.accepte_le)).toBe(true);
    expect(v.every((r) => r.type && r.maj_le)).toBe(true);
  });

  it('pub_projets: the CAPEX link at the end; the database refuses a malformed code (R-190)', async () => {
    await setCapexLink('HLT-026', { capexCode: 'cpx-sai-2026-01', needRef: 'CPX-SAI-2026-01/B01' }, { name: 'Hélène Marchetti', role: 'director' });
    const [r] = await rows<{ capex_code: string; besoin_ref: string }>(sql`select capex_code, besoin_ref from pub_projets where code = 'HLT-026'`);
    expect(r).toEqual({ capex_code: 'CPX-SAI-2026-01', besoin_ref: 'CPX-SAI-2026-01/B01' });
    await expect(db.update(projects).set({ capexCode: 'CAPEX-1' }).where(eq(projects.code, 'NDC-031'))).rejects.toThrow();
    await expect(db.update(projects).set({ capexCode: 'CPX-SAI-2026-01', besoinRef: 'CPX-APM-2026-01/B01' }).where(eq(projects.code, 'NDC-031'))).rejects.toThrow();
    await expect(setCapexLink('HLT-026', { capexCode: '', needRef: 'CPX-SAI-2026-01/B01' }, { name: 'Hélène Marchetti', role: 'director' })).rejects.toThrow('Enter the CAPEX code first');
  });

  it('pub_projets: the internal client at the end — false for an external client, never null (R-190)', async () => {
    const v = await rows<{ code: string; client_interne: boolean | null; filiale_code: string | null }>(sql`select code, client_interne, filiale_code from pub_projets`);
    expect(v.length).toBeGreaterThan(0);
    // The demo's subsidiary (Sahel Agro Industries, SAI) has no project yet: every demo project has an external client.
    expect(v.every((r) => r.client_interne === false && r.filiale_code === null)).toBe(true);
    // The database refuses a subsidiary code on an external client and a malformed code.
    await expect(db.update(clients).set({ subsidiaryCode: 'HTR' }).where(eq(clients.name, 'Health trust'))).rejects.toThrow();
    await expect(db.update(clients).set({ isInternal: true, subsidiaryCode: 'H1' }).where(eq(clients.name, 'Health trust'))).rejects.toThrow();
    await db.update(clients).set({ isInternal: true, subsidiaryCode: 'HTR' }).where(eq(clients.name, 'Health trust'));
    const [r] = await rows<{ client_interne: boolean; filiale_code: string }>(sql`select client_interne, filiale_code from pub_projets where code = 'RCF-019'`);
    expect(r).toEqual({ client_interne: true, filiale_code: 'HTR' });
    await db.update(clients).set({ isInternal: false, subsidiaryCode: null }).where(eq(clients.name, 'Health trust'));
  });

  it('pub_rex (Matrix D22): the validated and applied lessons at the common REX contract; a proposed lesson is not published', async () => {
    const types = await rows<{ c: string; t: string }>(sql`select column_name as c, data_type as t from information_schema.columns where table_schema = current_schema() and table_name = 'pub_rex' order by ordinal_position`);
    expect(Object.fromEntries(types.map((r) => [r.c, r.t]))).toEqual(REX_VIEW_TYPES);
    const v = await rows<Record<string, string | null>>(sql`select ref_source, outil, projet_code, capex_code, numero, categorie, titre, statut, portee, auteur from pub_rex order by numero`);
    // HLT-026's demo lessons: LL-01 validated, LL-02 applied, LL-03 validated, LL-04 proposed (not published).
    expect(v.map((r) => [r.projet_code, r.numero, r.categorie, r.statut])).toEqual([
      ['HLT-026', 'LL-01', 'procurement', 'validated'], ['HLT-026', 'LL-02', 'engineering', 'applied'], ['HLT-026', 'LL-03', 'site', 'validated'],
    ]);
    const [ll01] = await db.select({ id: lessonsLearned.id }).from(lessonsLearned).where(eq(lessonsLearned.number, 'LL-01'));
    expect(v[0]).toMatchObject({
      // The project's CAPEX link (set on HLT-026 by the pub_projets test above).
      ref_source: `lessons_learned:${ll01.id}`, outil: 'keystone', capex_code: 'CPX-SAI-2026-01', auteur: null, portee: 'Purchasing procedure PRO-QMS-021',
      titre: 'LL-01 · Steel mill capacity slipped 3 weeks with no early warning',
    });
    // A long finding is cut at 80 characters in the title (the full text stays in constat).
    expect(v[1].titre).toBe('LL-02 · P&ID rev D released while electrical and automation still consumed rev C');
    // Validating the proposed lesson publishes it.
    await db.update(lessonsLearned).set({ status: 'validated', updatedAt: new Date() }).where(eq(lessonsLearned.number, 'LL-04'));
    const [ll04] = await rows<{ capex_code: string; titre: string }>(sql`select capex_code, titre from pub_rex where numero = 'LL-04'`);
    expect(ll04).toEqual({ capex_code: 'CPX-SAI-2026-01', titre: 'LL-04 · Client decides on hold points only in steering committee' });
    await db.update(lessonsLearned).set({ status: 'proposed' }).where(eq(lessonsLearned.number, 'LL-04'));
  });

  it('pub_clients (Matrix D21): filiale_code at the end — the internal client’s subsidiary code, null for an external client', async () => {
    const v = await rows<{ name: string; code3: string | null; filiale_code: string | null }>(sql`select name, code3, filiale_code from pub_clients order by name`);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(clients);
    expect(v).toHaveLength(n);
    expect(v.filter((r) => r.filiale_code)).toEqual([{ name: 'Sahel Agro Industries', code3: 'SAI', filiale_code: 'SAI' }]);
  });

  it('pub_parc_machines: machine type, delivery date and last change at the end, one row per machine for Arche (K-07)', async () => {
    const all = await db.select({ number: machines.number, type: machines.machineTypeCode, delivered: machines.deliveredOn }).from(machines);
    const v = await rows<{ number: string; type_machine_code: string; livree_le: string | null; maj_le: unknown }>(
      sql`select distinct number, name, project_code, site_text, type_machine_code, livree_le::text, maj_le from pub_parc_machines`,
    );
    expect(v.map((r) => r.number).sort()).toEqual(all.map((m) => m.number).sort());
    const by = Object.fromEntries(v.map((r) => [r.number, r]));
    for (const m of all) expect([by[m.number].type_machine_code, by[m.number].livree_le], m.number).toEqual([m.type, m.delivered]);
    expect(v.every((r) => r.maj_le != null)).toBe(true);
    // Fitting a new revision changes the machine's rows: its maj_le moves, the other machines' stay.
    const [cfg] = await rows<{ number: string; part_ref: string }>(sql`select number, part_ref from pub_parc_machines where part_ref is not null order by number, part_ref limit 1`);
    const stamp = sql`select number, max(maj_le)::text as maj_le from pub_parc_machines group by number order by number`;
    const before = await rows<{ number: string; maj_le: string }>(stamp);
    const actor = { name: 'Gabriel Comte', role: 'quality' };
    const iv = await planIntervention({ machineNumber: cfg.number, claimNumber: null, type: 'preventive', scheduledOn: '2026-10-05', technicians: 'L. Moreau', durationDays: 1 }, actor);
    await completeIntervention(iv, { doneOn: '2026-10-06', report: 'Part replaced', partRef: cfg.part_ref, revision: 'Z' }, actor);
    const after = await rows<{ number: string; maj_le: string }>(stamp);
    const moved = after.filter((r, i) => r.maj_le !== before[i].maj_le).map((r) => r.number);
    expect(moved).toEqual([cfg.number]);
    const [fitted] = await rows<{ fitted_revision: string }>(sql`select fitted_revision from pub_parc_machines where number = ${cfg.number} and part_ref = ${cfg.part_ref}`);
    expect(fitted.fitted_revision).toBe('Z');
  });

  it('K-11: an incremental read (maj_le > …) of pub_livrables and pub_reserves reaches the updated_at index through the view', async () => {
    await db.execute(sql`set enable_seqscan = off`);
    try {
      for (const [view, { index }] of Object.entries(SHARE_MAJ_LE_INDEXES)) {
        const plan = await rows<{ 'QUERY PLAN': string }>(sql`explain select * from ${sql.identifier(view)} where maj_le > '2026-10-01T00:00:00Z'::timestamptz`);
        expect(plan.map((r) => r['QUERY PLAN']).join('\n'), view).toContain(index);
      }
    } finally {
      await db.execute(sql`reset enable_seqscan`);
    }
  });
});
