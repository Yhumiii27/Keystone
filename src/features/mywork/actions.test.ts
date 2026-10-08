// My work / Task Server Functions on the seeded in-memory DB (docs/spec/10 §6.5, §7.5, §9): input validation, the
// viewer gate (outside the workspace → refused; status / % / checklist / time → assignee or director; comments →
// anyone in the workspace, authored by the viewer, never the prototype's fixed "Marie Lefebvre"), the persisted
// status ⇄ % couplings and time logging. Session and screen access are mocked; writes go through the real DAL.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'member' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/project-context', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { isOutside } = await import('@/components/app/shell/nav-model');
  return {
    getScreenAccess: async (screen: 'mywork' | 'task') => {
      const outside = isOutside(state.role, screen);
      return { viewer: PERSONA_BY_ROLE[state.role], outside, canEdit: !outside };
    },
  };
});

import { and, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { auditEntries } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { getTask, listTasks } from '@/server/dal/tasks';
import {
  addChecklistItemAction, addTaskCommentAction, logTaskTimeAction, markTaskDoneAction, setTaskProgressAction, setTaskStatusAction,
  toggleChecklistItemAction, toggleTaskDoneAction,
} from './actions';

const NOT_YOURS = 'Read-only — only the assignee or the portfolio director can update this task';
const OUTSIDE = 'Read-only — outside my workspace';
const one = async (id: string) => (await listTasks({ number: id }))[0];
/** Audit trail of a task: [actor, change] in insertion order. */
const audit = async (id: string) =>
  (await (await getDb()).select().from(auditEntries).where(and(eq(auditEntries.objectRef, id), eq(auditEntries.area, 'Tasks'))))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((e) => [e.actorName, e.change]);
const as = (role: RoleKey) => {
  state.role = role;
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('gate', () => {
  it('rejects malformed and unknown task ids', async () => {
    as('member');
    for (const taskId of ['', 'nope', 'T-', 'T-1234567', 'T-2305; drop table tasks', 42])
      expect(await toggleTaskDoneAction({ taskId: taskId as string })).toEqual({ ok: false, error: 'Unknown task' });
    expect(await toggleTaskDoneAction({ taskId: 'T-9999' })).toEqual({ ok: false, error: 'Unknown task' });
    expect(await toggleTaskDoneAction(undefined as never)).toEqual({ ok: false, error: 'Unknown task' });
  });

  it('outside the workspace (pm, quality, client): every write refused, nothing changes', async () => {
    for (const role of ['pm', 'quality', 'client'] as RoleKey[]) {
      as(role);
      expect(await setTaskStatusAction({ taskId: 'T-2305', status: 'done' })).toEqual({ ok: false, error: OUTSIDE });
      expect(await addTaskCommentAction({ taskId: 'T-2305', text: 'Hello' })).toEqual({ ok: false, error: OUTSIDE });
      expect(await logTaskTimeAction({ taskId: 'T-2305', hours: '2' })).toEqual({ ok: false, error: OUTSIDE });
    }
    expect(await one('T-2305')).toMatchObject({ status: 'doing', pct: 70, loggedH: 7 });
  });

  it('a member edits only their own tasks (Julien Wagner: T-2305 yes, Hélène’s T-2314 no)', async () => {
    as('member');
    expect(await setTaskStatusAction({ taskId: 'T-2314', status: 'done' })).toEqual({ ok: false, error: NOT_YOURS });
    expect(await setTaskProgressAction({ taskId: 'T-2314', pct: 100 })).toEqual({ ok: false, error: NOT_YOURS });
    expect(await toggleChecklistItemAction({ taskId: 'T-2314', position: 0 })).toEqual({ ok: false, error: NOT_YOURS });
    expect(await logTaskTimeAction({ taskId: 'T-2314', hours: 1 })).toEqual({ ok: false, error: NOT_YOURS });
    expect(await one('T-2314')).toMatchObject({ status: 'doing', pct: 75, loggedH: 6 });
  });
});

describe('status ⇄ percent (10 §9)', () => {
  it('list toggle on the member’s own task: done 100 % ↔ in progress 75 %', async () => {
    as('member');
    expect(await toggleTaskDoneAction({ taskId: 'T-2305' })).toEqual({ ok: true });
    expect(await one('T-2305')).toMatchObject({ status: 'done', pct: 100 });
    expect(await toggleTaskDoneAction({ taskId: 'T-2305' })).toEqual({ ok: true });
    expect(await one('T-2305')).toMatchObject({ status: 'doing', pct: 75 });
  });

  it('status segment and "Mark done" (director on someone else’s task)', async () => {
    as('director');
    expect(await setTaskStatusAction({ taskId: 'T-2314', status: 'shipped' })).toEqual({ ok: false, error: 'Invalid status' });
    expect(await setTaskStatusAction({ taskId: 'T-2314', status: 'review' })).toEqual({ ok: true });
    expect(await one('T-2314')).toMatchObject({ status: 'review', pct: 75 });
    expect(await markTaskDoneAction({ taskId: 'T-2314' })).toEqual({ ok: true });
    expect(await one('T-2314')).toMatchObject({ status: 'done', pct: 100 });
    expect(await setTaskStatusAction({ taskId: 'T-2314', status: 'doing' })).toEqual({ ok: true });
    expect(await one('T-2314')).toMatchObject({ status: 'doing', pct: 75 });
  });

  it('% segment: > 0 on a to-do ⇒ in progress; 100 ⇒ done; 0 on a done task ⇒ to do (not "done at 0 %")', async () => {
    as('director');
    for (const pct of [-5, 101, 12.5, Number.NaN]) expect(await setTaskProgressAction({ taskId: 'T-2318', pct })).toEqual({ ok: false, error: 'Invalid progress' });
    expect(await setTaskProgressAction({ taskId: 'T-2318', pct: 25 })).toEqual({ ok: true });
    expect(await one('T-2318')).toMatchObject({ status: 'doing', pct: 25 });
    expect(await setTaskProgressAction({ taskId: 'T-2318', pct: 100 })).toEqual({ ok: true });
    expect(await one('T-2318')).toMatchObject({ status: 'done', pct: 100 });
    expect(await setTaskProgressAction({ taskId: 'T-2318', pct: 0 })).toEqual({ ok: true });
    expect(await one('T-2318')).toMatchObject({ status: 'todo', pct: 0 });
    expect(await setTaskProgressAction({ taskId: 'T-2302', pct: 50 })).toEqual({ ok: true }); // in review stays in review
    expect(await one('T-2302')).toMatchObject({ status: 'review', pct: 50 });
  });
});

describe('checklist, comments, time', () => {
  it('ticks an item by position and adds items (first item replaces the stored "0 of 3")', async () => {
    as('member');
    expect((await getTask('T-2305'))!.checklistItems.map((c) => c.done)).toEqual([true, true, true, false]);
    expect(await toggleChecklistItemAction({ taskId: 'T-2305', position: 3 })).toEqual({ ok: true });
    expect((await one('T-2305')).checklist).toEqual({ done: 4, total: 4 });
    expect(await toggleChecklistItemAction({ taskId: 'T-2305', position: -1 })).toEqual({ ok: false, error: 'Unknown checklist item' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await toggleChecklistItemAction({ taskId: 'T-2305', position: 99 })).toEqual({ ok: false, error: 'The change could not be saved' });
    spy.mockRestore();
    expect(await addChecklistItemAction({ taskId: 'T-2320', text: '   ' })).toEqual({ ok: false, error: 'Enter an item' });
    expect((await one('T-2320')).checklist).toEqual({ done: 0, total: 4 });
    expect(await addChecklistItemAction({ taskId: 'T-2320', text: '  Check rafter splice bolts  ' })).toEqual({ ok: true });
    const t = (await getTask('T-2320'))!;
    expect(t.checklistItems).toEqual([{ position: 0, text: 'Check rafter splice bolts', done: false }]);
    expect(t.checklist).toEqual({ done: 0, total: 1 });
  });

  it('comments are authored by the viewer — a member on a colleague’s task, the director on any', async () => {
    as('member');
    expect(await addTaskCommentAction({ taskId: 'T-2314', text: '   ' })).toEqual({ ok: false, error: 'Write a comment first' });
    expect(await addTaskCommentAction({ taskId: 'T-2314', text: ' Bay 4 rafters are in — C4 can be re-shot. ' })).toEqual({ ok: true });
    as('director');
    expect(await addTaskCommentAction({ taskId: 'T-2314', text: 'Thanks — keep me posted.' })).toEqual({ ok: true });
    const c = (await getTask('T-2314'))!.comments;
    expect(c.slice(-2).map((x) => [x.author, x.initials, x.text])).toEqual([
      ['Julien Wagner', 'JW', 'Bay 4 rafters are in — C4 can be re-shot.'],
      ['Marie Lefebvre', 'ML', 'Thanks — keep me posted.'],
    ]);
    expect(c).toHaveLength(5);
  });

  it('logs time on the status date (default note "Work on {title}"), refuses 0, negative and > 24 h', async () => {
    as('member');
    for (const hours of ['', '0', '-2', '25', 'abc', '1e2']) expect(await logTaskTimeAction({ taskId: 'T-2305', hours })).toEqual({ ok: false, error: 'Enter hours between 0 and 24' });
    expect(await logTaskTimeAction({ taskId: 'T-2305', hours: '1,5', note: '  ' })).toEqual({ ok: true });
    expect(await logTaskTimeAction({ taskId: 'T-2305', hours: 0.5, note: 'Re-torque B3-07' })).toEqual({ ok: true });
    const t = (await getTask('T-2305'))!;
    expect(t.loggedH).toBe(9);
    // Every write records the viewer in the audit trail.
    expect((await audit('T-2305')).filter(([, c]) => /^(checklist|time logged)/.test(c))).toEqual([
      ['Julien Wagner', 'checklist: ticked "Record in torque log"'],
      ['Julien Wagner', 'time logged: 1.5 h'],
      ['Julien Wagner', 'time logged: 0.5 h'],
    ]);
    expect(t.entries.slice(-2).map((e) => [e.date, e.dateText, e.hours, e.note, e.person])).toEqual([
      ['2026-09-25', 'Fri 25 Sep', 1.5, 'Work on Torque check — Bay 3 bolt groups', 'Julien Wagner'],
      ['2026-09-25', 'Fri 25 Sep', 0.5, 'Re-torque B3-07', 'Julien Wagner'],
    ]);
    expect(t.pct).toBe(75); // % is not recomputed from hours (as in the prototype)
  });
});
