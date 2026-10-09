// Chapter 4 Plan Server Functions against an in-memory database: rights (director / project manager schedule, editors edit),
// Reschedule toast (EN / FR, "no change" on the second run), Set baseline, the Baseline and Calendar chips, the drawer's
// calendar override, relationships (errors, loops) and to-dos. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { role: 'director' as string, name: 'Marie Lefebvre', canEdit: true, isMine: true, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }) };
});
vi.mock('@/server/project-context', async () => {
  const { getProject } = await import('@/server/dal/projects');
  return {
    getProjectContext: async (code: string) => ({
      project: await getProject(code), viewer: { role: viewer.role, name: viewer.name }, canEdit: () => viewer.canEdit, isMine: viewer.isMine,
    }),
  };
});

import { listActivityTodos } from '@/server/dal/activity-todos';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getPlanData, getPlanSettings } from '@/server/dal/plan';
import {
  addRelationshipAction, addTodoAction, removeRelationshipAction, removeTodoAction, rescheduleAction, setActivityCalendarAction, setBaselineAction,
  setProjectCalendarAction, showBaselineAction, toggleTodoAction,
} from './scheduling-actions';

const act = async (id: string) => (await getPlanData('HLT-026'))!.activities.find((a) => a.id === id)!;

describe('Plan scheduling Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => Object.assign(viewer, { role: 'director', name: 'Marie Lefebvre', canEdit: true, isMine: true, lang: 'en' }));

  it('rights: scheduling is for the director and the project manager; editing for plan editors; never the client', async () => {
    Object.assign(viewer, { role: 'englead', name: 'Antoine Girard', isMine: false });
    expect(await rescheduleAction('HLT-026')).toEqual({ error: 'Only the project manager or the director can do this' });
    expect(await setBaselineAction('HLT-026', { name: 'BL3' })).toEqual({ error: 'Only the project manager or the director can do this' });
    expect(await addTodoAction('HLT-026', 'A1250', '')).toEqual({ error: 'Enter a to-do' });
    Object.assign(viewer, { role: 'client', name: 'Nadia Bensaïd', isMine: true });
    expect(await addTodoAction('HLT-026', 'A1250', 'x')).toEqual({ error: 'This plan is read-only for you' });
    Object.assign(viewer, { role: 'pm', name: 'Romain Aubert', isMine: true, canEdit: false });
    expect(await rescheduleAction('HLT-026')).toEqual({ error: 'Only the project manager or the director can do this' });
    expect(await rescheduleAction('NOPE-1')).toEqual({ error: 'Invalid request' });
  });

  it('Reschedule: toast with the data date, the new finish and the changed activities; the second run changes nothing', async () => {
    Object.assign(viewer, { role: 'pm', name: 'Romain Aubert', isMine: true });
    expect(await rescheduleAction('HLT-026')).toEqual({ ok: true, toast: 'Rescheduled at 25 Sep 2026 · finish 18 Jan 2027 · 11 activities changed' });
    viewer.lang = 'fr';
    expect(await rescheduleAction('HLT-026')).toEqual({ ok: true, toast: 'Replanifié au 25 sept. 2026 · fin 18 janv. 2027 · aucun changement' });
  });

  it('Set baseline: BL3 snapshot of the 21 activities, proposed; name validated', async () => {
    expect(await setBaselineAction('HLT-026', { name: 'x'.repeat(81) })).toEqual({ error: 'Baseline name is too long' });
    expect(await setBaselineAction('HLT-026', { name: 'BL3 — after reschedule', comment: 'September data date' })).toEqual({ toast: 'BL3 · Baseline set · 21 activities' });
    const b = (await getPlanSettings('HLT-026'))!.baselines.find((x) => x.code === 'BL3')!;
    expect([b.name, b.state, b.comment, b.activityCount, b.displayed, b.createdByName]).toEqual(['BL3 — after reschedule', 'proposed', 'September data date', 21, false, 'Marie Lefebvre']);
  });

  it('Baseline chip: refuses unknown baselines and baselines without snapshot; shows BL3', async () => {
    expect(await showBaselineAction('HLT-026', 'BL9')).toEqual({ error: 'Unknown baseline' });
    expect(await showBaselineAction('HLT-026', 'BL0')).toEqual({ error: 'This baseline has no activity snapshot' });
    expect(await showBaselineAction('HLT-026', 'BL3')).toEqual({ ok: true, toast: 'BL3 displayed · variances recomputed' });
    expect(await showBaselineAction('HLT-026', 'BL3')).toEqual({ ok: true });
    expect((await getPlanSettings('HLT-026'))!.displayed?.code).toBe('BL3');
    expect((await act('A1250')).variance).toBe(0);
    viewer.lang = 'fr';
    expect(await showBaselineAction('HLT-026', 'BL1')).toEqual({ ok: true, toast: 'BL1 affichée · écarts recalculés' });
  });

  it('Calendar chip and the drawer override (S-2)', async () => {
    expect((await getPlanSettings('HLT-026'))!.calendarCode).toBe('standard_5x8');
    expect(await setProjectCalendarAction('HLT-026', 'nope')).toEqual({ error: 'Unknown calendar' });
    expect(await setProjectCalendarAction('HLT-026', 'site_6x10')).toEqual({ ok: true, toast: 'Calendar · Chantier 6d · 10h · dates move at the next Reschedule' });
    expect((await getPlanSettings('HLT-026'))!.calendarCode).toBe('site_6x10');
    expect(await setActivityCalendarAction('HLT-026', 'A1230', 'standard_5x8_workshop')).toEqual({ ok: true, toast: 'A1230 · calendar Atelier 5d · 8h · applied at the next Reschedule' });
    expect((await act('A1230')).calendarCode).toBe('standard_5x8_workshop');
    expect(await setActivityCalendarAction('HLT-026', 'A1230', '')).toEqual({ ok: true, toast: 'A1230 · project calendar · applied at the next Reschedule' });
    expect(await setActivityCalendarAction('HLT-026', 'A1230', 'bogus')).toEqual({ error: 'Invalid request' });
    // Back to the seed calendar for the next tests.
    expect(await setProjectCalendarAction('HLT-026', 'standard_5x8')).toMatchObject({ ok: true });
  });

  it('Add relationship: validation, duplicates, loops; then removal', async () => {
    const add = (activity: string, v: Record<string, string>) => addRelationshipAction('HLT-026', activity, v);
    expect(await add('A1520', { dir: 'pred', activity: 'A1330 · Crane commissioning & load tests', type: 'FS', lag: 'abc' })).toEqual({
      error: 'The lag is a whole number of working days between −999 and 999',
    });
    expect(await add('A1520', { dir: 'pred', activity: 'A1330 · x', type: 'XX', lag: '0' })).toEqual({ error: 'Unknown relationship type' });
    expect(await add('A1520', { dir: 'pred', activity: '', type: 'FS', lag: '0' })).toEqual({ error: 'Choose an activity' });
    expect(await add('A1520', { dir: 'pred', activity: 'A1520 · self', type: 'FS', lag: '0' })).toEqual({ error: 'An activity cannot be linked to itself' });
    expect(await add('A1520', { dir: 'pred', activity: 'A1510 · Yard drainage', type: 'FS', lag: '0' })).toEqual({ error: 'This relationship already exists' });
    expect(await add('A1010', { dir: 'pred', activity: 'A1620 · Handover', type: 'FS', lag: '0' })).toEqual({
      error: 'This relationship would create a logic loop: A1010 → A1230 → A1240 → A1250 → A1260 → A1430 → A1610 → A1620 → A1010',
    });
    expect(await add('A1520', { dir: 'pred', activity: 'A1330 · Crane commissioning & load tests', type: 'FS', lag: '+5' })).toEqual({
      toast: 'Relationship added · A1330 FS+5 → A1520',
    });
    expect(await add('A1330', { dir: 'succ', activity: 'A1610 · Systems integration', type: 'SS', lag: '−2' })).toEqual({ error: 'This relationship already exists' });
    expect((await act('A1520')).preds).toEqual([['A1510', 'FS', 0], ['A1320', 'FS', 0], ['A1330', 'FS', 5]]);
    expect(await removeRelationshipAction('HLT-026', 'A1330', 'A1520')).toEqual({ ok: true, toast: 'Relationship removed · A1330 → A1520' });
    expect(await removeRelationshipAction('HLT-026', 'A1330', 'A1520')).toEqual({ error: 'This relationship no longer exists' });
  });

  it('To-dos: add, tick, untick, remove; seeded tasks stay in My work', async () => {
    const r = await addTodoAction('HLT-026', 'A1250', '  Check bolt torques on bay 4  ');
    expect(r).toMatchObject({ ok: true });
    const number = /^(T-\d+) · To-do added$/.exec((r as { toast: string }).toast)![1];
    let todo = (await listActivityTodos('HLT-026', 'A1250')).find((x) => x.number === number)!;
    expect([todo.title, todo.assignee, todo.dueDate, todo.removable, todo.done]).toEqual(['Check bolt torques on bay 4', 'Julien Wagner', '2026-10-09', true, false]);
    expect(await toggleTodoAction('HLT-026', 'A1250', number, true)).toEqual({ ok: true });
    todo = (await listActivityTodos('HLT-026', 'A1250')).find((x) => x.number === number)!;
    expect(todo.done).toBe(true);
    expect(await toggleTodoAction('HLT-026', 'A1260', number, false)).toEqual({ error: 'Invalid request' });
    expect(await removeTodoAction('HLT-026', 'A1250', number)).toEqual({ ok: true, toast: `${number} · To-do removed` });
    const seeded = (await listActivityTodos('HLT-026', 'A1250')).find((x) => !x.removable)!;
    expect(await removeTodoAction('HLT-026', 'A1250', seeded.number)).toEqual({ error: 'This to-do is managed in My work' });
    expect(await addTodoAction('HLT-026', 'A1250', 'x'.repeat(201))).toEqual({ error: 'A to-do holds at most 200 characters' });
  });
});
