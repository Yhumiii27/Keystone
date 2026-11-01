// R-206 — DCMA 14-point checks, critical path test, driving path and forensic slip analysis on hand-built networks.
import { describe, expect, it } from 'vitest';
import { WorkCalendar, type CalendarDef } from './calendar';
import { schedule, type CpmActivityInput, type CpmInput, type CpmLinkInput } from './cpm';
import { compareSchedules, slipAttribution } from './schedule-forensics';
import {
  DCMA_CHECK_IDS, DCMA_NA, DCMA_NOTES, DCMA_STANDARD, DCMA_THRESHOLD_FIELDS, dcmaAssessment, parseDcmaThreshold, usableDcmaThresholds,
  type DcmaCheck, type QualityActivity, type QualityInput, type QualityLink,
} from './schedule-quality';
import { CPT_DELAY_DAYS, criticalPathTest, drivingPathToFinish } from './schedule-quality-cpm';

// Mon–Fri without public holidays. 5 Jan 2026 is a Monday.
const MF: CalendarDef = { code: 'mf', name: 'Mon–Fri', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidaySet: null, useSettingsHolidays: false };
const cal = new WorkCalendar(MF);
const DATA_DATE = '2026-02-02'; // a Monday

const act = (id: string, extra: Partial<QualityActivity> = {}): QualityActivity => ({
  id, duration: 5, pct: 0, startActual: false, finishActual: false, startDate: '2026-02-02', finishDate: '2026-02-06', constraintType: null, totalFloat: 0,
  resourced: true, baselineFinish: null, ...extra,
});
const link = (pred: string, succ: string, type: QualityLink['type'] = 'FS', lag = 0): QualityLink => ({ pred, succ, type, lag });
const input = (activities: QualityActivity[], links: QualityLink[], extra: Partial<QualityInput> = {}): QualityInput => ({
  dataDate: DATA_DATE, activities, links, thresholds: { ...DCMA_STANDARD }, baseline: null, calendar: cal, cpt: null, ...extra,
});
const check = (r: ReturnType<typeof dcmaAssessment>, id: DcmaCheck['id']) => r.checks.find((c) => c.id === id)!;
const offenderIds = (c: DcmaCheck) => c.offenders.map((o) => (o.kind === 'activity' ? o.id : `${o.pred}>${o.succ}`));

/** A clean chain S → A → B → C → F (twenty activities in all keep the percentages readable). */
function chain(n: number): { acts: QualityActivity[]; links: QualityLink[] } {
  const acts = Array.from({ length: n }, (_, i) => act(`A${i + 1}`));
  const links = acts.slice(1).map((a, i) => link(acts[i].id, a.id));
  return { acts, links };
}

describe('thresholds', () => {
  it('the standard: 5 %, 0 leads, 90 % FS, 44 working days, 0.95 indexes', () => {
    expect(DCMA_STANDARD).toMatchObject({ logicPct: 5, leadsCount: 0, lagsPct: 5, fsMinPct: 90, hardConstraintsPct: 5, highFloatDays: 44, negativeFloatCount: 0, highDurationDays: 44, invalidDatesCount: 0, missedTasksPct: 5, cpliMin: 0.95, beiMin: 0.95 });
    expect(DCMA_THRESHOLD_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(DCMA_STANDARD).sort());
  });
  it('parses and bounds each value', () => {
    expect(parseDcmaThreshold('logicPct', '7,5')).toBe(7.5);
    expect(parseDcmaThreshold('logicPct', 101)).toBeNull();
    expect(parseDcmaThreshold('highFloatDays', '44.5')).toBeNull();
    expect(parseDcmaThreshold('highFloatDays', '0')).toBeNull();
    expect(parseDcmaThreshold('cpliMin', '0.9')).toBe(0.9);
    expect(parseDcmaThreshold('cpliMin', '-1')).toBeNull();
    expect(parseDcmaThreshold('leadsCount', 'abc')).toBeNull();
  });
  it('stored values over the standard, invalid ones ignored', () => {
    expect(usableDcmaThresholds(null)).toEqual(DCMA_STANDARD);
    expect(usableDcmaThresholds({ lagsPct: 10, beiMin: 7, junk: 1 })).toEqual({ ...DCMA_STANDARD, lagsPct: 10 });
  });
});

describe('a clean network passes the logic and relationship checks', () => {
  const { acts, links } = chain(20);
  const r = dcmaAssessment(input(acts, links));
  it('start and finish of the network are not gaps', () => {
    expect(check(r, 'logic')).toMatchObject({ status: 'pass', value: 0, count: 0, total: 20 });
    expect(check(r, 'leads')).toMatchObject({ status: 'pass', value: 0, total: 19 });
    expect(check(r, 'lags')).toMatchObject({ status: 'pass', value: 0 });
    expect(check(r, 'relationshipTypes')).toMatchObject({ status: 'pass', value: 100, count: 19 });
    expect(r.checks.map((c) => c.id)).toEqual([...DCMA_CHECK_IDS]);
    expect(r.checks.map((c) => c.number)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });
  it('without baseline and CPT, those checks are not applicable', () => {
    expect(check(r, 'missedTasks')).toMatchObject({ status: 'na', naReason: DCMA_NA.noBaseline });
    expect(check(r, 'bei')).toMatchObject({ status: 'na', naReason: DCMA_NA.noBaseline });
    expect(check(r, 'cpli')).toMatchObject({ status: 'na', naReason: DCMA_NA.noBaselineFinish });
    expect(check(r, 'criticalPathTest')).toMatchObject({ status: 'na', naReason: DCMA_NA.notRun });
    expect([r.passed, r.failed, r.notApplicable]).toEqual([10, 0, 4]);
  });
});

describe('logic, leads, lags and relationship types', () => {
  // 20 activities: A1→…→A18 chain, A19 dangling (no links), A20 has a predecessor but no successor (two open ends).
  const { acts, links } = chain(18);
  const all = [...acts, act('A19'), act('A20')];
  const rels = [...links, link('A3', 'A20')];
  // Two leads, one lag, three non-FS relationships.
  rels[0] = link('A1', 'A2', 'SS', -2);
  rels[1] = link('A2', 'A3', 'FS', -1);
  rels[2] = link('A3', 'A4', 'FF', 3);
  rels[3] = link('A4', 'A5', 'SF', 0);
  const r = dcmaAssessment(input(all, rels));
  it('missing logic: dangling and open-ended activities (the network has several ends)', () => {
    const c = check(r, 'logic');
    expect(offenderIds(c)).toEqual(['A1', 'A18', 'A19', 'A20']);
    expect(c.offenders.find((o) => o.kind === 'activity' && o.id === 'A19')).toMatchObject({ note: DCMA_NOTES.noLinks });
    expect(c).toMatchObject({ status: 'fail', value: 20, count: 4, total: 20 });
  });
  it('leads (count), lags (%), FS share (%)', () => {
    expect(check(r, 'leads')).toMatchObject({ status: 'fail', value: 2, total: 18 });
    expect(offenderIds(check(r, 'leads'))).toEqual(['A1>A2', 'A2>A3']);
    expect(check(r, 'lags')).toMatchObject({ status: 'fail', value: 5.6, count: 1, total: 18 });
    expect(check(r, 'relationshipTypes')).toMatchObject({ status: 'fail', value: 83.3, count: 15, total: 18, op: '≥', limit: 90 });
    expect(offenderIds(check(r, 'relationshipTypes'))).toEqual(['A1>A2', 'A3>A4', 'A4>A5']);
  });
  it('relationships into complete activities are not counted', () => {
    const done = all.map((a) => (['A2', 'A3', 'A4', 'A5'].includes(a.id) ? { ...a, pct: 100, finishActual: true, startActual: true, startDate: '2026-01-05', finishDate: '2026-01-09' } : a));
    const r2 = dcmaAssessment(input(done, rels));
    expect(check(r2, 'leads')).toMatchObject({ status: 'pass', value: 0, total: 14 });
    expect(check(r2, 'relationshipTypes')).toMatchObject({ status: 'pass', value: 100 });
  });
  it('an edited threshold changes the verdict', () => {
    const r3 = dcmaAssessment(input(all, rels, { thresholds: { ...DCMA_STANDARD, lagsPct: 6, leadsCount: 2, fsMinPct: 80, logicPct: 20 } }));
    expect(['logic', 'leads', 'lags', 'relationshipTypes'].map((id) => check(r3, id as DcmaCheck['id']).status)).toEqual(['pass', 'pass', 'pass', 'pass']);
  });
});

describe('constraints, float, duration, resources', () => {
  const { acts, links } = chain(10);
  acts[1] = { ...acts[1], constraintType: 'MSO' };
  acts[2] = { ...acts[2], constraintType: 'SNET' }; // soft
  acts[3] = { ...acts[3], constraintType: 'FNLT' };
  acts[4] = { ...acts[4], totalFloat: 45 };
  acts[5] = { ...acts[5], totalFloat: 44 }; // not above the limit
  acts[6] = { ...acts[6], totalFloat: -3 };
  acts[7] = { ...acts[7], duration: 60, resourced: false };
  acts[8] = { ...acts[8], duration: 0, resourced: false }; // a milestone needs no resource
  acts[9] = { ...acts[9], pct: 100, startActual: true, finishActual: true, constraintType: 'MFO', totalFloat: null, duration: 90, startDate: '2026-01-05', finishDate: '2026-01-30' };
  const r = dcmaAssessment(input(acts, links));
  it('hard constraints: MSO, MFO, SNLT, FNLT on incomplete activities', () => {
    expect(offenderIds(check(r, 'hardConstraints'))).toEqual(['A2', 'A4']);
    expect(check(r, 'hardConstraints')).toMatchObject({ status: 'fail', value: 22.2, count: 2, total: 9 });
  });
  it('high float (> 44 wd) and negative float', () => {
    expect(check(r, 'highFloat')).toMatchObject({ status: 'fail', value: 11.1, count: 1, limitDays: 44, offenders: [{ kind: 'activity', id: 'A5', value: 45 }] });
    expect(check(r, 'negativeFloat')).toMatchObject({ status: 'fail', value: 1, offenders: [{ kind: 'activity', id: 'A7', value: -3 }] });
  });
  it('high duration (> 44 wd) on incomplete activities only', () => {
    expect(check(r, 'highDuration')).toMatchObject({ status: 'fail', count: 1, offenders: [{ kind: 'activity', id: 'A8', value: 60 }] });
  });
  it('resources: incomplete activities with a duration', () => {
    expect(check(r, 'resources')).toMatchObject({ status: 'fail', value: 12.5, count: 1, total: 8 });
    expect(offenderIds(check(r, 'resources'))).toEqual(['A8']);
  });
});

describe('invalid dates', () => {
  it('forecast before the data date, actual after it', () => {
    const r = dcmaAssessment(input([
      act('N1', { startDate: '2026-01-26', finishDate: '2026-02-06' }), // not started, forecast start in the past
      act('P1', { pct: 40, startActual: true, startDate: '2026-01-19', finishDate: '2026-01-30' }), // in progress, forecast finish in the past
      act('P2', { pct: 10, startActual: true, startDate: '2026-02-09', finishDate: '2026-02-20' }), // actual start in the future
      act('C1', { pct: 100, startActual: true, finishActual: true, startDate: '2026-01-05', finishDate: '2026-02-03' }), // actual finish in the future
      act('OK1', { pct: 100, startActual: true, finishActual: true, startDate: '2026-01-05', finishDate: '2026-01-09' }),
      act('OK2', { startDate: '2026-02-02', finishDate: '2026-02-06' }),
    ], []));
    const c = check(r, 'invalidDates');
    expect(c).toMatchObject({ status: 'fail', value: 4 });
    expect(c.offenders).toEqual([
      { kind: 'activity', id: 'N1', note: DCMA_NOTES.startBeforeDataDate },
      { kind: 'activity', id: 'P1', note: DCMA_NOTES.finishBeforeDataDate },
      { kind: 'activity', id: 'P2', note: DCMA_NOTES.actualStartAfter },
      { kind: 'activity', id: 'C1', note: DCMA_NOTES.actualFinishAfter },
    ]);
  });
});

describe('missed activities, BEI and CPLI against the reference baseline', () => {
  const done = (id: string, finish: string, baselineFinish: string | null) =>
    act(id, { pct: 100, startActual: true, finishActual: true, startDate: '2026-01-05', finishDate: finish, baselineFinish, totalFloat: null });
  const acts = [
    done('D1', '2026-01-09', '2026-01-09'), // on time
    done('D2', '2026-01-23', '2026-01-16'), // late
    done('D3', '2026-01-30', null), // not in the baseline
    act('O1', { baselineFinish: '2026-01-30', finishDate: '2026-02-13' }), // due, not finished
    act('O2', { baselineFinish: '2026-03-06', finishDate: '2026-03-13' }), // not due yet
  ];
  const baseline = { code: 'BL1', finish: '2026-03-06', hasActivities: true };
  const r = dcmaAssessment(input(acts, [], { baseline }));
  it('missed: due by the data date and not finished on time', () => {
    const c = check(r, 'missedTasks');
    expect(c).toMatchObject({ status: 'fail', value: 66.7, count: 2, total: 3 });
    expect(c.offenders).toEqual([
      { kind: 'activity', id: 'D2', note: DCMA_NOTES.finishedLate },
      { kind: 'activity', id: 'O1', note: DCMA_NOTES.notFinished },
    ]);
  });
  it('BEI = completed / due = 3 / 3', () => {
    expect(check(r, 'bei')).toMatchObject({ status: 'pass', value: 1, count: 3, total: 3 });
  });
  it('CPLI = (CPL + TF) / CPL: 30 working days to 13 Mar, one week late on 6 Mar → 25 / 30', () => {
    // Data date Mon 2 Feb → forecast finish Fri 13 Mar = 6 weeks = 30 wd; baseline finish 6 Mar = 5 wd earlier.
    expect(check(r, 'cpli')).toMatchObject({ status: 'fail', value: 0.83, count: 25, total: 30 });
  });
  it('a baseline without snapshot leaves missed and BEI not applicable, CPLI still computed', () => {
    const r2 = dcmaAssessment(input(acts, [], { baseline: { ...baseline, hasActivities: false } }));
    expect(check(r2, 'missedTasks').status).toBe('na');
    expect(check(r2, 'bei').status).toBe('na');
    expect(check(r2, 'cpli').status).toBe('fail');
  });
});

// ── CPM-backed helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const A = (id: string, duration: number, extra: Partial<CpmActivityInput> = {}): CpmActivityInput => ({ id, duration, ...extra });
const L = (pred: string, succ: string, type: CpmLinkInput['type'] = 'FS', lag = 0): CpmLinkInput => ({ pred, succ, type, lag });
const net = (activities: CpmActivityInput[], links: CpmLinkInput[]): CpmInput => ({ dataDate: '2026-01-05', projectCalendar: 'mf', calendars: { mf: cal }, activities, links });

describe('critical path test', () => {
  it('a continuous critical path passes: the finish moves by the delay', () => {
    const r = criticalPathTest(net([A('A', 3), A('B', 2), A('C', 4), A('D', 2)], [L('A', 'B'), L('A', 'C'), L('B', 'D'), L('C', 'D')]));
    expect(r).toEqual({ kind: 'done', activity: 'A', delay: CPT_DELAY_DAYS, slip: CPT_DELAY_DAYS, tolerance: 6 });
    expect(check(dcmaAssessment(input([], [], { cpt: r })), 'criticalPathTest')).toMatchObject({ status: 'pass', value: 600, limit: 600 });
  });
  it('a broken path fails: a hard constraint holds the finish', () => {
    // C is held by "Must finish on": the delay on A does not reach the finish.
    const r = criticalPathTest(net([A('A', 3), A('C', 4, { constraint: { type: 'MFO', date: '2026-01-14' } })], [L('A', 'C')]));
    expect(r.kind).toBe('done');
    if (r.kind !== 'done') return;
    expect(r.slip).toBeLessThan(r.delay);
    expect(check(dcmaAssessment(input([], [], { cpt: r })), 'criticalPathTest').status).toBe('fail');
  });
  it('an activity in progress is delayed through its remaining duration', () => {
    const r = criticalPathTest(net([A('A', 10, { percentComplete: 50, actualStart: '2026-01-05' }), A('B', 2)], [L('A', 'B')]));
    expect(r).toMatchObject({ kind: 'done', activity: 'A', slip: 600 });
  });
  it('a logic loop fails the test with the loop listed', () => {
    const r = criticalPathTest(net([A('A', 1), A('B', 1)], [L('A', 'B'), L('B', 'A')]));
    expect(r.kind).toBe('cycle');
    const c = check(dcmaAssessment(input([], [], { cpt: r })), 'criticalPathTest');
    expect(c).toMatchObject({ status: 'fail', naReason: DCMA_NA.cycle });
    expect(offenderIds(c).sort()).toEqual(['A', 'B']);
  });
  it('nothing left to do: not applicable', () => {
    const r = criticalPathTest(net([A('A', 3, { actualStart: '2026-01-01', actualFinish: '2026-01-02' })], []));
    expect(r).toEqual({ kind: 'no_critical' });
  });
});

describe('driving path to the finish', () => {
  it('follows the driving predecessors back from the last finish', () => {
    const r = schedule(net([A('A', 3), A('B', 2), A('C', 4), A('D', 2)], [L('A', 'B'), L('A', 'C'), L('B', 'D'), L('C', 'D')]));
    expect(drivingPathToFinish(r)).toEqual(['A', 'C', 'D']);
  });
  it('keeps a complete predecessor that still drives, stops where the data date drives', () => {
    // A finished on Fri 2 Jan: B follows it on Mon 5 Jan, the data date — both drive B; A is on the path.
    const r = schedule(net([A('A', 3, { actualStart: '2025-12-29', actualFinish: '2026-01-02' }), A('B', 2), A('C', 1)], [L('A', 'B'), L('B', 'C')]));
    expect(drivingPathToFinish(r)).toEqual(['A', 'B', 'C']);
    // A finished before Christmas: only the data date drives B.
    const r2 = schedule(net([A('A', 3, { actualStart: '2025-12-15', actualFinish: '2025-12-17' }), A('B', 2), A('C', 1)], [L('A', 'B'), L('B', 'C')]));
    expect(drivingPathToFinish(r2)).toEqual(['B', 'C']);
  });
  it('[] when everything is complete', () => {
    expect(drivingPathToFinish(schedule(net([A('A', 1, { actualStart: '2026-01-01', actualFinish: '2026-01-01' })], [])))).toEqual([]);
  });
});

describe('forensic analysis', () => {
  // Reference: A 5–9 Jan, B 12–16 Jan, C 19–23 Jan. Current: A finished 2 days late, B started 1 more day late and took 2 more
  // days, C recovered 1 day.
  const ref = [
    { id: 'A', start: '2026-01-05', finish: '2026-01-09' },
    { id: 'B', start: '2026-01-12', finish: '2026-01-16' },
    { id: 'C', start: '2026-01-19', finish: '2026-01-23' },
    { id: 'X', start: '2026-01-05', finish: '2026-01-06' },
  ];
  const cur = [
    { id: 'A', start: '2026-01-05', finish: '2026-01-13' },
    { id: 'B', start: '2026-01-15', finish: '2026-01-23' },
    { id: 'C', start: '2026-01-26', finish: '2026-01-29' },
    { id: 'N', start: '2026-01-26', finish: '2026-01-27' },
  ];
  const cmp = compareSchedules(ref, cur, cal);
  it('per-activity variances in working days, added and removed activities', () => {
    expect(cmp.rows.map((r) => [r.id, r.startVar, r.finishVar, r.presence])).toEqual([
      ['A', 0, 2, 'both'], ['B', 3, 5, 'both'], ['C', 5, 4, 'both'], ['N', null, null, 'added'], ['X', null, null, 'removed'],
    ]);
    expect([cmp.refFinish, cmp.cmpFinish, cmp.finishSlip, cmp.later, cmp.earlier]).toEqual(['2026-01-23', '2026-01-29', 4, 3, 0]);
  });
  it('slip attribution along the driving path adds up to the finish slip', () => {
    const s = slipAttribution(['A', 'B', 'C'], cmp);
    expect(s.steps.map((x) => [x.id, x.lateStart, x.longerDuration, x.contribution])).toEqual([
      ['A', 0, 2, 2], ['B', 1, 2, 3], ['C', 0, -1, -1],
    ]);
    expect(s.total).toBe(4);
    expect(s.steps.reduce((t, x) => t + (x.contribution ?? 0), 0)).toBe(cmp.finishSlip);
    expect(s.drivers.map((x) => x.id)).toEqual(['B', 'A']);
  });
  it('an activity missing from the reference passes its slip on to the next known one', () => {
    const s = slipAttribution(['A', 'N', 'C'], cmp);
    expect(s.steps.map((x) => x.contribution)).toEqual([2, null, 2]);
    expect(s.total).toBe(4);
  });
});
