// End-to-end database check: opens a PGlite in a temporary directory, applies ./drizzle, seeds from the
// prototype data set, prints row counts and verifies golden values through the DAL.
//   npx tsx --conditions=react-server scripts/db-check.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { healthOf } from '@/domain/health';
import { getCostControl, listChangeRequests } from '@/server/dal/cost';
import { getStageChecklist, getStageHistory, listStages, toggleStageDeliverable } from '@/server/dal/lifecycle';
import { getOwnerDirectory, getPersonByName, listDepartmentCapacities, listPeople, listUsers, listZones } from '@/server/dal/people';
import { getActivities, getActivityAssignments, getBaselines, getPipelinePlans, listScheduleSummaries } from '@/server/dal/planning';
import { createProject, getProject, getProjectData, listProjects, nextAnalyticCode, nextProjectNumber } from '@/server/dal/projects';
import { createChangeRequest, getChangeControl } from '@/server/dal/changes';
import { getContingency } from '@/server/dal/contingency';
import { getHoursReconciliation, getLeaveCalendar, getRateCard, getSkillsMatrix } from '@/server/dal/hr';
import { countUnreadNotifications, listActivity, listAudit } from '@/server/dal/notifications';
import { approveResourceRequest, createResourceRequest, getDepartmentApprovals, listResourceRequests } from '@/server/dal/requests';
import { getResourcePool, getWhatIf } from '@/server/dal/resources';
import { createRisk, getRiskRegister, listRisks } from '@/server/dal/risks';
import { getTask, listTasks } from '@/server/dal/tasks';
import { getTrends } from '@/server/dal/trends';
import { setDb } from '@/server/db/client';
import { riskCategory, riskResponse, riskStatus, stage } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import * as schema from '@/server/db/schema';
import { PROTO, PROTO_GEN } from '@/server/prototype';

/**
 * Seed row counts of the delivery-2 tables: risks 8 (HLT) + 5 × 4 generated; snapshots 6 projects × 13 weeks;
 * request events = 10 "sent" + 6 decisions; notification recipients = Σ NOTIFS audiences; person skills 8 × 10.
 */
const D2_COUNTS: Record<string, number> = {
  risks: 28, status_snapshots: 78, status_reports: 0, contingency_registers: 1, contingency_draws: 3,
  tasks: 27, task_checklist_items: 11, task_comments: 3, task_attachments: 3, time_entries: 4, resource_requests: 10, resource_request_events: 16, request_activity_choices: 5,
  allocations: 64, rate_roles: 10, rate_multipliers: 5, job_title_rates: 8, skills: 10, person_skills: 80, certifications: 8, leave_types: 4,
  leave_entries: 12, public_holidays: 11, hours_imports: 1, hours_lines: 10, unassigned_hours: 2,
  whatif_levers: 5, whatif_auto_levers: 9, whatif_contexts: 1, whatif_scenarios: 2, whatif_scenario_levers: 10,
  notifications: 10, notification_recipients: 24, activity_events: 12, audit_entries: 8,
};

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : ''}`);
}
const same = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

/** First differing path between two JSON values (for failure messages). */
function diff(a: unknown, b: unknown, p = ''): string | null {
  if (same(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${p}.${k}`);
      if (d) return d;
    }
  }
  return `${p}: ${JSON.stringify(a)?.slice(0, 200)} ≠ ${JSON.stringify(b)?.slice(0, 200)}`;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-db-check-'));
  const t0 = Date.now();
  const db = await openDatabase(path.join(dir, 'pg'));
  setDb(db);
  console.log(`Database ${dir}/pg migrated and seeded in ${Date.now() - t0} ms\n\nRow counts`);

  const counts: Record<string, number> = {};
  for (const t of Object.values(schema)) {
    if (!is(t, PgTable)) continue;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t);
    counts[getTableName(t)] = n;
    console.log(`  ${getTableName(t).padEnd(34)} ${String(n).padStart(5)}`);
  }

  console.log('\nDelivery 2 tables (golden row counts)');
  for (const [table, n] of Object.entries(D2_COUNTS)) check(`${table} = ${n}`, counts[table] === n, counts[table]);

  console.log('\nProjects');
  const list = await listProjects();
  check('17 projects', list.length === 17, list.length);
  check('6 projects with data', list.filter((p) => p.hasData).length === 6);
  const hlt = await getProject('HLT-026');
  check('HLT-026 budget 4800 · actual 3360 · progress .64', hlt?.budget === 4800 && hlt.actual === 3360 && hlt.progress === 0.64, hlt);
  check('HLT-026 #026 · HAV004 · DAS 2 · EMP · Fabrication & Assemblage · R. Aubert · Le Havre · euna',
    hlt?.displayId === '#026' && hlt.analytic === 'HAV004' && hlt.das === '2' && hlt.machineType === 'EMP' && hlt.status === 'Fabrication & Assemblage'
      && hlt.stage === 'fabrication_assemblage' && hlt.pm === 'R. Aubert' && hlt.city === 'Le Havre' && hlt.zone === 'euna', hlt);
  check('Health HLT-026 at risk, RCF-019 off track', hlt?.health === 'at_risk' && (await getProject('RCF-019'))?.health === 'off_track');
  check('ERP-202 machine type R&D (stored rnd)', (await getProject('ERP-202'))?.machineType === 'R&D');

  // Same values as the former prototype-backed contract (TEMPORARY implementation of projects.ts).
  const legacy = PROTO_GEN.initialProjects.map((p) => {
    const id = PROTO.PROJ_ID[p.code];
    const geo = PROTO.GEO[p.code];
    return {
      code: p.code, name: p.name, displayId: id?.id ?? p.code, analytic: id?.ana ?? null, das: id?.das ?? null, machineType: id?.mt ?? null,
      status: p.status, pm: p.pm, client: p.client, start: p.start, finish: p.finish, budget: p.budget, actual: p.actual, progress: p.progress,
      spi: p.spi ?? null, city: geo?.city ?? null, country: geo?.country ?? null, zone: (geo && (geo.zone || PROTO.COUNTRY_ZONE[geo.country])) || 'euna',
      hasData: !!PROTO_GEN.projectData[p.code], health: healthOf(p),
    };
  });
  const current = list.map((p) => Object.fromEntries(Object.keys(legacy[0]).map((k) => [k, p[k as keyof typeof p]])));
  check('listProjects() = prototype initialProjects() (legacy contract fields)', same(current, legacy), diff(current, legacy));

  console.log('\nprojectData() reproduced from the DB');
  for (const code of Object.keys(PROTO_GEN.projectData)) {
    const pd = await getProjectData(code);
    check(`${code} projectData deep-equal`, same(pd, PROTO_GEN.projectData[code]), diff(pd, PROTO_GEN.projectData[code]));
  }
  const sums = await listScheduleSummaries();
  check('listScheduleSummaries() = projectData headers + MILES', same(Object.keys(sums), Object.keys(PROTO_GEN.projectData))
    && Object.entries(sums).every(([c, s]) => s.finishText === PROTO_GEN.projectData[c].finishText && same(s.milestones.map((m) => [m.name, m.baselineMonth, m.forecastMonth, m.statusLabel]), PROTO_GEN.projectData[c].MILES)));
  check('EWA-051 (no data) → null', (await getProjectData('EWA-051')) === null && (await getCostControl('EWA-051')) === null);
  const cc = await getCostControl('HLT-026');
  check('HLT-026 streams carry HLT_STREAMS monthly values', same(cc?.streams.map((s) => [s.name, s.basis, s.monthly]), PROTO.HLT_STREAMS));
  check('HLT-026 EVM at data date: PV 3420 · EV 3080 · AC 3360', cc?.pv[8] === 3420 && cc.ev.at(-1) === 3080 && cc.ac.at(-1) === 3360);
  const acts = await getActivities('HLT-026');
  const a1620 = acts.find((a) => a.id === 'A1620');
  check('A1620 FNLT 18 Dec violated, 05 Jan ’27 → 2027-01-05', a1620?.constraint === 'FNLT 18 Dec' && a1620.violated && a1620.startDate === '2027-01-05', a1620);
  check('A1250 resource assignments (4)', (await getActivityAssignments('HLT-026', 'A1250')).length === 4);

  console.log('\nLifecycle');
  const stages = await listStages();
  check('13 stages, deliverables = STAGE_DELIVS', stages.length === 13 && same(Object.fromEntries(stages.filter((s) => s.deliverables.length).map((s) => [s.label, s.deliverables])), PROTO.STAGE_DELIVS));
  check('transitions = TRANS', same(Object.fromEntries(stages.map((s) => [s.label, s.next.map((n) => stage.label(n))])), PROTO.TRANS));
  check('gates = GATES, descriptions = LIFE',
    same(Object.fromEntries(stages.filter((s) => s.gate).map((s) => [s.label, s.gate])), PROTO.GATES) && same(Object.fromEntries(stages.map((s) => [s.label, s.description])), PROTO.LIFE));
  for (const code of Object.keys(PROTO.STAGE_HISTORY)) {
    const h = (await getStageHistory(code)).map((e) => [e.label, e.date, e.mode, e.reason]);
    check(`${code} stage history = STAGE_HISTORY`, same(h, PROTO.STAGE_HISTORY[code]), diff(h, PROTO.STAGE_HISTORY[code]));
  }
  for (const [code, byStage] of Object.entries(PROTO.STAGE_DONE_DEFAULT as Record<string, Record<string, number[]>>)) {
    const cl = await getStageChecklist(code);
    const got = Object.fromEntries(Object.keys(byStage).map((label) => [label, cl[stage.code(label)].map(Number)]));
    check(`${code} stage deliverables = STAGE_DONE_DEFAULT`, same(got, byStage), diff(got, byStage));
  }

  console.log('\nPeople & organisation');
  check('OWN directory', same(await getOwnerDirectory(), PROTO.OWN), diff(await getOwnerDirectory(), PROTO.OWN));
  const people = await listPeople();
  check('PMs cited by projects resolve to persons', PROTO_GEN.initialProjects.every((p) => people.some((x) => x.shortName === p.pm)));
  check('Marion Kerviel heads Engineering', (await getPersonByName('M. Kerviel'))?.department === 'Engineering');
  check('8 users (personas)', same((await listUsers()).map((u) => [u.role, u.name, u.title]), Object.entries(PROTO.PERSONAS as Record<string, [string, string]>).map(([r, [n, t]]) => [r, n, t])));
  check('zones + bounds', same((await listZones()).map((z) => [z.code, z.label, z.manager]), PROTO.ZONES) && same(Object.fromEntries((await listZones()).map((z) => [z.code, z.bounds])), PROTO.ZONE_BOUNDS));
  check('department capacities = ROLES', same((await listDepartmentCapacities()).map((d) => [d.department, d.capacityH, d.demandH]), PROTO.ROLES));

  console.log('\nChange & baselines');
  const crs = await listChangeRequests('HLT-026');
  check('HLT-026 register: HLT_CRS_X + CR-005', crs.length === 6 && crs.find((c) => c.id === 'CR-008')?.status === 'in_review' && crs.find((c) => c.id === 'CR-005')?.status === 'rejected');
  const bls = await getBaselines('HLT-026');
  check('BASELINES reproduced', same(bls.map((b) => [b.code, b.name, b.setOn, b.bac, b.finish, b.stateLabel]), PROTO.BASELINES), diff(bls.map((b) => [b.code, b.name, b.setOn, b.bac, b.finish, b.stateLabel]), PROTO.BASELINES));
  check('pipeline plans (5 projects × 6 windows)', same(Object.fromEntries(Object.entries(await getPipelinePlans()).map(([c, w]) => [c, w.map((x) => [x.label, x.startMonth, x.endMonth])])), PROTO.PIPE_PLAN));

  console.log('\nDelivery 2 data (DAL vs prototype)');
  const risksHlt = await listRisks('HLT-026');
  const risksProto = risksHlt.map((r) => ({
    id: r.id, title: r.title, cat: riskCategory.label(r.category), p: r.probability, i: r.impact, owner: r.owner, resp: riskResponse.label(r.response), plan: r.plan,
    act: r.activity?.code ?? '', emv: r.emv, trig: r.trigger, status: riskStatus.label(r.status), trend: r.trend,
  }));
  check('RISKS_HLT reproduced', same(risksProto, PROTO.RISKS_HLT), diff(risksProto, PROTO.RISKS_HLT));
  const reg = await getRiskRegister('HLT-026');
  check('risk KPIs: 7 open · 5 score ≥ 8 · EMV 340 · contingency 150', reg?.risks.filter((r) => r.status === 'open').length === 7
    && reg.risks.filter((r) => r.status === 'open' && r.score >= 8).length === 5 && reg.openEmv === 340 && reg.contingency === 150);
  check('generated risk registers (NDC-031 EMV 53/26/20/16, owner S. Perrin)', same((await listRisks('NDC-031')).map((r) => [r.id, r.emv, r.ownerShort]), [['R-01', 53, 'S. Perrin'], ['R-02', 26, 'S. Perrin'], ['R-03', 20, 'S. Perrin'], ['R-04', 16, 'S. Perrin']]));
  const chg = await getChangeControl('HLT-026');
  check('change register = HLT_CRS_X + CR-005, approver chain follows the project', chg?.changeRequests.length === 6
    && same(chg.changeRequests[3].chain.map((c) => c.approver), ['Romain Aubert', 'Marie Lefebvre', 'Nadia Bensaïd', 'Monthly · next 8 Oct']));
  const tr = await getTrends('HLT-026');
  check('HLT_SNAPS reproduced, next status report 2 Oct', same(tr?.series, PROTO.HLT_SNAPS) && tr?.nextReport?.text === '2 Oct');
  const cg = await getContingency('HLT-026');
  check('contingency 150 · drawn 48 · remaining 102 · exposure 340', cg?.initial === 150 && cg.drawn === 48 && cg.remaining === 102 && cg.exposure === 340);
  check('contingency default round(BAC × 3 %) (NDC-031 = 63)', (await getContingency('NDC-031'))?.initial === 63);
  const pool = await getResourcePool();
  check('PEOPLE reproduced (pool order, job titles, loads)', same(pool.people.map((p) => [p.name, p.jobTitle, p.loads]), PROTO.PEOPLE));
  const reqs = (await listResourceRequests()).map((r) => ({
    id: r.id, pm: r.requestedBy, project: r.projectShort, person: r.resource, dept: r.department, title: r.title, act: r.activity?.code, hours: r.hours,
    start: r.startDay, due: r.dueDay, prio: r.priority, status: r.status, sent: r.sentText, note: r.note, response: r.response,
    propStart: r.proposedStartDay, propDue: r.proposedDueDay, todoId: r.taskId,
  }));
  check('REQUESTS reproduced', same(reqs, PROTO.REQUESTS), diff(reqs, PROTO.REQUESTS));
  check('Engineering approvals: RQ-043, RQ-041 pending (52 h)', same((await getDepartmentApprovals('Engineering'))?.pending.map((r) => r.id), ['RQ-043', 'RQ-041']));
  const todos = (await listTasks()).map((t) => ({
    id: t.id, person: t.assignee, title: t.title, project: t.project.short, act: t.activity?.code, status: t.status, prio: t.priority, start: t.startDay, due: t.dueDay,
    est: t.estimateH, logged: t.loggedH, cl: [t.checklist.done, t.checklist.total], labels: t.labels, pct: t.pct,
  }));
  check('TODOS reproduced', same(todos, PROTO.TODOS), diff(todos, PROTO.TODOS));
  const t2314 = await getTask('T-2314');
  check('T-2314 comments, files, entries', same(t2314?.comments.map((c) => [c.author, c.when, c.text]), PROTO.COMMENTS['T-2314'])
    && same(t2314?.attachments.map((f) => [f.name, f.meta, f.icon]), PROTO.FILES['T-2314']) && same(t2314?.entries.map((e) => [e.dateText, e.hours, e.note]), PROTO.ENTRIES['T-2314']));
  const rc = await getRateCard();
  check('RATE_ROLES and MULTS reproduced', same(rc.roles.map((r) => [r.role, r.baseRateEur]), PROTO.RATE_ROLES) && same(rc.multipliers.map((m) => [m.key, m.label, m.factor]), PROTO.MULTS));
  const sm = await getSkillsMatrix();
  check('SKILL_LV and CERTS reproduced', same(Object.fromEntries(sm.people.map((p) => [p.name, p.levels])), PROTO.SKILL_LV)
    && same(Object.fromEntries(sm.people.filter((p) => p.certText).map((p) => [p.name, p.certText])), PROTO.CERTS));
  const lc = await getLeaveCalendar();
  check('LEAVE and HOLIDAYS reproduced', same(Object.fromEntries(lc.people.map((p) => [p.name, Object.fromEntries(p.weeks.flatMap((w, i) => (w.typeLabel ? [[String(i), w.typeLabel]] : [])))])), PROTO.LEAVE)
    && same(Object.fromEntries(lc.holidays.map((h) => [h.weekIndex, h.label])), PROTO.HOLIDAYS));
  const hr = await getHoursReconciliation('HLT-026');
  check('HOURS reproduced', same(hr && { imported: hr.importedText, code: hr.analyticCode, lines: hr.lines.map((l) => [l.person, l.wbsLabel, l.plannedH, l.declaredH]), unassigned: hr.unassigned.map((u) => [u.person, u.hours, u.reason]) }, PROTO.HOURS['HLT-026']));
  const wi = await getWhatIf('HLT-026');
  check('what-if levers, AUTO, scenarios A/B', same(wi?.autoLevers, PROTO.AUTO) && wi?.levers.length === 5 && same(wi.scenarios.map((x) => x.name), ['A', 'B']));
  check('unread notifications per role 3/4/1/2/1/1/1/1', same(await Promise.all(['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'].map(countUnreadNotifications)), [3, 4, 1, 2, 1, 1, 1, 1]));
  check('ACTIVITY and AUDIT reproduced', same((await listActivity()).map((a) => [a.when, a.who, a.what, a.kind]), PROTO.ACTIVITY) && same((await listAudit()).map((a) => [a.when, a.who, a.object, a.change, a.area]), PROTO.AUDIT));

  console.log('\nNumbering & writes (temporary database)');
  check('next project number #045', (await nextProjectNumber()) === PROTO_GEN.nextProjectId);
  check('next analytic HAV002 / LOG001', (await nextAnalyticCode('Port authority')) === 'HAV002' && (await nextAnalyticCode('Logistics BU')) === 'LOG001');
  const r1 = await toggleStageDeliverable('HLT-026', 'fabrication_assemblage', 2);
  const r2 = await toggleStageDeliverable('HLT-026', 'fabrication_assemblage', 3);
  const hlt2 = await getProject('HLT-026');
  check('ticking the last deliverable auto-advances HLT-026 to FAT', r1 === null && r2 === 'fat' && hlt2?.status === 'FAT', { r1, r2, s: hlt2?.status });
  const h2 = await getStageHistory('HLT-026');
  check('history entry FAT · 25 Sep 2026 · auto', h2.length === 7 && same(h2.at(-1) && [h2.at(-1)!.label, h2.at(-1)!.date, h2.at(-1)!.mode], ['FAT', '25 Sep 2026', 'auto']));
  const code = await createProject({
    name: 'Eastbank Annex', client: 'Logistics BU', das: '2', machineType: 'EMP', currency: 'EUR', templateCode: 'EMP',
    categories: [{ name: 'Études', type: 'labor', budget: 160 }, { name: 'Matière & structure', type: 'material', budget: 560 }], contingencyPct: 5, calendar: 'standard_5x8_workshop',
  });
  const created = (await listProjects())[0];
  check('createProject → LOG-045, first in register, Initiative, New, €756k', code === 'LOG-045' && created.code === code && created.status === 'Initiative' && created.isNew && created.budget === 756 && created.analytic === 'LOG001', created);
  check('next project number then #046', (await nextProjectNumber()) === '#046');
  check('new risk R-21, CR-011, request RQ-045', (await createRisk('HLT-026', { title: 'Check', category: 'technical', response: 'mitigate' }, 'Romain Aubert')) === 'R-21'
    && (await createChangeRequest('HLT-026', { title: 'Check', types: ['scope'], amountKeur: 1, scheduleDays: 0 }, 'Romain Aubert')) === 'CR-011'
    && (await createResourceRequest({ projectCode: 'HLT-026', title: 'Check', activityCode: 'A1250', person: 'Julien Wagner', priority: 'med' }, 'Romain Aubert')) === 'RQ-045');
  check('approving RQ-043 creates task T-2341 (contract role)', (await approveResourceRequest('RQ-043', 'Marion Kerviel')) === 'T-2341' && (await getTask('T-2341'))?.assignee === 'Contract structural engineer');
  check('audit rows appended (8 seed + 4)', (await listAudit()).length === 12);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
