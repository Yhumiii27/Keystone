// R-198 — interactive Gantt rules: drag → date / duration, edits and their refusals, the preview (= Reschedule), the scale and
// the geometry. Values worked out by hand on the Standard 5d · 8h calendar (Mon–Fri, French public holidays).
import { describe, expect, it } from 'vitest';
import { BUILTIN_CALENDARS } from './calendar';
import {
  applyGanttEdit, applyGanttEdits, barBox, buildCalendars, dayDelta, dragEdit, draggedDuration, draggedStart, ganttRange, ganttScale, isoWeekNumber, linkLabel,
  earliestStart, ganttEquipmentFilter, linkPath, lockOf, movedConstraint, offDays, parseDurationDays, parseLag, previewSchedule, storedDates, xOf, type GanttActivity, type GanttNetwork,
} from './gantt-edit';

const specs = BUILTIN_CALENDARS.map((def) => ({ def, settingsHolidays: [], exceptions: [] }));
const cals = buildCalendars(specs);
const cal = cals.standard_5x8;

const act = (id: string, over: Partial<GanttActivity> = {}): GanttActivity => ({
  id, name: `Activity ${id}`, wbs: '1.1', duration: 5, calendar: null, pct: 0, remaining: null, startDate: null, finishDate: null, startActual: false,
  finishActual: false, constraint: null, critical: false, totalFloat: null, baselineStart: null, baselineFinish: null, ...over,
});

// Data date Mon 5 Oct 2026. A1010 (5 d) → A1020 (3 d) FS; A1030 (2 d) free; A1040 milestone after A1020; A1000 complete; A1005 in progress.
const net = (): GanttNetwork => ({
  dataDate: '2026-10-05', projectStart: null, projectCalendar: 'standard_5x8', calendars: specs, packages: [{ code: '1.1', name: 'Design' }],
  activities: [
    act('A1000', { pct: 100, startActual: true, finishActual: true, startDate: '2026-09-21', finishDate: '2026-09-25' }),
    act('A1005', { pct: 50, startActual: true, startDate: '2026-09-28', duration: 10 }),
    act('A1010'),
    act('A1020', { duration: 3 }),
    act('A1030', { duration: 2 }),
    act('A1040', { duration: 0 }),
  ],
  links: [
    { pred: 'A1010', succ: 'A1020', type: 'FS', lag: 0 },
    { pred: 'A1020', succ: 'A1040', type: 'FS', lag: 0 },
  ],
});

describe('drag → date / duration', () => {
  it('a drag of dx pixels is a whole number of calendar days at the zoom (28 / 9 / 3 px per day)', () => {
    expect([dayDelta(27, 'day'), dayDelta(13, 'day'), dayDelta(15, 'day'), dayDelta(-43, 'day')]).toEqual([1, 0, 1, -2]);
    expect([dayDelta(63, 'week'), dayDelta(4, 'week'), dayDelta(5, 'week')]).toEqual([7, 0, 1]);
    expect([dayDelta(90, 'month'), dayDelta(-1, 'month'), dayDelta(-2, 'month')]).toEqual([30, -0, -1]);
  });

  it('moved start: the first working day on or after the day under the new left edge', () => {
    // Mon 5 Oct + 2 days = Wed 7 Oct; + 5 days = Sat 10 → Mon 12 Oct; − 1 day = Sun 4 → Mon 5 Oct.
    expect(draggedStart('2026-10-05', 56, 'day', cal)).toBe('2026-10-07');
    expect(draggedStart('2026-10-05', 5 * 28, 'day', cal)).toBe('2026-10-12');
    expect(draggedStart('2026-10-05', -28, 'day', cal)).toBe('2026-10-05');
    // Two weeks right in week zoom; Wed 11 Nov 2026 (Armistice) is skipped.
    expect(draggedStart('2026-10-28', 14 * 9, 'week', cal)).toBe('2026-11-12');
  });

  it('resized duration: working days from the start to the day under the new right edge, at least 1', () => {
    // Mon 5 → Fri 9 Oct (5 d); dragged 3 days right → Mon 12 (6 d); 7 days → Fri 16 (10 d); far left → 1 d.
    expect(draggedDuration('2026-10-05', '2026-10-09', 3 * 28, 'day', cal)).toBe(6);
    expect(draggedDuration('2026-10-05', '2026-10-09', 7 * 9, 'week', cal)).toBe(10);
    expect(draggedDuration('2026-10-05', '2026-10-09', -30 * 28, 'day', cal)).toBe(1);
    // A drag ending on Saturday adds nothing.
    expect(draggedDuration('2026-10-05', '2026-10-09', 28, 'day', cal)).toBe(5);
  });

  it('the edit a finished drag stands for; none when nothing changes', () => {
    const a = act('A1010');
    const shown = { start: '2026-10-05', finish: '2026-10-09' };
    expect(dragEdit('move', a, shown, 2 * 28, 'day', cal)).toEqual({ kind: 'move', id: 'A1010', start: '2026-10-07' });
    expect(dragEdit('move', a, shown, 10, 'day', cal)).toBeNull();
    // Dropped on the weekend before: snapped back to the same Monday → no edit.
    expect(dragEdit('move', a, { start: '2026-10-12', finish: '2026-10-16' }, -28, 'day', cal)).toBeNull();
    expect(dragEdit('resize', a, shown, 3 * 28, 'day', cal)).toEqual({ kind: 'duration', id: 'A1010', days: 6 });
    expect(dragEdit('resize', a, shown, 28, 'day', cal)).toBeNull();
  });
});

describe('edits', () => {
  it('move = a "Start no earlier than" on a working day; a "Must start on" keeps its type', () => {
    expect(movedConstraint(null, '2026-10-12')).toEqual({ type: 'SNET', date: '2026-10-12' });
    expect(movedConstraint({ type: 'FNLT', date: '2026-12-18' }, '2026-10-12')).toEqual({ type: 'SNET', date: '2026-10-12' });
    expect(movedConstraint({ type: 'MSO', date: '2026-10-01' }, '2026-10-12')).toEqual({ type: 'MSO', date: '2026-10-12' });
    const r = applyGanttEdit(net(), { kind: 'move', id: 'A1010', start: '2026-10-10' }, cals);
    expect(r.ok && r.activity?.constraint).toEqual({ type: 'SNET', date: '2026-10-12' });
  });

  it('actual dates are fixed: no move of a started or complete activity, no duration of a complete one or a milestone', () => {
    expect(lockOf(net().activities[0])).toBe('complete');
    expect(lockOf(net().activities[1])).toBe('started');
    expect(lockOf(act('X', { pct: 20 }))).toBe('started');
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1000', start: '2026-10-12' }, cals)).toEqual({ ok: false, error: 'complete' });
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1005', start: '2026-10-12' }, cals)).toEqual({ ok: false, error: 'started' });
    expect(applyGanttEdit(net(), { kind: 'duration', id: 'A1000', days: 3 }, cals)).toEqual({ ok: false, error: 'complete' });
    expect(applyGanttEdit(net(), { kind: 'duration', id: 'A1040', days: 3 }, cals)).toEqual({ ok: false, error: 'milestone' });
    // An activity in progress may still change its (original) duration.
    expect(applyGanttEdit(net(), { kind: 'duration', id: 'A1005', days: 12 }, cals).ok).toBe(true);
  });

  it('input checks: unknown activity, bad date, duration out of range', () => {
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A9999', start: '2026-10-12' }, cals)).toEqual({ ok: false, error: 'unknown' });
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1010', start: '12/10/2026' }, cals)).toEqual({ ok: false, error: 'date' });
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1010', start: '2201-01-01' }, cals)).toEqual({ ok: false, error: 'date' });
    expect(applyGanttEdit(net(), { kind: 'duration', id: 'A1010', days: 0 }, cals)).toEqual({ ok: false, error: 'duration' });
    expect(applyGanttEdit(net(), { kind: 'duration', id: 'A1010', days: 2.5 }, cals)).toEqual({ ok: false, error: 'duration' });
    expect([parseDurationDays('12'), parseDurationDays(' 3 '), parseDurationDays('0'), parseDurationDays('10000'), parseDurationDays('2.5')]).toEqual([12, 3, null, null, null]);
    expect([parseLag(''), parseLag('+5'), parseLag('−3'), parseLag('-999'), parseLag('1000'), parseLag('x')]).toEqual([0, 5, -3, -999, null, null]);
  });

  it('a new duration replaces a remaining duration stored by an import', () => {
    const n = net();
    n.activities[2] = { ...n.activities[2], remaining: 2 };
    const r = applyGanttEdit(n, { kind: 'duration', id: 'A1010', days: 8 }, cals);
    expect(r.ok && [r.activity?.duration, r.activity?.remaining]).toEqual([8, null]);
  });

  it('relationships: add (no self link, duplicate or loop), change type and lag, remove', () => {
    const add = (pred: string, succ: string, type: 'FS' | 'SS' = 'FS', lag = 0) => applyGanttEdit(net(), { kind: 'addLink', link: { pred, succ, type, lag } }, cals);
    expect(add('A1010', 'A1010')).toEqual({ ok: false, error: 'self' });
    expect(add('A1010', 'A1020')).toEqual({ ok: false, error: 'duplicate' });
    expect(add('A1040', 'A1010')).toEqual({ ok: false, error: 'cycle', cycle: ['A1010', 'A1020', 'A1040', 'A1010'] });
    expect(add('A1010', 'A1030', 'FS', 1000)).toEqual({ ok: false, error: 'lag' });
    expect(applyGanttEdit(net(), { kind: 'addLink', link: { pred: 'A1010', succ: 'A1030', type: 'XX' as never, lag: 0 } }, cals)).toEqual({ ok: false, error: 'type' });
    const ok = add('A1010', 'A1030', 'SS', 2);
    expect(ok.ok && ok.net.links.at(-1)).toEqual({ pred: 'A1010', succ: 'A1030', type: 'SS', lag: 2 });
    const edited = applyGanttEdit(net(), { kind: 'editLink', link: { pred: 'A1010', succ: 'A1020', type: 'SS', lag: -2 } }, cals);
    expect(edited.ok && edited.net.links[0]).toEqual({ pred: 'A1010', succ: 'A1020', type: 'SS', lag: -2 });
    expect(applyGanttEdit(net(), { kind: 'editLink', link: { pred: 'A1010', succ: 'A1030', type: 'FS', lag: 0 } }, cals)).toEqual({ ok: false, error: 'missing' });
    const removed = applyGanttEdit(net(), { kind: 'removeLink', pred: 'A1010', succ: 'A1020' }, cals);
    expect(removed.ok && removed.net.links).toEqual([{ pred: 'A1020', succ: 'A1040', type: 'FS', lag: 0 }]);
    expect(applyGanttEdit(net(), { kind: 'removeLink', pred: 'A1010', succ: 'A1030' }, cals)).toEqual({ ok: false, error: 'missing' });
    expect([linkLabel({ type: 'FS', lag: 0 }), linkLabel({ type: 'FS', lag: 5 }), linkLabel({ type: 'SS', lag: -3 })]).toEqual(['FS', 'FS+5', 'SS−3']);
  });

  it('edits in order; the first refusal stops them; the network given is not changed', () => {
    const n = net();
    const r = applyGanttEdits(n, [{ kind: 'clearConstraint', id: 'A1010' }, { kind: 'move', id: 'A1010', start: '2026-10-12' }, { kind: 'duration', id: 'A1010', days: 2 }], cals);
    expect(r.ok && r.net.activities[2]).toMatchObject({ constraint: { type: 'SNET', date: '2026-10-12' }, duration: 2 });
    expect(applyGanttEdits(n, [{ kind: 'duration', id: 'A1010', days: 2 }, { kind: 'move', id: 'A1000', start: '2026-10-12' }], cals)).toEqual({ ok: false, error: 'complete' });
    expect(n.activities[2]).toMatchObject({ constraint: null, duration: 5 });
  });
});

describe('preview (= Reschedule)', () => {
  it('dates the network from the data date; a move pushes the successors; a loop is reported', () => {
    const before = previewSchedule(net(), cals);
    expect(before.ok && [before.dates.A1010, before.dates.A1020, before.dates.A1040]).toEqual([
      { start: '2026-10-05', finish: '2026-10-09', critical: true, totalFloat: 0 },
      { start: '2026-10-12', finish: '2026-10-14', critical: true, totalFloat: 0 },
      { start: '2026-10-15', finish: '2026-10-15', critical: true, totalFloat: 0 },
    ]);
    // Complete activities keep their actual dates.
    expect(before.ok && before.dates.A1000).toMatchObject({ start: '2026-09-21', finish: '2026-09-25', critical: false });
    const moved = applyGanttEdit(net(), { kind: 'move', id: 'A1010', start: '2026-10-12' }, cals);
    const after = moved.ok ? previewSchedule(moved.net, cals) : null;
    expect(after?.ok && [after.dates.A1010.start, after.dates.A1020.start, after.dates.A1040.start]).toEqual(['2026-10-12', '2026-10-19', '2026-10-22']);
    // S-06 (owner, follow-up questionnaire of delivery 9): moving earlier than the data date is now refused (it used to set a
    // "Start no earlier than" with no effect); the data date is what holds the activity.
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1030', start: '2026-09-01' }, cals)).toEqual({
      ok: false, error: 'held', hold: { activity: 'A1030', earliest: '2026-10-05', by: [], floor: 'dataDate' },
    });
    const looped = { ...net(), links: [...net().links, { pred: 'A1040', succ: 'A1010', type: 'FS' as const, lag: 0 }] };
    expect(previewSchedule(looped, cals)).toEqual({ ok: false, cycle: ['A1010', 'A1020', 'A1040', 'A1010'] });
  });

  it('stored dates: activities without dates have no bar', () => {
    const n = net();
    expect(Object.keys(storedDates(n))).toEqual(['A1000']);
  });
});

describe('scale and geometry', () => {
  it('ranges per zoom: whole months, weeks from Monday, a few days of margin', () => {
    const dates = ['2026-10-07', '2026-12-18', '2026-10-05'];
    expect(ganttRange(dates, 'month')).toEqual({ from: '2026-10-01', to: '2027-01-31' });
    expect(ganttRange(dates, 'week')).toEqual({ from: '2026-09-28', to: '2026-12-27' });
    expect(ganttRange(dates, 'day')).toEqual({ from: '2026-10-02', to: '2026-12-25' });
  });

  it('ticks: months on top, days or ISO weeks below; x of a date', () => {
    const w = ganttScale('week', '2026-09-28', '2026-10-25');
    expect([w.width, w.months.map((m) => [m.date, m.x, m.width]), w.units.map((u) => [u.date, u.x])]).toEqual([
      28 * 9,
      [['2026-09-01', 0, 3 * 9], ['2026-10-01', 27, 25 * 9]],
      [['2026-09-28', 0], ['2026-10-05', 63], ['2026-10-12', 126], ['2026-10-19', 189]],
    ]);
    expect(ganttScale('month', '2026-10-01', '2026-11-30').units).toEqual([]);
    expect(ganttScale('day', '2026-10-01', '2026-10-03').units.map((u) => u.x)).toEqual([0, 28, 56]);
    expect(xOf(w, '2026-10-07')).toBe(9 * 9);
    expect([isoWeekNumber('2026-10-05'), isoWeekNumber('2026-12-31'), isoWeekNumber('2027-01-04'), isoWeekNumber('2026-01-01')]).toEqual([41, 53, 1, 1]);
  });

  it('non-working days are shaded in day and week zoom only', () => {
    const d = ganttScale('day', '2026-10-30', '2026-11-03');
    // Sat 31 Oct, Sun 1 Nov (also All Saints' Day).
    expect(offDays(d, cal).map((x) => [x.date, x.x])).toEqual([['2026-10-31', 28], ['2026-11-01', 56]]);
    expect(offDays(ganttScale('month', '2026-10-01', '2026-10-31'), cal)).toEqual([]);
  });

  it('bars from the first to the last day (both included); milestones are points', () => {
    const sc = { origin: '2026-10-01', pxPerDay: 9 };
    expect(barBox(sc, { start: '2026-10-05', finish: '2026-10-09' })).toEqual({ left: 36, width: 45, milestone: false });
    expect(barBox(sc, { start: '2026-10-05', finish: '2026-10-05' }, true)).toEqual({ left: 36, width: 0, milestone: true });
  });

  it('relationship paths: forward elbow when there is room, around through the row gap when not', () => {
    const p = { left: 0, width: 50, milestone: false };
    const q = { left: 80, width: 30, milestone: false };
    expect(linkPath('FS', p, q, 16, 48)).toBe('M50,16 H65 V48 H80');
    expect(linkPath('FS', p, { ...q, left: 20 }, 16, 48)).toBe('M50,16 H58 V32 H12 V48 H20');
    expect(linkPath('SS', p, q, 16, 48)).toBe('M0,16 H-8 V48 H80');
    expect(linkPath('FF', p, q, 16, 48)).toBe('M50,16 H118 V48 H110');
    expect(linkPath('SF', { left: 100, width: 20, milestone: false }, q, 16, 48)).toBe('M100,16 H92 V32 H118 V48 H110');
  });
});

describe('R-204 supplier activities (read-only on the Gantt)', () => {
  const withSupplier = (): GanttNetwork => {
    const n = net();
    return {
      ...n,
      packages: [...n.packages, { code: 'PO-1', name: 'Acme', supplier: true }],
      activities: [...n.activities, act('PO-1/F10', { wbs: 'PO-1', source: 'PO-1', duration: 4, constraint: { type: 'SNET', date: '2026-10-05' } })],
      links: [...n.links, { pred: 'PO-1/F10', succ: 'A1030', type: 'FS', lag: 0 }],
    };
  };

  it('refuses every edit of a supplier activity and of a relationship touching one', () => {
    const n = withSupplier();
    expect(applyGanttEdit(n, { kind: 'move', id: 'PO-1/F10', start: '2026-10-12' }, cals)).toEqual({ ok: false, error: 'supplier' });
    expect(applyGanttEdit(n, { kind: 'duration', id: 'PO-1/F10', days: 2 }, cals)).toEqual({ ok: false, error: 'supplier' });
    expect(applyGanttEdit(n, { kind: 'clearConstraint', id: 'PO-1/F10' }, cals)).toEqual({ ok: false, error: 'supplier' });
    expect(applyGanttEdit(n, { kind: 'addLink', link: { pred: 'A1010', succ: 'PO-1/F10', type: 'FS', lag: 0 } }, cals)).toEqual({ ok: false, error: 'supplier' });
    expect(applyGanttEdit(n, { kind: 'editLink', link: { pred: 'PO-1/F10', succ: 'A1030', type: 'SS', lag: 0 } }, cals)).toEqual({ ok: false, error: 'supplier' });
    expect(applyGanttEdit(n, { kind: 'removeLink', pred: 'PO-1/F10', succ: 'A1030' }, cals)).toEqual({ ok: false, error: 'supplier' });
    // The project's own edits are unchanged.
    expect(applyGanttEdit(n, { kind: 'duration', id: 'A1030', days: 4 }, cals).ok).toBe(true);
  });

  it('the preview dates the supplier activity and its tie drives the project activity', () => {
    const p = previewSchedule(withSupplier(), cals);
    if (!p.ok) throw new Error('preview failed');
    // Supplier 4 d from Mon 5 Oct → Thu 8 Oct; A1030 starts Fri 9 Oct (was 5 Oct without the tie).
    expect([p.dates['PO-1/F10'].start, p.dates['PO-1/F10'].finish, p.dates.A1030.start]).toEqual(['2026-10-05', '2026-10-08', '2026-10-09']);
  });
});

describe('S-06 — a move earlier than the logic allows is refused', () => {
  it('names the driving predecessor (with its relationship) and the earliest possible start', () => {
    // A1020 follows A1010 (5 d from Mon 5 Oct → Fri 9 Oct): it cannot start before Mon 12 Oct.
    expect(earliestStart(net(), cals, 'A1020')).toEqual({ activity: 'A1020', earliest: '2026-10-12', by: [{ id: 'A1010', link: 'FS' }], floor: 'predecessor' });
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1020', start: '2026-10-08' }, cals)).toEqual({
      ok: false, error: 'held', hold: { activity: 'A1020', earliest: '2026-10-12', by: [{ id: 'A1010', link: 'FS' }], floor: 'predecessor' },
    });
    // On the earliest date, or later: accepted. Dropped on Sat 10 Oct → snapped to Mon 12 Oct, accepted.
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1020', start: '2026-10-12' }, cals).ok).toBe(true);
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1020', start: '2026-10-10' }, cals).ok).toBe(true);
    expect(applyGanttEdit(net(), { kind: 'move', id: 'A1020', start: '2026-10-20' }, cals).ok).toBe(true);
  });

  it('the activity’s own constraint does not count; a lag and several predecessors are named', () => {
    const n = net();
    n.activities[3] = { ...n.activities[3], constraint: { type: 'SNET', date: '2026-10-26' } };
    n.links = [{ pred: 'A1010', succ: 'A1020', type: 'FS', lag: 2 }, { pred: 'A1030', succ: 'A1020', type: 'FS', lag: 5 }, n.links[1]];
    // A1010 ends Fri 9 Oct + 2 d → Wed 14; A1030 ends Tue 6 + 5 d → Wed 14: both drive.
    const hold = earliestStart(n, cals, 'A1020');
    expect(hold).toEqual({ activity: 'A1020', earliest: '2026-10-14', by: [{ id: 'A1010', link: 'FS+2' }, { id: 'A1030', link: 'FS+5' }], floor: 'predecessor' });
    expect(applyGanttEdit(n, { kind: 'move', id: 'A1020', start: '2026-10-13' }, cals)).toMatchObject({ ok: false, error: 'held' });
    // Moving the constrained activity earlier than its constraint, but not earlier than its predecessors: accepted.
    expect(applyGanttEdit(n, { kind: 'move', id: 'A1020', start: '2026-10-14' }, cals)).toMatchObject({ ok: true, activity: { constraint: { type: 'SNET', date: '2026-10-14' } } });
  });

  it('the project start holds an activity without predecessor; a "Must start on" forces its date (not refused)', () => {
    const n = { ...net(), projectStart: '2026-10-19' };
    expect(applyGanttEdit(n, { kind: 'move', id: 'A1030', start: '2026-10-12' }, cals)).toMatchObject({ ok: false, error: 'held', hold: { earliest: '2026-10-19', floor: 'projectStart' } });
    const m = net();
    m.activities[3] = { ...m.activities[3], constraint: { type: 'MSO', date: '2026-10-12' } };
    expect(applyGanttEdit(m, { kind: 'move', id: 'A1020', start: '2026-10-07' }, cals)).toMatchObject({ ok: true, activity: { constraint: { type: 'MSO', date: '2026-10-07' } } });
  });

  it('a finish-anchored predecessor sees the new duration when the duration changes first (the order of the dialog and the server)', () => {
    const n = net();
    n.links = [{ pred: 'A1010', succ: 'A1020', type: 'FF', lag: 0 }, n.links[1]];
    // A1020 (3 d) must finish with A1010 (Fri 9 Oct): earliest start Wed 7 Oct; with 5 days, Mon 5 Oct.
    expect(earliestStart(n, cals, 'A1020')).toMatchObject({ earliest: '2026-10-07', by: [{ id: 'A1010', link: 'FF' }] });
    expect(applyGanttEdits(n, [{ kind: 'move', id: 'A1020', start: '2026-10-05' }], cals)).toMatchObject({ ok: false, error: 'held' });
    expect(applyGanttEdits(n, [{ kind: 'duration', id: 'A1020', days: 5 }, { kind: 'move', id: 'A1020', start: '2026-10-05' }], cals).ok).toBe(true);
  });

  it('no check when the network cannot be dated (a loop: Reschedule reports it)', () => {
    const looped = { ...net(), links: [...net().links, { pred: 'A1040', succ: 'A1010', type: 'FS' as const, lag: 0 }] };
    expect(earliestStart(looped, cals, 'A1020')).toBeNull();
    expect(applyGanttEdit(looped, { kind: 'move', id: 'A1020', start: '2026-10-05' }, cals).ok).toBe(true);
  });
});

describe('S-08 — equipment line filter of the rows', () => {
  it('all, one line, or the common activities (supplier activities included)', () => {
    const acts = [act('A1', { equipment: 'EQ-01' }), act('A2', { equipment: 'EQ-02' }), act('A3', { equipment: null }), act('PO-1/F10', { source: 'PO-1' })];
    const ids = (f: string) => ganttEquipmentFilter(acts, f).map((a) => a.id);
    expect([ids('all'), ids('EQ-02'), ids('common')]).toEqual([['A1', 'A2', 'A3', 'PO-1/F10'], ['A2'], ['A3', 'PO-1/F10']]);
  });
});
