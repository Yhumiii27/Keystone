import 'server-only';
// Portfolio DAL — Portfolio overview (docs/spec/03 §4) and My projects (§2). Composes the projects, planning
// and people DALs with the pure logic of src/domain/portfolio.ts. Strings are EN source strings with money
// formatted for `lang`: render them through t().
import type { Lang } from '@/i18n/translate';
import {
  overviewMetrics, portfolioAlerts, portfolioKpis, portfolioTotals, myProjectsModel,
  type KpiView, type MyProjectsModel, type OverviewMetrics, type PortfolioAlert, type PortfolioTotals, type TodoLite,
} from '@/domain/portfolio';
import { approvalCount } from '@/server/approvals';
import { healthThresholds } from './health-thresholds';
import type { Viewer, ZoneKey } from '@/server/session';
import { listDepartments, listPeople } from './people';
import { listScheduleSummaries } from './planning';
import { listProjects, type ProjectRow } from './projects';
import { listTasks } from './tasks';

export interface OverviewRow extends ProjectRow {
  metrics: OverviewMetrics;
}

export interface PortfolioOverview {
  /** "Active projects" rows: projects with planning data (the prototype's PROJECTS) in the selected zone, register order. */
  rows: OverviewRow[];
  totals: PortfolioTotals;
  /** The 6 KPI tiles (Home's director view uses the first four). */
  kpis: KpiView[];
  /** "Needs attention" items, filtered by zone when they concern a project. */
  alerts: PortfolioAlert[];
}

const inZone = (p: Pick<ProjectRow, 'zone'>, zone: ZoneKey | null) => !zone || p.zone === zone;

/**
 * Portfolio overview data. Population (spec Open question 4): the projects with planning data — the prototype
 * reads its static PROJECTS seed, which is the same six projects; here their live values are used.
 */
export async function getPortfolioOverview(zone: ZoneKey | null, lang: Lang): Promise<PortfolioOverview> {
  const [all, th] = await Promise.all([listProjects(), healthThresholds()]);
  // A-13: one health rule with the Settings thresholds (the same verdict as `ProjectRow.health`).
  const rows = all.filter((p) => p.hasData && inZone(p, zone)).map((p) => ({ ...p, metrics: overviewMetrics(p, th) }));
  const totals = portfolioTotals(rows);
  const zoneOf = new Map(all.map((p) => [p.code, p.zone]));
  const alerts = portfolioAlerts(lang).filter((a) => !a.code || !zone || zoneOf.get(a.code) === zone);
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
  const [all, sched, people, depts, tasks, pendingDecisions, thresholds] = await Promise.all([
    listProjects(), listScheduleSummaries(), listPeople(), listDepartments(), todos(), approvalCount(viewer, currentProject), healthThresholds(),
  ]);
  const pool = all.filter((p) => p.hasData);
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
    { personaTitle: viewer.title, pendingDecisions, lang, thresholds },
  );
}
