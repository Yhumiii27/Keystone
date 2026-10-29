import 'server-only';
// Delivery 8 (R-015 part, X-6a): bell notices of the change-request chain — after a request is submitted, the approvers of its
// current step; after each decision, the approvers of the new current step (R-069: the chain is sequential); on the final
// approval or rejection, the requester. Rule: `crNoticeOf` (src/domain/change-control.ts). Called by the Server Functions AFTER
// the writer's transaction committed (a notice never runs inside it — createNotification opens its own transaction, and a
// retried transaction must not notify twice); a failure is logged and never undoes the decision. Keystone's bell, and the e-mail
// each person chose (R-036: approvals at once by default). Client contacts receive it through the bell's read-time filter like any notice (src/server/dal/shell.ts).
import { asc, eq } from 'drizzle-orm';
import { crNoticeOf } from '@/domain/change-control';
import { getDb } from '@/server/db/client';
import { findPerson } from '@/server/db/helpers';
import { projects, users } from '@/server/db/schema';
import { logError } from '@/server/log';
import { listChangeRequestDetails } from './changes';
import { createNotification } from './notifications';

/**
 * Sends the notice the request's current state calls for (none when nobody is to be told). `actorName`: who just acted (never
 * notified). Best effort: errors are logged, never thrown. Returns the persons notified (tests).
 */
export async function notifyChangeRequest(projectCode: string, number: string, actorName: string): Promise<string[]> {
  try {
    const db = await getDb();
    const [p] = await db.select({ pm: projects.pmPersonId, clientId: projects.clientId }).from(projects).where(eq(projects.code, projectCode));
    const cr = p ? (await listChangeRequestDetails(projectCode)).find((c) => c.id === number) : undefined;
    if (!p || !cr) return [];
    const accounts = await db
      .select({ personId: users.personId, roles: users.roles, clientId: users.clientId })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.sortOrder));
    const people = {
      pm: p.pm,
      directors: accounts.filter((u) => u.roles.includes('director')).map((u) => u.personId),
      clientContacts: p.clientId ? accounts.filter((u) => u.clientId === p.clientId).map((u) => u.personId) : [],
      requester: cr.requestedByPersonId,
    };
    const actor = await findPerson(db, actorName);
    const notice = crNoticeOf(cr, people, actor?.id ?? null);
    if (!notice) return [];
    const audience = [...new Set(accounts.filter((u) => notice.toPersonIds.includes(u.personId)).flatMap((u) => u.roles))];
    await createNotification({
      kind: 'approval', title: notice.title, sub: cr.title, screen: 'changes', params: { cr: cr.id }, projectCode, audience, toPersonIds: notice.toPersonIds,
    });
    return notice.toPersonIds;
  } catch (e) {
    logError('notifyChangeRequest', e, { projectCode, number });
    return [];
  }
}
