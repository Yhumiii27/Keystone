// R-201 (K-201): recurring tasks of « Mon travail » on the seeded in-memory DB (business date pinned to Fri 25 Sep 2026) — the
// Server Function's rights and validation, the rule stored and shown, the next occurrence created when the task is closed (dates
// on the project's working days, checklist unticked, audited, once per task), the end of a series and the milestone rule.
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
import { addCalendarDays } from '@/domain/calendar';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { auditEntries, projects, taskChecklistItems, tasks } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { getTask, listTasks } from '@/server/dal/tasks';
import { projectMilestoneDates } from '@/server/dal/task-recurrence';
import { markTaskDoneAction, setTaskProgressAction, setTaskRecurrenceAction, toggleTaskDoneAction } from './actions';
import { taskSheetData, workItemData } from './model';

const NOT_YOURS = 'Read-only — only the assignee or the portfolio director can update this task';
const one = async (id: string) => (await listTasks({ number: id }))[0];
const as = (role: RoleKey) => {
  state.role = role;
};
const changes = async (ref: string) =>
  (await (await getDb()).select().from(auditEntries).where(and(eq(auditEntries.objectRef, ref), eq(auditEntries.area, 'Tasks'))))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((e) => e.change);
/** The occurrence created when `id` was closed (rows of tasks whose previous is `id`). */
async function nextOf(id: string) {
  const db = await getDb();
  const [t] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.number, id));
  return db.select().from(tasks).where(eq(tasks.recurrencePreviousTaskId, t.id));
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('setTaskRecurrenceAction (R-201)', () => {
  it('the task’s other editors only: a member on someone else’s task is refused', async () => {
    as('member');
    expect(await setTaskRecurrenceAction({ taskId: 'T-2314', kind: 'weekly' })).toEqual({ ok: false, error: NOT_YOURS });
    expect((await one('T-2314')).recurrence).toBeUndefined();
  });

  it('validates the rule', async () => {
    as('member');
    expect(await setTaskRecurrenceAction({ taskId: 'T-2320', kind: 'daily' })).toEqual({ ok: false, error: 'Choose how the task repeats' });
    expect(await setTaskRecurrenceAction({ taskId: 'T-2320', kind: 'weekly', interval: 0 })).toEqual({ ok: false, error: 'The interval is a whole number from 1 to 12' });
    expect(await setTaskRecurrenceAction({ taskId: 'T-2320', kind: 'weekly', until: '2026-09-01' })).toEqual({ ok: false, error: 'The end date is before the task’s due date' });
    expect(await setTaskRecurrenceAction({ taskId: 'T-2320', kind: 42 as unknown as string })).toEqual({ ok: false, error: 'Invalid request' });
  });

  it('the assignee sets a weekly rule: stored, audited, shown in the list, the board and the sheet', async () => {
    as('member');
    expect(await setTaskRecurrenceAction({ taskId: 'T-2320', kind: 'weekly', interval: '1' })).toEqual({ ok: true });
    const row = await one('T-2320');
    expect(row.recurrence).toEqual({ kind: 'weekly', interval: 1, anchor: '2026-09-29', until: null });
    expect((await changes('T-2320')).at(-1)).toBe('Recurrence set · Every week · interval 1');
    expect(workItemData(row, makeT('fr'), 'fr').repeat).toBe('Chaque semaine');
    const sheet = taskSheetData((await getTask('T-2320'))!, '/my/tasks', makeT('en'), 'en');
    expect(sheet.recurrence).toMatchObject({ rule: { kind: 'weekly', interval: 1, until: null }, text: 'Every week', dueIso: '2026-09-29', previous: null, next: null });
  });

  it('closing it creates the next occurrence once: one week later on working days, To do, checklist unticked, audited', async () => {
    as('member');
    const db = await getDb();
    const [src] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.number, 'T-2320'));
    const items = await db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, src.id));
    expect(await markTaskDoneAction({ taskId: 'T-2320' })).toEqual({ ok: true });
    const [next] = await nextOf('T-2320');
    expect(next).toMatchObject({
      status: 'todo', percentComplete: 0, loggedH: 0, startDate: '2026-10-02', dueDate: '2026-10-06', title: (await one('T-2320')).title,
      recurrenceKind: 'weekly', recurrenceInterval: 1, recurrenceAnchor: '2026-09-29', recurrenceUntil: null,
    });
    const copied = await db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, next.id));
    expect(copied.map((c) => [c.text, c.done])).toEqual(items.sort((a, b) => a.position - b.position).map((c) => [c.text, false]));
    expect(await changes(next.number)).toEqual([`Next occurrence ${next.number} created from T-2320 · due 2026-10-06`]);
    // In the assignee's list, linked both ways on the sheets.
    expect((await listTasks({ person: 'Julien Wagner' })).some((r) => r.id === next.number && r.recurrence?.kind === 'weekly')).toBe(true);
    expect((await getTask('T-2320'))!.series).toEqual({ previous: null, next: next.number });
    expect((await getTask(next.number))!.series).toEqual({ previous: 'T-2320', next: null });
    // Reopened and closed again: no second occurrence.
    expect(await toggleTaskDoneAction({ taskId: 'T-2320' })).toEqual({ ok: true });
    expect(await toggleTaskDoneAction({ taskId: 'T-2320' })).toEqual({ ok: true });
    expect(await nextOf('T-2320')).toHaveLength(1);
    // A closed task's rule does not change (the series goes on from its next occurrence).
    expect(await setTaskRecurrenceAction({ taskId: 'T-2320', kind: 'monthly' })).toEqual({ ok: false, error: 'Set the recurrence on an open task — the next occurrence carries it on' });
  });

  it('stopping the series: the next occurrence closed creates nothing more', async () => {
    as('member');
    const [next] = await nextOf('T-2320');
    expect(await setTaskRecurrenceAction({ taskId: next.number, kind: '' })).toEqual({ ok: true });
    expect((await one(next.number)).recurrence).toBeUndefined();
    expect((await changes(next.number)).at(-1)).toBe('Recurrence stopped');
    expect(await setTaskProgressAction({ taskId: next.number, pct: 100 })).toEqual({ ok: true });
    expect(await nextOf(next.number)).toHaveLength(0);
  });

  it('an end date ends the series (audited); the % at 100 closes the task too', async () => {
    as('member');
    // T-2326: due Tue 6 Oct 2026; monthly → 6 Nov, after the end date.
    expect(await setTaskRecurrenceAction({ taskId: 'T-2326', kind: 'monthly', interval: 1, until: '2026-10-31' })).toEqual({ ok: true });
    expect(await setTaskProgressAction({ taskId: 'T-2326', pct: 100 })).toEqual({ ok: true });
    expect(await nextOf('T-2326')).toHaveLength(0);
    expect((await changes('T-2326')).at(-1)).toBe('Recurrence ended with T-2326');
  });

  it('at each project milestone: due on the project’s next milestone; the director may set it', async () => {
    as('director');
    expect(await setTaskRecurrenceAction({ taskId: 'T-2305', kind: 'milestone', interval: 5 })).toEqual({ ok: true });
    expect((await one('T-2305')).recurrence).toMatchObject({ kind: 'milestone', interval: 1 });
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const miles = (await db.transaction((tx) => projectMilestoneDates(tx, p.id))).filter((d) => d > '2026-09-25').sort();
    expect(await markTaskDoneAction({ taskId: 'T-2305' })).toEqual({ ok: true });
    const created = await nextOf('T-2305');
    expect(miles.length).toBeGreaterThan(0);
    expect(created).toHaveLength(1);
    // The milestone date, moved onto a working day when it falls on a weekend or a holiday.
    expect(created[0].dueDate >= miles[0] && created[0].dueDate <= addCalendarDays(miles[0], 4)).toBe(true);
    expect(created[0].recurrenceKind).toBe('milestone');
  });
});
