// Golden values reproduced from the prototype's own logic (design lines 4108–4157: chips, reqKpis, apprKpis, team,
// reqRow impact/stepper/reschedule, nr routing) run on REQUESTS, PEOPLE, DEPT_OF, DEPTS and ROLES — docs/spec/08
// §5.4, §6.4 and 01 §12.
import { describe, expect, it } from 'vitest';
import PROTO from '@/server/prototype/prototype-data.json';
import { addDaysIso, isoOfDayOffset } from '@/server/db/codes';
import {
  AVG_RESPONSE_DEPARTMENT, AVG_RESPONSE_PM, CONTRACT_ROLE, NR_DEFAULTS, REQUEST_FILTERS, addedLoad, approvalKpis, approveTarget, datesText,
  defaultDepartment, deptOfSlug, deptSlug, isRequestFilter, loadAt, matchesFilter, nrDates, parseHours, pendingHoursByPerson, projectsText,
  requestChipCounts, requestImpact, requestKpis, requestSteps, requestTitle, routing, shiftedDates, teamLoad, weekIndex, weekLabel,
  type PoolFacts, type RequestFacts, type RequestStatus,
} from './requests';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = PROTO as any;
type ProtoReq = { id: string; pm: string; project: string; person: string; dept: string; hours: number; start: number; due: number; status: RequestStatus; propStart: number | null; propDue: number | null };

const named = (n: string) => (P.PEOPLE as [string][]).some((p) => p[0] === n);
const REQS: (RequestFacts & { pm: string })[] = (P.REQUESTS as ProtoReq[]).map((r) => ({
  id: r.id, pm: r.pm, status: r.status, hours: r.hours, person: named(r.person) ? r.person : null, department: r.dept,
  start: isoOfDayOffset(r.start), due: isoOfDayOffset(r.due),
}));
const POOL: PoolFacts[] = (P.PEOPLE as [string, string, number[]][]).map(([name, , loads]) => ({ name, department: P.DEPT_OF[name] ?? null, loads }));
const WEEKS = Array.from({ length: 8 }, (_, i) => addDaysIso('2026-09-28', 7 * i));
const DEPTS = Object.entries(P.DEPTS as Record<string, [string, string]>).map(([name, [head]]) => ({ name, head }));
const CAP = Object.fromEntries((P.ROLES as [string, number, number][]).map(([d, c, m]) => [d, { capacityH: c, demandH: m }]));
const mine = REQS.filter((r) => r.pm === 'R. Aubert');

describe('Resource requests (PM outbox, 08 §5.4)', () => {
  it('chips: All 9 · Pending 4 · Reschedule proposed 1 · Approved 3 · Rejected / withdrawn 1', () => {
    expect(REQUEST_FILTERS.map((f) => f.label)).toEqual(['All', 'Pending', 'Reschedule proposed', 'Approved', 'Rejected / withdrawn']);
    expect(requestChipCounts(mine)).toEqual([9, 4, 1, 3, 1]);
    expect(mine.filter((r) => matchesFilter(r.status, 'rejected')).map((r) => r.id)).toEqual(['RQ-037']);
    expect(matchesFilter('withdrawn', 'rejected')).toBe(true);
    expect(matchesFilter('withdrawn', null)).toBe(true);
    expect(matchesFilter('pending', 'approved')).toBe(false);
    expect([isRequestFilter('reschedule'), isRequestFilter('withdrawn'), isRequestFilter(null)]).toEqual([true, false, false]);
  });

  it('KPIs: 9 sent · 4 awaiting review (64 h) · 1 needs your answer · 3 approved · avg response 1.4 d', () => {
    expect(requestKpis(mine)).toEqual({ sent: 9, pending: 4, pendingHours: 64, reschedule: 1, approved: 3 });
    expect(AVG_RESPONSE_PM).toBe('1.4 d');
    expect(projectsText(['Harbor Line', 'Harbor Line'])).toBe('Harbor Line');
    expect(projectsText(['Harbor Line', 'Riverside'])).toBe('2 projects');
    expect(projectsText([])).toBe('');
  });

  it('rows: dates, proposed dates, stepper', () => {
    const rq38 = (P.REQUESTS as ProtoReq[]).find((r) => r.id === 'RQ-038')!;
    expect(datesText(isoOfDayOffset(rq38.start), isoOfDayOffset(rq38.due))).toBe('30 Sep – 6 Oct');
    expect(datesText(isoOfDayOffset(rq38.propStart!), isoOfDayOffset(rq38.propDue!))).toBe('12 Oct – 16 Oct');
    expect(datesText(isoOfDayOffset(5), isoOfDayOffset(6))).toBe('28 Sep – 29 Sep');
    expect(requestSteps('pending')).toEqual([true, false, false]);
    expect(requestSteps('reschedule')).toEqual([true, true, false]);
    expect(requestSteps('approved')).toEqual([true, true, true]);
    expect(requestSteps('rejected')).toEqual([true, true, false]);
  });
});

describe('Approvals (department head, 08 §6.4)', () => {
  const dept = (d: string) => REQS.filter((r) => r.department === d);
  const pend = pendingHoursByPerson(REQS);

  it('department chips: pending badges Engineering 2 · Site operations 0 · MEP 0 · Quality 1 · Controls & planning 1', () => {
    expect(DEPTS.map((d) => [d.name, dept(d.name).filter((r) => r.status === 'pending').length])).toEqual([
      ['Engineering', 2], ['Site operations', 0], ['MEP', 0], ['Quality', 1], ['Controls & planning', 1],
    ]);
    expect(DEPTS.map((d) => deptSlug(d.name))).toEqual(['engineering', 'site-operations', 'mep', 'quality', 'controls-planning']);
    expect(deptOfSlug(DEPTS, 'Controls-Planning')?.name).toBe('Controls & planning');
    expect(deptOfSlug(DEPTS, 'nope')).toBeNull();
  });

  it('Engineering KPIs: 2 pending (52 h) · team load 90 % (1 person) · 960 h vs committed 1110 h · 0 decided · 0.9 d', () => {
    const team = teamLoad(POOL, 'Engineering', pend);
    expect(team).toEqual([{ name: 'Julien Wagner', w1: 90, w2: 100, pending: 12 }]);
    expect(approvalKpis(dept('Engineering'), team, CAP.Engineering)).toEqual({
      pending: 2, pendingHours: 52, teamLoad: 90, teamSize: 1, capacityH: 960, committedH: 1110, decided: 0, approved: 0, rejected: 0,
    });
    expect(AVG_RESPONSE_DEPARTMENT).toBe('0.9 d');
  });

  it('other departments: team load and decided counts', () => {
    const k = (d: string) => approvalKpis(dept(d), teamLoad(POOL, d, pend), CAP[d]);
    expect(k('Site operations')).toMatchObject({ pending: 0, teamLoad: 80, teamSize: 2, decided: 2, approved: 1, rejected: 1, capacityH: 640, committedH: 690 });
    expect(k('Controls & planning')).toMatchObject({ pending: 1, pendingHours: 4, teamLoad: 87, teamSize: 3, decided: 2, approved: 2, rejected: 0, committedH: 560 });
    expect(k('MEP')).toMatchObject({ pending: 0, teamLoad: 80, teamSize: 1, decided: 1, approved: 0 });
    expect(k('Quality')).toMatchObject({ pending: 1, pendingHours: 8, teamLoad: 40, teamSize: 1, decided: 1, approved: 1 });
    expect(teamLoad(POOL, 'Site operations', pend).map((p) => [p.name, p.w1, p.w2, p.pending])).toEqual([
      ['Amélie Ollivier', 100, 110, 0], ['Thomas Kerbrat', 60, 100, 0],
    ]);
    expect(pend).toEqual({ 'Fabien Bertrand': 4, 'Hélène Sauvage': 8, 'Julien Wagner': 12 });
  });

  it('impact: Julien 90 % w/c 28 Sep → 120 % (over 110) · contract hire · Hélène 40 → 60', () => {
    const rq41 = REQS.find((r) => r.id === 'RQ-041')!;
    expect(requestImpact(rq41, POOL, WEEKS)).toEqual({ first: 'Julien', load: 90, after: 120, over: true });
    expect(weekLabel(rq41.start)).toBe('w/c 28 Sep');
    expect(requestImpact(REQS.find((r) => r.id === 'RQ-043')!, POOL, WEEKS)).toBeNull();
    expect(requestImpact(REQS.find((r) => r.id === 'RQ-042')!, POOL, WEEKS)).toEqual({ first: 'Hélène', load: 40, after: 60, over: false });
    // RQ-038 starts Wed 30 Sep (offset 7) → week index 0; RQ-035 starts Fri 25 Sep (offset 4) → clamped to week 0, labelled w/c 21 Sep.
    const rq38 = REQS.find((r) => r.id === 'RQ-038')!;
    expect(requestImpact(rq38, POOL, WEEKS)).toEqual({ first: 'Pauline', load: 80, after: 120, over: true });
    expect(weekLabel(REQS.find((r) => r.id === 'RQ-035')!.start)).toBe('w/c 21 Sep');
    expect(weekIndex(WEEKS, '2026-09-25')).toBe(0);
    expect(weekIndex(WEEKS, '2026-10-12')).toBe(2);
    expect(weekIndex(WEEKS, '2027-03-01')).toBe(7);
    expect(weekIndex([], '2026-10-12')).toBeNull();
    expect(addedLoad(4)).toBe(10);
    expect(addedLoad(40)).toBe(100);
  });

  it('decisions: reschedule +1/+2/+3 weeks, approve target, default department', () => {
    const rq41 = REQS.find((r) => r.id === 'RQ-041')!;
    const s1 = shiftedDates(rq41.start, rq41.due, 1);
    expect(datesText(s1.start, s1.due)).toBe('5 Oct – 7 Oct');
    const s3 = shiftedDates(rq41.start, rq41.due, 3);
    expect(datesText(s3.start, s3.due)).toBe('19 Oct – 21 Oct');
    expect([approveTarget('Julien Wagner'), approveTarget(null)]).toEqual(['Julien', 'procurement']);
    expect(defaultDepartment(DEPTS, { name: 'Marion Kerviel', department: 'Engineering' })).toBe('Engineering');
    expect(defaultDepartment(DEPTS, { name: 'Gabriel Comte', department: 'Quality' })).toBe('Quality');
    expect(defaultDepartment(DEPTS, { name: 'Fabien Bertrand', department: 'Controls & planning' })).toBe('Controls & planning');
    expect(defaultDepartment(DEPTS, { name: 'Marie Lefebvre', department: null })).toBe('Engineering');
  });
});

describe('New resource request dialog (01 §12)', () => {
  it('defaults, weeks and durations: w/c 28 Sep + 1 week → 28 Sep – 2 Oct', () => {
    expect(NR_DEFAULTS).toEqual({ act: 'A1250', person: 'Julien Wagner', week: 5, dur: 4, hours: '8', prio: 'med' });
    expect([5, 10, 15].map((w) => weekLabel(nrDates(w, 0).start))).toEqual(['w/c 28 Sep', 'w/c 5 Oct', 'w/c 12 Oct']);
    const d = nrDates(5, 4);
    expect(d).toEqual({ start: '2026-09-28', due: '2026-10-02' });
    expect(datesText(nrDates(10, 9).start, nrDates(10, 9).due)).toBe('5 Oct – 16 Oct');
    expect(datesText(nrDates(15, 1).start, nrDates(15, 1).due)).toBe('12 Oct – 13 Oct');
  });

  it('routing: Marion Kerviel (Engineering) · Julien at 90 % · contract hire → Engineering, no load', () => {
    expect(routing('Julien Wagner', nrDates(5, 4).start, POOL, WEEKS, DEPTS)).toEqual({ head: 'Marion Kerviel', department: 'Engineering', first: 'Julien', load: 90 });
    expect(routing('Julien Wagner', nrDates(15, 4).start, POOL, WEEKS, DEPTS)).toMatchObject({ load: 130 });
    expect(routing('Pauline Noguès', nrDates(10, 4).start, POOL, WEEKS, DEPTS)).toEqual({ head: 'Sophie Renard', department: 'MEP', first: 'Pauline', load: 90 });
    expect(routing(CONTRACT_ROLE, nrDates(5, 4).start, POOL, WEEKS, DEPTS)).toEqual({ head: 'Marion Kerviel', department: 'Engineering', first: null, load: null });
    expect(loadAt(POOL, WEEKS, null, '2026-09-28')).toBeNull();
  });

  it('hours and title parsing (no validation in the prototype)', () => {
    expect([parseHours('8'), parseHours('12.5'), parseHours('12,5'), parseHours(''), parseHours('abc'), parseHours('-4'), parseHours('5000')]).toEqual([8, 12.5, 12.5, 8, 8, 8, 999]);
    expect([requestTitle('  '), requestTitle(' Weld check ')]).toEqual(['Untitled request', 'Weld check']);
  });
});
