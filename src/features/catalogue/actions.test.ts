// R-186 (AC-4, K-01): the machine catalogue Server Functions of the Machine catalogue screen (owner, 25 Oct 2026: moved from the
// Machine types screen) against an in-memory demo database —
// rights (choice 5: the director and the engineering lead; the other roles of the screen read; outside the workspace refused),
// validation in the viewer's language, versioning (new version, publish retiring the previous one, retire, discard), the audit
// trail and activity feed, immutability of a published version (rule and database trigger), the view pub_catalogue_machines
// (exactly the K-01 columns in order, drafts hidden, maj_le moving), the equipment line's catalogue choice, and the "Per
// equipment" flag of a standard phase (R-185). The session (viewer, language) is mocked; the access rule is the real one.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/catalogue/machines', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
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
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { catalogueScreenView } from './model';
import { CatalogueEntryDetail } from './entry-detail';
import { revalidatePath } from 'next/cache';
import { CATALOGUE_VIEW_TYPES, SHARE_VIEW_COLUMNS } from '@/server/db/share-contracts';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, machineCatalogueEntries, machineTypePhases } from '@/server/db/schema';
import { DEMO_CATALOGUE } from '@/server/db/seed/machine-catalogue';
import { listCatalogue, listCatalogueChoices, listCataloguePublication, listCatalogueUses } from '@/server/dal/machine-catalogue';
import { getMachineType } from '@/server/dal/mtypes';
import { listActivity } from '@/server/dal/notifications';
import { addProjectEquipment, listProjectEquipments, updateProjectEquipment } from '@/server/dal/project-equipment';
import { setMachineTypePhaseScopeAction, updateMachineTypeAction } from '@/features/admin/actions';
import {
  createCatalogueEntryAction, discardCatalogueDraftAction, newCatalogueVersionAction, publishCatalogueVersionAction, retireCatalogueVersionAction,
  updateCatalogueDraftAction,
} from './actions';

const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  viewer.role = role;
  viewer.lang = lang;
};
type ViewRow = { code: string; version: number; statut: string; libelle: string; options: unknown; maj_le: unknown; type_code: string; type_libelle: string };
const view = async () => (await (await getDb()).execute(sql`select * from pub_catalogue_machines order by code, version`)).rows as ViewRow[];
const status = async (code: string) => (await listCatalogue()).filter((e) => e.code === code).map((e) => [e.version, e.status]);
const catalogueAudit = async () =>
  (await getDb()).select().from(auditEntries).where(eq(auditEntries.entityType, 'machine_catalogue_entry')).orderBy(auditEntries.occurredAt);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  as('director');
  vi.mocked(revalidatePath).mockClear();
});

describe('demo catalogue and pub_catalogue_machines (K-01)', () => {
  it('the demo data set: EMP-40T v1 published + v2 draft, MEMU-16 v1 published, SPUR-2X v1 retired', async () => {
    expect((await listCatalogue()).map((e) => [e.code, e.version, e.status, e.typeLabel])).toEqual([
      ['EMP-40T', 2, 'draft', 'EMP'], ['EMP-40T', 1, 'published', 'EMP'], ['MEMU-16', 1, 'published', 'MEMU'], ['SPUR-2X', 1, 'retired', 'SPUR'],
    ]);
    expect((await listCatalogueChoices()).map((c) => `${c.code}@${c.version}`)).toEqual(['EMP-40T@1', 'MEMU-16@1']);
    expect(DEMO_CATALOGUE).toHaveLength(4);
  });

  it('has exactly the K-01 columns, in order and with their types; publishes published and retired versions, never drafts', async () => {
    const cols = (await (await getDb()).execute(sql`select column_name as c, data_type as t from information_schema.columns
      where table_schema = current_schema() and table_name = 'pub_catalogue_machines' order by ordinal_position`)).rows as { c: string; t: string }[];
    expect(cols.map((r) => r.c)).toEqual(SHARE_VIEW_COLUMNS.pub_catalogue_machines);
    expect(Object.fromEntries(cols.map((r) => [r.c, r.t]))).toEqual(CATALOGUE_VIEW_TYPES);
    expect(Object.keys(CATALOGUE_VIEW_TYPES)).toEqual(SHARE_VIEW_COLUMNS.pub_catalogue_machines);
    const rows = await view();
    expect(rows.map((r) => [r.code, r.version, r.statut, r.type_code, r.type_libelle])).toEqual([
      ['EMP-40T', 1, 'publie', 'EMP', 'EMP'], ['MEMU-16', 1, 'publie', 'MEMU', 'MEMU'], ['SPUR-2X', 1, 'retire', 'SPUR', 'SPUR'],
    ]);
    expect(rows[0].options).toEqual([
      { code: 'TELE', libelle: 'Télécommande radio', prix_indicatif_keur: 18 }, { code: 'ANTI-COL', libelle: 'Anticollision laser', prix_indicatif_keur: 45 },
    ]);
    const comment = (await (await getDb()).execute(sql`select obj_description('pub_catalogue_machines'::regclass, 'pg_class') as c`)).rows[0] as { c: string };
    expect(comment.c).toContain('arche_app');
  });
});

describe('entry detail of the Machine catalogue screen', () => {
  const render = async (lang: Lang, canEdit: boolean) => {
    const view = catalogueScreenView({
      rows: await listCatalogue(), types: [{ code: 'EMP', label: 'EMP' }, { code: 'MEMU', label: 'MEMU' }, { code: 'SPUR', label: 'SPUR' }],
      publication: await listCataloguePublication(), uses: await listCatalogueUses(), state: { type: null, status: 'all', entry: 'EMP-40T' }, canEdit, readsOnly: !canEdit,
    }, makeT(lang), lang);
    return renderToStaticMarkup(h(I18nProvider, { lang, children: h(CatalogueEntryDetail, { detail: view.detail!, canEdit }) }));
  };

  it('lists the versions of the entry with their status, content and actions (director), in French', async () => {
    const html = await render('fr', true);
    for (const s of ['Fiche catalogue EMP-40T', 'Type de machine EMP', 'Brouillon', 'Publiée', 'Portique de manutention 40 t', 'Quai 40 t', '52 semaines', 'Publier', 'Modifier', 'TELE · Télécommande radio', 'Publié vers l’application CAPEX', 'EMP-40T v1', 'publie', 'Aucune ligne d’équipement n’a encore choisi cette fiche'])
      expect(html, s).toContain(s);
    // A draft pending: no "New version"; the published version can be retired.
    expect(html).not.toContain('Nouvelle version');
    expect(html).toContain('Retirer');
  });

  it('reads only for the other roles of the screen', async () => {
    const html = await render('en', false);
    expect(html).toContain('Catalogue entry EMP-40T');
    for (const s of ['Publish EMP-40T', 'Retire EMP-40T', 'Edit draft', 'New version']) expect(html, s).not.toContain(s);
  });
});

describe('rights (choice 5)', () => {
  it('the PM and quality read the screen but do not edit the catalogue; outside the workspace the screen is read-only', async () => {
    for (const role of ['pm', 'quality'] as RoleKey[]) {
      as(role);
      expect(await createCatalogueEntryAction('EMP', { code: 'EMP-50T', label: 'X' })).toEqual({ error: 'Only the director and the engineering lead edit the machine catalogue' });
      expect(await publishCatalogueVersionAction('EMP-40T', 2)).toEqual({ error: 'Only the director and the engineering lead edit the machine catalogue' });
      expect(await retireCatalogueVersionAction('MEMU-16', 1)).toEqual({ error: 'Only the director and the engineering lead edit the machine catalogue' });
    }
    as('quality', 'fr');
    expect(await newCatalogueVersionAction('MEMU-16')).toEqual({ error: 'Seuls le directeur et le responsable ingénierie modifient le catalogue machines' });
    for (const role of ['member', 'finance', 'procurement', 'depthead'] as RoleKey[]) {
      as(role);
      expect(await discardCatalogueDraftAction('EMP-40T', 2)).toEqual({ error: 'The machine catalogue is read-only for you' });
      // Invalid input: the read-only refusal first.
      expect(await updateCatalogueDraftAction('nope', 'x', null)).toEqual({ error: 'The machine catalogue is read-only for you' });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    as('finance', 'fr');
    expect(await createCatalogueEntryAction('EMP', { code: 'EMP-50T', label: 'X' })).toEqual({ error: 'Le catalogue machines est en lecture seule pour vous' });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await status('EMP-40T')).toEqual([[2, 'draft'], [1, 'published']]);
  });
});

describe('versioning, audit and immutability', () => {
  it('the engineering lead creates an entry (draft v1), completes it and publishes it; refusals in the viewer language', async () => {
    as('englead', 'fr');
    expect(await createCatalogueEntryAction('SPUR', { code: 'spur 3', label: 'Purification 3 lignes', options: 'TELE' }))
      .toEqual({ error: 'Une option s’écrit « CODE | libellé | prix indicatif k€ » (une par ligne)' });
    expect(await createCatalogueEntryAction('SPUR', { code: 'EMP-40T', label: 'X' })).toEqual({ error: 'Ce code catalogue est déjà utilisé' });
    expect(await createCatalogueEntryAction('SPUR', { code: '-', label: 'X' })).toEqual({ error: 'Un code catalogue s’écrit comme EMP-40T (majuscules, chiffres et tirets)' });
    as('englead');
    expect(await createCatalogueEntryAction('SPUR', { code: 'spur 3', label: 'Purification 3 lignes', variant: 'Standard' })).toEqual({ ok: true, toast: 'Catalogue draft saved', code: 'SPUR-3' });
    expect(await status('SPUR-3')).toEqual([[1, 'draft']]);
    expect(await publishCatalogueVersionAction('SPUR-3', 1)).toEqual({ error: 'Enter the indicative price before publishing' });
    expect(await updateCatalogueDraftAction('SPUR-3', 1, { label: 'Purification 3 lignes', indicativePriceKeur: '3100', leadTimeWeeks: '44', options: 'GEN | Groupe | 95' }))
      .toEqual({ ok: true, toast: 'Catalogue draft saved' });
    expect((await view()).some((r) => r.code === 'SPUR-3')).toBe(false);
    expect(await publishCatalogueVersionAction('SPUR-3', 1)).toEqual({ ok: true, toast: 'Catalogue version published' });
    expect((await view()).find((r) => r.code === 'SPUR-3')).toMatchObject({ version: 1, statut: 'publie', libelle: 'Purification 3 lignes' });
    const audit = (await catalogueAudit()).filter((a) => a.change.includes('SPUR-3'));
    expect(audit.map((a) => [a.actorName, a.change, a.messageKey])).toEqual([
      ['Antoine Girard', 'Catalogue entry SPUR-3 v1 created (draft) · Purification 3 lignes', 'catalogue.created'],
      ['Antoine Girard', 'Catalogue draft SPUR-3 v1 saved', 'catalogue.draftSaved'],
      ['Antoine Girard', 'Catalogue SPUR-3 v1 published', 'catalogue.published'],
    ]);
    expect(audit[1].after).toMatchObject({ indicativePriceKeur: 3100, leadTimeWeeks: 44, options: [{ code: 'GEN', libelle: 'Groupe', prix_indicatif_keur: 95 }] });
    expect((await listActivity()).some((a) => a.what === 'Catalogue SPUR-3 v1 published')).toBe(true);
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('publishing EMP-40T v2 retires v1, which stays published to the subsidiaries with statut "retire"', async () => {
    const before = (await view()).find((r) => r.code === 'EMP-40T' && r.version === 1)!;
    expect(await publishCatalogueVersionAction('EMP-40T', 2)).toEqual({ ok: true, toast: 'Catalogue version published' });
    expect(await status('EMP-40T')).toEqual([[2, 'published'], [1, 'retired']]);
    const rows = (await view()).filter((r) => r.code === 'EMP-40T');
    expect(rows.map((r) => [r.version, r.statut])).toEqual([[1, 'retire'], [2, 'publie']]);
    expect(new Date(String(rows[0].maj_le)).getTime()).toBeGreaterThan(new Date(String(before.maj_le)).getTime());
    expect((await catalogueAudit()).at(-1)).toMatchObject({ change: 'Catalogue EMP-40T v2 published · EMP-40T v1 retired', actorName: 'Marie Lefebvre' });
  });

  it('a published version is frozen: edit, publish and discard refused; "New version" copies the latest into a draft, once', async () => {
    expect(await updateCatalogueDraftAction('EMP-40T', 2, { label: 'Autre' })).toEqual({ error: 'A published version is frozen: create a new version' });
    expect(await discardCatalogueDraftAction('EMP-40T', 1)).toEqual({ error: 'A published version is frozen: create a new version' });
    expect(await publishCatalogueVersionAction('EMP-40T', 1)).toEqual({ error: 'A published version is frozen: create a new version' });
    expect(await retireCatalogueVersionAction('EMP-40T', 1)).toEqual({ error: 'Only the published version can be retired' });
    expect(await newCatalogueVersionAction('EMP-40T')).toEqual({ ok: true, toast: 'Catalogue draft saved' });
    expect(await newCatalogueVersionAction('EMP-40T')).toEqual({ error: 'This entry already has a draft version' });
    const [v3, v2] = (await listCatalogue()).filter((e) => e.code === 'EMP-40T');
    expect([v3.version, v3.status, v3.label, v3.indicativePriceKeur, v3.options.length]).toEqual([3, 'draft', v2.label, v2.indicativePriceKeur, 3]);
    expect(await discardCatalogueDraftAction('EMP-40T', 3)).toEqual({ ok: true, toast: 'Catalogue draft discarded' });
    expect(await status('EMP-40T')).toEqual([[2, 'published'], [1, 'retired']]);
  });

  it('the database refuses a change to the content of a published version, and its deletion (trigger)', async () => {
    const db = await getDb();
    const where = and(eq(machineCatalogueEntries.code, 'MEMU-16'), eq(machineCatalogueEntries.version, 1));
    await expect(db.update(machineCatalogueEntries).set({ label: 'Changed' }).where(where)).rejects.toThrow();
    await expect(db.update(machineCatalogueEntries).set({ indicativePriceKeur: 1 }).where(where)).rejects.toThrow();
    await expect(db.update(machineCatalogueEntries).set({ status: 'draft' }).where(where)).rejects.toThrow();
    await expect(db.delete(machineCatalogueEntries).where(where)).rejects.toThrow();
    const [row] = await db.select().from(machineCatalogueEntries).where(where);
    expect([row.label, row.status]).toEqual(['Unité mobile de fabrication 16 t/h', 'published']);
  });

  it('retire takes the published version off the catalogue; the type label moves maj_le of its rows', async () => {
    expect(await retireCatalogueVersionAction('MEMU-16', 1)).toEqual({ ok: true, toast: 'Catalogue version retired' });
    expect((await view()).find((r) => r.code === 'MEMU-16')?.statut).toBe('retire');
    expect((await listCatalogueChoices()).map((c) => c.code)).not.toContain('MEMU-16');
    const before = (await view()).find((r) => r.code === 'SPUR-2X')!;
    expect(await updateMachineTypeAction('SPUR', { label: 'Station de purification' })).toEqual({ ok: true });
    const after = (await view()).find((r) => r.code === 'SPUR-2X')!;
    expect(after.type_libelle).toBe('Station de purification');
    expect(new Date(String(after.maj_le)).getTime()).toBeGreaterThan(new Date(String(before.maj_le)).getTime());
  });
});

describe('equipment line catalogue choice (projects)', () => {
  const director = { name: 'Marie Lefebvre', role: 'director' };
  const base = { machineTypeCode: 'EMP', quantity: '1', label: '', capacityValue: '', capacityUnit: '', options: '', besoinRef: '' };

  it('a published version of the line type; never a draft, another type or a retired version; a line keeps its retired version', async () => {
    await expect(addProjectEquipment('NDC-031', { ...base, catalogue: 'EMP-40T@1' }, director)).rejects.toThrow('This catalogue version is retired');
    await expect(addProjectEquipment('NDC-031', { ...base, catalogue: 'SPUR-3@1' }, director)).rejects.toThrow('The catalogue entry is of another machine type');
    await newCatalogueVersionAction('SPUR-3');
    await expect(addProjectEquipment('NDC-031', { ...base, machineTypeCode: 'SPUR', catalogue: 'SPUR-3@2' }, director)).rejects.toThrow('Unknown catalogue entry');
    const ref = await addProjectEquipment('NDC-031', { ...base, catalogue: 'EMP-40T@2' }, director);
    const line = (await listProjectEquipments('NDC-031')).find((l) => l.ref === ref)!;
    expect([line.catalogueCode, line.catalogueVersion]).toEqual(['EMP-40T', 2]);
    expect((await listCatalogue()).find((e) => e.code === 'EMP-40T' && e.version === 2)?.projectLines).toBe(1);
    // Retired since: the line keeps it on an edit, a new line cannot take it.
    await retireCatalogueVersionAction('EMP-40T', 2);
    await updateProjectEquipment('NDC-031', ref, { ...base, quantity: '2', catalogue: 'EMP-40T@2' }, director);
    expect((await listProjectEquipments('NDC-031')).find((l) => l.ref === ref)).toMatchObject({ quantity: 2, catalogueCode: 'EMP-40T', catalogueVersion: 2 });
    await expect(addProjectEquipment('NDC-031', { ...base, catalogue: 'EMP-40T@2' }, director)).rejects.toThrow('This catalogue version is retired');
  });
});

describe('"Per equipment" flag of a standard phase (R-185 / R-186)', () => {
  it('the type editors (PM included) flag a phase; outside the workspace refused; audit row', async () => {
    as('member');
    expect(await setMachineTypePhaseScopeAction('EMP', 0, true)).toEqual({ error: 'Machine types are read-only for you' });
    as('pm');
    const phases = (await getMachineType('EMP'))!;
    expect(phases.phaseFlags[0]).toBe(false);
    expect(await setMachineTypePhaseScopeAction('EMP', 0, true)).toEqual({ ok: true });
    expect((await getMachineType('EMP'))!.phaseFlags[0]).toBe(true);
    expect(await setMachineTypePhaseScopeAction('EMP', 99, true)).toEqual({ error: 'Unknown phase' });
    expect(await setMachineTypePhaseScopeAction('EMP', '0', true)).toEqual({ error: 'Invalid request' });
    const db = await getDb();
    const [row] = await db.select().from(machineTypePhases).where(and(eq(machineTypePhases.machineTypeCode, 'EMP'), eq(machineTypePhases.position, 0)));
    expect(row.perEquipment).toBe(true);
    const [audit] = await db.select().from(auditEntries).where(eq(auditEntries.messageKey, 'machineType.phaseScope'));
    expect(audit).toMatchObject({ actorName: 'Romain Aubert', change: `Machine type EMP · phase ${row.name}: specific to an equipment` });
    expect(await setMachineTypePhaseScopeAction('EMP', 0, false)).toEqual({ ok: true });
  });
});
