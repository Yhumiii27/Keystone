// Project team Server Functions and DAL (R-041, P-2) against an in-memory database (session mocked, real project context):
// who manages the team (director, the project's PMs), validation, the DAL refusals (client contact, PM of record, duplicates),
// audit and activity, and the rights that follow the team (getProjectContext) — plus the demo referents' seed and backfill.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { eq, isNotNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { persons, projects } from '@/server/db/schema';
import { demoReferentsToBackfill, seedDemoReferents } from '@/server/db/seed/project-team';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getPersonByName } from '@/server/dal/people';
import { getNamedTeam, leadProjectCodes, leadsProject, listProjectTeams, memberProjectCodes, teamCandidates } from '@/server/dal/project-team';
import { getProjectContext } from '@/server/project-context';
import { addTeamMemberAction, removeTeamMemberAction, setTeamMemberRoleAction } from './team-actions';

const as = (role: string, lang: 'en' | 'fr' = 'en') => Object.assign(session, { role, lang });
const idOf = async (name: string) => (await getPersonByName(name))!.id;
const roleOn = async (code: string, name: string) => (await getNamedTeam(code)).find((m) => m.name === name)?.role ?? null;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  as('director');
  vi.mocked(revalidatePath).mockClear();
});

describe('named team (DAL)', () => {
  it('Harbor Line: the PM of record first, the DEFS team, then the seeded referents; candidates are staff not on it', async () => {
    const team = await getNamedTeam('HLT-026');
    expect(team[0]).toMatchObject({ name: 'Romain Aubert', role: 'pm', primary: true });
    expect(team.slice(-2).map((m) => [m.name, m.role])).toEqual([['Antoine Girard', 'referent'], ['Gabriel Comte', 'referent']]);
    expect(team.filter((m) => m.primary)).toHaveLength(1);
    const candidates = await teamCandidates('HLT-026');
    expect(candidates.some((c) => team.some((m) => m.personId === c.personId))).toBe(false);
    expect(candidates.some((c) => c.name === 'Nadia Bensaïd')).toBe(false); // client contacts never join
    expect(candidates.map((c) => c.name)).toEqual([...candidates.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'fr')));
    const teams = await listProjectTeams();
    expect(teams.get('HLT-026')!.map((m) => m.personId)).toEqual(team.map((m) => m.personId));
  });

  it('lead and member projects of a person; leadsProject', async () => {
    const db = await getDb();
    const ra = await idOf('Romain Aubert');
    expect(await leadProjectCodes(db, ra)).toContain('HLT-026');
    expect(await memberProjectCodes(db, await idOf('Antoine Girard'))).toContain('HLT-026');
    expect(await leadProjectCodes(db, await idOf('Antoine Girard'))).not.toContain('HLT-026'); // a referent does not lead
    const [hlt] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    expect([await leadsProject(db, hlt.id, ra), await leadsProject(db, hlt.id, await idOf('Gabriel Comte')), await leadsProject(db, hlt.id, null)]).toEqual([true, false, false]);
  });

  it('demo referents: seeded once; a pre-delivery-7 database is backfilled once (idempotent)', async () => {
    const db = await getDb();
    expect(await demoReferentsToBackfill(db)).toBe(false); // rows other than 'team' exist already
    const before = (await getNamedTeam('HLT-026')).length;
    await db.transaction((tx) => seedDemoReferents(tx));
    expect((await getNamedTeam('HLT-026')).length).toBe(before);
  });
});

describe('project team Server Functions', () => {
  it('the director adds a deputy to NDC-031: audit, activity, and the PM rights follow (L-4b)', async () => {
    const gc = await idOf('Gabriel Comte');
    as('quality');
    expect((await getProjectContext('NDC-031')).readOnly).toBe(true);
    as('director');
    expect(await addTeamMemberAction('NDC-031', { person: gc, role: 'deputy' })).toEqual({ toast: 'Added to the project team · Deputy project manager' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await roleOn('NDC-031', 'Gabriel Comte')).toBe('deputy');
    expect((await listAudit({ projectCode: 'NDC-031' }))[0]).toMatchObject({ who: 'Marie Lefebvre', object: 'Team NDC-031', change: 'added Gabriel Comte · Deputy project manager', area: 'Project team' });
    expect((await listActivity({ limit: 1 }))[0]).toMatchObject({ who: 'Marie Lefebvre', what: 'Added Gabriel Comte to the team of NDC-031 · Deputy project manager', projectCode: 'NDC-031' });
    as('quality');
    const ctx = await getProjectContext('NDC-031');
    expect([ctx.readOnly, ctx.isMine, ctx.isLead, ctx.access.teamRole]).toEqual([false, true, true, 'deputy']);
    // A deputy leads but does not manage the team.
    expect(await setTeamMemberRoleAction('NDC-031', gc, 'pm')).toEqual({ error: 'Only the project manager or the director changes the project team' });
    as('director', 'fr');
    expect(await setTeamMemberRoleAction('NDC-031', gc, 'referent')).toEqual({ ok: true, toast: 'Rôle dans l’équipe modifié · Référent' });
    expect(await setTeamMemberRoleAction('NDC-031', gc, 'referent')).toEqual({ ok: true, toast: 'Rôle dans l’équipe modifié · Référent' }); // unchanged: no-op
    as('quality');
    expect((await getProjectContext('NDC-031')).isLead).toBe(false);
    as('director');
    expect(await removeTeamMemberAction('NDC-031', gc)).toEqual({ ok: true, toast: 'Removed from the project team' });
    expect(await roleOn('NDC-031', 'Gabriel Comte')).toBeNull();
    as('quality');
    expect((await getProjectContext('NDC-031')).readOnly).toBe(true);
  });

  it('the PM of the project manages its team; other PMs, referents, members and outside viewers do not; the client is sent home', async () => {
    const jw = await idOf('Julien Wagner');
    const onHlt = (await roleOn('HLT-026', 'Julien Wagner')) != null;
    as('pm');
    if (onHlt) expect(await removeTeamMemberAction('HLT-026', jw)).toEqual({ ok: true, toast: 'Removed from the project team' });
    expect(await addTeamMemberAction('HLT-026', { person: jw, role: 'team' })).toEqual({ toast: 'Added to the project team · Team member' });
    expect(await roleOn('HLT-026', 'Julien Wagner')).toBe('team');
    const refused = { error: 'Only the project manager or the director changes the project team' };
    expect(await addTeamMemberAction('NDC-031', { person: jw, role: 'team' })).toEqual(refused); // not their project
    for (const role of ['englead', 'quality', 'member', 'depthead', 'procurement']) {
      as(role);
      expect(await setTeamMemberRoleAction('HLT-026', jw, 'deputy'), role).toEqual(refused);
    }
    as('member', 'fr');
    expect(await removeTeamMemberAction('HLT-026', jw)).toEqual({ error: 'Seuls le chef de projet et le directeur modifient l’équipe projet' });
    as('client');
    await expect(addTeamMemberAction('HLT-026', { person: jw, role: 'pm' })).rejects.toThrow('REDIRECT /');
    expect(await roleOn('HLT-026', 'Julien Wagner')).toBe('team');
  });

  it('validation and the DAL refusals, in the viewer\'s language; nothing written', async () => {
    const db = await getDb();
    const ra = await idOf('Romain Aubert');
    const ag = await idOf('Antoine Girard');
    const [contact] = await db.select({ id: persons.id }).from(persons).where(isNotNull(persons.clientId)).limit(1);
    const invalid = { error: 'Invalid request' };
    expect(await addTeamMemberAction('HLT-026', { person: 'nope', role: 'team' })).toEqual(invalid);
    expect(await addTeamMemberAction('HLT-026', { person: ag, role: 'owner' })).toEqual(invalid);
    expect(await addTeamMemberAction('HLT-026', null as never)).toEqual(invalid);
    expect(await setTeamMemberRoleAction('HLT-026', 42 as never, 'team')).toEqual(invalid);
    expect(await removeTeamMemberAction(7 as never, ag)).toEqual(invalid);
    expect(await addTeamMemberAction('NOPE-1', { person: ag, role: 'team' })).toEqual({ error: 'Unknown project' });
    expect(await addTeamMemberAction('HLT-026', { person: '00000000-0000-4000-8000-000000000000', role: 'team' })).toEqual({ error: 'Unknown person' });
    if (contact) expect(await addTeamMemberAction('HLT-026', { person: contact.id, role: 'team' })).toEqual({ error: 'A client contact cannot join the project team' });
    expect(await addTeamMemberAction('HLT-026', { person: ag, role: 'team' })).toEqual({ error: 'Already on the project team' });
    expect(await addTeamMemberAction('HLT-026', { person: ra, role: 'team' })).toEqual({ error: 'Already on the project team' });
    expect(await setTeamMemberRoleAction('HLT-026', ra, 'team')).toEqual({ error: 'The project manager of record is changed in the Projects register' });
    expect(await removeTeamMemberAction('HLT-026', ra)).toEqual({ error: 'The project manager of record is changed in the Projects register' });
    as('director', 'fr');
    expect(await removeTeamMemberAction('NDC-031', ag)).toEqual({ error: 'Absent de l’équipe projet' });
    expect(await setTeamMemberRoleAction('NDC-031', ag, 'team')).toEqual({ error: 'Absent de l’équipe projet' });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await roleOn('HLT-026', 'Antoine Girard')).toBe('referent');
  });
});
