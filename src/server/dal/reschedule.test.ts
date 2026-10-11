// Chapter 4 planning writers on a seeded in-memory database (S-1, S-3, S-5, S-8, A-7): "Reschedule" of HLT-026 — every value
// it changes against the prototype's static data is pinned here (the documentation of the change) — the roll-ups it writes
// for the Schedule screen and the portfolio, "a second run changes nothing", the Baseline chip, relationships and cycles.
import { beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { scheduleView } from '@/domain/schedule-gantt';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, activityLinks, activityEvents, auditEntries, projects, scheduleRuns } from '@/server/db/schema';
import { createBaselineSnapshot } from './baselines';
import { addActivityLink, getPlanData, removeActivityLink, updateActivity } from './plan';
import { getScheduleControl, listScheduleSummaries } from './planning';
import { getScheduleData, rescheduleProject, showProjectBaseline } from './schedule';

const DIRECTOR = 'Marie Lefebvre';
const CODES = ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'WSA-044', 'MSR-012'];

/** Plan rows of HLT-026 as [id, start, finish, BL finish, var, TF, FF, violated, driving]. */
async function planTable(code = 'HLT-026') {
  const d = (await getPlanData(code))!;
  return d.activities.map((a) => [
    a.id, `${a.start}${a.startActual ? ' A' : ''}`, `${a.finish}${a.finishActual ? ' A' : ''}`, a.baselineFinish, a.variance, a.totalFloat, a.freeFloat ?? null,
    a.violated, (a.drivingPreds ?? []).join(','),
  ]);
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('before any user action the seed is the prototype (S-1 manual recalculation)', () => {
  it('Schedule keeps the seeded bars and header', async () => {
    const d = (await getScheduleData('HLT-026'))!;
    expect(d.rolledUp).toBe(false);
    expect([d.header.finishText, d.header.floatText, d.header.critText, d.bars[3].forecastEnd]).toEqual(['14 Jan 2027', '−27 days', '4 of 8 packages critical', 9.8]);
  });
});

describe('Reschedule HLT-026 at the data date 25 Sep 2026', () => {
  let result: Awaited<ReturnType<typeof rescheduleProject>>;
  beforeAll(async () => {
    result = await rescheduleProject('HLT-026', DIRECTOR);
  });

  it('toast figures: new finish and the 11 activities that changed', () => {
    expect(result).toEqual({
      ok: true, dataDate: '2026-09-25', finishDate: '2027-01-18', previousFinishDate: '2027-01-14', critical: 6, violations: 1, projectFloat: -19,
      changed: ['A1250', 'A1260', 'A1320', 'A1330', 'A1410', 'A1420', 'A1430', 'A1510', 'A1520', 'A1610', 'A1620'],
    });
  });

  // Every value the CPM changes vs the prototype's static ACTS (HACTS, docs/spec/05 §2.6):
  // - remaining work is dated on the Standard 5d · 8h calendar with French public holidays (S-2), from the data date;
  // - "BL finish" stays BL1, "Var" and floats become WORKING days (S-8; the prototype mixed calendar days);
  // - critical = total float ≤ 0 (S-1); driving predecessors come from the engine.
  it('activity dates, variances, floats, violations and driving links (documented changes)', async () => {
    expect(await planTable()).toEqual([
      // id      start          finish            BL finish  var  TF    FF    viol   driving       prototype (start → finish · var · TF)
      ['A1010', '05 Jan A', '06 Mar A', '06 Mar', 0, null, null, false, ''], //  unchanged
      ['A1020', '09 Mar A', '24 Apr A', '17 Apr', -5, null, null, false, ''], // var −7 calendar days
      ['A1110', '27 Apr A', '08 May A', '01 May', -4, null, null, false, ''], // var −7
      ['A1120', '11 May A', '12 Jun A', '05 Jun', -5, null, null, false, ''], // var −7
      ['A1130', '01 Jun A', '10 Jul A', '26 Jun', -10, null, null, false, ''], // var −14
      ['A1210', '22 Jun A', '17 Jul A', '10 Jul', -4, null, null, false, ''], // var −7 (14 Jul off)
      ['A1220', '13 Jul A', '07 Aug A', '31 Jul', -5, null, null, false, ''], // var −7
      ['A1230', '18 May A', '14 Aug A', '31 Jul', -10, null, null, false, ''], // var −14
      ['A1240', '20 Jul A', '28 Aug A', '14 Aug', -10, null, null, false, ''], // var −14
      ['A1250', '17 Aug A', '09 Oct', '31 Aug', -29, -19, 0, false, ''], //       var −39 · TF −27
      ['A1260', '05 Oct', '06 Nov', '25 Sep', -30, -19, 0, false, 'A1250'], //    var −42 · TF −27
      ['A1310', '03 Aug A', '28 Aug A', '21 Aug', -5, null, null, false, ''], // var −7
      ['A1320', '12 Oct', '30 Oct', '11 Sep', -35, 1, 0, false, 'A1250'], //      var −49 · TF +20
      ['A1330', '02 Nov', '23 Nov', '02 Oct', -35, 1, 20, false, 'A1320'], //     finish 20 Nov (11 Nov off) · var −49 · TF +20
      ['A1410', '17 Aug A', '20 Oct', '09 Oct', -7, 61, 61, false, ''], //        finish 23 Oct (18 d remaining at 55 %) · var −14 · TF +28
      ['A1420', '19 Oct', '07 Dec', '13 Nov', -16, -9, 10, false, 'A1250'], //    finish 04 Dec · var −21 · TF +10 → now critical
      ['A1430', '09 Nov', '21 Dec', '20 Nov', -21, -19, 0, false, 'A1260'], //    finish 18 Dec · var −28 · TF −27
      ['A1510', '21 Sep A', '20 Oct', '16 Oct', -2, 9, 8, false, ''], //          finish 16 Oct · var 0 · TF +22
      ['A1520', '02 Nov', '07 Dec', '20 Nov', -11, 1, 20, false, 'A1320'], //     finish 04 Dec · var −14 · TF +22
      ['A1610', '22 Dec', '06 Jan ’27', '04 Dec', -21, -19, 0, false, 'A1430'], // 21 Dec → 04 Jan (25 Dec off) · var −31 · TF −27
      ['A1620', '07 Jan ’27', '18 Jan ’27', '18 Dec', -19, -19, 0, true, 'A1610'], // 05 → 14 Jan (1 Jan off) · var −27 · TF −27 · FNLT 18 Dec missed by 19 d
    ]);
  });

  it('project header: finish 18 Jan 2027, float −19 working days, 3 critical packages (prototype 14 Jan 2027, −27 days, 4 of 8)', async () => {
    expect(await getScheduleControl('HLT-026')).toMatchObject({
      tNow: 8.8, floatDays: -19, finishText: '18 Jan 2027', baselineText: '18 Dec 2026', floatText: '−19 days', floatShort: '−19 d',
      critText: '3 of 8 packages critical', milesText: '2 of 6', milesSub: 'Complete · 0 on baseline date', baselineSet: '12 Mar 2026',
    });
    const d = (await getPlanData('HLT-026'))!;
    expect(d.root).toMatchObject({ start: '05 Jan', finish: '18 Jan ’27', baselineFinish: '18 Dec', totalFloat: -19 });
  });

  it('Schedule screen: bars and milestones are WBS roll-ups (A-7), slips in working days (S-8)', async () => {
    const d = (await getScheduleData('HLT-026'))!;
    expect(d.rolledUp).toBe(true);
    const v = scheduleView(d);
    expect(v.tasks.map((x) => [x.name, x.owner, x.pctText, x.slipText, x.critical])).toEqual([
      ['Design & permits', 'R. Aubert', '100%', '+5d', false],
      ['Site preparation', 'A. Ollivier', '100%', '+10d', false],
      ['Foundations', 'J. Wagner', '100%', '+5d', false],
      ['Steel structure', 'J. Wagner', '82%', '+30d', true],
      ['Crane installation', 'T. Kerbrat', '29%', '+35d', false],
      ['MEP systems', 'P. Noguès', '22%', '+21d', true],
      ['Paving & yard', 'A. Ollivier', '4%', '+11d', false],
      ['Commissioning & handover', 'H. Sauvage', '0%', '+19d', true],
    ]);
    expect(v.tasks[3]).toMatchObject({ aL: '35.1%', aW: '43.3%', bL: '31.8%', bW: '36.2%' });
    expect(v.milestones.map((m) => [m.name, m.baseDate, m.fcDate, m.slipText, m.statusLabel])).toEqual([
      ['Permits approved', '17 Apr', '24 Apr', '+5d', 'Done'],
      ['Foundations complete', '31 Jul', '7 Aug', '+5d', 'Done'],
      ['Structure topped out', '25 Sep', '6 Nov', '+30d', 'Late'],
      ['Cranes operational', '2 Oct', '23 Nov', '+35d', 'Late'],
      ['Systems energised', '20 Nov', '21 Dec', '+21d', 'Late'],
      ['Handover', '18 Dec', '18 Jan ’27', '+19d', 'Late'],
    ]);
    // Delivery 7 (R-073, C-2a): SPI and % complete computed from the activities and the cost-loaded BL1 at the data date
    // (EV 3 006 / PV 3 663; budget-weighted 63 %), no longer the seeded series (0.90, 64 %, planned 71 %).
    expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['SPI', '0.82', 'Earning 82¢ of planned work per $1'],
      ['Complete', '63%', 'Planned 76% by today'],
      ['Forecast finish', '18 Jan 2027', 'Baseline 18 Dec 2026'],
      ['Critical path float', '−19 days', '3 of 8 packages critical'],
      ['Milestones', '2 of 6', 'Complete · 0 on baseline date'],
    ]);
  });

  it('portfolio screens read the persisted milestones and header', async () => {
    const s = (await listScheduleSummaries())['HLT-026'];
    expect([s.finishText, s.floatDays, s.milestones.map((m) => m.statusLabel)]).toEqual(['18 Jan 2027', -19, ['Done', 'Done', 'Late', 'Late', 'Late', 'Late']]);
  });

  it('a second run changes nothing', async () => {
    const before = await planTable();
    const again = await rescheduleProject('HLT-026', DIRECTOR);
    expect(again).toMatchObject({ ok: true, changed: [], finishDate: '2027-01-18', previousFinishDate: '2027-01-18' });
    expect(await planTable()).toEqual(before);
  });

  it('records the runs, the audit and the activity feed; does not set the "edited" mark', async () => {
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const runs = await db.select().from(scheduleRuns).where(eq(scheduleRuns.projectId, p.id)).orderBy(desc(scheduleRuns.ranAt));
    expect(runs.map((r) => [r.outcome, r.changedActivities, r.finishDate, r.ranByName])).toEqual([
      ['ok', 0, '2027-01-18', DIRECTOR], ['ok', 11, '2027-01-18', DIRECTOR],
    ]);
    const audit = await db.select().from(auditEntries).where(and(eq(auditEntries.projectId, p.id), eq(auditEntries.area, 'Planning')));
    expect(audit.some((a) => a.change === 'rescheduled at 2026-09-25 · finish 2027-01-18 · 11 activities changed')).toBe(true);
    const feed = await db.select().from(activityEvents).where(eq(activityEvents.projectId, p.id));
    expect(feed.some((e) => e.text === 'Rescheduled HLT-026 · finish 18 Jan 2027 · 11 activities changed')).toBe(true);
    expect((await getPlanData('HLT-026'))!.activities.some((a) => a.edited)).toBe(false);
  });

  it('the five other projects reschedule; a second run changes nothing', async () => {
    for (const code of CODES.slice(1)) {
      const r1 = await rescheduleProject(code, DIRECTOR);
      expect(r1.ok, code).toBe(true);
      const r2 = await rescheduleProject(code, DIRECTOR);
      expect(r2.ok && r2.changed, code).toEqual([]);
    }
  });
});

describe('Set baseline and the Baseline chip (S-3)', () => {
  it('BL3 snapshots the rescheduled dates; showing it zeroes the variances and moves the baseline geometry', async () => {
    expect(await createBaselineSnapshot('HLT-026', { actorName: DIRECTOR, comment: 'After the September reschedule' })).toEqual({ code: 'BL3', activityCount: 21 });
    await showProjectBaseline('HLT-026', 'BL3', DIRECTOR);
    const d = (await getPlanData('HLT-026'))!;
    expect(d.activities.every((a) => a.variance === 0)).toBe(true);
    expect(d.activities.find((a) => a.id === 'A1620')!.baselineFinish).toBe('18 Jan ’27');
    expect(d.root.baselineFinish).toBe('18 Jan ’27');
    expect(await getScheduleControl('HLT-026')).toMatchObject({ baselineText: '18 Jan 2027', baselineSet: '25 Sep 2026' });
    const v = scheduleView((await getScheduleData('HLT-026'))!);
    expect(v.tasks.every((x) => x.bL === x.aL && x.bW === x.aW && x.slipText === '—')).toBe(true);
    // No slip against BL3; due within 42 working days of the data date → At risk (A-7 rule).
    expect(v.milestones.map((m) => m.statusLabel)).toEqual(['Done', 'Done', 'At risk', 'At risk', 'On track', 'On track']);
  });

  it('back to BL1: working-day variances again', async () => {
    await showProjectBaseline('HLT-026', 'BL1', DIRECTOR);
    expect((await getPlanData('HLT-026'))!.activities.find((a) => a.id === 'A1250')!.variance).toBe(-29);
    await expect(showProjectBaseline('HLT-026', 'BL9', DIRECTOR)).rejects.toThrow('Unknown baseline BL9');
  });
});

describe('relationships (S-5) and circular logic', () => {
  it('refuses self links, duplicates, unknown activities and loops', async () => {
    expect(await addActivityLink('HLT-026', { pred: 'A1250', succ: 'A1250', type: 'FS', lag: 0 }, DIRECTOR)).toEqual({ error: 'self' });
    expect(await addActivityLink('HLT-026', { pred: 'A1250', succ: 'A1260', type: 'SS', lag: 0 }, DIRECTOR)).toEqual({ error: 'duplicate' });
    expect(await addActivityLink('HLT-026', { pred: 'A9999', succ: 'A1260', type: 'FS', lag: 0 }, DIRECTOR)).toEqual({ error: 'unknown' });
    expect(await addActivityLink('HLT-026', { pred: 'A1620', succ: 'A1250', type: 'FS', lag: 0 }, DIRECTOR)).toEqual({
      error: 'cycle', cycle: ['A1250', 'A1260', 'A1430', 'A1610', 'A1620', 'A1250'],
    });
  });

  it('adds then removes a link (end of the successor list); Reschedule follows the new logic', async () => {
    expect(await addActivityLink('HLT-026', { pred: 'A1520', succ: 'A1610', type: 'FS', lag: 15 }, DIRECTOR)).toEqual({ ok: true });
    const a1610 = (await getPlanData('HLT-026'))!.activities.find((a) => a.id === 'A1610')!;
    expect([a1610.preds, a1610.edited]).toEqual([[['A1430', 'FS', 0], ['A1420', 'FS', 0], ['A1330', 'FS', 0], ['A1520', 'FS', 15]], true]);
    const r = await rescheduleProject('HLT-026', DIRECTOR);
    expect(r.ok && r.finishDate).toBe('2027-01-25');
    expect(await removeActivityLink('HLT-026', 'A1520', 'A1610', DIRECTOR)).toEqual({ ok: true });
    expect(await removeActivityLink('HLT-026', 'A1520', 'A1610', DIRECTOR)).toEqual({ error: 'missing' });
    const back = await rescheduleProject('HLT-026', DIRECTOR);
    expect(back.ok && back.finishDate).toBe('2027-01-18');
  });

  it('a loop written behind the screens is refused by Reschedule, recorded, and nothing changes', async () => {
    const db = await getDb();
    const before = await planTable();
    const rows = await db
      .select({ id: activities.id, code: activities.code, p: activities.projectId })
      .from(activities)
      .innerJoin(projects, eq(projects.id, activities.projectId))
      .where(eq(projects.code, 'HLT-026'));
    const ids = Object.fromEntries(rows.map((a) => [a.code, a]));
    await db.insert(activityLinks).values({ projectId: ids.A1250.p, predecessorId: ids.A1610.id, successorId: ids.A1250.id, type: 'FS', lagDays: 0, position: 9 });
    expect(await rescheduleProject('HLT-026', DIRECTOR)).toEqual({ ok: false, reason: 'cycle', dataDate: '2026-09-25', cycle: ['A1250', 'A1260', 'A1430', 'A1610', 'A1250'] });
    expect(await planTable()).toEqual(before);
    const [run] = await db.select().from(scheduleRuns).orderBy(desc(scheduleRuns.ranAt)).limit(1);
    expect([run.outcome, run.message]).toEqual(['cycle', 'Circular logic: A1250 → A1260 → A1430 → A1610 → A1250']);
    await db.delete(activityLinks).where(and(eq(activityLinks.predecessorId, ids.A1610.id), eq(activityLinks.successorId, ids.A1250.id)));
  });
});

describe('progress implies actual dates at Reschedule', () => {
  it('A1320 at 50 % is started at the data date; back to 0 % it is not started again', async () => {
    await updateActivity('HLT-026', 'A1320', { pct: 50 });
    await rescheduleProject('HLT-026', DIRECTOR);
    let a = (await getPlanData('HLT-026'))!.activities.find((x) => x.id === 'A1320')!;
    expect([a.start, a.startActual, a.startDate]).toEqual(['25 Sep', true, '2026-09-25']);
    await updateActivity('HLT-026', 'A1320', { pct: 0 });
    await rescheduleProject('HLT-026', DIRECTOR);
    a = (await getPlanData('HLT-026'))!.activities.find((x) => x.id === 'A1320')!;
    expect([a.start, a.startActual, a.finish]).toEqual(['12 Oct', false, '30 Oct']);
  });

  it('a remaining duration stored by an import is replaced by a new % complete (correctness review)', async () => {
    const db = await getDb();
    const [row] = await db.select({ id: activities.id }).from(activities).where(eq(activities.code, 'A1250'));
    await db.update(activities).set({ remainingDays: 11 }).where(eq(activities.id, row.id));
    await rescheduleProject('HLT-026', DIRECTOR);
    expect((await getPlanData('HLT-026'))!.activities.find((x) => x.id === 'A1250')!.finish).toBe('09 Oct');
    await updateActivity('HLT-026', 'A1250', { pct: 95 });
    expect((await db.select({ r: activities.remainingDays }).from(activities).where(eq(activities.id, row.id)))[0].r).toBeNull();
    await rescheduleProject('HLT-026', DIRECTOR);
    // 95 % of the duration left → 2 working days from the data date (Fri 25 Sep): finish Mon 28 Sep.
    expect((await getPlanData('HLT-026'))!.activities.find((x) => x.id === 'A1250')!.finish).toBe('28 Sep');
  });
});
