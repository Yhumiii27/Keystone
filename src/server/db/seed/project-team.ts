// Delivery 7 (R-041, P-2) demo data: the named project teams get referents. With P-2 only a project's team edits it, so the
// engineering lead (Antoine Girard, "Référent ingénierie") and the quality manager (Gabriel Comte) — who edited every project
// before — are the referents of Harbor Line (HLT-026), the demo's default project; elsewhere they read. The prototype's teams
// (DEFS.team) stay team members; the PM of record is `projects.pm_person_id`.
// A database seeded before delivery 7 gets them once (no team row other than 'team' yet — `demoReferentsToBackfill`).
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { persons, projectMembers, projects } from '../schema';
import type { DB, Tx } from '../types';

/** [project, person full name, team role] — the demo referents (persona persons). */
export const DEMO_REFERENTS: readonly [string, string, 'referent'][] = [
  ['HLT-026', 'Antoine Girard', 'referent'],
  ['HLT-026', 'Gabriel Comte', 'referent'],
];

/** Inserts the demo referents after the project's team (positions continue its order); unknown projects or people are skipped. */
export async function seedDemoReferents(tx: Tx): Promise<void> {
  for (const [code, name, role] of DEMO_REFERENTS) {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
    const [person] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.fullName, name));
    if (!p || !person) continue;
    const [exists] = await tx.select({ id: projectMembers.personId }).from(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, person.id)));
    if (exists) continue;
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${projectMembers.position}), -1)::int` }).from(projectMembers).where(eq(projectMembers.projectId, p.id));
    await tx.insert(projectMembers).values({ projectId: p.id, personId: person.id, projectRole: role, position: max + 1 });
  }
}

/** A demo database seeded before delivery 7: the demo projects exist and no team row carries a role other than 'team'. */
export async function demoReferentsToBackfill(q: DB | Tx): Promise<boolean> {
  const codes = [...new Set(DEMO_REFERENTS.map(([c]) => c))];
  const [{ n }] = await q.select({ n: sql<number>`count(*)::int` }).from(projects).where(inArray(projects.code, codes));
  if (!n) return false;
  const [{ roles }] = await q.select({ roles: sql<number>`count(*)::int` }).from(projectMembers).where(ne(projectMembers.projectRole, 'team'));
  return roles === 0;
}
