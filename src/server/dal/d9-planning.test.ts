// Delivery 9, lot planning — owner's answers of 10 Nov 2026 on an in-memory PGlite database seeded from the prototype:
//  D9-11 (R-063) a proposed baseline whose change request is rejected is kept, marked « rejetée », listed, never current;
//  D9-12 (R-063) an older request approved after a newer one leaves the highest baseline current;
//  D9-09 (R-060) the data date advanced by the PM (audited), proposed every Friday to the PM of record, never advanced by Keystone;
//  D9-10 (R-060) the Friday freeze: CPI, SPI, EAC, margin, open risks and progress per project, once per Friday.
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { DATA_DATE_ERRORS } from '@/domain/data-date';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activityEvents, auditEntries, notifications, projects, statusSnapshots } from '@/server/db/schema';
import { listProjectBaselines } from './baselines';
import { createChangeRequest, decideChangeStep, getChangeControl, submitChangeRequest } from './changes';
import { getTrends } from './trends';
import { DATA_DATE_PROPOSAL_TITLE, runFridayFreeze, setProjectDataDate } from './weekly-freeze';

const PM = 'Romain Aubert';
const DIRECTOR = 'Marie Lefebvre';
const CLIENT = 'Nadia Bensaïd';

const states = async (code: string) => Object.fromEntries((await listProjectBaselines(code)).map((b) => [b.code, b.state]));
const caught = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** Approves every pending step of a request in order. */
async function approveAll(code: string, number: string) {
  for (let i = 0; i < 6; i++) {
    const cr = (await getChangeControl(code))!.changeRequests.find((c) => c.id === number)!;
    if (cr.status === 'approved') return;
    const step = cr.chain.find((s) => s.decision === 'pending');
    if (!step) return;
    await decideChangeStep(code, number, step.step, 'ok', step.step === 'client' ? CLIENT : DIRECTOR);
  }
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('D9-11 / D9-12 — baselines proposed by change requests', () => {
  it('D9-11: the baseline of a rejected request is kept, marked rejected, never current', async () => {
    const number = await createChangeRequest('NDC-031', { title: 'Re-plan to reject', types: ['schedule'], amountKeur: 0, scheduleDays: 5, contractImpact: 'none', proposeBaseline: true }, PM);
    const before = await states('NDC-031');
    const proposed = Object.entries(before).find(([, s]) => s === 'proposed')![0];
    const cr = (await getChangeControl('NDC-031'))!.changeRequests.find((c) => c.id === number)!;
    expect(await decideChangeStep('NDC-031', number, cr.chain.find((s) => s.decision === 'pending')!.step, 'rejected', DIRECTOR)).toBe('rejected');
    const after = await states('NDC-031');
    expect(after[proposed]).toBe('rejected');
    expect(Object.values(after).filter((s) => s === 'current')).toHaveLength(Object.values(before).filter((s) => s === 'current').length);
    const db = await getDb();
    const audit = await db.select({ change: auditEntries.change }).from(auditEntries).where(and(eq(auditEntries.objectRef, number), eq(auditEntries.area, 'Change control')));
    expect(audit.some((a) => a.change.includes(`${proposed} rejected`))).toBe(true);
  });

  it('D9-12: CR-009 (BL2) approved after a newer request (BL3) — BL3 stays current, BL2 approved and superseded', async () => {
    expect(await states('HLT-026')).toMatchObject({ BL1: 'current', BL2: 'proposed' });
    const newer = await createChangeRequest('HLT-026', { title: 'Newer re-plan', types: ['schedule'], amountKeur: 0, scheduleDays: 3, contractImpact: 'none', proposeBaseline: true }, PM);
    expect((await states('HLT-026')).BL3).toBe('proposed');
    await approveAll('HLT-026', newer);
    expect(await states('HLT-026')).toMatchObject({ BL1: 'superseded', BL2: 'proposed', BL3: 'current' });
    await submitChangeRequest('HLT-026', 'CR-009', PM);
    await approveAll('HLT-026', 'CR-009');
    expect((await getChangeControl('HLT-026'))!.changeRequests.find((c) => c.id === 'CR-009')!.status).toBe('approved');
    expect(await states('HLT-026')).toMatchObject({ BL1: 'superseded', BL2: 'superseded', BL3: 'current' });
    const bl2 = (await listProjectBaselines('HLT-026')).find((b) => b.code === 'BL2')!;
    expect(bl2.setOn).not.toBeNull();
    expect(bl2.activityCount).toBeGreaterThan(0);
  });
});

describe('D9-09 — the data date', () => {
  it('the PM advances it (audited with before / after, in the activity feed); never after today, never backwards', async () => {
    expect(await setProjectDataDate('MSR-012', '2026-09-18', PM)).toEqual({ from: null, to: '2026-09-18' });
    for (const [next, msg] of [['2026-09-26', DATA_DATE_ERRORS.future], ['2026-09-11', DATA_DATE_ERRORS.backwards], ['2026-09-18', DATA_DATE_ERRORS.unchanged]] as const)
      expect(((await caught(setProjectDataDate('MSR-012', next, PM))) as Error).message).toBe(msg);
    const db = await getDb();
    const [p] = await db.select({ id: projects.id, dataDate: projects.dataDate }).from(projects).where(eq(projects.code, 'MSR-012'));
    expect(p.dataDate).toBe('2026-09-18');
    const [a] = await db.select().from(auditEntries).where(and(eq(auditEntries.projectId, p.id), eq(auditEntries.messageKey, 'plan.dataDateSet')));
    expect(a).toMatchObject({ change: 'Data date · Business date → 2026-09-18', before: { dataDate: null }, after: { dataDate: '2026-09-18' }, area: 'Planning' });
    expect((await db.select().from(activityEvents).where(and(eq(activityEvents.projectId, p.id), eq(activityEvents.messageKey, 'plan.dataDateSet')))).length).toBe(1);
  });
});

describe('D9-10 — the Friday freeze', () => {
  it('freezes each active project once per Friday (CPI, SPI, EAC, margin, risks, progress) and proposes the data date to the PM', async () => {
    const db = await getDb();
    // Fri 2 Oct 2026: no snapshot yet for that week.
    const run = await runFridayFreeze('2026-10-02');
    expect(run).toMatchObject({ today: '2026-10-02', friday: '2026-10-02' });
    expect(run.projects).toBeGreaterThan(0);
    expect(run.frozen).toBe(run.projects);
    const [hlt] = await db.select({ id: projects.id, dataDate: projects.dataDate }).from(projects).where(eq(projects.code, 'HLT-026'));
    const [snap] = await db.select().from(statusSnapshots).where(and(eq(statusSnapshots.projectId, hlt.id), eq(statusSnapshots.statusDate, '2026-10-02')));
    expect(snap).toMatchObject({ weekCode: 'W40' });
    expect(snap.riskCount).toBeGreaterThan(0);
    expect(snap.riskEmvKeur).toBeGreaterThan(0);
    expect(snap.progressPct).toBeGreaterThan(0);
    expect(snap.cpi).toBeGreaterThan(0);
    expect(snap.marginPct).not.toBeNull();
    // Never advanced by Keystone; proposed once to the PM of record.
    expect(hlt.dataDate).toBeNull();
    const proposals = await db.select().from(notifications).where(and(eq(notifications.title, DATA_DATE_PROPOSAL_TITLE), eq(notifications.projectId, hlt.id)));
    expect(proposals.map((n) => n.targetParams)).toEqual([{ dataDate: '2026-10-02' }]);
    expect(run.proposed).toBeGreaterThan(0);

    // Idempotent: a later run of the same week keeps the frozen week and proposes nothing new.
    const again = await runFridayFreeze('2026-10-03');
    expect(again).toMatchObject({ friday: '2026-10-02', frozen: 0, kept: run.projects, proposed: 0, alreadyProposed: run.proposed });

    // The history shows the new columns; the rows frozen before show none.
    const trends = (await getTrends('HLT-026'))!;
    expect(trends.snapshots.at(-1)).toMatchObject({ week: 'W40', riskCount: snap.riskCount, progress: snap.progressPct, margin: snap.marginPct });
    expect(trends.snapshots[0]).toMatchObject({ riskCount: null, progress: null, margin: null });
  });

  it('a project whose data date is already that Friday gets no proposal', async () => {
    const db = await getDb();
    await setProjectDataDate('MSR-012', '2026-09-25', PM);
    await runFridayFreeze('2026-09-25');
    const [odc] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'MSR-012'));
    const sent = await db.select().from(notifications).where(and(eq(notifications.title, DATA_DATE_PROPOSAL_TITLE), eq(notifications.projectId, odc.id)));
    expect(sent.filter((n) => (n.targetParams as Record<string, string>).dataDate === '2026-09-25')).toEqual([]);
  });
});
