// Resources — the shared engineering & site pool (docs/spec/06 §1, template 573–637, logic 3866–3886).
// 5 KPI tiles, allocation heatmap of every pool member over the next 8 weeks, capacity vs demand by department
// (ROLES), suggested rebalancing. Primary action "Request resource" (New resource request dialog).
// "Labor cost to date" reads the current project's labour category, as the prototype (06 OQ2).
import { PageHeader } from '@/components/app/shell/page-header';
import { NewRequestButton } from '@/features/requests/new-request-button';
import { resourcesView } from '@/features/resources/model';
import { ResourcesView } from '@/features/resources/resources-view';
import { listResourceRequests } from '@/server/dal/requests';
import { getLaborCost, getResourcePool, listDepartments } from '@/server/dal/resources';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';

export default async function ResourcesPage() {
  const [{ t, lang }, access, pool, departments, pending, lastProject] = await Promise.all([
    getI18n(),
    getScreenAccess('resources'),
    getResourcePool(),
    listDepartments(),
    listResourceRequests({ status: 'pending' }),
    getLastProject(),
  ]);
  const labor = await getLaborCost(lastProject);
  const view = resourcesView(
    {
      scope: 'portfolio',
      weeks: pool.weeks.map((w) => w.label),
      people: pool.people.map((p) => ({ name: p.name, initials: p.initials, jobTitle: p.jobTitle, department: p.department, loads: p.loads })),
      departments: departments
        .filter((d) => d.capacityH != null && d.demandH != null)
        .sort((a, b) => (a.capacityPosition ?? 0) - (b.capacityPosition ?? 0))
        .map((d) => ({ name: d.name, capacityH: d.capacityH!, demandH: d.demandH! })),
      labor,
      openRequests: pending.length,
      showSuggestions: true,
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
