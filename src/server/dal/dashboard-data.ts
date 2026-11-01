import 'server-only';
// R-203 (K-203): the data of a dashboard's widgets, resolved for the VIEWER — whoever owns the dashboard. A widget is filled
// only when (1) the viewer's role has the widget's source screen in its workspace (`canSeeWidget`, src/domain/dashboards.ts),
// and (2) for a project widget, the project exists, has data and is not refused to the viewer (`projectAccess`, R-041 / R-042).
// Otherwise the widget comes back `denied` or `unavailable` with no figure, no name and no row: a dashboard shared with
// someone never shows them what their own rights would not.
// Every figure is an existing Keystone indicator, read through the DAL of the screen that shows it: the Portfolio overview's
// KPI tiles and alerts (src/server/dal/portfolio.ts, R-130), the My projects card metrics (`overviewMetrics`), My work's tasks,
// My approvals' queue, the risk register, the punch list, the Schedule's milestones and the Budget's S-curve.
import type { Persona } from '@/config/personas';
import { canSeeWidget, inPeriod, type DashboardZone, type Scope, type Widget } from '@/domain/dashboards';
import { uncertaintyTotals } from '@/domain/estimate-class';
import { evmCore, offerPoints, type DisbursementPoint, type EvmCore } from '@/domain/evm';
import { inExecution, overviewMetrics, portfolioKpis, portfolioTotals, uncertaintyKpi, type KpiView, type PortfolioAlert } from '@/domain/portfolio';
import type { Lang } from '@/i18n/translate';
import { projectLabelText } from '@/i18n/data-text';
import { money } from '@/lib/format';
import { getApprovalInbox } from '@/server/approvals';
import { businessToday } from '@/server/clock';
import { fmtDOfIso } from '@/server/db/codes';
import { yearOfIso } from '@/domain/clock';
import { dateOf } from '@/lib/format';
import { projectAccessResolver } from '@/server/project-context';
import { getCostControl } from './cost';
import { listBudgetEstimates } from './estimate-class';
import { healthThresholds } from './health-thresholds';
import { listPunchItems } from './itp';
import { getMilestones, getScheduleControl } from './planning';
import { getPortfolioOverview } from './portfolio';
import { listProjects, type ProjectRow } from './projects';
import { getOpenRiskExposure, listRisks } from './risks';
import { listTasks, type TaskRow } from './tasks';

/** A list row: texts are typed data (`text`, shown with dataText) or EN source strings (`label`, through t()). */
export interface WidgetRow {
  key: string;
  /** Reference ("T-2314", "R-03", "PL-012"); empty when none. */
  ref: string;
  /** Typed text (dataText). */
  text: string;
  /** Second line, typed text or formatted values (dataText). */
  sub: string;
  /** EN source status label (t()). */
  status: string;
  /** Due / date text, EN source (t()); '' when none. */
  date: string;
  /** Shown in LO (overdue, late, critical). */
  alert: boolean;
  /** Link to the record's screen. */
  href: string;
}

export type WidgetView =
  | { type: 'kpi'; kpi: KpiView }
  | { type: 'alerts'; alerts: PortfolioAlert[] }
  | { type: 'list'; rows: WidgetRow[]; total: number; href: string }
  | { type: 'evm'; series: { pv: number[]; ev: number[]; ac: number[]; bac: number }; eac: number; points: DisbursementPoint[]; chartMonths: string[]; href: string };

export type WidgetData =
  /** The viewer's role does not have the widget's source screen: nothing is read. */
  | { state: 'denied' }
  /** The project is unknown, refused to the viewer, or has no data yet. */
  | { state: 'unavailable' }
  | { state: 'ok'; view: WidgetView; /** Project label of a project widget (typed name, already in the render language). */ projectLabel: string | null };

export interface ResolvedWidget {
  widget: Widget;
  data: WidgetData;
}

const memo = <T>(f: (key: string) => Promise<T>) => {
  const m = new Map<string, Promise<T>>();
  return (key: string) => {
    if (!m.has(key)) m.set(key, f(key));
    return m.get(key)!;
  };
};

/**
 * Resolves the widgets of a layout for a viewer (one read per source, shared by the widgets that use it). The viewer is the
 * one looking at the page — the owner or a recipient of a shared dashboard.
 */
export async function resolveWidgets(viewer: Persona, widgets: readonly Widget[], lang: Lang): Promise<ResolvedWidget[]> {
  if (!widgets.length) return [];
  const [today, access, all, th] = await Promise.all([businessToday(), projectAccessResolver(viewer), listProjects(), healthThresholds()]);
  const byCode = new Map(all.map((p) => [p.code, p]));
  const mine = (p: Pick<ProjectRow, 'code' | 'pm' | 'client' | 'clientInternal' | 'pmPersonId'>) => access(p).member;
  /** A project the viewer may read, with data; null otherwise. */
  const readable = (code: string) => {
    const p = byCode.get(code);
    return p && p.hasData && !access(p).refused ? p : null;
  };

  const overview = memo((zone) => getPortfolioOverview((zone || null) as DashboardZone | null, lang));
  const estimates = memo(() => listBudgetEstimates());
  const myTasks = memo(() => listTasks({ person: viewer.name }));
  const inbox = memo(() => getApprovalInbox(viewer, { lang }));
  const risks = memo((code) => listRisks(code));
  const punch = memo((code) => listPunchItems(code));
  const miles = memo((code) => getMilestones(code));
  const sched = memo((code) => getScheduleControl(code));

  async function portfolioKpi(metric: string, scope: Scope, zone: DashboardZone | null): Promise<KpiView | null> {
    const o = await overview(zone ?? '');
    if (scope === 'all') return o.kpis.find((k) => k.key === metric) ?? null;
    // "My projects": the overview's own formulas over the projects of the viewer's teams only.
    const rows = o.rows.filter(mine);
    const est = await estimates('');
    const kpis = [...portfolioKpis(portfolioTotals(rows), lang, th), uncertaintyKpi(uncertaintyTotals(rows.map((p) => ({ amount: p.budget, estimateClass: est.get(p.code)?.estimateClass ?? null }))), lang)];
    return kpis.find((k) => k.key === metric) ?? null;
  }

  const openTasks = async (project: string | null) =>
    (await myTasks('')).filter((t) => t.status !== 'done' && (!project || t.project.code === project));
  const taskRow = (t: TaskRow): WidgetRow => ({
    key: t.id, ref: t.id, text: t.title, sub: `${t.project.code}${t.activity ? ` · ${t.activity.code}` : ''}`, status: t.statusLabel,
    date: fmtDOfIso(t.due, yearOfIso(today)), alert: t.due < today, href: `/my/tasks/${t.id}`,
  });

  async function projectKpi(p: ProjectRow, metric: string): Promise<KpiView> {
    const label = projectLabelText(p, lang);
    switch (metric) {
      case 'progress':
      case 'cpi':
      case 'spi': {
        // The My projects card's figures (A-13: one health rule, Settings thresholds).
        const m = overviewMetrics(p, th);
        if (metric === 'progress') return { key: metric, label: 'Progress', value: m.progressPct, sub: label, alert: false };
        return { key: metric, label: metric.toUpperCase(), value: m[metric].toFixed(2), sub: label, alert: metric === 'cpi' ? m.cpiAlert : m.spiAlert };
      }
      case 'openRisks': {
        const open = (await risks(p.code)).filter((r) => r.status === 'open');
        const critical = open.filter((r) => r.level === 'critical').length;
        return { key: metric, label: 'Open risks', value: String(open.length), sub: label, alert: critical > 0 };
      }
      case 'riskExposure':
        return { key: metric, label: 'Risk exposure', value: money(await getOpenRiskExposure(p.code), lang), sub: label, alert: false };
      case 'openPunch': {
        const open = (await punch(p.code)).filter((x) => x.open);
        return { key: metric, label: 'Open punch items', value: String(open.length), sub: label, alert: open.some((x) => !!x.dueOn && x.dueOn < today) };
      }
      default: {
        const late = (await miles(p.code)).filter((m) => m.status === 'late').length;
        return { key: metric, label: 'Late milestones', value: String(late), sub: label, alert: late > 0 };
      }
    }
  }

  async function resolve(w: Widget): Promise<WidgetData> {
    if (!canSeeWidget(viewer.role, w)) return { state: 'denied' };
    switch (w.kind) {
      case 'portfolio-kpi': {
        const kpi = await portfolioKpi(w.metric, w.scope, w.zone);
        return kpi ? { state: 'ok', view: { type: 'kpi', kpi }, projectLabel: null } : { state: 'unavailable' };
      }
      case 'portfolio-alerts': {
        const o = await overview(w.zone ?? '');
        // "My projects": the alerts about a project of the viewer's teams (portfolio-wide alerts are left out).
        const alerts = o.alerts.filter((a) => w.scope === 'all' || (!!a.code && !!byCode.get(a.code) && mine(byCode.get(a.code)!))).slice(0, w.limit);
        return { state: 'ok', view: { type: 'alerts', alerts }, projectLabel: null };
      }
      case 'my-kpi': {
        if (w.metric === 'pendingApprovals') {
          const n = (await inbox('')).items.length;
          return { state: 'ok', view: { type: 'kpi', kpi: { key: w.metric, label: 'Pending approvals', value: String(n), sub: 'Waiting for my decision', alert: n > 0 } }, projectLabel: null };
        }
        const open = await openTasks(null);
        const n = w.metric === 'overdueTasks' ? open.filter((t) => t.due < today).length : open.length;
        const label = w.metric === 'overdueTasks' ? 'My overdue tasks' : 'My open tasks';
        return { state: 'ok', view: { type: 'kpi', kpi: { key: w.metric, label, value: String(n), sub: w.metric === 'overdueTasks' ? 'Needs a new date or a push' : 'Not done yet', alert: w.metric === 'overdueTasks' && n > 0 } }, projectLabel: null };
      }
      case 'my-tasks': {
        if (w.project && !readable(w.project)) return { state: 'unavailable' };
        const open = (await openTasks(w.project)).filter((t) => inPeriod(t.due, today, w.period)).sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
        const p = w.project ? readable(w.project) : null;
        return { state: 'ok', view: { type: 'list', rows: open.slice(0, w.limit).map(taskRow), total: open.length, href: '/my/tasks' }, projectLabel: p ? projectLabelText(p, lang) : null };
      }
    }
    // Project widgets.
    const p = readable(w.project);
    if (!p) return { state: 'unavailable' };
    const projectLabel = projectLabelText(p, lang);
    const base = `/projects/${encodeURIComponent(p.code)}`;
    switch (w.kind) {
      case 'project-kpi':
        return { state: 'ok', view: { type: 'kpi', kpi: await projectKpi(p, w.metric) }, projectLabel };
      case 'project-milestones': {
        const [rows, head] = await Promise.all([miles(p.code), sched(p.code)]);
        const start = head?.start ?? 0;
        return {
          state: 'ok', projectLabel,
          view: {
            type: 'list', total: rows.length, href: `${base}/schedule`,
            rows: rows.map((m) => ({
              key: String(m.position), ref: '', text: m.name, sub: '', status: m.statusLabel, date: dateOf(m.forecastMonth + start), alert: m.status === 'late', href: `${base}/schedule`,
            })),
          },
        };
      }
      case 'project-risks': {
        const open = (await risks(p.code)).filter((r) => r.status === 'open').sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        return {
          state: 'ok', projectLabel,
          view: {
            type: 'list', total: open.length, href: `${base}/risks`,
            rows: open.slice(0, w.limit).map((r) => ({
              key: r.id, ref: r.id, text: r.title, sub: r.owner ?? '', status: r.levelLabel, date: '', alert: r.level === 'critical', href: `${base}/risks`,
            })),
          },
        };
      }
      case 'project-punch': {
        const open = (await punch(p.code)).filter((x) => x.open && inPeriod(x.dueOn, today, w.period));
        open.sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || a.number.localeCompare(b.number));
        return {
          state: 'ok', projectLabel,
          view: {
            type: 'list', total: open.length, href: `${base}/itp`,
            rows: open.slice(0, w.limit).map((x) => ({
              key: x.number, ref: x.number, text: x.description, sub: x.owner ?? '', status: x.statusLabel, date: x.dueOn ? fmtDOfIso(x.dueOn, yearOfIso(today)) : '',
              alert: !!x.dueOn && x.dueOn < today, href: `${base}/itp`,
            })),
          },
        };
      }
      case 'project-evm': {
        const cost = await getCostControl(p.code);
        if (!cost) return { state: 'unavailable' };
        const core: EvmCore = evmCore({ pv: cost.pv, ev: cost.ev, ac: cost.ac, bac: cost.bac });
        return {
          state: 'ok', projectLabel,
          view: { type: 'evm', series: { pv: cost.pv, ev: cost.ev, ac: cost.ac, bac: cost.bac }, eac: core.eac, points: offerPoints(cost.offer), chartMonths: cost.chartMonths, href: `${base}/budget` },
        };
      }
    }
  }

  return Promise.all(widgets.map(async (widget) => ({ widget, data: await resolve(widget) })));
}

/** Projects a viewer can pick for a project widget: in the register with data, not refused (register order). */
export async function dashboardProjectChoices(viewer: Persona, lang: Lang): Promise<{ code: string; label: string; inExecution: boolean }[]> {
  const [all, access] = await Promise.all([listProjects(), projectAccessResolver(viewer)]);
  return all.filter((p) => p.hasData && !access(p).refused).map((p) => ({ code: p.code, label: projectLabelText(p, lang), inExecution: inExecution(p) }));
}
