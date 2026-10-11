'use server';
// Plan — chapter 4 Server Functions (S-1, S-2, S-3, S-5): Reschedule, Set baseline, the Baseline and Calendar chips, the
// activity drawer's calendar override, relationships and to-dos. Each one re-checks the viewer's rights on the server
// (src/features/plan/rights.ts), validates the untrusted input, writes through the DAL (which audits) and revalidates.
import { revalidatePath } from 'next/cache';
import { canSnapshotFreely } from '@/domain/baseline-policy';
import { longDateText } from '@/domain/schedule-rollup';
import { addActivityTodo, listActivityTodos, removeActivityTodo, setActivityTodoDone } from '@/server/dal/activity-todos';
import { BaselinePolicyError, createBaselineSnapshot, listProjectBaselines } from '@/server/dal/baselines';
import { setActivityCalendar, setProjectCalendar } from '@/server/dal/calendars';
import { addActivityLink, getPlanData, getPlanSettings, removeActivityLink } from '@/server/dal/plan';
import { getProject } from '@/server/dal/projects';
import { rescheduleIfAutomatic, rescheduleProject, showProjectBaseline } from '@/server/dal/schedule';
import { isLinkType, type LinkType } from '@/server/db/codes';
import { getProjectContext, type ProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import {
  activityCalendarText, baselineSetText, baselineShownText, calendarSetText, cycleText, linkAddedText, linkCycleText, linkRemovedText, rescheduledText,
  todoAddedText, todoRemovedText,
} from './i18n';
import { canEditTask } from '@/features/mywork/permissions';
import { canEditPlan, canSchedulePlan } from './rights';

export type PlanToastResult = { ok: true; toast?: string } | { error: string };
export type PlanDialogResult = { toast?: string; error?: string };

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const ACT_RE = /^A\d{1,8}$/;
const BL_RE = /^BL\d{1,3}$/;
const TODO_RE = /^T-\d{3,}$/;
const NAME_MAX = 80;
const COMMENT_MAX = 2000;
const TODO_MAX = 200;
const LAG_MAX = 999;

/** Project context after the right check: `schedule` = Reschedule / baselines / project calendar, `edit` = activity edits. */
async function allowed(code: unknown, right: 'schedule' | 'edit'): Promise<{ ctx: ProjectContext } | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || !(await getProject(code))) return { error: t('Invalid request') };
  const ctx = await getProjectContext(code, 'plan');
  if (!(right === 'schedule' ? canSchedulePlan(ctx) : canEditPlan(ctx)))
    return { error: t(right === 'schedule' ? 'Only the project manager or the director can do this' : 'This plan is read-only for you') };
  return { ctx };
}

/** Project screens (Plan, Schedule, Change control…) — and, for schedule-wide changes, Home and the portfolio. */
const refresh = (code: string, scope: 'project' | 'all' = 'project') => (scope === 'all' ? revalidatePath('/', 'layout') : revalidatePath(`/projects/${code}`, 'layout'));

// ── Reschedule (S-1) ──────────────────────────────────────────────────────────────────────────────────────────────

/** Toolbar "Reschedule": CPM at the project data date; toast with the new finish and the number of changed activities. */
export async function rescheduleAction(code: string): Promise<PlanToastResult> {
  const r = await allowed(code, 'schedule');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const res = await rescheduleProject(r.ctx.project.code, r.ctx.viewer.name);
  if (!res.ok) {
    if (res.reason === 'cycle') return { error: cycleText(res.cycle ?? [], lang) };
    if (res.reason === 'empty') return { error: t('No activity to schedule') };
    return { error: `${t('The schedule data is invalid')} · ${res.issues?.[0] ?? ''}` };
  }
  refresh(r.ctx.project.code, 'all');
  return { ok: true, toast: rescheduledText(t(longDateText(res.dataDate)), t(longDateText(res.finishDate)), res.changed.length, lang) };
}

// ── Baselines (S-3) ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Set baseline" (name, comment) while the project is below BL1 (src/domain/baseline-policy.ts, S-3 + L-2): snapshots every
 * activity into BL0 / BL1, current at once. From BL2 on it is refused: a new baseline goes through a change request (the Plan
 * button links to the Change control form instead).
 */
export async function setBaselineAction(code: string, values: Record<string, string>): Promise<PlanDialogResult> {
  const r = await allowed(code, 'schedule');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  if (!canSnapshotFreely((await listProjectBaselines(r.ctx.project.code)).map((b) => b.code))) return { error: t('After BL1, a new baseline goes through a change request') };
  const name = str(values?.name).trim();
  const comment = str(values?.comment).trim();
  if (name.length > NAME_MAX) return { error: t('Baseline name is too long') };
  if (comment.length > COMMENT_MAX) return { error: t('Comment is too long') };
  let res: { code: string; activityCount: number };
  try {
    // The S-3 rule is checked again inside the snapshot transaction (R-010): two "Set baseline" sent at BL0 at the same time
    // create BL1 once; the second is refused instead of creating BL2 without a change request.
    res = await createBaselineSnapshot(r.ctx.project.code, {
      actorName: r.ctx.viewer.name, name: name || undefined, comment: comment || null, source: 'snapshot', makeCurrent: true, enforcePolicy: true,
    });
  } catch (e) {
    if (e instanceof BaselinePolicyError) return { error: t('After BL1, a new baseline goes through a change request') };
    throw e;
  }
  refresh(r.ctx.project.code);
  return { toast: baselineSetText(res.code, res.activityCount, lang) };
}

/** Baseline chip: shows another baseline (variance columns, Gantt baseline bars). */
export async function showBaselineAction(code: string, baselineCode: string): Promise<PlanToastResult> {
  const r = await allowed(code, 'schedule');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const bl = str(baselineCode);
  const known = (await listProjectBaselines(r.ctx.project.code)).find((b) => b.code === bl);
  if (!BL_RE.test(bl) || !known) return { error: t('Unknown baseline') };
  if (!known.activityCount) return { error: t('This baseline has no activity snapshot') };
  if (known.displayed) return { ok: true };
  await showProjectBaseline(r.ctx.project.code, bl, r.ctx.viewer.name);
  refresh(r.ctx.project.code, 'all');
  return { ok: true, toast: baselineShownText(bl, lang) };
}

// ── Calendars (S-2) ───────────────────────────────────────────────────────────────────────────────────────────────

/** Calendar chip: the project calendar (dates move at the next Reschedule, S-1 manual). */
export async function setProjectCalendarAction(code: string, calendarCode: string): Promise<PlanToastResult> {
  const r = await allowed(code, 'schedule');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const settings = await getPlanSettings(r.ctx.project.code);
  const cal = settings?.calendars.find((c) => c.code === str(calendarCode));
  if (!settings || !cal) return { error: t('Unknown calendar') };
  if (cal.code === settings.calendarCode) return { ok: true };
  await setProjectCalendar(r.ctx.project.code, cal.code, r.ctx.viewer.name);
  refresh(r.ctx.project.code);
  return { ok: true, toast: calendarSetText(t(cal.name), lang) };
}

/** Drawer "Calendar": per-activity override ('' = back to the project calendar). */
export async function setActivityCalendarAction(code: string, activity: string, calendarCode: string): Promise<PlanToastResult> {
  const r = await allowed(code, 'edit');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const act = str(activity).toUpperCase();
  const [data, settings] = await Promise.all([getPlanData(r.ctx.project.code), getPlanSettings(r.ctx.project.code)]);
  const a = data?.activities.find((x) => x.id === act);
  const want = str(calendarCode) || null;
  const cal = want ? settings?.calendars.find((c) => c.code === want) : null;
  if (!ACT_RE.test(act) || !a || (want && !cal)) return { error: t('Invalid request') };
  if ((a.calendarCode ?? null) === want) return { ok: true };
  await setActivityCalendar(r.ctx.project.code, act, want, r.ctx.viewer.name);
  refresh(r.ctx.project.code);
  return { ok: true, toast: activityCalendarText(act, cal ? t(cal.name) : null, lang) };
}

// ── Relationships (S-5) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Drawer "Add relationship" (`activity` = the drawer's activity): `dir` 'pred' adds `other` as its predecessor, 'succ' as its
 * successor; type FS/SS/FF/SF, lag in working days (negative = lead). No self link, duplicate or loop.
 */
export async function addRelationshipAction(code: string, activity: string, values: Record<string, string>): Promise<PlanDialogResult> {
  const r = await allowed(code, 'edit');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const act = str(activity).toUpperCase();
  const other = str(values?.activity).split(' · ')[0].trim().toUpperCase();
  const dir = str(values?.dir) === 'succ' ? 'succ' : 'pred';
  const type = str(values?.type).toUpperCase() || 'FS';
  const lagText = str(values?.lag).trim() || '0';
  if (!ACT_RE.test(act) || !ACT_RE.test(other)) return { error: t('Choose an activity') };
  if (!isLinkType(type)) return { error: t('Unknown relationship type') };
  if (!/^[+\-−]?\d{1,3}$/.test(lagText)) return { error: t('The lag is a whole number of working days between −999 and 999') };
  const lag = parseInt(lagText.replace('−', '-'), 10);
  if (Math.abs(lag) > LAG_MAX) return { error: t('The lag is a whole number of working days between −999 and 999') };
  const pred = dir === 'pred' ? other : act;
  const succ = dir === 'pred' ? act : other;
  const res = await addActivityLink(r.ctx.project.code, { pred, succ, type: type as LinkType, lag }, r.ctx.viewer.name);
  if ('error' in res) {
    if (res.error === 'self') return { error: t('An activity cannot be linked to itself') };
    if (res.error === 'duplicate') return { error: t('This relationship already exists') };
    if (res.error === 'cycle') return { error: linkCycleText(res.cycle ?? [], lang) };
    return { error: t('Invalid request') };
  }
  await rescheduleIfAutomatic(r.ctx.project.code, r.ctx.viewer.name);
  refresh(r.ctx.project.code);
  return { toast: linkAddedText(pred, `${type}${lag ? (lag > 0 ? '+' : '') + lag : ''}`, succ, lang) };
}

/** Drawer link removal. */
export async function removeRelationshipAction(code: string, pred: string, succ: string): Promise<PlanToastResult> {
  const r = await allowed(code, 'edit');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const p = str(pred).toUpperCase();
  const s = str(succ).toUpperCase();
  if (!ACT_RE.test(p) || !ACT_RE.test(s)) return { error: t('Invalid request') };
  const res = await removeActivityLink(r.ctx.project.code, p, s, r.ctx.viewer.name);
  if ('error' in res) return { error: t(res.error === 'missing' ? 'This relationship no longer exists' : 'Invalid request') };
  await rescheduleIfAutomatic(r.ctx.project.code, r.ctx.viewer.name);
  refresh(r.ctx.project.code);
  return { ok: true, toast: linkRemovedText(p, s, lang) };
}

// ── To-dos ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Drawer composer "Add a to-do…": a task on the activity, assigned to its owner, due at its finish. */
export async function addTodoAction(code: string, activity: string, title: string): Promise<PlanToastResult> {
  const r = await allowed(code, 'edit');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const act = str(activity).toUpperCase();
  const text = str(title).trim();
  if (!text) return { error: t('Enter a to-do') };
  if (text.length > TODO_MAX) return { error: t('A to-do holds at most 200 characters') };
  const data = await getPlanData(r.ctx.project.code);
  if (!ACT_RE.test(act) || !data?.activities.some((a) => a.id === act)) return { error: t('Invalid request') };
  const number = await addActivityTodo(r.ctx.project.code, act, { title: text }, r.ctx.viewer.name);
  refresh(r.ctx.project.code, 'all');
  return { ok: true, toast: todoAddedText(number, lang) };
}

async function todoOfActivity(code: string, activity: string, number: string) {
  const act = activity.toUpperCase();
  if (!ACT_RE.test(act) || !TODO_RE.test(number)) return null;
  return (await listActivityTodos(code, act)).find((x) => x.number === number) ?? null;
}

/** Ring of a to-do line: done ↔ in progress. */
export async function toggleTodoAction(code: string, activity: string, number: string, done: boolean): Promise<PlanToastResult> {
  const r = await allowed(code, 'edit');
  if ('error' in r) return r;
  const { t } = await getI18n();
  const todo = await todoOfActivity(r.ctx.project.code, str(activity), str(number));
  if (!todo) return { error: t('Invalid request') };
  // Ticking someone's task follows My work (its assignee or the director), plus the project's PM who plans the activity.
  if (!canSchedulePlan(r.ctx) && !canEditTask(r.ctx.viewer, todo.assignee ?? '', false)) return { error: t('Only the assignee or the project manager can change this to-do') };
  await setActivityTodoDone(r.ctx.project.code, todo.number, done === true, r.ctx.viewer.name);
  refresh(r.ctx.project.code, 'all');
  return { ok: true };
}

/** "Remove" on a to-do created here without logged time (other tasks are managed in My work). */
export async function removeTodoAction(code: string, activity: string, number: string): Promise<PlanToastResult> {
  const r = await allowed(code, 'edit');
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const todo = await todoOfActivity(r.ctx.project.code, str(activity), str(number));
  if (!todo) return { error: t('Invalid request') };
  if (!todo.removable) return { error: t('This to-do is managed in My work') };
  await removeActivityTodo(r.ctx.project.code, todo.number, r.ctx.viewer.name);
  refresh(r.ctx.project.code, 'all');
  return { ok: true, toast: todoRemovedText(todo.number, lang) };
}
