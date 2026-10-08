// Team & exchanges Server Functions against an in-memory database: permission gate, prototype parsing of the two
// add-forms (toasts, numbering IF-10… per project, owner normalised to the short name), the interface row actions
// with their status guards, and the viewer as the actor. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', canEdit: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { name: viewer.name }, canEdit: () => viewer.canEdit }),
}));

import { revalidatePath } from 'next/cache';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listInterfaces } from '@/server/dal/interfaces';
import { listAudit } from '@/server/dal/notifications';
import { getStakeholderRegister } from '@/server/dal/stakeholders';
import { teamOwnerOptions } from '@/server/dal/team';
import { addStakeholderAction, createInterfaceAction, freezeInterfaceAction, markInterfaceReceivedAction } from './actions';
import { interfacesView } from './model';

const ifc = async (n: string, code = 'HLT-026') => (await listInterfaces(code)).find((r) => r.number === n);

describe('team Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.name = 'Marie Lefebvre';
    viewer.canEdit = true;
    viewer.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses read-only viewers, unknown projects and malformed requests', async () => {
    viewer.canEdit = false;
    expect(await addStakeholderAction('HLT-026', { name: 'x', org: 'y' })).toEqual({ error: 'This stakeholder register is read-only for you' });
    expect(await createInterfaceAction('HLT-026', { title: 'x' })).toEqual({ error: 'This interface register is read-only for you' });
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-07')).toEqual({ error: 'This interface register is read-only for you' });
    expect(await freezeInterfaceAction('HLT-026', 'IF-01')).toEqual({ error: 'This interface register is read-only for you' });
    viewer.lang = 'fr';
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-07')).toEqual({ error: 'Ce registre des interfaces est en consultation pour vous' });
    viewer.canEdit = true;
    expect(await addStakeholderAction('NOPE-000', { name: 'x', org: 'y' })).toEqual({ error: 'Projet inconnu' });
    viewer.lang = 'en';
    expect(await createInterfaceAction('' as string, { title: 'x' })).toEqual({ error: 'Invalid request' });
    expect(await markInterfaceReceivedAction('HLT-026', 42 as never)).toEqual({ error: 'Invalid request' });
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-99')).toEqual({ error: 'Unknown interface' });
    expect((await ifc('IF-07'))!.status).toBe('late');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('"Add stakeholder": toast, appended with last contact 30 Sep and notes "New", owner as short name, viewer in the audit trail', async () => {
    viewer.name = 'Romain Aubert';
    const team = await teamOwnerOptions('HLT-026');
    const owner = team[1];
    expect(await addStakeholderAction('HLT-026', { name: ' Yves Morel ', org: 'Bureau Veritas', role: 'Inspector', type: 'third_party', contact: 'y.morel@bv.com', owner })).toEqual({
      toast: 'Stakeholder added',
    });
    const reg = await getStakeholderRegister('HLT-026');
    expect(reg.stakeholders).toHaveLength(9);
    expect(reg.stakeholders.at(-1)).toMatchObject({
      name: 'Yves Morel', organisation: 'Bureau Veritas', role: 'Inspector', type: 'third_party', contactEmail: 'y.morel@bv.com', lastText: '30 Sep', notes: 'New', stale: false,
    });
    expect(reg.stakeholders.at(-1)!.owner).toMatch(/^[A-Z]\. /);
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'Yves Morel', area: 'Stakeholders' });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
    viewer.lang = 'fr';
    expect(await addStakeholderAction('HLT-026', { name: 'A', org: 'B' })).toEqual({ toast: 'Partie prenante ajoutée' });
  });

  it('"Add stakeholder" validation: name, organisation, type, e-mail, TEAM owner; forged payloads refused, never thrown on', async () => {
    expect(await addStakeholderAction('HLT-026', { name: ' ', org: 'B' })).toEqual({ error: 'Name is required' });
    expect(await addStakeholderAction('HLT-026', { name: 'A', org: '' })).toEqual({ error: 'Organisation is required' });
    expect(await addStakeholderAction('HLT-026', { name: 'A', org: 'B', type: 'regulator' })).toEqual({ error: 'Unknown stakeholder type' });
    expect(await addStakeholderAction('HLT-026', { name: 'A', org: 'B', contact: 'nope' })).toEqual({ error: 'Enter a valid e-mail address' });
    expect(await addStakeholderAction('HLT-026', { name: 'A', org: 'B', owner: 'Nadia Bensaïd' })).toEqual({ error: 'Unknown owner' });
    expect(await addStakeholderAction('HLT-026', { name: 42, org: 'B' } as never)).toEqual({ error: 'Name is required' });
    expect(await addStakeholderAction('HLT-026', null as never)).toEqual({ error: 'Name is required' });
    viewer.lang = 'fr';
    expect(await addStakeholderAction('HLT-026', { name: 'A', org: 'B', contact: 'nope' })).toEqual({ error: 'Saisissez une adresse e-mail valide' });
  });

  it('"New interface": toast, IF-10 Open needed 2 Nov (in 32 d); a past need date is Late at once; per-project numbering', async () => {
    viewer.name = 'Romain Aubert';
    const team = await teamOwnerOptions('HLT-026');
    expect(await createInterfaceAction('HLT-026', { title: 'Port Wi-Fi coverage', a: 'automation', b: 'Client · IT', data: 'Coverage map', needed: '2 Nov', owner: team[0] })).toEqual({
      toast: 'Interface registered',
    });
    expect(await ifc('IF-10')).toMatchObject({ title: 'Port Wi-Fi coverage', keystoneSide: 'automation', neededBy: '2026-11-02', daysToNeed: 32, status: 'open', providedText: '—' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'IF-10', area: 'Interfaces' });
    expect(await createInterfaceAction('HLT-026', { title: 'Old', b: 'Client', data: 'x', needed: '28/09/2026' })).toEqual({ toast: 'Interface registered' });
    expect(await ifc('IF-11')).toMatchObject({ status: 'late', daysToNeed: -2, keystoneSide: 'process' });
    expect(await createInterfaceAction('EWA-051', { title: 'Grid connection', a: 'electrical', b: 'Utility', data: 'Connection date', needed: '15 déc.' })).toEqual({ toast: 'Interface registered' });
    expect(await ifc('IF-10', 'EWA-051')).toMatchObject({ neededBy: '2026-12-15', status: 'open' });
  });

  it('"New interface" needed in another year keeps the year on screen (14 Jan 2027, in 104 d; FR "14 janv. 2027")', async () => {
    expect(await createInterfaceAction('HLT-026', { title: 'Crane rail survey', b: 'Client · civil works', data: 'Rail alignment report', needed: '14 Jan 2027' })).toEqual({
      toast: 'Interface registered',
    });
    const row = (await listInterfaces('HLT-026')).find((r) => r.title === 'Crane rail survey')!;
    expect(row).toMatchObject({ neededBy: '2027-01-14', neededText: '14 Jan 2027', daysToNeed: 104, status: 'open', providedText: '—' });
    const fr = interfacesView([row], [], makeT('fr'), 'fr').rows[0];
    expect([fr.needed, fr.neededSub, fr.status]).toEqual(['14 janv. 2027', 'dans 104 j', 'Ouverte']);
    expect(interfacesView([row], [], makeT('en'), 'en').rows[0].needed).toBe('14 Jan 2027');
  });

  it('"New interface" validation: required fields, need date, Keystone side, TEAM owner', async () => {
    expect(await createInterfaceAction('HLT-026', { title: '', b: 'B', data: 'D', needed: '1 Oct' })).toEqual({ error: 'Interface is required' });
    expect(await createInterfaceAction('HLT-026', { title: 'T', b: 'B', data: 'D', needed: 'next week' })).toEqual({ error: 'Enter the need date as a date, e.g. 15 Oct' });
    expect(await createInterfaceAction('HLT-026', { title: 'T', a: 'civil', b: 'B', data: 'D', needed: '1 Oct' })).toEqual({ error: 'Unknown Keystone side' });
    expect(await createInterfaceAction('HLT-026', { title: 'T', b: 'B', data: 'D', needed: '1 Oct', owner: 'Nobody' })).toEqual({ error: 'Unknown owner' });
    viewer.lang = 'fr';
    expect(await createInterfaceAction('HLT-026', { title: 'T', b: 'B', data: 'D', needed: '' })).toEqual({ error: 'La date de besoin est obligatoire' });
  });

  it('"Mark received" (Open or Late) then "Freeze" (Received); refused out of order', async () => {
    viewer.name = 'Antoine Girard';
    expect(await freezeInterfaceAction('HLT-026', 'IF-07')).toEqual({ error: 'Only a received interface can be frozen' });
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-07')).toEqual({ ok: true });
    expect(await ifc('IF-07')).toMatchObject({ status: 'received', statusLabel: 'Received' });
    expect((await listAudit())[0]).toMatchObject({ who: 'Antoine Girard', object: 'IF-07', change: 'status: Late → Received' });
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-07')).toEqual({ error: 'This interface is no longer open' });
    expect(await freezeInterfaceAction('HLT-026', 'IF-07')).toEqual({ ok: true });
    expect((await ifc('IF-07'))!.status).toBe('frozen');
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-03')).toEqual({ error: 'This interface is no longer open' });
    expect(await markInterfaceReceivedAction('HLT-026', 'IF-02')).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/projects/HLT-026', 'layout');
  });
});
