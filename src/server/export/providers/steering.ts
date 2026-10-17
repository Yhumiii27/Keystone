// Export providers — project steering: Plan (WBS & activities), Schedule, Hours reconciliation and Contingency register.
// PDF (S-9a): the detailed plan (WBS and activities, landscape) and the Gantt (work packages baseline vs forecast, milestones),
// the latter also downloaded from the client portal's "Planning" tab (review.ts, document `planning`).
// Plan: every WBS row (project, work packages, activities) with dates, float, progress, budget and logic, in display
// order — Excel holds both views (structure and progress columns); Schedule: work-package bars, milestones and the
// monthly progression (dates from the month offsets the screen draws); Hours: the lines of the latest import grouped as
// the screen's `?view=` (by resource / work package / unassigned); Contingency: the draw-downs, most recent first.
import { drawRows } from '@/domain/contingency';
import { parseHoursView } from '@/domain/hr';
import { GANTT_SPAN, scheduleView } from '@/domain/schedule-gantt';
import { effectiveFloat, predsLabel } from '@/domain/schedule';
import { hrT } from '@/features/hr/i18n';
import { planKpis, planOwnerNames, planRows } from '@/features/plan/model';
import { planT } from '@/features/plan/i18n';
import { slipText } from '@/features/schedule/i18n';
import { contingencyView } from '@/features/risks/model';
import { getHoursReconciliation } from '@/server/dal/hr';
import { projectDataDateOf } from '@/server/dal/kpis';
import { getPlanData, getPlanTodos } from '@/server/dal/plan';
import { getContingencyScreen } from '@/server/dal/risks-screen';
import { getScheduleData } from '@/server/dal/schedule';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportWorkbook, PdfBlock, PdfDocument } from '../types';
import { yearOfIso } from '@/domain/clock';
import { col, isoOf, kpiSheet, monthIso, param, projectRef, ratioText, sheet, todayIso } from './common';
import { dataText } from '@/i18n/data-text';

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const LEVEL: Record<string, string> = { root: 'Project', wp: 'Work package', act: 'Activity' };

/** The Plan's rows (every WBS row, display order) as an export sheet, with the screen's view and data. */
async function planSheet(ctx: ExportContext) {
  if (!ctx.project) return null;
  const [data, todos, dataDate] = await Promise.all([getPlanData(ctx.project.code), getPlanTodos(ctx.project.code), projectDataDateOf(ctx.project.code)]);
  if (!data) return null;
  const t = planT(ctx.t, ctx.lang);
  const view: 'structure' | 'progress' = param(ctx, 'view') === 'structure' ? 'structure' : 'progress';
  // R-172: the owner's name (full, else short — "S. Perrin" on a wizard project), as on the screen; '' without owner.
  const ownerName = planOwnerNames(data);
  const rows = planRows(data, todos).map((r) => {
    const a = r.act;
    return {
      level: t(LEVEL[r.kind] ?? r.kind), id: r.id, wbs: r.wbs, name: dataText(r.name, ctx.lang), owner: a?.owner ? ownerName(a) : '',
      duration: a ? a.durationDays : null, start: isoOf(r.start, yearOfIso(ctx.today)), startActual: a ? a.startActual : null, finish: isoOf(r.finish, yearOfIso(ctx.today)), finishActual: a ? a.finishActual : null,
      baselineFinish: isoOf(r.baselineFinish, yearOfIso(ctx.today)), variance: r.variance, float: a ? effectiveFloat(a) : r.tf, constraint: a?.constraint ? t(a.constraint) : '',
      pct: r.pct / 100, budget: r.budget, actual: a ? a.actual : null, eac: a ? a.eac : null, preds: a ? (a.preds.length ? predsLabel(a.preds) : '') : '',
      todos: r.todos.total ? `${r.todos.done}/${r.todos.total}` : '',
    };
  });
  const wbs = sheet(t('WBS & activities'), [
        col('level', t('Level'), 'text', 14), col('id', t('ID'), 'text', 8), col('wbs', 'WBS', 'text', 7), col('name', t('Name'), 'text', 40), col('owner', t('Owner'), 'text', 18),
        col('duration', t('Duration (d)'), 'integer'), col('start', t('Start date'), 'date'), col('startActual', t('Actual start'), 'boolean'), col('finish', t('Finish'), 'date'),
        col('finishActual', t('Actual finish'), 'boolean'), col('baselineFinish', t('Baseline finish'), 'date'), col('variance', t('Variance (d)'), 'integer'),
        col('float', t('Total float (d)'), 'integer'), col('constraint', t('Constraint'), 'text', 16), col('pct', t('% complete'), 'percent'), col('budget', t('Budget'), 'money_keur'),
        col('actual', t('Actual'), 'money_keur'), col('eac', 'EAC', 'money_keur'), col('preds', t('Predecessors'), 'text', 26), col('todos', t('To-dos'), 'text', 8),
      ], rows);
  return { t, view, data, dataDate, wbs, kpis: planKpis(view, data, t, ctx.lang, { dataDate }).map((k) => ({ label: k.label, value: k.value, sub: k.sub })) };
}

async function planWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  const p = await planSheet(ctx);
  if (!p) return null;
  const { t, view } = p;
  return {
    title: t('Plan — WBS & activities'),
    filters: [`${t('Display')}: ${t(view === 'structure' ? 'Structure' : 'Progress')}`],
    sheets: [p.wbs, kpiSheet(ctx, p.kpis)],
  };
}

/**
 * PDF of the detailed plan (S-9a, landscape): the Progress KPI tiles, then every WBS row — project, work packages and their
 * activities, indented — with dates, baseline finish, variance, float, % complete and logic. Costs stay in the Excel export.
 */
async function planReport(ctx: ExportContext): Promise<PdfDocument | null> {
  const p = await planSheet(ctx);
  if (!p || !ctx.project) return null;
  const { t } = p;
  const kpis = p.view === 'progress' ? p.kpis : planKpis('progress', p.data, t, ctx.lang, { dataDate: p.dataDate }).map((k) => ({ label: k.label, value: k.value, sub: k.sub }));
  const indent = (level: unknown, name: unknown) => `${level === t('Activity') ? '      ' : level === t('Work package') ? '   ' : ''}${String(name ?? '')}`;
  const rows = p.wbs.rows.map((r) => ({ ...r, name: indent(r.level, r.name) }));
  const keys = ['id', 'name', 'owner', 'duration', 'start', 'finish', 'baselineFinish', 'variance', 'float', 'constraint', 'pct', 'preds'];
  const width: Record<string, number> = { id: 6, name: 34, owner: 12, duration: 6, start: 9, finish: 9, baselineFinish: 9, variance: 7, float: 7, constraint: 11, pct: 9, preds: 14 };
  const columns = keys.map((k) => p.wbs.columns.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({ ...c, width: width[c.key] }));
  return {
    title: t('Plan — WBS & activities'),
    subtitle: t('Detailed plan'),
    project: projectRef(ctx),
    reference: ctx.project.code,
    date: todayIso(ctx),
    landscape: true,
    blocks: [
      { kind: 'kpis', items: kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub || undefined })) },
      { kind: 'table', sheet: { ...p.wbs, columns, rows } },
    ],
    footnote: t('Dates in working days at the project data date; variance against the current baseline.'),
  };
}

// ── Schedule ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function scheduleWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const data = await getScheduleData(ctx.project.code);
  if (!data) return null;
  const { t } = ctx;
  const view = scheduleView(data);
  const s0 = data.header.start;
  return {
    title: t('Schedule'),
    sheets: [
      sheet(t('Work packages'), [
        col('name', t('Work package'), 'text', 34), col('owner', t('Owner'), 'text', 14), col('bStart', t('Baseline start'), 'date'), col('bEnd', t('Baseline finish'), 'date'),
        col('fStart', t('Forecast start'), 'date'), col('fEnd', t('Forecast finish'), 'date'), col('pct', t('% complete'), 'percent'), col('slip', t('Slip (d)'), 'integer'),
        col('critical', t('Critical'), 'boolean'),
      ], data.bars.map((b, i) => ({
        name: dataText(b.name, ctx.lang), owner: b.owner, bStart: monthIso(s0 + b.baselineStart), bEnd: monthIso(s0 + b.baselineEnd), fStart: monthIso(s0 + b.forecastStart), fEnd: monthIso(s0 + b.forecastEnd),
        pct: b.pct / 100, slip: view.tasks[i]?.slip ?? null, critical: b.critical,
      }))),
      sheet(t('Milestones'), [
        col('name', t('Milestone'), 'text', 34), col('baseline', t('Baseline'), 'date'), col('forecast', t('Forecast'), 'date'), col('slip', t('Slip (d)'), 'integer'), col('status', t('Status'), 'text', 12),
      ], data.milestones.map((m, i) => ({
        name: dataText(m.name, ctx.lang), baseline: monthIso(s0 + m.baselineMonth), forecast: monthIso(s0 + m.forecastMonth), slip: view.milestones[i]?.slip ?? null, status: t(m.statusLabel),
      }))),
      sheet(t('Progression'), [col('month', t('Month'), 'text', 10), col('pv', 'PV', 'money_keur'), col('ev', 'EV', 'money_keur'), col('spi', 'SPI', 'number', 8, { decimals: 2 })],
        data.header.chartMonths.map((m, i) => ({ month: t(m), pv: data.pv[i] ?? null, ev: data.ev[i] ?? null, spi: view.progression[i]?.spi ?? null }))),
      kpiSheet(ctx, view.kpis.map((k) => ({ label: t(k.label), value: t(k.value), sub: t(k.sub) }))),
    ],
  };
}

/**
 * PDF of the Gantt (S-9a, landscape): the work packages' baseline vs forecast bars with progress and the critical path, the
 * data date, the milestones (baseline vs forecast diamonds), then the milestone table. `client` (client portal "Planning")
 * leaves out the internal indicators (SPI tile, owners); the internal report starts with the screen's KPI tiles.
 */
export async function scheduleDocument(ctx: ExportContext, audience: 'internal' | 'client'): Promise<PdfDocument | null> {
  if (!ctx.project) return null;
  const data = await getScheduleData(ctx.project.code);
  if (!data) return null;
  const { t, lang } = ctx;
  const view = scheduleView(data);
  const s0 = data.header.start;
  const span = Math.max(1, view.ganttMonths.length || GANTT_SPAN);
  const f = (m: number) => m / span;
  const slip = (txt: string) => slipText(txt, lang);
  const internal = audience === 'internal';
  const blocks: PdfBlock[] = [];
  const kpis = view.kpis.filter((k) => internal || (k.key !== 'spi' && k.key !== 'float'));
  blocks.push({ kind: 'kpis', items: kpis.map((k) => ({ label: t(k.label), value: k.key === 'spi' && k.value !== '—' ? ratioText(parseFloat(k.value), lang) : t(k.value), sub: t(k.sub) || undefined })) });
  blocks.push({ kind: 'heading', text: t('Schedule — baseline vs forecast') });
  blocks.push({
    kind: 'gantt',
    months: view.ganttMonths.map((m) => t(m)),
    rows: data.bars.map((b, i) => {
      const g = view.tasks[i];
      return {
        name: dataText(b.name, ctx.lang), sub: internal ? b.owner : undefined, done: g?.pctText ?? `${b.pct}%`, slip: g ? slip(g.slipText) : undefined, slipAlert: g?.slipAlert, critical: b.critical,
        baseline: [f(b.baselineStart), f(b.baselineEnd)] as [number, number], forecast: [f(b.forecastStart), f(b.forecastEnd)] as [number, number], progress: b.pct / 100,
      };
    }),
    milestones: data.milestones.map((m, i) => ({
      name: dataText(m.name, ctx.lang), slip: view.milestones[i] ? slip(view.milestones[i].slipText) : undefined, slipAlert: view.milestones[i]?.slipAlert,
      baseline: f(m.baselineMonth), forecast: f(m.forecastMonth), done: m.status === 'done',
    })),
    today: f(data.header.tNow),
    labels: {
      name: t('Work package'), done: t('Done'), slip: t('Slip'), milestones: t('Milestones'), baseline: t('Baseline'), forecast: t('Forecast'), progress: t('Progress'),
      critical: t('Critical path'), today: t('Today'),
    },
  });
  if (data.milestones.length) {
    blocks.push({ kind: 'heading', text: t('Milestones') });
    blocks.push({ kind: 'table', sheet: sheet(t('Milestones'), [
      col('name', t('Milestone'), 'text', 34), col('baseline', t('Baseline'), 'date', 12), col('forecast', t('Forecast'), 'date', 12), col('slip', t('Slip (d)'), 'integer', 8), col('status', t('Status'), 'text', 12),
    ], data.milestones.map((m, i) => ({
      name: dataText(m.name, ctx.lang), baseline: m.baselineDate ?? monthIso(s0 + m.baselineMonth), forecast: m.forecastDate ?? monthIso(s0 + m.forecastMonth), slip: view.milestones[i]?.slip ?? null, status: t(m.statusLabel),
    }))) });
  }
  return {
    title: t('Schedule'),
    subtitle: t('Schedule — baseline vs forecast'),
    project: projectRef(ctx),
    reference: ctx.project.code,
    date: todayIso(ctx),
    landscape: true,
    blocks,
    footnote: `${t('Forecast finish')} ${t(data.header.finishText)} · ${t('Baseline')} ${t(data.header.baselineText)}. ${t('Bars from the work packages’ dates at the project data date.')}`,
  };
}

const scheduleReport = (ctx: ExportContext) => scheduleDocument(ctx, 'internal');

// ── Hours ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function hoursWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const data = await getHoursReconciliation(ctx.project.code);
  if (!data) return null;
  const t = hrT(ctx.t, ctx.lang);
  const view = parseHoursView(param(ctx, 'view') ?? undefined);
  const lines = sheet(t('Lines'), [
    col('person', t('Person'), 'text', 20), col('wbs', 'WBS', 'text', 7), col('wp', t('Work package'), 'text', 30), col('planned', t('Planned (h)'), 'number', 10, { decimals: 1 }),
    col('declared', t('Declared (h)'), 'number', 10, { decimals: 1 }), col('delta', t('Delta (h)'), 'number', 10, { decimals: 1 }),
  ], data.lines.map((l) => ({ person: l.person, wbs: l.wbsCode, wp: t(l.wbsLabel), planned: l.plannedH, declared: l.declaredH, delta: l.declaredH - l.plannedH })));
  const groups = (name: string, gs: typeof data.byResource) => sheet(name, [
    col('label', t('Group'), 'text', 30), col('sub', t('Details'), 'text', 40), col('planned', t('Planned (h)'), 'number', 10, { decimals: 1 }),
    col('declared', t('Declared (h)'), 'number', 10, { decimals: 1 }), col('delta', t('Delta (h)'), 'number', 10, { decimals: 1 }),
  ], gs.map((g) => ({ label: t(g.label), sub: t(g.sub), planned: g.plannedH, declared: g.declaredH, delta: g.declaredH - g.plannedH })));
  const unassigned = sheet(t('Unassigned'), [col('person', t('Person'), 'text', 20), col('hours', t('Hours'), 'number', 8, { decimals: 1 }), col('reason', t('Reason'), 'text', 40), col('wbs', t('Assigned to'), 'text', 10)],
    data.unassigned.map((u) => ({ person: u.person, hours: u.hours, reason: dataText(u.reason, ctx.lang), wbs: u.assignedWbs ?? '' })));
  const byRes = groups(t('By resource'), data.byResource);
  const byWp = groups(t('By work package'), data.byWorkPackage);
  const first = view === 'wp' ? byWp : view === 'unassigned' ? unassigned : byRes;
  return {
    title: t('Hours — Lucca reconciliation'),
    filters: [`${t('Period')}: ${t(data.periodLabel)}`, `${t('Imported on')}: ${t(data.importedText)}`, `${t('Analytic code')}: ${data.analyticCode}`],
    sheets: [first, lines, ...[byRes, byWp, unassigned].filter((s) => s !== first)],
  };
}

// ── Contingency ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function contingencyWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const data = await getContingencyScreen(ctx.project.code);
  if (!data) return null;
  const { t, lang } = ctx;
  const c = data.contingency;
  const view = contingencyView(c, t, lang);
  return {
    title: t('Contingency register'),
    sheets: [
      sheet(t('Draw-downs'), [
        col('date', t('Date'), 'date'), col('amount', t('Amount'), 'money_keur'), col('reason', t('Reason'), 'text', 44), col('link', t('Linked to'), 'text', 12), col('by', t('Approved by'), 'text', 16),
      ], drawRows(c.draws).map((d) => ({ date: d.date, amount: d.amount, reason: dataText(d.reason, ctx.lang), link: d.linkRef ?? '', by: d.approvedBy ?? '' }))),
      kpiSheet(ctx, view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub }))),
    ],
  };
}

registerExportProvider({ screen: 'plan', table: planWorkbook, pdf: planReport });
registerExportProvider({ screen: 'schedule', table: scheduleWorkbook, pdf: scheduleReport });
registerExportProvider({ screen: 'hours', table: hoursWorkbook });
registerExportProvider({ screen: 'contingency', table: contingencyWorkbook });
