'use server';
// Server Functions of Lessons learned & closure (docs/spec/07 §2.7, AF `rex`). Each one validates the raw input, resolves
// the project and checks the viewer server-side (viewers who may edit the screen on this project — workspace: director, PM,
// engineering lead, quality; not on a read-only project), writes through the data-layer writers with the viewer as the actor,
// then revalidates. The client portal's Server Functions (client decisions, "Raise issue", "Acknowledge receipt", "Download
// status report") were removed with the portal (D9-06, D9-22: clients never see Keystone).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { LESSON_RESULT, parseNewLesson } from '@/domain/rexclient';
import { closureItemStatus, lessonStatus, type ClosureItemStatus, type LessonStatus } from '@/server/db/codes';
import { getProject } from '@/server/dal/projects';
import { REX_MOVED_ON, addLesson, advanceLesson, cycleClosureItem, getRex } from '@/server/dal/rex';
import { getProjectContext, type ProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { toastText } from './i18n';

export type RexClientResult = { ok: true } | { error: string };

const LL_RE = /^LL-\d{2,}$/;

async function tr(english: string) {
  const { t } = await getI18n();
  return toastText(english, t);
}

/** Resolves the project of the request and the viewer's context on `screen`. */
async function access(code: unknown, screen: 'rex'): Promise<{ ctx: ProjectContext } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const p = await getProject(code);
  if (!p) return { error: await tr('Unknown project') };
  return { ctx: await getProjectContext(p.code, screen) };
}

const actorOf = (ctx: ProjectContext) => ({ name: ctx.viewer.name, role: ctx.viewer.role });

// ── Lessons learned & closure ──────────────────────────────────────────────────────────────────────────

async function rexEditable(code: unknown): Promise<{ ctx: ProjectContext } | { error: string }> {
  const a = await access(code, 'rex');
  if ('error' in a) return a;
  if (!a.ctx.canEdit('rex')) return { error: await tr('Lessons learned & closure is read-only for you') };
  return a;
}

const refreshRex = (code: string) => revalidatePath(`/projects/${code}/closure`);

/** "Add lesson learned" (AF.rex): a Proposed lesson LL-10, LL-11…; toast "Lesson recorded · to be validated". */
export async function addLessonAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const a = await rexEditable(code);
  if ('error' in a) return a;
  const parsed = parseNewLesson(values);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const code0 = a.ctx.project.code;
  try {
    await addLesson(code0, parsed.value, actorOf(a.ctx));
  } catch {
    return { error: await tr('The lesson could not be recorded') };
  }
  refreshRex(code0);
  return { toast: await tr(LESSON_RESULT) };
}

/** "Validate" (Proposed → Validated) / "Mark applied" (Validated → Applied); `from` is the status the viewer saw. */
export async function advanceLessonAction(code: string, number: string, from: LessonStatus): Promise<RexClientResult> {
  const a = await rexEditable(code);
  if ('error' in a) return a;
  if (typeof number !== 'string' || !LL_RE.test(number) || !lessonStatus.isCode(from)) return { error: await tr('Invalid request') };
  const code0 = a.ctx.project.code;
  const lesson = (await getRex(code0)).lessons.find((l) => l.number === number);
  if (!lesson) return { error: await tr('Unknown lesson') };
  if (lesson.status !== from || !lesson.next) return { error: await tr('This lesson has already moved on') };
  try {
    // R-010: `from` re-checked in the writer's transaction (two clicks at once: one step).
    await advanceLesson(code0, number, actorOf(a.ctx), { expected: from });
  } catch (e) {
    if (e instanceof Error && e.message.endsWith(REX_MOVED_ON)) {
      refreshRex(code0);
      return { error: await tr('This lesson has already moved on') };
    }
    return { error: await tr('The change could not be saved') };
  }
  refreshRex(code0);
  return { ok: true };
}

/** Closure checklist click: Not started → In progress → Done → Not started; `from` is the status the viewer saw. */
export async function cycleClosureAction(code: string, position: number, from: ClosureItemStatus): Promise<RexClientResult> {
  const a = await rexEditable(code);
  if ('error' in a) return a;
  if (!Number.isInteger(position) || position < 0 || !closureItemStatus.isCode(from)) return { error: await tr('Invalid request') };
  const code0 = a.ctx.project.code;
  const item = (await getRex(code0)).closure.find((c) => c.position === position);
  if (!item) return { error: await tr('Unknown checklist item') };
  if (item.status !== from) return { error: await tr('This checklist item has already changed') };
  try {
    await cycleClosureItem(code0, position, actorOf(a.ctx), { expected: from });
  } catch (e) {
    if (e instanceof Error && e.message.endsWith(REX_MOVED_ON)) {
      refreshRex(code0);
      return { error: await tr('This checklist item has already changed') };
    }
    return { error: await tr('The change could not be saved') };
  }
  refreshRex(code0);
  return { ok: true };
}
