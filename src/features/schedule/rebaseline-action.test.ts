// "Re-baseline" Server Function (docs/spec/05 §1.5, chapter 4 S-3): it writes a baseline row with the activity snapshot — free
// and current up to BL1, then only as the proposal of an open change request it names, with the approver and the scope of the form.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { canEdit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async () => ({ viewer: { role: 'director', name: 'Marie Lefebvre' }, canEdit: () => viewer.canEdit }),
}));

import { eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { baselines, changeRequests, persons, projects } from '@/server/db/schema';
import { createChangeRequest } from '@/server/dal/changes';
import { getBaselineActivities, listProjectBaselines } from '@/server/dal/baselines';
import { rebaselineSchedule } from './actions';

describe('rebaselineSchedule', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.canEdit = true;
  });

  it('refuses viewers who cannot edit, invalid forms and projects without a schedule', async () => {
    viewer.canEdit = false;
    expect(await rebaselineSchedule('HLT-026', { name: 'BL3', reason: 'x' })).toEqual({ error: 'You cannot re-baseline this project' });
    viewer.canEdit = true;
    expect(await rebaselineSchedule('HLT-026', { name: 'BL3', reason: '' })).toEqual({ error: 'Reason is required' });
    expect(await rebaselineSchedule('ALP-021', { name: 'BL1', reason: 'x' })).toEqual({ error: 'No schedule recorded for this project' });
    expect(await rebaselineSchedule('NOPE-1', { name: 'BL1', reason: 'x' })).toEqual({ error: 'Unknown project' });
  });

  // S-3 (docs/DECISIONS.md, S-3 = a): after BL1 a new baseline goes through a change request. HLT-026 has BL0–BL2, so the
  // re-baseline must name an open request; it used to accept the approved CR-006 or none at all (prototype behaviour).
  it('after BL1: refuses a re-baseline without an open change request, or one that already proposes a baseline', async () => {
    const refused = { error: 'After BL1, a new baseline goes through a change request — name an open change request (CR-…)' };
    expect(await rebaselineSchedule('HLT-026', { name: 'BL2 — after CR-006', reason: 'Additional piles approved' })).toEqual(refused);
    expect(await rebaselineSchedule('HLT-026', { name: 'Recovery plan', reason: 'Owner request (CR-999)' })).toEqual(refused);
    expect(await rebaselineSchedule('HLT-026', { name: 'BL3', reason: 'CR-009' })).toEqual({ error: 'CR-009 · already proposes baseline BL2' });
    expect((await listProjectBaselines('HLT-026')).map((b) => b.code)).toEqual(['BL0', 'BL1', 'BL2']);
  });

  it('writes BL3 (proposed) with the snapshot, the open CR-008, the approver and the scope', async () => {
    expect(await rebaselineSchedule('HLT-026', { name: 'BL3 — after CR-008', reason: 'Second steel crew', approver: 'pm', scope: 'dates' })).toEqual({
      toast: 'BL3 — after CR-008 · Baseline frozen · BL3',
    });
    const b = (await listProjectBaselines('HLT-026')).find((x) => x.code === 'BL3')!;
    expect([b.name, b.state, b.source, b.comment, b.changeRequest, b.activityCount, b.setOn]).toEqual([
      'BL3 — after CR-008', 'proposed', 'change_request', 'Second steel crew', 'CR-008', 21, '2026-09-25',
    ]);
    const db = await getDb();
    const [row] = await db.select({ scope: baselines.scope, approver: persons.fullName }).from(baselines).leftJoin(persons, eq(persons.id, baselines.approverPersonId)).where(eq(baselines.name, 'BL3 — after CR-008'));
    expect(row).toEqual({ scope: 'dates', approver: 'Romain Aubert' });
    expect((await getBaselineActivities('HLT-026', 'BL3')).find((r) => r.activityCode === 'A1250')).toMatchObject({ finishDate: '2026-10-09', startDate: '2026-08-17' });
  });

  it('up to BL1 the snapshot is free and current at once (a project without baselines)', async () => {
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'NDC-031'));
    await db.delete(baselines).where(eq(baselines.projectId, p.id));
    // A closed (approved) request named while snapshots are free is ignored: the baseline is current, not proposed for ever.
    const closed = await createChangeRequest('NDC-031', { title: 'Old scope', types: ['scope'], amountKeur: 0, scheduleDays: 0 }, 'Marie Lefebvre');
    await db.update(changeRequests).set({ status: 'approved' }).where(eq(changeRequests.number, closed));
    expect(await rebaselineSchedule('NDC-031', { name: 'Initial plan', reason: `Kick-off (${closed})` })).toEqual({ toast: 'Initial plan · Baseline frozen · BL0' });
    expect((await listProjectBaselines('NDC-031')).map((b) => [b.code, b.state, b.source, b.changeRequest])).toEqual([['BL0', 'current', 'snapshot', null]]);
    expect(await rebaselineSchedule('NDC-031', { name: 'APD plan', reason: 'End of APD (L-2)' })).toEqual({ toast: 'APD plan · Baseline frozen · BL1' });
    expect((await listProjectBaselines('NDC-031')).map((b) => [b.code, b.state, b.source])).toEqual([['BL0', 'superseded', 'snapshot'], ['BL1', 'current', 'snapshot']]);
    expect(await rebaselineSchedule('NDC-031', { name: 'BL2', reason: 'Late' })).toMatchObject({ error: expect.stringContaining('After BL1') });
  });
});
