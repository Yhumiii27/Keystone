// View data of My work and Task detail, built on the server from the tasks DAL rows (docs/spec/10 §6.4, §7.4).
// Everything here is serialisable and already translated where the text does not depend on the task's live
// status; the client islands derive the rest (groups, due texts, KPIs, couplings) with src/domain/tasks.ts so that
// optimistic updates re-render consistently.
import { screenHref } from '@/config/screens';
import { MAX_ATTACHMENTS_PER_TASK, MAX_FILE_BYTES, MAX_FILE_TEXT, acceptOf } from '@/domain/ch4-defaults';
import { withActual } from '@/domain/schedule';
import { workingDayOf, type TaskPriority, type TaskStatus } from '@/domain/tasks';
import type { Lang, T } from '@/i18n/translate';
import type { AttachmentKind } from '@/server/db/codes';
import type { TaskCostNote, TaskDetail, TaskRow } from '@/server/dal/tasks';
import { defaultDescription, freshTagText } from './i18n';
import { dataText } from '@/i18n/data-text';

/** URL of My work for a person (`?person=` only when it is not the viewer), keeping a view. */
export function myWorkHref(opts: { person?: string | null; view?: string | null; week?: number | null } = {}): string {
  const q = new URLSearchParams();
  if (opts.person) q.set('person', opts.person);
  if (opts.view && opts.view !== 'list') q.set('view', opts.view);
  if (opts.week) q.set('week', String(opts.week));
  const s = q.toString();
  return screenHref('mywork') + (s ? '?' + s : '');
}

export const taskHref = (id: string) => screenHref('task', { taskId: id });

/** Chapter 4 (R-8): download URL of a task attachment stored by Keystone (Route Handler src/app/api/tasks/…). */
export const taskFileHref = (taskId: string, attachmentId: string) => `/api/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(attachmentId)}`;

/** Chapter 4 (R-8): upload URL of the task's files (POST multipart, field `file`). */
export const taskFilesUploadHref = (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}/files`;

/** Plan screen with the task's activity selected and its work package expanded (`openPlan`, 4092). */
export const activityPlanHref = (projectCode: string, activityCode: string) =>
  `${screenHref('plan', { code: projectCode })}?act=${encodeURIComponent(activityCode)}`;

/** Project name shown on tasks (`PROJ_NAMES`): the short name ("Harbor Line"), else the full name. EN source. */
export const projectShortOf = (p: TaskRow['project']) => p.shortName ?? p.name;

export interface WorkItemData {
  id: string;
  href: string;
  /** Translated title. */
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Working-day offsets (TODAY = 4). */
  start: number;
  due: number;
  estimateH: number;
  loggedH: number;
  pct: number;
  /** Translated project short name. */
  project: string;
  /** Activity code ("A1250"), '' when none. */
  activity: string;
  /** Translated labels ("Engineering" → FR "Ingénierie", as the prototype's FR rows). */
  labels: string[];
  /** Translated "New · approved by …" tag, null when the task is not fresh. */
  fresh: string | null;
  checklist: { done: number; total: number };
}

export function workItemData(r: TaskRow, t: T, lang: Lang): WorkItemData {
  return {
    id: r.id,
    href: taskHref(r.id),
    title: dataText(r.title, lang),
    status: r.status,
    priority: r.priority,
    start: r.startDay ?? workingDayOf(r.start, 'up'),
    due: r.dueDay ?? workingDayOf(r.due, 'down'),
    estimateH: r.estimateH,
    loggedH: r.loggedH,
    pct: r.pct,
    project: t(projectShortOf(r.project)),
    activity: r.activity?.code ?? '',
    labels: r.labels.map((l) => t(l)),
    fresh: r.isFresh ? freshTagText(r.department ?? 'Engineering', t, lang) : null,
    checklist: r.checklist,
  };
}

/** Person chip sub-line projects: distinct project short names of the person's tasks (translated), list order. */
export const personProjects = (rows: TaskRow[], t: T) => [...new Set(rows.map((r) => projectShortOf(r.project)))].map(t);

export interface TaskSheetData {
  id: string;
  /** Translated title. */
  title: string;
  status: TaskStatus;
  pct: number;
  priority: TaskPriority;
  assignee: string;
  /** Working-day offset of the due date. */
  due: number;
  estimateH: number;
  loggedH: number;
  /** Translated labels. */
  labels: string[];
  /** Translated project short name. */
  project: string;
  /** Time entry note when the Log form's note is empty: "Work on {title}" (EN source title, as stored). */
  defaultLogNote: string;
  /** Header activity link ("A1250 · Steel erection — Bays 3–4" → Plan), null without an activity. */
  activity: { label: string; href: string } | null;
  backHref: string;
  /** Description (own text, else the generated sentence, translated). */
  description: string;
  checklist: { position: number; text: string; done: boolean }[];
  /** Stored counts shown when the task has no checklist items. */
  storedChecklist: { done: number; total: number };
  /** Attachments; `href` = download link when Keystone stores the content (null for the seed's files, which have none). */
  files: { id: string; name: string; meta: string; kind: AttachmentKind; href: string | null }[];
  /** Upload rules of "Attach" (chapter 4 defaults): file input `accept`, size limit (bytes and text), files per task. */
  fileRules: { accept: string; maxBytes: number; maxText: string; maxFiles: number; uploadHref: string };
  comments: { author: string; initials: string; when: string; text: string }[];
  entries: { date: string; hours: number; note: string }[];
  /**
   * Cost note valuation (R-083, A-10: each entry at its person's rate on its date); null when the viewer may not see rates
   * (R-046, NEW-D2-1).
   */
  costNote: TaskCostNote | null;
  /** Cost note target: work package of the activity, else the project (EN source). */
  costTarget: { wbs: string; packageName: string | null } | null;
  projectName: string;
  /** "Where this sits in the plan" (translated values; float as days, signed later). */
  plan: { activity: string; workPackage: string; finish: string; float: number | null; progress: number } | null;
}

export function taskSheetData(d: TaskDetail, backHref: string, t: T, lang: Lang, opts: { rates?: boolean } = {}): TaskSheetData {
  const a = d.activity;
  return {
    id: d.id,
    title: dataText(d.title, lang),
    status: d.status,
    pct: d.pct,
    priority: d.priority,
    assignee: d.assignee,
    due: d.dueDay ?? workingDayOf(d.due, 'down'),
    estimateH: d.estimateH,
    loggedH: d.loggedH,
    labels: d.labels.map((l) => t(l)),
    project: t(projectShortOf(d.project)),
    defaultLogNote: 'Work on ' + d.title,
    activity: a ? { label: `${a.code} · ${dataText(a.name, lang)}`, href: activityPlanHref(d.project.code, a.code) } : null,
    backHref,
    description: d.description ?? defaultDescription(a?.code ?? '—', a ? { code: a.code, name: a.name, wbs: a.wbs, packageName: a.packageName } : null, t, lang),
    checklist: d.checklistItems.map((c) => ({ position: c.position, text: c.text, done: c.done })),
    storedChecklist: d.checklist,
    files: d.attachments.map((f) => ({ id: f.id, name: f.name, meta: t(f.meta), kind: f.kind, href: f.hasFile ? taskFileHref(d.id, f.id) : null })),
    fileRules: { accept: acceptOf('attachment'), maxBytes: MAX_FILE_BYTES, maxText: MAX_FILE_TEXT, maxFiles: MAX_ATTACHMENTS_PER_TASK, uploadHref: taskFilesUploadHref(d.id) },
    comments: d.comments.map((c) => ({ author: c.author, initials: c.initials, when: t(c.when), text: c.text })),
    entries: d.entries.map((e) => ({ date: t(e.dateText), hours: e.hours, note: e.note })),
    // R-046: the rate never reaches the browser of a viewer who may not see it.
    costNote: opts.rates === false ? null : d.costNote,
    costTarget: a ? { wbs: a.wbs, packageName: a.packageName } : null,
    projectName: projectShortOf(d.project),
    plan: a
      ? {
          activity: `${a.code} · ${dataText(a.name, lang)}`,
          workPackage: `${a.wbs}${a.packageName ? ' ' + dataText(a.packageName, lang) : ''}`,
          finish: t(withActual(a.finish, a.finishActual)),
          float: a.totalFloat,
          progress: a.pct,
        }
      : null,
  };
}
