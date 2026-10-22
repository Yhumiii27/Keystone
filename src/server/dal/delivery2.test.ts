// Delivery 2 database layer — golden reads: an in-memory PGlite migrated from ./drizzle and seeded from the
// prototype; the DAL getters reproduce the prototype constants (RISKS_HLT, HLT_CRS_X, HLT_SNAPS, CONTINGENCY,
// PEOPLE, REQUESTS, TODOS…, NOTIFS, ACTIVITY, AUDIT) and the KPI figures quoted by the screen specs.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { dayOffsetOfIso, dowOfIso, isoOfDayOffset, riskCategory, riskResponse, riskStatus, stepDecision } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { PROTO } from '@/server/prototype';
import { getChangeControl } from './changes';
import { getContingency } from './contingency';
import { getHoursReconciliation, getLeaveCalendar, getRateCard, getSkillsMatrix, listPublicHolidays } from './hr';
import { countUnreadNotifications, listActivity, listAudit, listNotifications } from './notifications';
import { getDepartmentApprovals, listApprovalDepartments, listPendingForcedStageChanges, listRequestActivities, listResourceRequests } from './requests';
import { getLaborCost, getProjectTeam, getResourcePool, getWhatIf, listDepartments } from './resources';
import { getRiskRegister, listRisks } from './risks';
import { getTask, listTasks } from './tasks';
import { getTrends } from './trends';

const P = PROTO;
/** The prototype's 8 weeks (the seeded allocation weeks): the golden comparisons pass them explicitly (R-085). */
const PROTO_WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('risk register (07 §2.1)', () => {
  it('reproduces RISKS_HLT', async () => {
    const rows = (await listRisks('HLT-026')).map((r) => ({
      id: r.id, title: r.title, cat: riskCategory.label(r.category), p: r.probability, i: r.impact, owner: r.owner, resp: riskResponse.label(r.response),
      plan: r.plan, act: r.activity?.code ?? '', emv: r.emv, trig: r.trigger, status: riskStatus.label(r.status), trend: r.trend,
    }));
    expect(rows).toEqual(P.RISKS_HLT);
  });

  it('HLT-026 KPIs: 7 open · 5 critical/high · €340k = 227 % of €150k · 2 on critical path · 2 trending up', async () => {
    const reg = (await getRiskRegister('HLT-026'))!;
    const open = reg.risks.filter((r) => r.status === 'open');
    expect(open.length).toBe(7);
    expect(reg.risks.length - open.length).toBe(1);
    expect(open.filter((r) => r.score >= 8).length).toBe(5);
    expect(reg.openEmv).toBe(340);
    expect(reg.contingency).toBe(150);
    expect(Math.round((reg.openEmv / reg.contingency!) * 100)).toBe(227);
    expect(open.filter((r) => r.activity && r.activity.totalFloat != null && r.activity.totalFloat <= 0).length).toBe(2);
    expect(open.filter((r) => r.trend === 'up').length).toBe(2);
    const r03 = reg.risks.find((r) => r.id === 'R-03')!;
    expect([r03.levelLabel, r03.score, r03.costIfOccurs, r03.activity?.name]).toEqual(['Critical', 16, 150, 'Steel erection — Bays 3–4']);
    expect(reg.risks.find((r) => r.id === 'R-05')!.costIfOccurs).toBeNull();
    expect(reg.categories.filter((c) => c.count).map((c) => c.label)).toEqual(P.SETTINGS0.riskCats);
  });

  it('generated registers of the other projects with data; none without data', async () => {
    const ndc = await listRisks('NDC-031');
    expect(ndc.map((r) => [r.id, r.emv, r.ownerShort, r.activity])).toEqual([
      ['R-01', 53, 'S. Perrin', null], ['R-02', 26, 'S. Perrin', null], ['R-03', 20, 'S. Perrin', null], ['R-04', 16, 'S. Perrin', null],
    ]);
    expect((await listRisks('WSA-044')).map((r) => r.emv)).toEqual([85, 43, 32, 26]);
    expect(await listRisks('EWA-051')).toEqual([]);
    expect((await getRiskRegister('EWA-051'))?.contingency).toBeNull();
  });
});

describe('change control (07 §2.2)', () => {
  it('register = HLT_CRS_X + CR-005 (11 §7 #2), chain and WBS names', async () => {
    const cc = (await getChangeControl('HLT-026'))!;
    expect(cc.changeRequests.map((c) => c.id)).toEqual(['CR-004', 'CR-006', 'CR-007', 'CR-008', 'CR-009', 'CR-005']);
    const x = cc.changeRequests.slice(0, 5).map((c) => ({
      id: c.id, title: c.title, types: c.types, amt: c.amount, days: c.days, wbs: c.wbs.map((w) => w.code), status: c.statusLabel, by: c.by, date: c.date,
      chain: Object.fromEntries(c.chain.map((s) => [s.step, stepDecision.label(s.decision!)])), bl: c.baseline,
    }));
    expect(x).toEqual(P.HLT_CRS_X);
    const cr8 = cc.changeRequests.find((c) => c.id === 'CR-008')!;
    expect(cr8.typesLabel).toBe('Budget · Schedule');
    expect(cr8.wbs).toEqual([{ code: '1.4', name: 'Steel structure', amount: null }]);
    expect(cr8.chain.map((s) => [s.label, s.approver])).toEqual([
      ['Project manager', 'Romain Aubert'], ['Portfolio director', 'Marie Lefebvre'], ['Client / sponsor', 'Nadia Bensaïd'], ['Change control board', 'Marie Lefebvre'],
    ]);
    expect(cc.changeRequests.find((c) => c.id === 'CR-005')!.chain.every((s) => s.decision === null)).toBe(true);
  });

  it('KPIs: +€200k approved (BL1 €4.60M → BAC €4.80M) · +€85k pending · 2 schedule CRs, net 27 d', async () => {
    const cc = (await getChangeControl('HLT-026'))!;
    const crs = cc.changeRequests;
    expect(crs.filter((c) => c.status === 'approved').reduce((a, c) => a + c.amount, 0)).toBe(200);
    expect(crs.filter((c) => c.status === 'in_review').reduce((a, c) => a + c.amount, 0)).toBe(85);
    expect(crs.filter((c) => c.types.includes('schedule')).length).toBe(2);
    expect(crs.filter((c) => c.status !== 'rejected').reduce((a, c) => a + c.days, 0)).toBe(27);
    expect([cc.originalBudget, cc.bac, cc.contingency]).toEqual([4600, 4800, 150]);
    expect(cc.baselines.map((b) => [b.code, b.name, b.setOn, b.bac, b.finish, b.stateLabel])).toEqual(P.BASELINES);
  });

  it('other projects start empty', async () => {
    expect((await getChangeControl('NDC-031'))!.changeRequests).toEqual([]);
  });
});

describe('trends (04 §2)', () => {
  it('HLT-026 reproduces HLT_SNAPS, SNAP_WEEKS and SNAP_DATES; next report 2 Oct', async () => {
    const t = (await getTrends('HLT-026'))!;
    expect(t.series).toEqual(P.HLT_SNAPS);
    expect(t.snapshots.map((s) => s.week)).toEqual(P.SNAP_WEEKS);
    expect(t.snapshots.map((s) => s.dateText)).toEqual(['3 Jul', '10 Jul', '17 Jul', '24 Jul', '31 Jul', '7 Aug', '14 Aug', '21 Aug', '28 Aug', '4 Sep', '11 Sep', '18 Sep', '25 Sep']);
    expect(t.nextReport).toEqual({ date: '2026-10-02', text: '2 Oct' });
    const s = t.series;
    expect([(s.cpi[12] - s.cpi[8]).toFixed(2), s.eac[12] - s.eac[0], s.float[12] - s.float[0]]).toEqual(['-0.01', 386, -31]);
    expect([t.bac, t.contingency]).toEqual([4800, 150]);
  });

  it('generated series for the other projects with data (logic 4558)', async () => {
    const ndc = (await getTrends('NDC-031'))!.series;
    expect([ndc.cpi[0], ndc.cpi[12], ndc.spi[12], ndc.eac[0], ndc.eac[12], ndc.float[0], ndc.float[12], ndc.risk[6], ndc.slip[12]]).toEqual([1.02, 1.05, 1.335, 2100, 2000, 16, -4, 75, 4]);
    const rcf = (await getTrends('RCF-019'))!.series;
    expect([rcf.cpi[0], rcf.cpi[12], rcf.eac[12], rcf.float[0], rcf.slip[12]]).toEqual([0.955, 0.915, 1476, 0, 29]);
    expect(await getTrends('EWA-051')).toBeNull();
  });
});

describe('contingency (04 §5)', () => {
  it('HLT-026: €150k · drawn €48k (32 %) · remaining €102k · exposure €340k', async () => {
    const c = (await getContingency('HLT-026'))!;
    // Delivery 7 (R-073): project progress computed from the activities (63 %, was the seeded 64 %).
    expect([c.initial, c.drawn, c.remaining, c.exposure, c.isDefault, Math.round((c.drawn / c.initial) * 100), Math.round(c.progress * 100)]).toEqual([150, 48, 102, 340, false, 32, 63]);
    expect(c.draws.map((d) => [d.dateText, d.amount, d.reason, d.linkRef, d.approvedBy])).toEqual(P.CONTINGENCY['HLT-026'].draws);
    expect(c.draws.map((d) => d.linkType)).toEqual(['change_request', 'risk', 'ncr']);
  });

  // Delivery 7 (A-8: one contingency figure): a project without a register takes its budget's contingency line (NDC-031: 100,
  // as the Budget and the Risk register show it — was round(BAC × 3 %) = 63); round(BAC × 3 %) stays for a project without one.
  it('provision without a register: the budget\'s contingency line, else round(BAC × 3 %)', async () => {
    const c = (await getContingency('NDC-031'))!;
    expect([c.initial, c.isDefault, c.draws.length, c.exposure]).toEqual([100, true, 0, 115]);
    expect((await getContingency('EWA-051'))!.initial).toBe(66);
  });
});

describe('resources (06 §1, 05 §4)', () => {
  it('pool = PEOPLE; weekly loads from the schedules (R-084)', async () => {
    const pool = await getResourcePool(PROTO_WEEKS);
    expect(pool.weeks.map((w) => w.label)).toEqual(['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9', 'Nov 16']);
    expect(pool.people.map((p) => [p.name, p.jobTitle])).toEqual((P.PEOPLE as [string, string, number[]][]).map(([n, j]) => [n, j]));
    expect(pool.people.map((p) => p.department)).toEqual(pool.people.map((p) => P.DEPT_OF[p.name]));
    // R-084 (owner answer 17 Oct 2026, third round): the loads are the hours the schedules assign (40 h = 100 %), no longer the
    // prototype's PEOPLE percentages (seeded in `allocations`, kept but not read: 83 % utilisation, 3 people above 110 %). The
    // demo data set names the eight people of the pool since the owner's answer of 18 Oct 2026 (src/server/db/seed/demo-assignments.ts,
    // fitted to PEOPLE): 83 % utilisation and 3 people above 110 % again.
    expect(pool.people.map((p) => [p.name, p.loads.join(',')])).toEqual([
      // R-084 (absences): each week on the person's capacity, 40 h less 8 h per seeded leave day (a week entirely off with hours
      // assigned: 100 % + their share of 40 h). Before: Amélie 131,106 · Julien 65 · Pauline 79,102 · Thomas 75,56 · Léa 71,81 ·
      // Hélène 76 · Fabien 35,44.
      ['Amélie Ollivier', '100,100,231,206,106,106,85,81'], ['Julien Wagner', '100,106,125,125,108,88,81,81'], ['Pauline Noguès', '197,108,81,113,113,202,105,81'],
      ['Thomas Kerbrat', '56,88,110,75,175,156,20,10'], ['Léa Marchand', '73,89,75,75,75,81,65,102'], ['Damien Roux', '99,86,96,90,81,94,66,75'],
      ['Hélène Sauvage', '44,48,64,127,90,101,76,100'], ['Fabien Bertrand', '99,95,81,56,56,49,175,144'],
    ]);
    // R-084 (absences): the leave weeks raise the mean (83 % before) and put three more people above 110 % (their leave weeks).
    expect(Math.round(pool.people.reduce((a, p) => a + p.avg, 0) / pool.people.length)).toBe(98);
    expect(pool.people.filter((p) => p.max > 110).map((p) => p.name)).toEqual(['Amélie Ollivier', 'Julien Wagner', 'Pauline Noguès', 'Thomas Kerbrat', 'Hélène Sauvage', 'Fabien Bertrand']);
  });

  it('departments with heads and ROLES capacity; project teams; labour cost', async () => {
    const d = await listDepartments();
    expect(d.map((x) => [x.name, x.head?.name, x.headTitle])).toEqual(Object.entries(P.DEPTS as Record<string, [string, string]>).map(([n, [h, t]]) => [n, h, t]));
    // R-084: the capacity is ROLES' (stored, pro rata of the weeks); the demand is computed from the schedules — the department's
    // people's assigned hours + the work no named person carries counted by trade (ROLES' demand: 1110, 690, 510, 560, 370 h) —
    // with the named demo assignments (18 Oct 2026) the only unnamed work left is HLT-026 A1410 (owner only, MEP).
    const roles = d.filter((x) => x.capacityH != null).sort((a, b) => a.capacityPosition! - b.capacityPosition!);
    expect(roles.map((x) => [x.name, x.capacityH])).toEqual((P.ROLES as [string, number, number][]).map(([n, c]) => [n, c]));
    expect(roles.map((x) => [x.name, x.demandH, x.unnamedH])).toEqual([
      ['Engineering', 327, 0], ['Site operations', 551, 0], ['MEP', 358, 50], ['Controls & planning', 742, 0], ['Quality', 217, 0],
    ]);
    expect((await listDepartments(['2026-09-21'])).filter((x) => x.capacityH != null).map((x) => x.capacityH)).toEqual([120, 80, 60, 40, 80]);
    expect((await getProjectTeam('NDC-031')).map((p) => p.name)).toEqual(['Pauline Noguès', 'Damien Roux', 'Léa Marchand', 'Fabien Bertrand']);
    expect((await getProjectTeam('HLT-026')).length).toBe(10); // R-041 (P-2): + the 2 seeded referents (was 8)
    expect(await getLaborCost('HLT-026')).toEqual({ name: 'Labor', budget: 1850, actual: 1420 });
    expect((await getLaborCost('ERP-202'))?.name).toBe('Internal staff');
  });

  it('what-if: levers derived from the data (chapter 4, S-7), scenarios A/B, the KPIs from data', async () => {
    const w = (await getWhatIf('HLT-026'))!;
    // S-7: the prototype's static LEVERS / AUTO are replaced by levers derived from the plan — on HLT-026, A1250 (Julien Wagner
    // 8 h/d, steel crew 6 × 10 h/d) and, since the named demo assignments (owner answer 18 Oct 2026), the activities its people
    // work on: 23 levers; seed scenario A (contractor + overtime) and B (delay + move) map onto them. R-084: the loads are the
    // schedules' — Julien Wagner is above 100 % again: relief lever.
    expect(w.levers).toHaveLength(23);
    expect(w.levers.slice(0, 3).map((l) => l.code)).toEqual(['extra_resource:A1250:julien-wagner', 'overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew']);
    // R-084 (absences): one more people lever (15 before), the leave weeks putting more people above 100 %.
    expect([w.autoLevers.date.length, w.autoLevers.budget.length, w.autoLevers.people.length]).toEqual([6, 7, 16]);
    expect(w.scenarios.map((s) => [s.name, s.priority, Object.keys(s.levers).filter((k) => s.levers[k]).length])).toEqual([['A', 'date', 18], ['B', 'people', 5]]); // R-084 (absences): 17 / 6 before
    // R-085 (R-7 a): the horizon is the current load window, 21 Sep – 9 Nov 2026 on the demo date (was the seeded 28 Sep –
    // 16 Nov). R-084 + named demo assignments: peak 131 % (Amélie Ollivier, week of 12 Oct; 130 % on 12 Oct and
    // [0, 0, 1, 2, 3, 2, 0, 1] on the seeded rows).
    expect(w.weeks.map((x) => x.start)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect([w.forecastFinish, w.floatDays, w.baselineFinish, w.peak, w.overByWeek]).toEqual([
      // R-084 (absences): Amélie Ollivier's CP week of 12 Oct (capacity 0, 52 h assigned) → 231 % (131 % before); people above
      // 110 % per week [1, 0, 2, 3, 3, 3, 3, 1] before.
      '2027-01-14', -27, '2026-12-18', { pct: 231, person: 'Amélie Ollivier', weekStart: '2026-10-12' }, [1, 1, 2, 3, 4, 4, 4, 2],
    ]);
    // S-7: any project with a plan has a what-if (NDC-031: 11 levers relieving its people since the named demo assignments); a
    // project without activities has none.
    expect((await getWhatIf('NDC-031'))?.levers).toHaveLength(13); // R-084 (absences): 11 before (leave weeks over 100 %)
    expect(await getWhatIf('EWA-051')).toBeNull();
  });
});

describe('resource requests and approvals (08 §5–7)', () => {
  it('reproduces REQUESTS', async () => {
    const rows = (await listResourceRequests()).map((r) => ({
      id: r.id, pm: r.requestedBy, project: r.projectShort, person: r.resource, dept: r.department, title: r.title, act: r.activity?.code, hours: r.hours,
      start: r.startDay, due: r.dueDay, prio: r.priority, status: r.status, sent: r.sentText, note: r.note, response: r.response,
      propStart: r.proposedStartDay, propDue: r.proposedDueDay, todoId: r.taskId,
    }));
    expect(rows).toEqual(P.REQUESTS);
  });

  it('PM outbox (R. Aubert) and the Engineering queue', async () => {
    const mine = await listResourceRequests({ requestedBy: 'Romain Aubert' });
    expect(mine.length).toBe(9);
    const pending = mine.filter((r) => r.status === 'pending');
    expect([pending.length, pending.reduce((a, r) => a + r.hours, 0), mine.filter((r) => r.status === 'reschedule').length, mine.filter((r) => r.status === 'approved').length]).toEqual([4, 64, 1, 3]);
    const eng = (await getDepartmentApprovals('Engineering'))!;
    expect(eng.head?.name).toBe('Marion Kerviel');
    expect(eng.pending.map((r) => r.id)).toEqual(['RQ-043', 'RQ-041']);
    expect(eng.pending.reduce((a, r) => a + r.hours, 0)).toBe(52);
    expect(eng.pendingHoursByPerson).toEqual({ 'Julien Wagner': 12 });
    expect((await listApprovalDepartments()).map((d) => [d.name, d.pending])).toEqual([
      ['Engineering', 2], ['Site operations', 0], ['MEP', 0], ['Quality', 1], ['Controls & planning', 1],
    ]);
    const rq40 = mine.find((r) => r.id === 'RQ-040')!;
    expect(rq40.events).toEqual([
      { action: 'sent', date: '2026-09-23', by: 'Romain Aubert', note: rq40.note },
      { action: 'approved', date: '2026-09-24', by: 'Ines Duarte', note: null },
    ]);
    expect(mine.find((r) => r.id === 'RQ-043')!.contractRole).toBe('Contract structural engineer');
    expect(mine.find((r) => r.id === 'RQ-041')!.activity).toMatchObject({ code: 'A1250', critical: true });
    expect(await listPendingForcedStageChanges()).toEqual([]);
    expect((await listRequestActivities('HLT-026')).map((a) => a.code)).toEqual(P.NR_ACTS);
    expect((await listRequestActivities('HLT-026'))[0].label).toBe('A1250 · Steel erection — Bays 3–4');
    expect((await listRequestActivities('NDC-031')).length).toBeGreaterThan(0);
  });
});

describe('tasks (10 §6–7)', () => {
  it('reproduces TODOS', async () => {
    const rows = (await listTasks()).map((t) => ({
      id: t.id, person: t.assignee, title: t.title, project: t.project.short, act: t.activity?.code, status: t.status, prio: t.priority,
      start: t.startDay, due: t.dueDay, est: t.estimateH, logged: t.loggedH, cl: [t.checklist.done, t.checklist.total], labels: t.labels, pct: t.pct,
    }));
    expect(rows).toEqual(P.TODOS);
  });

  it("Hélène Sauvage's My work KPIs: 2 due today · 1 overdue · 2 next week · 15.0 h logged", async () => {
    const mine = await listTasks({ person: 'Hélène Sauvage' });
    const open = mine.filter((t) => t.status !== 'done');
    expect(open.filter((t) => t.dueDay === 4).length).toBe(2);
    expect(open.filter((t) => t.dueDay! < 4).length).toBe(1);
    expect(open.filter((t) => t.dueDay! > 4 && t.dueDay! <= 9).length).toBe(2);
    expect(mine.filter((t) => t.startDay! <= 4).reduce((a, t) => a + t.loggedH, 0).toFixed(1)).toBe('15.0');
    expect([...new Set(mine.map((t) => t.project.shortName))]).toEqual(['Harbor Line', 'Clinique Pasteur Lyon']);
  });

  it('task sheet T-2314: description, checklist, comments, files, entries, cost valuation', async () => {
    const t = (await getTask('T-2314'))!;
    expect(t.description).toBe(P.DESC['T-2314']);
    expect(t.checklistItems.map((i) => [i.text, i.done ? 1 : 0])).toEqual(P.CHECKS['T-2314']);
    expect(t.comments.map((c) => [c.author, c.when, c.text])).toEqual(P.COMMENTS['T-2314']);
    expect(t.attachments.map((f) => [f.name, f.meta, f.icon])).toEqual(P.FILES['T-2314']);
    expect(t.entries.map((e) => [e.dateText, e.hours, e.note])).toEqual(P.ENTRIES['T-2314']);
    // A-10 (R-083): the hours are valued at Hélène Sauvage's grid role "QA / QC" on each entry's date (60 €/h) — the prototype's
    // job-title rate (RATES "QA / QC" 95 €/h) is retired: 6 h → 360 € (was 570 €).
    expect([t.costNote, t.activity?.code, t.activity?.wbs, t.activity?.packageName, t.priorityLabel, t.statusLabel]).toEqual([
      { cost: 360, rate: 60, missing: false, todayRate: 60 }, 'A1250', '1.4', 'Steel structure', 'High', 'In progress',
    ]);
    expect((await getTask('T-2305'))!.attachments.map((f) => [f.name, f.meta, f.icon])).toEqual(P.FILES['T-2305']);
    expect((await getTask('T-2290'))!.checklist).toEqual({ done: 2, total: 2 });
    expect(await getTask('T-9999')).toBeNull();
  });
});

describe('HR (06 §2–5)', () => {
  it('rate card: RATE_ROLES, MULTS (R-083: first versions from 1 Jan 2026); average internal 72,33 €/h; contractor premium +39 %', async () => {
    const rc = await getRateCard();
    expect(rc.roles.map((r) => [r.role, r.baseRateEur])).toEqual(P.RATE_ROLES);
    expect(rc.multipliers.map((m) => [m.key, m.label, m.factor])).toEqual(P.MULTS);
    const internal = rc.roles.filter((r) => !r.isExternal);
    expect((internal.reduce((a, r) => a + r.baseRateEur!, 0) / internal.length).toFixed(2)).toBe('72.33');
    const rate = (n: string) => rc.roles.find((r) => r.role === n)!.baseRateEur!;
    expect(Math.round((rate('Contractor — structural (external)') / rate('Structural engineer') - 1) * 100)).toBe(39);
    // R-083 (A-10): one dated grid — every rate and factor since 1 Jan 2026; the legacy job-title rates (RATES) are retired.
    expect([...new Set([...rc.roles, ...rc.multipliers].map((r) => r.effectiveFrom))]).toEqual(['2026-01-01']);
    expect((await getRateCard('2025-12-31')).roles.every((r) => r.baseRateEur === null)).toBe(true);
  });

  it('skills matrix: SKILL_LV, CERTS; 8 single-expert skills', async () => {
    const m = await getSkillsMatrix();
    expect(m.skills.map((s) => s.name)).toEqual(P.SKILLS);
    expect(Object.fromEntries(m.people.map((p) => [p.name, p.levels]))).toEqual(P.SKILL_LV);
    expect(Object.fromEntries(m.people.filter((p) => p.certText).map((p) => [p.name, p.certText]))).toEqual(P.CERTS);
    const experts = m.skills.map((_, i) => m.people.filter((p) => p.levels[i] >= 4).length);
    expect(experts.filter((e) => e < 2).length).toBe(8);
  });

  it('leave calendar: LEAVE, LEAVE_DAYS, HOLIDAYS; 43 leave days, 85 % availability', async () => {
    // The prototype's weeks, explicitly (R-084: without weeks, the current window — it was the seeded allocation weeks).
    const lc = await getLeaveCalendar('FR', PROTO_WEEKS);
    // NEW-CURSUS-4 (R-031, R-173): two simple types instead of LEAVE_DAYS' CP / RTT / Sick / Training; the prototype's weeks
    // keep their days, CP and RTT as Leave, Sick and Training as Absence (the reason is not kept).
    const SIMPLE: Record<string, string> = { CP: 'Leave', RTT: 'Leave', Sick: 'Absence', Training: 'Absence' };
    expect(lc.leaveTypes.map((t) => [t.code, t.label, t.days])).toEqual([['leave', 'Leave', 5], ['absence', 'Absence', 5]]);
    expect(Object.fromEntries(lc.holidays.map((h) => [h.weekIndex, h.label]))).toEqual(P.HOLIDAYS);
    expect(Object.fromEntries(lc.people.map((p) => [p.name, Object.fromEntries(p.weeks.flatMap((w, i) => (w.typeLabel ? [[String(i), w.typeLabel]] : [])))])))
      .toEqual(Object.fromEntries(Object.entries(P.LEAVE as Record<string, Record<string, string>>).map(([n, ws]) => [n, Object.fromEntries(Object.entries(ws).map(([i, l]) => [i, SIMPLE[l]]))])));
    expect(lc.lastAbsenceReceivedAt).toBeNull();
    const avail = lc.people.map((p) => Math.round((p.weeks.reduce((a, w) => a + Math.max(0, 5 - w.days - w.holidays) * 7, 0) / (lc.weeks.length * 35)) * 100));
    expect(avail).toEqual([73, 95, 78, 73, 93, 98, 93, 75]);
    expect(lc.people.reduce((a, p) => a + p.weeks.reduce((b, w) => b + w.days, 0), 0)).toBe(43);
    expect(Math.round(avail.reduce((a, b) => a + b, 0) / avail.length)).toBe(85);
    expect((await listPublicHolidays()).map((h) => h.label)).toEqual(P.SETTINGS0.holidays);
  });

  it('hours: HOURS reproduced; 779 h declared · 740 h planned · +12 h · 27 h to assign', async () => {
    const h = (await getHoursReconciliation('HLT-026'))!;
    const proto = P.HOURS['HLT-026'];
    expect([h.importedText, h.analyticCode, h.periodLabel]).toEqual([proto.imported, proto.code, 'September 2026']);
    expect(h.lines.map((l) => [l.person, l.wbsLabel, l.plannedH, l.declaredH])).toEqual(proto.lines);
    expect(h.unassigned.map((u) => [u.person, u.hours, u.reason])).toEqual(proto.unassigned);
    const declared = h.lines.reduce((a, l) => a + l.declaredH, 0);
    const planned = h.lines.reduce((a, l) => a + l.plannedH, 0);
    const un = h.unassigned.reduce((a, u) => a + u.hours, 0);
    expect([declared + un, planned, declared - planned, un]).toEqual([779, 740, 12, 27]);
    expect(h.byResource.map((g) => [g.label, g.plannedH, g.declaredH])).toEqual([
      ['Julien Wagner', 280, 303], ['Amélie Ollivier', 100, 90], ['Thomas Kerbrat', 96, 88], ['Pauline Noguès', 110, 97], ['Hélène Sauvage', 100, 115], ['Damien Roux', 30, 28], ['Léa Marchand', 24, 31],
    ]);
    expect(h.byWorkPackage.map((g) => [g.label, g.plannedH, g.declaredH])).toEqual([
      ['1.3 · Foundations', 160, 184], ['1.4 · Steel structure', 220, 234], ['1.2 · Site preparation', 80, 76], ['1.7 · Paving & yard', 20, 14],
      ['1.5 · Crane installation', 96, 88], ['1.6 · MEP systems', 110, 97], ['1.1 · Design & permits', 54, 59],
    ]);
    expect(h.byWorkPackage[0].sub).toBe('J. Wagner · H. Sauvage');
    expect(h.workPackages.map((w) => w.label)[7]).toBe('1.8 · Commissioning & handover');
    expect(await getHoursReconciliation('NDC-031')).toBeNull();
  });
});

describe('notifications, activity, audit (01 §5.5, 10 §2)', () => {
  it('per-role notifications reproduce NOTIFS; unread director 3 · pm 4 · depthead 1 · member 2 · others 1', async () => {
    const roles = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
    const byId = new Map<string, { row: unknown[]; audience: string[] }>();
    for (const role of roles)
      for (const n of await listNotifications(role)) {
        const e = byId.get(n.id) ?? { row: [n.id, n.kind, n.title, n.sub, n.when, n.read, n.screen, n.params], audience: [] };
        e.audience.push(role);
        byId.set(n.id, e);
      }
    const got = (P.NOTIFS as unknown[][]).map((n) => {
      const e = byId.get(n[0] as string)!;
      return [...e.row, e.audience.sort()];
    });
    expect(got).toEqual((P.NOTIFS as unknown[][]).map((n) => [...n.slice(0, 8), [...(n[8] as string[])].sort()]));
    const unread = await Promise.all(['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'].map(countUnreadNotifications));
    expect(unread).toEqual([3, 4, 1, 2, 1, 1, 1, 1]);
    expect((await listNotifications('director'))[0]).toMatchObject({ id: 'n1', icon: 'ph ph-seal-check', when: '25 Sep 09:12', projectCode: 'HLT-026' });
  });

  it('activity feed = ACTIVITY (newest first; 6 events on 25–26 Sep); audit trail = AUDIT', async () => {
    const act = await listActivity();
    expect(act.map((a) => [a.when, a.who, a.what, a.kind])).toEqual(P.ACTIVITY);
    expect(act.filter((a) => /^2[56] Sep/.test(a.when)).length).toBe(6);
    expect((await listActivity({ kind: 'stock' })).length).toBe(2);
    expect((await listAudit()).map((a) => [a.when, a.who, a.object, a.change, a.area])).toEqual(P.AUDIT);
  });
});

describe('day offsets', () => {
  it('round-trips the prototype working-day axis', () => {
    // R-167: negative offsets land on working days before Mon 21 Sep 2026, as the prototype's dayDate does.
    for (let o = -40; o < 40; o++) {
      const iso = isoOfDayOffset(o);
      expect(dayOffsetOfIso(iso)).toBe(o);
      expect(dowOfIso(iso)).toBeGreaterThanOrEqual(1);
      expect(dowOfIso(iso)).toBeLessThanOrEqual(5);
    }
    expect(isoOfDayOffset(-1)).toBe('2026-09-18');
    expect(isoOfDayOffset(-5)).toBe('2026-09-14');
    expect(isoOfDayOffset(-6)).toBe('2026-09-11');
    expect(isoOfDayOffset(4)).toBe('2026-09-25');
    expect(isoOfDayOffset(15)).toBe('2026-10-12');
    expect(dayOffsetOfIso('2026-09-26')).toBeNull();
  });
});
