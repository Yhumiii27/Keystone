// Matrix M-19 (REQUESTS.md; migration 0076_pub_editer): keystone.pub_editer(p_table, p_action, p_cle, p_valeurs, p_par, p_motif),
// the function Matrix calls to add, correct or remove a row of Keystone's open tables — Keystone's rules, its audit trail with the
// Matrix user and the reason, and a French refusal for everything else. On an in-memory PGlite seeded with the demo data (the
// function is in `public` there, search_path `public, pg_temp`); the server layout is checked by pub-editer.postgres.test.ts.
import { and, desc, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import { auditEntries, clients, persons, projects, referenceValues, skills, storageLocations, suppliers } from './schema';
import type { DB } from './types';

let db: DB;

beforeAll(async () => {
  db = await openDatabase();
}, 60_000);

const PAR = 'Camille Admin-IT';
const MOTIF = 'Correction demandée par le service qualité';
type Row = Record<string, unknown>;

/** Calls pub_editer and returns the row it gives back. */
async function edit(table: string, action: string, cle: Row | null, valeurs: Row | null, par: string | null = PAR, motif: string | null = MOTIF): Promise<Row> {
  const r = await db.execute(sql`select pub_editer(${table}, ${action}, ${cle ? JSON.stringify(cle) : null}::jsonb, ${valeurs ? JSON.stringify(valeurs) : null}::jsonb, ${par}, ${motif}) as row`);
  return (r.rows[0] as { row: Row }).row;
}

/** The refusal of a call: its SQLSTATE and its French message. */
async function refusal(...args: Parameters<typeof edit>): Promise<{ code: string; message: string }> {
  try {
    await edit(...args);
  } catch (e) {
    const err = ((e as { cause?: unknown }).cause ?? e) as { code?: string; message: string };
    return { code: err.code ?? '', message: err.message };
  }
  throw new Error('pub_editer accepted the call');
}

const lastAudit = async (entityId: string) =>
  (await db.select().from(auditEntries).where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.area, 'Matrix'))).orderBy(desc(auditEntries.occurredAt), desc(auditEntries.id)).limit(1))[0];
const auditCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(auditEntries))[0].n;

describe('M-19: the function as Matrix finds it', () => {
  it('is SECURITY DEFINER with a fixed search_path, and PUBLIC may not run it', async () => {
    const r = await db.execute(sql`
      select p.prosecdef, p.proconfig, p.proacl is not null as has_acl,
             exists (select from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
      from pg_proc p where p.proname = 'pub_editer'`);
    expect(r.rows).toEqual([{ prosecdef: true, proconfig: ['search_path=public, pg_temp'], has_acl: true, public_execute: false }]);
  });
});

describe('M-19: the closed list', () => {
  it('refuses every table outside the list (rights, audit trail, connectors, outboxes, mirrors…)', async () => {
    for (const table of ['users', 'audit_entries', 'connectors', 'vigie_ncrs', 'codex_outbox', 'rate_roles', 'projet_inconnu', '']) {
      const r = await refusal(table, 'corriger', { id: '00000000-0000-0000-0000-000000000000' }, { name: 'x' });
      expect(r.code).toBe('P0K01');
      expect(r.message).toContain('non modifiable depuis Matrix');
      // D9-04 (migration 0078): the Settings thresholds (app_settings) are open too — pub-editer-settings.test.ts.
      expect(r.message).toContain('app_settings, clients, persons, projects, reference_values, storage_locations, suppliers');
    }
  });

  it('refuses an unknown action and the actions a table does not open, with the reason', async () => {
    expect(await refusal('clients', 'supprimer', { id: '00000000-0000-0000-0000-000000000000' }, null)).toEqual({ code: 'P0K01', message: 'Action « supprimer » inconnue : ajouter, corriger ou retirer' });
    expect((await refusal('clients', 'retirer', { id: '00000000-0000-0000-0000-000000000000' }, null)).message).toContain('Keystone n\'archive ni ne supprime les clients');
    expect((await refusal('projects', 'ajouter', null, { name: 'X' })).message).toContain('assistant « Nouveau projet »');
    expect((await refusal('projects', 'retirer', { id: '00000000-0000-0000-0000-000000000000' }, null)).message).toContain('cycle de vie');
    expect((await refusal('persons', 'ajouter', null, { full_name: 'X' })).code).toBe('P0K01');
    expect((await refusal('suppliers', 'retirer', { id: '00000000-0000-0000-0000-000000000000' }, null)).message).toContain('fournisseur ne se retire pas');
  });

  it('requires the reason and the Matrix user', async () => {
    const [c] = await db.select().from(clients).limit(1);
    expect(await refusal('clients', 'corriger', { id: c.id }, { name: 'X' }, PAR, null)).toEqual({ code: 'P0K02', message: 'Le motif est obligatoire' });
    expect((await refusal('clients', 'corriger', { id: c.id }, { name: 'X' }, PAR, '   ')).message).toBe('Le motif est obligatoire');
    expect((await refusal('clients', 'corriger', { id: c.id }, { name: 'X' }, '  ', MOTIF)).message).toContain('p_par');
  });

  it('checks the key', async () => {
    const [c] = await db.select().from(clients).limit(1);
    expect((await refusal('clients', 'ajouter', { id: c.id }, { name: 'X' })).message).toContain('Pas de clé pour « ajouter »');
    expect((await refusal('clients', 'corriger', null, { name: 'X' })).message).toBe('Clé invalide : {"id": "<identifiant>"} attendu');
    expect((await refusal('clients', 'corriger', { name: c.name }, { name: 'X' })).message).toBe('Clé invalide : {"id": "<identifiant>"} attendu');
    expect((await refusal('clients', 'corriger', { id: c.id, code: 'X' }, { name: 'X' })).code).toBe('P0K02');
    expect((await refusal('clients', 'corriger', { id: 'abc' }, { name: 'X' })).message).toBe('Clé invalide : « abc » n\'est pas un identifiant');
    expect(await refusal('clients', 'corriger', { id: '00000000-0000-0000-0000-000000000000' }, { name: 'X' }))
      .toEqual({ code: 'P0K04', message: 'Client 00000000-0000-0000-0000-000000000000 introuvable' });
    expect((await refusal('persons', 'corriger', { id: '00000000-0000-0000-0000-000000000000' }, { job_title: 'X' })).code).toBe('P0K04');
  });

  it('refuses a column outside the table\'s list, a sensitive column, a non-text value and an empty change', async () => {
    const [p] = await db.select().from(persons).limit(1);
    expect(await refusal('persons', 'corriger', { id: p.id }, { email: 'x@epc2i.fr' }))
      .toEqual({ code: 'P0K01', message: 'Colonne sensible « persons.email » refusée (données personnelles, RGPD)' });
    expect((await refusal('persons', 'corriger', { id: p.id }, { job_title: 'X', matricule: 'EMP-1' })).message).toContain('Colonne sensible « persons.matricule »');
    expect((await refusal('persons', 'corriger', { id: p.id }, { rate_role_id: null })).message).toContain('Colonne sensible');
    expect((await refusal('clients', 'corriger', { id: p.id }, { api_token: 'x' })).message).toContain('Colonne sensible « clients.api_token »');
    expect((await refusal('persons', 'corriger', { id: p.id }, { short_name: 'X' })).message)
      .toBe('Colonne « short_name » non modifiable sur persons depuis Matrix : le nom court cite la personne dans les projets et les enregistrements');
    expect((await refusal('projects', 'corriger', { id: p.id }, { budget_keur: 1 })).message)
      .toBe('Colonne « budget_keur » non modifiable sur projects depuis Matrix : colonnes admises pour « corriger » : name, short_name');
    expect((await refusal('clients', 'corriger', { id: p.id }, { code3: 'ABC' })).message).toContain('réservé aux filiales');
    expect((await refusal('reference_values', 'retirer', { id: p.id }, { label: 'x' })).message).toContain('aucune valeur pour « retirer »');
    expect((await refusal('persons', 'corriger', { id: p.id }, {})).message).toBe('Aucune valeur à écrire (colonnes admises : full_name, initials, job_title)');
    expect((await refusal('persons', 'corriger', { id: p.id }, { job_title: 12 })).message).toBe('Valeur de « job_title » invalide : texte attendu');
    expect((await refusal('persons', 'corriger', { id: p.id }, { initials: '' })).message).toBe('« initials » est obligatoire');
    expect((await refusal('persons', 'corriger', { id: p.id }, { initials: 'ABCDEF' })).message).toBe('« initials » est trop long (5 caractères au plus)');
  });

  it('writes nothing for a refusal', async () => {
    const before = await auditCount();
    const [p] = await db.select().from(persons).limit(1);
    await refusal('persons', 'corriger', { id: p.id }, { job_title: 'Nouveau', email: 'x@epc2i.fr' });
    expect(await auditCount()).toBe(before);
    expect((await db.select().from(persons).where(eq(persons.id, p.id)))[0].jobTitle).toBe(p.jobTitle);
  });
});

describe('M-19: reference lists (Settings)', () => {
  it('adds a risk category with its code, audits it with the Matrix user and the reason', async () => {
    const row = await edit('reference_values', 'ajouter', null, { list_key: 'riskCats', label: '  Qualité fournisseur ' });
    expect(row).toMatchObject({ list_key: 'riskCats', code: 'qualite_fournisseur', label: 'Qualité fournisseur', active: true, is_default: false });
    const a = await lastAudit(row.id as string);
    expect(a).toMatchObject({
      actorName: PAR, actorPersonId: null, actorUserId: null, objectRef: 'Settings · Risk categories', area: 'Matrix', entityType: 'reference_value',
      reason: MOTIF, before: null, after: { code: 'qualite_fournisseur', label: 'Qualité fournisseur', active: true }, projectId: null,
    });
    expect(a.change).toMatch(/^Matrix \(\w+\) · added "Qualité fournisseur"$/);
    expect((await refusal('reference_values', 'ajouter', null, { list_key: 'riskCats', label: 'qualité FOURNISSEUR' })).message).toBe('« qualité FOURNISSEUR » est déjà dans la liste');
  });

  it('refuses a new project status, a location type and an unknown list (holidays: D9-04, pub-editer-settings.test.ts)', async () => {
    expect((await refusal('reference_values', 'ajouter', null, { list_key: 'statuses', label: 'Pause' })).code).toBe('P0K03');
    expect((await refusal('reference_values', 'ajouter', null, { list_key: 'locTypes', label: 'Dock' })).message).toBe('Les types d\'emplacement sont fixes');
    expect((await refusal('reference_values', 'ajouter', null, { list_key: 'other', label: 'X' })).message).toContain('Liste « other » inconnue');
    expect((await refusal('reference_values', 'ajouter', null, { label: 'X' })).message).toBe('« list_key » est obligatoire');
  });

  it('a new skill family becomes a column of the skills matrix', async () => {
    await edit('reference_values', 'ajouter', null, { list_key: 'skills', label: 'Soudage orbital' });
    expect(await db.select().from(skills).where(eq(skills.name, 'Soudage orbital'))).toHaveLength(1);
  });

  it('corrects a label (risk categories, deliverable types) and refuses the lists matched by label', async () => {
    const [rv] = await db.select().from(referenceValues).where(and(eq(referenceValues.listKey, 'delivTypes'), eq(referenceValues.active, true))).limit(1);
    const row = await edit('reference_values', 'corriger', { id: rv.id }, { label: `${rv.label} (révisé)` });
    expect(row).toMatchObject({ code: rv.code, label: `${rv.label} (révisé)` });
    const a = await lastAudit(rv.id);
    expect(a).toMatchObject({ before: { label: rv.label }, after: { label: `${rv.label} (révisé)` }, reason: MOTIF, objectRef: 'Settings · Deliverable types' });
    expect(a.change).toContain(`label: ${rv.label} → ${rv.label} (révisé)`);
    const [cost] = await db.select().from(referenceValues).where(eq(referenceValues.listKey, 'costCats')).limit(1);
    expect((await refusal('reference_values', 'corriger', { id: cost.id }, { label: 'X' })).message).toContain('reconnues par leur libellé');
  });

  it('nothing changed: the row is returned and nothing is audited', async () => {
    const [rv] = await db.select().from(referenceValues).where(eq(referenceValues.listKey, 'riskCats')).limit(1);
    const before = await auditCount();
    expect(await edit('reference_values', 'corriger', { id: rv.id }, { label: rv.label })).toMatchObject({ id: rv.id, label: rv.label });
    expect(await auditCount()).toBe(before);
  });

  it('removes by deactivating; a required stage stays; the same label added again comes back', async () => {
    const [rv] = await db.select().from(referenceValues).where(and(eq(referenceValues.listKey, 'riskCats'), eq(referenceValues.isDefault, true))).limit(1);
    expect(await edit('reference_values', 'retirer', { id: rv.id }, null)).toMatchObject({ active: false });
    expect(await lastAudit(rv.id)).toMatchObject({ before: { active: true }, after: { active: false }, reason: MOTIF });
    expect((await refusal('reference_values', 'retirer', { id: rv.id }, null)).message).toBe(`« ${rv.label} » est déjà retiré`);
    expect(await edit('reference_values', 'ajouter', null, { list_key: 'riskCats', label: rv.label })).toMatchObject({ id: rv.id, active: true });
    const [stage] = await db.select().from(referenceValues).where(and(eq(referenceValues.listKey, 'statuses'), eq(referenceValues.code, 'clos')));
    expect((await refusal('reference_values', 'retirer', { id: stage.id }, null)).message).toContain('exigée par le cycle de vie');
  });
});

describe('M-19: stock locations', () => {
  it('adds, corrects and removes a location', async () => {
    const row = await edit('storage_locations', 'ajouter', null, { name: 'Dépôt Rouen', location_type: 'site_store' });
    expect(row).toMatchObject({ name: 'Dépôt Rouen', location_type: 'site_store', active: true });
    expect((await refusal('storage_locations', 'ajouter', null, { name: 'X', location_type: 'garage' })).message).toContain('Type d\'emplacement « garage » inconnu');
    expect((await refusal('storage_locations', 'ajouter', null, { name: 'dépôt rouen', location_type: 'workshop' })).code).toBe('P0K03');
    expect(await edit('storage_locations', 'corriger', { id: row.id }, { name: 'Dépôt Rouen — quai 2' })).toMatchObject({ name: 'Dépôt Rouen — quai 2' });
    expect(await edit('storage_locations', 'retirer', { id: row.id }, null)).toMatchObject({ active: false });
    expect((await db.select().from(storageLocations).where(eq(storageLocations.id, row.id as string)))[0].active).toBe(false);
  });
});

describe('M-19: clients and suppliers', () => {
  it('adds a client, corrects its name and touches its projects (pub_projets.maj_le)', async () => {
    const added = await edit('clients', 'ajouter', null, { name: 'Port de Rouen' });
    expect(added).toMatchObject({ name: 'Port de Rouen', is_internal: false, code3: null });
    expect((await refusal('clients', 'ajouter', null, { name: 'PORT DE ROUEN' })).message).toBe('Le client « PORT DE ROUEN » existe déjà');
    const [p] = await db.select().from(projects).where(sql`${projects.clientId} is not null`).limit(1);
    const [c] = await db.select().from(clients).where(eq(clients.id, p.clientId!));
    await edit('clients', 'corriger', { id: c.id }, { name: `${c.name} SA` });
    const [after] = await db.select().from(projects).where(eq(projects.id, p.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(p.updatedAt.getTime());
    expect(await lastAudit(c.id)).toMatchObject({ objectRef: `${c.name} SA`, before: { name: c.name }, after: { name: `${c.name} SA` }, entityType: 'client' });
  });

  it('adds a supplier (a « Keystone … » name is a workshop), corrects its Sage code, keeps a workshop\'s name', async () => {
    expect(await edit('suppliers', 'ajouter', null, { name: 'Aciers du Nord', x3_code: 'F0420' })).toMatchObject({ name: 'Aciers du Nord', x3_code: 'F0420', is_internal: false });
    const ws = await edit('suppliers', 'ajouter', null, { name: 'Keystone Robotics' });
    expect(ws).toMatchObject({ is_internal: true, x3_code: null });
    expect((await refusal('suppliers', 'corriger', { id: ws.id }, { name: 'Robotics' })).message).toContain('atelier de Keystone');
    expect(await edit('suppliers', 'corriger', { id: ws.id }, { x3_code: 'F0999' })).toMatchObject({ name: 'Keystone Robotics', x3_code: 'F0999' });
    const [s] = await db.select().from(suppliers).where(eq(suppliers.isInternal, false)).limit(1);
    expect((await refusal('suppliers', 'corriger', { id: s.id }, { name: 'Keystone Fake' })).message).toContain('réservés aux ateliers');
  });
});

describe('M-19: people and projects', () => {
  it('corrects a person\'s job title and initials, never returns the sensitive columns', async () => {
    const [p] = await db.select().from(persons).where(sql`${persons.email} is not null`).limit(1);
    const row = await edit('persons', 'corriger', { id: p.id }, { job_title: 'Ingénieur méthodes', initials: 'IM' });
    expect(row).toMatchObject({ id: p.id, job_title: 'Ingénieur méthodes', initials: 'IM', short_name: p.shortName });
    expect(Object.keys(row)).not.toContain('email');
    expect(Object.keys(row)).not.toContain('matricule');
    expect(Object.keys(row)).not.toContain('rate_role_id');
    expect(await lastAudit(p.id)).toMatchObject({ objectRef: p.shortName, entityType: 'person', after: { job_title: 'Ingénieur méthodes', initials: 'IM' } });
  });

  it('the full name of a person from Cursus\'s directory is corrected in Cursus', async () => {
    const [p] = await db.select().from(persons).limit(1);
    await db.update(persons).set({ matricule: 'EMP-M19' }).where(eq(persons.id, p.id));
    expect((await refusal('persons', 'corriger', { id: p.id }, { full_name: 'Autre Nom' })).message).toContain('se corrige dans Cursus');
    await db.update(persons).set({ matricule: null }).where(eq(persons.id, p.id));
    expect(await edit('persons', 'corriger', { id: p.id }, { full_name: 'Autre Nom' })).toMatchObject({ full_name: 'Autre Nom' });
  });

  it('corrects a project\'s name and short name; the audit row carries the project', async () => {
    const [p] = await db.select().from(projects).where(eq(projects.code, 'HLT-026'));
    const row = await edit('projects', 'corriger', { id: p.id }, { name: 'Harbor Line Terminal — lot 2', short_name: '' });
    expect(row).toMatchObject({ code: 'HLT-026', name: 'Harbor Line Terminal — lot 2', short_name: null });
    const a = await lastAudit(p.id);
    expect(a).toMatchObject({ objectRef: 'HLT-026', projectId: p.id, entityType: 'project', reason: MOTIF, before: { name: p.name, short_name: p.shortName }, after: { name: 'Harbor Line Terminal — lot 2', short_name: null } });
    expect((await refusal('projects', 'corriger', { id: p.id }, { code: 'XXX-001' })).message).toContain('clé partagée');
    expect((await refusal('projects', 'corriger', { id: p.id }, { name: ' ' })).message).toBe('« name » est obligatoire');
  });
});
