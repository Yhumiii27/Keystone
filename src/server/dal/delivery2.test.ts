// Delivery 2 database layer — golden reads: an in-memory PGlite migrated from ./drizzle and seeded from the
// prototype; the DAL getters reproduce the prototype constants (RISKS_HLT, HLT_CRS_X, HLT_SNAPS, CONTINGENCY,
// PEOPLE, REQUESTS, TODOS…, NOTIFS, ACTIVITY, AUDIT) and the KPI figures quoted by the screen specs.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { dayOffsetOfIso, isoOfDayOffset, riskCategory, riskResponse, riskStatus, stepDecision } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { PROTO } from '@/server/prototype';
import { getChangeControl } from './changes';
import { getContingency } from './contingency';
import { getHoursReconciliation, getJobTitleRates, getLeaveCalendar, getRateCard, getSkillsMatrix, listPublicHolidays } from './hr';
import { countUnreadNotifications, listActivity, listAudit, listNotifications } from './notifications';
import { getDepartmentApprovals, listApprovalDepartments, listPendingForcedStageChanges, listRequestActivities, listResourceRequests } from './requests';
import { getLaborCost, getProjectTeam, getResourcePool, getWhatIf, listDepartments } from './resources';
import { getRiskRegister, listRisks } from './risks';
import { getTask, listTasks } from './tasks';
import { getTrends } from './trends';

const P = PROTO;

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
      ['Project manager', 'Romain Aubert'], ['Portfolio director', 'Marie Lefebvre'], ['Client / sponsor', 'Nadia Bensaïd'], ['Change control board', 'Monthly · next 8 Oct'],
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
  it('pool = PEOPLE with weekly loads; KPIs 83 % utilisation, 3 over-allocated', async () => {
    const pool = await getResourcePool();
    expect(pool.weeks.map((w) => w.label)).toEqual(['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9', 'Nov 16']);
    expect(pool.people.map((p) => [p.name, p.jobTitle, p.loads])).toEqual(P.PEOPLE);
    expect(pool.people.map((p) => p.department)).toEqual(pool.people.map((p) => P.DEPT_OF[p.name]));
    expect(Math.round(pool.people.reduce((a, p) => a + p.avg, 0) / pool.people.length)).toBe(83);
    expect(pool.people.filter((p) => p.max > 110).length).toBe(3);
    expect(pool.people.map((p) => Math.round(p.avg))).toEqual([101, 99, 98, 65, 73, 87, 79, 64]);
  });

  it('departments with heads and ROLES capacity; project teams; labour cost', async () => {
    const d = await listDepartments();
    expect(d.map((x) => [x.name, x.head?.name, x.headTitle])).toEqual(Object.entries(P.DEPTS as Record<string, [string, string]>).map(([n, [h, t]]) => [n, h, t]));
    expect(d.filter((x) => x.capacityH != null).sort((a, b) => a.capacityPosition! - b.capacityPosition!).map((x) => [x.name, x.capacityH, x.demandH])).toEqual(P.ROLES);
    expect((await getProjectTeam('NDC-031')).map((p) => p.name)).toEqual(['Pauline Noguès', 'Damien Roux', 'Léa Marchand', 'Fabien Bertrand']);
    expect((await getProjectTeam('HLT-026')).length).toBe(8);
    expect(await getLaborCost('HLT-026')).toEqual({ name: 'Labor', budget: 1850, actual: 1420 });
    expect((await getLaborCost('ERP-202'))?.name).toBe('Internal staff');
  });

  it('what-if: levers derived from the data (chapter 4, S-7), scenarios A/B, the KPIs from data', async () => {
    const w = (await getWhatIf('HLT-026'))!;
    // S-7: the prototype's static LEVERS / AUTO are replaced by levers derived from the plan — on HLT-026 only A1250 carries
    // labour assignments (Julien Wagner 8 h/d, steel crew 6 × 10 h/d); seed scenario A (contractor + overtime) maps onto them.
    expect(w.levers.map((l) => l.code)).toEqual(['extra_resource:A1250:julien-wagner', 'overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew']);
    expect(w.autoLevers).toEqual({ date: ['overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew'], budget: [], people: ['extra_resource:A1250:julien-wagner'] });
    expect(w.scenarios.map((s) => [s.name, s.priority, Object.keys(s.levers).filter((k) => s.levers[k])])).toEqual([
      ['A', 'date', ['extra_resource:A1250:julien-wagner', 'overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew']],
      ['B', 'people', []],
    ]);
    expect([w.forecastFinish, w.floatDays, w.baselineFinish, w.peak, w.overByWeek]).toEqual([
      '2027-01-14', -27, '2026-12-18', { pct: 130, person: 'Julien Wagner', weekStart: '2026-10-12' }, [0, 1, 2, 3, 2, 0, 1, 0],
    ]);
    expect(Math.max(...w.overByWeek)).toBe(3);
    // S-7: any project with a plan has a what-if (no lever on NDC-031); a project without activities has none.
    expect((await getWhatIf('NDC-031'))?.levers).toEqual([]);
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

  it('task sheet T-2314: description, checklist, comments, files, entries, cost rate', async () => {
    const t = (await getTask('T-2314'))!;
    expect(t.description).toBe(P.DESC['T-2314']);
    expect(t.checklistItems.map((i) => [i.text, i.done ? 1 : 0])).toEqual(P.CHECKS['T-2314']);
    expect(t.comments.map((c) => [c.author, c.when, c.text])).toEqual(P.COMMENTS['T-2314']);
    expect(t.attachments.map((f) => [f.name, f.meta, f.icon])).toEqual(P.FILES['T-2314']);
    expect(t.entries.map((e) => [e.dateText, e.hours, e.note])).toEqual(P.ENTRIES['T-2314']);
    expect([t.costRate, t.activity?.code, t.activity?.wbs, t.activity?.packageName, t.priorityLabel, t.statusLabel]).toEqual([95, 'A1250', '1.4', 'Steel structure', 'High', 'In progress']);
    expect((await getTask('T-2305'))!.attachments.map((f) => [f.name, f.meta, f.icon])).toEqual(P.FILES['T-2305']);
    expect((await getTask('T-2290'))!.checklist).toEqual({ done: 2, total: 2 });
    expect(await getTask('T-9999')).toBeNull();
  });
});

describe('HR (06 §2–5)', () => {
  it('rate card: RATE_ROLES, MULTS; average internal 72,33 €/h; contractor premium +39 %; legacy RATES', async () => {
    const rc = await getRateCard();
    expect(rc.roles.map((r) => [r.role, r.baseRateEur])).toEqual(P.RATE_ROLES);
    expect(rc.multipliers.map((m) => [m.key, m.label, m.factor])).toEqual(P.MULTS);
    const internal = rc.roles.filter((r) => !r.isExternal);
    expect((internal.reduce((a, r) => a + r.baseRateEur, 0) / internal.length).toFixed(2)).toBe('72.33');
    const rate = (n: string) => rc.roles.find((r) => r.role === n)!.baseRateEur;
    expect(Math.round((rate('Contractor — structural (external)') / rate('Structural engineer') - 1) * 100)).toBe(39);
    expect(await getJobTitleRates()).toEqual(P.RATES);
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
    const lc = await getLeaveCalendar();
    expect(Object.fromEntries(lc.leaveTypes.map((t) => [t.label, t.days]))).toEqual(P.LEAVE_DAYS);
    expect(Object.fromEntries(lc.holidays.map((h) => [h.weekIndex, h.label]))).toEqual(P.HOLIDAYS);
    expect(Object.fromEntries(lc.people.map((p) => [p.name, Object.fromEntries(p.weeks.flatMap((w, i) => (w.typeLabel ? [[String(i), w.typeLabel]] : [])))]))).toEqual(P.LEAVE);
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
    for (let o = 0; o < 40; o++) expect(dayOffsetOfIso(isoOfDayOffset(o))).toBe(o);
    expect(isoOfDayOffset(4)).toBe('2026-09-25');
    expect(isoOfDayOffset(15)).toBe('2026-10-12');
    expect(dayOffsetOfIso('2026-09-26')).toBeNull();
  });
});
