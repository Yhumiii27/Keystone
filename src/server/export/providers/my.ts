// Export providers — the viewer's own screens: Home, My projects, My work (tasks), Task and My approvals.
// Rows are the viewer's (the persona of the export context), exactly as the screens build them: Home lists and KPI tiles
// of the role, the My projects wall, the person's tasks (`?person=` only for the roles that may look at someone else's
// work), one task sheet, the approvals inbox with its kind chip (`?filter=`).
import { DEFAULT_PROJECT } from '@/config/screens';
import { inboxView, kpiTexts, APPROVAL_KIND_LABEL } from '@/domain/approvals';
import { HEALTH_LABEL } from '@/domain/health';
import { renderTxt } from '@/domain/home';
import { getApprovalInbox } from '@/server/approvals';
import { getHomeView } from '@/server/dal/home';
import { getMyProjects } from '@/server/dal/portfolio';
import { getTask, listTasks, type TaskRow } from '@/server/dal/tasks';
import { getMyWorkPerson, myWorkAccess } from '@/server/dal/mywork-data';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportSheet, ExportWorkbook } from '../types';
import { yearOfIso } from '@/domain/clock';
import { col, filterLine, isoOf, kpiSheet, param, sheet, compact } from './common';
import { currentProjectCode, projectFilter } from './scope';
import { dataText, fieldsText } from '@/i18n/data-text';

/** Current project of a global screen: `?code=` (the header passes the shell's project), else the default one; a client's own. */
const currentProject = (ctx: ExportContext) => currentProjectCode(ctx, DEFAULT_PROJECT);

// ── Home ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function homeWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, lang, viewer } = ctx;
  const view = await getHomeView({ role: viewer.role, persona: viewer, projectCode: await currentProject(ctx), zone: ctx.zone, lang, organisation: viewer.organisation });
  const list = (l: typeof view.left): ExportSheet =>
    sheet(renderTxt(l.title, t), [col('title', t('Item'), 'text', 44), col('sub', t('Details'), 'text', 48), col('tag', t('Status'), 'text', 18)], l.rows.map((r) => ({
      title: renderTxt(r.title, t), sub: renderTxt(r.sub, t), tag: renderTxt(r.tag, t),
    })));
  return {
    title: `${t('Home')} · ${viewer.name}`,
    filters: compact([filterLine(t('Zone'), ctx.zone?.toUpperCase())]),
    sheets: [kpiSheet(ctx, view.kpis.map((k) => ({ label: renderTxt(k.label, t), value: renderTxt(k.value, t), sub: renderTxt(k.sub, t) }))), list(view.left), list(view.right)],
  };
}

/** ISO date of a display date, else the translated text (a 'date' column keeps non-dates as text). */
const dateOrText = (t: (s: string) => string, v: string, year: number) => (v && v !== '—' ? isoOf(v, year) ?? t(v) : '');

// ── My projects ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function myProjectsWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, lang, viewer } = ctx;
  const model = await getMyProjects(viewer, await currentProject(ctx), lang);
  const rows = model.cards.map((c) => ({
    code: c.project.code, name: dataText(c.project.name, ctx.lang), role: c.myRole ? t(c.myRole) : '', readOnly: c.readOnly, stage: t(c.project.status), pm: c.project.pm,
    client: dataText(c.project.client, ctx.lang), health: c.health ? t(HEALTH_LABEL[c.health]) : '—', progress: c.project.progress,
    spi: parseFloat(c.ind.spiText) || null, cpi: parseFloat(c.ind.cpiText) || null, milestone: c.ind.msName === '—' ? '' : dataText(c.ind.msName, ctx.lang),
    // Real dates when the screen shows one ("23 Oct", "17 Jan ’27"); the screen's words otherwise ("finish not planned").
    milestoneDate: c.ind.msDate ? isoOf(c.ind.msDate, yearOfIso(ctx.today)) ?? t(c.ind.msDate) : '', milestoneStatus: c.ind.msState ? t(c.ind.msState) : '',
    finish: dateOrText(t, c.ind.finishForecast || c.project.finish, yearOfIso(ctx.today)), myOpen: c.myOpen,
  }));
  return {
    title: t('My projects'),
    sheets: [
      sheet(t('My projects'), [
        col('code', t('Code'), 'text', 10), col('name', t('Project'), 'text', 36), col('role', t('My role'), 'text', 18), col('readOnly', t('Read-only'), 'boolean'),
        col('stage', t('Stage'), 'text', 22), col('pm', t('Project manager'), 'text', 14), col('client', t('Client'), 'text', 20), col('health', t('Health'), 'text', 12),
        col('progress', t('Progress'), 'percent'), col('spi', 'SPI', 'number', 8, { decimals: 2 }), col('cpi', 'CPI', 'number', 8, { decimals: 2 }),
        col('milestone', t('Next milestone'), 'text', 28), col('milestoneDate', t('Milestone date'), 'date'), col('milestoneStatus', t('Milestone status'), 'text', 12),
        col('finish', t('Forecast finish'), 'date'),
        col('myOpen', t('My open tasks'), 'integer'),
      ], rows),
      kpiSheet(ctx, model.kpis.map((k) => ({ label: t(k.label), value: t(k.value), sub: t(k.sub) }))),
    ],
  };
}

// ── My work ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const taskSheet = (ctx: ExportContext, rows: TaskRow[], name: string, withAssignee: boolean): ExportSheet => {
  const { t } = ctx;
  return sheet(name, [
    col('id', t('Task'), 'text', 9), col('title', t('Title'), 'text', 40), ...(withAssignee ? [col('assignee', t('Assignee'), 'text', 18)] : []),
    col('project', t('Project'), 'text', 10), col('activity', t('Activity'), 'text', 30), col('status', t('Status'), 'text', 12), col('priority', t('Priority'), 'text', 10),
    col('start', t('Start date'), 'date'), col('due', t('Due'), 'date'), col('estimate', t('Estimate (h)'), 'number', 10, { decimals: 1 }),
    col('logged', t('Logged (h)'), 'number', 10, { decimals: 1 }), col('pct', t('Progress'), 'percent'), col('checklist', t('Checklist'), 'text', 10),
    col('labels', t('Labels'), 'text', 24), col('request', t('Request'), 'text', 10),
  ], rows.map((r) => ({
    id: r.id, title: dataText(r.title, ctx.lang), assignee: r.assignee, project: r.project.code, activity: r.activity ? `${r.activity.code} · ${dataText(r.activity.name, ctx.lang)}` : '',
    status: t(r.statusLabel), priority: t(r.priorityLabel), start: isoOf(r.start, yearOfIso(ctx.today)), due: isoOf(r.due, yearOfIso(ctx.today)), estimate: r.estimateH, logged: r.loggedH, pct: r.pct / 100,
    checklist: r.checklist.total ? `${r.checklist.done}/${r.checklist.total}` : '', labels: r.labels.map((l) => t(l)).join(' · '), request: r.sourceRequest ?? '',
  })));
};

async function myWorkWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, viewer } = ctx;
  const asked = param(ctx, 'person');
  // R-049: someone else's work only along the hierarchy and the projects the viewer leads (as the page).
  const other = asked && asked !== viewer.name && (await myWorkAccess(viewer)).canView(asked) ? await getMyWorkPerson(asked) : null;
  const person = other?.name ?? viewer.name;
  const rows = await listTasks({ person });
  return { title: `${t('My work')} · ${person}`, filters: [`${t('Person')}: ${person}`], sheets: [taskSheet(ctx, rows, t('Tasks'), false)] };
}

// ── Task ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function taskWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const { t } = ctx;
  const id = (param(ctx, 'task') ?? param(ctx, 'id') ?? '').toUpperCase();
  if (!/^T-\d{1,6}$/.test(id)) return null;
  const d = await getTask(id);
  // A client exports only their organisation's projects (P-10a), as the attachment download already enforces.
  if (!d || !(await projectFilter(ctx))(d.project.code)) return null;
  const a = d.activity;
  const fields: [string, string | number][] = [
    [t('Task'), d.id], [t('Title'), dataText(d.title, ctx.lang)], [t('Assignee'), d.assignee], [t('Project'), `${d.project.code} · ${dataText(d.project.name, ctx.lang)}`],
    [t('Activity'), a ? `${a.code} · ${dataText(a.name, ctx.lang)}` : '—'], [t('Status'), t(d.statusLabel)], [t('Priority'), t(d.priorityLabel)], [t('Start date'), t(d.start)],
    [t('Due'), t(d.due)], [t('Estimate (h)'), d.estimateH], [t('Logged (h)'), d.loggedH], [t('Progress'), `${d.pct}%`],
    // R-046 (NEW-D2-1): the hourly rate and the actual cost (hours × rate, which reveals the rate) only for the roles that see
    // rates (director, PMs, Finance) — as the task sheet. R-083 (A-10): each entry at its person's rate on its date; the rate
    // cell is empty when several rates apply, "Rate missing" when an hour has no rate.
    ...(ctx.ratesMasked ? [] : ([
      [t('Hourly rate (€)'), d.costNote.rate ?? ''], [t('Actual cost (€)'), d.costNote.missing || d.costNote.cost == null ? t('Rate missing') : d.costNote.cost],
    ] as [string, string | number][])),
    [t('Description'), d.description ?? ''],
  ];
  return {
    title: `${d.id} · ${dataText(d.title, ctx.lang)}`,
    sheets: [
      sheet(t('Task'), [col('field', t('Field'), 'text', 22), col('value', t('Value'), 'text', 70)], fields.map(([field, value]) => ({ field, value: String(value) }))),
      sheet(t('Time log'), [col('date', t('Date'), 'date'), col('hours', t('Hours'), 'number', 8, { decimals: 2 }), col('person', t('Person'), 'text', 18), col('note', t('Note'), 'text', 50), col('source', t('Source'), 'text', 12)],
        d.entries.map((e) => ({ date: e.date, hours: e.hours, person: e.person ?? '', note: e.note, source: e.source }))),
      sheet(t('Checklist'), [col('position', '#', 'integer', 5), col('text', t('Item'), 'text', 60), col('done', t('Done'), 'boolean')], d.checklistItems.map((c) => ({ position: c.position + 1, text: c.text, done: c.done }))),
      sheet(t('Comments'), [col('author', t('Author'), 'text', 18), col('when', t('When'), 'datetime'), col('text', t('Comment'), 'text', 80)], d.comments.map((c) => ({ author: c.author, when: c.postedAt, text: c.text }))),
      sheet(t('Files'), [col('name', t('File'), 'text', 40), col('size', t('Size'), 'text', 10), col('by', t('Uploaded by'), 'text', 18), col('on', t('Uploaded on'), 'date')],
        d.attachments.map((f) => ({ name: f.name, size: f.sizeText, by: f.uploadedBy ?? '', on: isoOf(f.uploadedOn, yearOfIso(ctx.today)) }))),
    ],
  };
}

// ── My approvals ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function myApprovalsWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, lang, viewer } = ctx;
  const inbox = await getApprovalInbox(viewer, { lang, projectCode: await currentProject(ctx) });
  const view = inboxView(inbox.items, { decided: inbox.decided, roleTitle: viewer.title, filter: param(ctx, 'filter') });
  return {
    title: t('My approvals'),
    filters: compact([view.filter ? `${t('Type')}: ${t(APPROVAL_KIND_LABEL[view.filter])}` : null]),
    sheets: [
      sheet(t('Waiting for me'), [
        col('kind', t('Type'), 'text', 22), col('id', t('Reference'), 'text', 14), col('title', t('Title'), 'text', 44), col('sub', t('Details'), 'text', 40),
        col('who', t('Submitted by'), 'text', 18), col('when', t('Submitted on'), 'date'),
      ], view.rows.map((i) => ({ kind: t(APPROVAL_KIND_LABEL[i.kind]), id: i.id, title: fieldsText(i.title, t, ctx.lang), sub: fieldsText(i.sub, t, ctx.lang), who: i.who, when: i.whenIso ?? isoOf(i.when, yearOfIso(ctx.today)) }))),
      kpiSheet(ctx, view.kpis.map((k) => kpiTexts(k, t))),
    ],
  };
}

registerExportProvider({ screen: 'home', table: homeWorkbook, fileBase: (ctx) => `home-${ctx.viewer.role}` });
registerExportProvider({ screen: 'myprojects', table: myProjectsWorkbook, fileBase: () => 'my-projects' });
registerExportProvider({ screen: 'mywork', table: myWorkWorkbook, fileBase: () => 'my-tasks' });
registerExportProvider({ screen: 'task', table: taskWorkbook, fileBase: (ctx) => `task-${(param(ctx, 'task') ?? '').toUpperCase()}`.replace(/-$/, '') });
registerExportProvider({ screen: 'myapprovals', table: myApprovalsWorkbook, fileBase: () => 'my-approvals' });
