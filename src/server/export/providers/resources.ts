// Export providers — Resources: Resources (pool load), Project resources, Resource requests, Approvals (department),
// What-if levelling, Skills matrix, Leave & working calendar, Rate cards.
// Rights as on screen: hourly rates and premium multipliers only for the roles that see rates (director, PM) — the
// columns are left out otherwise; requests are the viewer's own unless the screen shows them all (director, outside
// the workspace); a client exports only its own projects' rows. Weekly loads are fractions (1 = 100 % of the hours).
import { matchesFilter as matchesRequestFilter, isRequestFilter, deptOfSlug, REQUEST_FILTERS } from '@/domain/requests';
import { parseSkillFilter } from '@/domain/hr';
import { leverLabel, type WhatIfResult } from '@/domain/whatif';
import { getRateCard, getLeaveCalendar, getSkillsMatrix } from '@/server/dal/hr';
import { getProject } from '@/server/dal/projects';
import { listResourceRequests, type ResourceRequestRow } from '@/server/dal/requests';
import { departmentOfPerson, getApprovalsScreenData, listApprovalDepartmentsFull } from '@/server/dal/requests-screens';
import { getLaborCost, getProjectTeam, getResourcePool, getWhatIf, listDepartments, type PoolPerson, type ResourceWeek } from '@/server/dal/resources';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook } from '../types';
import { col, compact, filterLine, kpiSheet, param, sheet } from './common';
import { projectFilter } from './scope';

const currentProject = (ctx: ExportContext) => param(ctx, 'code')?.toUpperCase() ?? 'HLT-026';

function loadSheet(ctx: ExportContext, name: string, weeks: ResourceWeek[], people: PoolPerson[]): ExportSheet {
  const { t } = ctx;
  return sheet(name, [
    col('name', t('Person'), 'text', 22), col('job', t('Job title'), 'text', 22), col('department', t('Department'), 'text', 18),
    ...weeks.map((w, i) => col(`w${i}`, `${t('Week of')} ${w.start}`, 'percent', 12)), col('avg', t('Average'), 'percent'), col('max', t('Peak'), 'percent'),
  ], people.map((p) => ({
    name: p.name, job: p.jobTitle ? t(p.jobTitle) : '', department: p.department ? t(p.department) : '', ...Object.fromEntries(p.loads.map((l, i) => [`w${i}`, l / 100])),
    avg: p.avg / 100, max: p.max / 100,
  })));
}

function requestSheet(ctx: ExportContext, name: string, rows: ResourceRequestRow[]): ExportSheet {
  const { t } = ctx;
  return sheet(name, [
    col('id', t('Request'), 'text', 8), col('project', t('Project'), 'text', 10), col('title', t('Title'), 'text', 36), col('resource', t('Resource'), 'text', 20),
    col('department', t('Department'), 'text', 18), col('activity', t('Activity'), 'text', 26), col('hours', t('Hours'), 'number', 8), col('start', t('Start date'), 'text', 12),
    col('due', t('Due'), 'text', 12), col('priority', t('Priority'), 'text', 10), col('status', t('Status'), 'text', 18), col('requestedBy', t('Requested by'), 'text', 16),
    col('sent', t('Sent'), 'text', 12), col('response', t('Response'), 'text', 36), col('task', t('Task'), 'text', 9),
  ], rows.map((r) => ({
    id: r.id, project: r.projectCode, title: t(r.title), resource: t(r.resource), department: t(r.department), activity: r.activity ? `${r.activity.code} · ${t(r.activity.name)}` : '',
    hours: r.hours, start: t(r.start), due: t(r.due), priority: t(r.priority === 'high' ? 'High' : r.priority === 'low' ? 'Low' : 'Medium'), status: t(r.statusLabel),
    requestedBy: r.requestedBy, sent: t(r.sentText), response: t(r.response), task: r.taskId ?? '',
  })));
}

/** Key figures of a load table: people, average load, people above 100 % in a week, open requests, labour cost to date. */
function loadKpis(ctx: ExportContext, people: PoolPerson[], openRequests: number, labor: { name: string; budget: number; actual: number } | null): ExportSheet {
  const { t } = ctx;
  const avg = people.length ? Math.round(people.reduce((a, p) => a + p.avg, 0) / people.length) : 0;
  return kpiSheet(ctx, compact([
    { label: t('People'), value: String(people.length) }, { label: t('Average load'), value: `${avg}%` },
    { label: t('Over-allocated'), value: String(people.filter((p) => p.loads.some((l) => l > 100)).length), sub: t('above 100% in at least one week') },
    { label: t('Open requests'), value: String(openRequests) },
    labor ? { label: t('Labor cost to date'), value: `${labor.actual} k€`, sub: `${t('Budget')} ${labor.budget} k€` } : null,
  ]));
}

// ── Resources (pool) ─────────────────────────────────────────────────────────────────────────────────────────────────
async function resourcesWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const [pool, departments, pending, labor] = await Promise.all([getResourcePool(), listDepartments(), listResourceRequests({ status: 'pending' }), getLaborCost(currentProject(ctx))]);
  const caps = departments.filter((d) => d.capacityH != null && d.demandH != null).sort((a, b) => (a.capacityPosition ?? 0) - (b.capacityPosition ?? 0));
  return {
    title: t('Resources'),
    sheets: [
      loadSheet(ctx, t('Weekly load'), pool.weeks, pool.people),
      sheet(t('Department capacity'), [col('department', t('Department'), 'text', 22), col('head', t('Head'), 'text', 18), col('capacity', t('Capacity (h)'), 'integer'), col('demand', t('Demand (h)'), 'integer'), col('gap', t('Gap (h)'), 'integer')],
        caps.map((d) => ({ department: t(d.name), head: d.head?.name ?? '', capacity: d.capacityH, demand: d.demandH, gap: (d.demandH ?? 0) - (d.capacityH ?? 0) }))),
      loadKpis(ctx, pool.people, pending.length, labor),
    ],
  };
}

// ── Project resources ────────────────────────────────────────────────────────────────────────────────────────────────
async function projectResourcesWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const { t } = ctx;
  const code = ctx.project.code;
  const [pool, team, labor, pending, all] = await Promise.all([getResourcePool(), getProjectTeam(code), getLaborCost(code), listResourceRequests({ projectCode: code, status: 'pending' }), listResourceRequests({ projectCode: code })]);
  const members = new Set(team.map((m) => m.name));
  const people = pool.people.filter((m) => members.has(m.name));
  return {
    title: t('Project resources'),
    sheets: [loadSheet(ctx, t('Team load'), pool.weeks, people), requestSheet(ctx, t('Resource requests'), all), loadKpis(ctx, people, pending.length, labor)],
  };
}

// ── Resource requests ────────────────────────────────────────────────────────────────────────────────────────────────
async function requestsWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, viewer } = ctx;
  const all = viewer.role === 'director' || ctx.outside;
  const [rows, visible] = await Promise.all([listResourceRequests(all ? {} : { requestedBy: viewer.short }), projectFilter(ctx)]);
  const s = param(ctx, 'status');
  const filter = isRequestFilter(s) ? s : null;
  const shown = rows.filter((r) => matchesRequestFilter(r.status, filter) && visible(r.projectCode));
  const label = REQUEST_FILTERS.find((f) => f.value === filter)?.label;
  return {
    title: t('Resource requests'),
    filters: compact([all ? null : `${t('Requested by')}: ${viewer.name}`, filter && label ? `${t('Status')}: ${t(label)}` : null]),
    sheets: [requestSheet(ctx, t('Resource requests'), shown)],
  };
}

// ── Approvals (department queue) ─────────────────────────────────────────────────────────────────────────────────────
async function approvalsWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const { t } = ctx;
  const depts = await listApprovalDepartmentsFull();
  const want = param(ctx, 'dept');
  const asked = want ? depts.find((d) => d.name === want) ?? deptOfSlug(depts, want) : null;
  const mine = asked ? null : await departmentOfPerson(ctx.viewer.name);
  const name = asked?.name ?? depts.find((d) => d.name === mine)?.name ?? depts[0]?.name;
  if (!name) return null;
  const [data, visible] = await Promise.all([getApprovalsScreenData(name), projectFilter(ctx)]);
  if (!data) return null;
  const people = data.pool.people.filter((p) => p.department === name);
  return {
    title: `${t('Approvals')} — ${t(name)}`,
    filters: [`${t('Department')}: ${t(name)}`],
    sheets: [
      requestSheet(ctx, t('Pending'), data.pending.filter((r) => visible(r.projectCode))),
      requestSheet(ctx, t('Decided'), data.decided.filter((r) => visible(r.projectCode))),
      loadSheet(ctx, t('Team load'), data.pool.weeks, people),
      kpiSheet(ctx, [
        { label: t('Pending'), value: String(data.department.pending) }, { label: t('Capacity (h)'), value: data.department.capacityH != null ? String(data.department.capacityH) : '—' },
        { label: t('Demand (h)'), value: data.department.demandH != null ? String(data.department.demandH) : '—' },
      ]),
    ],
  };
}

// ── What-if levelling ────────────────────────────────────────────────────────────────────────────────────────────────
// Levers are derived from the real allocations (S-7) and their effects computed with the CPM engine on a copy of the plan;
// the helper's hourly rate is left out for the roles that do not see rates.
async function whatIfWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const { t } = ctx;
  const project = await getProject(param(ctx, 'project') ?? 'HLT-026');
  if (!project || (ctx.viewer.role === 'client' && !(await projectFilter(ctx))(project.code))) return null;
  const w = await getWhatIf(project.code);
  if (!w) return null;
  const label = new Map(w.levers.map((l) => [l.code, leverLabel(l)]));
  const result = (r: WhatIfResult | undefined) => ({
    finish: r?.finish ?? null, float: r?.floatDays ?? null, gained: r?.daysGained ?? null, cost: r?.costKeur ?? null, peak: r ? r.peakPct / 100 : null, over: r?.overPeople ?? null,
  });
  const resultCols = [
    col('finish', t('Project finish'), 'date'), col('float', t('Float (d)'), 'integer'), col('gained', t('Days gained'), 'integer'), col('cost', t('Cost'), 'money_keur'),
    col('peak', t('Peak load'), 'percent'), col('over', t('People above 100%'), 'integer'),
  ];
  return {
    title: `${t('What-if levelling')} · ${project.code}`,
    filters: [`${t('Project')}: ${project.code} · ${t(project.name)}`, `${t('Data date')}: ${w.dataDate}`],
    sheets: [
      sheet(t('Scenarios'), [
        col('name', t('Scenario'), 'text', 10), col('priority', t('Priority'), 'text', 16), col('selected', t('Selected'), 'boolean'), col('levers', t('Levers'), 'text', 60), ...resultCols,
        col('drafts', t('Draft requests'), 'integer'), col('sent', t('Sent requests'), 'integer'), col('applied', t('Applied on'), 'datetime'), col('hypotheses', t('Hypotheses'), 'text', 40),
      ], [
        { name: t('Current plan'), priority: '', selected: null, levers: '', ...result(w.current), drafts: null, sent: null, applied: null, hypotheses: '' },
        ...w.scenarios.map((s) => ({
          name: s.name, priority: t(s.priorityLabel), selected: s.selected, levers: Object.entries(s.levers).filter(([, on]) => on).map(([c]) => t(label.get(c) ?? c)).join(' · '),
          ...result(s.result), drafts: s.requests.draft, sent: s.requests.sent, applied: s.appliedAt, hypotheses: s.hypotheses ?? '',
        })),
      ]),
      sheet(t('Levers'), [
        col('label', t('Lever'), 'text', 44), col('activity', t('Activity'), 'text', 30), col('resource', t('Resource'), 'text', 22), col('department', t('Department'), 'text', 16),
        col('from', t('From'), 'number', 7), col('to', t('To'), 'number', 7), col('helper', t('Helper'), 'text', 24), ...(ctx.ratesMasked ? [] : [col('rate', t('Hourly rate'), 'money_eur')]),
        col('critical', t('Critical'), 'boolean'), ...resultCols,
      ], w.levers.map((l) => ({
        label: t(leverLabel(l)), activity: `${l.activity} · ${t(l.activityName)}`, resource: l.resource ? t(l.resource) : '', department: l.department ? t(l.department) : '', from: l.from, to: l.to,
        helper: l.helper ? t(l.helper.name) : '', rate: ctx.ratesMasked ? null : l.helper?.rateEur ?? null, critical: l.critical, ...result(w.effects[l.code]),
      }))),
      sheet(t('Peak load profile'), [col('week', t('Week of'), 'date'), col('load', t('Peak load'), 'percent'), col('over', t('People above 100%'), 'integer')],
        w.weeks.map((x, i) => ({ week: x.start, load: (w.current.bars[i] ?? 0) / 100, over: w.overByWeek[i] ?? 0 }))),
      kpiSheet(ctx, compact([
        w.forecastFinish ? { label: t('Forecast finish'), value: w.forecastFinish } : null, w.floatDays != null ? { label: t('Float'), value: `${w.floatDays} ${t('d')}` } : null,
        w.baseline ? { label: t('Baseline finish'), value: w.baseline.finish, sub: w.baseline.code } : null, w.peak ? { label: t('Peak load'), value: `${w.peak.pct}%`, sub: `${w.peak.person} · ${w.peak.weekStart}` } : null,
        w.error ? { label: t('Error'), value: t(w.error) } : null,
      ])),
    ],
  };
}

// ── Skills, leave, rates ─────────────────────────────────────────────────────────────────────────────────────────────
async function skillsWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const data = await getSkillsMatrix();
  const f = parseSkillFilter(param(ctx, 'filter') ?? undefined, data.skills.length);
  const people = f == null ? data.people : data.people.filter((p) => (p.levels[f] ?? 0) > 0);
  return {
    title: t('Skills matrix'),
    filters: compact([f != null ? filterLine(t('Skill'), t(data.skills[f].name)) : null]),
    sheets: [sheet(t('Skills matrix'), [
      col('name', t('Person'), 'text', 22), col('job', t('Job title'), 'text', 22), ...data.skills.map((s, i) => col(`s${i}`, t(s.name), 'integer', 12)), col('certs', t('Certifications'), 'text', 40),
    ], people.map((p) => ({ name: p.name, job: p.jobTitle ? t(p.jobTitle) : '', ...Object.fromEntries(p.levels.map((l, i) => [`s${i}`, l || null])), certs: p.certifications.map((c) => t(c)).join(' · ') })))],
  };
}

async function leaveWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const data = await getLeaveCalendar();
  return {
    title: t('Leave & working calendar'),
    sheets: [
      sheet(t('Leave'), [col('name', t('Person'), 'text', 22), col('job', t('Job title'), 'text', 22), ...data.weeks.map((w, i) => col(`w${i}`, `${t('Week of')} ${w.start}`, 'text', 14)), col('days', t('Days off'), 'number', 8)],
        data.people.map((p) => ({
          name: p.name, job: p.jobTitle ? t(p.jobTitle) : '', ...Object.fromEntries(p.weeks.map((c, i) => [`w${i}`, c.typeLabel ? `${t(c.typeLabel)} · ${c.days} ${t('d')}` : c.holidays ? t('Public holiday') : ''])),
          days: p.weeks.reduce((a, c) => a + c.days, 0),
        }))),
      sheet(t('Public holidays'), [col('date', t('Date'), 'date'), col('name', t('Holiday'), 'text', 30)], data.holidays.map((h) => ({ date: h.date, name: t(h.name) }))),
      sheet(t('Leave types'), [col('code', t('Code'), 'text', 8), col('label', t('Type'), 'text', 20), col('days', t('Days'), 'number', 8)], data.leaveTypes.map((l) => ({ code: l.code, label: t(l.label), days: l.days }))),
    ],
  };
}

async function ratesWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t } = ctx;
  const card = await getRateCard();
  const masked = ctx.ratesMasked;
  return {
    title: t('Rate cards'),
    filters: masked ? [t('Rates are visible to directors and project managers only')] : [],
    sheets: [
      sheet(t('Rate cards'), [
        col('role', t('Role'), 'text', 26), ...(masked ? [] : [col('rate', t('Hourly rate'), 'money_eur')]), col('external', t('External'), 'boolean'), col('costCenter', t('Cost centre'), 'text', 12),
        col('grade', t('Grade'), 'text', 8), col('from', t('Effective from'), 'date'),
      ], card.roles.map((r) => ({ role: t(r.role), rate: masked ? null : r.baseRateEur, external: r.isExternal, costCenter: r.costCenter ?? '', grade: r.grade ?? '', from: r.effectiveFrom }))),
      sheet(t('Premium multipliers'), [col('label', t('Premium'), 'text', 30), ...(masked ? [] : [col('factor', t('Multiplier'), 'number', 10, { decimals: 2 })])],
        card.multipliers.map((m) => ({ label: t(m.label), factor: masked ? null : m.factor }))),
    ],
  };
}

registerExportProvider({ screen: 'resources', table: resourcesWorkbook });
registerExportProvider({ screen: 'presources', table: projectResourcesWorkbook, fileBase: () => 'project-resources' });
registerExportProvider({ screen: 'requests', table: requestsWorkbook, fileBase: () => 'resource-requests' });
registerExportProvider({ screen: 'approvals', table: approvalsWorkbook, fileBase: (ctx) => `approvals-${param(ctx, 'dept') ?? ''}`.replace(/-$/, '') });
registerExportProvider({ screen: 'whatif', table: whatIfWorkbook, fileBase: (ctx) => `what-if-${param(ctx, 'project') ?? 'HLT-026'}` });
registerExportProvider({ screen: 'skills', table: skillsWorkbook });
registerExportProvider({ screen: 'leave', table: leaveWorkbook });
registerExportProvider({ screen: 'rates', table: ratesWorkbook, fileBase: () => 'rate-cards' });
