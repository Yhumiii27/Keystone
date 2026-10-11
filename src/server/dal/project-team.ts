import 'server-only';
// Named project teams (R-041, P-2): the PM of record (`projects.pm_person_id`) plus the `project_members` rows with their team
// role (co-PM, deputy PM, referent, team member). Write rights on a project's screens follow the team
// (src/domain/rights.ts `projectAccess`, src/server/project-context.ts); the PM rights (stage, deliverables, plan structure,
// minutes, purchase-order approval, release validation) follow its PMs and deputies. The writers record an audit row and an
// activity event; the Server Functions (src/features/team/team-actions.ts) check the viewer may manage the team.
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { cache } from 'react';
import { LEAD_TEAM_ROLES, PROJECT_TEAM_ROLE_LABEL, isProjectTeamRole, type ProjectTeamRole, type TeamMember } from '@/domain/rights';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { departments, persons, projectMembers, projects } from '@/server/db/schema';
import { isUniqueViolation } from './users';

type Q = DB | Tx;

interface MemberRow {
  code: string;
  personId: string;
  fullName: string | null;
  shortName: string;
  role: string;
  primary: boolean;
}

/** Team rows of the given projects (all when `codes` is omitted): the PM of record first, then the members in team order. */
async function teamRows(q: Q, codes?: readonly string[]): Promise<MemberRow[]> {
  const scope = codes ? inArray(projects.code, [...codes]) : undefined;
  const [pms, members] = await Promise.all([
    q
      .select({ code: projects.code, personId: persons.id, fullName: persons.fullName, shortName: persons.shortName })
      .from(projects)
      .innerJoin(persons, eq(persons.id, projects.pmPersonId))
      .where(scope),
    q
      .select({ code: projects.code, personId: persons.id, fullName: persons.fullName, shortName: persons.shortName, role: projectMembers.projectRole })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .innerJoin(persons, eq(persons.id, projectMembers.personId))
      .where(scope)
      .orderBy(asc(projects.code), asc(projectMembers.position)),
  ]);
  const out: MemberRow[] = pms.map((p) => ({ ...p, role: 'pm', primary: true }));
  const primaryOf = new Map(pms.map((p) => [p.code, p.personId]));
  for (const m of members) if (primaryOf.get(m.code) !== m.personId) out.push({ ...m, primary: false });
  return out;
}

const toMember = (r: MemberRow): TeamMember => ({
  personId: r.personId, short: r.shortName, name: r.fullName ?? r.shortName, role: isProjectTeamRole(r.role) ? r.role : 'team', primary: r.primary,
});

/** Every project's named team, keyed by project code (memoised per request). */
export const listProjectTeams = cache(async (): Promise<Map<string, TeamMember[]>> => {
  const rows = await teamRows(await getDb());
  const out = new Map<string, TeamMember[]>();
  for (const r of rows) {
    const list = out.get(r.code) ?? [];
    list.push(toMember(r));
    out.set(r.code, list);
  }
  return out;
});

/** Named team of one project, with each person's job title and department (Project resources › Project team). */
export interface TeamCardMember extends TeamMember {
  jobTitle: string | null;
  department: string | null;
}

export async function getNamedTeam(code: string, q?: Q): Promise<TeamCardMember[]> {
  const db = q ?? (await getDb());
  const rows = await teamRows(db, [code]);
  if (!rows.length) return [];
  const info = await db
    .select({ id: persons.id, jobTitle: persons.jobTitle, department: departments.name })
    .from(persons)
    .leftJoin(departments, eq(departments.id, persons.departmentId))
    .where(inArray(persons.id, rows.map((r) => r.personId)));
  const by = new Map(info.map((i) => [i.id, i]));
  return rows.map((r) => ({ ...toMember(r), jobTitle: by.get(r.personId)?.jobTitle ?? null, department: by.get(r.personId)?.department ?? null }));
}

/** People who can join a project's team: EPC2i staff (no client organisation) not on it yet, by name. */
export async function teamCandidates(code: string): Promise<{ personId: string; name: string; jobTitle: string | null }[]> {
  const db = await getDb();
  const onTeam = new Set((await teamRows(db, [code])).map((r) => r.personId));
  const rows = await db
    .select({ id: persons.id, fullName: persons.fullName, shortName: persons.shortName, jobTitle: persons.jobTitle })
    .from(persons)
    .where(isNull(persons.clientId));
  return rows
    .filter((r) => !onTeam.has(r.id))
    .map((r) => ({ personId: r.id, name: r.fullName ?? r.shortName, jobTitle: r.jobTitle }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Codes of the projects a person leads: PM of record, or team role pm / deputy (R-041). */
export async function leadProjectCodes(q: Q, personId: string): Promise<string[]> {
  const rows = await q
    .selectDistinct({ code: projects.code, order: projects.sortOrder })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.personId, personId)))
    .where(or(eq(projects.pmPersonId, personId), inArray(projectMembers.projectRole, [...LEAD_TEAM_ROLES])))
    .orderBy(asc(projects.sortOrder));
  return rows.map((r) => r.code);
}

/** Codes of the projects a person is on the named team of (any team role, PM of record included). */
export async function memberProjectCodes(q: Q, personId: string): Promise<string[]> {
  const rows = await q
    .selectDistinct({ code: projects.code, order: projects.sortOrder })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.personId, personId)))
    .where(or(eq(projects.pmPersonId, personId), eq(projectMembers.personId, personId)))
    .orderBy(asc(projects.sortOrder));
  return rows.map((r) => r.code);
}

/** Does the person lead the project (PM of record, co-PM, deputy)? */
export async function leadsProject(q: Q, projectId: string, personId: string | null): Promise<boolean> {
  if (!personId) return false;
  const [p] = await q.select({ pm: projects.pmPersonId }).from(projects).where(eq(projects.id, projectId));
  if (p?.pm === personId) return true;
  const [m] = await q
    .select({ role: projectMembers.projectRole })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.personId, personId), inArray(projectMembers.projectRole, [...LEAD_TEAM_ROLES])));
  return !!m;
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TeamActor {
  name: string;
  personId: string | null;
}

/** Refusal of a team change, with an EN source message for the user. */
export class TeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamError';
  }
}

async function projectRow(q: Q, code: string) {
  const [p] = await q.select({ id: projects.id, code: projects.code, pm: projects.pmPersonId }).from(projects).where(eq(projects.code, code));
  if (!p) throw new TeamError('Unknown project');
  return p;
}

async function personRow(q: Q, personId: string) {
  const [p] = await q.select({ id: persons.id, fullName: persons.fullName, shortName: persons.shortName, clientId: persons.clientId }).from(persons).where(eq(persons.id, personId));
  if (!p) throw new TeamError('Unknown person');
  return p;
}

async function trace(q: Q, actor: TeamActor, projectId: string, code: string, change: string, text: string, personId: string) {
  // The actor's person: the signed-in user's, else the demo persona's (by name).
  const actorPersonId = actor.personId ?? (await findPerson(q, actor.name))?.id ?? null;
  await writeAudit(q, { actorName: actor.name, actorPersonId, objectRef: `Team ${code}`, change, area: 'Project team', entityType: 'person', entityId: personId, projectId });
  await recordActivity(q, { actorName: actor.name, actorPersonId, text, kind: 'change', projectId });
}

/** Adds an EPC2i person to the project's team with a team role (a client contact never joins the internal team). */
export async function addTeamMember(code: string, personId: string, role: ProjectTeamRole, actor: TeamActor): Promise<void> {
  const db = await getDb();
  try {
    await insertTeamMember(db, code, personId, role, actor);
  } catch (e) {
    // Two adds of the same person at once: the second insert hits the primary key (project, person).
    if (isUniqueViolation(e, ['project_members_project_id_person_id_pk'])) throw new TeamError('Already on the project team');
    throw e;
  }
}

async function insertTeamMember(db: DB, code: string, personId: string, role: ProjectTeamRole, actor: TeamActor): Promise<void> {
  await db.transaction(async (tx) => {
    const p = await projectRow(tx, code);
    const person = await personRow(tx, personId);
    if (person.clientId) throw new TeamError('A client contact cannot join the project team');
    if (p.pm === personId) throw new TeamError('Already on the project team');
    const [exists] = await tx.select({ id: projectMembers.personId }).from(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, personId)));
    if (exists) throw new TeamError('Already on the project team');
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${projectMembers.position}), -1)::int` }).from(projectMembers).where(eq(projectMembers.projectId, p.id));
    await tx.insert(projectMembers).values({ projectId: p.id, personId, projectRole: role, position: max + 1 });
    const who = nameOf(person);
    await trace(tx, actor, p.id, p.code, `added ${who} · ${PROJECT_TEAM_ROLE_LABEL[role]}`, `Added ${who} to the team of ${p.code} · ${PROJECT_TEAM_ROLE_LABEL[role]}`, personId);
  });
}

/** Changes a member's team role. The PM of record keeps their role here. */
export async function setTeamMemberRole(code: string, personId: string, role: ProjectTeamRole, actor: TeamActor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await projectRow(tx, code);
    if (p.pm === personId) throw new TeamError('The project manager of record is changed in the Projects register');
    const [m] = await tx
      .select({ role: projectMembers.projectRole })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, personId)));
    if (!m) throw new TeamError('Not on the project team');
    if (m.role === role) return;
    await tx.update(projectMembers).set({ projectRole: role }).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, personId)));
    const who = nameOf(await personRow(tx, personId));
    const from = isProjectTeamRole(m.role) ? PROJECT_TEAM_ROLE_LABEL[m.role] : m.role;
    await trace(tx, actor, p.id, p.code, `${who} · ${from} → ${PROJECT_TEAM_ROLE_LABEL[role]}`, `Changed ${who}'s role on ${p.code} · ${PROJECT_TEAM_ROLE_LABEL[role]}`, personId);
  });
}

/** Removes a member from the team (their tasks, activities and history stay). The PM of record cannot be removed here. */
export async function removeTeamMember(code: string, personId: string, actor: TeamActor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const p = await projectRow(tx, code);
    if (p.pm === personId) throw new TeamError('The project manager of record is changed in the Projects register');
    const removed = await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, personId)))
      .returning({ id: projectMembers.personId });
    if (!removed.length) throw new TeamError('Not on the project team');
    const who = nameOf(await personRow(tx, personId));
    await trace(tx, actor, p.id, p.code, `removed ${who}`, `Removed ${who} from the team of ${p.code}`, personId);
  });
}
