// R-051 (P-7d): the scope of ONE decision a substitute records on an approver's behalf (src/features/myapprovals/
// delegation-actions.ts). Inside `runOnBehalf`:
// - `getViewer()` (src/server/session.ts) answers the approver, so the module's own Server Function applies the approver's
//   rights and routing to that single item — nothing else is widened, and the scope ends with the call;
// - `writeAudit` / `recordActivity` (src/server/db/helpers.ts) write the rows of the approver's name in the substitute's name,
//   with `on_behalf_of_name` = the approver ("on behalf of").
// No 'server-only' import: the database helpers (also loaded by tsx scripts) read it.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Persona } from '@/config/personas';

export interface DelegationScope {
  delegationId: string;
  /** The approver whose item is decided (their rights apply). */
  approver: Persona;
  /** The person who actually decides (named in audit and activity). */
  substitute: Persona;
}

const store = new AsyncLocalStorage<DelegationScope>();

/** Runs `fn` as one decision on the approver's behalf. Never nested: a scope inside a scope is refused (no chaining). */
export function runOnBehalf<T>(scope: DelegationScope, fn: () => Promise<T>): Promise<T> {
  if (store.getStore()) return Promise.reject(new Error('A delegated decision cannot be delegated again'));
  return store.run(scope, fn);
}

/** The delegated decision in progress, or null. */
export const currentDelegation = (): DelegationScope | null => store.getStore() ?? null;

/** Actor fields of an audit or activity row written during a delegated decision (unchanged outside one, or for another actor). */
export function delegatedActor<E extends { actorName: string; actorPersonId?: string | null; actorUserId?: string | null }>(e: E): E & { onBehalfOfName: string | null } {
  const scope = store.getStore();
  if (!scope || e.actorName !== scope.approver.name) return { ...e, onBehalfOfName: null };
  const { substitute } = scope;
  const out = { ...e, actorName: substitute.name, actorPersonId: substitute.personId ?? null, onBehalfOfName: scope.approver.name };
  // The user account: the substitute's when known, else resolved from their name (demo personas).
  if (e.actorUserId !== undefined) out.actorUserId = substitute.userId ?? undefined;
  return out;
}
