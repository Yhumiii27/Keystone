import 'server-only';
// Access to a task's stored files (chapter 4, R-8) for the Route Handlers (upload, download) and the remove Server Function:
// the task, the viewer and whether they may act. Rules: src/features/mywork/permissions.ts.
import { getProject } from '@/server/dal/projects';
import { listTasks, type TaskRow } from '@/server/dal/tasks';
import { getScreenAccess, isMineProject } from '@/server/project-context';
import type { Viewer } from '@/server/session';
import { canAttachTaskFiles, canDownloadTaskFiles } from './permissions';

const TASK_RE = /^T-\d{1,6}$/;

export type TaskFileGate =
  | { ok: true; task: TaskRow; viewer: Viewer }
  /** `error`: EN source message. */
  | { ok: false; status: 403 | 404; error: string };

/** `view` = download; `edit` = attach / remove. */
export async function taskFileGate(taskId: unknown, need: 'view' | 'edit'): Promise<TaskFileGate> {
  const id = typeof taskId === 'string' ? decodeURIComponent(taskId).toUpperCase() : '';
  if (!TASK_RE.test(id)) return { ok: false, status: 404, error: 'Unknown task' };
  const { viewer, outside } = await getScreenAccess('task');
  const [task] = await listTasks({ number: id });
  if (!task) return { ok: false, status: 404, error: 'Unknown task' };
  if (need === 'edit') {
    if (outside) return { ok: false, status: 403, error: 'Read-only — outside my workspace' };
    if (!canAttachTaskFiles(viewer, task.assignee, outside)) return { ok: false, status: 403, error: 'Read-only — only the assignee or the portfolio director can update this task' };
    return { ok: true, task, viewer };
  }
  const project = viewer.role === 'client' ? await getProject(task.project.code) : null;
  if (!canDownloadTaskFiles(viewer, !!project && isMineProject(viewer, project))) return { ok: false, status: 403, error: 'You cannot open this file' };
  return { ok: true, task, viewer };
}
