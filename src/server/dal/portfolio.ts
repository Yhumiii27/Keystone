import 'server-only';
// Portfolio DAL — Portfolio overview (docs/spec/03 §4) and My projects (§2). Composes the projects, planning
// and people DALs with the pure logic of src/domain/portfolio.ts. Strings are EN source strings with money
// formatted for `lang`: render them through t().
import type { Lang } from '@/i18n/translate';
import {
  inExecution, overviewMetrics, portfolioKpis, portfolioTotals, myProjectsModel,
  type KpiView, type MyProjectsModel, type OverviewMetrics, type PortfolioAlert, type PortfolioTotals, type TodoLite,
} from '@/domain/portfolio';
import { approvalCount } from '@/server/approvals';
import { healthThresholds } from './health-thresholds';
import { getPortfolioAlerts } from './portfolio-alerts';
import type { Viewer, ZoneKey } from '@/server/session';
import { listDepartments, listPeople } from './people';
import { listScheduleSummaries } from './planning';
import { listProjects, type ProjectRow } from './projects';
import { listTasks } from './tasks';
import { projectAccess } from '@/domain/rights';
import { listProjectTeams } from './project-team';

export interface OverviewRow extends ProjectRow {
  metrics: OverviewMetrics;
}

export interface PortfolioOverview {
  /** "Active projects" rows: projects in execution (A-3: Études → Mise en service) in the selected zone, register order. */
  rows: OverviewRow[];
  totals: PortfolioTotals;
  /** The 6 KPI tiles (Home's director view uses the first four). */
  kpis: KpiView[];
  /** "Needs attention" items computed by rules (R-130, NEW-D1-1), filtered by zone when they concern a project. */
  alerts: PortfolioAlert[];
}

const inZone = (p: Pick<ProjectRow, 'zone'>, zone: ZoneKey | null) => !zone || p.zone === zone;

/**
 * Portfolio overview data. Population (A-3, spec Open question 4): the projects whose stage is in the execution group,
 * read live from the register (a project created or moved into execution counts at once). The prototype read its static
 * PROJECTS seed (the six projects with planning data, WSA-044 in APD included).
 */
export async function getPortfolioOverview(zone: ZoneKey | null, lang: Lang): Promise<PortfolioOverview> {
  const [all, th] = await Promise.all([listProjects(), healthThresholds()]);
  // A-13: one health rule with the Settings thresholds (the same verdict as `ProjectRow.health`).
  const rows = all.filter((p) => inExecution(p) && inZone(p, zone)).map((p) => ({ ...p, metrics: overviewMetrics(p, th) }));
  const totals = portfolioTotals(rows);
  const zoneOf = new Map(all.map((p) => [p.code, p.zone]));
  // R-130 (NEW-D1-1): alerts computed by rules at the data date (were the prototype's four fixed texts).
  const alerts = (await getPortfolioAlerts(lang)).filter((a) => !a.code || !zone || zoneOf.get(a.code) === zone);
  return { rows, totals, kpis: portfolioKpis(totals, lang, th), alerts };
}

/** Every task (assignee full name, status, project short code) for the "open tasks" indicators. */
const todos = async (): Promise<TodoLite[]> =>
  (await listTasks()).map((t) => ({ person: t.assignee, status: t.status, project: t.project.short }));

/**
 * My projects wall for the viewer. `currentProject` = the project the shell considers current (last project),
 * used for the "Pending decisions" count (My approvals queue, which is project-dependent in the prototype).
 */
export async function getMyProjects(viewer: Viewer, currentProject: string, lang: Lang): Promise<MyProjectsModel<ProjectRow>> {
  const [all, sched, people, depts, tasks, pendingDecisions, thresholds, teams] = await Promise.all([
    listProjects(), listScheduleSummaries(), listPeople(), listDepartments(), todos(), approvalCount(viewer, currentProject), healthThresholds(), listProjectTeams(),
  ]);
  // R-041: the viewer's team role (tag) and read-only state per project follow the named project team.
  const access = (p: ProjectRow) => {
    const a = projectAccess(viewer, { client: p.client, pm: p.pm, pmPersonId: p.pmPersonId, team: teams.get(p.code) ?? [] });
    return { teamRole: a.teamRole, readOnly: a.readOnly };
  };
  // A-3: the same population as the Overview (projects in execution).
  const pool = all.filter(inExecution);
  const deptOf: Record<string, string> = {};
  for (const p of people) if (p.department) deptOf[p.name] = p.department;
  // Department of a department head: the one they head (the prototype's `state.dept`), else their own (R-039), else Engineering.
  const dept = viewer.role === 'depthead' ? depts.find((d) => d.head === viewer.name)?.name ?? viewer.department ?? 'Engineering' : null;
  return myProjectsModel(
    // A client sees the projects of their own organisation (R-039: the viewer's, no longer the CLIENT_ORG constant).
    { role: viewer.role, name: viewer.name, short: viewer.short, clientOrg: viewer.organisation ?? '', dept },
    pool,
    sched,
    { deptOf, todos: tasks },
    { personaTitle: viewer.title, pendingDecisions, lang, thresholds, access },
  );
}
