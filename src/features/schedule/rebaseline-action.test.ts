// "Re-baseline" Server Function (docs/spec/05 §1.5, chapter 4 S-3): it now writes a proposed baseline row with the activity
// snapshot, linked to the change request it names, with the approver and the scope of the form.
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
import { baselines, persons } from '@/server/db/schema';
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

  it('writes BL3 (proposed) with the snapshot, CR-006, the approver and the scope', async () => {
    expect(await rebaselineSchedule('HLT-026', { name: 'BL2 — after CR-006', reason: 'Additional piles approved', approver: 'pm', scope: 'dates' })).toEqual({
      toast: 'BL2 — after CR-006 · Baseline frozen · BL3',
    });
    const b = (await listProjectBaselines('HLT-026')).find((x) => x.code === 'BL3')!;
    expect([b.name, b.state, b.source, b.comment, b.changeRequest, b.activityCount, b.setOn]).toEqual([
      'BL2 — after CR-006', 'proposed', 'change_request', 'Additional piles approved', 'CR-006', 21, '2026-09-25',
    ]);
    const db = await getDb();
    const [row] = await db.select({ scope: baselines.scope, approver: persons.fullName }).from(baselines).leftJoin(persons, eq(persons.id, baselines.approverPersonId)).where(eq(baselines.name, 'BL2 — after CR-006'));
    expect(row).toEqual({ scope: 'dates', approver: 'Romain Aubert' });
    expect((await getBaselineActivities('HLT-026', 'BL3')).find((r) => r.activityCode === 'A1250')).toMatchObject({ finishDate: '2026-10-09', startDate: '2026-08-17' });
  });

  it('a name without a known change request gives a plain snapshot', async () => {
    expect(await rebaselineSchedule('HLT-026', { name: 'Recovery plan', reason: 'Owner request (CR-999)' })).toEqual({ toast: 'Recovery plan · Baseline frozen · BL4' });
    const b = (await listProjectBaselines('HLT-026')).find((x) => x.code === 'BL4')!;
    expect([b.source, b.changeRequest]).toEqual(['snapshot', null]);
  });
});
