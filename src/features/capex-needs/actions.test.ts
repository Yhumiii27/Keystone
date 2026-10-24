// R-187 (Arche K-02, K-03, K-10): the "Subsidiaries' machine needs" Server Functions against an in-memory demo database — rights
// (the director answers and creates; the project managers read and refresh; the other roles refused, the client sent home),
// validation in the viewer's language, the answer's life (record, edit, send, accept, lapse) with its audit row and activity event,
// pub_reponses_besoins (K-02 columns and types, the range computed from the class, the firm offer E10), the project created from an
// ordered need through the wizard's path (EQ-01 = the need's line, CAPEX link, project code published) and the need's line added to
// an existing project (R-185 path, the sent quote accepted by the order), and the card rendered for the director and a PM.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  usePathname: () => '/portfolio/projects', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[viewer.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { and, eq, sql } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { I18nProvider } from '@/i18n/client';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activityEvents, auditEntries, capexNeeds, needAnswers, projects } from '@/server/db/schema';
import { REPONSES_VIEW_TYPES, SHARE_VIEW_COLUMNS } from '@/server/db/share-contracts';
import { listProjectEquipments } from '@/server/dal/project-equipment';
import type { NewProjectDraft } from '@/features/projects/draft';
import {
  addNeedToProjectAction, createProjectFromNeedAction, editNeedAnswerAction, recordNeedAnswerAction, refreshCapexNeedsAction, setNeedAnswerStatusAction,
} from './actions';
import { NeedsCard } from './needs-card';

const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  viewer.role = role;
  viewer.lang = lang;
};
type ViewRow = Record<string, unknown>;
const view = async () => (await (await getDb()).execute(sql`select * from pub_reponses_besoins order by numero`)).rows as ViewRow[];
const viewRow = async (numero: string) => (await view()).find((r) => r.numero === numero)!;
const answerAudit = async (number: string) =>
  (await (await getDb()).select().from(auditEntries).where(and(eq(auditEntries.entityType, 'need_answer'), sql`${auditEntries.objectRef} like ${`${number} ·%`}`)).orderBy(auditEntries.occurredAt));

const draft = (patch: Partial<NewProjectDraft> = {}): NewProjectDraft => ({
  name: 'New tomato processing plant — Portique de manutention 40 t', client: 'Sahel Agro Industries', das: '2', mt: 'EMP', cur: 'EUR', template: 'EMP',
  cats: [{ name: 'Études', type: 'Labor', budget: '160' }], cont: 5, cal: 'standard_5x8_workshop', pm: null, start: '2027-01-11', finish: '2027-09-30',
  city: 'Thiès', country: 'Senegal', lines: [{ mt: 'EMP', qty: 2 }],
  ...patch,
});

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => as('director'));

describe('pub_reponses_besoins (K-02, K-03)', () => {
  it('the K-02 columns in order with their types; the demo answers (E50 indicative, E30 quote, E10 firm offers, RB-003 → RCF-019)', async () => {
    const cols = (await (await getDb()).execute(sql`select column_name as c, data_type as t from information_schema.columns
      where table_schema = current_schema() and table_name = 'pub_reponses_besoins' order by ordinal_position`)).rows as { c: string; t: string }[];
    expect(cols.map((r) => r.c)).toEqual(SHARE_VIEW_COLUMNS.pub_reponses_besoins);
    expect(Object.fromEntries(cols.map((r) => [r.c, r.t]))).toEqual(REPONSES_VIEW_TYPES);
    expect((await view()).map((r) => [r.numero, r.besoin_ref, r.nature, r.classe_estimation, r.statut, r.projet_code])).toEqual([
      ['RB-001', 'CPX-SAI-2026-01/B02', 'qualification', null, 'remise', null],
      ['RB-002', 'CPX-SAI-2026-01/B03', 'offre_ferme', 'E10', 'acceptee', null],
      ['RB-003', 'CPX-SAI-2026-01/B01', 'offre_ferme', 'E10', 'acceptee', 'RCF-019'],
      ['RB-004', 'CPX-APM-2026-01/B01', 'indicatif', 'E50', 'remise', null],
      ['RB-005', 'CPX-APM-2026-01/B01', 'devis', 'E30', 'remise', null],
    ]);
    const r4 = await viewRow('RB-004');
    expect([Number(r4.montant_central_keur), Number(r4.montant_bas_keur), Number(r4.montant_haut_keur)]).toEqual([4218, 2109, 6327]);
    const comment = (await (await getDb()).execute(sql`select obj_description('pub_reponses_besoins'::regclass, 'pg_class') as c`)).rows[0] as { c: string };
    expect(comment.c).toContain('Lecteurs : arche_app');
  });

  it('the database refuses a firm offer outside E10 and a priced answer without its range (K-03)', async () => {
    const db = await getDb();
    await expect(db.update(needAnswers).set({ estimateClass: 'E30' }).where(eq(needAnswers.number, 'RB-002'))).rejects.toThrow();
    await expect(db.update(needAnswers).set({ lowKeur: null }).where(eq(needAnswers.number, 'RB-004'))).rejects.toThrow();
  });
});

describe('rights', () => {
  it('the project managers read and refresh, never answer; the other roles are refused; the client is sent home', async () => {
    as('pm');
    expect(await refreshCapexNeedsAction()).toEqual({ ok: true, message: 'Machine needs refreshed (simulated)' });
    expect(await recordNeedAnswerAction('CPX-APM-2026-01/B02', { nature: 'qualification', qualification: 'faisable' })).toEqual({ error: 'Only the portfolio director answers the subsidiaries’ machine needs' });
    for (const role of ['finance', 'englead', 'quality', 'procurement', 'depthead', 'member'] as RoleKey[]) {
      as(role);
      expect(await refreshCapexNeedsAction(), role).toEqual({ error: 'Only the director and the project managers read the subsidiaries’ machine needs' });
      expect(await setNeedAnswerStatusAction('RB-005', 'caduque'), role).toEqual({ error: 'Only the portfolio director answers the subsidiaries’ machine needs' });
    }
    as('client');
    await expect(recordNeedAnswerAction('CPX-APM-2026-01/B02', {})).rejects.toThrow('REDIRECT');
    as('pm', 'fr');
    expect(await createProjectFromNeedAction('CPX-SAI-2026-01/B03', draft())).toEqual({ error: 'Seul le directeur de portefeuille répond aux besoins machines des filiales' });
    expect((await view()).length).toBe(5);
  });
});

describe('answers', () => {
  it('records an answer in preparation (audit, activity), edits it, sends it; validation in the viewer’s language', async () => {
    as('director', 'fr');
    expect(await recordNeedAnswerAction('CPX-APM-2026-01/B02', { nature: 'offre_ferme', estimateClass: 'E30', centralKeur: '900' }))
      .toEqual({ error: 'Une offre ferme exige la classe d’estimation E10 (+10 % / −5 %)' });
    expect(await recordNeedAnswerAction('CPX-APM-2026-01/B02', { nature: 'qualification', qualification: 'a_etudier', reason: '' }))
      .toEqual({ error: 'Indiquez le motif de la qualification' });
    expect(await recordNeedAnswerAction('CPX-SAI-2026-01/B02', { nature: 'qualification', qualification: 'faisable' })).toEqual({ error: 'La filiale a retiré ce besoin' });
    expect(await recordNeedAnswerAction('bad', {})).toEqual({ error: 'Requête invalide' });
    as('director');
    const r = await recordNeedAnswerAction('CPX-APM-2026-01/B02', { nature: 'qualification', qualification: 'a_etudier', reason: 'Variante B : refroidissement à dimensionner' });
    expect(r).toEqual({ ok: true, code: 'RB-006' });
    expect(await viewRow('RB-006')).toMatchObject({ besoin_ref: 'CPX-APM-2026-01/B02', capex_code: 'CPX-APM-2026-01', nature: 'qualification', qualification: 'a_etudier', motif: 'Variante B : refroidissement à dimensionner', classe_estimation: null, statut: 'en_cours', projet_code: null });
    // Edit: now an indicative price E50 (range computed).
    expect(await editNeedAnswerAction('RB-006', { nature: 'indicatif', qualification: 'faisable', estimateClass: 'E50', centralKeur: '650', leadTimeWeeks: '30' })).toEqual({ ok: true });
    const edited = await viewRow('RB-006');
    expect([edited.nature, edited.classe_estimation, Number(edited.montant_bas_keur), Number(edited.montant_haut_keur), edited.delai_semaines]).toEqual(['indicatif', 'E50', 325, 975, 30]);
    const time = (v: unknown) => new Date(v as string | Date).getTime();
    const before = time((await viewRow('RB-006')).repondu_le);
    expect(await setNeedAnswerStatusAction('RB-006', 'remise')).toEqual({ ok: true });
    const sent = await viewRow('RB-006');
    expect([sent.statut, time(sent.repondu_le) >= before]).toEqual(['remise', true]);
    expect(await editNeedAnswerAction('RB-006', { nature: 'indicatif', estimateClass: 'E50', centralKeur: '700' })).toEqual({ error: 'Only an answer in preparation is edited: record a new answer' });
    expect(await setNeedAnswerStatusAction('RB-006', 'acceptee')).toEqual({ error: 'Only a quote or a firm offer is accepted' });
    expect((await answerAudit('RB-006')).map((a) => a.change)).toEqual([
      'Answer RB-006 to need CPX-APM-2026-01/B02 recorded · Qualification',
      'Answer RB-006 to need CPX-APM-2026-01/B02 edited',
      'Answer RB-006 to need CPX-APM-2026-01/B02: In preparation → Sent to the subsidiary',
    ]);
    const acts = await (await getDb()).select({ text: activityEvents.text }).from(activityEvents).where(sql`${activityEvents.text} like 'Answer RB-006%'`);
    expect(acts.length).toBe(2);
  });

  it('a quote is sent with its Codex reference; a firm offer with its validity and lead time', async () => {
    expect(await recordNeedAnswerAction('CPX-APM-2026-01/B01', { nature: 'devis', estimateClass: 'E30', centralKeur: '4100' })).toEqual({ ok: true, code: 'RB-007' });
    expect(await setNeedAnswerStatusAction('RB-007', 'remise')).toEqual({ error: 'A quote or a firm offer is sent with its Codex document reference' });
    expect(await setNeedAnswerStatusAction('RB-007', 'caduque')).toEqual({ ok: true });
    expect(await setNeedAnswerStatusAction('RB-007', 'remise')).toEqual({ error: 'This answer is closed: record a new answer' });
  });
});

describe('the order (K-10)', () => {
  it('creates the project from an ordered need with the wizard’s path: EQ-01 = the need’s line, CAPEX link, project code published', async () => {
    expect(await createProjectFromNeedAction('CPX-APM-2026-01/B01', draft())).toEqual({ error: 'The need is not ordered yet: the project is created at the order (G2 of the CAPEX)' });
    expect(await createProjectFromNeedAction('CPX-SAI-2026-01/B03', draft({ mt: 'MEMU', template: 'MEMU', lines: [{ mt: 'MEMU', qty: 1 }] })))
      .toEqual({ error: 'The template is the machine type of the need' });
    expect(await createProjectFromNeedAction('CPX-SAI-2026-01/B03', draft({ name: '' }))).toEqual({ error: 'Project name is required' });
    const r = await createProjectFromNeedAction('CPX-SAI-2026-01/B03', draft({ lines: [{ mt: 'EMP', qty: 9 }, { mt: 'MEMU', qty: 1 }] }));
    expect(r).toMatchObject({ ok: true });
    const code = (r as { code: string }).code;
    const db = await getDb();
    const [p] = await db.select({ capexCode: projects.capexCode, besoinRef: projects.besoinRef, stage: projects.stage }).from(projects).where(eq(projects.code, code));
    expect(p).toEqual({ capexCode: 'CPX-SAI-2026-01', besoinRef: 'CPX-SAI-2026-01/B03', stage: 'initiative' });
    // The need's line (its quantity, not the draft's), then the draft's other line.
    expect((await listProjectEquipments(code)).map((l) => [l.ref, l.machineTypeCode, l.quantity, l.catalogueCode, l.catalogueVersion, l.options, l.capacityValue, l.capacityUnit, l.besoinRef])).toEqual([
      ['EQ-01', 'EMP', 2, 'EMP-40T', 1, ['TELE · Télécommande radio'], 40, 't', 'CPX-SAI-2026-01/B03'],
      ['EQ-02', 'MEMU', 1, null, null, [], null, null, null],
    ]);
    expect((await viewRow('RB-002')).projet_code).toBe(code);
    // R-190: the subsidiary (the demo's internal client SAI) is the project's client, published as such.
    expect((await db.execute(sql`select client, client_interne, filiale_code from pub_projets where code = ${code}`)).rows)
      .toEqual([{ client: 'Sahel Agro Industries', client_interne: true, filiale_code: 'SAI' }]);
    const audit = await db.select({ change: auditEntries.change }).from(auditEntries).where(sql`${auditEntries.change} like 'Project ${sql.raw(code)} created from ordered need%'`);
    expect(audit.map((a) => a.change)).toEqual([`Project ${code} created from ordered need CPX-SAI-2026-01/B03`]);
    // Once only.
    expect(await createProjectFromNeedAction('CPX-SAI-2026-01/B03', draft())).toEqual({ error: `This need is already delivered by a project · ${code}` });
    // A later answer to the need keeps naming the project (the most recent answer is authoritative).
    expect(await recordNeedAnswerAction('CPX-SAI-2026-01/B03', { nature: 'qualification', qualification: 'faisable' })).toMatchObject({ ok: true });
    expect((await view()).filter((v) => v.besoin_ref === 'CPX-SAI-2026-01/B03').map((v) => v.projet_code)).toEqual([code, code]);
  });

  it('adds an ordered need’s line to an existing project (R-185 path): ITP plan, CAPEX link when none, the sent quote accepted by the order', async () => {
    const db = await getDb();
    // Arche marks the Kénitra gantry ordered (G2) — what the next read of pub_besoins_machines would bring.
    await db.update(capexNeeds).set({ status: 'ordered', orderedOn: '2026-10-20' }).where(eq(capexNeeds.needRef, 'CPX-APM-2026-01/B01'));
    expect(await addNeedToProjectAction('CPX-APM-2026-01/B01', { project: 'DRR-009' })).toEqual({ error: 'Choose a project that is not closed or cancelled' });
    expect(await addNeedToProjectAction('CPX-APM-2026-01/B01', { project: 'NOPE-1' })).toEqual({ error: 'Unknown project' });
    // The latest answer is RB-007 (lapsed): RB-005 (the sent quote) is not the most recent — record a sent quote again.
    expect(await recordNeedAnswerAction('CPX-APM-2026-01/B01', { nature: 'devis', estimateClass: 'E30', centralKeur: '4150', documentRef: 'DEV-CPX-APM-2026-01-002' })).toEqual({ ok: true, code: 'RB-009' });
    expect(await setNeedAnswerStatusAction('RB-009', 'remise')).toEqual({ ok: true });
    expect(await addNeedToProjectAction('CPX-APM-2026-01/B01', { project: 'HLT-026' })).toEqual({ ok: true, code: 'EQ-03' });
    const line = (await listProjectEquipments('HLT-026')).find((l) => l.ref === 'EQ-03')!;
    expect([line.machineTypeCode, line.quantity, line.besoinRef, line.catalogueCode, line.options]).toEqual(['EMP', 1, 'CPX-APM-2026-01/B01', 'EMP-40T', ['TELE · Télécommande radio']]);
    const [p] = await db.select({ capexCode: projects.capexCode, besoinRef: projects.besoinRef }).from(projects).where(eq(projects.code, 'HLT-026'));
    expect(p).toEqual({ capexCode: 'CPX-APM-2026-01', besoinRef: 'CPX-APM-2026-01/B01' });
    expect([(await viewRow('RB-009')).statut, (await viewRow('RB-009')).projet_code, (await viewRow('RB-004')).projet_code]).toEqual(['acceptee', 'HLT-026', 'HLT-026']);
    expect(await addNeedToProjectAction('CPX-APM-2026-01/B01', { project: 'NDC-031' })).toEqual({ error: 'This need is already delivered by a project · HLT-026' });
  });

  it('a free ordered need needs its machine type, and an answer first', async () => {
    const db = await getDb();
    await db.update(capexNeeds).set({ status: 'ordered' }).where(eq(capexNeeds.needRef, 'CPX-APM-2026-01/B02'));
    await db.delete(needAnswers).where(eq(needAnswers.needRef, 'CPX-APM-2026-01/B02'));
    expect(await addNeedToProjectAction('CPX-APM-2026-01/B02', { project: 'NDC-031' })).toEqual({ error: 'Choose the machine type of this free need' });
    expect(await addNeedToProjectAction('CPX-APM-2026-01/B02', { project: 'NDC-031', machineTypeCode: 'AUTRE' }))
      .toEqual({ error: 'Record Keystone’s answer to this need first: the project code is published with it' });
    expect((await listProjectEquipments('NDC-031')).length).toBe(1);
  });
});

describe('the card (Portfolio › Projects)', () => {
  const render = async (lang: 'en' | 'fr') => renderToStaticMarkup(h(I18nProvider, { lang, children: await NeedsCard() }));

  it('the director sees every need with its CAPEX, Arche links and actions (FR)', async () => {
    as('director', 'fr');
    const html = await render('fr');
    expect(html).toContain('Besoins machines des filiales');
    expect(html).toContain('href="http://localhost:3400/capex/CPX-SAI-2026-01/machines"');
    expect(html).toContain('href="http://localhost:3400/capex/CPX-APM-2026-01"');
    expect(html).toContain('Retiré par la filiale');
    expect(html).toContain('Répondre au besoin');
    expect(html).toContain('Arche simulé (données de démonstration)');
  });

  it('a project manager reads it without actions; the other roles do not get it', async () => {
    as('pm');
    const html = await render('en');
    expect(html).toContain('Subsidiaries’ machine needs');
    expect(html).not.toContain('Answer the need');
    expect(html).not.toContain('Create the project');
    as('finance');
    expect(await NeedsCard()).toBeNull();
  });
});
