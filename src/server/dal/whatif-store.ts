import 'server-only';
// What-if persistence additions (chapter 4, S-7): the actions of a scenario (overtime, extra resource, shifted start) derived
// from real allocations, the effects computed by the CPM engine on a copy of the plan, and the "Apply" stamp. Scenario
// create / select / priority stay in resources.ts (owned by the what-if feature).
import { and, asc, eq } from 'drizzle-orm';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { whatIfActionKind, type WhatIfActionKind } from '@/server/db/codes';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, departments, persons, whatIfScenarioActions, whatIfScenarios } from '@/server/db/schema';

type Q = DB | Tx;

export interface ScenarioAction {
  kind: WhatIfActionKind;
  /** Activity code ("A1250"), person (full or short name) and department name, as relevant. */
  activityCode?: string | null;
  person?: string | null;
  department?: string | null;
  /** { hoursPerDay } (overtime), { extraUnits, hoursPerDay } (extra resource), { shiftDays } (shift)… */
  params: Record<string, unknown>;
  enabled?: boolean;
  /** EN source label. */
  label?: string;
}

async function scenarioOf(q: Q, code: string, name: string) {
  const p = await requireProject(q, code);
  const [s] = await q.select().from(whatIfScenarios).where(and(eq(whatIfScenarios.projectId, p.id), eq(whatIfScenarios.name, name)));
  if (!s) throw new Error(`Unknown scenario ${name}`);
  return { projectId: p.id, s };
}

/** Actions of a scenario in order. */
export async function listScenarioActions(code: string, name: string, q?: Q): Promise<(ScenarioAction & { enabled: boolean; label: string })[]> {
  const db = q ?? (await getDb());
  const { s } = await scenarioOf(db, code, name);
  const rows = await db
    .select({ a: whatIfScenarioActions, act: activities.code, person: persons.fullName, personShort: persons.shortName, dept: departments.name })
    .from(whatIfScenarioActions)
    .leftJoin(activities, eq(activities.id, whatIfScenarioActions.activityId))
    .leftJoin(persons, eq(persons.id, whatIfScenarioActions.personId))
    .leftJoin(departments, eq(departments.id, whatIfScenarioActions.departmentId))
    .where(eq(whatIfScenarioActions.scenarioId, s.id))
    .orderBy(asc(whatIfScenarioActions.position));
  return rows.map(({ a, act, person, personShort, dept }) => ({
    kind: a.kind, activityCode: act, person: person ?? personShort, department: dept, params: a.params, enabled: a.enabled, label: a.label,
  }));
}

/** Replaces the actions of a scenario (validated: kind, activity of the project, known person / department). */
export async function replaceScenarioActions(code: string, name: string, actions: ScenarioAction[], actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { projectId, s } = await scenarioOf(tx, code, name);
    const rows = [];
    for (const [position, a] of actions.entries()) {
      if (!whatIfActionKind.isCode(a.kind)) throw new Error(`Unknown action "${a.kind}"`);
      let activityId: string | null = null;
      if (a.activityCode) {
        const [act] = await tx.select({ id: activities.id }).from(activities).where(and(eq(activities.projectId, projectId), eq(activities.code, a.activityCode)));
        if (!act) throw new Error(`Unknown activity ${a.activityCode}`);
        activityId = act.id;
      }
      const person = a.person ? await findPerson(tx, a.person) : null;
      if (a.person && !person) throw new Error(`Unknown person "${a.person}"`);
      let departmentId: string | null = null;
      if (a.department) {
        const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.name, a.department));
        if (!d) throw new Error(`Unknown department "${a.department}"`);
        departmentId = d.id;
      }
      rows.push({ scenarioId: s.id, position, kind: a.kind, activityId, personId: person?.id ?? null, departmentId, params: a.params ?? {}, enabled: a.enabled ?? true, label: a.label ?? '' });
    }
    await tx.delete(whatIfScenarioActions).where(eq(whatIfScenarioActions.scenarioId, s.id));
    if (rows.length) await tx.insert(whatIfScenarioActions).values(rows);
    await tx.update(whatIfScenarios).set({ result: null, computedAt: null, updatedAt: new Date() }).where(eq(whatIfScenarios.id, s.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: `${code} scenario ${name}`, change: `${rows.length} actions`, area: 'Resources', entityType: 'whatif_scenario', entityId: s.id, projectId });
  });
}

/** Stores the computed effects of a scenario (new finish, cost delta, load delta…). */
export async function saveScenarioResult(code: string, name: string, result: Record<string, unknown>, q?: Q): Promise<void> {
  const db = q ?? (await getDb());
  const { s } = await scenarioOf(db, code, name);
  await db.update(whatIfScenarios).set({ result, computedAt: new Date() }).where(eq(whatIfScenarios.id, s.id));
}

/** "Apply": stamps the scenario (the drafted requests carry `scenarioId`; call inside the same transaction). */
export async function markScenarioApplied(code: string, name: string, actorName: string, q: Q): Promise<string> {
  const { projectId, s } = await scenarioOf(q, code, name);
  const actor = await findPerson(q, actorName);
  const who = actor ? nameOf(actor) : actorName;
  await q.update(whatIfScenarios).set({ appliedAt: new Date(), appliedByName: who, updatedAt: new Date() }).where(eq(whatIfScenarios.id, s.id));
  await writeAudit(q, { actorName: who, actorPersonId: actor?.id, objectRef: `${code} scenario ${name}`, change: 'applied · draft requests created', area: 'Resources', entityType: 'whatif_scenario', entityId: s.id, projectId });
  return s.id;
}
