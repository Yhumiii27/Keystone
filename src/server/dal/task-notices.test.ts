// R-015 (X-6a, work-planning part): "Task assigned · T-xxxx" to the assignee of a task created for them by someone else — here
// the Plan drawer's to-dos (meeting follow-ups: src/server/dal/meeting-followups.test.ts) — after the commit, never to the
// actor, never to a person without an account (no orphan notification); a notification failure never undoes the task.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { notifications, tasks } from '@/server/db/schema';
import { addActivityTodo } from './activity-todos';
import { listNotifications } from './notifications';
import * as notices from './notifications';
import { assignedTitle, mentionTitle, notifyTasksAssigned } from './task-notices';

const assigned = async (role: string, n: string) => (await listNotifications(role)).filter((x) => x.kind === 'task' && x.title === assignedTitle(n));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-015 — task assigned (activity to-dos)', () => {
  it('templates: fixed English titles (the typed title goes in the sub-line)', () => {
    expect([assignedTitle('T-2341'), mentionTitle('T-2341')]).toEqual(['Task assigned · T-2341', '@you in T-2341']);
  });

  it('the activity owner (J. Wagner) is told once, opening the task; the PM who created it is not', async () => {
    const pmBefore = (await listNotifications('pm')).length;
    const n = await addActivityTodo('HLT-026', 'A1250', { title: 'Check bolt torque — bay 4' }, 'Romain Aubert');
    const got = await assigned('member', n);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'task', read: false, sub: 'Check bolt torque — bay 4', screen: 'task', params: { taskId: n }, projectCode: 'HLT-026' });
    expect((await listNotifications('pm')).length).toBe(pmBefore);
  });

  it('the actor assigning themself is not told', async () => {
    const n = await addActivityTodo('HLT-026', 'A1250', { title: 'My own reminder', assignee: 'J. Wagner' }, 'Julien Wagner');
    expect(await assigned('member', n)).toHaveLength(0);
  });

  it('an assignee without a Keystone account gets nothing (no notification row at all)', async () => {
    const db = await getDb();
    const before = (await db.select().from(notifications)).length;
    const n = await addActivityTodo('HLT-026', 'A1250', { title: 'Survey', assignee: 'H. Sauvage' }, 'Romain Aubert');
    expect((await db.select().from(tasks).where(eq(tasks.number, n))).length).toBe(1);
    expect((await db.select().from(notifications)).length).toBe(before);
  });

  it('a notification failure is logged and never undoes the task', async () => {
    const spy = vi.spyOn(notices, 'createNotification').mockRejectedValueOnce(new Error('bell down'));
    const n = await addActivityTodo('HLT-026', 'A1250', { title: 'Still created' }, 'Romain Aubert');
    expect((await (await getDb()).select().from(tasks).where(eq(tasks.number, n))).length).toBe(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    await expect(notifyTasksAssigned(['T-0000'], 'Nobody')).resolves.toBeUndefined();
  });
});
