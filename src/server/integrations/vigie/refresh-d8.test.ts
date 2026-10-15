// Vigie full refresh, delivery 8 (lot connectors) — on an in-memory PGlite seeded with the demo data:
// - R-023 (V-2): a row Vigie no longer lists is pruned only once all its progress has been delivered; undelivered entries
//   (pending, failed) survive the refresh and are redelivered by the outbox job, then the row goes at the next refresh;
// - R-015 (X-6a), dormant until Vigie's API (V-3): the HTTP refresh notifies a new NCR (project leads + quality / engineering
//   referents) and an ECO entering "In approval" (holders of its pending keys); a second identical refresh notifies nothing.
// fetch is stubbed; the HTTP connectors are used through VIGIE_API_URL.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ecosEnteringApproval, newNcrs, pendingApprovalKeys } from '@/domain/vigie-events';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { notificationRecipients, notifications, persons, users, vigieEcoProgress, vigieEcos, vigieNcrProgress, vigieNcrs } from '@/server/db/schema';
import { httpEcoConnector, mockEcoConnector, redeliverEcoOutbox, resetVigieRefreshThrottle } from './eco-connector';
import { httpQualityConnector, mockQualityConnector, redeliverNcrOutbox, resetVigieQualityRefreshThrottle } from './quality-connector';
import type { VigieEco, VigieEcoRecord, VigieNcrRecord } from './types';

const ecoRecord = (e: VigieEco, over: Partial<VigieEcoRecord> = {}): VigieEcoRecord => ({
  number: e.number, title: e.title, type: e.type, status: e.status, interchangeability: e.interchangeability, fromRevision: e.fromRevision, toRevision: e.toRevision,
  costEur: e.costEur, scheduleDays: e.scheduleDays, stockImpact: e.stockImpact, documentRefs: e.documentRefs, requestedBy: e.requestedBy, raisedOn: e.raisedOn,
  pendingDispositions: e.pendingDispositions, locked: e.locked, parts: e.parts, projects: e.projects,
  approvals: e.approvals.map((a) => ({ key: a.key, decision: a.decision, approver: a.approver, decidedBy: a.decidedBy, decidedAt: a.decidedAt })), effectivity: e.effectivity,
  updatedAt: null, ...over,
});

/** Vigie answers: the GET lists of the test, POSTs per `post` (status). */
function stubVigie(lists: { ecos?: VigieEcoRecord[]; ncrs?: VigieNcrRecord[] }, post: { status: number }) {
  const posted: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push(String(url));
      return new Response(JSON.stringify({ id: `V-${posted.length}` }), { status: post.status });
    }
    if (String(url).endsWith('/api/ecos?source=keystone')) return new Response(JSON.stringify(lists.ecos ?? []), { status: 200 });
    if (String(url).endsWith('/api/ncrs?source=keystone')) return new Response(JSON.stringify(lists.ncrs ?? []), { status: 200 });
    if (String(url).endsWith('/api/hse?source=keystone')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }));
  return posted;
}

/** Recipients (full names, sorted) of the notifications titled `title`, newest first. */
async function notices(title: string): Promise<{ sub: string; to: string[] }[]> {
  const db = await getDb();
  const rows = await db.select({ id: notifications.id, sub: notifications.body }).from(notifications).where(eq(notifications.title, title)).orderBy(desc(notifications.createdAt));
  if (!rows.length) return [];
  const to = await db.select({ n: notificationRecipients.notificationId, name: persons.fullName }).from(notificationRecipients)
    .innerJoin(users, eq(users.id, notificationRecipients.userId)).innerJoin(persons, eq(persons.id, users.personId))
    .where(inArray(notificationRecipients.notificationId, rows.map((r) => r.id)));
  return rows.map((r) => ({ sub: r.sub, to: to.filter((x) => x.n === r.id).map((x) => x.name ?? '').sort() }));
}

const ncrRecords = async (): Promise<VigieNcrRecord[]> =>
  (await mockQualityConnector.listNcrs()).map((n) => ({
    projectCode: n.projectCode, number: n.number, vigieRef: n.vigieRef, title: n.title, severity: n.severity, source: n.source, status: n.status, activityCode: n.activityCode,
    partRef: n.partRef, deliverableNumber: n.deliverableNumber, supplierName: n.supplierName, inspectionNumber: n.inspectionNumber, raisedBy: n.raisedBy, raisedOn: n.raisedOn,
    owner: n.owner, rootCause: n.rootCause, action: n.action, dueOn: n.dueOn, costKeur: n.costKeur, isoClause: n.isoClause, updatedAt: null,
  }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

beforeEach(() => {
  vi.stubEnv('VIGIE_API_URL', 'http://vigie.test');
  resetVigieRefreshThrottle();
  resetVigieQualityRefreshThrottle();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pure diff rules (R-015)', () => {
  it('new NCRs by project and number; ECOs entering approval; pending keys', () => {
    const before = [{ projectCode: 'HLT-026', number: 'NCR-029' }, { projectCode: 'NDC-031', number: 'NCR-040' }];
    expect(newNcrs(before, [{ projectCode: 'HLT-026', number: 'NCR-029' }, { projectCode: 'RCF-019', number: 'NCR-040' }, { projectCode: 'HLT-026', number: 'EV-2026-130' }]))
      .toEqual([{ projectCode: 'RCF-019', number: 'NCR-040' }, { projectCode: 'HLT-026', number: 'EV-2026-130' }]);
    const statuses = new Map([['ECO-1', 'in_approval'], ['ECO-2', 'impact_analysis']]);
    expect(ecosEnteringApproval(statuses, [{ number: 'ECO-1', status: 'in_approval' }, { number: 'ECO-2', status: 'in_approval' }, { number: 'ECO-3', status: 'in_approval' }, { number: 'ECO-4', status: 'draft' }])
      .map((e) => e.number)).toEqual(['ECO-2', 'ECO-3']);
    expect(pendingApprovalKeys({ approvals: [{ key: 'englead', decision: 'ok' }, { key: 'quality', decision: 'pending' }, { key: 'pm', decision: 'pending' }] })).toEqual(['quality', 'pm']);
  });
});

describe('R-023 — ECO mirror: undelivered progress survives a full refresh', () => {
  it('a failed delivery keeps the ECO Vigie no longer lists; the outbox redelivers it; the next refresh prunes it', async () => {
    const all = await mockEcoConnector.listEcos();
    const kept = all.filter((e) => e.number !== 'ECO-2026-017' && e.number !== 'ECO-2026-012').map((e) => ecoRecord(e));
    // Vigie refuses the delivery (503): the entry recorded on ECO-2026-017 stays failed.
    let posted = stubVigie({ ecos: kept }, { status: 503 });
    const rec = await httpEcoConnector.recordProgress('ECO-2026-017', { step: 'impact_analysis' }, { name: 'Fabien Bertrand', role: 'procurement' });
    expect(rec.syncStatus).toBe('failed');
    const r1 = await httpEcoConnector.sync();
    expect([r1.delivered, r1.failed, r1.refreshed]).toEqual([0, 1, kept.length]);
    const db = await getDb();
    const numbers = async () => (await db.select({ n: vigieEcos.number }).from(vigieEcos)).map((r) => r.n).sort();
    // ECO-2026-012 (no progress) is pruned; ECO-2026-017 (failed entry) is kept with its entry.
    expect(await numbers()).toEqual([...kept.map((e) => e.number), 'ECO-2026-017'].sort());
    const [entry] = await db.select().from(vigieEcoProgress).where(eq(vigieEcoProgress.id, rec.id));
    expect(entry.syncStatus).toBe('failed');
    // Vigie answers again: the outbox job redelivers the entry.
    posted = stubVigie({ ecos: kept }, { status: 200 });
    expect(await redeliverEcoOutbox()).toMatchObject({ mode: 'http', delivered: 1, failed: 0, pending: 0 });
    expect(posted).toEqual(['http://vigie.test/api/ecos/ECO-2026-017/progress']);
    // Everything sent: the next full refresh prunes ECO-2026-017 (its sent history with it).
    resetVigieRefreshThrottle();
    await httpEcoConnector.sync();
    expect(await numbers()).toEqual(kept.map((e) => e.number).sort());
  });

  it('an empty refresh keeps only the rows with undelivered entries', async () => {
    stubVigie({ ecos: [] }, { status: 500 });
    const target = (await mockEcoConnector.listEcos()).find((e) => e.status === 'draft' || e.status === 'impact_analysis');
    const db = await getDb();
    if (target) await httpEcoConnector.recordProgress(target.number, { step: target.status === 'draft' ? 'impact_analysis' : 'in_approval' }, { name: 'Fabien Bertrand', role: 'procurement' }).catch(() => null);
    await httpEcoConnector.sync();
    const left = await db.select({ n: vigieEcos.number }).from(vigieEcos);
    const withUndelivered = await db.selectDistinct({ n: vigieEcoProgress.ecoNumber }).from(vigieEcoProgress).where(inArray(vigieEcoProgress.syncStatus, ['pending', 'failed']));
    expect(left.map((r) => r.n).sort()).toEqual(withUndelivered.map((r) => r.n).sort());
  });
});

describe('R-023 — NCR mirror: undelivered progress survives a full refresh', () => {
  it('NCR-041 of NDC-031 with a failed entry stays when Vigie stops listing it; NCR-040 (nothing pending) goes', async () => {
    const records = await ncrRecords();
    const without = records.filter((r) => r.projectCode !== 'NDC-031');
    stubVigie({ ncrs: without }, { status: 503 });
    const rec = await httpQualityConnector.recordNcrProgress('NDC-031', 'NCR-041', { step: 'root_cause' }, { name: 'Gabriel Comte', role: 'quality' });
    expect(rec.syncStatus).toBe('failed');
    await httpQualityConnector.sync();
    const db = await getDb();
    const ndc = async () => (await db.select({ n: vigieNcrs.number }).from(vigieNcrs).where(eq(vigieNcrs.projectCode, 'NDC-031'))).map((r) => r.n);
    expect(await ndc()).toEqual(['NCR-041']);
    stubVigie({ ncrs: without }, { status: 200 });
    expect(await redeliverNcrOutbox()).toMatchObject({ mode: 'http', delivered: 1, pending: 0 });
    resetVigieQualityRefreshThrottle();
    await httpQualityConnector.sync();
    expect(await ndc()).toEqual([]);
    expect(await db.select().from(vigieNcrProgress).where(and(eq(vigieNcrProgress.projectCode, 'NDC-031'), eq(vigieNcrProgress.ncrNumber, 'NCR-041')))).toEqual([]);
  });
});

describe('R-015 — dormant Vigie hooks (HTTP refresh only)', () => {
  // A fresh seeded database: the pruning scenarios above emptied the mirrors.
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('a new NCR on HLT-026 notifies its PM and its quality and engineering referents; the second refresh notifies nothing', async () => {
    const records = await ncrRecords();
    const raised: VigieNcrRecord = { ...records.find((r) => r.projectCode === 'HLT-026')!, number: 'EV-2026-130', vigieRef: 'EV-2026-130', title: 'Weld porosity on girder G4', severity: 'major', status: 'open', raisedBy: 'Thomas Kerbrat' };
    // A new NCR on a project without leads or referents (NDC-031 has no PM of record) notifies nobody.
    const orphan: VigieNcrRecord = { ...raised, projectCode: 'NDC-031', number: 'EV-2026-131', vigieRef: 'EV-2026-131' };
    stubVigie({ ncrs: [...records, raised, orphan] }, { status: 200 });
    await httpQualityConnector.sync();
    expect(await notices('Non-conformity raised in Vigie')).toEqual([
      { sub: 'EV-2026-130 · Major · Weld porosity on girder G4 · Thomas Kerbrat', to: ['Antoine Girard', 'Gabriel Comte', 'Romain Aubert'] },
    ]);
    resetVigieQualityRefreshThrottle();
    await httpQualityConnector.sync();
    expect(await notices('Non-conformity raised in Vigie')).toHaveLength(1);
  });

  it('an ECO entering approval notifies the holders of its pending keys (PM key → leads of the affected projects)', async () => {
    const all = await mockEcoConnector.listEcos();
    // ECO-2026-016 moves to In approval with its three keys pending; ECO-2026-015 was already in approval (no notice).
    const records = all.map((e) => ecoRecord(e, e.number === 'ECO-2026-016' ? { status: 'in_approval' } : {}));
    stubVigie({ ecos: records }, { status: 200 });
    await httpEcoConnector.sync();
    expect(await notices('Change order waiting for your approval')).toEqual([
      { sub: `ECO-2026-016 · ${all.find((e) => e.number === 'ECO-2026-016')!.title}`, to: ['Antoine Girard', 'Gabriel Comte', 'Romain Aubert'] },
    ]);
    resetVigieRefreshThrottle();
    await httpEcoConnector.sync();
    expect(await notices('Change order waiting for your approval')).toHaveLength(1);
  });

  it('the mock connector never notifies (the hooks are dormant until Vigie publishes its API)', async () => {
    vi.unstubAllEnvs();
    const before = (await notices('Non-conformity raised in Vigie')).length;
    expect(await mockQualityConnector.sync()).toMatchObject({ refreshed: 0 });
    expect(await mockEcoConnector.sync()).toMatchObject({ refreshed: 0 });
    expect(await notices('Non-conformity raised in Vigie')).toHaveLength(before);
  });
});
