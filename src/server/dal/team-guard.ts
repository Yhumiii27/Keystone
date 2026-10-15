import 'server-only';
// Delivery 7 (R-041, P-2) — the project-team rule re-checked by DAL writers (defense in depth). The Server Functions check
// it first with the viewer's project context (`getProjectContext(code).canEdit(screen)`, `projectAccessResolver(viewer)`);
// these helpers let a writer refuse a direct call with an actor who is not on the project's named team, so another caller
// cannot bypass the rule. Same facts as `projectAccess` (src/domain/rights.ts): the PM of record or any team row (co-PM,
// deputy, referent, team member); the director on every project. Client contacts are refused here: the writers using these
// helpers are internal (stock, orders, contingency, plan links of a change request).
import { and, eq } from 'drizzle-orm';
import { ROLE_SCREENS, canSee } from '@/config/role-screens';
import type { RoleKey, ScreenId } from '@/config/screens';
import { financeReadOnly } from '@/domain/rights';
import { findPerson } from '@/server/db/helpers';
import { projectMembers, projects } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';
import type { Actor } from './ops-common';
import { leadsProject } from './project-team';

type Q = DB | Tx;

/** The screen is in the actor's workspace (an unknown role has none — `canSee` alone would read it as the director's). */
export const actorSees = (actor: Pick<Actor, 'role'>, screen: ScreenId) =>
  Object.hasOwn(ROLE_SCREENS, actor.role) && canSee(actor.role as RoleKey, screen);

/** The actor is on the project's named team (PM of record or any team role), or is the portfolio director; never a client. */
export async function onProjectTeam(q: Q, actor: Actor, projectId: string): Promise<boolean> {
  if (actor.role === 'director') return true;
  if (actor.role === 'client' || !Object.hasOwn(ROLE_SCREENS, actor.role)) return false;
  const person = await findPerson(q, actor.name);
  if (!person) return false;
  const [p] = await q.select({ pm: projects.pmPersonId }).from(projects).where(eq(projects.id, projectId));
  if (!p) return false;
  if (p.pm === person.id) return true;
  const [m] = await q
    .select({ personId: projectMembers.personId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.personId, person.id)));
  return !!m;
}

/**
 * `getProjectContext(code).canEdit(screen)` for an internal writer: the screen is in the actor's workspace and the actor is
 * on the project's team (or is the director). A client is refused. R-044: Finance reads Budget, Hours and Billing even on its
 * teams (`financeReadOnly`). The Contract screen follows P-4 instead: `editsContract`.
 */
export async function editsProjectScreen(q: Q, actor: Actor, projectId: string, screen: ScreenId): Promise<boolean> {
  return actorSees(actor, screen) && !financeReadOnly(actor.role as RoleKey, screen) && (await onProjectTeam(q, actor, projectId));
}

/**
 * P-4 (R-044) — `canEditContract` (src/domain/rights.ts) for the contract writers: the director and Finance on every project
 * (delivery-8 default, not the named-team rule of P-2); otherwise a lead of the project (PM of record, co-PM, deputy) whose
 * workspace has the Contract screen. A client, or a role without the Contract screen, is refused.
 */
export async function editsContract(q: Q, actor: Actor, projectId: string): Promise<boolean> {
  if (actor.role === 'client' || !actorSees(actor, 'contract')) return false;
  if (actor.role === 'director' || actor.role === 'finance') return true;
  const person = await findPerson(q, actor.name);
  return !!person && leadsProject(q, projectId, person.id);
}
