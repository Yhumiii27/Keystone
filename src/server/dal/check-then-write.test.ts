// R-010 — "check then write": the state a Server Function checked before the writer's transaction is checked again inside it,
// so two requests sent at once (two people, a double click) cannot both pass on the same state.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { HOURS_ALREADY_ASSIGNED, assignUnassignedHours, getHoursReconciliation, markHoursImported } from './hr';
import { toggleMeetingAction } from './meetings';
import { REX_MOVED_ON, addLesson, advanceLesson, cycleClosureItem, getRex } from './rex';
import { getTask, toggleChecklistItem } from './tasks';

const PM = { name: 'Romain Aubert', role: 'pm' };
const ENGLEAD = { role: 'englead', name: 'Antoine Girard' };
const QUALITY = { role: 'quality', name: 'Gabriel Comte' };

describe('checks repeated inside the writer\'s transaction', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('Hours "Assign": two assigns of the same line at once → assigned once, the other refused', async () => {
    await markHoursImported('HLT-026', {}, PM);
    const r = await Promise.allSettled([assignUnassignedHours('HLT-026', 0, '1.4', PM), assignUnassignedHours('HLT-026', 0, '1.5', PM)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.flatMap((x) => (x.status === 'rejected' ? [(x.reason as Error).message] : []))).toEqual([HOURS_ALREADY_ASSIGNED]);
    const wbs = (await getHoursReconciliation('HLT-026'))!.unassigned[0].assignedWbs;
    expect(wbs).toBe(r[0].status === 'fulfilled' ? '1.4' : '1.5');
  });

  it('Lesson "Validate" sent twice from Proposed → one step (Validated), not two (Applied)', async () => {
    const number = await addLesson('HLT-026', { theme: 'site', whatHappened: 'Crane hire booked late', recommendation: 'Book at FAT', appliesTo: 'WBS template' }, QUALITY);
    const r = await Promise.allSettled([
      advanceLesson('HLT-026', number, ENGLEAD, { expected: 'proposed' }),
      advanceLesson('HLT-026', number, ENGLEAD, { expected: 'proposed' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled').map((x) => (x as PromiseFulfilledResult<string>).value)).toEqual(['validated']);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(new RegExp(`${REX_MOVED_ON}$`));
    expect((await getRex('HLT-026')).lessons.find((l) => l.number === number)!.status).toBe('validated');
  });

  it('closure checklist clicked twice from the same state → one step', async () => {
    const item = (await getRex('HLT-026')).closure[0];
    const r = await Promise.allSettled([
      cycleClosureItem('HLT-026', item.position, ENGLEAD, { expected: item.status }),
      cycleClosureItem('HLT-026', item.position, ENGLEAD, { expected: item.status }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });

  it('ticks with the state asked for: two people ticking at once leave it ticked', async () => {
    const [a, b] = await Promise.all([toggleChecklistItem('T-2314', 0, 'Romain Aubert', { done: true }), toggleChecklistItem('T-2314', 0, 'Léa Marchand', { done: true })]);
    expect([a, b]).toEqual([true, true]);
    const ticked = (await getTask('T-2314'))!.checklist.done;
    expect(await toggleChecklistItem('T-2314', 0, 'Romain Aubert', { done: true })).toBe(true);
    expect((await getTask('T-2314'))!.checklist.done).toBe(ticked);
    expect(await toggleChecklistItem('T-2314', 0, 'Romain Aubert', { done: false })).toBe(false);
    expect((await getTask('T-2314'))!.checklist.done).toBe(ticked - 1);
    const m = await Promise.all([
      toggleMeetingAction('MTG-118', 1, 1, 'Romain Aubert', { done: true }),
      toggleMeetingAction('MTG-118', 1, 1, 'Léa Marchand', { done: true }),
    ]);
    expect(m).toEqual([true, true]);
    expect(await toggleMeetingAction('MTG-118', 1, 1, 'Romain Aubert', { done: true })).toBe(true);
  });
});
