// My dashboards — /my/dashboards?d=<id> (R-203, K-203 « Lancer », owner 1 Nov 2026). Each internal user composes their own
// dashboards from the widget catalogue (src/domain/dashboards.ts) — Keystone's existing indicators and lists — saves several,
// names them, sets one as default (opened first here) and shares one with named internal users, who read it with their own
// rights. The widgets' data are resolved on the server for the viewer (src/server/dal/dashboard-data.ts). A client is sent
// home (R-042): the screen is not in their workspace.
import { Eye, PushPin, ShareNetwork } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { EmptyState } from '@/components/app/EmptyState';
import { PageHeader } from '@/components/app/shell/page-header';
import { Tag } from '@/components/ds/Tag';
import { screenHref } from '@/config/screens';
import {
  MY_METRIC_LABEL, PORTFOLIO_METRIC_LABEL, PROJECT_METRIC_LABEL, ZONE_KEYS, availableKinds, availableMetrics, widgetTitleParts, type MyMetric, type PortfolioMetric,
  type ProjectMetric,
} from '@/domain/dashboards';
import { DashboardGrid, type GridItem, type WidgetCatalogue } from '@/features/dashboards/dashboard-grid';
import { DashboardToolbar } from '@/features/dashboards/dashboard-toolbar';
import { StarterButton } from '@/features/dashboards/starter-button';
import { WidgetBody } from '@/features/dashboards/widget-body';
import s from '@/features/dashboards/dashboards.module.css';
import { dataText } from '@/i18n/data-text';
import { getDb } from '@/server/db/client';
import { dashboardProjectChoices, resolveWidgets } from '@/server/dal/dashboard-data';
import { dashboardShareCandidates, listDashboardsOf } from '@/server/dal/dashboards';
import { zoneLabel } from '@/server/dal/shell';
import { userIdOf } from '@/server/dal/users';
import { getScreenAccess } from '@/server/project-context';
import { getCurrentProject, getI18n } from '@/server/session';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MyDashboardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, { t, lang }, access] = await Promise.all([searchParams, getI18n(), getScreenAccess('dashboards')]);
  const { viewer, canEdit } = access;
  const userId = await userIdOf(await getDb(), viewer);
  const list = userId ? await listDashboardsOf(userId) : [];
  const asked = one(sp.d);
  const current = list.find((d) => d.id === asked) ?? list.find((d) => d.own && d.isDefault) ?? list[0] ?? null;
  const own = list.filter((d) => d.own);
  const shared = list.filter((d) => !d.own);
  const editable = !!current?.own && canEdit;

  const [resolved, people, projects, currentProject, zones] = await Promise.all([
    current ? resolveWidgets(viewer, current.layout.widgets, lang) : Promise.resolve([]),
    editable && userId ? dashboardShareCandidates(userId) : Promise.resolve([]),
    editable ? dashboardProjectChoices(viewer, lang) : Promise.resolve([]),
    getCurrentProject(),
    editable ? Promise.all(ZONE_KEYS.map(async (z) => ({ value: z, label: (await zoneLabel(z)) || z }))) : Promise.resolve([]),
  ]);

  const items: GridItem[] = resolved.map(({ widget, data }) => {
    const parts = widgetTitleParts(widget);
    // A widget the viewer may not see shows its kind only, never the project it was set on.
    const project = data.state === 'ok' ? data.projectLabel : data.state === 'unavailable' ? parts.project : null;
    return { widget, title: project ? `${t(parts.label)} · ${project}` : t(parts.label), body: <WidgetBody data={data} t={t} lang={lang} /> };
  });

  const metricOptions = <K extends 'portfolio-kpi' | 'my-kpi' | 'project-kpi'>(kind: K, labels: Record<string, string>) =>
    availableMetrics(viewer.role, kind).map((m) => ({ value: m, label: labels[m] }));
  const catalogue: WidgetCatalogue | null = editable
    ? {
        role: viewer.role,
        kinds: availableKinds(viewer.role).map((k) => k.kind),
        metrics: {
          'portfolio-kpi': metricOptions('portfolio-kpi', PORTFOLIO_METRIC_LABEL as Record<PortfolioMetric, string>),
          'my-kpi': metricOptions('my-kpi', MY_METRIC_LABEL as Record<MyMetric, string>),
          'project-kpi': metricOptions('project-kpi', PROJECT_METRIC_LABEL as Record<ProjectMetric, string>),
        },
        projects: projects.map((p) => ({ code: p.code, label: p.label })),
        project: currentProject,
        zones,
      }
    : null;

  const tabHref = (id: string) => `${screenHref('dashboards')}?d=${encodeURIComponent(id)}`;
  return (
    <>
      <PageHeader screen="dashboards" />
      <div className={s.page}>
        {list.length > 0 && (
          <div className={s.tabsRow}>
            {own.length > 0 && (
              <nav className={s.tabs} aria-label={t('My dashboards')}>
                {own.map((d) => (
                  <Link key={d.id} href={tabHref(d.id)} className={s.tab} aria-current={d.id === current?.id ? 'page' : undefined}>
                    {d.isDefault && (
                      <>
                        <PushPin aria-hidden />
                        <span className={s.srOnly}>{t('Default')}</span>
                      </>
                    )}
                    <span className={s.tabName}>{dataText(d.name, lang)}</span>
                    {d.sharedWith.length > 0 && (
                      <>
                        <ShareNetwork aria-hidden />
                        <span className={s.srOnly}>{t('Shared')}</span>
                      </>
                    )}
                  </Link>
                ))}
              </nav>
            )}
            {shared.length > 0 && (
              <nav className={s.tabs} aria-label={t('Shared with me')}>
                <span className={s.tabsLabel} aria-hidden>
                  {t('Shared with me')}
                </span>
                {shared.map((d) => (
                  <Link key={d.id} href={tabHref(d.id)} className={s.tab} aria-current={d.id === current?.id ? 'page' : undefined}>
                    <span className={s.tabName}>{dataText(d.name, lang)}</span>
                    <span className={s.tabMeta}>{dataText(d.ownerName, lang)}</span>
                  </Link>
                ))}
              </nav>
            )}
          </div>
        )}
        <DashboardToolbar
          current={current ? { id: current.id, name: current.name, own: current.own, isDefault: current.isDefault, sharedWith: current.sharedWith.map((p) => p.userId) } : null}
          people={people}
          canCreate={canEdit && !!userId}
        />
        {current && (
          <div className={s.meta}>
            {!current.own && (
              <Tag tone="outline" icon={Eye}>
                {`${t('Shared by')} ${dataText(current.ownerName, lang)} · ${t('Read-only')}`}
              </Tag>
            )}
            {current.own && current.sharedWith.length > 0 && (
              <span>{`${t('Shared with')} ${current.sharedWith.map((p) => dataText(p.name, lang)).join(', ')}`}</span>
            )}
            {!current.own && <span>{t('Each widget shows only what your own rights allow')}</span>}
            {!current.layoutValid && <span>{t('This dashboard’s layout could not be read; it is shown empty')}</span>}
          </div>
        )}
        {current ? (
          <DashboardGrid dashboardId={current.id} layout={current.layout} items={items} editable={editable} catalogue={catalogue} />
        ) : (
          <EmptyState variant="boxed">
            <span>{t('No dashboard yet. Start from the widgets suggested for your role, or create an empty dashboard.')}</span>
            {canEdit && userId && <StarterButton />}
          </EmptyState>
        )}
      </div>
    </>
  );
}
