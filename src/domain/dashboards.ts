// R-203 (K-203, owner 1 Nov 2026: « Lancer »): user-configurable dashboards. Each user composes their own dashboards from a
// catalogue of widgets built on Keystone's EXISTING indicators and lists — no new indicator here: the portfolio KPI tiles and
// the "Needs attention" alerts of the Portfolio overview (R-130), the My projects indicators (progress, CPI, SPI), the risk
// register, the punch list, the milestones of the Schedule, the Budget's S-curve, My work's tasks and My approvals' queue.
// This module is pure (no I/O): the widget catalogue, the layout schema (zod), the rights gate of a widget, the layout edits
// (add, remove, move, resize) and the period filter. Data are resolved on the server for the VIEWER (src/server/dal/
// dashboard-data.ts): a dashboard shared with someone never shows them what their own role and rights would not.
import { z } from 'zod';
import { canSee } from '@/config/role-screens';
import type { RoleKey, ScreenId } from '@/config/screens';

/** Name of a dashboard (typed text, shown as typed). */
export const DASHBOARD_NAME_MAX = 80;
/** Widgets on one dashboard. */
export const DASHBOARD_MAX_WIDGETS = 24;
/** Dashboards a user owns. */
export const DASHBOARDS_PER_USER_MAX = 20;
/** People a dashboard is shared with. */
export const DASHBOARD_SHARES_MAX = 50;
/** Rows of a list widget. */
export const LIST_LIMIT_MAX = 20;
export const LIST_LIMIT_DEFAULT = 8;

export const ZONE_KEYS = ['euna', 'afr', 'apac'] as const;
export type DashboardZone = (typeof ZONE_KEYS)[number];

/** Portfolio overview KPI tiles (src/domain/portfolio.ts `portfolioKpis` + `uncertaintyKpi` keys). */
export const PORTFOLIO_METRICS = ['budget', 'actual', 'eac', 'cpi', 'spi', 'risk', 'uncertainty'] as const;
/** The viewer's own counters (My work, My approvals). */
export const MY_METRICS = ['openTasks', 'overdueTasks', 'pendingApprovals'] as const;
/** One project's indicators (My projects card, Risk register, Punch list, Schedule milestones). */
export const PROJECT_METRICS = ['progress', 'cpi', 'spi', 'openRisks', 'riskExposure', 'openPunch', 'lateMilestones'] as const;
/** Due-date window of a list (tasks, punch items): overdue only, due within 7 / 30 days (overdue included), everything open. */
export const PERIODS = ['overdue', 'week', 'month', 'all'] as const;
/** Population of a portfolio widget: every project the screen shows, or only the projects whose team the viewer is on. */
export const SCOPES = ['all', 'mine'] as const;
/** Grid width of a widget: one column, two columns, the whole row. */
export const WIDGET_SIZES = ['s', 'm', 'l'] as const;

export type PortfolioMetric = (typeof PORTFOLIO_METRICS)[number];
export type MyMetric = (typeof MY_METRICS)[number];
export type ProjectMetric = (typeof PROJECT_METRICS)[number];
export type Period = (typeof PERIODS)[number];
export type Scope = (typeof SCOPES)[number];
export type WidgetSize = (typeof WIDGET_SIZES)[number];

const projectCode = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const limit = z.number().int().min(1).max(LIST_LIMIT_MAX);
const base = { id: z.string().regex(/^[a-z0-9]{1,16}$/), size: z.enum(WIDGET_SIZES) };

/** One widget of a layout. Discriminated by `kind`; every parameter is checked (zod) before a layout is stored. */
export const widgetSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('portfolio-kpi'), metric: z.enum(PORTFOLIO_METRICS), scope: z.enum(SCOPES), zone: z.enum(ZONE_KEYS).nullable() }).strict(),
  z.object({ ...base, kind: z.literal('portfolio-alerts'), scope: z.enum(SCOPES), zone: z.enum(ZONE_KEYS).nullable(), limit }).strict(),
  z.object({ ...base, kind: z.literal('my-kpi'), metric: z.enum(MY_METRICS) }).strict(),
  z.object({ ...base, kind: z.literal('my-tasks'), period: z.enum(PERIODS), project: projectCode.nullable(), limit }).strict(),
  z.object({ ...base, kind: z.literal('project-kpi'), project: projectCode, metric: z.enum(PROJECT_METRICS) }).strict(),
  z.object({ ...base, kind: z.literal('project-milestones'), project: projectCode }).strict(),
  z.object({ ...base, kind: z.literal('project-risks'), project: projectCode, limit }).strict(),
  z.object({ ...base, kind: z.literal('project-punch'), project: projectCode, period: z.enum(PERIODS), limit }).strict(),
  z.object({ ...base, kind: z.literal('project-evm'), project: projectCode }).strict(),
]);

export type Widget = z.infer<typeof widgetSchema>;
export type WidgetKind = Widget['kind'];
/** A widget without its id (Omit distributed over the union). */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WidgetDraft = DistOmit<Widget, 'id'>;

/** A dashboard's layout: the widgets in reading order (the grid fills rows left to right). */
export const layoutSchema = z
  .object({ version: z.literal(1), widgets: z.array(widgetSchema).max(DASHBOARD_MAX_WIDGETS) })
  .strict()
  .refine((l) => new Set(l.widgets.map((w) => w.id)).size === l.widgets.length, { message: 'Duplicate widget id' });

export type DashboardLayout = z.infer<typeof layoutSchema>;

export const EMPTY_LAYOUT: DashboardLayout = { version: 1, widgets: [] };

/** A stored layout read back (jsonb): a value that no longer validates is shown as an empty dashboard, never trusted. */
export function parseLayout(v: unknown): DashboardLayout | null {
  const r = layoutSchema.safeParse(v);
  return r.success ? r.data : null;
}

/** A dashboard name as typed: trimmed, inner whitespace collapsed; null when empty or too long. */
export function cleanDashboardName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= DASHBOARD_NAME_MAX ? s : null;
}

// ── Catalogue ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WidgetKindDef {
  kind: WidgetKind;
  /** EN source string. */
  label: string;
  /** EN source string: what the widget shows and where it comes from. */
  hint: string;
  /** The widget needs a project. */
  project: boolean;
  defaultSize: WidgetSize;
}

export const WIDGET_KINDS: readonly WidgetKindDef[] = [
  { kind: 'portfolio-kpi', label: 'Portfolio indicator', hint: 'A KPI tile of the Portfolio overview', project: false, defaultSize: 's' },
  { kind: 'portfolio-alerts', label: 'Portfolio alerts', hint: 'The “Needs attention” alerts of the Portfolio overview', project: false, defaultSize: 'l' },
  { kind: 'my-kpi', label: 'My counter', hint: 'My open or overdue tasks, my pending approvals', project: false, defaultSize: 's' },
  { kind: 'my-tasks', label: 'My tasks', hint: 'My open tasks by due date (My work)', project: false, defaultSize: 'm' },
  { kind: 'project-kpi', label: 'Project indicator', hint: 'One indicator of a project', project: true, defaultSize: 's' },
  { kind: 'project-milestones', label: 'Project milestones', hint: 'The milestones of a project’s schedule', project: true, defaultSize: 'm' },
  { kind: 'project-risks', label: 'Top risks', hint: 'The open risks of a project, highest score first', project: true, defaultSize: 'm' },
  { kind: 'project-punch', label: 'Open punch items', hint: 'The open items of a project’s punch list', project: true, defaultSize: 'm' },
  { kind: 'project-evm', label: 'Budget vs cost (S-curve)', hint: 'The earned-value chart of the Budget screen', project: true, defaultSize: 'l' },
];
export const WIDGET_KIND_DEF = Object.fromEntries(WIDGET_KINDS.map((d) => [d.kind, d])) as Record<WidgetKind, WidgetKindDef>;

/** EN labels of the parameters (rendered through t()). */
export const PORTFOLIO_METRIC_LABEL: Record<PortfolioMetric, string> = {
  budget: 'Total budget', actual: 'Actual cost', eac: 'Forecast (EAC)', cpi: 'Cost perf. (CPI)', spi: 'Schedule perf. (SPI)', risk: 'Projects at risk',
  uncertainty: 'Uncertainty gap',
};
export const MY_METRIC_LABEL: Record<MyMetric, string> = { openTasks: 'My open tasks', overdueTasks: 'My overdue tasks', pendingApprovals: 'Pending approvals' };
export const PROJECT_METRIC_LABEL: Record<ProjectMetric, string> = {
  progress: 'Progress', cpi: 'CPI', spi: 'SPI', openRisks: 'Open risks', riskExposure: 'Risk exposure', openPunch: 'Open punch items', lateMilestones: 'Late milestones',
};
export const PERIOD_LABEL: Record<Period, string> = { overdue: 'Overdue only', week: 'Due within 7 days', month: 'Due within 30 days', all: 'All open' };
export const SCOPE_LABEL: Record<Scope, string> = { all: 'Whole portfolio', mine: 'My projects' };
export const SIZE_LABEL: Record<WidgetSize, string> = { s: 'Small', m: 'Medium', l: 'Wide' };

// ── Rights ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The screen whose data a widget shows. A widget is shown to a viewer only when that screen is in the viewer's workspace
 * (`canSee`) — stricter than the screens themselves, which internal roles may open read-only outside their workspace:
 * a dashboard never becomes a way round the navigation of a role.
 */
export function widgetScreen(w: Pick<Widget, 'kind'> & { metric?: string }): ScreenId {
  switch (w.kind) {
    case 'portfolio-kpi':
    case 'portfolio-alerts':
      return 'overview';
    case 'my-kpi':
      return w.metric === 'pendingApprovals' ? 'myapprovals' : 'mywork';
    case 'my-tasks':
      return 'mywork';
    case 'project-kpi':
      // Progress, CPI and SPI are the My projects card's (every internal role); the others follow their register.
      return w.metric === 'openRisks' || w.metric === 'riskExposure' ? 'risks' : w.metric === 'openPunch' ? 'itp' : w.metric === 'lateMilestones' ? 'schedule' : 'myprojects';
    case 'project-milestones':
      return 'schedule';
    case 'project-risks':
      return 'risks';
    case 'project-punch':
      return 'itp';
    case 'project-evm':
      return 'budget';
  }
}

/** My dashboards is an internal screen: a client has no dashboards and sees no widget (R-042). */
export const canUseDashboards = (role: RoleKey) => role !== 'client' && canSee(role, 'dashboards');

/** The viewer's role may see this widget's data (the role gate; the project rights are the server's). */
export const canSeeWidget = (role: RoleKey, w: Pick<Widget, 'kind'> & { metric?: string }) => canUseDashboards(role) && canSee(role, widgetScreen(w));

/** Widget kinds a role can add (at least one of their metrics is in the role's workspace). */
export function availableKinds(role: RoleKey): WidgetKindDef[] {
  if (!canUseDashboards(role)) return [];
  return WIDGET_KINDS.filter((d) => metricsOf(d.kind).some((metric) => canSeeWidget(role, { kind: d.kind, metric })));
}

/** Metrics of a kind ([undefined] for a kind without metric). */
function metricsOf(kind: WidgetKind): (string | undefined)[] {
  if (kind === 'portfolio-kpi') return [...PORTFOLIO_METRICS];
  if (kind === 'my-kpi') return [...MY_METRICS];
  if (kind === 'project-kpi') return [...PROJECT_METRICS];
  return [undefined];
}

/** Metrics of a KPI kind the role may see (the add / edit form lists only these). */
export function availableMetrics(role: RoleKey, kind: 'portfolio-kpi' | 'my-kpi' | 'project-kpi'): string[] {
  return metricsOf(kind).filter((metric): metric is string => !!metric && canSeeWidget(role, { kind, metric }));
}

/** The first widget of a layout the role may not add (the owner's save is refused), or null. */
export const forbiddenWidget = (role: RoleKey, layout: DashboardLayout): Widget | null => layout.widgets.find((w) => !canSeeWidget(role, w)) ?? null;

// ── Layout edits (pure; the page sends the whole new layout, the server validates it) ──────────────────────────────────────

/** A widget id not yet used in the layout (base-36 counter). */
export function nextWidgetId(layout: DashboardLayout): string {
  const used = new Set(layout.widgets.map((w) => w.id));
  for (let i = 1; ; i++) {
    const id = 'w' + i.toString(36);
    if (!used.has(id)) return id;
  }
}

/** Adds a widget at the end (its id is given by the layout); unchanged when the layout is full. */
export function addWidget(layout: DashboardLayout, w: WidgetDraft): DashboardLayout {
  if (layout.widgets.length >= DASHBOARD_MAX_WIDGETS) return layout;
  return { ...layout, widgets: [...layout.widgets, { ...w, id: nextWidgetId(layout) } as Widget] };
}

export function removeWidget(layout: DashboardLayout, id: string): DashboardLayout {
  return { ...layout, widgets: layout.widgets.filter((w) => w.id !== id) };
}

/** Replaces a widget's parameters (same id and position). */
export function replaceWidget(layout: DashboardLayout, w: Widget): DashboardLayout {
  return { ...layout, widgets: layout.widgets.map((x) => (x.id === w.id ? w : x)) };
}

/** Moves a widget by `delta` places (−1 = earlier, +1 = later), clamped to the layout; unchanged for an unknown id. */
export function moveWidget(layout: DashboardLayout, id: string, delta: number): DashboardLayout {
  const from = layout.widgets.findIndex((w) => w.id === id);
  if (from < 0) return layout;
  const to = Math.max(0, Math.min(layout.widgets.length - 1, from + delta));
  if (to === from) return layout;
  const widgets = [...layout.widgets];
  const [w] = widgets.splice(from, 1);
  widgets.splice(to, 0, w);
  return { ...layout, widgets };
}

/** Moves a widget to `index` (drag and drop). */
export function moveWidgetTo(layout: DashboardLayout, id: string, index: number): DashboardLayout {
  const from = layout.widgets.findIndex((w) => w.id === id);
  return from < 0 ? layout : moveWidget(layout, id, index - from);
}

export function resizeWidget(layout: DashboardLayout, id: string, size: WidgetSize): DashboardLayout {
  return { ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, size } : w)) };
}

/**
 * A widget's default parameters for a kind (the add form starts from these). A project widget without a project gets '' (the
 * form asks for one; the schema refuses '').
 */
export function defaultWidget(kind: WidgetKind, opts: { role: RoleKey; project: string | null }): WidgetDraft {
  const size = WIDGET_KIND_DEF[kind].defaultSize;
  const p = opts.project ?? '';
  switch (kind) {
    case 'portfolio-kpi':
      return { kind, size, metric: (availableMetrics(opts.role, kind)[0] as PortfolioMetric) ?? 'cpi', scope: 'all', zone: null };
    case 'portfolio-alerts':
      return { kind, size, scope: 'all', zone: null, limit: LIST_LIMIT_DEFAULT };
    case 'my-kpi':
      return { kind, size, metric: (availableMetrics(opts.role, kind)[0] as MyMetric) ?? 'openTasks' };
    case 'my-tasks':
      return { kind, size, period: 'all', project: null, limit: LIST_LIMIT_DEFAULT };
    case 'project-kpi':
      return { kind, size, project: p, metric: (availableMetrics(opts.role, kind)[0] as ProjectMetric) ?? 'progress' };
    case 'project-milestones':
    case 'project-evm':
      return { kind, size, project: p };
    case 'project-risks':
      return { kind, size, project: p, limit: LIST_LIMIT_DEFAULT };
    case 'project-punch':
      return { kind, size, project: p, period: 'all', limit: LIST_LIMIT_DEFAULT };
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Adds days to an ISO date (UTC arithmetic, no time zone involved). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * An open item's due date (ISO, null = none) falls in the period at `today` (the business date, R-013): overdue = before
 * today; week / month = overdue or due within 7 / 30 days; all = every open item (no due date included).
 */
export function inPeriod(due: string | null, today: string, period: Period): boolean {
  if (period === 'all') return true;
  if (!due) return false;
  if (period === 'overdue') return due < today;
  return due <= addDaysIso(today, period === 'week' ? 7 : 30);
}

/** Display title of a widget (EN source parts, translated by the caller): the metric or the kind, then the project. */
export function widgetTitleParts(w: Widget): { label: string; project: string | null } {
  switch (w.kind) {
    case 'portfolio-kpi':
      return { label: PORTFOLIO_METRIC_LABEL[w.metric], project: null };
    case 'my-kpi':
      return { label: MY_METRIC_LABEL[w.metric], project: null };
    case 'project-kpi':
      return { label: PROJECT_METRIC_LABEL[w.metric], project: w.project };
    case 'my-tasks':
      return { label: WIDGET_KIND_DEF[w.kind].label, project: w.project };
    default:
      return { label: WIDGET_KIND_DEF[w.kind].label, project: 'project' in w ? w.project : null };
  }
}

/**
 * A first dashboard suggested to a role (décision prise sans demander): the viewer's counters, the portfolio's CPI / SPI and
 * alerts, their tasks, and the current project's milestones — only the widgets the role may see. The user changes it freely.
 */
export function starterLayout(role: RoleKey, project: string | null): DashboardLayout {
  const wanted: WidgetDraft[] = [
    { kind: 'my-kpi', size: 's', metric: 'openTasks' },
    { kind: 'my-kpi', size: 's', metric: 'overdueTasks' },
    { kind: 'my-kpi', size: 's', metric: 'pendingApprovals' },
    { kind: 'portfolio-kpi', size: 's', metric: 'cpi', scope: 'all', zone: null },
    { kind: 'portfolio-kpi', size: 's', metric: 'spi', scope: 'all', zone: null },
    { kind: 'portfolio-kpi', size: 's', metric: 'risk', scope: 'all', zone: null },
    { kind: 'portfolio-alerts', size: 'l', scope: 'all', zone: null, limit: 5 },
    { kind: 'my-tasks', size: 'm', period: 'month', project: null, limit: LIST_LIMIT_DEFAULT },
    ...(project
      ? ([
          { kind: 'project-kpi', size: 's', project, metric: 'progress' },
          { kind: 'project-milestones', size: 'm', project },
          { kind: 'project-risks', size: 'm', project, limit: 5 },
        ] as WidgetDraft[])
      : []),
  ];
  return wanted.filter((w) => canSeeWidget(role, w)).reduce(addWidget, EMPTY_LAYOUT);
}
