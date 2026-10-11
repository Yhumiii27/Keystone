import 'server-only';
// My work read model (docs/spec/10 §6.4 a, c): the person whose work is shown — name, initials, job title, weekly
// loads from the shared resource pool — and the people a manager can switch to. Tasks themselves come from
// src/server/dal/tasks.ts (listTasks / getTask).
import { and, eq, isNotNull } from 'drizzle-orm';
import { cache } from 'react';
import { canViewPersonWork, type WorkScope } from '@/domain/rights';
import { getDb } from '@/server/db/client';
import { departments, persons, projectMembers, projects, tasks } from '@/server/db/schema';
import type { Viewer } from '@/server/session';
import { getApproverIdentity } from './myapprovals-identity';
import { getPersonByName } from './people';
import { getResourcePool } from './resources';

export interface MyWorkPerson {
  /** Full name ("Hélène Sauvage"). */
  name: string;
  initials: string;
  /** EN source string ("QA / QC"); null when unknown. */
  jobTitle: string | null;
  /** Weekly loads % of the 8-week pool window (first = next week); null when the person is not in the pool. */
  loads: number[] | null;
}

export interface MyWorkPersonOption {
  name: string;
  initials: string;
  jobTitle: string | null;
}

const pool = cache(getResourcePool);

/** Person by full or short name with their pool loads; null when unknown. */
export async function getMyWorkPerson(name: string): Promise<MyWorkPerson | null> {
  const [p, { people }] = await Promise.all([getPersonByName(name), pool()]);
  if (!p) return null;
  const inPool = people.find((x) => x.name === p.name);
  return { name: p.name, initials: p.initials, jobTitle: p.jobTitle, loads: inPool ? inPool.loads : null };
}

/** People a manager can open My work for: the resource pool (PEOPLE order — Resources rows, Approvals team list). */
export async function listMyWorkPeople(): Promise<MyWorkPersonOption[]> {
  const { people } = await pool();
  return people.map((p) => ({ name: p.name, initials: p.initials, jobTitle: p.jobTitle }));
}

// ── Someone else's work (R-049, R-9 answer b) ────────────────────────────────────────────────────────────────────────

/** Department and projects (named team, or tasks) of every person, by full name (also by short name). */
const workFacts = cache(async (): Promise<Map<string, { name: string; department: string | null; projects: string[] }>> => {
  const db = await getDb();
  const [people, members, pms, assigned] = await Promise.all([
    db.select({ id: persons.id, full: persons.fullName, short: persons.shortName, dept: departments.name }).from(persons).leftJoin(departments, eq(departments.id, persons.departmentId)),
    db.select({ id: projectMembers.personId, code: projects.code }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId)),
    db.select({ id: projects.pmPersonId, code: projects.code }).from(projects).where(isNotNull(projects.pmPersonId)),
    db.selectDistinct({ id: tasks.assigneePersonId, code: projects.code }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(isNotNull(tasks.assigneePersonId))),
  ]);
  const codes = new Map<string, Set<string>>();
  for (const r of [...members, ...pms, ...assigned]) if (r.id) (codes.get(r.id) ?? codes.set(r.id, new Set()).get(r.id)!).add(r.code);
  const out = new Map<string, { name: string; department: string | null; projects: string[] }>();
  for (const p of people) {
    const facts = { name: p.full ?? p.short, department: p.dept, projects: [...(codes.get(p.id) ?? [])] };
    out.set(facts.name, facts);
    out.set(p.short, facts);
  }
  return out;
});

/** The viewer's hierarchy and projects (R-049): departments they head, projects they lead (PM of record, co-PM, deputy). */
async function workScopeOf(viewer: Viewer): Promise<WorkScope> {
  const identity = await getApproverIdentity(viewer);
  return { headedDepartments: identity.departments, leadProjects: identity.managedProjects };
}

/**
 * R-049 (R-9 answer b, "selon la hiérarchie et les projets"): whose My work the viewer may open — the director everybody,
 * a department head the people of the departments they head, a PM (co-PM, deputy) the people working on the projects they
 * lead. `canView(name)` answers for any person; `people` = the switcher's options (resource pool order, the viewer excluded).
 */
export async function myWorkAccess(viewer: Viewer): Promise<{ canView: (name: string) => boolean; people: MyWorkPersonOption[] }> {
  const [scope, facts, all] = await Promise.all([workScopeOf(viewer), workFacts(), listMyWorkPeople()]);
  const canView = (name: string) => {
    if (name === viewer.name) return true;
    const f = facts.get(name);
    return !!f && canViewPersonWork(viewer, scope, f);
  };
  return { canView, people: all.filter((p) => p.name !== viewer.name && canView(p.name)) };
}
