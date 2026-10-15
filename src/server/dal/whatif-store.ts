import 'server-only';
// What-if persistence shared with the foundation (chapter 4, S-7): the "Apply" stamp of a scenario. The scenarios, their
// levers (`whatif_scenario_actions`, one row per derived lever with `params.leverCode`) and their computed effects are
// written by the what-if feature in resources.ts — the only writer of those rows, so the table keeps a single params shape.
import { and, eq } from 'drizzle-orm';
import type { DB, Tx } from '@/server/db/client';
import { findPerson, nameOf, requireProject, writeAudit } from '@/server/db/helpers';
import { whatIfScenarios } from '@/server/db/schema';

type Q = DB | Tx;

async function scenarioOf(q: Q, code: string, name: string) {
  const p = await requireProject(q, code);
  const [s] = await q.select().from(whatIfScenarios).where(and(eq(whatIfScenarios.projectId, p.id), eq(whatIfScenarios.name, name)));
  if (!s) throw new Error(`Unknown scenario ${name}`);
  return { projectId: p.id, s };
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
