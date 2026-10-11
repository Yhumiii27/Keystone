// R-010 / S-3: "Set baseline" (Plan) and "Re-baseline" (Schedule) re-check the baseline policy inside the snapshot
// transaction. Two requests sent at the same time both pass the Server Function's own check (made before either writes);
// the DAL then creates BL1 once and refuses the second, instead of creating BL2 without a change request (DELIVERY-6 §6).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', async () => {
  const { getProject } = await import('@/server/dal/projects');
  return {
    getProjectContext: async (code: string) => ({
      project: await getProject(code), viewer: { role: 'director', name: 'Marie Lefebvre' }, canEdit: () => true, isMine: true,
      // R-041 (rights): the director has the project manager's rights on every project.
      isLead: true, access: { member: true, lead: true, pm: false, client: false, readOnly: false, refused: false },
    }),
  };
});

import { and, eq } from 'drizzle-orm';
import { BaselinePolicyError, createBaselineSnapshot, createProposedBaseline, listProjectBaselines } from '@/server/dal/baselines';
import { createChangeRequest } from '@/server/dal/changes';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { baselines, changeRequests, projects } from '@/server/db/schema';
import { rebaselineSchedule } from '@/features/schedule/actions';
import { setBaselineAction } from './scheduling-actions';

type Outcome = { toast?: string; error?: string };
/** The dialog results as objects (FormDialogResult also allows a bare string). */
const outcomes = (rs: unknown[]): Outcome[] => rs.map((r) => (r && typeof r === 'object' ? (r as Outcome) : {}));

async function clearBaselines(code: string) {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
  await db.delete(baselines).where(eq(baselines.projectId, p.id));
  return p.id;
}

describe('baseline policy under concurrent requests', () => {
  let cr = '';
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('Plan: two "Set baseline" at BL0 → BL1 once, the second refused (no BL2 without change request)', async () => {
    await clearBaselines('NDC-031');
    await createBaselineSnapshot('NDC-031', { actorName: 'Marie Lefebvre', name: 'Initial plan', makeCurrent: true });
    const results = await Promise.all([setBaselineAction('NDC-031', { name: 'APD A' }), setBaselineAction('NDC-031', { name: 'APD B' })]);
    expect(results.filter((r) => r.toast?.startsWith('BL1 · Baseline set'))).toHaveLength(1);
    expect(results.filter((r) => r.error)).toEqual([{ error: 'After BL1, a new baseline goes through a change request' }]);
    expect((await listProjectBaselines('NDC-031')).map((b) => [b.code, b.state])).toEqual([['BL0', 'superseded'], ['BL1', 'current']]);
  });

  it('Schedule: two re-baselines at BL0 without change request → BL1 once', async () => {
    await clearBaselines('RCF-019');
    await createBaselineSnapshot('RCF-019', { actorName: 'Marie Lefebvre', name: 'Initial plan', makeCurrent: true });
    const results = outcomes(await Promise.all([
      rebaselineSchedule('RCF-019', { name: 'APD A', reason: 'End of APD' }), rebaselineSchedule('RCF-019', { name: 'APD B', reason: 'End of APD' }),
    ]));
    expect(results.filter((r) => r.toast?.endsWith('Baseline frozen · BL1'))).toHaveLength(1);
    expect(results.filter((r) => r.error)).toEqual([{ error: 'After BL1, a new baseline goes through a change request — name an open change request (CR-…)' }]);
    expect((await listProjectBaselines('RCF-019')).map((b) => b.code)).toEqual(['BL0', 'BL1']);
  });

  it('Schedule: two re-baselines naming the same open change request → one proposed baseline', async () => {
    cr = await createChangeRequest('RCF-019', { title: 'Second crew', types: ['schedule'], amountKeur: 0, scheduleDays: 5 }, 'Marie Lefebvre');
    const results = outcomes(await Promise.all([
      rebaselineSchedule('RCF-019', { name: `Recovery (${cr})`, reason: 'Crew' }), rebaselineSchedule('RCF-019', { name: `Recovery bis (${cr})`, reason: 'Crew' }),
    ]));
    expect(results.filter((r) => r.toast?.endsWith('Baseline frozen · BL2'))).toHaveLength(1);
    expect(results.filter((r) => r.error)).toEqual([{ error: `${cr} · already proposes baseline BL2` }]);
    const proposed = (await listProjectBaselines('RCF-019')).filter((b) => b.changeRequest === cr);
    expect(proposed.map((b) => [b.code, b.state])).toEqual([['BL2', 'proposed']]);
  });

  it('the DAL refuses directly (enforcePolicy): a current snapshot after BL1, or a second proposal of one request', async () => {
    const snap = (input: Partial<Parameters<typeof createBaselineSnapshot>[1]>) =>
      createBaselineSnapshot('RCF-019', { actorName: 'Marie Lefebvre', enforcePolicy: true, ...input });
    await expect(snap({ makeCurrent: true })).rejects.toBeInstanceOf(BaselinePolicyError);
    await expect(snap({})).rejects.toMatchObject({ reason: 'change_request_required' });
    const db = await getDb();
    const number = cr;
    await expect(snap({ changeRequestNumber: number, source: 'change_request' })).rejects.toMatchObject({ reason: 'already_proposed', baseline: 'BL2' });
    // Without enforcePolicy (change control's own writers) nothing changes.
    const [{ id: pid }] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'RCF-019'));
    const [{ id: crId }] = await db.select({ id: changeRequests.id }).from(changeRequests).where(and(eq(changeRequests.projectId, pid), eq(changeRequests.number, number)));
    expect(await db.transaction((tx) => createProposedBaseline(tx, { projectId: pid, changeRequestId: crId, changeRequestNumber: number, actorName: 'Marie Lefebvre' }))).toBe('BL3');
  });
});
