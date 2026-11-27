// Owner's decisions of 27 Nov 2026 (ING-29): the demo's confidential R&D project — Fleet Telematics Upgrade (FTU-052, a proposed
// project without planning data) becomes an R&D project marked confidential, with a small team: its PM of record (A. Naveau),
// the engineering lead (Antoine Girard, referent — the engineering person who makes the project appear in Ingenium) and the
// portfolio director (Marie Lefebvre, added by the PM: a director sees a confidential project only once on its team). The other
// personas never see it. A demo database seeded before it gets it once (app_settings key below), while FTU-052 is still normal.
import { and, eq, sql } from 'drizzle-orm';
import { appSettings, persons, projectMembers, projects } from '../schema';
import type { DB, Tx } from '../types';

export const DEMO_CONFIDENTIAL_PROJECT = 'FTU-052';
/** [person full name, team role] — added after the PM of record. */
export const DEMO_CONFIDENTIAL_TEAM: readonly [string, 'referent' | 'team'][] = [
  ['Antoine Girard', 'referent'],
  ['Marie Lefebvre', 'team'],
];
export const DEMO_CONFIDENTIAL_SEEDED = 'seed.demo-confidential-project';

export async function seedDemoConfidentialProject(tx: Tx): Promise<void> {
  await tx.insert(appSettings).values({ key: DEMO_CONFIDENTIAL_SEEDED, value: { done: true } }).onConflictDoNothing();
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, DEMO_CONFIDENTIAL_PROJECT));
  if (!p) return;
  await tx.update(projects).set({ confidentiality: 'confidential', category: 'rd' }).where(eq(projects.id, p.id));
  for (const [name, role] of DEMO_CONFIDENTIAL_TEAM) {
    const [person] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.fullName, name));
    if (!person) continue;
    const [exists] = await tx.select({ id: projectMembers.personId }).from(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, person.id)));
    if (exists) continue;
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${projectMembers.position}), -1)::int` }).from(projectMembers).where(eq(projectMembers.projectId, p.id));
    await tx.insert(projectMembers).values({ projectId: p.id, personId: person.id, projectRole: role, position: max + 1 });
  }
}

/** A demo database seeded before it: never done, FTU-052 exists and no project is confidential yet. */
export async function demoConfidentialToBackfill(q: DB | Tx): Promise<boolean> {
  const [done] = await q.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, DEMO_CONFIDENTIAL_SEEDED));
  if (done) return false;
  const [p] = await q.select({ id: projects.id }).from(projects).where(eq(projects.code, DEMO_CONFIDENTIAL_PROJECT));
  if (!p) return false;
  const [{ n }] = await q.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.confidentiality, 'confidential'));
  return n === 0;
}
