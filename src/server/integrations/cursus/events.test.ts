// R-029 (NEW-CURSUS-7 "a") — POST /api/integrations/cursus/events on an in-memory PGlite seeded with the demo data: the key
// (constant-time, separate secret; production refuses the demo key and answers 503 without a key), the size limit, the
// validation, the disabled connector, idempotency by event id, replacement by key (hours of a week, an absence), the
// dispatch (absences written to the leave calendar when the matricule resolves — R-031 —, kept "unresolved" for replay
// otherwise; verdict changes refresh the site in HTTP mode), one audit row per new event, the rate limit, the 13-month purge
// and the Cursus row of Activity & integrations.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DEMO_CURSUS_EVENTS_KEY } from '@/server/config/parse';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, connectors, cursusClearances, cursusEvents, leaveEntries, persons, projects, siteSheets } from '@/server/db/schema';
import { listConnectors } from '@/server/dal/integrations';
import { resetRateLimits } from '@/server/http/request-guard';
import { jobDefinition } from '@/server/jobs/definitions';
import { resetCursusRefreshThrottle } from './connector';
import { CURSUS_EVENTS_PATH, CURSUS_EVENTS_V1_PATH, handleCursusEvent, presentedKey, sameKey } from './events';
import { purgeOldCursusEvents, replayUnresolvedCursusEvents } from './inbox';

const URL_ = `http://keystone.test${CURSUS_EVENTS_PATH}`;
let n = 0;
const evt = (type: string, data: unknown, over: Record<string, unknown> = {}) => ({ id: `evt-${++n}`, type, emis_le: '2026-10-05T08:30:00Z', data, ...over });
function post(body: unknown, opts: { key?: string | null; headers?: Record<string, string> } = {}) {
  const key = opts.key === undefined ? DEMO_CURSUS_EVENTS_KEY : opts.key;
  return handleCursusEvent(new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7', ...(key ? { 'x-api-key': key } : {}), ...opts.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}
const res = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
const stored = async (eventId: string) => (await (await getDb()).select().from(cursusEvents).where(eq(cursusEvents.eventId, eventId)))[0];
const auditsOf = async (eventId: string) => (await getDb()).select().from(auditEntries).where(eq(auditEntries.objectRef, `Cursus event ${eventId}`));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

beforeEach(() => {
  resetRateLimits();
  resetCursusRefreshThrottle();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authentication and refusals', () => {
  it('401 without the key, with a wrong one, or with the outbound Cursus key; nothing stored', async () => {
    const e = evt('heures.validees', { matricule: 'EMP-0018', semaine: '2026-W40', projets: { 'HLT-026': 32 } });
    // (HTTP trims header values: a near miss is a different case or a prefix, not a trailing space.)
    for (const key of [null, '', 'wrong-key-wrong-key', 'demo-keystone', DEMO_CURSUS_EVENTS_KEY.toUpperCase(), DEMO_CURSUS_EVENTS_KEY.slice(0, -1)])
      expect((await post(e, { key })).status, String(key)).toBe(401);
    expect(await stored(e.id as string)).toBeUndefined();
    expect(await auditsOf(e.id as string)).toEqual([]);
    expect([sameKey('a', 'a'), sameKey('a', 'b'), sameKey(null, 'a'), sameKey('a'.repeat(1000), 'a')]).toEqual([true, false, false, false]);
  });

  it('production: no key configured → 503 (retry later); the demo key is never accepted; a real key is', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('KEYSTONE_AUTH', 'demo');
    const e = evt('heures.validees', { matricule: 'EMP-0018', semaine: '2026-W41', projets: {} });
    const none = await post(e);
    expect([none.status, none.headers.get('retry-after')]).toEqual([503, '60']);
    vi.stubEnv('CURSUS_EVENTS_KEY', DEMO_CURSUS_EVENTS_KEY);
    expect((await post(e)).status).toBe(503);
    vi.stubEnv('CURSUS_EVENTS_KEY', 'k-live-0123456789abcdef');
    expect((await post(e)).status).toBe(401);
    expect(await res(await post(e, { key: 'k-live-0123456789abcdef' }))).toEqual({ status: 200, body: { ok: true, id: e.id, status: 'received', accuse: `received · ${e.id}` } });
  });

  it('413 over 256 KB (declared or actual), 400 for a body that is not JSON or not a valid event', async () => {
    const big = JSON.stringify(evt('heures.validees', { matricule: 'EMP-1', semaine: '2026-W40', projets: {}, pad: 'x'.repeat(270_000) }));
    expect((await post(big)).status).toBe(413);
    expect((await post('{}', { headers: { 'content-length': String(300_000) } })).status).toBe(413);
    expect(await res(await post('not json'))).toEqual({ status: 400, body: { ok: false, error: 'Body is not JSON' } });
    expect(await res(await post(evt('absence.validee', { matricule: 'EMP-1', start: '2026-10-14', end: '2026-10-12' })))).toEqual({
      status: 400, body: { ok: false, error: 'Invalid absence.validee · the absence ends before it starts' },
    });
    expect((await post({ type: 'x' })).status).toBe(400);
  });

  it('503 while IT has disabled the Cursus connector (D-7a): Cursus keeps the event', async () => {
    const db = await getDb();
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.name, 'Cursus'));
    try {
      const e = evt('heures.validees', { matricule: 'EMP-0018', semaine: '2026-W42', projets: {} });
      const r = await post(e);
      expect([r.status, r.headers.get('retry-after')]).toEqual([503, '60']);
      expect(await stored(e.id as string)).toBeUndefined();
    } finally {
      await db.update(connectors).set({ enabled: true }).where(eq(connectors.name, 'Cursus'));
    }
  });

  it('429 beyond 600 calls a minute from one address (retryable)', async () => {
    for (let i = 0; i < 600; i++) await post({}, { key: null });
    const r = await post({}, { key: null });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another address is counted on its own.
    expect((await post({}, { key: null, headers: { 'x-forwarded-for': '10.0.0.8' } })).status).toBe(401);
  });
});

describe('inbox: idempotency, replacement, audit', () => {
  it('a repeated event id answers duplicate and is stored and audited once', async () => {
    const e = evt('heures.validees', { matricule: 'EMP-0018', semaine: '2026-W40', projets: { 'HLT-026': 32 } });
    expect(await res(await post(e))).toEqual({ status: 200, body: { ok: true, id: e.id, status: 'received', accuse: `received · ${e.id}` } });
    expect(await res(await post(e))).toEqual({ status: 200, body: { ok: true, id: e.id, duplicate: true, accuse: `received · ${e.id}` } });
    expect(await auditsOf(e.id as string)).toHaveLength(1);
    expect((await auditsOf(e.id as string))[0]).toMatchObject({ actorName: 'Cursus', area: 'Integrations', change: 'heures.validees · received', entityType: 'cursus_event' });
    // R-030 awaits the owner: the hours are stored, never applied.
    expect((await stored(e.id as string))!.note).toMatch(/Stored only/);
  });

  it('validated hours of the same person and week replace the previous event; an older one is kept as ignored', async () => {
    const week = { matricule: 'EMP-0031', semaine: '2026-W41' };
    const a = evt('heures.validees', { ...week, projets: { 'HLT-026': 30 } }, { emis_le: '2026-10-10T08:00:00Z' });
    const b = evt('heures.validees', { ...week, projets: { 'HLT-026': 35 } }, { emis_le: '2026-10-11T08:00:00Z' });
    const late = evt('heures.validees', { ...week, projets: { 'HLT-026': 20 } }, { emis_le: '2026-10-09T08:00:00Z' });
    await post(a);
    await post(b);
    expect(await stored(a.id as string)).toBeUndefined();
    expect(await stored(b.id as string)).toMatchObject({ status: 'received', replaceKey: 'EMP-0031|2026-W41' });
    expect(await res(await post(late))).toEqual({ status: 200, body: { ok: true, id: late.id, status: 'ignored', accuse: `ignored · ${late.id}` } });
    expect(await stored(b.id as string)).toMatchObject({ status: 'received' });
  });

  it('unknown types are accepted and ignored, their data not kept', async () => {
    const e = evt('formation.planifiee', { matricule: 'EMP-0018', detail: 'x' });
    expect(await res(await post(e))).toEqual({ status: 200, body: { ok: true, id: e.id, status: 'ignored', accuse: `ignored · ${e.id}` } });
    expect((await stored(e.id as string))!.data).toEqual({});
  });
});

describe('absence.validee → the leave calendar (R-031)', () => {
  it('unresolved while no person carries the matricule; replayed once the staff directory names it; replaced by its id', async () => {
    const db = await getDb();
    const e = evt('absence.validee', { matricule: 'EMP-0042', start: '2026-11-09', end: '2026-11-13', nature: 'MALADIE', id: 'ABS-9' });
    expect(await res(await post(e))).toEqual({ status: 200, body: { ok: true, id: e.id, status: 'unresolved', accuse: `unresolved · ${e.id}` } });
    const row = (await stored(e.id as string))!;
    // R-173: the reason is not stored.
    expect(row.data).toEqual({ matricule: 'EMP-0042', start: '2026-11-09', end: '2026-11-13', type: 'absence', id: 'ABS-9' });
    expect(JSON.stringify(row)).not.toMatch(/MALADIE/);
    expect(await db.select().from(leaveEntries).where(eq(leaveEntries.externalId, 'cursus:ABS-9'))).toEqual([]);
    // The staff directory (R-027) gives Damien Roux the matricule: the replay writes the week, 11 Nov (Settings holiday) removed.
    const [damien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Damien Roux'));
    await db.update(persons).set({ matricule: 'EMP-0042' }).where(eq(persons.id, damien.id));
    expect(await replayUnresolvedCursusEvents()).toMatchObject({ received: 1 });
    expect(await stored(e.id as string)).toMatchObject({ status: 'received' });
    const weeks = await db.select().from(leaveEntries).where(eq(leaveEntries.externalId, 'cursus:ABS-9'));
    expect(weeks.map((w) => [w.personId === damien.id, w.leaveType, w.weekStart, w.startDate, w.endDate, w.days, w.source])).toEqual([
      [true, 'absence', '2026-11-09', '2026-11-09', '2026-11-13', 4, 'cursus'],
    ]);
    // Cursus corrects the dates of ABS-9 (a newer event, same id): the rows are replaced.
    const fix = evt('absence.validee', { matricule: 'EMP-0042', start: '2026-11-16', end: '2026-11-17', nature: 'CP', id: 'ABS-9' }, { emis_le: '2026-10-06T08:00:00Z' });
    expect(await res(await post(fix))).toEqual({ status: 200, body: { ok: true, id: fix.id, status: 'received', accuse: `received · ${fix.id}` } });
    expect(await stored(e.id as string)).toBeUndefined();
    expect((await db.select().from(leaveEntries).where(eq(leaveEntries.externalId, 'cursus:ABS-9'))).map((w) => [w.leaveType, w.weekStart, w.days])).toEqual([['leave', '2026-11-16', 2]]);
  });

  it('the Cursus mirror\'s person resolves a matricule too; the Leave screen tile reads the last absence received', async () => {
    const db = await getDb();
    const [c] = await db.select().from(cursusClearances).where(sql`${cursusClearances.personId} is not null`).limit(1);
    await db.update(cursusClearances).set({ matricule: 'EMP-0077' }).where(eq(cursusClearances.id, c.id));
    const e = evt('absence.validee', { matricule: 'EMP-0077', start: '2026-10-19', end: '2026-10-20', nature: 'RTT' });
    expect(await res(await post(e))).toEqual({ status: 200, body: { ok: true, id: e.id, status: 'received', accuse: `received · ${e.id}` } });
    const rows = await db.select().from(leaveEntries).where(eq(leaveEntries.externalId, 'EMP-0077|2026-10-19|2026-10-20'));
    expect(rows.map((r) => [r.personId === c.personId, r.leaveType, r.days])).toEqual([[true, 'leave', 2]]);
    const { getLeaveCalendar } = await import('@/server/dal/hr');
    expect((await getLeaveCalendar()).lastAbsenceReceivedAt).not.toBeNull();
  });
});

describe('verdict.modifie and demande.decision', () => {
  it('no site sheet carries the Cursus site → unresolved; mock connector → recorded only; HTTP → the site is refreshed now', async () => {
    const db = await getDb();
    const e1 = evt('verdict.modifie', { chantier: 'K-2614' });
    expect(await res(await post(e1))).toEqual({ status: 200, body: { ok: true, id: e1.id, status: 'unresolved', accuse: `unresolved · ${e1.id}` } });
    const [hlt] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    await db.update(siteSheets).set({ cursusChantierId: 'K-2614' }).where(eq(siteSheets.projectId, hlt.id));
    const e2 = evt('verdict.modifie', { chantier: 'K-2614' });
    expect(await res(await post(e2))).toEqual({ status: 200, body: { ok: true, id: e2.id, status: 'received', accuse: `received · ${e2.id}` } });
    expect((await stored(e2.id as string))!.note).toMatch(/Recorded only/);
    // HTTP mode: the go-no-go of K-2614 is read at once, bypassing the one-minute throttle.
    vi.stubEnv('CURSUS_API_URL', 'http://cursus.test');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ chantier: 'K-2614', evalue_le: '2026-10-05T08:00:00Z', statut: 'GO', ressources: [] }), { status: 200 });
    }));
    const e3 = evt('verdict.modifie', { chantier: 'K-2614' });
    expect(await res(await post(e3))).toEqual({ status: 200, body: { ok: true, id: e3.id, status: 'received', accuse: `received · ${e3.id}` } });
    expect(calls).toEqual(['http://cursus.test/api/integrations/keystone/v1/chantiers/K-2614/go-no-go']);
    // Cursus unreachable: the event is kept in error (replayed later); Cursus is answered 200 (the event is stored).
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e4 = evt('verdict.modifie', { chantier: 'K-2614' });
    expect(await res(await post(e4))).toEqual({ status: 200, body: { ok: true, id: e4.id, status: 'error', accuse: `error · ${e4.id}` } });
    expect(await stored(e4.id as string)).toMatchObject({ status: 'error', note: expect.stringMatching(/refresh failed/) });
    await db.update(siteSheets).set({ cursusChantierId: null }).where(eq(siteSheets.projectId, hlt.id));
  });

  it('a travel-request decision is stored only', async () => {
    const e = evt('demande.decision', { demande: 12, statut: 'VALIDEE' });
    expect(await res(await post(e))).toEqual({ status: 200, body: { ok: true, id: e.id, status: 'received', accuse: `received · ${e.id}` } });
  });
});

describe('Cursus\'s contract (Cursus docs/API-KEYSTONE.md): POST /api/cursus/v1/evenements, Bearer, donnees', () => {
  // Exactly what Cursus's sender builds (server/src/integrations/keystone.ts `transportKeystone`): a UUID id, `donnees`, the
  // Bearer token and the Idempotency-Key header.
  let u = 0;
  const cursusEvt = (type: string, donnees: unknown, emis = '2026-10-10T08:41:07.512Z') =>
    ({ id: `0b9d7c1e-2f4a-4d3b-9a61-${String(++u).padStart(12, '0')}`, type, emis_le: emis, donnees });
  async function v1(body: { id: string }, opts: { token?: string | null; path?: string; headers?: Record<string, string> } = {}) {
    const token = opts.token === undefined ? DEMO_CURSUS_EVENTS_KEY : opts.token;
    const { POST } = opts.path === CURSUS_EVENTS_PATH ? await import('@/app/api/integrations/cursus/events/route') : await import('@/app/api/cursus/v1/evenements/route');
    return POST(new Request(`http://keystone.test${opts.path ?? CURSUS_EVENTS_V1_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9', 'idempotency-key': body.id, ...(token ? { authorization: `Bearer ${token}` } : {}), ...opts.headers },
      body: JSON.stringify(body),
    }));
  }
  const leaveOf = async (key: string) =>
    (await (await getDb()).select().from(leaveEntries).where(eq(leaveEntries.externalId, key))).map((w) => [w.leaveType, w.weekStart, w.startDate, w.endDate, w.days, w.source]);

  it('both routes take the Bearer token or X-Api-Key (same CURSUS_EVENTS_KEY, constant time); any other scheme or token is refused', async () => {
    const e = cursusEvt('heures.validees', { matricule: 'EMP-0012', semaine: '2026-10-05', projets: { 'HLT-026': 15 } });
    for (const token of ['wrong-token', DEMO_CURSUS_EVENTS_KEY.toUpperCase()]) expect((await v1(e, { token })).status, token).toBe(401);
    expect((await v1(e, { token: null, headers: { authorization: `Basic ${DEMO_CURSUS_EVENTS_KEY}` } })).status).toBe(401);
    expect((await v1(e, { token: null })).status).toBe(401);
    expect(await stored(e.id)).toBeUndefined();
    expect(await res(await v1(e))).toEqual({ status: 200, body: { ok: true, id: e.id, status: 'received', accuse: `received · ${e.id}` } });
    // A retry (same Idempotency-Key = id): 2xx with the same acknowledgement, not processed again.
    expect(await res(await v1(e))).toEqual({ status: 200, body: { ok: true, id: e.id, duplicate: true, accuse: `received · ${e.id}` } });
    expect(await auditsOf(e.id)).toHaveLength(1);
    // The earlier path takes the Bearer token too; the Cursus path takes X-Api-Key too.
    const e2 = cursusEvt('heures.validees', { matricule: 'EMP-0012', semaine: '2026-10-12', projets: {} });
    expect((await v1(e2, { path: CURSUS_EVENTS_PATH })).status).toBe(200);
    const e3 = cursusEvt('heures.validees', { matricule: 'EMP-0012', semaine: '2026-10-19', projets: {} });
    expect((await v1(e3, { token: null, headers: { 'x-api-key': DEMO_CURSUS_EVENTS_KEY } })).status).toBe(200);
    const h = (o: Record<string, string>) => presentedKey(new Headers(o));
    expect([h({ authorization: 'Bearer abc' }), h({ authorization: 'bearer  abc ' }), h({ authorization: 'Basic abc', 'x-api-key': 'k' }), h({}), h({ authorization: 'Bearer' })])
      .toEqual(['abc', 'abc', 'k', null, null]);
  });

  it('absence.validee { absence, du, au } → the leave calendar; a correction replaces the weeks; absence.annulee removes them', async () => {
    const db = await getDb();
    const [p] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    await db.update(persons).set({ matricule: 'EMP-0018' }).where(eq(persons.id, p.id));
    const absence = { absence: 31, matricule: 'EMP-0018' };
    // No nature (Cursus never sends it): Absence; a whole week.
    const a = cursusEvt('absence.validee', { ...absence, du: '2026-12-14', au: '2026-12-18' }, '2026-10-10T08:00:00.000Z');
    expect(await res(await v1(a))).toMatchObject({ status: 200, body: { status: 'received' } });
    expect(await leaveOf('cursus:31')).toEqual([['absence', '2026-12-14', '2026-12-14', '2026-12-18', 5, 'cursus']]);
    // Corrected dates (same absence id, a newer event): the old week goes, no stale week stays.
    const fix = cursusEvt('absence.validee', { ...absence, du: '2026-12-21', au: '2026-12-23' }, '2026-10-11T08:00:00.000Z');
    expect(await res(await v1(fix))).toMatchObject({ status: 200, body: { status: 'received' } });
    expect(await leaveOf('cursus:31')).toEqual([['absence', '2026-12-21', '2026-12-21', '2026-12-23', 3, 'cursus']]);
    expect(await stored(a.id)).toBeUndefined();
    // Cancelled: the weeks are removed; the event replaces the validation (one object), audited like any event.
    const cancel = cursusEvt('absence.annulee', { ...absence, du: '2026-12-21', au: '2026-12-23' }, '2026-10-12T08:00:00.000Z');
    expect(await res(await v1(cancel))).toEqual({ status: 200, body: { ok: true, id: cancel.id, status: 'received', accuse: `received · ${cancel.id}` } });
    expect(await leaveOf('cursus:31')).toEqual([]);
    expect(await stored(fix.id)).toBeUndefined();
    expect(await stored(cancel.id)).toMatchObject({ type: 'absence.annulee', replaceKey: 'cursus:31', note: 'Leave calendar · 1 week removed', data: { matricule: 'EMP-0018', start: '2026-12-21', end: '2026-12-23', id: '31' } });
    expect((await auditsOf(cancel.id))[0]).toMatchObject({ actorName: 'Cursus', area: 'Integrations', change: 'absence.annulee · received', entityType: 'cursus_event' });
    // The HR department re-sends the old validation after the cancellation: older than the last event applied → ignored.
    const resent = { ...fix, id: cursusEvt('x', {}).id };
    expect(await res(await v1(resent))).toMatchObject({ status: 200, body: { status: 'ignored' } });
    expect(await leaveOf('cursus:31')).toEqual([]);
    await db.update(persons).set({ matricule: null }).where(eq(persons.id, p.id));
  });

  it('absence.annulee for a matricule nobody carries and no week stored: unresolved, replayed later', async () => {
    const e = cursusEvt('absence.annulee', { absence: 99, matricule: 'EMP-0999', du: '2026-12-14', au: '2026-12-14' });
    expect(await res(await v1(e))).toMatchObject({ status: 200, body: { status: 'unresolved' } });
    const db = await getDb();
    const [p] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    await db.update(persons).set({ matricule: 'EMP-0999' }).where(eq(persons.id, p.id));
    await replayUnresolvedCursusEvents();
    expect(await stored(e.id)).toMatchObject({ status: 'received', note: 'Leave calendar · nothing to remove' });
    await db.update(persons).set({ matricule: null }).where(eq(persons.id, p.id));
  });

  it('demande.decision keeps Cursus\'s decision; deplacement.* are accepted and ignored', async () => {
    const d = cursusEvt('demande.decision', { demande: 7, reference: 'DK-2026-0412', matricule: 'EMP-0018', chantier: 'K-2611', decision: 'acceptee', date: '2026-10-10' });
    expect(await res(await v1(d))).toMatchObject({ status: 200, body: { status: 'received' } });
    expect((await stored(d.id))!.data).toEqual({ demande: 7, statut: 'acceptee' });
    const t = cursusEvt('deplacement.modifie', { deplacement: 12, demande: 7, reference: 'DK-2026-0412', matricule: 'EMP-0018', chantier: 'K-2611', destination: 'MA', depart: '2026-11-02', retour: '2026-11-20', date: '2026-10-14' });
    expect(await res(await v1(t))).toEqual({ status: 200, body: { ok: true, id: t.id, status: 'ignored', accuse: `ignored · ${t.id}` } });
    expect((await stored(t.id))!.data).toEqual({});
  });
});

describe('purge and the Cursus row', () => {
  it('the daily job deletes the events received more than 13 months ago', async () => {
    const db = await getDb();
    await db.insert(cursusEvents).values({
      eventId: 'evt-old', type: 'heures.validees', emittedAt: new Date('2025-08-01T00:00:00Z'), receivedAt: new Date('2025-08-01T00:00:00Z'), data: {}, status: 'received',
    });
    expect(await purgeOldCursusEvents(new Date('2026-10-12T00:00:00Z'))).toBe(1);
    expect(await stored('evt-old')).toBeUndefined();
    const before = (await db.select({ n: sql<number>`count(*)::int` }).from(cursusEvents))[0].n;
    expect(await jobDefinition('cursus-events-purge').run()).toEqual({ summary: '0 Cursus events older than 13 months purged', counts: { removed: 0 } });
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(cursusEvents))[0].n).toBe(before);
  });

  it('Activity & integrations: the Cursus row shows the last event received and the unresolved count', async () => {
    const db = await getDb();
    const [last] = await db.select({ at: cursusEvents.receivedAt }).from(cursusEvents).orderBy(desc(cursusEvents.receivedAt)).limit(1);
    const [{ u }] = await db.select({ u: sql<number>`count(*)::int` }).from(cursusEvents).where(and(sql`${cursusEvents.status} in ('unresolved', 'error')`));
    const cursus = (await listConnectors()).find((c) => c.name === 'Cursus')!;
    expect(cursus.lastVolume).toContain('Last Cursus event · ');
    expect(cursus.lastVolume).toContain(`Unresolved events · ${u}`);
    expect(last).toBeDefined();
  });
});
