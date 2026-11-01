'use server';
// R-198 — Server Functions of the Schedule screen's interactive Gantt. Each one checks the viewer's rights on the server
// (src/features/schedule/gantt-rights.ts: the Plan's structure rights on a Schedule the viewer may edit), loads the project's
// network itself and re-validates the edit with the same pure rules as the browser's preview (src/domain/gantt-edit.ts), writes
// through the Plan's writers (src/server/dal/plan.ts — audited), then reschedules at once (the CPM of "Reschedule", which records
// its run, audit and activity) and revalidates the project's pages.
import { revalidatePath } from 'next/cache';
import { longDateText } from '@/domain/schedule-rollup';
import {
  GANTT_EDIT_ERRORS, applyGanttEdits, buildCalendars, isGanttLinkType, linkLabel, parseDurationDays, parseLag, type GanttEdit, type GanttEditResult, type GanttNetwork,
} from '@/domain/gantt-edit';
import { isIsoDate } from '@/domain/calendar';
import { systemMessage, type SystemMessage } from '@/domain/system-messages';
import { getGanttNetwork, recordGanttActivity } from '@/server/dal/gantt';
import { addActivityLink, removeActivityLink, updateActivity, updateActivityLink, type ActivityPatch } from '@/server/dal/plan';
import { getProject } from '@/server/dal/projects';
import { staleRecordResult } from '@/server/dal/record-version';
import { rescheduleProject } from '@/server/dal/schedule';
import type { KnownConstraintType } from '@/server/db/codes';
import { getProjectContext, type ProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { cycleText, linkCycleText, rescheduledText } from '@/features/plan/i18n';
import { canEditGantt, ganttEditable } from './gantt-rights';

export type GanttActionResult = { ok: true; toast: string } | { error: string; conflict?: true };

const ACT_RE = /^A\d{1,8}$/;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const STRUCTURE_ONLY = 'Only the project manager or the director can change the plan structure — you can update the progress of your own activities';

type Allowed = { ctx: ProjectContext; net: GanttNetwork };

async function allowed(code: unknown): Promise<Allowed | { error: string }> {
  const { t } = await getI18n();
  if (typeof code !== 'string' || !code || !(await getProject(code))) return { error: t('Invalid request') };
  const ctx = await getProjectContext(code, 'schedule');
  if (!ganttEditable(ctx)) return { error: t('This schedule is read-only for you') };
  if (!canEditGantt(ctx)) return { error: t(STRUCTURE_ONLY) };
  const net = await getGanttNetwork(ctx.project.code);
  if (!net) return { error: t('No activity to schedule') };
  return { ctx, net };
}

/** The refusal of an edit in the viewer's language. */
async function refusal(r: Extract<GanttEditResult, { ok: false }>): Promise<{ error: string }> {
  const { t, lang } = await getI18n();
  if (r.error === 'cycle') return { error: linkCycleText(r.cycle ?? [], lang) };
  return { error: t(GANTT_EDIT_ERRORS[r.error]) };
}

/** Immediate recalculation after a Gantt edit (R-198), then the toast: what changed · the Reschedule summary. */
async function rescheduled(a: Allowed, what: string): Promise<GanttActionResult> {
  const { t, lang } = await getI18n();
  const code = a.ctx.project.code;
  const res = await rescheduleProject(code, a.ctx.viewer.name);
  // Dates, floats and the project finish move: Home and the portfolio read them too (as "Reschedule").
  revalidatePath('/', 'layout');
  if (!res.ok) {
    // The edit is saved; the network could not be dated (should not happen: the edit was checked for loops first).
    const why = res.reason === 'cycle' ? cycleText(res.cycle ?? [], lang) : `${t('The schedule data is invalid')} · ${res.issues?.[0] ?? ''}`;
    return { ok: true, toast: `${what} · ${why}` };
  }
  return { ok: true, toast: `${what} · ${rescheduledText(t(longDateText(res.dataDate)), t(longDateText(res.finishDate)), res.changed.length, lang)}` };
}

export interface GanttActivityValues {
  /** New start (ISO): a "Start no earlier than" constraint (a "Must start on" keeps its type). '' = unchanged. */
  start?: string;
  /** New duration, working days. '' = unchanged. */
  duration?: string;
  /** Remove the activity's date constraint ("As soon as possible"). */
  clearConstraint?: boolean;
  /** R-010: the activity's version token as the Gantt read it ('' or absent = not checked). */
  version?: string;
}

/**
 * Bar dragged or resized, or the activity dialog's "Apply": start (constraint), duration, removal of the constraint. Refused on
 * actual dates (complete activity, actual start of an activity in progress) and on a milestone's duration.
 */
export async function ganttEditActivityAction(code: string, activity: string, values: GanttActivityValues): Promise<GanttActionResult> {
  const r = await allowed(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const act = str(activity).toUpperCase();
  const a = r.net.activities.find((x) => x.id === act);
  if (!ACT_RE.test(act) || !a) return { error: t('Invalid request') };
  const edits: GanttEdit[] = [];
  if (values?.clearConstraint === true) edits.push({ kind: 'clearConstraint', id: act });
  const start = str(values?.start).trim();
  if (start) {
    if (!isIsoDate(start)) return { error: t(GANTT_EDIT_ERRORS.date) };
    edits.push({ kind: 'move', id: act, start });
  }
  const durText = str(values?.duration).trim();
  if (durText) {
    const days = parseDurationDays(durText);
    if (days == null) return { error: t(GANTT_EDIT_ERRORS.duration) };
    if (days !== a.duration) edits.push({ kind: 'duration', id: act, days });
  }
  if (!edits.length) return { ok: true, toast: `${act} · ${t('No change')}` };
  const res = applyGanttEdits(r.net, edits, buildCalendars(r.net.calendars));
  if (!res.ok) return refusal(res);
  const next = res.net.activities.find((x) => x.id === act)!;
  const patch: ActivityPatch = {};
  if (next.duration !== a.duration) patch.durationDays = next.duration;
  const sameConstraint = (a.constraint?.type ?? null) === (next.constraint?.type ?? null) && (a.constraint?.date ?? null) === (next.constraint?.date ?? null);
  if (!sameConstraint) patch.constraint = next.constraint && next.constraint.date ? { type: next.constraint.type as KnownConstraintType, date: next.constraint.date } : null;
  if (patch.durationDays === undefined && patch.constraint === undefined) return { ok: true, toast: `${act} · ${t('No change')}` };
  const moved = start && next.constraint?.date ? next.constraint.date : null;
  const feed: SystemMessage = moved
    ? systemMessage('gantt.moved', { activity: act, date: moved })
    : patch.durationDays !== undefined
      ? systemMessage('gantt.durationChanged', { activity: act, days: patch.durationDays })
      : systemMessage('gantt.constraintCleared', { activity: act });
  // R-010: refused when someone else changed the activity since the Gantt read it (the edit was checked on that network).
  try {
    const version = typeof values?.version === 'string' ? values.version : null;
    if (!(await updateActivity(r.ctx.project.code, act, patch, { actorName: r.ctx.viewer.name, feed, version }))) return { error: t('Invalid request') };
  } catch (e) {
    const stale = staleRecordResult(e, (await getI18n()).lang);
    if (!stale) throw e;
    revalidatePath(`/projects/${r.ctx.project.code}`, 'layout');
    return stale;
  }
  const what = moved ? 'Activity moved' : patch.durationDays !== undefined ? 'Duration changed' : 'Date constraint removed';
  return rescheduled(r, `${act} · ${t(what)}`);
}

export interface GanttLinkValues {
  pred: string;
  succ: string;
  /** FS / SS / FF / SF ('' = FS). */
  type?: string;
  /** Working days, negative = lead ('' = 0). */
  lag?: string;
}

/** Parses the untrusted relationship of a Gantt action. */
async function linkOf(values: GanttLinkValues): Promise<{ pred: string; succ: string; type: 'FS' | 'SS' | 'FF' | 'SF'; lag: number } | { error: string }> {
  const { t } = await getI18n();
  const pred = str(values?.pred).trim().toUpperCase();
  const succ = str(values?.succ).trim().toUpperCase();
  const type = str(values?.type).trim().toUpperCase() || 'FS';
  if (!ACT_RE.test(pred) || !ACT_RE.test(succ)) return { error: t('Choose an activity') };
  if (!isGanttLinkType(type)) return { error: t(GANTT_EDIT_ERRORS.type) };
  const lag = parseLag(values?.lag ?? '');
  if (lag == null) return { error: t(GANTT_EDIT_ERRORS.lag) };
  return { pred, succ, type, lag };
}

/** A relationship drawn from one bar to another (finish-to-start, no lag) or added in the activity dialog. Refuses loops. */
export async function ganttAddLinkAction(code: string, values: GanttLinkValues): Promise<GanttActionResult> {
  const r = await allowed(code);
  if ('error' in r) return r;
  const { t, lang } = await getI18n();
  const link = await linkOf(values);
  if ('error' in link) return link;
  const res = applyGanttEdits(r.net, [{ kind: 'addLink', link }], buildCalendars(r.net.calendars));
  if (!res.ok) return refusal(res);
  // The writer checks duplicates and loops again inside its transaction.
  const w = await addActivityLink(r.ctx.project.code, link, r.ctx.viewer.name);
  if ('error' in w) {
    if (w.error === 'cycle') return { error: linkCycleText(w.cycle ?? [], lang) };
    if (w.error === 'duplicate' || w.error === 'self') return { error: t(GANTT_EDIT_ERRORS[w.error]) };
    return { error: t('Invalid request') };
  }
  await recordGanttActivity(r.ctx.project.code, r.ctx.viewer.name, systemMessage('gantt.linkAdded', { pred: link.pred, succ: link.succ, link: linkLabel(link) }));
  return rescheduled(r, `${link.pred} ${linkLabel(link)} → ${link.succ} · ${t('Relationship added')}`);
}

/** A selected relationship: new type and lag. */
export async function ganttEditLinkAction(code: string, values: GanttLinkValues): Promise<GanttActionResult> {
  const r = await allowed(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const link = await linkOf(values);
  if ('error' in link) return link;
  const res = applyGanttEdits(r.net, [{ kind: 'editLink', link }], buildCalendars(r.net.calendars));
  if (!res.ok) return refusal(res);
  const cur = r.net.links.find((l) => l.pred === link.pred && l.succ === link.succ)!;
  if (cur.type === link.type && cur.lag === link.lag) return { ok: true, toast: `${link.pred} → ${link.succ} · ${t('No change')}` };
  const w = await updateActivityLink(r.ctx.project.code, link, r.ctx.viewer.name);
  if ('error' in w) return { error: t(w.error === 'missing' ? GANTT_EDIT_ERRORS.missing : 'Invalid request') };
  await recordGanttActivity(r.ctx.project.code, r.ctx.viewer.name, systemMessage('gantt.linkChanged', { pred: link.pred, succ: link.succ, link: linkLabel(link) }));
  return rescheduled(r, `${link.pred} ${linkLabel(link)} → ${link.succ} · ${t('Relationship changed')}`);
}

/** A selected relationship removed. */
export async function ganttRemoveLinkAction(code: string, pred: string, succ: string): Promise<GanttActionResult> {
  const r = await allowed(code);
  if ('error' in r) return r;
  const { t } = await getI18n();
  const p = str(pred).toUpperCase();
  const s = str(succ).toUpperCase();
  if (!ACT_RE.test(p) || !ACT_RE.test(s)) return { error: t('Invalid request') };
  const res = applyGanttEdits(r.net, [{ kind: 'removeLink', pred: p, succ: s }], buildCalendars(r.net.calendars));
  if (!res.ok) return refusal(res);
  const w = await removeActivityLink(r.ctx.project.code, p, s, r.ctx.viewer.name);
  if ('error' in w) return { error: t(w.error === 'missing' ? GANTT_EDIT_ERRORS.missing : 'Invalid request') };
  await recordGanttActivity(r.ctx.project.code, r.ctx.viewer.name, systemMessage('gantt.linkRemoved', { pred: p, succ: s }));
  return rescheduled(r, `${p} → ${s} · ${t('Relationship removed')}`);
}
