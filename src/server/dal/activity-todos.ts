import 'server-only';
// Activity to-dos (chapter 4, Plan drawer "To-dos"): in the prototype an activity's to-dos ARE the tasks linked to it
// (state.todos filtered by `act`, shown with their assignee and due date); the composer "Add a to-do…" had no handler. Here
// it creates a task (T-nnnn, origin 'activity_todo') assigned to the activity owner by default, due at the activity finish;
// ticking toggles done ↔ in progress like My work; only to-dos created by the composer without logged time can be removed.
// R-015 (X-6a): the assignee of a new to-do is told in the bell ("Task assigned · T-xxxx") once it is committed, unless they
// created it themself.
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@/server/db/client';
import { businessToday } from '@/server/clock';
import { taskStatus, type TaskStatus } from '@/server/db/codes';
import { findPerson, nameOf, nextNumber, requireProject, writeAudit } from '@/server/db/helpers';
import { activities, persons, tasks, timeEntries } from '@/server/db/schema';
import { notifyTasksAssigned } from './task-notices';

export interface ActivityTodo {
  number: string;
  title: string;
  /** Full name of the assignee (or the contract role). */
  assignee: string | null;
  status: TaskStatus;
  statusLabel: string;
  done: boolean;
  dueDate: string;
  /** Created by the drawer composer, no time logged: "Remove" allowed. */
  removable: boolean;
}

async function activityOf(code: string, activityCode: string) {
  const db = await getDb();
  const p = await requireProject(db, code);
  const [a] = await db
    .select({ id: activities.id, owner: activities.ownerPersonId, finish: activities.finishDate })
    .from(activities)
    .where(and(eq(activities.projectId, p.id), eq(activities.code, activityCode)));
  if (!a) throw new Error(`Unknown activity ${activityCode}`);
  return { projectId: p.id, ...a };
}

/** Tasks linked to the activity, in My work order. */
export async function listActivityTodos(code: string, activityCode: string): Promise<ActivityTodo[]> {
  const a = await activityOf(code, activityCode);
  const db = await getDb();
  const who = alias(persons, 'assignee');
  const rows = await db
    .select({
      t: tasks, full: who.fullName, short: who.shortName,
      logged: sql<number>`(select count(*)::int from ${timeEntries} where ${timeEntries.taskId} = ${tasks.id})`,
    })
    .from(tasks)
    .leftJoin(who, eq(who.id, tasks.assigneePersonId))
    .where(eq(tasks.activityId, a.id))
    .orderBy(asc(tasks.sortOrder));
  return rows.map(({ t, full, short, logged }) => ({
    number: t.number, title: t.title, assignee: full ?? short ?? t.contractRole, status: t.status, statusLabel: taskStatus.label(t.status), done: t.status === 'done',
    dueDate: t.dueDate, removable: t.origin === 'activity_todo' && !logged && !t.loggedH,
  }));
}

export interface NewActivityTodo {
  title: string;
  /** Assignee (full or short name); default: the activity owner. */
  assignee?: string | null;
  /** ISO; default: the activity finish (or the business date, R-013). */
  dueDate?: string | null;
}

/** "Add a to-do…": creates the task, then tells its assignee (R-015, after the commit). Returns its number. */
export async function addActivityTodo(code: string, activityCode: string, input: NewActivityTodo, actorName: string): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error('A to-do needs a title');
  if (title.length > 200) throw new Error('A to-do title holds at most 200 characters');
  const a = await activityOf(code, activityCode);
  const db = await getDb();
  const today = await businessToday();
  const number = await db.transaction(async (tx) => {
    const assignee = input.assignee ? await findPerson(tx, input.assignee) : null;
    if (input.assignee && !assignee) throw new Error(`Unknown person "${input.assignee}"`);
    const due = input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : a.finish && a.finish >= today ? a.finish : today;
    const number = await nextNumber(tx, tasks, tasks.number, 'T-', 4, 2340);
    const [{ maxOrder }] = await tx.select({ maxOrder: sql<number>`coalesce(max(${tasks.sortOrder}), 0)::int` }).from(tasks);
    const [t] = await tx
      .insert(tasks)
      .values({
        number, assigneePersonId: assignee?.id ?? a.owner, title, projectId: a.projectId, activityId: a.id, status: 'todo', priority: 'med', startDate: today,
        dueDate: due < today ? today : due, estimateH: 0, loggedH: 0, percentComplete: 0, labels: [], sortOrder: maxOrder + 1, origin: 'activity_todo',
      })
      .returning({ id: tasks.id });
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `to-do added on ${activityCode}`, area: 'Tasks', entityType: 'task', entityId: t.id, projectId: a.projectId });
    return number;
  });
  await notifyTasksAssigned([number], actorName);
  return number;
}

async function todoOf(code: string, number: string) {
  const db = await getDb();
  const p = await requireProject(db, code);
  const [t] = await db.select().from(tasks).where(and(eq(tasks.number, number), eq(tasks.projectId, p.id)));
  if (!t || !t.activityId) throw new Error(`Unknown to-do ${number}`);
  return t;
}

/** Tick / untick: done (100 %) ↔ in progress (75 %), as the My work list toggle. */
export async function setActivityTodoDone(code: string, number: string, done: boolean, actorName: string): Promise<void> {
  const t = await todoOf(code, number);
  if ((t.status === 'done') === done) return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(tasks).set({ status: done ? 'done' : 'doing', percentComplete: done ? 100 : 75, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, {
      actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: `status: ${taskStatus.label(t.status)} → ${taskStatus.label(done ? 'done' : 'doing')}`,
      area: 'Tasks', entityType: 'task', entityId: t.id, projectId: t.projectId,
    });
  });
}

/** Removes a to-do created by the composer that has no logged time (other tasks are managed in My work). */
export async function removeActivityTodo(code: string, number: string, actorName: string): Promise<void> {
  const t = await todoOf(code, number);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(timeEntries).where(eq(timeEntries.taskId, t.id));
    if (t.origin !== 'activity_todo' || n > 0 || t.loggedH > 0) throw new Error(`${number} cannot be removed here`);
    await tx.delete(tasks).where(eq(tasks.id, t.id));
    const actor = await findPerson(tx, actorName);
    await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: number, change: 'to-do removed', area: 'Tasks', entityType: 'task', entityId: t.id, projectId: t.projectId });
  });
}
