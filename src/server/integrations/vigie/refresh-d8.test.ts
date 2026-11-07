// Vigie full refresh, delivery 8 (lot connectors) — on an in-memory PGlite seeded with the demo data:
// - R-023 (V-2): a row Vigie no longer lists is pruned only once all its progress has been delivered; undelivered entries
//   (pending, failed) survive the refresh and are redelivered by the outbox job, then the row goes at the next refresh;
// - R-015 (X-6a): the refresh from Vigie's views notifies a new NCR (project leads + quality / engineering referents) and an
//   ECO entering "In approval" (holders of its pending keys); a second identical refresh notifies nothing.
// D12 / D13: Vigie is read through its views and written through its functions — simulated in the PGlite database
// (src/test/vigie-server.ts); the sql connectors are used directly. Demo NCR numbers are Vigie's (CV-07: EV-2026-040 / 041 on
// NDC-031, the prototype's EV-2026-040 / EV-2026-041).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ecosEnteringApproval, ecosToAnnounce, ncrsToAnnounce, newNcrs, pendingApprovalKeys } from '@/domain/vigie-events';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { notificationRecipients, notifications, persons, users, vigieEcoProgress, vigieEcos, vigieNcrProgress, vigieNcrs } from '@/server/db/schema';
import { createVigieServer, setVigieEcoRows, setVigieQualityRows } from '@/test/vigie-server';
import { mockEcoConnector, redeliverEcoOutbox, resetVigieRefreshThrottle, sqlEcoConnector as httpEcoConnector } from './eco-connector';
import { mockQualityConnector, redeliverNcrOutbox, resetVigieQualityRefreshThrottle, sqlQualityConnector as httpQualityConnector } from './quality-connector';
import type { VigieEco, VigieEcoRecord, VigieNcrRecord } from './types';

const ecoRecord = (e: VigieEco, over: Partial<VigieEcoRecord> = {}): VigieEcoRecord => ({
  number: e.number, title: e.title, type: e.type, status: e.status, interchangeability: e.interchangeability, fromRevision: e.fromRevision, toRevision: e.toRevision,
  costEur: e.costEur, scheduleDays: e.scheduleDays, stockImpact: e.stockImpact, documentRefs: e.documentRefs, requestedBy: e.requestedBy, raisedOn: e.raisedOn,
  pendingDispositions: e.pendingDispositions, locked: e.locked, parts: e.parts, projects: e.projects,
  approvals: e.approvals.map((a) => ({ key: a.key, decision: a.decision, approver: a.approver, decidedBy: a.decidedBy, decidedAt: a.decidedAt })), effectivity: e.effectivity,
  updatedAt: null, ...over,
});

/**
 * Vigie's side of the shared server for the test (D12, D13: views and functions, src/test/vigie-server.ts): the given lists are
 * published; `functions: false` = the functions not there yet (a deposit fails and is retried).
 */
async function stubVigie(lists: { ecos?: VigieEcoRecord[]; ncrs?: VigieNcrRecord[] }, opts: { functions?: boolean } = {}) {
  const db = await getDb();
  await createVigieServer(db, { functions: opts.functions ?? true });
  await setVigieQualityRows(db, { ncrs: lists.ncrs ?? [], hse: [] });
  await setVigieEcoRows(db, lists.ecos ?? []);
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
  resetVigieRefreshThrottle();
  resetVigieQualityRefreshThrottle();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pure diff rules (R-015)', () => {
  it('new NCRs by project and number; ECOs entering approval; pending keys', () => {
    const before = [{ projectCode: 'HLT-026', number: 'EV-2026-029' }, { projectCode: 'NDC-031', number: 'EV-2026-040' }];
    expect(newNcrs(before, [{ projectCode: 'HLT-026', number: 'EV-2026-029' }, { projectCode: 'RCF-019', number: 'EV-2026-042' }, { projectCode: 'HLT-026', number: 'EV-2026-130' }]))
      .toEqual([{ projectCode: 'RCF-019', number: 'EV-2026-042' }, { projectCode: 'HLT-026', number: 'EV-2026-130' }]);
    const statuses = new Map([['ECO-1', 'in_approval'], ['ECO-2', 'impact_analysis']]);
    expect(ecosEnteringApproval(statuses, [{ number: 'ECO-1', status: 'in_approval' }, { number: 'ECO-2', status: 'in_approval' }, { number: 'ECO-3', status: 'in_approval' }, { number: 'ECO-4', status: 'draft' }])
      .map((e) => e.number)).toEqual(['ECO-2', 'ECO-3']);
    expect(pendingApprovalKeys({ approvals: [{ key: 'englead', decision: 'ok' }, { key: 'quality', decision: 'pending' }, { key: 'pm', decision: 'pending' }] })).toEqual(['quality', 'pm']);
  });

  it('integration review: an empty mirror is the baseline (nothing announced); a closed NCR is never announced as raised', () => {
    const records = [{ projectCode: 'HLT-026', number: 'EV-2026-027', status: 'closed' }, { projectCode: 'HLT-026', number: 'EV-2026-130', status: 'open' }];
    expect(ncrsToAnnounce([], records)).toEqual([]);
    expect(ncrsToAnnounce([{ projectCode: 'HLT-026', number: 'EV-2026-029' }], records)).toEqual([{ projectCode: 'HLT-026', number: 'EV-2026-130', status: 'open' }]);
    expect(ecosToAnnounce(new Map(), [{ number: 'ECO-1', status: 'in_approval' }])).toEqual([]);
    expect(ecosToAnnounce(new Map([['ECO-2', 'draft']]), [{ number: 'ECO-1', status: 'in_approval' }])).toEqual([{ number: 'ECO-1', status: 'in_approval' }]);
  });
});

describe('R-023 — ECO mirror: undelivered progress survives a full refresh', () => {
  it('an undelivered entry keeps the ECO Vigie no longer lists; the outbox delivers it; the next refresh prunes it', async () => {
    const all = await mockEcoConnector.listEcos();
    const kept = all.filter((e) => e.number !== 'ECO-2026-017' && e.number !== 'ECO-2026-012').map((e) => ecoRecord(e));
    // Vigie's function is not there yet (link or migration missing): the entry recorded on ECO-2026-017 stays pending, with its error.
    await stubVigie({ ecos: kept }, { functions: false });
    const rec = await httpEcoConnector.recordProgress('ECO-2026-017', { step: 'impact_analysis' }, { name: 'Fabien Bertrand', role: 'procurement' });
    expect(rec.syncStatus).toBe('pending');
    const r1 = await httpEcoConnector.sync();
    expect([r1.delivered, r1.failed, r1.pending, r1.refreshed]).toEqual([0, 1, 1, kept.length]);
    const db = await getDb();
    const numbers = async () => (await db.select({ n: vigieEcos.number }).from(vigieEcos)).map((r) => r.n).sort();
    // ECO-2026-012 (no progress) is pruned; ECO-2026-017 (undelivered entry) is kept with its entry.
    expect(await numbers()).toEqual([...kept.map((e) => e.number), 'ECO-2026-017'].sort());
    const [entry] = await db.select().from(vigieEcoProgress).where(eq(vigieEcoProgress.id, rec.id));
    expect([entry.syncStatus, entry.attempts, entry.lastError]).toEqual(['pending', 2, expect.stringContaining('pub_signaler_avancement_eco')]);
    // Vigie's function is there: the outbox job deposits the entry (its request number kept).
    await stubVigie({ ecos: kept });
    expect(await redeliverEcoOutbox('sql')).toMatchObject({ mode: 'sql', delivered: 1, failed: 0, pending: 0 });
    const [sent] = await db.select().from(vigieEcoProgress).where(eq(vigieEcoProgress.id, rec.id));
    expect([sent.syncStatus, sent.vigieRef]).toEqual(['sent', '1']);
    // Everything sent: the next full refresh prunes ECO-2026-017 (its sent history with it).
    resetVigieRefreshThrottle();
    await httpEcoConnector.sync();
    expect(await numbers()).toEqual(kept.map((e) => e.number).sort());
  });

  it('an empty refresh keeps only the rows with undelivered entries', async () => {
    await stubVigie({ ecos: [] }, { functions: false });
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
  it('EV-2026-041 of NDC-031 with an undelivered entry stays when Vigie stops listing it; EV-2026-040 (nothing pending) goes', async () => {
    const records = await ncrRecords();
    const without = records.filter((r) => r.projectCode !== 'NDC-031');
    await stubVigie({ ncrs: without }, { functions: false });
    const rec = await httpQualityConnector.recordNcrProgress('NDC-031', 'EV-2026-041', { step: 'root_cause' }, { name: 'Gabriel Comte', role: 'quality' });
    expect(rec.syncStatus).toBe('pending');
    await httpQualityConnector.sync();
    const db = await getDb();
    const ndc = async () => (await db.select({ n: vigieNcrs.number }).from(vigieNcrs).where(eq(vigieNcrs.projectCode, 'NDC-031'))).map((r) => r.n);
    expect(await ndc()).toEqual(['EV-2026-041']);
    await stubVigie({ ncrs: without });
    expect(await redeliverNcrOutbox('sql')).toMatchObject({ mode: 'sql', delivered: 1, pending: 0 });
    resetVigieQualityRefreshThrottle();
    await httpQualityConnector.sync();
    expect(await ndc()).toEqual([]);
    expect(await db.select().from(vigieNcrProgress).where(and(eq(vigieNcrProgress.projectCode, 'NDC-031'), eq(vigieNcrProgress.ncrNumber, 'EV-2026-041')))).toEqual([]);
  });
});

describe('R-015 — Vigie hooks (refresh from Vigie’s views only)', () => {
  // A fresh seeded database: the pruning scenarios above emptied the mirrors.
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('a new NCR on HLT-026 notifies its PM and its quality and engineering referents; the second refresh notifies nothing', async () => {
    const records = await ncrRecords();
    const raised: VigieNcrRecord = { ...records.find((r) => r.projectCode === 'HLT-026')!, number: 'EV-2026-130', vigieRef: 'EV-2026-130', title: 'Weld porosity on girder G4', severity: 'major', status: 'open', raisedBy: 'Thomas Kerbrat' };
    // A new NCR on a project without leads or referents (NDC-031 has no PM of record) notifies nobody.
    const orphan: VigieNcrRecord = { ...raised, projectCode: 'NDC-031', number: 'EV-2026-131', vigieRef: 'EV-2026-131' };
    await stubVigie({ ncrs: [...records, raised, orphan] });
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
    await stubVigie({ ecos: records });
    await httpEcoConnector.sync();
    expect(await notices('Change order waiting for your approval')).toEqual([
      { sub: `ECO-2026-016 · ${all.find((e) => e.number === 'ECO-2026-016')!.title}`, to: ['Antoine Girard', 'Gabriel Comte', 'Romain Aubert'] },
    ]);
    resetVigieRefreshThrottle();
    await httpEcoConnector.sync();
    expect(await notices('Change order waiting for your approval')).toHaveLength(1);
  });

  it('the mock connector never notifies (the simulation reads no view)', async () => {
    const before = (await notices('Non-conformity raised in Vigie')).length;
    expect(await mockQualityConnector.sync()).toMatchObject({ refreshed: 0 });
    expect(await mockEcoConnector.sync()).toMatchObject({ refreshed: 0 });
    expect(await notices('Non-conformity raised in Vigie')).toHaveLength(before);
  });
});

describe('R-015 — integration review: no flood on the first live refresh, no closed NCR announced', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('a new NCR already closed in Vigie is not announced; a new open one is', async () => {
    const records = await ncrRecords();
    const hlt = records.find((r) => r.projectCode === 'HLT-026')!;
    const closed: VigieNcrRecord = { ...hlt, number: 'EV-2026-140', vigieRef: 'EV-2026-140', title: 'Closed before Keystone read it', status: 'closed' };
    const open: VigieNcrRecord = { ...hlt, number: 'EV-2026-141', vigieRef: 'EV-2026-141', title: 'Anchor bolt misaligned', severity: 'minor', status: 'containment', raisedBy: 'Thomas Kerbrat' };
    const before = (await notices('Non-conformity raised in Vigie')).length;
    await stubVigie({ ncrs: [...records, closed, open] });
    await httpQualityConnector.sync();
    const after = await notices('Non-conformity raised in Vigie');
    expect(after).toHaveLength(before + 1);
    expect(after[0].sub).toMatch(/^EV-2026-141 · /);
  });

  it('first refresh of an empty mirror (production database): Vigie’s history is the baseline — no NCR or ECO notice', async () => {
    const ncrs = await ncrRecords();
    const ecos = (await mockEcoConnector.listEcos()).map((e) => ecoRecord(e));
    expect(ncrs.some((r) => r.projectCode === 'HLT-026' && r.status !== 'closed')).toBe(true);
    expect(ecos.some((e) => e.status === 'in_approval')).toBe(true);
    const db = await getDb();
    await db.delete(vigieNcrs);
    await db.delete(vigieEcos);
    const ncrBefore = (await notices('Non-conformity raised in Vigie')).length;
    const ecoBefore = (await notices('Change order waiting for your approval')).length;
    await stubVigie({ ncrs, ecos });
    await httpQualityConnector.sync();
    await httpEcoConnector.sync();
    expect((await db.select({ n: vigieNcrs.number }).from(vigieNcrs)).length).toBe(ncrs.length);
    expect((await notices('Non-conformity raised in Vigie')).length).toBe(ncrBefore);
    expect((await notices('Change order waiting for your approval')).length).toBe(ecoBefore);
    // The next refresh compares with that baseline: a new NCR is announced.
    const raised: VigieNcrRecord = { ...ncrs.find((r) => r.projectCode === 'HLT-026')!, number: 'EV-2026-150', vigieRef: 'EV-2026-150', title: 'Grout voids at base plate', status: 'open' };
    await stubVigie({ ncrs: [...ncrs, raised], ecos });
    resetVigieQualityRefreshThrottle();
    await httpQualityConnector.sync();
    expect((await notices('Non-conformity raised in Vigie')).length).toBe(ncrBefore + 1);
  });
});
