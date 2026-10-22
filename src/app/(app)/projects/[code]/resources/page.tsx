// Project resources — the pool restricted to the project's team (docs/spec/06 §1, template 573–637, logic
// 3866–3886): project banner, 5 KPI tiles, allocation heatmap, capacity vs demand per department of the team
// (320 h per person), suggested rebalancing. Primary action "Request resource".
// Projects without a team show an empty heatmap (never Harbor Line's team, 00 §7.16). Chapter 4 (R-3, S-7): the suggestions
// are the project's what-if levers that become a resource request (any project, not only Harbor Line); "Apply" drafts it.
// R-041 (P-2): the "Project team" card lists the named team (PM, co-PMs, deputies, referents, members) whose people edit the
// project; the director and the project's PMs manage it there. R-085 (R-7 a): 8 weeks from the current week, `?week=` slides;
// owner answers 17 Oct 2026: `?view=week` shows the one week in detail.
import { PageHeader } from '@/components/app/shell/page-header';
import { NewRequestButton } from '@/features/requests/new-request-button';
import { resourcesView } from '@/features/resources/model';
import { ResourcesView } from '@/features/resources/resources-view';
import { suggestionInputs } from '@/features/resources/suggestions';
import { listResourceRequests } from '@/server/dal/requests';
import { getLaborCost, getLoadWindow, getProjectTradeDemand, getWeekProjectSplit, getProjectTeam, getRebalancingSuggestions, getResourcePool } from '@/server/dal/resources';
import { listUnassignedActivities, listUndeclaredActivities } from '@/server/dal/planning-load';
import { businessToday } from '@/server/clock';
import { LoadWindowNav } from '@/features/resources/window-nav';
import { screenHref } from '@/config/screens';
import { canManageTeam } from '@/domain/rights';
import { ProjectTeamCard } from '@/features/team/project-team';
import { getNamedTeam, teamCandidates } from '@/server/dal/project-team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { myWorkAccess } from '@/server/dal/mywork-data';
import { projectLabelText } from '@/i18n/data-text';

export default async function ProjectResourcesPage({
  params, searchParams,
}: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'presources');
  const p = ctx.project;
  const canEdit = ctx.canEdit('presources');
  const manageTeam = canEdit && canManageTeam(ctx.viewer.role, ctx.access);
  const win = await getLoadWindow(sp.week, sp.view);
  const [{ t, lang }, pool, weekSplit, team, labor, pending, suggestions, named, candidates, trades, undeclared, unassigned] = await Promise.all([
    getI18n(),
    getResourcePool(win.weeks),
    win.view === 'week' ? getWeekProjectSplit(win.start) : Promise.resolve(undefined),
    getProjectTeam(p.code),
    getLaborCost(p.code),
    listResourceRequests({ projectCode: p.code, status: 'pending' }),
    getRebalancingSuggestions({ projectCode: p.code }),
    getNamedTeam(p.code),
    manageTeam ? teamCandidates(p.code) : Promise.resolve(null),
    getProjectTradeDemand(p.code, win.weeks),
    listUndeclaredActivities(p.code),
    businessToday().then((today) => listUnassignedActivities(today, p.code)),
  ]);
  // Pool order (PEOPLE order), team members only — as the prototype's PEOPLE.filter(team.includes).
  const members = new Set(team.map((m) => m.name));
  const work = await myWorkAccess(ctx.viewer);
  const view = resourcesView(
    {
      canOpenWork: work.canView,
      scope: 'project',
      projectCode: p.code,
      weeks: pool.weeks.map((w) => w.label),
      weekStarts: pool.weeks.map((w) => w.start),
      windowIsCurrent: win.isCurrent,
      view: win.view,
      weekSplit,
      people: pool.people
        .filter((m) => members.has(m.name))
        .map((m) => ({ name: m.name, initials: m.initials, jobTitle: m.jobTitle, department: m.department, loads: m.loads, hours: m.hours, capacityH: m.capacityH })),
      departments: [],
      // R-084 (owner answers 17 Oct 2026, third round): the project's work no named person carries, by trade; the activities
      // that declare no resource at all.
      projectTrades: trades,
      undeclared,
      // Owner answer 18 Oct 2026, fourth round: the activities without an assignment at J-15 (the PM is warned).
      unassigned,
      labor,
      openRequests: pending.length,
      suggestions: suggestions.length ? suggestionInputs(suggestions, { portfolio: false, canEdit, readOnly: () => false }) : null,
    },
    t,
    lang,
  );
  return (
    <>
      <PageHeader
        screen="presources"
        projectCode={p.code}
        primary={canEdit ? <NewRequestButton label="Request resource" projectCode={p.code} /> : undefined}
      />
      <ResourcesView
        view={view}
        t={t}
        projectName={projectLabelText(p, lang)}
        canEdit={canEdit}
        windowIsCurrent={win.isCurrent}
        windowNav={<LoadWindowNav window={win} path={screenHref('presources', { code: p.code })} t={t} lang={lang} />}
      />
      <ProjectTeamCard code={p.code} context={projectLabelText(p, lang)} members={named} candidates={candidates} t={t} />
    </>
  );
}
