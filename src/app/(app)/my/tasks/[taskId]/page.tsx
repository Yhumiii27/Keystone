// Task detail — /my/tasks/[taskId] (docs/spec/10 §7, template 2902–2969, logic 4085–4107).
// Title = task title, breadcrumb "My work · T-2314", primary "Mark done". Status, %, checklist and time log are
// editable by the assignee and the portfolio director; comments by anyone whose workspace includes My work (author =
// the viewer). Outside the workspace the sheet is read-only under the shell's banner. Unknown task → 404.
import { notFound } from 'next/navigation';
import { canSeeRates } from '@/domain/hr';
import { PageHeader } from '@/components/app/shell/page-header';
import { myWorkHref, taskSheetData } from '@/features/mywork/model';
import { canCommentTask, canEditTask, canNameSourcedPerson } from '@/features/mywork/permissions';
import { MarkDoneButton, TaskBody, TaskProvider } from '@/features/mywork/task-sheet';
import { myWorkAccess } from '@/server/dal/mywork-data';
import { listSourcingCandidates } from '@/server/dal/requests';
import { listMentionablePersons } from '@/server/dal/task-notices';
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

  // Back to the assignee's work (the prototype's openTask set `person` to the assignee) when the viewer may look at it (R-049).
  const otherPerson = task.assigneeShort != null && task.assignee !== viewer.name && (await myWorkAccess(viewer)).canView(task.assignee) ? task.assignee : null;
  // R-149: the comments' @mentions are highlighted (the people who can be mentioned: an active internal account).
  const data = taskSheetData(task, myWorkHref({ person: otherPerson }), t, lang, { rates: canSeeRates(viewer.role), mentionables: await listMentionablePersons() });
  const canEdit = canEditTask(viewer, task.assignee, outside);
  // P-8b (R-089): procurement and the director name the person of a sourcing task (existing people only).
  const naming = data.sourcing && canNameSourcedPerson(viewer, outside) ? { candidates: (await listSourcingCandidates()).map((c) => c.name) } : null;

  return (
    <TaskProvider data={data} canEdit={canEdit} canComment={canCommentTask(outside)} naming={naming} viewer={{ name: viewer.name, initials: viewer.initials }}>
      <PageHeader screen="task" taskId={task.id} title={data.title} crumbExtra={task.id} primary={canEdit ? <MarkDoneButton /> : undefined} />
      <TaskBody />
    </TaskProvider>
  );
}
