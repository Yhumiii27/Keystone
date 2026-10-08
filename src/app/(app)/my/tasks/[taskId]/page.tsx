// Task detail — /my/tasks/[taskId] (docs/spec/10 §7, template 2902–2969, logic 4085–4107).
// Title = task title, breadcrumb "My work · T-2314", primary "Mark done". Status, %, checklist and time log are
// editable by the assignee and the portfolio director; comments by anyone whose workspace includes My work (author =
// the viewer). Outside the workspace the sheet is read-only under the shell's banner. Unknown task → 404.
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/shell/page-header';
import { myWorkHref, taskSheetData } from '@/features/mywork/model';
import { canCommentTask, canEditTask, canPickPerson } from '@/features/mywork/permissions';
import { MarkDoneButton, TaskBody, TaskProvider } from '@/features/mywork/task-sheet';
import { getTask } from '@/server/dal/tasks';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

const TASK_RE = /^T-\d{1,6}$/;

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, { t, lang }, access] = await Promise.all([params, getI18n(), getScreenAccess('task')]);
  const id = decodeURIComponent(taskId).toUpperCase();
  const task = TASK_RE.test(id) ? await getTask(id) : null;
  if (!task) notFound();
  const { viewer, outside } = access;

  // Back to the assignee's work (the prototype's openTask set `person` to the assignee) when the viewer may look at it.
  const otherPerson = task.assigneeShort != null && task.assignee !== viewer.name && canPickPerson(viewer.role) ? task.assignee : null;
  const data = taskSheetData(task, myWorkHref({ person: otherPerson }), t, lang);
  const canEdit = canEditTask(viewer, task.assignee, outside);

  return (
    <TaskProvider data={data} canEdit={canEdit} canComment={canCommentTask(outside)} viewer={{ name: viewer.name, initials: viewer.initials }}>
      <PageHeader screen="task" taskId={task.id} title={data.title} crumbExtra={task.id} primary={canEdit ? <MarkDoneButton /> : undefined} />
      <TaskBody />
    </TaskProvider>
  );
}
