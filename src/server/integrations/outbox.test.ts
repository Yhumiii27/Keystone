// R-010: connector outboxes under concurrent deliveries — an entry is claimed before it is sent, so two deliveries running at
// the same time (two users, a page and the worker, two instances) never send it twice; a failed attempt releases the claim; a
// claim older than the lease no longer blocks. Refreshes of one process are shared. R-007: no Cursus call without a key in
// production. Vigie (D12, D13): its views and functions simulated in the test database (src/test/vigie-server.ts).
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { cursusRequests, vigieEcoProgress, vigieNcrProgress } from '@/server/db/schema';
import { recordEcoProgress } from '@/server/dal/eco';
import { advanceNcr } from '@/server/dal/quality';
import { claimRequestDelivery, markRequestDelivery } from './cursus/mirror';
import { httpCursusConnector, mockCursusConnector, resetCursusRefreshThrottle } from './cursus/connector';
import { DELIVERY_LEASE_MS } from './outbox';
import { createVigieServer, vigieRequests } from '@/test/vigie-server';
import { resetVigieRefreshThrottle, sqlEcoConnector } from './vigie/eco-connector';
import { claimProgressDelivery, markDelivery, undeliveredProgress } from './vigie/mirror';
import { claimNcrDelivery, markNcrDelivery } from './vigie/quality-mirror';

const PM = { name: 'Romain Aubert', role: 'pm' };
const PROC = { name: 'Fabien Bertrand', role: 'procurement' };

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('claims (one conditional UPDATE per entry)', () => {
  it('ECO progress: claimed once; a failure releases it; a sent entry is never claimed; an expired claim is taken over', async () => {
    const r = await recordEcoProgress('ECO-2026-015', { key: 'pm', decision: 'ok' }, PM);
    const db = await getDb();
    expect(await claimProgressDelivery(db, r.id)).toBe(true);
    expect(await claimProgressDelivery(db, r.id)).toBe(false);
    // A transient failure (D12: anything but P0V01 / P0V02) keeps the entry pending and releases the claim.
    await markDelivery(db, r.id, { ok: false, error: 'connection reset', retry: true });
    const [failed] = await db.select().from(vigieEcoProgress).where(eq(vigieEcoProgress.id, r.id));
    expect([failed.syncStatus, failed.attempts, failed.claimedAt]).toEqual(['pending', 1, null]);
    const t0 = new Date();
    expect(await claimProgressDelivery(db, r.id, t0)).toBe(true);
    expect(await claimProgressDelivery(db, r.id, new Date(t0.getTime() + DELIVERY_LEASE_MS - 1000))).toBe(false);
    expect(await claimProgressDelivery(db, r.id, new Date(t0.getTime() + DELIVERY_LEASE_MS + 1000))).toBe(true);
    await markDelivery(db, r.id, { ok: true, vigieRef: 'V-1' });
    const [sent] = await db.select().from(vigieEcoProgress).where(eq(vigieEcoProgress.id, r.id));
    expect([sent.syncStatus, sent.attempts, sent.claimedAt, sent.vigieRef]).toEqual(['sent', 2, null, 'V-1']);
    expect(await claimProgressDelivery(db, r.id)).toBe(false);
  });

  it('NCR progress and Cursus requests follow the same rule', async () => {
    const db = await getDb();
    const { id } = await advanceNcr('HLT-026', 'EV-2026-028', { name: 'Romain Aubert', role: 'pm' });
    expect(await claimNcrDelivery(db, id)).toBe(true);
    expect(await claimNcrDelivery(db, id)).toBe(false);
    await markNcrDelivery(db, id, { ok: false, error: 'connection reset', retry: true });
    const [ncr] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, id));
    expect([ncr.syncStatus, ncr.attempts, ncr.claimedAt]).toEqual(['pending', 1, null]);
    expect(await claimNcrDelivery(db, id)).toBe(true);
    const q = await mockCursusConnector.remind('HLT-026', 'Thomas Kerbrat', { ...PM, role: 'pm' });
    expect(await claimRequestDelivery(db, q.id)).toBe(true);
    expect(await claimRequestDelivery(db, q.id)).toBe(false);
    await markRequestDelivery(db, q.id, { ok: true, cursusRef: '7' });
    expect(await claimRequestDelivery(db, q.id)).toBe(false);
    const [row] = await db.select().from(cursusRequests).where(eq(cursusRequests.id, q.id));
    expect([row.syncStatus, row.attempts, row.claimedAt]).toEqual(['sent', 1, null]);
  });
});

describe('concurrent deliveries (Vigie on the shared server, Cursus over HTTP)', () => {
  it('two Vigie syncs at the same time deposit each outbox entry once (D12: vigie.pub_signaler_avancement_eco)', async () => {
    await recordEcoProgress('ECO-2026-017', { step: 'impact_analysis' }, PROC);
    const db = await getDb();
    const pending = (await undeliveredProgress(db)).map((e) => e.id);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    await createVigieServer(db);
    resetVigieRefreshThrottle();
    const [a, b] = await Promise.all([sqlEcoConnector.sync(), sqlEcoConnector.sync()]);
    const deposited = (await vigieRequests(db)).map((r) => r.external_id);
    expect(deposited.sort()).toEqual([...pending].sort());
    expect(a.delivered + b.delivered).toBe(pending.length);
    expect(a.failed + b.failed).toBe(0);
    expect(await undeliveredProgress(db)).toEqual([]);
  });

  it('concurrent reads share one refresh from Vigie', async () => {
    const db = await getDb();
    await createVigieServer(db);
    // Each read of the orders view takes one number of a sequence.
    await db.execute(sql.raw('create sequence vigie.reads'));
    await db.execute(sql.raw('create or replace view vigie.pub_ordres_modification as select e.* from (select nextval(\'vigie.reads\') as n) t join vigie.eco_rows e on true'));
    resetVigieRefreshThrottle();
    await Promise.all([sqlEcoConnector.listEcos(), sqlEcoConnector.listEcos(), sqlEcoConnector.listEcos()]);
    const [{ n }] = (await db.execute(sql.raw('select last_value::int as n from vigie.reads'))).rows as { n: number }[];
    expect(n).toBe(1);
  });

  it('Cursus in production without an API key: nothing is sent, the attempt is recorded as failed', async () => {
    const db = await getDb();
    await db.execute(sql`update site_sheets set cursus_chantier_id = 'K-2614'`);
    await db.execute(sql`update cursus_clearances set matricule = 'EMP-0018' where person_name = 'Thomas Kerbrat'`);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CURSUS_API_URL', 'http://cursus.test');
    resetCursusRefreshThrottle();
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await httpCursusConnector.requestTravel('HLT-026', { personName: 'Thomas Kerbrat', destination: 'fr', depart: '2026-10-26', retour: '2026-11-27' }, PM);
    expect(r.syncStatus).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await db.select().from(cursusRequests).where(eq(cursusRequests.id, r.id));
    expect(row.lastError).toBe('CURSUS_API_KEY is not set');
  });
});
