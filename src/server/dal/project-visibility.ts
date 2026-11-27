import 'server-only';
// Project confidentiality in the data layer (owner's decisions of 27 Nov 2026, ING-29; src/domain/confidentiality.ts).
// A confidential project is seen only by its team (named team + people assigned to its tasks or planning activities + internal
// stakeholders). Every read of the
// project register goes through `listProjects()` / `getProject()` (src/server/dal/projects.ts), which drop the projects hidden
// from the REQUEST's viewer — so the project pages (404 through getProjectContext), the switcher, the register, the portfolio
// screens and their totals, the dashboards, the search and the exports built on them never see it. The cross-project readers
// that do not start from the register filter with `hiddenProjects()` (ids and codes).
// Outside a request (scheduled jobs, the publications, the seed, scripts, tests without a request) there is no viewer: the
// reads are system reads and nothing is hidden (`requestViewer()` returns null only for Next's "outside a request scope").
import { and, eq, inArray, isNotNull, notInArray, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import { canSeeProject, projectTeam, type TeamFact, type VisibilityViewer } from '@/domain/confidentiality';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { activities, activityAssignments, persons, projectMembers, projects, stakeholders, tasks } from '@/server/db/schema';

type Q = DB | Tx;

/** One project's team, with the project's code. */
export interface ProjectTeamOf {
  projectId: string;
  code: string;
  team: TeamFact[];
}

/** The team (src/domain/confidentiality.ts `projectTeam`) of the given projects (every project when `projectIds` is omitted). */
export async function projectTeams(q: Q, projectIds?: readonly string[]): Promise<Map<string, ProjectTeamOf>> {
  if (projectIds && !projectIds.length) return new Map();
  const scope = projectIds ? inArray(projects.id, [...projectIds]) : undefined;
  const [heads, members, taskAssignees, planAssignees, holders] = await Promise.all([
    q.select({ projectId: projects.id, code: projects.code, personId: persons.id, short: persons.shortName })
      .from(projects).leftJoin(persons, eq(persons.id, projects.pmPersonId)).where(scope).orderBy(projects.sortOrder),
    q.select({ projectId: projectMembers.projectId, personId: persons.id, short: persons.shortName, role: projectMembers.projectRole })
      .from(projectMembers).innerJoin(persons, eq(persons.id, projectMembers.personId))
      .where(projectIds ? inArray(projectMembers.projectId, [...projectIds]) : undefined).orderBy(projectMembers.position),
    q.selectDistinct({ projectId: tasks.projectId, personId: persons.id, short: persons.shortName })
      .from(tasks).innerJoin(persons, eq(persons.id, tasks.assigneePersonId))
      .where(projectIds ? inArray(tasks.projectId, [...projectIds]) : undefined),
    q.selectDistinct({ projectId: activities.projectId, personId: persons.id, short: persons.shortName })
      .from(activityAssignments).innerJoin(activities, eq(activities.id, activityAssignments.activityId))
      .innerJoin(persons, eq(persons.id, activityAssignments.personId))
      .where(projectIds ? inArray(activities.projectId, [...projectIds]) : undefined),
    q.select({ projectId: stakeholders.projectId, personId: persons.id, short: persons.shortName, role: stakeholders.role, clientId: persons.clientId })
      .from(stakeholders).innerJoin(persons, eq(persons.id, stakeholders.personId))
      .where(and(isNotNull(stakeholders.personId), projectIds ? inArray(stakeholders.projectId, [...projectIds]) : undefined)).orderBy(stakeholders.position),
  ]);
  const by = <T extends { projectId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.projectId, [...(m.get(r.projectId) ?? []), r]);
    return m;
  };
  const mem = by(members), asg = by([...taskAssignees, ...planAssignees]), sth = by(holders);
  const out = new Map<string, ProjectTeamOf>();
  for (const h of heads) {
    const team = projectTeam({
      pm: h.personId && h.short ? { personId: h.personId, short: h.short } : null,
      members: mem.get(h.projectId) ?? [],
      assignees: (asg.get(h.projectId) ?? []).sort((a, b) => a.short.localeCompare(b.short)),
      stakeholders: (sth.get(h.projectId) ?? []).map((s) => ({ personId: s.personId, short: s.short, role: s.role, internal: s.clientId == null })),
    });
    out.set(h.projectId, { projectId: h.projectId, code: h.code, team });
  }
  return out;
}

/** The confidential projects (id, code). */
async function confidentialProjects(q: Q): Promise<{ id: string; code: string }[]> {
  return q.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.confidentiality, 'confidential'));
}

/** Projects hidden from a viewer. */
export interface HiddenProjects {
  ids: ReadonlySet<string>;
  codes: ReadonlySet<string>;
}

export const NOTHING_HIDDEN: HiddenProjects = { ids: new Set(), codes: new Set() };

/** The confidential projects the viewer is not on the team of (explicit viewer: exports, jobs acting for a person, tests). */
export async function hiddenProjectsFor(viewer: VisibilityViewer, q?: Q): Promise<HiddenProjects> {
  const db = q ?? (await getDb());
  const conf = await confidentialProjects(db);
  if (!conf.length) return NOTHING_HIDDEN;
  const teams = await projectTeams(db, conf.map((c) => c.id));
  const hidden = conf.filter((c) => !canSeeProject(viewer, 'confidential', teams.get(c.id)?.team ?? []));
  return { ids: new Set(hidden.map((h) => h.id)), codes: new Set(hidden.map((h) => h.code)) };
}

/** The viewer of the current request, or null outside a request (jobs, scripts, seed, publications: system reads). */
export async function requestViewer(): Promise<VisibilityViewer | null> {
  try {
    const { getViewer } = await import('@/server/session');
    return await getViewer();
  } catch (e) {
    if (e instanceof Error && e.message.includes('was called outside a request scope')) return null;
    throw e;
  }
}

/** A viewer set explicitly for work done on someone's behalf outside a request (scheduled reports e-mailed to a person). */
const actingViewer = new AsyncLocalStorage<VisibilityViewer>();

/**
 * Runs `fn` with the reads filtered for `viewer` (a job building a document for one recipient: the register, the portfolio and
 * the cross-project readers then leave out the confidential projects that recipient is not on the team of).
 */
export function readAsViewer<T>(viewer: VisibilityViewer, fn: () => Promise<T>): Promise<T> {
  return actingViewer.run(viewer, fn);
}

const hiddenForRequest = cache(async (): Promise<HiddenProjects> => {
  const viewer = await requestViewer();
  return viewer ? hiddenProjectsFor(viewer) : NOTHING_HIDDEN;
});

/** The projects hidden from the current viewer: `readAsViewer`'s, else the request's (memoised), else none (system read). */
export async function hiddenProjects(): Promise<HiddenProjects> {
  const acting = actingViewer.getStore();
  return acting ? hiddenProjectsFor(acting) : hiddenForRequest();
}

/** Is the project (by code) hidden from the request's viewer? */
export async function isProjectHidden(code: string): Promise<boolean> {
  return (await hiddenProjects()).codes.has(code);
}

/**
 * WHERE condition of a cross-project reader: rows of the projects hidden from the request's viewer are left out (undefined when
 * nothing is hidden). `projectIdColumn` = the row's project id (tasks.project_id, purchase_orders.project_id…).
 */
export async function visibleProjectRows(projectIdColumn: AnyPgColumn): Promise<SQL | undefined> {
  const { ids } = await hiddenProjects();
  return ids.size ? notInArray(projectIdColumn, [...ids]) : undefined;
}
