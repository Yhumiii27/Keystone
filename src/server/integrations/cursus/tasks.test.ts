// R-180 — Keystone's planned tasks pushed to Cursus, on an in-memory PGlite seeded with the demo data (business date Fri 25 Sep
// 2026): what the snapshot holds (named schedule assignments, Keystone tasks with the pub_taches_jours rule — the view and the push
// agree — the to-dos covered by an assignment left out), the mock record (nothing sent, older pushes superseded), the HTTP push
// (projects first, then PUT /v1/instantane; Cursus's refusals of single tasks, retryable and final failures, the cursus-outbox
// retry), the connector disabled by IT, the nightly job, "Sync now" and the Cursus row of Activity & integrations.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, activityAssignments, connectors, cursusTaskPushes, persons, tasks } from '@/server/db/schema';
import { listConnectors, syncConnector } from '@/server/dal/integrations';
import { jobDefinition } from '@/server/jobs/definitions';
import { lastCursusTaskPush, pushCursusTasks, redeliverCursusTaskPush } from './tasks';

type Payload = { depuis: string; projets: { code: string; nom: string }[]; taches: { id: string; projet: string; tache: string; matricule: string; debut: string; fin: string; heures: Record<string, number> }[] };

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
};
const lastRow = async () => (await (await getDb()).select().from(cursusTaskPushes).orderBy(asc(cursusTaskPushes.requestedAt))).at(-1)!;
const matricules = { 'Julien Wagner': 'EMP-0018', 'Hélène Sauvage': 'EMP-0012', 'Thomas Kerbrat': 'EMP-0021' } as const;
const director = { name: 'Romain Aubert', role: 'director' };

/** Cursus stub: records each call, answers by `answer(path, body)`. */
function stubCursus(answer: (path: string, body: Record<string, unknown>) => Response | null = () => null) {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  vi.stubEnv('CURSUS_API_URL', 'http://cursus.test');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('http://cursus.test/api/integrations/keystone/v1', '');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ method: String(init?.method), path, body });
    return answer(path, body) ?? (path === '/instantane'
      ? Response.json({ resultat: 'synchronise', bilan: { taches: { crees: (body.taches as unknown[]).length, modifies: 0, inchanges: 0, supprimes: 0 } } })
      : Response.json({ resultat: 'inchange' }));
  }));
  return calls;
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the snapshot (mock connector: recorded, nothing sent)', () => {
  it('no matricule on the demo people: no task, the persons with planned work counted', async () => {
    const r = await pushCursusTasks('job');
    expect(r).toMatchObject({ state: 'mock', mode: 'mock', tasks: 0, projects: 0, persons: 0 });
    expect(r.withoutMatricule).toBeGreaterThan(5);
    const row = await lastRow();
    expect([row.status, row.trigger, row.since, (row.payload as unknown as Payload).taches]).toEqual(['pending', 'job', '2026-08-24', []]);
  });

  it('named assignments and uncovered tasks of the people with a matricule; a covered to-do is left out', async () => {
    const db = await getDb();
    for (const [full, m] of Object.entries(matricules)) await db.update(persons).set({ matricule: m }).where(eq(persons.fullName, full));
    const before = await lastRow();
    const r = await pushCursusTasks('job');
    expect(r).toMatchObject({ state: 'mock', persons: 3, rejected: 0 });
    const row = await lastRow();
    const p = row.payload as unknown as Payload;
    expect(p.depuis).toBe('2026-08-24');
    expect(r.tasks).toBe(p.taches.length);
    expect(p.projets.map((x) => x.code)).toContain('HLT-026');
    expect(new Set(p.taches.map((t) => t.matricule))).toEqual(new Set(Object.values(matricules)));
    // Julien Wagner on A1250 (1 × 8 h/d, 17 Aug → 9 Oct): 8 h on each working day from the activity's start.
    const [a1250] = await db.select({ id: activityAssignments.id }).from(activityAssignments)
      .innerJoin(activities, eq(activities.id, activityAssignments.activityId)).innerJoin(persons, eq(persons.id, activityAssignments.personId))
      .where(sql`${activities.code} = 'A1250' and ${persons.fullName} = 'Julien Wagner'`);
    const wagner = p.taches.find((t) => t.id === `KA-${a1250.id}`)!;
    expect(wagner).toMatchObject({ projet: 'HLT-026', matricule: 'EMP-0018', debut: '2026-08-17', fin: '2026-10-09' });
    expect(wagner.tache).toMatch(/^A1250 · /);
    expect([wagner.heures['2026-09-25'], wagner.heures['2026-09-26'], wagner.heures['2026-09-28']]).toEqual([8, undefined, 8]);
    // His to-do T-2320 on A1250 is inside that assignment: not sent. Hélène Sauvage is not assigned on A1250: T-2318 is sent.
    expect(p.taches.some((t) => t.id === 'KT-T-2320')).toBe(false);
    const t2318 = p.taches.find((t) => t.id === 'KT-T-2318')!;
    expect(t2318).toMatchObject({ projet: 'HLT-026', matricule: 'EMP-0012', debut: '2026-09-25', fin: '2026-10-01', tache: 'T-2318 · Weld inspection report — Bay 3' });
    // The view and the push agree: pub_taches_jours's rows of T-2318 are the task's hours.
    const view = (await db.execute(sql`select jour::text as jour, heures_prevues::float8 as h from pub_taches_jours where tache_numero = 'T-2318' order by jour`)) as unknown as { rows: { jour: string; h: number }[] };
    expect(Object.fromEntries(view.rows.map((v) => [v.jour, v.h]))).toEqual(t2318.heures);
    // The previous push was superseded and its body dropped: only the newest keeps what would be sent.
    const old = (await db.select().from(cursusTaskPushes).where(eq(cursusTaskPushes.id, before.id)))[0];
    expect([old.status, old.payload]).toEqual(['superseded', null]);
  });

  it('a removed task leaves the snapshot (Cursus deletes it); a reassigned one keeps its id with the new matricule', async () => {
    const db = await getDb();
    const [kerbrat] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Thomas Kerbrat'));
    await db.update(tasks).set({ assigneePersonId: kerbrat.id }).where(eq(tasks.number, 'T-2318'));
    await pushCursusTasks('job');
    const p = (await lastRow()).payload as unknown as Payload;
    expect(p.taches.find((t) => t.id === 'KT-T-2318')?.matricule).toBe('EMP-0021');
    await db.update(tasks).set({ estimateH: 0 }).where(eq(tasks.number, 'T-2318'));
    await pushCursusTasks('job');
    expect(((await lastRow()).payload as unknown as Payload).taches.some((t) => t.id === 'KT-T-2318')).toBe(false);
  });
});

describe('HTTP connector', () => {
  it('projects first, then the snapshot; sent with Cursus\'s bilan', async () => {
    const calls = stubCursus();
    const r = await pushCursusTasks('job');
    expect(r).toMatchObject({ state: 'sent', mode: 'http', rejected: 0, error: null });
    const snap = calls.at(-1)!;
    expect([snap.method, snap.path, Object.keys(snap.body)]).toEqual(['PUT', '/instantane', ['depuis', 'taches']]);
    const projectCalls = calls.slice(0, -1);
    expect(projectCalls.every((c) => c.method === 'PUT' && c.path.startsWith('/projets/'))).toBe(true);
    expect(projectCalls.find((c) => c.path === '/projets/HLT-026')?.body).toEqual({ nom: 'Harbor Line Terminal Expansion' });
    const row = await lastRow();
    expect([row.status, row.attempts, !!row.sentAt, row.lastError]).toEqual(['sent', 1, true, null]);
    expect((row.result as { bilan: unknown }).bilan).toEqual({ taches: { crees: r.tasks, modifies: 0, inchanges: 0, supprimes: 0 } });
  });

  it('a task Cursus refuses (unknown matricule) is left out and the snapshot sent again; recorded as refused', async () => {
    quiet();
    let first = true;
    const calls = stubCursus((path, body) => {
      if (path !== '/instantane' || !first) return null;
      first = false;
      const i = (body.taches as { matricule: string }[]).findIndex((t) => t.matricule === 'EMP-0021');
      return Response.json({ error: 'Données invalides : taches[i].matricule', code: 'VALIDATION', details: [{ champ: `taches[${i}].matricule`, message: 'Matricule inconnu de Cursus' }] }, { status: 400 });
    });
    const r = await pushCursusTasks('sync');
    expect(r).toMatchObject({ state: 'sent', rejected: 1 });
    const snaps = calls.filter((c) => c.path === '/instantane');
    expect((snaps[1].body.taches as unknown[]).length).toBe((snaps[0].body.taches as unknown[]).length - 1);
    const row = await lastRow();
    expect((row.result as { refused: unknown[] }).refused).toEqual([{ id: expect.stringMatching(/^K[AT]-/), champ: 'matricule', message: 'Matricule inconnu de Cursus' }]);
    expect((await listConnectors()).find((c) => c.name === 'Cursus')?.lastVolume).toContain('Tasks refused · 1');
  });

  it('Cursus unavailable (503): pending, sent again by the cursus-outbox job; a final refusal (400 on depuis) fails', async () => {
    quiet();
    let down = true;
    stubCursus(() => (down ? Response.json({ error: 'Intégration Keystone non configurée', code: 'NON_CONFIGUREE' }, { status: 503 }) : null));
    expect(await pushCursusTasks('job')).toMatchObject({ state: 'pending', error: 'Cursus PUT /api/integrations/keystone/v1/projets/HLT-026 → 503 NON_CONFIGUREE' });
    expect((await listConnectors()).find((c) => c.name === 'Cursus')).toMatchObject({ status: 'warning' });
    expect(await redeliverCursusTaskPush()).toEqual({ mode: 'http', delivered: 0, failed: 1, pending: 1 });
    down = false;
    expect(await jobDefinition('cursus-outbox').run()).toMatchObject({ counts: { delivered: 1 } });
    expect((await lastRow()).status).toBe('sent');
    expect(await redeliverCursusTaskPush()).toEqual({ mode: 'http', delivered: 0, failed: 0, pending: 0 });

    stubCursus((path) => (path === '/instantane' ? Response.json({ error: 'Données invalides : depuis', code: 'VALIDATION', details: [{ champ: 'depuis', message: 'Date invalide' }] }, { status: 400 }) : null));
    expect(await pushCursusTasks('job')).toMatchObject({ state: 'failed', error: 'Cursus PUT /api/integrations/keystone/v1/instantane → 400 VALIDATION' });
    expect(await redeliverCursusTaskPush()).toEqual({ mode: 'http', delivered: 0, failed: 0, pending: 0 });
    expect((await listConnectors()).find((c) => c.name === 'Cursus')?.lastVolume).toContain('Task push failed');
  });

  it('every task refused: nothing applied (no snapshot that would delete them all)', async () => {
    quiet();
    const calls = stubCursus((path, body) => (path === '/instantane'
      ? Response.json({ code: 'VALIDATION', error: 'x', details: (body.taches as unknown[]).map((_, i) => ({ champ: `taches[${i}].matricule`, message: 'Matricule inconnu de Cursus' })) }, { status: 400 })
      : null));
    expect(await pushCursusTasks('job')).toMatchObject({ state: 'failed' });
    expect(calls.filter((c) => c.path === '/instantane')).toHaveLength(1);
  });
});

describe('job, Sync now, disabled connector, Activity & integrations', () => {
  it('the nightly job records the snapshot with the mock connector; "Sync now" names the tasks', async () => {
    const out = await jobDefinition('cursus-tasks').run();
    expect(out.summary).toMatch(/^Cursus mock connector · tasks not sent · \d+ tasks · 3 persons · \d+ projects · \d+ persons without matricule recorded$/);
    const r = await syncConnector('Cursus', director);
    expect(r).toMatchObject({ ok: true, simulated: true, volume: expect.stringMatching(/^\d+ approvals received · \d+ tasks pending$/) });
    expect((await lastRow()).trigger).toBe('sync');
    const row = (await listConnectors()).find((c) => c.name === 'Cursus')!;
    expect(row.lastVolume).toMatch(/Last task push · .+ · Tasks · \d+ · Persons without matricule · \d+$/);
    expect(await lastCursusTaskPush()).toMatchObject({ mode: 'mock', status: 'pending', persons: 3 });
  });

  it('disabled by IT (D-7a): nothing prepared, nothing sent', async () => {
    const db = await getDb();
    const n = (await db.select().from(cursusTaskPushes)).length;
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.name, 'Cursus'));
    try {
      expect(await pushCursusTasks('job')).toMatchObject({ state: 'disabled', pushId: null, tasks: 0 });
      expect(await jobDefinition('cursus-tasks').run()).toMatchObject({ summary: 'Cursus connector disabled · tasks not sent' });
      expect((await db.select().from(cursusTaskPushes)).length).toBe(n);
    } finally {
      await db.update(connectors).set({ enabled: true }).where(eq(connectors.name, 'Cursus'));
    }
  });

  it('pushes older than 90 days are removed by the next push', async () => {
    const db = await getDb();
    const ids = (await db.select({ id: cursusTaskPushes.id }).from(cursusTaskPushes)).map((r) => r.id).slice(0, 2);
    await db.update(cursusTaskPushes).set({ requestedAt: new Date(Date.now() - 91 * 86_400_000) }).where(inArray(cursusTaskPushes.id, ids));
    await pushCursusTasks('job');
    expect((await db.select().from(cursusTaskPushes).where(inArray(cursusTaskPushes.id, ids))).length).toBe(0);
  });
});

describe('in French', () => {
  it('the Cursus row and the "Sync now" volume', async () => {
    const { makeT } = await import('@/i18n/translate');
    const { activityWhatT, volumeT } = await import('@/features/admin/i18n');
    const fr = makeT('fr');
    expect(volumeT('5 approvals received · 12 tasks sent', fr, 'fr')).toBe('5 approbations reçues · 12 tâches envoyées');
    expect(volumeT('5 approvals received · 1 tasks pending', fr, 'fr')).toBe('5 approbations reçues · 1 tâche en attente');
    expect(volumeT('0 people · Last task push · 23 Oct 02:00 · Tasks · 42 · Task push failed · Tasks refused · 2 · Persons without matricule · 3', fr, 'fr'))
      .toBe('0 personnes · Dernier envoi des tâches · 23 oct. 02:00 · Tâches · 42 · Échec de l’envoi des tâches · Tâches refusées · 2 · Personnes sans matricule · 3');
    expect(volumeT('Task push pending', fr, 'fr')).toBe('Envoi des tâches en attente');
    expect(activityWhatT({ what: 'Cursus sync (simulated) · 5 approvals received · 3 tasks pending' }, fr, 'fr')).toBe('Synchro Cursus (simulée) · 5 approbations reçues · 3 tâches en attente');
  });
});
