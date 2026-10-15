// R-027 (NEW-CURSUS-2 "a") — Cursus's staff directory → Keystone persons, on an in-memory PGlite seeded with the demo data:
// the writer (match by matricule then work e-mail, create the missing EPC2i persons, never delete, never a user account,
// never an external contact; audit rows by "Cursus" and one activity event), the switch CURSUS_DIRECTORY (off by default),
// the disabled and simulated connector, the daily job "cursus-directory" and the Cursus row's "Sync now" with a stubbed
// Cursus, the replay of the absences left unresolved for want of a matricule, and the Go / No Go mirror taking the
// directory's names (a placeholder matricule name upgraded with its reminders; a stored real name never renamed).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import {
  activityEvents, auditEntries, clients, connectors, cursusClearances, cursusEvents, cursusRequests, departments, leaveEntries, persons, projects, siteSheets, users,
} from '@/server/db/schema';
import { jobDefinition } from '@/server/jobs/definitions';
import { resetCursusRefreshThrottle } from '@/server/integrations/cursus/connector';
import { keptClearanceName } from '@/server/integrations/cursus/mirror';
import { receiveCursusEvent } from '@/server/integrations/cursus/inbox';
import { parseCursusEvent } from '@/domain/cursus-events';
import { syncConnector } from './integrations';
import { CURSUS_ACTOR, directoryRunSummary, importStaffDirectory, runDirectoryImport } from './persons-directory';

const DIRECTOR = { role: 'director', name: 'Marie Lefebvre' } as const;
const CURSUS = 'http://cursus.test';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

beforeEach(() => {
  resetCursusRefreshThrottle();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const personBy = async (where: ReturnType<typeof eq>) => (await (await getDb()).select().from(persons).where(where))[0];
const count = async (table: typeof persons | typeof users) => (await (await getDb()).select({ n: sql<number>`count(*)::int` }).from(table))[0].n;

/** Cursus answers the directory with `rows` and every go-no-go with `goNoGo`; returns the URLs called. */
function stubCursus(rows: unknown, goNoGo?: (chantier: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    expect(new Headers(init?.headers).get('x-api-key')).toBeTruthy();
    if (String(url).endsWith('/api/integrations/keystone/annuaire')) return new Response(JSON.stringify(rows), { status: 200 });
    const m = /chantiers\/([^/]+)\/go-no-go$/.exec(String(url));
    if (m && goNoGo) return new Response(JSON.stringify(goNoGo(decodeURIComponent(m[1]))), { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  return calls;
}

describe('importStaffDirectory (the writer)', () => {
  it('matches by e-mail then matricule, creates the unknown, never touches an external contact; audits by Cursus; idempotent', async () => {
    const db = await getDb();
    const julien = (await personBy(eq(persons.fullName, 'Julien Wagner')))!;
    expect(julien.email).toBeTruthy();
    // A department other than Julien's (the directory moves him there: an exact name).
    const dept = (await db.select({ id: departments.id, name: departments.name }).from(departments)).find((d) => d.id !== julien.departmentId)!;
    const [contact] = await db.select({ id: persons.id, email: persons.email, shortName: persons.shortName }).from(persons).where(sql`${persons.clientId} is not null`).limit(1);
    await db.update(persons).set({ email: 'contact@client.example' }).where(eq(persons.id, contact.id));
    const [usersBefore, personsBefore] = [await count(users), await count(persons)];

    const r = await importStaffDirectory([
      // Julien Wagner by his work e-mail (other case), in a department of exactly that name.
      { matricule: 'EMP-0018', nom: 'Wagner', prenom: 'Julien', email: julien.email!.toUpperCase(), equipe: dept.name },
      // Nobody: a new person, short name "J. Wagner" taken → "J. Wagner (2)"; a team no department carries is kept as text.
      { matricule: 'EMP-0901', nom: 'Wagner', prenom: 'Jeanne', email: 'jeanne.wagner@epc2i.example', equipe: 'Atelier Nord' },
      // The external contact's e-mail: never matched, never given to a new person.
      { matricule: 'EMP-0902', nom: 'Contact', prenom: 'Client', email: 'contact@client.example', equipe: null },
    ], { invalid: 1, at: new Date('2026-10-12T06:00:00Z') });
    expect(r).toEqual({ matched: 1, updated: 1, created: 1, reported: 1, invalid: 1, unmatchedTeams: ['Atelier Nord'] });

    const j = (await personBy(eq(persons.id, julien.id)))!;
    expect([j.matricule, j.shortName, j.fullName, j.email, j.departmentId, j.directoryTeam]).toEqual(['EMP-0018', julien.shortName, 'Julien Wagner', julien.email, dept.id, null]);
    expect(j.directorySyncedAt?.toISOString()).toBe('2026-10-12T06:00:00.000Z');
    const jeanne = (await personBy(eq(persons.matricule, 'EMP-0901')))!;
    expect([jeanne.fullName, jeanne.shortName, jeanne.initials, jeanne.email, jeanne.clientId, jeanne.departmentId, jeanne.directoryTeam])
      .toEqual(['Jeanne Wagner', 'J. Wagner (2)', 'JW', 'jeanne.wagner@epc2i.example', null, null, 'Atelier Nord']);
    // The external contact is untouched; no user account was created (Entra ID gives them at sign-in).
    expect((await personBy(eq(persons.id, contact.id)))!).toMatchObject({ matricule: null, email: 'contact@client.example', shortName: contact.shortName });
    expect(await personBy(eq(persons.matricule, 'EMP-0902'))).toBeUndefined();
    expect([await count(users), await count(persons)]).toEqual([usersBefore, personsBefore + 1]);

    const audits = await db.select().from(auditEntries).where(and(eq(auditEntries.actorName, CURSUS_ACTOR), inArray(auditEntries.entityId, [julien.id, jeanne.id])));
    expect(audits.map((a) => [a.area, a.objectRef, a.change]).sort()).toEqual([
      ['Integrations', `Person ${julien.shortName}`, `staff directory · matricule EMP-0018, department`],
      ['Integrations', 'Person J. Wagner (2)', 'created from the staff directory · matricule EMP-0901'],
    ].sort());
    // Audit and activity carry the matricule, never a name or an e-mail from the directory.
    expect(JSON.stringify(audits)).not.toMatch(/jeanne\.wagner@|contact@client/);
    const [act] = await db.select().from(activityEvents).where(eq(activityEvents.actorName, CURSUS_ACTOR)).orderBy(sql`${activityEvents.occurredAt} desc`).limit(1);
    expect(act.text).toBe('Staff directory imported from Cursus · 1 matched · 1 created · 1 to check');

    // The same directory again: nothing changes, no new audit row, nobody created.
    const again = await importStaffDirectory([
      { matricule: 'EMP-0018', nom: 'Wagner', prenom: 'Julien', email: julien.email!, equipe: dept.name },
      { matricule: 'EMP-0901', nom: 'Wagner', prenom: 'Jeanne', email: 'jeanne.wagner@epc2i.example', equipe: 'Atelier Nord' },
    ]);
    expect(again).toMatchObject({ matched: 2, updated: 0, created: 0 });
    expect((await db.select().from(auditEntries).where(and(eq(auditEntries.actorName, CURSUS_ACTOR), inArray(auditEntries.entityId, [julien.id, jeanne.id])))).length).toBe(2);
    expect(await count(persons)).toBe(personsBefore + 1);
    // Nobody is deleted when the directory omits them (Jeanne absent from this run).
    await importStaffDirectory([]);
    expect(await personBy(eq(persons.matricule, 'EMP-0901'))).toBeDefined();
  });
});

describe('runDirectoryImport (switch, connector, mode) and the job', () => {
  it('off by default; on with the mock connector → nothing; disabled by IT → nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await runDirectoryImport()).toEqual({ state: 'off' });
    vi.stubEnv('CURSUS_DIRECTORY', 'on');
    expect(await runDirectoryImport()).toEqual({ state: 'mock' });
    vi.stubEnv('CURSUS_API_URL', CURSUS);
    const db = await getDb();
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.name, 'Cursus'));
    try {
      expect(await runDirectoryImport()).toEqual({ state: 'disabled' });
    } finally {
      await db.update(connectors).set({ enabled: true }).where(eq(connectors.name, 'Cursus'));
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(['off', 'disabled', 'mock'].map((state) => directoryRunSummary({ state } as never))).toEqual([
      'staff directory import off (CURSUS_DIRECTORY)', 'Cursus connector disabled by IT', 'mock connector · no staff directory',
    ]);
  });

  it('the daily job imports the directory and replays the absences waiting for a matricule (R-031)', async () => {
    const db = await getDb();
    // An absence received before anybody carried EMP-0444: kept "unresolved".
    const parsed = parseCursusEvent({ id: 'evt-dir-1', type: 'absence.validee', emis_le: '2026-10-05T08:00:00Z', data: { matricule: 'EMP-0444', start: '2026-10-19', end: '2026-10-21', nature: 'CP', id: 'ABS-444' } });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(await receiveCursusEvent(parsed.event)).toMatchObject({ status: 'unresolved' });

    const job = jobDefinition('cursus-directory');
    expect(await job.run()).toEqual({ summary: 'Cursus staff directory · staff directory import off (CURSUS_DIRECTORY)', counts: {} });

    vi.stubEnv('CURSUS_DIRECTORY', 'on');
    vi.stubEnv('CURSUS_API_URL', CURSUS);
    // Antoine Girard (a persona: he has a work e-mail) is EMP-0444 in Cursus's directory.
    const antoine = (await personBy(eq(persons.fullName, 'Antoine Girard')))!;
    expect(antoine.email).toBeTruthy();
    const calls = stubCursus([
      { matricule: 'EMP-0444', nom: 'Girard', prenom: 'Antoine', email: antoine.email, equipe: null },
      { matricule: '', nom: 'Sans', prenom: 'Matricule' },
    ]);
    const out = await job.run();
    expect(calls).toEqual([`${CURSUS}/api/integrations/keystone/annuaire`]);
    expect(out).toMatchObject({ counts: { matched: 1, created: 0, reported: 1, resolved: 1 }, warn: true });
    expect((await personBy(eq(persons.id, antoine.id)))!.matricule).toBe('EMP-0444');
    expect(out.summary).toBe('Cursus staff directory · 1 matched · 0 created · 1 to check · 1 events resolved');
    expect((await db.select().from(cursusEvents).where(eq(cursusEvents.eventId, 'evt-dir-1')))[0]).toMatchObject({ status: 'received' });
    expect((await db.select().from(leaveEntries).where(eq(leaveEntries.externalId, 'cursus:ABS-444'))).map((l) => [l.personId === antoine.id, l.leaveType, l.days]))
      .toEqual([[true, 'leave', 3]]);

    // Cursus unreachable or answering something else: the job fails (the worker records the failed run).
    stubCursus({ not: 'a list' });
    await expect(job.run()).rejects.toThrow(/unexpected directory payload/);
  });

  it('"Sync now" of the Cursus row runs the import with the switch on; the site mirror takes the directory names', async () => {
    const db = await getDb();
    vi.stubEnv('CURSUS_DIRECTORY', 'on');
    vi.stubEnv('CURSUS_API_URL', CURSUS);
    const [hlt] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const sheets = await db.select({ projectId: siteSheets.projectId }).from(siteSheets);
    // Only HLT-026 is linked to a Cursus site for this test (the others would fail "No Cursus site is linked").
    await db.update(siteSheets).set({ cursusChantierId: 'K-2614' }).where(eq(siteSheets.projectId, hlt.id));
    // A row first stored under its matricule (Cursus sends no names), with a reminder recorded under that name.
    await db.insert(cursusClearances).values({
      projectCode: 'HLT-026', chantierId: 'K-2614', matricule: 'EMP-0777', personName: 'EMP-0777', visa: 'pending', vaccination: 'confirmed', clearance: 'ok', clearanceNote: '',
      verdict: 'go_with_reserve', reasonCodes: [], receivedAt: new Date('2026-10-01T07:00:00Z'), position: 99, lastSyncedAt: new Date('2026-10-01T07:00:00Z'),
    });
    await db.insert(cursusRequests).values({
      projectCode: 'HLT-026', kind: 'reminder', personName: 'EMP-0777', matricule: 'EMP-0777', actorName: 'Romain Aubert', actorRole: 'pm', recordedAt: new Date(),
      requestedOn: '2026-10-01', syncStatus: 'pending',
    });
    const calls = stubCursus(
      [{ matricule: 'EMP-0777', nom: 'Lambert', prenom: 'Hugo', email: 'hugo.lambert@epc2i.example', equipe: null }],
      (chantier) => ({ chantier, evalue_le: '2026-10-12T07:00:00Z', statut: 'GO_RESERVE', ressources: [{ matricule: 'EMP-0777', statut: 'GO_RESERVE', motifs: [] }] }),
    );
    const first = await syncConnector('Cursus', DIRECTOR);
    // The directory is imported first, then the sites are refreshed (those without a Cursus site fail as before).
    expect(calls.slice(0, 2)).toEqual([`${CURSUS}/api/integrations/keystone/annuaire`, `${CURSUS}/api/integrations/keystone/chantiers/K-2614/go-no-go`]);
    expect(first.simulated).toBe(false);
    const hugo = (await personBy(eq(persons.matricule, 'EMP-0777')))!;
    expect([hugo.fullName, hugo.shortName]).toEqual(['Hugo Lambert', 'H. Lambert']);
    // The placeholder row took the directory name, its reminder followed; a second run changes nothing; a real name is never
    // renamed.
    resetCursusRefreshThrottle();
    await syncConnector('Cursus', DIRECTOR);
    const rows = await db.select().from(cursusClearances).where(and(eq(cursusClearances.projectCode, 'HLT-026'), eq(cursusClearances.matricule, 'EMP-0777')));
    expect(rows.map((r) => [r.personName, r.personId === hugo.id])).toEqual([['Hugo Lambert', true]]);
    expect((await db.select().from(cursusRequests).where(eq(cursusRequests.matricule, 'EMP-0777'))).map((r) => r.personName)).toEqual(['Hugo Lambert']);
    expect(keptClearanceName({ personName: 'Julien Wagner', matricule: 'EMP-0018' }, { personName: 'J. Wagner-Roy', matricule: 'EMP-0018' }, new Set())).toBe('Julien Wagner');
    expect(keptClearanceName({ personName: 'EMP-0018', matricule: 'EMP-0018' }, { personName: 'Julien Wagner', matricule: 'EMP-0018' }, new Set(['Julien Wagner']))).toBe('EMP-0018');
    expect(keptClearanceName(undefined, { personName: 'EMP-0019', matricule: 'EMP-0019' }, new Set())).toBe('EMP-0019');
    // Clean up the test's site link.
    await db.update(siteSheets).set({ cursusChantierId: null }).where(inArray(siteSheets.projectId, sheets.map((s) => s.projectId)));
  });

  it('the directory never matches nor creates a client contact even when Cursus lists its e-mail', async () => {
    const db = await getDb();
    const [c] = await db.select({ id: clients.id }).from(clients).limit(1);
    const [p] = await db.insert(persons).values({ fullName: 'Ext Contact', shortName: 'E. Contact', initials: 'EC', email: 'ext@client.example', clientId: c.id, sortOrder: 9999 }).returning({ id: persons.id });
    const r = await importStaffDirectory([{ matricule: 'EMP-0950', nom: 'Contact', prenom: 'Ext', email: 'ext@client.example', equipe: null }]);
    expect(r).toMatchObject({ matched: 0, created: 0, reported: 1 });
    expect((await personBy(eq(persons.id, p.id)))!.matricule).toBeNull();
  });
});
