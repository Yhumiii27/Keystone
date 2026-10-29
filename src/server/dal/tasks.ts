import 'server-only';
// Tasks DAL (docs/spec/10 §6–7, 11 §3.4 Task): a person's task list (My work), the task sheet (checklist,
// comments, files, time entries, plan position, labour cost rate) and the writers — status and % with their
// coupling, checklist ticks and items, comments by the viewer, time logging.
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { rateAt, taskLaborCost, type TaskCost } from '@/domain/hr';
import { mentionedKeys } from '@/domain/mentions';
import { applyProgress, applyStatus } from '@/domain/tasks';
import { businessToday } from '@/server/clock';
import { getDb, type Tx } from '@/server/db/client';
import {
  ATTACHMENT_ICON, dayLabelOfIso, dayOffsetOfIso, priority as priorityCodec, relativeDayText, relativeStampText, taskStatus,
  type AttachmentKind, type Priority, type TaskStatus, type TimeEntrySource,
} from '@/server/db/codes';
import { findPerson, nameOf, requirePerson, writeAudit } from '@/server/db/helpers';
import {
  activities, departments, persons, projects, resourceRequests, taskAttachments, taskChecklistItems, taskComments, tasks, timeEntries, wbsNodes,
} from '@/server/db/schema';
import { getRateGrid } from './hr';
import { listMentionablePersons } from './task-notices';

export interface TaskRow {
  /** "T-2314". */
  id: string;
  title: string;
  /** DESC; null → the Task screen's generated sentence. */
  description: string | null;
  /** Assignee full name (or the contract role when no person). */
  assignee: string;
  assigneeShort: string | null;
  assigneeInitials: string | null;
  /** EN source string ("QA / QC"). */
  assigneeJobTitle: string | null;
  contractRole: string | null;
  project: { code: string; short: string; name: string; shortName: string | null };
  activity: {
    code: string; name: string; wbs: string; packageName: string | null; finish: string; finishActual: boolean; finishDate: string | null;
    totalFloat: number | null; pct: number;
  } | null;
  status: TaskStatus;
  /** STATUS_L label. */
  statusLabel: string;
  priority: Priority;
  /** 'Low' | 'Medium' | 'High'. */
  priorityLabel: string;
  start: string;
  due: string;
  /** Working-day offsets from Mon 21 Sep 2026 (`dayDate` axis). */
  startDay: number | null;
  dueDay: number | null;
  estimateH: number;
  loggedH: number;
  pct: number;
  labels: string[];
  /** Ticked / total checklist items (stored counts when the task has no items). */
  checklist: { done: number; total: number };
  isFresh: boolean;
  /** Approving department of tasks created from a request. */
  department: string | null;
  /** Request that created it ("RQ-040"). */
  sourceRequest: string | null;
}

export interface TaskComment {
  author: string;
  authorShort: string;
  initials: string;
  postedAt: string;
  /** "Today 08:15" / "Yesterday 16:40" relative to the business date (R-013), else "8 Oct 14:05". */
  when: string;
  text: string;
}

export interface TaskAttachment {
  /** task_attachments.id (download / remove, chapter 4). */
  id: string;
  name: string;
  /** "48 KB · H. Sauvage · today". */
  meta: string;
  sizeText: string;
  uploadedBy: string | null;
  uploadedOn: string;
  kind: AttachmentKind;
  /** Phosphor class ("ph ph-file-xls"). */
  icon: string;
  /** Content stored by Keystone (chapter 4); false for the seed's files, which have none. */
  hasFile: boolean;
}

export interface TimeEntryRow {
  date: string;
  /** "Wed 23 Sep". */
  dateText: string;
  hours: number;
  note: string;
  person: string | null;
  source: TimeEntrySource;
}

export interface TaskDetail extends TaskRow {
  checklistItems: { position: number; text: string; done: boolean }[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  entries: TimeEntryRow[];
  /** Cost note valuation (A-10, R-083 — `taskLaborCost`): replaces the job-title rate and its 100 €/h default. */
  costNote: TaskCostNote;
}

/**
 * The task's actual labour cost (R-083): each time entry at the rate of the person who logged it on the entry's date, the logged
 * hours without an entry at the assignee's rate in force today; `todayRate` values hours logged since the page was read.
 */
export interface TaskCostNote extends TaskCost {
  todayRate: number | null;
}

export interface TaskFilter {
  /** Assignee (full or short name). */
  person?: string;
  projectCode?: string;
  activityCode?: string;
  number?: string;
}

/** Tasks in list order (TODOS order, new tasks appended), optionally filtered. */
export async function listTasks(filter: TaskFilter = {}): Promise<TaskRow[]> {
  const db = await getDb();
  const who = alias(persons, 'who');
  const where: SQL[] = [];
  if (filter.person) where.push(sql`(${who.fullName} = ${filter.person} or ${who.shortName} = ${filter.person})`);
  if (filter.projectCode) where.push(eq(projects.code, filter.projectCode));
  if (filter.activityCode) where.push(eq(activities.code, filter.activityCode));
  if (filter.number) where.push(eq(tasks.number, filter.number));
  const rows = await db
    .select({
      t: tasks, full: who.fullName, short: who.shortName, initials: who.initials, job: who.jobTitle,
      code: projects.code, pshort: projects.shortCode, pname: projects.name, pshortName: projects.shortName,
      a: activities, wbs: wbsNodes.code, pkg: wbsNodes.name, dept: departments.name, req: resourceRequests.number,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(who, eq(who.id, tasks.assigneePersonId))
    .leftJoin(activities, eq(activities.id, tasks.activityId))
    .leftJoin(wbsNodes, eq(wbsNodes.id, activities.wbsNodeId))
    .leftJoin(departments, eq(departments.id, tasks.departmentId))
    .leftJoin(resourceRequests, eq(resourceRequests.id, tasks.sourceRequestId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(tasks.sortOrder));
  if (!rows.length) return [];
  const counts = await db
    .select({ taskId: taskChecklistItems.taskId, total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${taskChecklistItems.done})::int` })
    .from(taskChecklistItems)
    .where(inArray(taskChecklistItems.taskId, rows.map((r) => r.t.id)))
    .groupBy(taskChecklistItems.taskId);
  return rows.map((r) => {
    const t = r.t;
    const c = counts.find((x) => x.taskId === t.id);
    return {
      id: t.number, title: t.title, description: t.description, assignee: r.short ? (r.full ?? r.short) : (t.contractRole ?? ''), assigneeShort: r.short,
      assigneeInitials: r.initials, assigneeJobTitle: r.job, contractRole: t.contractRole,
      project: { code: r.code, short: r.pshort, name: r.pname, shortName: r.pshortName },
      activity: r.a
        ? {
            code: r.a.code, name: r.a.name, wbs: r.wbs!, packageName: r.pkg, finish: r.a.finishText, finishActual: r.a.finishActual, finishDate: r.a.finishDate,
            totalFloat: r.a.totalFloatDays, pct: r.a.percentComplete,
          }
        : null,
      status: t.status, statusLabel: taskStatus.label(t.status), priority: t.priority, priorityLabel: priorityCodec.label(t.priority),
      start: t.startDate, due: t.dueDate, startDay: dayOffsetOfIso(t.startDate), dueDay: dayOffsetOfIso(t.dueDate),
      estimateH: t.estimateH, loggedH: t.loggedH, pct: t.percentComplete, labels: t.labels,
      checklist: c ? { done: c.done, total: c.total } : { done: t.checklistDone, total: t.checklistTotal },
      isFresh: t.isFresh, department: r.dept, sourceRequest: r.req,
    };
  });
}

/** Task sheet; null when unknown. */
export async function getTask(number: string): Promise<TaskDetail | null> {
  const [row] = await listTasks({ number });
  if (!row) return null;
  const db = await getDb();
  const [{ id }] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.number, number));
  const author = alias(persons, 'author');
  const uploader = alias(persons, 'uploader');
  const entryPerson = alias(persons, 'entry_person');
  const [items, comments, files, entries, [assignee], grid, today] = await Promise.all([
    db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, id)).orderBy(asc(taskChecklistItems.position)),
    db
      .select({ c: taskComments, full: author.fullName, short: author.shortName, initials: author.initials })
      .from(taskComments)
      .innerJoin(author, eq(author.id, taskComments.authorPersonId))
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.position)),
    db
      .select({ f: taskAttachments, short: uploader.shortName })
      .from(taskAttachments)
      .leftJoin(uploader, eq(uploader.id, taskAttachments.uploadedByPersonId))
      .where(eq(taskAttachments.taskId, id))
      .orderBy(asc(taskAttachments.position)),
    db
      .select({ e: timeEntries, full: entryPerson.fullName, short: entryPerson.shortName, rateRoleId: entryPerson.rateRoleId })
      .from(timeEntries)
      .leftJoin(entryPerson, eq(entryPerson.id, timeEntries.personId))
      .where(eq(timeEntries.taskId, id))
      .orderBy(asc(timeEntries.position)),
    db.select({ rateRoleId: persons.rateRoleId }).from(tasks).innerJoin(persons, eq(persons.id, tasks.assigneePersonId)).where(eq(tasks.id, id)),
    getRateGrid(),
    businessToday(),
  ]);
  // R-083 (A-10): one valuation of hours — the grid role's rate in force on the date worked (no job-title rate, no 100 €/h);
  // the remaining hours at today's rate (the business date, R-013).
  const todayRate = rateAt(grid, assignee?.rateRoleId ?? null, today);
  const valuation = taskLaborCost({
    loggedH: row.loggedH, restRateEur: todayRate,
    entries: entries.map(({ e, rateRoleId }) => ({ hours: e.hours, rateEur: rateAt(grid, rateRoleId, e.workDate) })),
  });
  return {
    ...row,
    checklistItems: items.map((i) => ({ position: i.position, text: i.text, done: i.done })),
    comments: comments.map(({ c, full, short, initials }) => ({
      author: full ?? short, authorShort: short, initials, postedAt: c.postedAt.toISOString(), when: relativeStampText(c.postedAt, today), text: c.text,
    })),
    attachments: files.map(({ f, short }) => ({
      id: f.id, hasFile: !!f.fileId,
      name: f.name, meta: [f.sizeText, short, relativeDayText(f.uploadedOn, today)].filter(Boolean).join(' · '), sizeText: f.sizeText, uploadedBy: short,
      uploadedOn: f.uploadedOn, kind: f.kind, icon: ATTACHMENT_ICON[f.kind],
    })),
    entries: entries.map(({ e, full, short }) => ({
      date: e.workDate, dateText: dayLabelOfIso(e.workDate), hours: e.hours, note: e.note, person: short ? (full ?? short) : null, source: e.source,
    })),
    costNote: { ...valuation, todayRate },
  };
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

async function loadTask(tx: Tx, number: string) {
  const [t] = await tx.select().from(tasks).where(eq(tasks.number, number));
  if (!t) throw new Error(`Unknown task ${number}`);
  return t;
}

async function auditTask(tx: Tx, t: typeof tasks.$inferSelect, actorName: string, change: string) {
  const actor = await findPerson(tx, actorName);
  await writeAudit(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef: t.number, change, area: 'Tasks', entityType: 'task', entityId: t.id, projectId: t.projectId });
}

/** Status segment / "Mark done": done ⇒ 100 %; leaving done from 100 % ⇒ 75 % (10 §7.4, domain applyStatus). */
export async function setTaskStatus(number: string, status: TaskStatus, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadTask(tx, number);
    if (t.status === status) return;
    const next = applyStatus({ status: t.status, pct: t.percentComplete }, status);
    await tx.update(tasks).set({ status: next.status, percentComplete: next.pct, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    await auditTask(tx, t, actorName, `status: ${taskStatus.label(t.status)} → ${taskStatus.label(next.status)}`);
  });
}

/** List done toggle: done ↔ in progress (100 % ↔ 75 %). */
export async function toggleTaskDone(number: string, actorName: string): Promise<TaskStatus> {
  const db = await getDb();
  const [t] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.number, number));
  if (!t) throw new Error(`Unknown task ${number}`);
  const next: TaskStatus = t.status === 'done' ? 'doing' : 'done';
  await setTaskStatus(number, next, actorName);
  return next;
}

/**
 * % segment (0 / 25 / 50 / 75 / 100), domain applyProgress: 100 ⇒ done; > 0 on a to-do or done task ⇒ in progress;
 * 0 on a done task ⇒ to do (the prototype left it "Done" at 0 %, 10 OQ20). One transaction for both fields.
 */
export async function setTaskProgress(number: string, pct: number, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadTask(tx, number);
    const { status, pct: v } = applyProgress({ status: t.status, pct: t.percentComplete }, pct);
    await tx.update(tasks).set({ percentComplete: v, status, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    await auditTask(tx, t, actorName, `progress: ${t.percentComplete} % → ${v} %` + (status !== t.status ? ` · status: ${taskStatus.label(t.status)} → ${taskStatus.label(status)}` : ''));
  });
}

/**
 * Ticks / unticks a checklist item (by position). Tasks without items have only the stored counts: nothing to
 * toggle. Returns the new state. `actorName` (the viewer) is recorded in the audit trail.
 */
export async function toggleChecklistItem(number: string, position: number, actorName?: string, opts: { done?: boolean } = {}): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const t = await loadTask(tx, number);
    const [item] = await tx.select().from(taskChecklistItems).where(and(eq(taskChecklistItems.taskId, t.id), eq(taskChecklistItems.position, position)));
    if (!item) throw new Error(`Task ${number} has no checklist item #${position}`);
    // R-010: `done` = the state the viewer asked for (two ticks at once leave it ticked); without it the item flips.
    const done = opts.done ?? !item.done;
    if (done === item.done) return done;
    await tx.update(taskChecklistItems).set({ done, doneAt: done ? new Date() : null }).where(eq(taskChecklistItems.id, item.id));
    if (actorName) await auditTask(tx, t, actorName, `checklist: ${done ? 'ticked' : 'unticked'} "${item.text}"`);
    return done;
  });
}

/** "Add an item…" (not wired in the prototype). The first item replaces the stored counts. */
export async function addChecklistItem(number: string, text: string, actorName?: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const t = await loadTask(tx, number);
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${taskChecklistItems.position}), -1)::int` }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, t.id));
    await tx.insert(taskChecklistItems).values({ taskId: t.id, position: pos + 1, text: text.trim(), done: false });
    if (actorName) await auditTask(tx, t, actorName, `checklist: added "${text.trim()}"`);
  });
}

/** A posted comment: who it mentions (R-149) — told by the Server Function once the comment is committed. */
export interface PostedComment {
  /** "T-2314" and its project. */
  task: string;
  projectCode: string;
  /** Display name of the author. */
  author: string;
  /** Persons mentioned with an active internal account, the author excluded (person ids, order of first mention). */
  mentioned: string[];
}

/**
 * "Post": a comment by the viewer (not the prototype's fixed Marie Lefebvre). Empty text is ignored (null). R-149: the
 * @mentions are resolved among the mentionable people (src/domain/mentions.ts; the author never mentions themself) in the same
 * transaction, which records one audit line naming them; the caller notifies them after the commit.
 */
export async function addTaskComment(number: string, authorName: string, text: string): Promise<PostedComment | null> {
  const body = text.trim();
  if (!body) return null;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const t = await loadTask(tx, number);
    const author = await requirePerson(tx, authorName);
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${taskComments.position}), -1)::int` }).from(taskComments).where(eq(taskComments.taskId, t.id));
    await tx.insert(taskComments).values({ taskId: t.id, authorPersonId: author.id, postedAt: new Date(), text: body, position: pos + 1 });
    await auditTask(tx, t, nameOf(author), 'comment posted');
    const people = await listMentionablePersons(tx);
    const mentioned = mentionedKeys(body, people).filter((id) => id !== author.id);
    if (mentioned.length) {
      const names = mentioned.map((id) => people.find((p) => p.key === id)!).map((p) => p.fullName ?? p.shortName);
      await auditTask(tx, t, nameOf(author), `mentioned: ${names.join(', ')}`);
    }
    const [p] = await tx.select({ code: projects.code }).from(projects).where(eq(projects.id, t.projectId));
    return { task: t.number, projectCode: p.code, author: nameOf(author), mentioned };
  });
}

export interface LogTimeInput {
  hours: number;
  /** Default "Work on {title}". */
  note?: string;
  /** Who worked (default the assignee). */
  person?: string;
  /** Business date worked (default the business date, R-013 — Fri 25 Sep 2026 on the demo data set). */
  workDate?: string;
  /** Who recorded it (the viewer), for the audit trail; the entry itself belongs to `person` / the assignee. */
  actorName?: string;
}

/** "Log": appends a time entry and adds the hours to the task's logged total. Zero / NaN hours are ignored. */
export async function logTaskTime(number: string, input: LogTimeInput): Promise<void> {
  if (!input.hours || !Number.isFinite(input.hours)) return;
  const db = await getDb();
  const workDate = input.workDate ?? (await businessToday());
  await db.transaction(async (tx) => {
    const t = await loadTask(tx, number);
    const person = input.person ? await requirePerson(tx, input.person) : null;
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${timeEntries.position}), -1)::int` }).from(timeEntries).where(eq(timeEntries.taskId, t.id));
    await tx.insert(timeEntries).values({
      taskId: t.id, personId: person?.id ?? t.assigneePersonId, workDate, hours: input.hours,
      note: input.note?.trim() || 'Work on ' + t.title, source: 'keystone', position: pos + 1,
    });
    await tx.update(tasks).set({ loggedH: sql`${tasks.loggedH} + ${input.hours}`, updatedAt: new Date() }).where(eq(tasks.id, t.id));
    if (input.actorName) await auditTask(tx, t, input.actorName, `time logged: ${input.hours} h`);
  });
}

export interface AttachmentInput {
  name: string;
  sizeText: string;
  uploadedBy: string;
  kind: AttachmentKind;
  storageRef?: string;
  uploadedOn?: string;
}

/** "Attach" (not wired in the prototype): registers a file on the task. */
export async function addTaskAttachment(number: string, input: AttachmentInput): Promise<void> {
  const db = await getDb();
  const uploadedOn = input.uploadedOn ?? (await businessToday());
  await db.transaction(async (tx) => {
    const t = await loadTask(tx, number);
    const by = await findPerson(tx, input.uploadedBy);
    const [{ pos }] = await tx.select({ pos: sql<number>`coalesce(max(${taskAttachments.position}), -1)::int` }).from(taskAttachments).where(eq(taskAttachments.taskId, t.id));
    await tx.insert(taskAttachments).values({
      taskId: t.id, name: input.name, sizeText: input.sizeText, uploadedByPersonId: by?.id ?? null, uploadedOn,
      kind: input.kind, storageRef: input.storageRef ?? null, position: pos + 1,
    });
  });
}
