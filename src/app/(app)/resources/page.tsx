// Resources — the shared engineering & site pool (docs/spec/06 §1, template 573–637, logic 3866–3886).
// 5 KPI tiles, allocation heatmap of every pool member over the next 8 weeks, capacity vs demand by department
// (ROLES), suggested rebalancing. R-084 (owner answers 17 Oct 2026, third round): loads and demand from the schedules' assignments. R-085 (R-7 a): the heatmap shows 8 weeks from the Monday of the business date's week,
// `?week=YYYY-MM-DD` slides the window (validated server-side; "Current week" drops it). Owner answers 17 Oct 2026:
// `?view=week` shows the one week in detail (hours, above capacity, split by project), the 8-week view is the default. Primary action "Request resource" (New resource request dialog).
// "Labor cost to date" (R-086, R-2 a): the labour categories (cost type Labor) of the projects in execution (A-3) of the zone
// chosen on the zone screens (ks-zone; all zones when none), named in the sub-line — no longer the current project's figure
// (06 OQ2). Chapter 4: unmet demand and peak weeks computed (A-12); the suggestions are the portfolio's best what-if levers,
// "Apply" drafts a request (R-3, S-7).
import { PageHeader } from '@/components/app/shell/page-header';
import { NewRequestButton } from '@/features/requests/new-request-button';
import { resourcesView } from '@/features/resources/model';
import { ResourcesView } from '@/features/resources/resources-view';
import { readOnlyIn, suggestionInputs } from '@/features/resources/suggestions';
import { listResourceRequests } from '@/server/dal/requests';
import { getCapacityDemand, getLoadWindow, getPortfolioLaborCost, getWeekProjectSplit, getRebalancingSuggestions, getResourcePool } from '@/server/dal/resources';
import { LoadWindowNav } from '@/features/resources/window-nav';
import { screenHref } from '@/config/screens';
import { zoneLabel } from '@/server/dal/shell';
import { getProjectScope, getScreenAccess } from '@/server/project-context';
import { getI18n, getZone } from '@/server/session';
import { myWorkAccess } from '@/server/dal/mywork-data';

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, access] = await Promise.all([searchParams, getScreenAccess('resources')]);
  const win = await getLoadWindow(sp.week, sp.view);
  const [{ t, lang }, scope, pool, weekSplit, departments, pending, zone, suggestions] = await Promise.all([
    getI18n(),
    getProjectScope(),
    getResourcePool(win.weeks),
    win.view === 'week' ? getWeekProjectSplit(win.start) : Promise.resolve(undefined),
    getCapacityDemand(win.weeks),
    listResourceRequests({ status: 'pending' }),
    getZone(),
    getRebalancingSuggestions(),
  ]);
  const [labor, zoneText] = await Promise.all([getPortfolioLaborCost(zone), zoneLabel(zone)]);
  const work = await myWorkAccess(access.viewer);
  const view = resourcesView(
    {
      canOpenWork: work.canView,
      scope: 'portfolio',
      weeks: pool.weeks.map((w) => w.label),
      weekStarts: pool.weeks.map((w) => w.start),
      windowIsCurrent: win.isCurrent,
      view: win.view,
      weekSplit,
      people: pool.people.map((p) => ({ name: p.name, initials: p.initials, jobTitle: p.jobTitle, department: p.department, loads: p.loads, hours: p.hours })),
      // R-084: capacity vs demand over the window shown — demand from the schedules (named people + work counted by trade).
      departments,
      labor: labor.projects.length ? { budget: labor.budget, actual: labor.actual } : null,
      zoneLabel: zoneText,
      openRequests: pending.length,
      suggestions: suggestionInputs(suggestions, { portfolio: true, canEdit: access.canEdit, readOnly: readOnlyIn(scope.pool, scope.readOnly) }),
    },
    t,
    lang,
  );
  return (
    <>
      <PageHeader screen="resources" primary={access.canEdit ? <NewRequestButton label="Request resource" /> : undefined} />
      <ResourcesView
        view={view}
        t={t}
        canEdit={access.canEdit}
        windowIsCurrent={win.isCurrent}
        windowNav={<LoadWindowNav window={win} path={screenHref('resources')} t={t} lang={lang} />}
      />
    </>
  );
}
