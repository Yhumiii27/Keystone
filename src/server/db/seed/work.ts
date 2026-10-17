// Work seed: tasks (TODOS + DESC, CHECKS, COMMENTS, FILES, ENTRIES) and resource requests (REQUESTS, with a
// decision trail parsed from `sent` and `response`). See schema/work.ts.
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { eq } from 'drizzle-orm';
import { PROTO } from '@/server/prototype';
import { addDaysIso, isoOfDayOffset, isoOfDemoDate, parseStampText, type AttachmentKind, type Priority, type RequestEventAction, type RequestStatus, type TaskStatus } from '../codes';
import {
  requestActivityChoices, resourceRequestEvents, resourceRequests, taskAttachments, taskChecklistItems, taskComments, tasks, timeEntries,
} from '../schema';
import type { Tx } from '../types';
import { must, newId, personId, projectCodeOfShort, type SeedCtx } from './context';

interface ProtoTodo {
  id: string; person: string; title: string; project: string; act: string; status: TaskStatus; prio: Priority; start: number; due: number;
  est: number; logged: number; cl: [number, number]; labels: string[]; pct: number;
}
interface ProtoRequest {
  id: string; pm: string; project: string; person: string; dept: string; title: string; act: string; hours: number; start: number; due: number;
  prio: Priority; status: RequestStatus; sent: string; note: string; response: string; propStart: number | null; propDue: number | null; todoId: string | null;
}

/** "Thu 24 Sep" → '2026-09-24'. */
function isoOfDayLabel(s: string): string {
  const iso = isoOfDemoDate(s.replace(/^\w{3}\s+/, ''));
  if (!iso) throw new Error(`Seed: unparseable day "${s}"`);
  return iso;
}

/** "Approved · Ines Duarte · Thu 24 Sep — note" → decision event (null while pending). */
export function parseRequestResponse(response: string): { action: RequestEventAction; by: string; onDate: string; note: string | null } | null {
  const m = /^(Approved|Reschedule proposed|Rejected) · (.+?) · (\w{3} \d{1,2} \w{3})(?: — (.*))?$/.exec(response.trim());
  if (!m) return null;
  const action: RequestEventAction = m[1] === 'Approved' ? 'approved' : m[1] === 'Rejected' ? 'rejected' : 'reschedule';
  return { action, by: m[2], onDate: isoOfDayLabel(m[3]), note: m[4] ?? null };
}

const ATTACHMENT_KIND: Record<string, AttachmentKind> = { 'ph ph-file-xls': 'xls', 'ph ph-image': 'image', 'ph ph-file-pdf': 'pdf' };

export async function seedWork(tx: Tx, ctx: SeedCtx): Promise<void> {
  const projectOf = (short: string) => {
    const code = projectCodeOfShort(ctx, short);
    return { code, id: must(ctx.projectByCode, code, 'project'), acts: must(ctx.activity, code, 'project activities') };
  };

  // Tasks.
  const todos = PROTO.TODOS as ProtoTodo[];
  const desc = PROTO.DESC as Record<string, string>;
  await tx.insert(tasks).values(
    todos.map((t, i) => {
      const p = projectOf(t.project);
      const id = newId();
      ctx.task.set(t.id, id);
      return {
        id, number: t.id, assigneePersonId: personId(ctx, t.person), title: t.title, description: desc[t.id] ?? null, projectId: p.id,
        activityId: must(p.acts, t.act, `activity of ${t.id}`), status: t.status, priority: t.prio,
        startDate: isoOfDayOffset(t.start), dueDate: isoOfDayOffset(t.due), estimateH: t.est, loggedH: t.logged, percentComplete: t.pct,
        labels: t.labels, checklistDone: t.cl[0], checklistTotal: t.cl[1], sortOrder: i + 1,
      };
    }),
  );
  const taskId = (n: string) => must(ctx.task, n, 'task');

  await tx.insert(taskChecklistItems).values(
    Object.entries(PROTO.CHECKS as Record<string, [string, number][]>).flatMap(([n, items]) =>
      items.map(([text, done], position) => ({ id: newId(), taskId: taskId(n), position, text, done: !!done })),
    ),
  );
  await tx.insert(taskComments).values(
    Object.entries(PROTO.COMMENTS as Record<string, [string, string, string][]>).flatMap(([n, rows]) =>
      rows.map(([author, when, text], position) => ({
        id: newId(), taskId: taskId(n), authorPersonId: personId(ctx, author), postedAt: parseStampText(when, DEMO_TODAY_ISO), text, position,
      })),
    ),
  );
  await tx.insert(taskAttachments).values(
    Object.entries(PROTO.FILES as Record<string, [string, string, string][]>).flatMap(([n, rows]) =>
      rows.map(([name, meta, icon], position) => {
        const [sizeText, by, rel] = meta.split(' · ');
        const uploadedOn = rel === 'today' ? '2026-09-25' : rel === 'yesterday' ? addDaysIso('2026-09-25', -1) : isoOfDemoDate(rel)!;
        return {
          id: newId(), taskId: taskId(n), name, sizeText, uploadedByPersonId: personId(ctx, by), uploadedOn,
          kind: ATTACHMENT_KIND[icon] ?? 'other', position,
        };
      }),
    ),
  );
  const assignee = new Map(todos.map((t) => [t.id, personId(ctx, t.person)]));
  await tx.insert(timeEntries).values(
    Object.entries(PROTO.ENTRIES as Record<string, [string, number, string][]>).flatMap(([n, rows]) =>
      rows.map(([day, hours, note], position) => ({
        id: newId(), taskId: taskId(n), personId: assignee.get(n) ?? null, workDate: isoOfDayLabel(day), hours, note, source: 'keystone' as const, position,
      })),
    ),
  );

  // Resource requests (+ link the tasks they created).
  const requests = PROTO.REQUESTS as ProtoRequest[];
  const reqRows = requests.map((r, i) => {
    const p = projectOf(r.project);
    const isPerson = ctx.personByFull.has(r.person) || ctx.personByShort.has(r.person);
    return {
      id: newId(), number: r.id, projectId: p.id, requestedByPersonId: personId(ctx, r.pm), personId: isPerson ? personId(ctx, r.person) : null,
      contractRole: isPerson ? null : r.person, departmentId: must(ctx.departmentByName, r.dept, 'department'), title: r.title,
      activityId: must(p.acts, r.act, `activity of ${r.id}`), hours: r.hours, startDate: isoOfDayOffset(r.start), dueDate: isoOfDayOffset(r.due),
      priority: r.prio, status: r.status, sentOn: isoOfDayLabel(r.sent), note: r.note, response: r.response,
      proposedStart: r.propStart == null ? null : isoOfDayOffset(r.propStart), proposedDue: r.propDue == null ? null : isoOfDayOffset(r.propDue),
      taskId: r.todoId ? taskId(r.todoId) : null, sortOrder: i + 1,
    };
  });
  await tx.insert(resourceRequests).values(reqRows);
  for (const r of reqRows) if (r.taskId) await tx.update(tasks).set({ sourceRequestId: r.id }).where(eq(tasks.id, r.taskId));
  await tx.insert(resourceRequestEvents).values(
    requests.flatMap((r, i) => {
      const requestId = reqRows[i].id;
      const events: (typeof resourceRequestEvents.$inferInsert)[] = [
        { id: newId(), requestId, action: 'sent', onDate: reqRows[i].sentOn, byPersonId: reqRows[i].requestedByPersonId, note: r.note || null, position: 0 },
      ];
      const d = parseRequestResponse(r.response);
      if (r.response && !d) throw new Error(`Seed: unparseable response of ${r.id}`);
      if (d) events.push({ id: newId(), requestId, action: d.action, onDate: d.onDate, byPersonId: personId(ctx, d.by), note: d.note, position: 1 });
      return events;
    }),
  );

  // Activities offered by the New resource request dialog (NR_ACTS, Harbor Line).
  const hlt = projectOf('HLT');
  await tx.insert(requestActivityChoices).values(
    (PROTO.NR_ACTS as string[]).map((code, position) => ({ projectId: hlt.id, activityId: must(hlt.acts, code, 'NR_ACTS activity'), position })),
  );
}
