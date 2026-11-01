import 'server-only';
// R-201 (K-201): recurring tasks of « Mon travail » — the rule a task carries (tasks.recurrence_*), set or stopped on the task
// sheet, and the next occurrence created in the transaction that closes the current one (status Done, from the status segment,
// "Mark done", the list's done toggle, the board, the % segment at 100 % or the Plan drawer's to-do tick). Pure rules:
// src/domain/task-recurrence.ts. Dates: the project's calendar (working days), its schedule milestones, the business date.
import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BUILTIN_CALENDAR_BY_CODE, WorkCalendar, type IsoDate } from '@/domain/calendar';
import { nextOccurrence, RECURRENCE_KIND_LABEL, type TaskRecurrence } from '@/domain/task-recurrence';
import { systemMessage } from '@/domain/system-messages';
import { getDb, type Tx } from '@/server/db/client';
import { findPerson, nameOf, nextNumber, writeAudit } from '@/server/db/helpers';
import { activities, milestones, projectControls, projects, taskChecklistItems, tasks } from '@/server/db/schema';
import { monthIso } from '@/server/export/providers/common';
import { monthIndex } from '@/server/interchange/model';
import { loadWorkCalendars } from './calendars';

type TaskRecord = typeof tasks.$inferSelect;

/** The task's rule; null when it does not repeat. */
export function recurrenceOf(t: Pick<TaskRecord, 'recurrenceKind' | 'recurrenceInterval' | 'recurrenceAnchor' | 'recurrenceUntil'>): TaskRecurrence | null {
  if (!t.recurrenceKind || !t.recurrenceAnchor) return null;
  return { kind: t.recurrenceKind, interval: t.recurrenceInterval ?? 1, anchor: t.recurrenceAnchor, until: t.recurrenceUntil };
}

/**
 * Dates of the project's schedule milestones not done — the rule of the reminders (src/server/dal/reminders.ts): the linked
 * activity's finish, else the date the schedule draws from the milestone's month position.
 */
export async function projectMilestoneDates(q: Tx, projectId: string): Promise<IsoDate[]> {
  const anchor = alias(activities, 'anchor');
  const rows = await q
    .select({
      forecast: milestones.forecastMonth, anchorFinish: anchor.finishDate, controlsStart: projectControls.startMonth, projectStart: projects.startMonth,
      plannedStart: projects.plannedStartDate,
    })
    .from(milestones)
    .innerJoin(projects, eq(projects.id, milestones.projectId))
    .leftJoin(anchor, eq(anchor.id, milestones.activityId))
    .leftJoin(projectControls, eq(projectControls.projectId, projects.id))
    .where(and(eq(milestones.projectId, projectId), ne(milestones.status, 'done')));
  const dates: IsoDate[] = [];
  for (const r of rows) {
    const start = r.controlsStart ?? (r.projectStart != null ? Math.floor(r.projectStart) : r.plannedStart ? Math.floor(monthIndex(r.plannedStart)) : null);
    const due = r.anchorFinish ?? (start != null ? monthIso(start + r.forecast) : null);
    if (due) dates.push(due);
  }
  return dates;
}

/** The project's working calendar (its calendar code, else Standard 5d · 8h). */
async function projectCalendar(q: Tx, projectId: string): Promise<WorkCalendar> {
  const [p] = await q.select({ code: projects.code, calendar: projects.calendar }).from(projects).where(eq(projects.id, projectId));
  const code = p?.calendar ?? 'standard_5x8';
  const cals = await loadWorkCalendars(p?.code ?? null, q);
  return cals[code] ?? cals.standard_5x8 ?? new WorkCalendar(BUILTIN_CALENDAR_BY_CODE[code] ?? BUILTIN_CALENDAR_BY_CODE.standard_5x8);
}

async function actorOf(q: Tx, actorName: string) {
  const person = await findPerson(q, actorName);
  return { actorName: person ? nameOf(person) : actorName, actorPersonId: person?.id };
}

/**
 * In the transaction that closes `t` (status Done): creates the next occurrence of a recurring task — same title, description,
 * assignee, project, activity, priority, estimate, labels and department; status To do, 0 %, no hours; the checklist copied
 * unticked; the rule carried on — and audits it. Once per task (a reopened and closed again occurrence creates nothing more;
 * unique index on recurrence_previous_task_id). When the series ends (end date passed, no further milestone), audits that.
 * Returns the new task's number, or null.
 */
export async function createNextOccurrence(tx: Tx, t: TaskRecord, actorName: string, today: IsoDate): Promise<string | null> {
  const rule = recurrenceOf(t);
  if (!rule) return null;
  const [already] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.recurrencePreviousTaskId, t.id));
  if (already) return null;
  const [cal, miles] = await Promise.all([projectCalendar(tx, t.projectId), rule.kind === 'milestone' ? projectMilestoneDates(tx, t.projectId) : Promise.resolve([])]);
  const next = nextOccurrence(rule, { start: t.startDate, due: t.dueDate }, { today, milestones: miles, nextWorkDay: (iso) => cal.nextWorkDay(iso) });
  const who = await actorOf(tx, actorName);
  if (!next) {
    await writeAudit(tx, {
      ...who, objectRef: t.number, message: systemMessage('task.recurrenceEnded', { previous: t.number }), area: 'Tasks', entityType: 'task', entityId: t.id, projectId: t.projectId,
    });
    return null;
  }
  const number = await nextNumber(tx, tasks, tasks.number, 'T-', 4, 2340);
  // Appended to the list (TODOS order).
  const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${tasks.sortOrder}), 0)::int` }).from(tasks);
  const items = await tx.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, t.id)).orderBy(asc(taskChecklistItems.position));
  const [created] = await tx
    .insert(tasks)
    .values({
      number, assigneePersonId: t.assigneePersonId, contractRole: t.contractRole, title: t.title, description: t.description, projectId: t.projectId,
      activityId: t.activityId, status: 'todo', priority: t.priority, startDate: next.start, dueDate: next.due, estimateH: t.estimateH, loggedH: 0,
      percentComplete: 0, labels: t.labels, checklistDone: 0, checklistTotal: items.length ? 0 : t.checklistTotal, isFresh: false, departmentId: t.departmentId,
      sortOrder: max + 1, origin: t.origin,
      recurrenceKind: rule.kind, recurrenceInterval: rule.interval, recurrenceAnchor: rule.anchor, recurrenceUntil: rule.until, recurrencePreviousTaskId: t.id,
    })
    .returning({ id: tasks.id });
  if (items.length) await tx.insert(taskChecklistItems).values(items.map((i) => ({ taskId: created.id, position: i.position, text: i.text, done: false })));
  await writeAudit(tx, {
    ...who, objectRef: number, message: systemMessage('task.nextOccurrence', { task: number, previous: t.number, due: next.due }), area: 'Tasks', entityType: 'task',
    entityId: created.id, projectId: t.projectId, after: { previous: t.number, start: next.start, due: next.due, kind: rule.kind, interval: rule.interval, until: rule.until },
  });
  return number;
}

/**
 * Sets (or with null stops) the task's recurrence (task sheet). The Server Function checks the viewer and parses the rule; a
 * closed task is refused (the series goes on from its next occurrence). Audited with the values before and after.
 */
export async function setTaskRecurrence(number: string, rule: TaskRecurrence | null, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(tasks).where(eq(tasks.number, number)).for('update');
    if (!t) throw new Error(`Unknown task ${number}`);
    if (t.status === 'done') throw new Error('A closed task’s recurrence cannot change');
    const old = recurrenceOf(t);
    const same = old && rule ? old.kind === rule.kind && old.interval === rule.interval && old.until === rule.until : !old && !rule;
    if (same) return;
    // An unchanged kind and interval keep the series' anchor (only the end date moves).
    const value = rule && old && old.kind === rule.kind && old.interval === rule.interval ? { ...rule, anchor: old.anchor } : rule;
    await tx
      .update(tasks)
      .set({
        recurrenceKind: value?.kind ?? null, recurrenceInterval: value?.interval ?? null, recurrenceAnchor: value?.anchor ?? null, recurrenceUntil: value?.until ?? null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, t.id));
    const who = await actorOf(tx, actorName);
    await writeAudit(tx, {
      ...who, objectRef: t.number,
      message: value ? systemMessage('task.recurrenceSet', { kind: RECURRENCE_KIND_LABEL[value.kind], interval: value.interval }) : systemMessage('task.recurrenceStopped', {}),
      area: 'Tasks', entityType: 'task', entityId: t.id, projectId: t.projectId, before: old ? { ...old } : null, after: value ? { ...value } : null,
    });
  });
}

/** The occurrences of a task's series around it: the one it follows and the one created when it was closed (numbers). */
export async function recurrenceLinks(taskId: string, previousTaskId: string | null): Promise<{ previous: string | null; next: string | null }> {
  const db = await getDb();
  const [[prev], [next]] = await Promise.all([
    previousTaskId ? db.select({ n: tasks.number }).from(tasks).where(eq(tasks.id, previousTaskId)) : Promise.resolve([]),
    db.select({ n: tasks.number }).from(tasks).where(and(isNotNull(tasks.recurrencePreviousTaskId), eq(tasks.recurrencePreviousTaskId, taskId))),
  ]);
  return { previous: prev?.n ?? null, next: next?.n ?? null };
}
