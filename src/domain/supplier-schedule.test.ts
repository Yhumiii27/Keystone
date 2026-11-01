// R-204 — supplier schedules consolidated into the project CPM: node ids, consolidation (only tied schedules, unknown targets
// left out, engine semantics unchanged), dates propagating from a supplier slip into the project, loops refused across the
// networks, linking rules, progress validation and the supplier forecast with its slips.
import { describe, expect, it } from 'vitest';
import { WorkCalendar, type CalendarDef } from './calendar';
import { schedule, type CpmInput } from './cpm';
import {
  checkSupplierLink, checkSupplierTie, consolidateNetwork, lastSupplierActivity, parseSupplierActivity, parseSupplierProgress, supplierCpmActivity,
  supplierForecast, supplierNetworkCycle, supplierNodeId, type SupplierScheduleInput,
} from './supplier-schedule';

// Mon–Fri without holidays; 5 Jan 2026 is a Monday.
const MF: CalendarDef = { code: 'mf', name: 'Mon–Fri', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidaySet: null, useSettingsHolidays: false };
const calendars = { mf: new WorkCalendar(MF) };
const project: CpmInput = {
  dataDate: '2026-01-05', projectCalendar: 'mf', calendars,
  activities: [{ id: 'A10', duration: 5 }, { id: 'A20', duration: 3 }, { id: 'A30', duration: 2 }],
  links: [{ pred: 'A10', succ: 'A20', type: 'FS', lag: 0 }, { pred: 'A20', succ: 'A30', type: 'FS', lag: 0 }],
};
const supplier = (over: Partial<SupplierScheduleInput> = {}): SupplierScheduleInput => ({
  po: 'PO-1082',
  activities: [
    { code: 'F10', name: 'Drawings approval', duration: 5, committedStart: '2026-01-05', committedFinish: '2026-01-09', pct: 0 },
    { code: 'F20', name: 'Manufacturing', duration: 10, committedStart: '2026-01-12', committedFinish: '2026-01-23', pct: 0 },
    { code: 'F30', name: 'Delivery', duration: 0, committedStart: '2026-01-26', committedFinish: '2026-01-26', pct: 0 },
  ],
  links: [{ pred: 'F10', succ: 'F20', type: 'FS', lag: 0 }, { pred: 'F20', succ: 'F30', type: 'FS', lag: 0 }],
  ties: [{ supplier: 'F30', activity: 'A20', direction: 'to_project', lag: 0 }],
  ...over,
});

describe('consolidation', () => {
  it('node ids never collide with activity codes', () => {
    expect(supplierNodeId('PO-1082', 'F10')).toBe('PO-1082/F10');
  });

  it('a supplier activity is an ordinary node: SNET its committed start until it starts, then its actual dates', () => {
    const a = supplier().activities[0];
    expect(supplierCpmActivity('PO-1082', a)).toEqual({ id: 'PO-1082/F10', duration: 5, calendar: null, percentComplete: 0, actualStart: null, actualFinish: null, constraint: { type: 'SNET', date: '2026-01-05' } });
    expect(supplierCpmActivity('PO-1082', { ...a, actualStart: '2026-01-06', pct: 40 })).toMatchObject({ actualStart: '2026-01-06', actualFinish: null, percentComplete: 40, constraint: null });
    expect(supplierCpmActivity('PO-1082', { ...a, actualStart: '2026-01-06', actualFinish: '2026-01-12', pct: 100 })).toMatchObject({ percentComplete: 100, actualFinish: '2026-01-12' });
  });

  it('keeps the project network first and unchanged, adds the tied schedules only', () => {
    const untied = supplier({ po: 'PO-1090', ties: [] });
    const c = consolidateNetwork(project, [supplier(), untied]);
    expect(c.input.activities.slice(0, 3)).toEqual(project.activities);
    expect(c.input.activities.map((a) => a.id)).toEqual(['A10', 'A20', 'A30', 'PO-1082/F10', 'PO-1082/F20', 'PO-1082/F30']);
    expect(c.input.links.slice(0, 2)).toEqual(project.links);
    expect(c.input.links.slice(2)).toEqual([
      { pred: 'PO-1082/F10', succ: 'PO-1082/F20', type: 'FS', lag: 0 },
      { pred: 'PO-1082/F20', succ: 'PO-1082/F30', type: 'FS', lag: 0 },
      { pred: 'PO-1082/F30', succ: 'A20', type: 'FS', lag: 0 },
    ]);
    expect(c.sources).toEqual({ 'PO-1082/F10': 'PO-1082', 'PO-1082/F20': 'PO-1082', 'PO-1082/F30': 'PO-1082' });
  });

  it('a tie to an activity no longer in the project is left out (and a schedule left without ties is not consolidated)', () => {
    const c = consolidateNetwork(project, [supplier({ ties: [{ supplier: 'F30', activity: 'A99', direction: 'to_project', lag: 0 }] })]);
    expect(c.input).toEqual({ ...project, activities: project.activities, links: project.links });
  });

  it('without supplier schedules the network and the CPM results are exactly the project’s', () => {
    const c = consolidateNetwork(project, []);
    expect(schedule(c.input)).toEqual(schedule(project));
  });

  it('dates propagate: the supplier delivery drives the reception, and a supplier slip moves the project finish', () => {
    const alone = schedule(project);
    expect(alone.activities.A20.start).toBe('2026-01-12');
    const on = schedule(consolidateNetwork(project, [supplier()]).input);
    // Delivery milestone on 26 Jan → A20 starts on 26 Jan (FS from a milestone dated at its boundary).
    expect(on.activities['PO-1082/F30'].start).toBe('2026-01-26');
    expect(on.activities.A20.start).toBe('2026-01-26');
    expect(on.projectFinish).toBe('2026-01-30');
    expect(on.activities.A20.drivingPredecessors).toEqual(['PO-1082/F30']);
    // Drawings approved 4 working days late: manufacturing and the delivery slip, A20 and A30 with them.
    const late = supplier();
    late.activities = late.activities.map((a) => (a.code === 'F10' ? { ...a, actualStart: '2026-01-05', actualFinish: '2026-01-15', pct: 100 } : a));
    const slipped = schedule(consolidateNetwork({ ...project, dataDate: '2026-01-16' }, [late]).input);
    expect(slipped.activities['PO-1082/F20'].start).toBe('2026-01-16');
    expect(slipped.activities['PO-1082/F30'].start).toBe('2026-01-30');
    expect(slipped.activities.A20.start).toBe('2026-01-30');
    expect(slipped.activities.A30.finish).toBe('2026-02-05');
    expect(slipped.criticalPath).toContain('PO-1082/F20');
  });

  it('a from-project tie: EPC2i’s approval drives the manufacturing', () => {
    const s = supplier({ ties: [{ supplier: 'F20', activity: 'A10', direction: 'from_project', lag: 2 }, { supplier: 'F30', activity: 'A30', direction: 'to_project', lag: 0 }] });
    const r = schedule(consolidateNetwork(project, [s]).input);
    // A10 finishes 9 Jan; FS+2 → 14 Jan (later than the committed 12 Jan).
    expect(r.activities['PO-1082/F20'].start).toBe('2026-01-14');
    expect(r.activities['PO-1082/F30'].start).toBe('2026-01-28');
    expect(r.activities.A30.start).toBe('2026-01-28');
  });
});

describe('loops and linking rules', () => {
  const ids = project.activities.map((a) => a.id);
  const pj = { ids, links: project.links };

  it('detects a loop through the project and a supplier schedule', () => {
    const s = supplier({ ties: [{ supplier: 'F30', activity: 'A10', direction: 'to_project', lag: 0 }, { supplier: 'F10', activity: 'A20', direction: 'from_project', lag: 0 }] });
    expect(supplierNetworkCycle(ids, project.links, [s])).not.toBeNull();
    expect(supplierNetworkCycle(ids, project.links, [supplier()])).toBeNull();
  });

  it('refuses a tie that would close a loop', () => {
    const r = checkSupplierTie(supplier(), { supplier: 'F10', activity: 'A30', direction: 'from_project', lag: '0' }, pj, []);
    expect(r).toMatchObject({ ok: false, error: 'cycle' });
    expect((r as { cycle: string[] }).cycle.length).toBeGreaterThan(1);
  });

  it('checks a tie: known ends, direction, lag, duplicate', () => {
    const s = supplier();
    expect(checkSupplierTie(s, { supplier: 'F30', activity: 'A30', direction: 'to_project', lag: '3' }, pj, [])).toEqual({ ok: true, value: { supplier: 'F30', activity: 'A30', direction: 'to_project', lag: 3 } });
    expect(checkSupplierTie(s, { supplier: 'F99', activity: 'A30', direction: 'to_project', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'unknown' });
    expect(checkSupplierTie(s, { supplier: 'F30', activity: 'A99', direction: 'to_project', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'unknown' });
    expect(checkSupplierTie(s, { supplier: 'F30', activity: 'A30', direction: 'sideways', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'direction' });
    expect(checkSupplierTie(s, { supplier: 'F30', activity: 'A30', direction: 'to_project', lag: '1000' }, pj, [])).toEqual({ ok: false, error: 'lag' });
    expect(checkSupplierTie(s, { supplier: 'F30', activity: 'A20', direction: 'to_project', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'duplicate' });
  });

  it('checks a link inside a schedule: known ends, self, type, duplicate, loop', () => {
    const s = supplier();
    expect(checkSupplierLink(s, { pred: 'F10', succ: 'F30', type: 'SS', lag: '-2' }, pj, [])).toEqual({ ok: true, value: { pred: 'F10', succ: 'F30', type: 'SS', lag: -2 } });
    expect(checkSupplierLink(s, { pred: 'F10', succ: 'F10', type: 'FS', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'self' });
    expect(checkSupplierLink(s, { pred: 'F10', succ: 'X', type: 'FS', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'unknown' });
    expect(checkSupplierLink(s, { pred: 'F10', succ: 'F30', type: 'XX', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'linkType' });
    expect(checkSupplierLink(s, { pred: 'F10', succ: 'F20', type: 'FS', lag: 0 }, pj, [])).toEqual({ ok: false, error: 'duplicate' });
    expect(checkSupplierLink(s, { pred: 'F30', succ: 'F10', type: 'FS', lag: 0 }, pj, [])).toMatchObject({ ok: false, error: 'cycle' });
  });

  it('the default tie source is the last activity', () => {
    expect(lastSupplierActivity(supplier())).toBe('F30');
    expect(lastSupplierActivity({ activities: [] })).toBeNull();
  });
});

describe('validation', () => {
  it('parses an activity plan', () => {
    expect(parseSupplierActivity({ code: ' f10 ', name: 'FAT', duration: '3', committedStart: '2026-01-05', committedFinish: '' })).toEqual({
      ok: true, value: { code: 'F10', name: 'FAT', duration: 3, committedStart: '2026-01-05', committedFinish: null },
    });
    expect(parseSupplierActivity({ code: 'F/1', name: 'x', duration: 1 })).toEqual({ ok: false, error: 'code' });
    expect(parseSupplierActivity({ code: 'F1', name: '', duration: 1 })).toEqual({ ok: false, error: 'name' });
    expect(parseSupplierActivity({ code: 'F1', name: 'x', duration: '1.5' })).toEqual({ ok: false, error: 'duration' });
    expect(parseSupplierActivity({ code: 'F1', name: 'x', duration: 1, committedStart: '2026-02-30' })).toEqual({ ok: false, error: 'date' });
    expect(parseSupplierActivity({ code: 'F1', name: 'x', duration: 1, committedStart: '2026-02-03', committedFinish: '2026-02-02' })).toEqual({ ok: false, error: 'committed' });
  });

  it('parses progress: finish makes it complete, started needs a start, no future actuals', () => {
    const today = '2026-01-20';
    expect(parseSupplierProgress({ actualStart: '2026-01-05', actualFinish: '2026-01-09', pct: '20' }, today)).toEqual({ ok: true, value: { actualStart: '2026-01-05', actualFinish: '2026-01-09', pct: 100 } });
    expect(parseSupplierProgress({ actualStart: '2026-01-05', pct: '40' }, today)).toEqual({ ok: true, value: { actualStart: '2026-01-05', actualFinish: null, pct: 40 } });
    expect(parseSupplierProgress({ pct: '' }, today)).toEqual({ ok: true, value: { actualStart: null, actualFinish: null, pct: 0 } });
    expect(parseSupplierProgress({ pct: '40' }, today)).toEqual({ ok: false, error: 'pctWithoutStart' });
    expect(parseSupplierProgress({ actualStart: '2026-01-05', pct: '100' }, today)).toEqual({ ok: false, error: 'doneWithoutFinish' });
    expect(parseSupplierProgress({ actualFinish: '2026-01-09' }, today)).toEqual({ ok: false, error: 'actualFinishWithoutStart' });
    expect(parseSupplierProgress({ actualStart: '2026-01-09', actualFinish: '2026-01-05' }, today)).toEqual({ ok: false, error: 'actualOrder' });
    expect(parseSupplierProgress({ actualStart: '2026-01-21' }, today)).toEqual({ ok: false, error: 'actualFuture' });
    expect(parseSupplierProgress({ pct: '101' }, today)).toEqual({ ok: false, error: 'pct' });
  });
});

describe('forecast and slips', () => {
  const ctx = { dataDate: '2026-01-05', projectCalendar: 'mf', calendars, today: '2026-01-05' };

  it('on time: forecast = committed, no slip', () => {
    const f = supplierForecast(supplier(), ctx);
    expect(f).toMatchObject({ ok: true, finish: '2026-01-26', slip: 0, late: false });
    if (!f.ok) throw new Error();
    expect(f.activities.F20).toMatchObject({ start: '2026-01-12', finish: '2026-01-23', finishSlip: 0, startSlip: 0, late: false, state: 'not_started' });
  });

  it('a late actual finish makes the rest slip, in working days', () => {
    const s = supplier();
    s.activities = s.activities.map((a) => (a.code === 'F10' ? { ...a, actualStart: '2026-01-05', actualFinish: '2026-01-15', pct: 100 } : a));
    const f = supplierForecast(s, { ...ctx, dataDate: '2026-01-16', today: '2026-01-16' });
    if (!f.ok) throw new Error();
    expect(f.activities.F10).toMatchObject({ finishSlip: 4, late: true, state: 'complete' });
    expect(f.activities.F20).toMatchObject({ start: '2026-01-16', finish: '2026-01-29', finishSlip: 4, late: true });
    expect(f).toMatchObject({ finish: '2026-01-30', slip: 4, late: true });
  });

  it('not started by its committed start is late; ahead of the commitment is not', () => {
    const f = supplierForecast(supplier(), { ...ctx, dataDate: '2026-01-07', today: '2026-01-07' });
    if (!f.ok) throw new Error();
    expect(f.activities.F10).toMatchObject({ start: '2026-01-07', finishSlip: 2, late: true });
    const early = supplier();
    early.activities = early.activities.map((a) => (a.code === 'F10' ? { ...a, actualStart: '2026-01-05', actualFinish: '2026-01-07', pct: 100 } : a));
    const e = supplierForecast(early, { ...ctx, dataDate: '2026-01-08', today: '2026-01-08' });
    if (!e.ok) throw new Error();
    expect(e.activities.F10).toMatchObject({ finishSlip: -2, late: false });
    // The SNET of the committed start holds manufacturing to 12 Jan.
    expect(e.activities.F20).toMatchObject({ start: '2026-01-12', finishSlip: 0, late: false });
  });

  it('an empty schedule and a looping one', () => {
    expect(supplierForecast({ po: 'PO-1', activities: [], links: [], ties: [] }, ctx)).toEqual({ ok: true, activities: {}, finish: null, slip: 0, late: false });
    const loop = supplier({ links: [...supplier().links, { pred: 'F30', succ: 'F10', type: 'FS', lag: 0 }] });
    expect(supplierForecast(loop, ctx)).toMatchObject({ ok: false });
  });
});
