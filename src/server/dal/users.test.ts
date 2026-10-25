// Real users (R-039) in the data layer: one account per person with several roles, department and organisation; the
// demo personas seeded as users (e-mail, department as in personas.ts) and backfilled on an older database; per-user
// records keyed by the user, not the role (notification read state, prioritisation weights); notification audiences by
// role reach every holder, a personal notice reaches its person only; project ownership by person and organisation.
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS, PERSONA_BY_ROLE, type Persona } from '@/config/personas';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { persons, users } from '@/server/db/schema';
import { backfillDemoUsers, demoUsersToBackfill } from '@/server/db/seed/users';
import { isMineProject } from '@/server/project-context';
import { notifyRequestEvent } from './requests-screens';
import { countUnreadNotifications, createNotification, listNotifications, markAllNotificationsRead } from './notifications';
import { getScoreWeights, setScoreWeight } from './prioritisation';
import { listProjectTeams } from './project-team';
import { listProjects } from './projects';
import { getUserAccount, isUniqueViolation, listUserAccounts, signInUser, userIdOf } from './users';

const personId = async (fullName: string) => {
  const db = await getDb();
  const [p] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, fullName));
  return p.id;
};

/** A real (signed-in) viewer for an account. */
const viewerOf = async (userId: string, role: Persona['role']): Promise<Persona> => {
  const a = (await getUserAccount(userId))!;
  return { role, roles: a.roles, name: a.fullName ?? a.shortName, title: a.title, initials: a.initials, short: a.shortName, email: a.email, organisation: a.organisation, department: a.department, personId: a.personId, userId: a.userId };
};

describe('users', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('seeds the 10 personas as users (R-044: + Finance; R-158: + Logistics), one per person, with the e-mail and department of personas.ts', async () => {
    const accounts = await listUserAccounts();
    expect(accounts).toHaveLength(PERSONAS.length);
    expect(PERSONAS).toHaveLength(10);
    expect(new Set(accounts.map((a) => a.personId)).size).toBe(10);
    for (const p of PERSONAS) {
      const a = accounts.find((x) => x.personaRole === p.role)!;
      expect({ name: a.fullName, roles: a.roles, email: a.email, department: a.department, organisation: a.organisation, title: a.title }, p.role).toEqual({
        name: p.name, roles: [p.role], email: p.email, department: p.department, organisation: p.organisation, title: p.title,
      });
    }
    const db = await getDb();
    const [romain] = await db.select({ email: persons.email }).from(persons).where(eq(persons.fullName, 'Romain Aubert'));
    expect(romain.email).toBe('romain.aubert@epc2i.fr');
  });

  it('backfills the persona users of a database seeded before migration 0007, once', async () => {
    const db = await getDb();
    await db.update(users).set({ roles: [], email: null, departmentId: null }).where(eq(users.personaRole, 'member'));
    expect(await demoUsersToBackfill(db)).toBe(1);
    await db.transaction((tx) => backfillDemoUsers(tx));
    expect(await demoUsersToBackfill(db)).toBe(0);
    const a = (await listUserAccounts()).find((x) => x.personaRole === 'member')!;
    expect(a).toMatchObject({ roles: ['member'], email: 'julien.wagner@epc2i.fr', department: 'Engineering' });
  });

  it('resolves the user of a viewer: its own id when signed in, the persona user of a role otherwise', async () => {
    const db = await getDb();
    const pmUser = (await listUserAccounts()).find((a) => a.personaRole === 'pm')!.userId;
    expect(await userIdOf(db, 'pm')).toBe(pmUser);
    expect(await userIdOf(db, PERSONA_BY_ROLE.pm)).toBe(pmUser);
    expect(await userIdOf(db, { role: 'pm', userId: 'aaaaaaaa-0000-4000-8000-000000000000' })).toBe('aaaaaaaa-0000-4000-8000-000000000000');
    // R-044: Finance is a persona role since delivery 8; an unknown role has no user.
    expect(await userIdOf(db, 'finance')).toBe((await listUserAccounts()).find((a) => a.personaRole === 'finance')!.userId);
    expect(await userIdOf(db, 'accounting')).toBeNull();
  });

  it('delivers role notifications to every holder of the role, with a read state per user', async () => {
    const db = await getDb();
    // A second project manager signs in (a directory person with an e-mail).
    await db.update(persons).set({ email: 'sophie.renard@epc2i.fr' }).where(eq(persons.fullName, 'Sophie Renard'));
    const r = await signInUser({ oid: 'oid-sophie', email: 'sophie.renard@epc2i.fr', roles: ['pm', 'depthead'] });
    expect(r).toMatchObject({ ok: true, created: true, account: { roles: ['pm', 'depthead'], department: 'MEP', title: 'Head of MEP' } });
    if (!r.ok) return;
    const sophie = await viewerOf(r.account.userId, 'pm');
    expect(await listNotifications(sophie)).toEqual([]); // the seed notifications went to the personas only
    const code = await createNotification({ kind: 'approval', title: 'CR-099 awaits your approval', sub: 'Test', screen: 'changes', audience: ['pm'] });
    expect((await listNotifications(sophie)).map((n) => n.id)).toEqual([code]);
    expect((await listNotifications('pm'))[0].id).toBe(code); // Romain Aubert (persona) too
    await markAllNotificationsRead(sophie);
    expect(await countUnreadNotifications(sophie)).toBe(0);
    expect((await listNotifications('pm'))[0]).toMatchObject({ id: code, read: false });
    // A personal notice reaches its person only, not every holder of the role.
    const only = await createNotification({ kind: 'request', title: 'RQ-999 approved', sub: 'Test', screen: 'requests', audience: ['pm'], toPersonIds: [await personId('Sophie Renard')] });
    expect((await listNotifications(sophie))[0].id).toBe(only);
    expect((await listNotifications('pm')).some((n) => n.id === only)).toBe(false);
  });

  it('notifies the recipient person of a request event, never the actor', async () => {
    const before = (await listNotifications('member')).length;
    const notice = { kind: 'request' as const, title: 'RQ-998 assigned', sub: 'Test', screen: 'mywork', projectCode: 'HLT-026', to: 'Julien Wagner' };
    await notifyRequestEvent([notice], PERSONA_BY_ROLE.pm);
    expect((await listNotifications('member')).length).toBe(before + 1);
    await notifyRequestEvent([notice], PERSONA_BY_ROLE.member); // Julien acting on his own request
    await notifyRequestEvent([{ ...notice, to: 'Nobody Known' }], PERSONA_BY_ROLE.pm);
    expect((await listNotifications('member')).length).toBe(before + 1);
  });

  it('keeps prioritisation weights per user', async () => {
    const db = await getDb();
    const [sophieUser] = await db.select({ id: users.id }).from(users).where(eq(users.entraObjectId, 'oid-sophie'));
    const sophie = await viewerOf(sophieUser.id, 'pm');
    await setScoreWeight(sophie, 'risk', 0.9);
    expect((await getScoreWeights(sophie)).risk).toBe(0.9);
    expect((await getScoreWeights('pm')).risk).not.toBe(0.9);
  });

  it('owns projects by person for signed-in users and by organisation for clients', async () => {
    const projects = await listProjects();
    const hlt = projects.find((p) => p.code === 'HLT-026')!; // PM R. Aubert, client Port authority
    const db = await getDb();
    await db.update(persons).set({ email: 'r.aubert@epc2i.fr' }).where(eq(persons.fullName, 'Romain Aubert'));
    const r = await signInUser({ oid: 'oid-romain', email: 'r.aubert@epc2i.fr', roles: ['pm'] });
    if (!r.ok) throw new Error(r.reason);
    const romain = await viewerOf(r.account.userId, 'pm');
    const teams = await listProjectTeams();
    expect(isMineProject(romain, hlt, teams)).toBe(true);
    expect(isMineProject({ ...romain, personId: await personId('Sophie Renard') }, hlt, teams)).toBe(false); // same short name cannot fake it
    expect(isMineProject(PERSONA_BY_ROLE.pm, hlt, teams)).toBe(true); // demo persona: short name
    expect(isMineProject(PERSONA_BY_ROLE.client, hlt, teams)).toBe(true);
    expect(isMineProject({ ...PERSONA_BY_ROLE.client, organisation: 'Nordvolt' }, hlt, teams)).toBe(false);
    expect(isMineProject({ ...PERSONA_BY_ROLE.client, organisation: null }, hlt, teams)).toBe(false);
  });

  it('recognises the unique violation of a second account for the same person (retry of a racing first sign-in)', async () => {
    const db = await getDb();
    const romain = await personId('Romain Aubert');
    const err = await db.insert(users).values({ personId: romain, title: 'x', sortOrder: 999 }).then(() => null, (e: unknown) => e);
    expect(err).toBeTruthy();
    expect(isUniqueViolation(err, ['users_person_id_unique'])).toBe(true);
    expect(isUniqueViolation(err, ['users_entra_object_id_unique'])).toBe(false);
    expect(isUniqueViolation(new Error('boom'), ['users_person_id_unique'])).toBe(false);
  });

  it('keeps one account per person even when two first sign-ins race', async () => {
    const db = await getDb();
    await db.update(persons).set({ email: 'olivier.blanc@epc2i.fr' }).where(eq(persons.fullName, 'Olivier Blanc'));
    const [a, b] = await Promise.all([
      signInUser({ oid: 'oid-olivier', email: 'olivier.blanc@epc2i.fr', roles: ['depthead'] }),
      signInUser({ oid: 'oid-olivier', email: 'olivier.blanc@epc2i.fr', roles: ['depthead'] }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.personId, await personId('Olivier Blanc')));
    expect(n).toBe(1);
  });
});
