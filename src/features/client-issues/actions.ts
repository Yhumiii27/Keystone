'use server';
// Server Functions of the client issues handled by the project manager (R-137, L-6): "Take in charge", "Answer" and
// "Close" on the project's Stakeholders & RACI screen. Each one validates the raw input, checks the viewer server-side —
// the screen in their workspace and the project not read-only for them (`canEdit('stakeholders')`), the project's manager
// or the director (the data layer re-checks role and ownership), the status they saw (a stale row is refused) — writes
// through the client-portal DAL (audit, activity, the client's notification), then revalidates the project's pages
// (the client portal shows the answer and the status).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { CLIENT_ISSUE_HANDLER_ROLES, hasRealAnswer, issueSteps, parseIssueAnswer } from '@/domain/client-issues';
import { clientIssueStatus } from '@/server/db/codes';
import { handleClientIssue, listClientIssuesForTeam } from '@/server/dal/client';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export type IssueStepResult = { ok: true; toast: string } | { ok: false; error: string };

const NUMBER = /^CI-\d{2,}$/;
const READ_ONLY = 'Client issues are read-only for you';
const PM_ONLY = 'Only the project manager handles client issues';
const MOVED_ON = 'This issue has changed since you opened it';

async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

type Gate =
  | { error: string; staleCode?: string }
  | { code: string; actor: { name: string; role: string }; issue: Awaited<ReturnType<typeof listClientIssuesForTeam>>[number] };

/** The project, the viewer as actor and the issue, once every server-side check passed; else the English refusal. */
async function gate(code: unknown, number: unknown, from: unknown): Promise<Gate> {
  if (typeof code !== 'string' || !code || typeof number !== 'string' || !NUMBER.test(number) || !clientIssueStatus.isCode(from)) return { error: 'Invalid request' };
  const project = await getProject(code);
  if (!project) return { error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'stakeholders');
  if (!ctx.canEdit('stakeholders')) return { error: READ_ONLY };
  if (!CLIENT_ISSUE_HANDLER_ROLES.includes(ctx.viewer.role) || (ctx.viewer.role !== 'director' && !ctx.isMine)) return { error: PM_ONLY };
  const issue = (await listClientIssuesForTeam(project.code)).find((i) => i.number === number);
  if (!issue) return { error: 'Unknown issue' };
  if (issue.status !== from) return { error: MOVED_ON, staleCode: project.code };
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role }, issue };
}

const refresh = (code: string) => revalidatePath(`/projects/${code}`, 'layout');

const STEP_DONE = { take: 'Issue taken in charge', answer: 'Answer sent to the client', close: 'Issue closed · the client is notified' } as const;

async function run(code: string, number: string, from: string, step: 'take' | 'answer' | 'close', rawAnswer?: unknown): Promise<{ toast: string } | { error: string }> {
  const g = await gate(code, number, from);
  if ('error' in g) {
    if (g.staleCode) refresh(g.staleCode);
    return { error: await tr(g.error) };
  }
  if (!issueSteps(g.issue.status).includes(step)) return { error: await tr(MOVED_ON) };
  let answer: string | null = null;
  if (step !== 'take') {
    const parsed = parseIssueAnswer(rawAnswer, step === 'answer' || !hasRealAnswer(g.issue.response));
    if (!parsed.ok) return { error: await tr(parsed.error) };
    answer = parsed.value;
  }
  try {
    await handleClientIssue(g.code, g.issue.number, step === 'take' ? { step } : step === 'answer' ? { step, answer: answer! } : { step, answer }, g.actor, g.issue.status);
  } catch (e) {
    if (e instanceof Error && / has moved on$/.test(e.message)) {
      refresh(g.code);
      return { error: await tr(MOVED_ON) };
    }
    console.error('client issue step', e);
    return { error: await tr('The change could not be saved') };
  }
  refresh(g.code);
  return { toast: await tr(`${g.issue.number} · ${STEP_DONE[step]}`) };
}

/** "Take in charge" (Open → In progress): the issue is the project manager's. */
export async function takeClientIssueAction(code: string, number: string, from: string): Promise<IssueStepResult> {
  const r = await run(code, number, from, 'take');
  return 'error' in r ? { ok: false, error: r.error } : { ok: true, toast: r.toast };
}

/** "Answer" (form): the answer the client sees; an Open issue is taken in charge at the same time. */
export async function answerClientIssueAction(code: string, number: string, from: string, values: Record<string, string>): Promise<FormDialogResult> {
  return run(code, number, from, 'answer', values && typeof values === 'object' ? values.answer : undefined);
}

/** "Close" (form): closes the issue, with a final answer (required when none was given yet). */
export async function closeClientIssueAction(code: string, number: string, from: string, values: Record<string, string>): Promise<FormDialogResult> {
  return run(code, number, from, 'close', values && typeof values === 'object' ? values.answer : undefined);
}
