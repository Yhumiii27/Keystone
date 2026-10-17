import 'server-only';
// Screen loaders of the Resource requests feature (docs/spec/08 §5–§6, 01 §12) on top of the requests and resources
// DAL: the Approvals screen data of one department, the New resource request dialog setup, the person → user account
// lookup used to notify the requester / department head / assignee, and the request notifications + activity feed.
import { and, eq, or } from 'drizzle-orm';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { recordActivity } from '@/server/db/helpers';
import { departments, persons, projects, users } from '@/server/db/schema';
import type { NotificationKind } from '@/server/db/codes';
import { createNotification } from './notifications';
import { getProject, type ProjectRow } from './projects';
import { getDepartmentApprovals, listApprovalDepartments, listRequestActivities, listResourceRequests, type ResourceRequestRow } from './requests';
import { getResourcePool, listDepartments, type ResourcePool } from './resources';

export interface ApprovalDepartment {
  name: string;
  head: string | null;
  headShort: string | null;
  headInitials: string | null;
  /** EN source string ("Head of engineering"). */
  headTitle: string | null;
  pending: number;
  capacityH: number | null;
  demandH: number | null;
}

/** Departments in DEPTS order with head, pending count (chips) and 8-week capacity (ROLES). */
export async function listApprovalDepartmentsFull(): Promise<ApprovalDepartment[]> {
  const [chips, caps] = await Promise.all([listApprovalDepartments(), listDepartments()]);
  return chips.map((d) => {
    const c = caps.find((x) => x.name === d.name);
    return {
      name: d.name, head: d.head, headShort: c?.head?.shortName ?? null, headInitials: c?.head?.initials ?? null, headTitle: d.headTitle,
      pending: d.pending, capacityH: c?.capacityH ?? null, demandH: c?.demandH ?? null,
    };
  });
}

export interface ApprovalsScreenData {
  departments: ApprovalDepartment[];
  department: ApprovalDepartment;
  /** Requests of the department: pending (queue) and every other status (Decided). */
  pending: ResourceRequestRow[];
  decided: ResourceRequestRow[];
  /** Every pending request (all departments) — Team load "Pending" column. */
  allPending: ResourceRequestRow[];
  pool: ResourcePool;
  /** Business date (ISO, R-013): the team-load week labels when the pool has no weeks. */
  today: string;
}

/** Approvals screen of a department (by exact name); null when unknown. */
export async function getApprovalsScreenData(department: string): Promise<ApprovalsScreenData | null> {
  const [departmentsFull, queue, allPending, pool, today] = await Promise.all([
    listApprovalDepartmentsFull(), getDepartmentApprovals(department), listResourceRequests({ status: 'pending' }), getResourcePool(), businessToday(),
  ]);
  const d = departmentsFull.find((x) => x.name === department);
  if (!d || !queue) return null;
  return { departments: departmentsFull, department: d, pending: queue.pending, decided: queue.decided, allPending, pool, today };
}

/** Department a person belongs to (persons.department), null when none / unknown. */
export async function departmentOfPerson(name: string): Promise<string | null> {
  const db = await getDb();
  const [r] = await db
    .select({ dept: departments.name })
    .from(persons)
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .where(eq(persons.fullName, name));
  return r?.dept ?? null;
}

// ── New resource request dialog ────────────────────────────────────────────────────────────────────────

export interface NewRequestSetup {
  project: { code: string; name: string; shortName: string | null };
  /** Activity chips (NR_ACTS for HLT-026, else open activities). */
  activities: { code: string; name: string; label: string }[];
  /** Pool people (PEOPLE order) with department and weekly loads. */
  people: { name: string; department: string | null; loads: number[] }[];
  weekStarts: string[];
  departments: { name: string; head: string | null }[];
}

/** Data of the dialog for a project with data; null for an unknown project or one without planning data. */
export async function getNewRequestSetup(project: ProjectRow | string): Promise<NewRequestSetup | null> {
  const p = typeof project === 'string' ? await getProject(project) : project;
  if (!p || !p.hasData) return null;
  const [activities, pool, depts, [meta]] = await Promise.all([
    listRequestActivities(p.code),
    getResourcePool(),
    listApprovalDepartments(),
    (await getDb()).select({ shortName: projects.shortName }).from(projects).where(eq(projects.code, p.code)),
  ]);
  return {
    project: { code: p.code, name: p.name, shortName: meta?.shortName ?? null },
    activities,
    people: pool.people.map((x) => ({ name: x.name, department: x.department, loads: x.loads })),
    weekStarts: pool.weeks.map((w) => w.start),
    departments: depts.map((d) => ({ name: d.name, head: d.head })),
  };
}

// ── Notifications & activity feed ──────────────────────────────────────────────────────────────────────

/** The active user account of a person (by full or short name): their person id and roles; null when they have none. */
export async function userOfPerson(name: string | null | undefined): Promise<{ personId: string; roles: string[] } | null> {
  if (!name) return null;
  const db = await getDb();
  const [r] = await db
    .select({ personId: users.personId, roles: users.roles })
    .from(users)
    .innerJoin(persons, eq(persons.id, users.personId))
    .where(and(eq(users.active, true), or(eq(persons.fullName, name), eq(persons.shortName, name))));
  return r ?? null;
}

/** Who acts: the viewer (person id when signed in, else the demo persona's name). */
export interface NoticeActor {
  name: string;
  short?: string;
  personId?: string | null;
}

export interface RequestNotice {
  kind: NotificationKind;
  /** EN source strings. */
  title: string;
  sub: string;
  /** Target screen id + params. */
  screen: string;
  params?: Record<string, unknown>;
  projectCode: string;
  /** Recipient person (full or short name); nothing is sent when they have no user account or are the actor. */
  to: string | null;
}

/** Sends request notifications to the recipients' own user accounts (R-039: a person, not their role), never to the actor. */
export async function notifyRequestEvent(notices: RequestNotice[], actor: NoticeActor): Promise<void> {
  const db = await getDb();
  let actorPersonId = actor.personId ?? null;
  if (!actorPersonId) {
    const [p] = await db.select({ id: persons.id }).from(persons).where(or(eq(persons.fullName, actor.name), eq(persons.shortName, actor.short ?? actor.name)));
    actorPersonId = p?.id ?? null;
  }
  for (const n of notices) {
    const to = await userOfPerson(n.to);
    if (!to || to.personId === actorPersonId) continue;
    await createNotification({
      kind: n.kind, title: n.title, sub: n.sub, screen: n.screen, params: n.params ?? {}, projectCode: n.projectCode, audience: to.roles, toPersonIds: [to.personId],
    });
  }
}

/** Appends a "request" event to the activity feed (EN sentence). */
export async function recordRequestActivity(projectCode: string, actorName: string, text: string): Promise<void> {
  const db = await getDb();
  const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  const [who] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, actorName));
  await recordActivity(db, { actorName, actorPersonId: who?.id ?? null, text, kind: 'request', projectId: p?.id ?? null });
}
