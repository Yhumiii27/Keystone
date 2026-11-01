'use server';
// My work / Task Server Functions (docs/spec/10 §6.5, §7.5): status and % (with their coupling), the list's done
// toggle, "Mark done", checklist ticks and items, comments by the viewer, time logging. Each one validates its
// input, checks the viewer (outside the workspace → refused; task edits → assignee or director; comments → anyone in
// the workspace), writes through the tasks DAL and revalidates every screen (tasks show on Home, the sidebar badge,
// Plan…). Chapter 4 (R-8): removing an attached file (attaching goes through the upload Route Handler
// src/app/api/tasks/[taskId]/files, which Server Functions' 1 MB body limit would not allow). R-201: the task's recurrence. Error messages are English
// source strings (the client shows them with toast.showEn).
import { revalidatePath } from 'next/cache';
import { mentionExcerpt } from '@/domain/mentions';
import { isTaskStatus, parseHours } from '@/domain/tasks';
import { parseRecurrence } from '@/domain/task-recurrence';
import { setTaskRecurrence } from '@/server/dal/task-recurrence';
import {
  addChecklistItem, addTaskComment, listTasks, logTaskTime, setTaskProgress, setTaskStatus, toggleChecklistItem, toggleTaskDone,
  type PostedComment, type TaskRow,
} from '@/server/dal/tasks';
import { listSourcingCandidates, nameSourcedPerson, SourcingStaleError, type NamedSourcing } from '@/server/dal/requests';
import { listTaskFiles, removeTaskFile } from '@/server/dal/task-files';
import { notifyPersonNamed, notifyTaskMentions } from '@/server/dal/task-notices';
import { getScreenAccess } from '@/server/project-context';
import type { Viewer } from '@/server/session';
import { canCommentTask, canEditTask, canNameSourcedPerson } from './permissions';
import { logError } from '@/server/log';

export type TaskActionResult = { ok: true } | { ok: false; error: string };

const OUTSIDE = 'Read-only — outside my workspace';
const NOT_YOURS = 'Read-only — only the assignee or the portfolio director can update this task';
const UNKNOWN = 'Unknown task';
const FAILED = 'The change could not be saved';
const TASK_RE = /^T-\d{1,6}$/;
const MAX_ITEM = 200;
const MAX_COMMENT = 2000;
const MAX_NOTE = 200;

const fail = (error: string): TaskActionResult => ({ ok: false, error });
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

type Gate = { ok: true; task: TaskRow; viewer: Viewer } | { ok: false; error: string };

/** Loads the task after checking the viewer: `edit` = status/%/checklist/time, `comment` = post a comment. */
async function gate(taskId: unknown, need: 'edit' | 'comment'): Promise<Gate> {
  if (typeof taskId !== 'string' || !TASK_RE.test(taskId)) return { ok: false, error: UNKNOWN };
  const { viewer, outside } = await getScreenAccess('task');
  if (outside) return { ok: false, error: OUTSIDE };
  const [task] = await listTasks({ number: taskId });
  if (!task) return { ok: false, error: UNKNOWN };
  if (need === 'edit' ? !canEditTask(viewer, task.assignee, outside) : !canCommentTask(outside)) return { ok: false, error: NOT_YOURS };
  return { ok: true, task, viewer };
}

async function write(label: string, fn: () => Promise<unknown>): Promise<TaskActionResult> {
  try {
    await fn();
  } catch (e) {
    logError(label, e);
    return fail(FAILED);
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Status segment (To do / In progress / In review / Done): done ⇒ 100 %, leaving done from 100 % ⇒ 75 %. */
export async function setTaskStatusAction(input: { taskId: string; status: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  if (!isTaskStatus(input.status)) return fail('Invalid status');
  const status = input.status;
  return write('setTaskStatusAction', () => setTaskStatus(g.task.id, status, g.viewer.name));
}

/** Header primary "Mark done" (setTask({status:'done', pct:100})). */
export async function markTaskDoneAction(input: { taskId: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  return write('markTaskDoneAction', () => setTaskStatus(g.task.id, 'done', g.viewer.name));
}

/** List done toggle: done ↔ in progress (100 % ↔ 75 %). */
export async function toggleTaskDoneAction(input: { taskId: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  return write('toggleTaskDoneAction', () => toggleTaskDone(g.task.id, g.viewer.name));
}

/**
 * % segment (0 / 25 / 50 / 75 / 100, any integer 0–100 accepted): 100 % ⇒ done; > 0 % on a to-do or done task ⇒ in
 * progress; 0 % on a done task ⇒ to do (domain applyProgress, applied by the DAL in one transaction).
 */
export async function setTaskProgressAction(input: { taskId: string; pct: number }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  const pct = input.pct;
  if (typeof pct !== 'number' || !Number.isInteger(pct) || pct < 0 || pct > 100) return fail('Invalid progress');
  return write('setTaskProgressAction', () => setTaskProgress(g.task.id, pct, g.viewer.name));
}

/** Ticks / unticks a checklist item (by position). */
export async function toggleChecklistItemAction(input: { taskId: string; position: number; done?: boolean }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  const position = input.position;
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) return fail('Unknown checklist item');
  const done = typeof input.done === 'boolean' ? { done: input.done } : {};
  return write('toggleChecklistItemAction', () => toggleChecklistItem(g.task.id, position, g.viewer.name, done));
}

/** "Add an item…" + Add (not wired in the prototype). */
export async function addChecklistItemAction(input: { taskId: string; text: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  const item = text(input.text, MAX_ITEM);
  if (!item) return fail('Enter an item');
  return write('addChecklistItemAction', () => addChecklistItem(g.task.id, item, g.viewer.name));
}

/**
 * "Post": a comment by the viewer (the prototype always wrote "Marie Lefebvre", 00 §7.16). R-149 (R-8b a): the people it
 * @mentions with an active internal account get a bell notification once the comment is committed ('@you in T-xxxx',
 * '“excerpt” · author', opening the task) — never the author; a notification failure never undoes the comment.
 */
export async function addTaskCommentAction(input: { taskId: string; text: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'comment');
  if (!g.ok) return g;
  const body = text(input.text, MAX_COMMENT);
  if (!body) return fail('Write a comment first');
  let posted: PostedComment | null;
  try {
    posted = await addTaskComment(g.task.id, g.viewer.name, body);
  } catch (e) {
    logError('addTaskCommentAction', e);
    return fail(FAILED);
  }
  // After the commit (never inside the comment's transaction); notifyTaskMentions logs its own failures.
  if (posted?.mentioned.length) await notifyTaskMentions({ number: posted.task, projectCode: posted.projectCode }, posted.mentioned, mentionExcerpt(body), posted.author);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** "Log": hours (> 0, ≤ 24) and an optional note (default "Work on {title}") on the business date (R-013), added to the logged total. */
export async function logTaskTimeAction(input: { taskId: string; hours: string | number; note?: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  const hours = parseHours(input.hours);
  if (hours == null) return fail('Enter hours between 0 and 24');
  const note = text(input.note, MAX_NOTE);
  return write('logTaskTimeAction', () => logTaskTime(g.task.id, { hours, note: note || undefined, actorName: g.viewer.name }));
}

const NAMERS = 'Only procurement or the portfolio director can name the person';
const NAMED_ALREADY = 'This task already names its person';
const UNKNOWN_PERSON = 'Choose a person known to Keystone';
const MAX_PERSON = 120;

/**
 * P-8b (R-089) "Name the person" on a sourcing task (created from a contract-role request, no person yet): procurement or the
 * director names an EXISTING person (the resource pool, or someone else Keystone knows — creating a person waits for the Cursus
 * directory, R-027). The same task goes to that person, the request names them; the PM and the person are told after the
 * commit. Stale (named meanwhile, not a sourcing task) → refused, the page refreshed.
 */
export async function nameSourcedPersonAction(input: { taskId: string; person: string }): Promise<TaskActionResult> {
  if (typeof input?.taskId !== 'string' || !TASK_RE.test(input.taskId)) return fail(UNKNOWN);
  const { viewer, outside } = await getScreenAccess('task');
  if (outside) return fail(OUTSIDE);
  if (!canNameSourcedPerson(viewer, outside)) return fail(NAMERS);
  const [task] = await listTasks({ number: input.taskId });
  if (!task) return fail(UNKNOWN);
  if (!task.sourceRequest || !task.contractRole) {
    revalidatePath('/', 'layout');
    return fail(NAMED_ALREADY);
  }
  const person = text(input.person, MAX_PERSON);
  if (!person || !(await listSourcingCandidates()).some((c) => c.name === person)) return fail(UNKNOWN_PERSON);
  let named: NamedSourcing;
  try {
    named = await nameSourcedPerson(task.id, person, viewer.name);
  } catch (e) {
    if (e instanceof SourcingStaleError) {
      revalidatePath('/', 'layout');
      return fail(e.message);
    }
    logError('nameSourcedPersonAction', e);
    return fail(FAILED);
  }
  await notifyPersonNamed(named, viewer.name);
  revalidatePath('/', 'layout');
  return { ok: true };
}

const ATTACHMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chapter 4 (R-8): removes an attachment of the task and the file Keystone stored for it (assignee or director; audited). */
export async function removeTaskFileAction(input: { taskId: string; attachmentId: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  const id = typeof input.attachmentId === 'string' ? input.attachmentId : '';
  if (!ATTACHMENT_RE.test(id) || !(await listTaskFiles(g.task.id)).some((f) => f.id === id)) {
    revalidatePath('/', 'layout');
    return fail('This file is no longer attached');
  }
  return write('removeTaskFileAction', () => removeTaskFile(g.task.id, id, g.viewer.name));
}

/**
 * R-201 (K-201): sets or stops the task's recurrence (weekly / monthly every n, at each project milestone; optional end date).
 * The same people as the task's other edits (the assignee or the director, inside the workspace); an open task only — the
 * series goes on from the occurrence created when the task is closed. `kind` '' stops it.
 */
export async function setTaskRecurrenceAction(input: { taskId: string; kind: string; interval?: number | string; until?: string }): Promise<TaskActionResult> {
  const g = await gate(input?.taskId, 'edit');
  if (!g.ok) return g;
  if (typeof input.kind !== 'string' || (input.until != null && typeof input.until !== 'string')) return fail('Invalid request');
  if (g.task.status === 'done') return fail('Set the recurrence on an open task — the next occurrence carries it on');
  const parsed = parseRecurrence({ kind: input.kind, interval: input.interval, until: input.until }, { due: g.task.due });
  if (!parsed.ok) return fail(parsed.error);
  const rule = parsed.value;
  return write('setTaskRecurrenceAction', () => setTaskRecurrence(g.task.id, rule, g.viewer.name));
}
