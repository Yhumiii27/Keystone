// R-159 (P1, D9-31) and R-162 (P4, D9-34) — on the demo database (HLT-026): the expediting of a purchase order (rights for every
// persona, the inspections and their FAT tied to an ITP FAT point, the failed inspection and its NCR number, the release note
// refused while a blocker remains and issued by quality only, the deliveries flagged without it, the audit before / after and the
// withdrawal's reason), the late inspection alert of a long-lead order, and the FX side (reference rates and thresholds edited by
// Finance and the director, the project's exposure, the hedging alert told once to Finance and the directors, then cleared).
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { and, desc, eq } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { EXPEDITING_ROLES, FX_ROLES } from '@/domain/rights';
import { issueReleaseNoteAction, saveInspectionAction } from '@/features/expediting/actions';
import { addReferenceRateAction } from '@/features/fx/actions';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, contracts, itpInspections, itpPlans, projects, reminderSends } from '@/server/db/schema';
import { COOKIE } from '@/server/session';
import {
  ExpeditingWriteError, deliveriesWithoutRelease, getOrderExpediting, issueReleaseNote, recordInspectionResult, removeInspection, saveInspection, setFabricationProgress,
  withdrawReleaseNote,
} from './expediting';
import { runExpeditingAlerts } from './expediting-notices';
import { FxWriteError, addReferenceRate, getPortfolioFxExposure, getProjectFxExposure, listReferenceRates, removeReferenceRate, setFxThreshold } from './fx';
import { getItpPlan } from './itp';
import { listNotifications } from './notifications';

const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };
const BUYER = { name: 'Fabien Bertrand', role: 'procurement' };
const QUALITY = { name: 'Gabriel Comte', role: 'quality' };
const FINANCE = { name: 'Léa Marchand', role: 'finance' };
const PM = { name: 'Romain Aubert', role: 'pm' };
const today = DEMO_TODAY_ISO; // Fri 25 Sep 2026
// PO-1071 (HLT-026): ordered 10 Jul, expected 19 Oct 2026 (101 days: long lead), partially received.
const PO = 'PO-1071';
const as = (role: string) => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, 'en');
};
const code = (e: unknown) => (e instanceof ExpeditingWriteError || e instanceof FxWriteError ? e.code : String(e));
let fatPoint = '';

beforeAll(async () => {
  setDb(await openDatabase());
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
  const [i10] = await db.select({ id: itpInspections.id }).from(itpInspections).innerJoin(itpPlans, eq(itpPlans.id, itpInspections.planId))
    .where(and(eq(itpPlans.projectId, p.id), eq(itpInspections.number, 'I-10')));
  fatPoint = i10.id;
}, 120_000);

describe('R-159 · expediting rights', () => {
  it('procurement, quality and the director plan inspections; every other persona is refused (DAL)', async () => {
    for (const p of PERSONAS) {
      const actor = { name: p.name, role: p.role };
      const r = await saveInspection('HLT-026', 'PO-1078', null, { kind: 'other', name: `Check by ${p.role}` }, actor).then(() => 'ok', code);
      expect([p.role, r]).toEqual([p.role, (EXPEDITING_ROLES as readonly string[]).includes(p.role) ? 'ok' : 'rights']);
    }
    // Clean up (planned inspections may be removed).
    for (const n of ['I-1', 'I-2', 'I-3']) await removeInspection('HLT-026', 'PO-1078', n, DIRECTOR);
    expect((await getOrderExpediting('HLT-026', 'PO-1078', today))!.inspections).toEqual([]);
  });

  it('Server Functions: the PM reads only; quality plans; procurement may not issue a release note', async () => {
    as('pm');
    expect(await saveInspectionAction('HLT-026', 'PO-1078', '', { kind: 'fat' })).toEqual({ error: 'Only procurement, quality or the director can follow the order’s fabrication and inspections' });
    as('quality');
    expect(await saveInspectionAction('HLT-026', 'PO-1078', '', { kind: 'fat', plannedOn: '2026-10-20' })).toEqual({ ok: true });
    as('procurement');
    expect(await issueReleaseNoteAction('HLT-026', 'PO-1078', {})).toEqual({ error: 'Only quality or the director can issue or withdraw a release note' });
    await removeInspection('HLT-026', 'PO-1078', 'I-1', DIRECTOR);
  });
});

describe('R-159 · inspections, FAT and release note', () => {
  it('plans a late material inspection and a FAT tied to the ITP FAT point I-10; deliveries flagged', async () => {
    expect(await saveInspection('HLT-026', PO, null, { kind: 'material', plannedOn: '2026-09-20', inspector: 'Bureau Veritas' }, BUYER)).toBe('I-1');
    expect(await saveInspection('HLT-026', PO, null, { kind: 'fat', plannedOn: '2026-10-05', itp: fatPoint }, QUALITY)).toBe('I-2');
    await expect(saveInspection('HLT-026', PO, null, { kind: 'fat', itp: '00000000-0000-0000-0000-000000000000' }, QUALITY)).rejects.toMatchObject({ code: 'itp' });
    await setFabricationProgress('HLT-026', PO, { pct: '60', note: 'Girders welded' }, today, BUYER);
    const x = (await getOrderExpediting('HLT-026', PO, today))!;
    expect(x.longLead).toBe(true);
    expect(x.state).toBe('late');
    expect(x.required).toBe(true);
    expect(x.progress).toMatchObject({ pct: 60, reportedOn: today, note: 'Girders welded' });
    expect(x.inspections.map((i) => [i.number, i.kind, i.late, i.itp?.number ?? null, i.ref])).toEqual([
      ['I-1', 'material', true, null, 'PO-1071/I-1'],
      ['I-2', 'fat', false, 'I-10', 'PO-1071/I-2'],
    ]);
    expect(x.blockers).toEqual([{ kind: 'fat' }]);
    // The order's deliveries came before any release note: flagged (never blocked).
    expect(x.flaggedDeliveries.length).toBeGreaterThan(0);
    const flagged = await deliveriesWithoutRelease('HLT-026', today);
    expect(x.flaggedDeliveries.every((d) => flagged.has(d.number))).toBe(true);
    // The ITP FAT point shows the supplier FAT.
    const plan = (await getItpPlan('HLT-026'))!;
    expect(plan.inspections.find((i) => i.number === 'I-10')!.supplierFats).toEqual([{ ref: 'PO-1071/I-2', result: 'planned', resultOn: null }]);
  });

  it('a failed inspection blocks the release note until a passing re-inspection; audit with before / after', async () => {
    await recordInspectionResult('HLT-026', PO, 'I-1', { result: 'failed', resultOn: '2026-09-22', inspector: 'Bureau Veritas', ncr: 'EV-2026-150', comment: 'Certificates missing' }, today, QUALITY);
    await expect(recordInspectionResult('HLT-026', PO, 'I-2', { result: 'passed', resultOn: '2026-09-30', inspector: 'x' }, today, QUALITY)).rejects.toMatchObject({ code: 'resultFuture' });
    await expect(removeInspection('HLT-026', PO, 'I-1', BUYER)).rejects.toMatchObject({ code: 'recorded' });
    await expect(issueReleaseNote('HLT-026', PO, {}, today, QUALITY)).rejects.toMatchObject({ code: 'blocked', detail: [{ kind: 'failed', numbers: ['I-1'] }, { kind: 'fat' }] });
    expect((await getOrderExpediting('HLT-026', PO, today))!.state).toBe('blocked');

    const db = await getDb();
    const [a] = await db.select().from(auditEntries).where(eq(auditEntries.entityType, 'po_inspection')).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(a).toMatchObject({ area: 'Purchase orders', objectRef: 'HLT-026 · PO-1071', change: 'inspection I-1 result: planned → failed', actorName: 'Gabriel Comte' });
    expect(a.before).toMatchObject({ result: 'planned', ncrRef: null });
    expect(a.after).toMatchObject({ result: 'failed', ncrRef: 'EV-2026-150', resultOn: '2026-09-22' });

    // Re-inspection of the material passed, the FAT passed: quality issues the release note.
    expect(await saveInspection('HLT-026', PO, null, { kind: 'material', plannedOn: '2026-09-24' }, BUYER)).toBe('I-3');
    await recordInspectionResult('HLT-026', PO, 'I-3', { result: 'passed', resultOn: '2026-09-24', inspector: 'Bureau Veritas' }, today, BUYER);
    await recordInspectionResult('HLT-026', PO, 'I-2', { result: 'passed_reserve', resultOn: '2026-09-25', inspector: 'Gabriel Comte', comment: 'Touch-up paint' }, today, QUALITY);
    await expect(issueReleaseNote('HLT-026', PO, {}, today, BUYER)).rejects.toMatchObject({ code: 'releaseRights' });
    expect(await issueReleaseNote('HLT-026', PO, { reserves: 'Touch-up paint on site' }, today, QUALITY)).toBe('PO-1071-RN1');
    await expect(issueReleaseNote('HLT-026', PO, {}, today, QUALITY)).rejects.toMatchObject({ code: 'released' });
    const x = (await getOrderExpediting('HLT-026', PO, today))!;
    expect(x.state).toBe('released');
    expect(x.release).toMatchObject({ number: 'PO-1071-RN1', issuedOn: today, issuedBy: 'Gabriel Comte', scope: 'Whole order', reserves: 'Touch-up paint on site' });
  });

  it('withdrawing the release note needs a reason, kept in the audit', async () => {
    await expect(withdrawReleaseNote('HLT-026', PO, 'PO-1071-RN1', ' ', QUALITY)).rejects.toMatchObject({ code: 'reason' });
    await withdrawReleaseNote('HLT-026', PO, 'PO-1071-RN1', 'Issued on the wrong order', QUALITY);
    const db = await getDb();
    const [a] = await db.select().from(auditEntries).where(eq(auditEntries.entityType, 'po_release_note')).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(a).toMatchObject({ change: 'release note PO-1071-RN1 withdrawn', reason: 'Issued on the wrong order', before: { withdrawn: false }, after: { withdrawn: true } });
    const x = (await getOrderExpediting('HLT-026', PO, today))!;
    expect(x.release).toBeNull();
    expect(x.releases[0]).toMatchObject({ withdrawn: true, withdrawReason: 'Issued on the wrong order' });
  });
});

describe('R-159 · late inspection alert', () => {
  it('a long-lead order’s inspection past its date is told once to the buyer (else procurement) and quality', async () => {
    expect(await saveInspection('HLT-026', PO, null, { kind: 'pre_shipment', plannedOn: '2026-09-23' }, BUYER)).toBe('I-4');
    const run = await runExpeditingAlerts(today);
    expect(run.late).toBe(1);
    const title = 'Supplier inspection late · PO-1071/I-4 · +2 d';
    for (const role of ['procurement', 'quality'] as const) expect((await listNotifications(role)).filter((n) => n.title === title)).toHaveLength(1);
    expect((await listNotifications('pm')).some((n) => n.title === title)).toBe(false);
    // Once only.
    expect((await runExpeditingAlerts(today)).notified).toBe(0);
  });
});

describe('R-162 · reference rates, thresholds and FX exposure', () => {
  it('Finance and the director edit the reference rates; the other personas are refused', async () => {
    for (const p of PERSONAS) {
      const r = await addReferenceRate({ currency: 'GBP', rate: '1.1', validFrom: `2026-0${(PERSONAS.indexOf(p) % 9) + 1}-01` }, today, { name: p.name, role: p.role }).then(() => 'ok', code);
      expect([p.role, r]).toEqual([p.role, (FX_ROLES as readonly string[]).includes(p.role) ? 'ok' : 'rights']);
    }
    as('pm');
    expect(await addReferenceRateAction({ currency: 'USD', rate: '0.9' })).toEqual({ error: 'Only Finance or the portfolio director can edit the reference exchange rates' });
    for (const r of (await listReferenceRates()).filter((x) => x.currency === 'GBP')) await removeReferenceRate(r.id, FINANCE);
    expect(await listReferenceRates()).toEqual([]);
  });

  it('a USD project: exposure at the budget and reference rates, hedging alerts told once, cleared under the thresholds', async () => {
    const db = await getDb();
    await db.update(projects).set({ currency: 'USD', budgetRate: 0.92 }).where(eq(projects.code, 'HLT-026'));
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    await db.update(contracts).set({ currency: 'USD' }).where(eq(contracts.projectId, p.id));
    await addReferenceRate({ currency: 'USD', rate: '0,85', validFrom: '2026-09-01' }, today, FINANCE);
    await expect(addReferenceRate({ currency: 'USD', rate: '0.86', validFrom: '2026-09-01' }, today, DIRECTOR)).rejects.toMatchObject({ code: 'duplicate' });

    const x = await getProjectFxExposure('HLT-026', today);
    expect(x.currencies).toHaveLength(1);
    const usd = x.currencies[0];
    expect(usd).toMatchObject({ currency: 'USD', budgetRate: 0.92, referenceRate: 0.85, referenceFrom: '2026-09-01', driftPct: -7.6, payableKeur: 0 });
    expect(usd.receivableKeur).toBeGreaterThan(0);
    expect(usd.gainLossKeur).toBeCloseTo(usd.netKeur * (0.85 - 0.92), 1);
    expect(x.alerts.map((a) => a.kind)).toEqual(['exposure', 'drift']);
    expect((await getPortfolioFxExposure(today)).lines.map((l) => l.code)).toEqual(['HLT-026']);

    const run = await runExpeditingAlerts(today);
    expect(run).toMatchObject({ fxAlerts: 2, fxRaised: 2 });
    for (const role of ['finance', 'director'] as const) expect((await listNotifications(role)).filter((n) => n.title.startsWith('FX exposure above threshold · HLT-026 · USD'))).toHaveLength(1);
    expect((await listNotifications('pm')).some((n) => n.title.startsWith('FX exposure'))).toBe(false);
    expect((await runExpeditingAlerts(today)).fxRaised).toBe(0);

    // Thresholds above the position: the alerts are cleared (a later passage is told again).
    await expect(setFxThreshold('driftPct', '0', FINANCE)).rejects.toMatchObject({ code: 'threshold' });
    await expect(setFxThreshold('driftPct', '20', PM)).rejects.toMatchObject({ code: 'rights' });
    await setFxThreshold('exposureKeur', '1000000', FINANCE);
    await setFxThreshold('driftPct', '50', DIRECTOR);
    const [a] = await db.select().from(auditEntries).where(eq(auditEntries.objectRef, 'FX hedging alert thresholds')).orderBy(desc(auditEntries.occurredAt)).limit(1);
    expect(a).toMatchObject({ before: { driftPct: 5 }, after: { driftPct: 50 } });
    expect(await runExpeditingAlerts(today)).toMatchObject({ fxAlerts: 0, fxCleared: 2 });
    const open = await db.select().from(reminderSends).where(and(eq(reminderSends.itemKey, 'fx:HLT-026:USD:exposure'), eq(reminderSends.occurrence, 'open')));
    expect(open).toEqual([]);
  });
});
