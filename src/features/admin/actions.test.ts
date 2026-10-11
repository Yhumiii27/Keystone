// Administration Server Functions against an in-memory database: the workspace gate (roles without the screen are
// refused server-side, in their language), input validation and the rules of the DAL writers with translated messages,
// the viewer as the actor of the audit row, and the ISO 9001 audit export (Route Handler). The session (viewer,
// language) is mocked; the access rule is the real one.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'director' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[viewer.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { revalidatePath } from 'next/cache';
import { GET as exportAudit } from '@/app/(app)/admin/integrations/audit.csv/route';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { getCodexSyncState } from '@/server/dal/documents';
import { getMachineType } from '@/server/dal/mtypes';
import { listAudit } from '@/server/dal/notifications';
import { getHealthThresholds, getSettings } from '@/server/dal/settings';
import {
  addConnectorAction, addSettingsEntryAction, createMachineTypeAction, removeRexReferenceAction, removeSettingsEntryAction, resetSettingsAction,
  setHealthThresholdAction, setMachineTypeCostCategoriesAction, setMachineTypeItpSystemsAction, setMachineTypePhasesAction, syncConnectorAction,
  updateMachineTypeAction,
} from './actions';

const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  viewer.role = role;
  viewer.lang = lang;
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  as('director');
  vi.mocked(revalidatePath).mockClear();
});

describe('Settings Server Functions', () => {
  it('refuses viewers outside the workspace (member, client), in their language', async () => {
    for (const role of ['member', 'client'] as RoleKey[]) {
      as(role);
      expect(await addSettingsEntryAction('skills', 'Welding')).toEqual({ error: 'Settings are read-only for you' });
      expect(await removeSettingsEntryAction('skills', 'structural')).toEqual({ error: 'Settings are read-only for you' });
      expect(await setHealthThresholdAction('risk', '0.95')).toEqual({ error: 'Settings are read-only for you' });
      expect(await resetSettingsAction()).toEqual({ error: 'Settings are read-only for you' });
    }
    as('client', 'fr');
    expect(await removeSettingsEntryAction('nope', '')).toEqual({ error: 'Les paramètres sont en lecture seule pour vous' });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await getSettings()).lists.skills).toHaveLength(10);
  });

  it('A-14: only the portfolio director edits; the other workspace roles are refused, in their language', async () => {
    for (const role of ['pm', 'depthead', 'englead', 'quality', 'procurement'] as RoleKey[]) {
      as(role);
      expect(await addSettingsEntryAction('skills', 'Welding')).toEqual({ error: 'Settings are edited by the portfolio director' });
      expect(await removeSettingsEntryAction('skills', 'structural')).toEqual({ error: 'Settings are edited by the portfolio director' });
      expect(await setHealthThresholdAction('risk', '0.95')).toEqual({ error: 'Settings are edited by the portfolio director' });
      expect(await resetSettingsAction()).toEqual({ error: 'Settings are edited by the portfolio director' });
    }
    as('pm', 'fr');
    expect(await addSettingsEntryAction('skills', 'Welding')).toEqual({ error: 'Seule la directrice de portefeuille modifie les paramètres' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('A-14: a value in use is deactivated, an unused custom one deleted; lifecycle stages are protected', async () => {
    expect(await addSettingsEntryAction('riskCats', 'Cyber')).toEqual({ ok: true });
    expect(await removeSettingsEntryAction('riskCats', 'cyber')).toEqual({ ok: true, toast: '"Cyber" removed' });
    expect(await removeSettingsEntryAction('riskCats', 'hse')).toMatchObject({ ok: true, toast: expect.stringMatching(/^"HSE \(safety\)" deactivated · still used by \d+ records?$/) });
    expect(await removeSettingsEntryAction('statuses', 'annule')).toEqual({ error: 'This stage is required by the lifecycle' });
    expect(await addSettingsEntryAction('statuses', 'Pré-série')).toEqual({ error: 'Project statuses are the lifecycle stages — a new stage needs a lifecycle definition' });
    expect(await removeSettingsEntryAction('statuses', 'fat')).toMatchObject({ ok: true });
    expect(await addSettingsEntryAction('statuses', 'fat')).toEqual({ ok: true });
    expect(await addSettingsEntryAction('riskCats', 'HSE (safety)')).toEqual({ ok: true });
    // A default value nobody uses (a holiday) is deactivated too, so that "Reset to defaults" can restore it.
    expect(await removeSettingsEntryAction('holidays', '2026-11-11')).toEqual({ ok: true, toast: '"11 Nov · Armistice" deactivated · default value, restored by Reset to defaults' });
    expect(await addSettingsEntryAction('holidays', '11 Nov · Armistice')).toEqual({ ok: true });
    as('director', 'fr');
    expect(await removeSettingsEntryAction('costCats', 'contingency')).toMatchObject({ ok: true, toast: expect.stringMatching(/^« Provision pour aléas » désactivé · encore utilisé par \d+ enregistrements$/) });
    as('director');
    expect(await addSettingsEntryAction('costCats', 'Contingency')).toEqual({ ok: true });
  });

  it('validates entries: list, blank, location type, holiday format, duplicates (messages translated)', async () => {
    as('director'); // A-14: the director edits Settings
    expect(await addSettingsEntryAction('locTypes', 'X')).toEqual({ error: 'Invalid request' });
    expect(await addSettingsEntryAction('skills', 42)).toEqual({ error: 'Invalid request' });
    expect(await addSettingsEntryAction('skills', '   ')).toEqual({ error: 'Entry is required' });
    expect(await addSettingsEntryAction('locations', ' ')).toEqual({ error: 'Location is required' });
    expect(await addSettingsEntryAction('locations', 'Dépôt — Dakar', 'warehouse')).toEqual({ error: 'Invalid location type' });
    expect(await addSettingsEntryAction('holidays', 'Saint-Étienne')).toEqual({ error: 'A holiday reads "14 Jul · Fête nationale"' });
    expect(await addSettingsEntryAction('holidays', '31 Feb · Nope')).toEqual({ error: 'A holiday reads "14 Jul · Fête nationale"' });
    expect(await addSettingsEntryAction('skills', 'Structural')).toEqual({ error: '"Structural" is already in the list' });
    // One holiday per date: the calendars key holidays by date (a second label would be listed but ignored).
    expect(await addSettingsEntryAction('holidays', '14 Jul · Bastille Day')).toEqual({ error: 'A holiday is already listed on that date' });
    as('director', 'fr');
    expect(await addSettingsEntryAction('holidays', '14 juil. · Fête de la Fédération')).toEqual({ error: 'Un jour férié est déjà inscrit à cette date' });
    expect(await addSettingsEntryAction('skills', 'structural')).toEqual({ error: '« structural » figure déjà dans la liste' });
    expect(await addSettingsEntryAction('locations', 'Entrepôt central — Lyon', 'workshop')).toEqual({ error: '« Entrepôt central — Lyon » est déjà un emplacement' });
    expect(await addSettingsEntryAction('holidays', 'Toussaint')).toEqual({ error: 'Un jour férié s’écrit « 14 juil. · Fête nationale »' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('adds and removes entries with the viewer as the author; a French holiday date is stored in English', async () => {
    as('director'); // A-14: the director edits Settings
    expect(await addSettingsEntryAction('skills', '  Welding  ')).toEqual({ ok: true });
    expect((await listAudit())[0]).toMatchObject({ who: 'Marie Lefebvre', object: 'Settings · Skills & levels', change: 'added "Welding"', area: 'Settings' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    as('director', 'fr');
    expect(await addSettingsEntryAction('holidays', '26 déc. · Saint-Étienne')).toEqual({ ok: true });
    expect(await addSettingsEntryAction('locations', 'Atelier électrique — Lyon', 'workshop')).toEqual({ ok: true });
    let s = await getSettings();
    expect(s.lists.skills.at(-1)).toEqual({ code: 'welding', label: 'Welding' });
    expect(s.lists.holidays.at(-1)).toEqual({ code: '2026-12-26', label: '26 Dec · Saint-Étienne' });
    expect(s.locations.at(-1)).toMatchObject({ name: 'Atelier électrique — Lyon', type: 'workshop' });
    // Default location type: central warehouse (the prototype's initial `locType`).
    expect(await addSettingsEntryAction('locations', 'Magasin chantier — Dakar')).toEqual({ ok: true });
    expect((await getSettings()).locations.at(-1)).toMatchObject({ name: 'Magasin chantier — Dakar', type: 'central_warehouse' });
    as('director');
    // A-14: "Supplier / delivery" is used by risks → deactivated, and the toast says so.
    expect(await removeSettingsEntryAction('riskCats', s.lists.riskCats[1].code)).toMatchObject({ ok: true, toast: expect.stringContaining('deactivated · still used by') });
    expect(await removeSettingsEntryAction('locations', 'Atelier électrique — Lyon')).toEqual({ ok: true });
    expect(await removeSettingsEntryAction('locations', 'Atelier électrique — Lyon')).toEqual({ error: 'Unknown location Atelier électrique — Lyon' });
    expect(await removeSettingsEntryAction('skills', 'nope')).toEqual({ error: 'Unknown entry' });
    s = await getSettings();
    expect(s.lists.riskCats.map((r) => r.label)).not.toContain('Supplier / delivery');
    expect(s.locations.some((l) => l.name === 'Atelier électrique — Lyon')).toBe(false);
  });

  it('thresholds: a number, off track under at risk; Reset to defaults restores everything', async () => {
    as('director'); // A-14: the director edits Settings
    expect(await setHealthThresholdAction('mid', '0.5')).toEqual({ error: 'Invalid request' });
    expect(await setHealthThresholdAction('off', 'abc')).toEqual({ error: 'Enter a threshold between 0 and 2' });
    expect(await setHealthThresholdAction('off', '0.98')).toEqual({ error: '"Off track below" must be lower than "At risk below"' });
    expect(await setHealthThresholdAction('risk', '5')).toEqual({ error: 'Enter a threshold between 0 and 2' });
    expect(await setHealthThresholdAction('risk', '0.95')).toEqual({ ok: true });
    expect(await setHealthThresholdAction('off', '0,85')).toEqual({ ok: true });
    expect(await getHealthThresholds()).toEqual({ risk: 0.95, off: 0.85 });
    as('director', 'fr');
    expect(await setHealthThresholdAction('off', '0.96')).toEqual({ error: '« Hors trajectoire sous » doit être inférieur à « À risque sous »' });
    expect(await resetSettingsAction()).toEqual({ ok: true, toast: 'Paramètres réinitialisés' });
    const s = await getSettings();
    expect([s.health, s.lists.skills.length, s.lists.riskCats.length, s.lists.holidays.length, s.locations.length]).toEqual([{ risk: 0.97, off: 0.9 }, 10, 7, 11, 6]);
  });
});

describe('Machine types Server Functions', () => {
  it('refuses viewers outside the workspace (depthead, member, procurement, client): mtCanEdit', async () => {
    for (const role of ['depthead', 'member', 'procurement', 'client'] as RoleKey[]) {
      as(role);
      expect(await updateMachineTypeAction('EMP', { active: false })).toEqual({ error: 'Machine types are read-only for you' });
      expect(await setMachineTypePhasesAction('EMP', ['A'])).toEqual({ error: 'Machine types are read-only for you' });
      expect(await setMachineTypeItpSystemsAction('nope', null)).toEqual({ error: 'Machine types are read-only for you' });
      expect(await setMachineTypeCostCategoriesAction('EMP', [])).toEqual({ error: 'Machine types are read-only for you' });
      expect(await removeRexReferenceAction('EMP', 'HAV001')).toEqual({ error: 'Machine types are read-only for you' });
      expect(await createMachineTypeAction({ code: 'X', label: 'X', base: 'EMP', cal: 'standard_5x8', desc: '' })).toEqual({ error: 'Machine types are read-only for you' });
    }
    as('procurement', 'fr');
    expect(await updateMachineTypeAction('EMP', { active: false })).toEqual({ error: 'Les types de machines sont en lecture seule pour vous' });
    expect((await getMachineType('EMP'))!.active).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('identity card and payment pattern: validation, parseInt || 0, a total other than 100 % is saved', async () => {
    as('englead');
    expect(await updateMachineTypeAction('NOPE', { label: 'x' })).toEqual({ error: 'Invalid request' });
    expect(await updateMachineTypeAction('EMP', { label: '  ' })).toEqual({ error: 'Label is required' });
    expect(await updateMachineTypeAction('EMP', { calendar: 'continuous_24h' })).toEqual({ error: 'Invalid calendar' });
    expect(await updateMachineTypeAction('EMP', { active: 'yes' })).toEqual({ error: 'Invalid request' });
    expect(await updateMachineTypeAction('EMP', { depositPct: '150' })).toEqual({ error: 'Deposit must be a whole percentage (0–100)' });
    as('englead', 'fr');
    expect(await updateMachineTypeAction('EMP', { deliveryPct: '-5' })).toEqual({ error: 'Livraison % : saisissez un pourcentage entier (0–100)' });
    expect(await updateMachineTypeAction('SPUR', { depositPct: '25', deliveryPct: 'x', calendar: 'standard_5x8', label: 'Rail', description: 'Rail lines' })).toEqual({ ok: true });
    expect(await getMachineType('SPUR')).toMatchObject({ depositPct: 25, deliveryPct: 0, acceptancePct: 10, termsOk: false, calendar: 'standard_5x8', label: 'Rail', description: 'Rail lines' });
    expect(await updateMachineTypeAction('rnd', { active: false })).toEqual({ ok: true });
    expect((await getMachineType('R&D'))!.active).toBe(false);
    expect((await listAudit())[0]).toMatchObject({ who: 'Antoine Girard', object: 'Machine type R&D', change: 'deactivated', area: 'Settings' });
  });

  it('phases, ITP systems, cost categories and REX references', async () => {
    as('quality');
    expect(await setMachineTypePhasesAction('AUTRE', 'Design')).toEqual({ error: 'Invalid request' });
    expect(await setMachineTypePhasesAction('AUTRE', ['Design', ' '])).toEqual({ error: 'Phase 2 is required' });
    expect(await setMachineTypePhasesAction('AUTRE', ['Design', 'Réalisation', 'New phase'])).toEqual({ ok: true });
    expect((await getMachineType('AUTRE'))!.phases).toEqual(['Design', 'Réalisation', 'New phase']);
    expect(await setMachineTypeItpSystemsAction('MEMU', ['Hoist', 'Hoist'])).toEqual({ error: 'ITP systems must be distinct' });
    expect(await setMachineTypeItpSystemsAction('MEMU', ['Hoist', 'New system'])).toEqual({ ok: true });
    expect(await setMachineTypeCostCategoriesAction('EMP', [{ name: 'X', type: 'reserve', budget: '1' }])).toEqual({ error: 'Category 1: invalid type' });
    expect(await setMachineTypeCostCategoriesAction('EMP', [{ name: 'X', type: 'labor', budget: 'abc' }])).toEqual({ error: 'Category 1: invalid budget' });
    expect(await setMachineTypeCostCategoriesAction('EMP', [{ name: 'X', type: 'labor', budget: '-1' }])).toEqual({ error: 'Category 1: invalid budget' });
    expect(await setMachineTypeCostCategoriesAction('EMP', [{ name: 'Études', type: 'labor', budget: '160' }, { name: 'New category', type: 'equipment', budget: '40.5' }])).toEqual({ ok: true });
    expect(await getMachineType('EMP')).toMatchObject({ costTotalKeur: 200.5, costCategories: [{ name: 'Études', type: 'labor' }, { name: 'New category', type: 'equipment', budgetKeur: 40.5 }] });
    as('quality', 'fr');
    expect(await setMachineTypeCostCategoriesAction('EMP', [{ name: 'X', type: 'labor', budget: '' }])).toEqual({ error: 'Catégorie 1 : budget invalide' });
    expect(await removeRexReferenceAction('EMP', 'NOPE')).toEqual({ error: 'Projet de référence inconnu : NOPE' });
    expect(await removeRexReferenceAction('EMP', 'HAV001')).toEqual({ ok: true });
    expect((await getMachineType('EMP'))!.rexReferences.map((r) => r.analyticCode)).toEqual(['ANT002']);
  });

  it('New machine type: code rule, unique code, Blank template, toast with the code', async () => {
    as('pm');
    expect(await createMachineTypeAction({ code: '  ', label: 'X', base: 'EMP', cal: 'standard_5x8' })).toEqual({ error: 'Code is required' });
    expect(await createMachineTypeAction({ code: 'X', label: ' ', base: 'EMP', cal: 'standard_5x8' })).toEqual({ error: 'Label is required' });
    expect(await createMachineTypeAction({ code: 'X', label: 'X', base: 'NOPE', cal: 'standard_5x8' })).toEqual({ error: 'Invalid request' });
    expect(await createMachineTypeAction({ code: 'X', label: 'X', base: 'EMP', cal: 'weekend' })).toEqual({ error: 'Invalid calendar' });
    expect(await createMachineTypeAction({ code: 'emp', label: 'Duplicate', base: 'EMP', cal: 'standard_5x8' })).toEqual({ error: 'Code already used' });
    expect(await createMachineTypeAction({ code: 'r&d', label: 'Duplicate', base: 'EMP', cal: 'standard_5x8' })).toEqual({ error: 'Code already used' });
    expect(await createMachineTypeAction({ code: ' new type ', label: 'Mobile hoist', base: 'R&D', cal: 'site_6x10', desc: 'Test' })).toEqual({ ok: true, code: 'NEW-TYPE', toast: 'NEW-TYPE · Machine type created' });
    expect(await getMachineType('NEW-TYPE')).toMatchObject({ isStandard: false, active: true, label: 'Mobile hoist', calendar: 'site_6x10', phases: ['Exploration', 'Prototype', 'Essais & itérations', 'Industrialisation', 'Bilan'], depositPct: 50 });
    as('pm', 'fr');
    expect(await createMachineTypeAction({ code: 'lab', label: 'Lab', base: 'blank', cal: 'Chantier 6d · 10h' })).toEqual({ ok: true, code: 'LAB', toast: 'LAB · Type de machine créé' });
    expect(await getMachineType('LAB')).toMatchObject({ phases: [], costCategories: [], itpSystems: ['General'], depositPct: 30, deliveryPct: 60, acceptancePct: 10 });
    expect(await createMachineTypeAction({ code: 'Lab', label: 'Lab', base: 'blank', cal: 'standard_5x8' })).toEqual({ error: 'Code déjà utilisé' });
  });
});

describe('Activity & integrations Server Functions and the audit export', () => {
  it('refuses viewers outside the workspace (every role but director and PM)', async () => {
    for (const role of ['depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as RoleKey[]) {
      as(role);
      expect(await syncConnectorAction('Lucca')).toEqual({ error: 'Activity & integrations is read-only for you' });
      expect(await addConnectorAction({ system: 'SharePoint', direction: 'import', freq: 'Daily', owner: '' })).toEqual({ error: 'Activity & integrations is read-only for you' });
      expect((await exportAudit(new Request('http://localhost/admin/integrations/audit.csv'))).status).toBe(403);
    }
    as('quality', 'fr');
    expect(await syncConnectorAction('Lucca')).toEqual({ error: 'Activité et intégrations est en lecture seule pour vous' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('"Sync now" (R-021): refused for missing, file-only and retired connectors; mock runs say they are simulated', async () => {
    as('pm');
    expect(await syncConnectorAction('Nope')).toEqual({ error: 'Invalid request' });
    // NEW-CURSUS-4: Lucca is unplugged, no longer listed (the prototype simulated "Lucca synced · 312 h · 8 people").
    expect(await syncConnectorAction('Lucca')).toEqual({ error: 'Invalid request' });
    const audits = (await listAudit()).length;
    // A-15: no connector exists for Sage X3, Outlook, Teams, SMTP or the PDM — nothing to simulate any more.
    expect(await syncConnectorAction('Sage X3')).toEqual({ error: 'Sage X3 is not connected — nothing to synchronise' });
    expect(await syncConnectorAction('MS Project')).toEqual({ error: 'MS Project exchanges files only — use the export cards' });
    as('pm', 'fr');
    expect(await syncConnectorAction('E-mail (SMTP)')).toEqual({ error: 'E-mail (SMTP) n’est pas connecté — rien à synchroniser' });
    expect((await listAudit()).length).toBe(audits);
    const before = (await getCodexSyncState())!;
    expect(await syncConnectorAction('Codex')).toEqual({ ok: true, toast: 'Codex · synchro simulée (connecteur simulé) · 412 fiches' });
    expect((await getCodexSyncState())!.syncedAt > before.syncedAt).toBe(true);
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'Connector Codex', change: 'sync (simulated) · 412 records · 38 linked to HLT-026' });
    const codex = (await listAdminConnectors()).find((c) => c.name === 'Codex')!;
    expect([codex.mode, codex.state, codex.lastSyncAt, codex.lastVolume]).toEqual(['mock', 'mock', null, '412 records · 38 linked to HLT-026']);
    as('director');
    expect(await syncConnectorAction('Vigie')).toEqual({ ok: true, toast: 'Vigie · simulated sync (mock connector) · 0 sent · 0 pending · 0 refreshed' });
    const cursus = await syncConnectorAction('Cursus');
    expect(cursus).toMatchObject({ ok: true });
    expect((cursus as { toast: string }).toast).toMatch(/^Cursus · simulated sync \(mock connector\) · \d+ approvals received$/);
    // A simulated run dates no sync.
    expect((await listAdminConnectors()).filter((c) => c.link === 'mock').map((c) => c.lastSyncAt)).toEqual([null, null, null]);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('"Add connector": the prototype\'s systems, frequencies and directions; listed at once; duplicates refused', async () => {
    as('director');
    expect(await addConnectorAction({ system: 'Nope', direction: 'import', freq: 'Daily' })).toEqual({ error: 'Invalid request' });
    expect(await addConnectorAction({ system: 'SharePoint', direction: 'up', freq: 'Daily' })).toEqual({ error: 'Invalid direction' });
    expect(await addConnectorAction({ system: 'SharePoint', direction: 'import', freq: 'Weekly' })).toEqual({ error: 'Invalid frequency' });
    // R-021: a listed connector is not necessarily connected — "already listed" (the prototype said "already connected").
    expect(await addConnectorAction({ system: 'Sage X3', direction: 'import', freq: 'Daily' })).toEqual({ error: 'Sage X3 is already listed' });
    // NEW-CURSUS-4: Lucca is no longer offered.
    expect(await addConnectorAction({ system: 'Lucca', direction: 'import', freq: 'Daily' })).toEqual({ error: 'Invalid request' });
    // R-021: no connector code exists behind an added row — it stays "Not connected" (the prototype toasted "first sync scheduled").
    expect(await addConnectorAction({ system: 'SharePoint', direction: 'both', freq: 'Hourly', owner: ' IT · Paul ' })).toEqual({ ok: true, toast: 'Connector added · not connected until IT sets it up' });
    expect((await listAdminConnectors()).at(-1)).toMatchObject({
      name: 'SharePoint', link: 'none', state: 'not_connected', statusLabel: 'Not connected', canSync: false, lastSyncAt: null, lastVolume: '', direction: 'both', owner: 'IT · Paul', addedInKeystone: true,
    });
    expect(await syncConnectorAction('SharePoint')).toEqual({ error: 'SharePoint is not connected — nothing to synchronise' });
    as('pm', 'fr');
    expect(await addConnectorAction({ system: 'SharePoint', direction: 'import', freq: 'Daily' })).toEqual({ error: 'SharePoint figure déjà dans les connecteurs' });
    expect(await addConnectorAction({ system: 'TIA Portal', direction: 'export', freq: 'Manual', owner: '' }))
      .toEqual({ ok: true, toast: 'Connecteur ajouté · non connecté tant que l’informatique ne l’a pas mis en place' });
  });

  it('exports the audit trail as CSV (ISO 9001) for the director and the PM', async () => {
    as('director', 'fr');
    const res = await exportAudit(new Request('http://localhost/admin/integrations/audit.csv'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="keystone-audit-trail-\d{4}-\d{2}-\d{2}\.csv"$/);
    const body = await res.text();
    const lines = body.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('Quand (UTC),Qui,Objet,Modification,Domaine,Projet');
    const all = await listAudit({ limit: 1_000_000 });
    expect(lines.length).toBe(all.length + 2);
    expect(lines).toContain('2026-09-25T07:12:00.000Z,Romain Aubert,CR-008,status: Draft → In review,Change control,');
  });
});
