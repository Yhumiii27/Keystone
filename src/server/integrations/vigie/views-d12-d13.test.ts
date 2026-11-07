// D12 / D13 (Vigie, validated by the owner on 5 and 6 Nov 2026): the sql connectors against Vigie's side of the shared server built
// in the in-memory demo database (src/test/vigie-server.ts: the publications and the two functions copied from Vigie's migrations
// 0026 and 0029, vigie.pub_demandes_recues as Matrix defines it).
// - reads: vigie.pub_non_conformites / pub_hse_projet / pub_ordres_modification / pub_eco_approbations / pub_eco_effectivite replace
//   the mirrors (malformed rows and other projects' NCRs left out, D13 share columns kept);
// - progress: `select vigie.pub_signaler_avancement_nc(…)` / `…_eco(…)` with the named parameters of the requests; Vigie's request
//   number kept as vigieRef; the same entry deposited again is the same request; P0V01 / P0V02 → failed, never resent; any other
//   error → pending, resent;
// - the asynchronous outcome read in vigie.pub_demandes_recues: applied, or rejected → refused (shown, never blocking); the view
//   missing leaves the entries sent;
// - Vigie's restrictive rules reflected in Keystone: no Containment nor Closed step, the verification a proposal (the NCR stays in
//   Verification), the quality key of an ECO decided in Vigie.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { vigieEcoProgress, vigieEcos, vigieHseItems, vigieNcrProgress, vigieNcrs } from '@/server/db/schema';
import { createVigieServer, ncrRowOf, processVigieRequests, setVigieEcoRows, setVigieQualityRows, vigieRequests } from '@/test/vigie-server';
import { mockEcoConnector, redeliverEcoOutbox, resetVigieRefreshThrottle, sqlEcoConnector } from './eco-connector';
import { mockQualityConnector, redeliverNcrOutbox, resetVigieQualityRefreshThrottle, sqlQualityConnector } from './quality-connector';
import type { VigieEco, VigieEcoRecord, VigieNcr, VigieNcrRecord } from './types';

const HLT = 'HLT-026';
const QUALITY = { name: 'Gabriel Comte', role: 'quality' };
const ENGLEAD = { name: 'Antoine Girard', role: 'englead' };

const ncrRecord = (n: VigieNcr, over: Partial<VigieNcrRecord> = {}): VigieNcrRecord => ({
  projectCode: n.projectCode, number: n.number, vigieRef: n.vigieRef, title: n.title, severity: n.severity, source: n.source, status: n.status, activityCode: n.activityCode,
  partRef: n.partRef, deliverableNumber: n.deliverableNumber, supplierName: n.supplierName, inspectionNumber: null, raisedBy: n.raisedBy, raisedOn: n.raisedOn, owner: n.owner,
  rootCause: n.rootCause, action: n.action, dueOn: n.dueOn, costKeur: n.costKeur, isoClause: n.isoClause, updatedAt: null, ...over,
});
const ecoRecord = (e: VigieEco, over: Partial<VigieEcoRecord> = {}): VigieEcoRecord => ({
  number: e.number, title: e.title, type: e.type, status: e.status, interchangeability: e.interchangeability, fromRevision: e.fromRevision, toRevision: e.toRevision,
  costEur: e.costEur, scheduleDays: e.scheduleDays, stockImpact: e.stockImpact, documentRefs: e.documentRefs, requestedBy: e.requestedBy, raisedOn: e.raisedOn,
  pendingDispositions: e.pendingDispositions, locked: e.locked, parts: e.parts, projects: e.projects,
  approvals: e.approvals.map((a) => ({ key: a.key, decision: a.decision, approver: a.approver, decidedBy: a.decidedBy, decidedAt: a.decidedAt })), effectivity: e.effectivity,
  updatedAt: null, ...over,
});

let demoNcrs: VigieNcrRecord[] = [];
let demoEcos: VigieEcoRecord[] = [];

/** Publishes the demo NCRs (with `over` applied to some numbers) and the demo ECOs, then refreshes both mirrors. */
async function publish(ncrOver: Record<string, Partial<VigieNcrRecord>> = {}, ecoOver: Record<string, Partial<VigieEcoRecord>> = {}) {
  const db = await getDb();
  await setVigieQualityRows(db, { ncrs: demoNcrs.map((n) => ({ ...n, ...ncrOver[n.number] })), hse: [] });
  await setVigieEcoRows(db, demoEcos.map((e) => ({ ...e, ...ecoOver[e.number] })));
  resetVigieRefreshThrottle();
  resetVigieQualityRefreshThrottle();
  await sqlQualityConnector.sync();
  await sqlEcoConnector.sync();
}

const ncr = async (number: string, code = HLT) => (await sqlQualityConnector.getNcr(code, number))!;

beforeAll(async () => {
  setDb(await openDatabase());
  demoNcrs = (await mockQualityConnector.listNcrs()).map((n) => ncrRecord(n));
  demoEcos = (await mockEcoConnector.listEcos()).map((e) => ecoRecord(e));
}, 60_000);

beforeEach(async () => {
  await createVigieServer(await getDb());
  resetVigieRefreshThrottle();
  resetVigieQualityRefreshThrottle();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('D13 — reading Vigie’s NCR and HSE publications', () => {
  it('replaces the mirrors: EV-… numbers, share columns kept, design-office source, other projects’ NCRs and malformed rows left out', async () => {
    const db = await getDb();
    const hlt = demoNcrs.find((n) => n.projectCode === HLT && n.number === 'EV-2026-026')!;
    await setVigieQualityRows(db, {
      ncrs: [
        ...demoNcrs.filter((n) => n.number !== 'EV-2026-026'),
        { ...hlt, source: 'design', closedOn: null, ownerMatricule: 'EMP-0018', supplierId: null, updatedAt: '2026-11-06T09:00:00.000Z' },
        { ...hlt, projectCode: 'K-2025-042', number: 'EV-2026-130', vigieRef: 'EV-2026-130' }, // not a Keystone project
      ],
      rawNcrs: [{ ...ncrRowOf(hlt), number: 'NCR-099' }, { ...ncrRowOf(hlt), number: 'EV-2026-131', status: 'reopened' }], // malformed
      hse: [
        { projectCode: HLT, vigieRef: 'PP-2026-013', kind: 'prevention_plan', title: 'Plan de prévention · Quai 1', status: 'signed', statusText: null, dateOn: '2026-09-01' },
        { projectCode: HLT, vigieRef: null, kind: 'register', title: 'Registre presqu’accidents', status: 'recorded', statusText: '0 déclaré', dateOn: null },
      ],
    });
    const r = await sqlQualityConnector.sync();
    expect(r.refreshed).toBe(demoNcrs.length + 2);
    const rows = await db.select().from(vigieNcrs).where(eq(vigieNcrs.projectCode, HLT));
    expect(rows.map((x) => x.number).sort()).toEqual(['EV-2026-026', 'EV-2026-027', 'EV-2026-028', 'EV-2026-029', 'EV-2026-030']);
    const n26 = rows.find((x) => x.number === 'EV-2026-026')!;
    expect([n26.source, n26.vigieRef, n26.ownerMatricule, n26.vigieUpdatedAt?.toISOString()]).toEqual(['design', 'EV-2026-026', 'EMP-0018', '2026-11-06T09:00:00.000Z']);
    expect((await db.select().from(vigieNcrs).where(eq(vigieNcrs.number, 'EV-2026-130')))).toEqual([]);
    expect((await sqlQualityConnector.listHse(HLT)).map((h) => [h.kind, h.vigieRef, h.statusText, h.vigieUrl])).toEqual([
      ['prevention_plan', 'PP-2026-013', null, 'http://localhost:3200/prevention?plan=PP-2026-013'],
      ['register', null, '0 déclaré', 'http://localhost:3200/evenements?etat=tous&type=PA&projet=HLT-026'],
    ]);
    expect((await db.select().from(vigieHseItems)).length).toBe(2);
    // The NCR's deep link is Vigie's record (CV-07: number = vigie_ref).
    expect((await ncr('EV-2026-026')).vigieUrl).toBe('http://localhost:3200/evenements?etat=tous&sel=EV-2026-026');
  });

  it('a view that cannot be read (link or publication missing) keeps the mirrors', async () => {
    const db = await getDb();
    const before = (await db.select().from(vigieNcrs)).length;
    await db.execute(sql.raw('drop view vigie.pub_hse_projet'));
    const r = await sqlQualityConnector.sync();
    expect(r.refreshed).toBe(0);
    expect((await db.select().from(vigieNcrs)).length).toBe(before);
  });
});

describe('D12 — reading Vigie’s change-order publications', () => {
  it('replaces the mirror with the orders, their approvals and effectivity; the release date kept', async () => {
    const db = await getDb();
    const released = demoEcos.find((e) => e.status === 'released')!;
    await setVigieEcoRows(db, demoEcos.map((e) => (e.number === released.number ? { ...e, releasedAt: '2026-09-10T08:00:00.000Z' } : e)));
    const r = await sqlEcoConnector.sync();
    expect(r.refreshed).toBe(demoEcos.length);
    const after = await sqlEcoConnector.listEcos();
    expect(after.map((e) => [e.number, e.status, e.approvals.length, e.effectivity.length, e.parts.length])).toEqual(
      [...demoEcos].sort((a, b) => a.number.localeCompare(b.number)).map((e) => [e.number, e.status, e.approvals.length, e.effectivity.length, e.parts.length])
        .sort((a, b) => after.findIndex((x) => x.number === a[0]) - after.findIndex((x) => x.number === b[0])),
    );
    const [row] = await db.select().from(vigieEcos).where(eq(vigieEcos.number, released.number));
    expect(row.releasedAt?.toISOString()).toBe('2026-09-10T08:00:00.000Z');
  });
});

describe('D13 — NCR progress through vigie.pub_signaler_avancement_nc', () => {
  it('a step is deposited with the named parameters; Vigie’s request number is kept; an applied request leaves the overlay at the refresh', async () => {
    await publish();
    const db = await getDb();
    const rec = await sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-029', { step: 'corrective_action', comment: 'Shims ordered' }, QUALITY);
    expect(rec.syncStatus).toBe('sent');
    const [req] = await vigieRequests(db);
    expect([req.kind, req.external_id, req.target_ref, req.project_code, req.status]).toEqual(['nc_step', rec.id, 'EV-2026-029', HLT, 'received']);
    expect(req.payload).toMatchObject({ kind: 'step', fromStatus: 'root_cause', targetStatus: 'corrective_action', comment: 'Shims ordered', actor: { name: 'Gabriel Comte', role: 'quality' } });
    const [entry] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, rec.id));
    expect([entry.vigieRef, entry.vigieOutcome]).toEqual([String(req.id), null]);
    // The outcome is read: received (Vigie processes within minutes) — still waiting, a second request is refused.
    await sqlQualityConnector.sync();
    expect((await ncr('EV-2026-029')).requestedStatus).toBe('corrective_action');
    await expect(sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-029', { step: 'corrective_action' }, QUALITY)).rejects.toThrow(/already waiting/);
    // Vigie applies it and publishes the new step: the mirror shows it, nothing waits.
    await processVigieRequests(db, () => ({ status: 'applied' }));
    await publish({ 'EV-2026-029': { status: 'corrective_action' } });
    const n = await ncr('EV-2026-029');
    expect([n.status, n.requestedStatus, n.pendingProgress]).toEqual(['corrective_action', null, []]);
    const [done] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, rec.id));
    expect([done.syncStatus, done.vigieOutcome, done.vigieResult]).toEqual(['sent', 'applied', 'Appliquée']);
  });

  it('deposited again (a lost answer), the same entry is the same request in Vigie', async () => {
    await publish();
    const db = await getDb();
    const rec = await sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-028', { step: 'root_cause' }, QUALITY);
    await db.update(vigieNcrProgress).set({ syncStatus: 'pending', vigieRef: null }).where(eq(vigieNcrProgress.id, rec.id));
    expect(await redeliverNcrOutbox('sql')).toMatchObject({ mode: 'sql', delivered: 1, pending: 0 });
    const reqs = await vigieRequests(db);
    expect(reqs).toHaveLength(1);
    const [entry] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, rec.id));
    expect([entry.vigieRef, entry.vigieOutcome]).toEqual([String(reqs[0].id), 'received']);
    await processVigieRequests(db, () => ({ status: 'applied' }));
    await sqlQualityConnector.sync();
  });

  it('Vigie refuses the request (stale): the entry is refused, shown with Vigie’s reason, and never blocks a new request', async () => {
    await publish();
    const db = await getDb();
    const rec = await sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-028', { step: 'root_cause' }, QUALITY);
    await processVigieRequests(db, () => ({ status: 'rejected', code: 'stale', result: 'État changé dans Vigie' }));
    expect(await redeliverNcrOutbox('sql')).toMatchObject({ delivered: 0, pending: 0 });
    const [entry] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, rec.id));
    expect([entry.syncStatus, entry.vigieOutcome, entry.vigieResultCode, entry.vigieResult]).toEqual(['refused', 'rejected', 'stale', 'État changé dans Vigie']);
    resetVigieQualityRefreshThrottle();
    const n = await ncr('EV-2026-028');
    expect([n.status, n.requestedStatus, n.pendingProgress.map((p) => [p.syncStatus, p.resultCode, p.result])]).toEqual(['containment', null, [['refused', 'stale', 'État changé dans Vigie']]]);
    // Not resent; a new request can be recorded (and the refused one is no longer shown).
    const again = await sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-028', { step: 'root_cause' }, QUALITY);
    expect(again.syncStatus).toBe('sent');
    expect((await vigieRequests(db)).map((r) => r.external_id)).toEqual([rec.id, again.id]);
    expect((await ncr('EV-2026-028')).pendingProgress.map((p) => p.id)).toEqual([again.id]);
  });

  it('the verification is a proposal: accepted by Vigie, the NCR stays in Verification and the proposal stays shown until Vigie’s QHSE acts', async () => {
    await publish({ 'EV-2026-026': { status: 'verification' } });
    const db = await getDb();
    const rec = await sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-026', { verification: 'approved' }, QUALITY);
    const [req] = await vigieRequests(db);
    expect([req.kind, req.payload.decision, req.payload.fromStatus, req.payload.targetStatus]).toEqual(['nc_verification', 'approved', 'verification', undefined]);
    await processVigieRequests(db, () => ({ status: 'applied' }));
    await publish({ 'EV-2026-026': { status: 'verification' } });
    const n = await ncr('EV-2026-026');
    expect([n.status, n.requestedStatus, n.pendingProgress.map((p) => p.id)]).toEqual(['verification', 'closed', [rec.id]]);
    await expect(sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-026', { verification: 'approved' }, QUALITY)).rejects.toThrow(/already waiting/);
    // Vigie's QHSE closes the NCR: the proposal is reflected.
    await publish({ 'EV-2026-026': { status: 'closed', closedOn: '2026-11-06' } });
    const closed = await ncr('EV-2026-026');
    expect([closed.status, closed.requestedStatus, closed.pendingProgress]).toEqual(['closed', null, []]);
    expect((await db.select().from(vigieNcrs).where(eq(vigieNcrs.number, 'EV-2026-026')))[0].closedOn).toBe('2026-11-06');
  });

  it('Keystone never asks for Containment (Vigie’s qualification) nor Closed', async () => {
    await publish();
    await expect(sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-030', { step: 'containment' }, QUALITY)).rejects.toThrow(/containment step is decided in Vigie/);
    await expect(sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-026', { step: 'verification' }, QUALITY)).resolves.toMatchObject({ syncStatus: 'sent' });
    expect((await vigieRequests(await getDb())).map((r) => r.payload.targetStatus)).toEqual(['verification']);
  });

  it('P0V01 (Keystone not admitted by Vigie): the entry fails and is never resent; it does not block a new request', async () => {
    await publish();
    const db = await getDb();
    await createVigieServer(db, { admitted: false });
    const rec = await sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-029', { step: 'corrective_action' }, QUALITY);
    expect(rec.syncStatus).toBe('failed');
    const [entry] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, rec.id));
    expect(entry.lastError).toMatch(/appelant non admis/);
    expect(await redeliverNcrOutbox('sql')).toMatchObject({ delivered: 0, failed: 0, pending: 0 });
    expect((await ncr('EV-2026-029')).requestedStatus).toBeNull();
  });

  it('P0V02 (an argument Vigie refuses: a number that is not an EV-… reference) → failed, never resent', async () => {
    const db = await getDb();
    await setVigieQualityRows(db, { ncrs: demoNcrs, hse: [] });
    // A mirror row under a former number (before CV-07): Vigie's function refuses it.
    await db.update(vigieNcrs).set({ number: 'NCR-029' }).where(eq(vigieNcrs.number, 'EV-2026-029'));
    const rec = await mockQualityConnector.recordNcrProgress(HLT, 'NCR-029', { step: 'corrective_action' }, QUALITY);
    expect(await redeliverNcrOutbox('sql')).toMatchObject({ delivered: 0, failed: 1, pending: 0 });
    const [entry] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, rec.id));
    expect([entry.syncStatus, entry.lastError]).toEqual(['failed', expect.stringMatching(/numéro de NC invalide/)]);
    expect(await vigieRequests(db)).toEqual([]);
    await db.update(vigieNcrs).set({ number: 'EV-2026-029' }).where(eq(vigieNcrs.number, 'NCR-029'));
  });

  it('the request-state publication missing (Matrix has not applied it): the entries stay sent, their outcome unknown', async () => {
    await publish();
    const db = await getDb();
    await createVigieServer(db, { requestsView: false });
    const rec = await sqlQualityConnector.recordNcrProgress(HLT, 'EV-2026-029', { step: 'corrective_action' }, QUALITY);
    await expect(sqlQualityConnector.sync()).resolves.toMatchObject({ delivered: 0 });
    const [entry] = await db.select().from(vigieNcrProgress).where(eq(vigieNcrProgress.id, rec.id));
    expect([entry.syncStatus, entry.vigieOutcome]).toEqual(['sent', null]);
  });
});

describe('D12 — ECO progress through vigie.pub_signaler_avancement_eco', () => {
  it('the engineering lead’s decision is deposited (key, decision ok); the quality key is decided in Vigie', async () => {
    const inApproval = demoEcos.find((e) => e.status === 'in_approval' && e.approvals.some((a) => a.key === 'englead' && a.decision === 'pending'))
      ?? { ...demoEcos[0], status: 'in_approval' as const };
    const over = { [inApproval.number]: { status: 'in_approval' as const, approvals: inApproval.approvals.map((a) => ({ ...a, decision: 'pending' as const, decidedBy: null })) } };
    await publish({}, over);
    const db = await getDb();
    const rec = await sqlEcoConnector.recordProgress(inApproval.number, { key: 'englead', decision: 'ok', comment: 'Fine' }, ENGLEAD);
    expect(rec.syncStatus).toBe('sent');
    const [req] = await vigieRequests(db);
    expect([req.kind, req.target_ref, req.project_code]).toEqual(['eco_approval', inApproval.number, null]);
    expect(req.payload).toMatchObject({ kind: 'approval', approvalKey: 'englead', decision: 'ok', fromStatus: 'in_approval', comment: 'Fine' });
    const [entry] = await db.select().from(vigieEcoProgress).where(eq(vigieEcoProgress.id, rec.id));
    expect(entry.vigieRef).toBe(String(req.id));
    await expect(sqlEcoConnector.recordProgress(inApproval.number, { key: 'quality', decision: 'ok' }, QUALITY)).rejects.toThrow(/decided in Vigie/);
    // Vigie rejects it (the key was decided meanwhile): refused, the decision no longer pending in Keystone.
    await processVigieRequests(db, () => ({ status: 'rejected', code: 'refused', result: 'Clé déjà décidée dans Vigie' }));
    expect(await redeliverEcoOutbox('sql')).toMatchObject({ mode: 'sql', delivered: 0 });
    resetVigieRefreshThrottle();
    const eco = (await sqlEcoConnector.getEco(inApproval.number))!;
    expect(eco.approvals.find((a) => a.key === 'englead')!.pending).toBeNull();
    expect(eco.pendingProgress.map((p) => [p.syncStatus, p.result])).toEqual([['refused', 'Clé déjà décidée dans Vigie']]);
  });

  it('a step is deposited with p_etape_depuis / p_etape_cible', async () => {
    const draft = demoEcos.find((e) => e.status === 'draft') ?? { ...demoEcos[0], status: 'draft' as const };
    await publish({}, { [draft.number]: { status: 'draft' } });
    const db = await getDb();
    await sqlEcoConnector.recordProgress(draft.number, { step: 'impact_analysis' }, { name: 'Fabien Bertrand', role: 'procurement' });
    const [req] = await vigieRequests(db);
    expect([req.kind, req.payload.fromStatus, req.payload.targetStatus, req.payload.approvalKey]).toEqual(['eco_step', 'draft', 'impact_analysis', undefined]);
  });
});
