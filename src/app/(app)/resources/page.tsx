// Resources — the shared engineering & site pool (docs/spec/06 §1, template 573–637, logic 3866–3886).
// 5 KPI tiles, allocation heatmap of every pool member over the next 8 weeks, capacity vs demand by department
// (ROLES), suggested rebalancing. Primary action "Request resource" (New resource request dialog).
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
import { getPortfolioLaborCost, getRebalancingSuggestions, getResourcePool, listDepartments } from '@/server/dal/resources';
import { zoneLabel } from '@/server/dal/shell';
import { getProjectScope, getScreenAccess } from '@/server/project-context';
import { getI18n, getZone } from '@/server/session';
import { myWorkAccess } from '@/server/dal/mywork-data';

export default async function ResourcesPage() {
  const [{ t, lang }, access, scope, pool, departments, pending, zone, suggestions] = await Promise.all([
    getI18n(),
    getScreenAccess('resources'),
    getProjectScope(),
    getResourcePool(),
    listDepartments(),
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
      people: pool.people.map((p) => ({ name: p.name, initials: p.initials, jobTitle: p.jobTitle, department: p.department, loads: p.loads })),
      departments: departments
        .filter((d) => d.capacityH != null && d.demandH != null)
        .sort((a, b) => (a.capacityPosition ?? 0) - (b.capacityPosition ?? 0))
        .map((d) => ({ name: d.name, capacityH: d.capacityH!, demandH: d.demandH! })),
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
      <ResourcesView view={view} t={t} canEdit={access.canEdit} />
    </>
  );
}
