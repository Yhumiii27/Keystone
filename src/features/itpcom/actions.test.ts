// ITP · punch list and Commissioning Server Functions against an in-memory database: permission gate (read-only project
// or outside the workspace, re-checked by the data-layer writers), parsing of the three action forms (toasts, numbering
// I-20… / P-10… per project, owner normalised to the short name, codes stored), the punch step with its status guard,
// Plan SAT dating the system's SAT step, and the viewer as the actor. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', role: 'director', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name, role: viewer.role }, canEdit: () => viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getCommissioning } from '@/server/dal/commissioning';
import { getItpPlan, listPunchItems, openPunchAByProject } from '@/server/dal/itp';
import { listAudit } from '@/server/dal/notifications';
import { addInspectionAction, addPunchItemAction, advancePunchItemAction, planSatAction } from './actions';

const punch = async (n: string, code = 'HLT-026') => (await listPunchItems(code, 'itp')).find((r) => r.number === n);

describe('ITP · commissioning Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    Object.assign(viewer, { name: 'Marie Lefebvre', role: 'director', canEdit: true, lang: 'en' });
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses read-only viewers, unknown projects and malformed requests', async () => {
    viewer.canEdit = false;
    expect(await addInspectionAction('HLT-026', { name: 'x' })).toEqual({ error: 'This inspection plan is read-only for you' });
    expect(await addPunchItemAction('HLT-026', { item: 'x' })).toEqual({ error: 'This inspection plan is read-only for you' });
    expect(await advancePunchItemAction('HLT-026', 'P-02', 'open')).toEqual({ error: 'This inspection plan is read-only for you' });
    expect(await planSatAction('HLT-026', { date: '10 Dec 2026' })).toEqual({ error: 'This commissioning plan is read-only for you' });
    viewer.lang = 'fr';
    expect(await advancePunchItemAction('HLT-026', 'P-02', 'open')).toEqual({ error: 'Ce plan d’inspection est en consultation pour vous' });
    expect(await planSatAction('HLT-026', {})).toEqual({ error: 'Ce plan de mise en service est en consultation pour vous' });
    viewer.canEdit = true;
    expect(await addInspectionAction('NOPE-000', { name: 'x' })).toEqual({ error: 'Projet inconnu' });
    viewer.lang = 'en';
    expect(await addPunchItemAction('' as string, { item: 'x' })).toEqual({ error: 'Invalid request' });
    expect(await advancePunchItemAction('HLT-026', 42 as never, 'open')).toEqual({ error: 'Invalid request' });
    expect(await advancePunchItemAction('HLT-026', 'P-02', 'Open')).toEqual({ error: 'Invalid request' });
    expect(await advancePunchItemAction('HLT-026', 'P-02', undefined as never)).toEqual({ error: 'Invalid request' });
    expect(await advancePunchItemAction('HLT-026', 'P-99', 'open')).toEqual({ error: 'Unknown punch item' });
    expect(await addInspectionAction('HLT-026', null as never)).toEqual({ error: 'Inspection / test is required' });
    expect((await punch('P-02'))!.status).toBe('open');
    expect(revalidatePath).not.toHaveBeenCalled();
    // A row someone else moved on: refused (no second step) and the stale page refreshed.
    expect(await advancePunchItemAction('HLT-026', 'P-01', 'in_progress')).toEqual({ error: 'This punch item is already closed' });
    expect(await advancePunchItemAction('HLT-026', 'P-04', 'open')).toEqual({ error: 'This punch item has already moved on' });
    viewer.lang = 'fr';
    expect(await advancePunchItemAction('HLT-026', 'P-02', 'in_progress')).toEqual({ error: 'Cette réserve a déjà avancé' });
    expect([(await punch('P-02'))!.status, (await punch('P-04'))!.status]).toEqual(['open', 'in_progress']);
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
  });

  it('a viewer outside the workspace is refused by the writers too (procurement, member)', async () => {
    for (const role of ['procurement', 'member']) {
      viewer.role = role;
      expect(await addPunchItemAction('HLT-026', { item: 'Outside' })).toEqual({ error: 'The change could not be saved' });
      expect(await advancePunchItemAction('HLT-026', 'P-02', 'open')).toEqual({ error: 'The change could not be saved' });
      expect(await planSatAction('HLT-026', { date: '10 Dec 2026' })).toEqual({ error: 'The change could not be saved' });
    }
    expect((await listPunchItems('HLT-026', 'itp')).length).toBe(5);
    expect((await punch('P-02'))!.status).toBe('open');
  });

  it('"Add inspection": I-20, Planned, in its system group; codes stored; toast; viewer in the audit trail', async () => {
    viewer.name = 'Romain Aubert';
    viewer.role = 'pm';
    const r = await addInspectionAction('HLT-026', { name: 'Rope end terminations', system: 'Hoist mechanisms', type: 'witness', stage: 'site', ref: 'EN 12385', date: '6 Nov' });
    expect(r).toEqual({ toast: 'Inspection added to the plan' });
    const plan = (await getItpPlan('HLT-026'))!;
    expect(plan.inspections.filter((i) => i.system === 'Hoist mechanisms').map((i) => [i.number, i.name, i.pointType, i.stage, i.reference, i.plannedOn, i.result])).toEqual([
      ['I-05', 'Rope & drum inspection', 'witness', 'workshop', 'FEM 1.001', '2026-10-15', 'planned'],
      ['I-06', 'Brake test — 125 % load', 'hold', 'fat', 'EN 13001', '2026-11-20', 'planned'],
      ['I-20', 'Rope end terminations', 'witness', 'site', 'EN 12385', '2026-11-06', 'planned'],
    ]);
    expect([plan.inspections.length, plan.customCount]).toEqual([14, 3]);
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    const [audit] = await listAudit({ projectCode: 'HLT-026', limit: 1 });
    expect([audit.who, audit.object, audit.area]).toEqual(['Romain Aubert', 'I-20', 'ITP']);
    viewer.lang = 'fr';
    expect(await addInspectionAction('HLT-026', { name: 'Contrôle', system: 'Structure', date: '14 janv.' })).toEqual({ toast: 'Inspection ajoutée au plan' });
    expect((await getItpPlan('HLT-026'))!.inspections.at(-1)).toMatchObject({ number: 'I-21', system: 'Structure', pointType: 'hold', stage: 'workshop', plannedOn: '2027-01-14' });
    expect(await addInspectionAction('HLT-026', { name: 'x', system: 'Track' })).toEqual({ error: 'Système inconnu' });
    expect(await addInspectionAction('HLT-026', { name: 'x', date: 'demain' })).toEqual({ error: 'Saisissez la date prévue sous forme de date, par ex. 15 oct.' });
  });

  it('"Add inspection" on a project without a plan builds one from its machine type (NDC-031: AUTRE, General)', async () => {
    expect(await getItpPlan('NDC-031')).toBeNull();
    expect(await addInspectionAction('NDC-031', { name: 'Visual check' })).toEqual({ toast: 'Inspection added to the plan' });
    const plan = (await getItpPlan('NDC-031'))!;
    expect([plan.template, plan.systems, plan.customCount, plan.inspections.map((i) => [i.number, i.system])]).toEqual(['AUTRE', ['General'], 1, [['I-20', 'General']]]);
  });

  it('"Add punch item": P-10, Open, owner as short name; an A item feeds the badge and Commissioning "Blocking A"; Start / Close', async () => {
    viewer.name = 'Gabriel Comte';
    viewer.role = 'quality';
    expect(await addPunchItemAction('HLT-026', { item: 'Missing bolt — post 3', loc: 'Structure · Bay 2', cat: 'A', src: 'sat', owner: 'Julien Wagner', due: '9 Oct' })).toEqual({ toast: 'Punch item added' });
    expect(await punch('P-10')).toMatchObject({ description: 'Missing bolt — post 3', location: 'Structure · Bay 2', category: 'A', source: 'sat', sourceText: 'SAT', owner: 'J. Wagner', dueOn: '2026-10-09', status: 'open' });
    expect(await openPunchAByProject()).toEqual({ 'HLT-026': 1 });
    const c = (await getCommissioning('HLT-026'))!;
    expect(c.systems.map((s) => s.blockingA)).toEqual([1, 0, 0, 0, 0, 0]);

    expect(await advancePunchItemAction('HLT-026', 'P-10', 'open')).toEqual({ ok: true });
    expect((await punch('P-10'))!.status).toBe('in_progress');
    expect(await openPunchAByProject()).toEqual({ 'HLT-026': 1 });
    // A second click on the stale "Start" does not close the item.
    expect(await advancePunchItemAction('HLT-026', 'P-10', 'open')).toEqual({ error: 'This punch item has already moved on' });
    expect(await advancePunchItemAction('HLT-026', 'P-10', 'in_progress')).toEqual({ ok: true });
    expect((await punch('P-10'))!.status).toBe('closed');
    expect(await openPunchAByProject()).toEqual({});
    expect(await advancePunchItemAction('HLT-026', 'P-10', 'in_progress')).toEqual({ error: 'This punch item is already closed' });
    const [audit] = await listAudit({ projectCode: 'HLT-026', limit: 1 });
    expect([audit.who, audit.object, audit.change]).toEqual(['Gabriel Comte', 'P-10', 'status: In progress → Closed']);

    expect(await addPunchItemAction('HLT-026', { item: 'Label', cat: 'C — cosmetic' })).toEqual({ toast: 'Punch item added' });
    expect(await punch('P-11')).toMatchObject({ category: 'C', source: 'site_walk', owner: 'A. Ollivier', location: '', dueOn: null });
    expect(await addPunchItemAction('HLT-026', { item: 'x', owner: 'Nobody' })).toEqual({ error: 'Unknown owner' });
    viewer.lang = 'fr';
    expect(await addPunchItemAction('HLT-026', { item: '' })).toEqual({ error: 'L’élément est obligatoire' });
  });

  it('"Plan SAT": dates the system’s SAT step; refused before the status date, without a plan, or once the SAT is done', async () => {
    viewer.name = 'Romain Aubert';
    viewer.role = 'pm';
    expect(await planSatAction('HLT-026', { system: 'Hoist mechanisms', date: '17 Dec 2026', client: 'N. Bensaïd', note: 'Punch A items closed' })).toEqual({ toast: 'SAT planned · invitation sent to the client' });
    const c = (await getCommissioning('HLT-026'))!;
    expect(c.systems[1].cells.find((x) => x.step === 'sat')).toMatchObject({ status: 'planned', dateOn: '2026-12-17' });
    expect(c.satPlans.at(-1)).toMatchObject({ system: 'Hoist mechanisms', plannedOn: '2026-12-17', clientWitnesses: 'N. Bensaïd', prerequisites: 'Punch A items closed', plannedBy: 'Romain Aubert' });
    viewer.lang = 'fr';
    expect(await planSatAction('HLT-026', { system: 'Structure', date: '10 déc. 2026' })).toEqual({ toast: 'SAT planifiée · invitation envoyée au client' });
    expect(await planSatAction('HLT-026', { date: '20 sept. 2026' })).toEqual({ error: 'La date de SAT ne peut pas précéder la date d’état' });
    viewer.lang = 'en';
    expect(await planSatAction('HLT-026', { system: 'Track', date: '10 Dec 2026' })).toEqual({ error: 'Unknown system' });
  });

  it('"Plan SAT" on a project without a commissioning plan: the inspection template systems; recorded, no grid created', async () => {
    viewer.name = 'Marie Lefebvre';
    viewer.role = 'director';
    expect(await planSatAction('NDC-031', { system: 'Structure', date: '10 Dec 2026' })).toEqual({ error: 'Unknown system' });
    expect(await planSatAction('NDC-031', { date: '' })).toEqual({ error: 'Date is required' });
    expect(await planSatAction('NDC-031', { date: '3 Feb 2027', client: 'K. Doucouré' })).toEqual({ toast: 'SAT planned · invitation sent to the client' });
    expect(await getCommissioning('NDC-031')).toBeNull();
    const [audit] = await listAudit({ projectCode: 'NDC-031', limit: 1 });
    expect([audit.who, audit.object, audit.change, audit.area]).toEqual(['Marie Lefebvre', 'SAT · General', 'SAT planned 3 Feb 2027 · witnesses K. Doucouré', 'Commissioning']);
  });
});
