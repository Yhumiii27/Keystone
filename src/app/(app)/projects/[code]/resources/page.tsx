// Project resources — the pool restricted to the project's team (docs/spec/06 §1, template 573–637, logic
// 3866–3886): project banner, 5 KPI tiles, allocation heatmap, capacity vs demand per department of the team
// (320 h per person), suggested rebalancing (Harbor Line only). Primary action "Request resource".
// Projects without a team show an empty heatmap (never Harbor Line's team, 00 §7.16).
import { PageHeader } from '@/components/app/shell/page-header';
import { NewRequestButton } from '@/features/requests/new-request-button';
import { resourcesView } from '@/features/resources/model';
import { ResourcesView } from '@/features/resources/resources-view';
import { listResourceRequests } from '@/server/dal/requests';
import { getLaborCost, getProjectTeam, getResourcePool } from '@/server/dal/resources';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

/** The prototype shows its static rebalancing suggestions on Project resources for Harbor Line only. */
const SUGGESTIONS_PROJECT = 'HLT-026';

export default async function ProjectResourcesPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'presources');
  const p = ctx.project;
  const [{ t, lang }, pool, team, labor, pending] = await Promise.all([
    getI18n(),
    getResourcePool(),
    getProjectTeam(p.code),
    getLaborCost(p.code),
    listResourceRequests({ projectCode: p.code, status: 'pending' }),
  ]);
  // Pool order (PEOPLE order), team members only — as the prototype's PEOPLE.filter(team.includes).
  const members = new Set(team.map((m) => m.name));
  const view = resourcesView(
    {
      scope: 'project',
      weeks: pool.weeks.map((w) => w.label),
      people: pool.people
        .filter((m) => members.has(m.name))
        .map((m) => ({ name: m.name, initials: m.initials, jobTitle: m.jobTitle, department: m.department, loads: m.loads })),
      departments: [],
      labor,
      openRequests: pending.length,
      showSuggestions: p.code === SUGGESTIONS_PROJECT,
    },
    t,
    lang,
  );
  const canEdit = ctx.canEdit('presources');
  return (
    <>
      <PageHeader
        screen="presources"
        projectCode={p.code}
        primary={canEdit ? <NewRequestButton label="Request resource" projectCode={p.code} /> : undefined}
      />
      <ResourcesView view={view} t={t} projectName={`${p.displayId} · ${t(p.name)}`} canEdit={canEdit} />
    </>
  );
}
