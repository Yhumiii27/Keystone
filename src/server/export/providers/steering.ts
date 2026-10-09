// Export providers — project steering: Plan (WBS & activities), Schedule, Hours reconciliation and Contingency register.
// Plan: every WBS row (project, work packages, activities) with dates, float, progress, budget and logic, in display
// order — Excel holds both views (structure and progress columns); Schedule: work-package bars, milestones and the
// monthly progression (dates from the month offsets the screen draws); Hours: the lines of the latest import grouped as
// the screen's `?view=` (by resource / work package / unassigned); Contingency: the draw-downs, most recent first.
import { drawRows } from '@/domain/contingency';
import { parseHoursView } from '@/domain/hr';
import { scheduleView } from '@/domain/schedule-gantt';
import { effectiveFloat, predsLabel } from '@/domain/schedule';
import { hrT } from '@/features/hr/i18n';
import { planKpis, planRows } from '@/features/plan/model';
import { planT } from '@/features/plan/i18n';
import { contingencyView } from '@/features/risks/model';
import { getHoursReconciliation } from '@/server/dal/hr';
import { getPlanData, getPlanTodos } from '@/server/dal/plan';
import { getContingencyScreen } from '@/server/dal/risks-screen';
import { getScheduleData } from '@/server/dal/schedule';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportWorkbook } from '../types';
import { col, isoOf, kpiSheet, monthIso, param, sheet } from './common';

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const LEVEL: Record<string, string> = { root: 'Project', wp: 'Work package', act: 'Activity' };

async function planWorkbook(ctx: ExportContext): Promise<ExportWorkbook | null> {
  if (!ctx.project) return null;
  const [data, todos] = await Promise.all([getPlanData(ctx.project.code), getPlanTodos(ctx.project.code)]);
  if (!data) return null;
  const t = planT(ctx.t, ctx.lang);
  const view = param(ctx, 'view') === 'structure' ? 'structure' : 'progress';
  const owner = new Map(data.owners.map((o) => [o.code, o.name]));
  const rows = planRows(data, todos).map((r) => {
    const a = r.act;
    return {
      level: t(LEVEL[r.kind] ?? r.kind), id: r.id, wbs: r.wbs, name: t(r.name), owner: a ? (a.owner ? owner.get(a.owner) ?? a.owner : '') : '',
      duration: a ? a.durationDays : null, start: isoOf(r.start), startActual: a ? a.startActual : null, finish: isoOf(r.finish), finishActual: a ? a.finishActual : null,
      baselineFinish: isoOf(r.baselineFinish), variance: r.variance, float: a ? effectiveFloat(a) : r.tf, constraint: a?.constraint ? t(a.constraint) : '',
      pct: r.pct / 100, budget: r.budget, actual: a ? a.actual : null, eac: a ? a.eac : null, preds: a ? (a.preds.length ? predsLabel(a.preds) : '') : '',
      todos: r.todos.total ? `${r.todos.done}/${r.todos.total}` : '',
    };
  });
  return {
    title: t('Plan — WBS & activities'),
    filters: [`${t('Display')}: ${t(view === 'structure' ? 'Structure' : 'Progress')}`],
    sheets: [
      sheet(t('WBS & activities'), [
        col('level', t('Level'), 'text', 14), col('id', t('ID'), 'text', 8), col('wbs', 'WBS', 'text', 7), col('name', t('Name'), 'text', 40), col('owner', t('Owner'), 'text', 18),
        col('duration', t('Duration (d)'), 'integer'), col('start', t('Start date'), 'date'), col('startActual', t('Actual start'), 'boolean'), col('finish', t('Finish'), 'date'),
        col('finishActual', t('Actual finish'), 'boolean'), col('baselineFinish', t('Baseline finish'), 'date'), col('variance', t('Variance (d)'), 'integer'),
        col('float', t('Total float (d)'), 'integer'), col('constraint', t('Constraint'), 'text', 16), col('pct', t('% complete'), 'percent'), col('budget', t('Budget'), 'money_keur'),
        col('actual', t('Actual'), 'money_keur'), col('eac', 'EAC', 'money_keur'), col('preds', t('Predecessors'), 'text', 26), col('todos', t('To-dos'), 'text', 8),
      ], rows),
      kpiSheet(ctx, planKpis(view, data, t, ctx.lang).map((k) => ({ label: k.label, value: k.value, sub: k.sub }))),
    ],
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
        name: t(b.name), owner: b.owner, bStart: monthIso(s0 + b.baselineStart), bEnd: monthIso(s0 + b.baselineEnd), fStart: monthIso(s0 + b.forecastStart), fEnd: monthIso(s0 + b.forecastEnd),
        pct: b.pct / 100, slip: view.tasks[i]?.slip ?? null, critical: b.critical,
      }))),
      sheet(t('Milestones'), [
        col('name', t('Milestone'), 'text', 34), col('baseline', t('Baseline'), 'date'), col('forecast', t('Forecast'), 'date'), col('slip', t('Slip (d)'), 'integer'), col('status', t('Status'), 'text', 12),
      ], data.milestones.map((m, i) => ({
        name: t(m.name), baseline: monthIso(s0 + m.baselineMonth), forecast: monthIso(s0 + m.forecastMonth), slip: view.milestones[i]?.slip ?? null, status: t(m.statusLabel),
      }))),
      sheet(t('Progression'), [col('month', t('Month'), 'text', 10), col('pv', 'PV', 'money_keur'), col('ev', 'EV', 'money_keur'), col('spi', 'SPI', 'number', 8, { decimals: 2 })],
        data.header.chartMonths.map((m, i) => ({ month: t(m), pv: data.pv[i] ?? null, ev: data.ev[i] ?? null, spi: view.progression[i]?.spi ?? null }))),
      kpiSheet(ctx, view.kpis.map((k) => ({ label: t(k.label), value: t(k.value), sub: t(k.sub) }))),
    ],
  };
}

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
    data.unassigned.map((u) => ({ person: u.person, hours: u.hours, reason: t(u.reason), wbs: u.assignedWbs ?? '' })));
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
      ], drawRows(c.draws).map((d) => ({ date: d.date, amount: d.amount, reason: t(d.reason), link: d.linkRef ?? '', by: d.approvedBy ?? '' }))),
      kpiSheet(ctx, view.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub }))),
    ],
  };
}

registerExportProvider({ screen: 'plan', table: planWorkbook });
registerExportProvider({ screen: 'schedule', table: scheduleWorkbook });
registerExportProvider({ screen: 'hours', table: hoursWorkbook });
registerExportProvider({ screen: 'contingency', table: contingencyWorkbook });
