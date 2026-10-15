import 'server-only';
// Task notifications in Keystone's bell (X-6a, X-6b: no e-mail yet — R-036): the people @mentioned in a task comment (R-149,
// R-8b a) and the assignee of a task created for them by someone else (R-015: meeting follow-ups, Plan to-dos; tasks born from
// resource requests are announced by the requests feature). Sent after the writer's transaction committed, never inside it
// (createNotification has its own transaction): a failure is logged and never undoes the write. Titles are fixed English
// templates translated by t() in the bell; the typed text (comment excerpt, task title) goes in the sub-line, shown with
// fieldsText (R-148). The actor is never told about their own action.
import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import type { MentionCandidate } from '@/domain/mentions';
import { getDb, type DB, type Tx } from '@/server/db/client';
import { persons, projects, tasks, users } from '@/server/db/schema';
import { logError } from '@/server/log';
import { createNotification } from './notifications';
import { procurementPersonIds, type NamedSourcing } from './requests';

type Q = DB | Tx;

/**
 * People who can be @mentioned (R-8b a): persons with an active internal user account — not an external user, not a client
 * account, not a client organisation's contact. Others (no account yet — in Entra mode, people who never signed in) are not
 * mentionable: their name stays plain text and nobody is told (the agreed default).
 */
export async function listMentionablePersons(q?: Q): Promise<MentionCandidate[]> {
  const db = q ?? (await getDb());
  const rows = await db
    .select({ key: persons.id, fullName: persons.fullName, shortName: persons.shortName })
    .from(persons)
    .innerJoin(users, eq(users.personId, persons.id))
    .where(and(eq(users.active, true), eq(users.isExternal, false), isNull(users.clientId), isNull(persons.clientId), not(sql`'client' = any(${users.roles})`)));
  return rows;
}

/**
 * P-8b (R-089): every active procurement user is told about a new sourcing task — "Person to find and name · T-xxxx", sub
 * "{contract role} · {request title} · due {date}", opening the task — never the actor. Never throws.
 */
export async function notifySourcingTask(
  taskNumber: string, request: { contractRole: string; title: string; due: string; projectCode: string }, actorName: string,
): Promise<void> {
  try {
    const db = await getDb();
    const [actor] = await db.select({ id: persons.id }).from(persons).where(sql`${persons.fullName} = ${actorName} or ${persons.shortName} = ${actorName}`);
    const to = (await procurementPersonIds()).filter((id) => id !== actor?.id);
    if (!to.length) return;
    await createNotification({
      kind: 'task', title: `Person to find and name · ${taskNumber}`, sub: `${request.contractRole} · ${request.title} · due ${request.due}`, screen: 'task',
      params: { taskId: taskNumber }, projectCode: request.projectCode, audience: [], toPersonIds: to,
    });
  } catch (e) {
    logError('Sourcing task notification', e);
  }
}

/**
 * P-8b (R-089): once procurement named the person of a sourcing task — the requesting PM ("Person named · RQ-xxx", sub
 * "{person} · {task}") and the person, when they have an account ("Task assigned · T-xxxx"); never the actor. Never throws.
 */
export async function notifyPersonNamed(n: NamedSourcing, actorName: string): Promise<void> {
  try {
    const db = await getDb();
    const [actor] = await db.select({ id: persons.id }).from(persons).where(sql`${persons.fullName} = ${actorName} or ${persons.shortName} = ${actorName}`);
    const [pmUser] = await db.select({ id: users.id }).from(users).where(and(eq(users.personId, n.pmPersonId), eq(users.active, true)));
    if (pmUser && n.pmPersonId !== actor?.id)
      await createNotification({
        kind: 'request', title: `Person named · ${n.request}`, sub: `${n.person} · ${n.task}`, screen: 'requests', params: { status: 'approved' }, projectCode: n.projectCode,
        audience: [], toPersonIds: [n.pmPersonId],
      });
  } catch (e) {
    logError('Person named notification', e);
  }
  await notifyTasksAssigned([n.task], actorName);
}

/** "@you in T-2341" — fixed template (FR rule "@vous dans T-2341", src/i18n/fr-rules.ts). */
export const mentionTitle = (taskNumber: string) => `@you in ${taskNumber}`;
/** "Task assigned · T-2341" — fixed template, translated per segment. */
export const assignedTitle = (taskNumber: string) => `Task assigned · ${taskNumber}`;

/**
 * R-149: tells each person mentioned in a comment — kind 'mention', '@you in T-xxxx', sub '“excerpt” · author', opening the
 * task. `personIds` exclude the author already (the DAL resolves them); one notification per person. Never throws.
 */
export async function notifyTaskMentions(
  task: { number: string; projectCode: string },
  personIds: readonly string[],
  excerpt: string,
  authorName: string,
): Promise<void> {
  for (const id of new Set(personIds)) {
    try {
      await createNotification({
        kind: 'mention', title: mentionTitle(task.number), sub: `“${excerpt}” · ${authorName}`, screen: 'task', params: { taskId: task.number },
        projectCode: task.projectCode, audience: [], toPersonIds: [id],
      });
    } catch (e) {
      logError('Task mention notification', e);
    }
  }
}

/**
 * R-015 (X-6a): tells the assignee of each task created for them — kind 'task', 'Task assigned · T-xxxx', sub = the task
 * title (typed text), opening the task — unless they are the actor (`actorName`: full or short name). Tasks without a person
 * (contract role) or whose assignee has no account are skipped. Never throws.
 */
export async function notifyTasksAssigned(taskNumbers: readonly string[], actorName: string): Promise<void> {
  if (!taskNumbers.length) return;
  try {
    const db = await getDb();
    const [actor] = await db.select({ id: persons.id }).from(persons).where(sql`${persons.fullName} = ${actorName} or ${persons.shortName} = ${actorName}`);
    const rows = await db
      .select({ number: tasks.number, title: tasks.title, assignee: tasks.assigneePersonId, code: projects.code })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(inArray(tasks.number, [...taskNumbers]));
    const assignees = [...new Set(rows.map((r) => r.assignee).filter((x): x is string => !!x))];
    const withAccount = new Set(
      assignees.length ? (await db.select({ p: users.personId }).from(users).where(and(eq(users.active, true), inArray(users.personId, assignees)))).map((u) => u.p) : [],
    );
    for (const r of rows) {
      if (!r.assignee || r.assignee === actor?.id || !withAccount.has(r.assignee)) continue;
      await createNotification({
        kind: 'task', title: assignedTitle(r.number), sub: r.title, screen: 'task', params: { taskId: r.number }, projectCode: r.code, audience: [], toPersonIds: [r.assignee],
      });
    }
  } catch (e) {
    logError('Task assigned notification', e);
  }
}
