'use server';
// Server Functions of the resource-request workflow (docs/spec/08 §5.5–§5.6, §6.5, 01 §12): send (New resource request
// dialog), the PM's withdraw / accept reschedule / re-request on their own requests, send / discard of the DRAFTS made by
// the what-if levelling (chapter 4, S-7), and the department decisions approve / propose reschedule / reject. Each
// validates its input, checks the viewer (persona) may act, writes through
// the requests DAL with the viewer as actor (never the prototype's hard-wired R. Aubert or department head, 00 §7.16),
// notifies the other party and revalidates every screen (badges, Home, My work). Messages are English source strings
// (the client shows them with toast showEn).
import { revalidatePath } from 'next/cache';
import {
  CONTRACT_ROLE, datesText, isNrDuration, isNrWeek, isPriority, isShift, nrDates, parseHours, requestTitle, shiftedDates,
} from '@/domain/requests';
import { shortDateOfIso } from '@/server/db/codes';
import { getProject } from '@/server/dal/projects';
import {
  acceptReschedule, approveResourceRequest, createResourceRequest, discardDraftRequest, getResourceRequest, listRequestActivities, proposeReschedule,
  reRequestResourceRequest, rejectResourceRequest, sendDraftRequest, withdrawResourceRequest, type ResourceRequestRow,
} from '@/server/dal/requests';
import { notifyRequestEvent, recordRequestActivity, type RequestNotice } from '@/server/dal/requests-screens';
import { getResourcePool } from '@/server/dal/resources';
import { getProjectScope } from '@/server/project-context';
import { getViewer, type Viewer } from '@/server/session';
import { canDecideRequests, canManageOwnRequests, canSendRequests, draftRights, isRequester } from './permissions';
import { logError } from '@/server/log';

export type RequestActionResult = { ok: true; number?: string } | { ok: false; error: string };

const NOT_SENDER = 'Read-only — you cannot send resource requests';
const NOT_OWNER = 'Read-only — only the sender can change this request';
const NOT_DRAFTER = 'Read-only — only the requester, the project manager or the director can send or discard this draft';
const NOT_DECIDER = 'Read-only — you cannot decide resource requests';
const UNKNOWN = 'Unknown request';
const STALE = 'This request has already been decided';
const NOT_DRAFT = 'This request is no longer a draft';
const INVALID = 'Invalid request';
const NO_PLAN = 'This project has no plan yet';
const FAILED = 'The change could not be saved';

const MAX_TITLE = 200;
const MAX_NOTE = 1000;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isNumber = (v: unknown): v is string => typeof v === 'string' && /^RQ-\d{3,6}$/.test(v);

const refresh = () => revalidatePath('/', 'layout');

/** Notifications and activity are a courtesy: a failure there must not undo or fail the decision. */
async function announce(viewer: Viewer, r: ResourceRequestRow | null, notices: (r: ResourceRequestRow) => RequestNotice[], activity: string) {
  if (!r) return;
  try {
    await notifyRequestEvent(notices(r), viewer.role);
    await recordRequestActivity(r.projectCode, viewer.name, `${activity} ${r.id} — ${r.title}`);
  } catch (e) {
    logError('Resource request notification', e);
  }
}

const who = (r: ResourceRequestRow) => r.resource;

// ── Send (New resource request dialog) ──────────────────────────────────────────────────────────────────

export interface SendRequestInput {
  projectCode: string;
  title: string;
  /** Activity code (one of the dialog's chips). */
  act: string;
  /** Pool person (full name) or the "Contract role" value. */
  person: string;
  /** Working-day offsets: week 5 / 10 / 15, duration 1 / 4 / 9. */
  week: number;
  dur: number;
  /** Raw text of the Hours field (parseFloat, 8 when unparsable). */
  hours: string;
  prio: string;
  note: string;
}

/** "Send request" (nr.send 4156): a pending request from the viewer, routed to the person's department. */
export async function sendResourceRequestAction(input: SendRequestInput): Promise<RequestActionResult> {
  const viewer = await getViewer();
  if (!canSendRequests(viewer.role)) return { ok: false, error: NOT_SENDER };
  const code = str(input?.projectCode, 40);
  const project = code ? await getProject(code) : null;
  if (!project) return { ok: false, error: INVALID };
  if ((await getProjectScope()).readOnly(project)) return { ok: false, error: NOT_SENDER };
  if (!project.hasData) return { ok: false, error: NO_PLAN };
  const { week, dur, prio } = input ?? {};
  if (!isNrWeek(week) || !isNrDuration(dur) || !isPriority(prio)) return { ok: false, error: INVALID };
  const acts = await listRequestActivities(project.code);
  const act = acts.find((a) => a.code === input.act);
  if (!act) return { ok: false, error: INVALID };
  const pool = await getResourcePool();
  const person = pool.people.find((p) => p.name === input.person);
  if (!person && input.person !== CONTRACT_ROLE) return { ok: false, error: INVALID };
  const { start, due } = nrDates(week, dur);
  let number: string;
  try {
    number = await createResourceRequest(
      {
        projectCode: project.code, title: requestTitle(str(input.title, MAX_TITLE)), activityCode: act.code,
        person: person?.name, contractRole: person ? undefined : CONTRACT_ROLE, hours: parseHours(String(input.hours ?? '')),
        startDate: start, dueDate: due, priority: prio, note: str(input.note, MAX_NOTE),
      },
      viewer.name,
    );
  } catch (e) {
    logError('sendResourceRequestAction', e);
    return { ok: false, error: FAILED };
  }
  await announce(viewer, await getResourceRequest(number), (r) => [
    { kind: 'request', title: 'New resource request', sub: `${r.title} · ${who(r)} · ${viewer.name}`, screen: 'approvals', params: { dept: r.department }, projectCode: r.projectCode, to: r.departmentHead },
  ], 'Sent resource request');
  refresh();
  return { ok: true, number };
}

// ── PM side (own requests) ─────────────────────────────────────────────────────────────────────────────

/** Loads a request the viewer sent, checking the Requests screen is in their workspace. */
async function ownRequest(id: unknown): Promise<{ viewer: Viewer; r: ResourceRequestRow } | { error: string }> {
  const viewer = await getViewer();
  if (!canManageOwnRequests(viewer.role)) return { error: NOT_OWNER };
  if (!isNumber(id)) return { error: INVALID };
  const r = await getResourceRequest(id);
  if (!r) return { error: UNKNOWN };
  if (!isRequester(r, viewer)) return { error: NOT_OWNER };
  return { viewer, r };
}

/** "Withdraw" (pending or reschedule proposed). */
export async function withdrawRequestAction(id: string): Promise<RequestActionResult> {
  const o = await ownRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  if (o.r.status !== 'pending' && o.r.status !== 'reschedule') return { ok: false, error: STALE };
  try {
    await withdrawResourceRequest(o.r.id, o.viewer.name);
  } catch (e) {
    logError('withdrawRequestAction', e);
    return { ok: false, error: FAILED };
  }
  await announce(o.viewer, o.r, (r) => [
    { kind: 'request', title: 'Resource request withdrawn', sub: `${r.title} · ${who(r)} · ${o.viewer.name}`, screen: 'approvals', params: { dept: r.department }, projectCode: r.projectCode, to: r.departmentHead },
  ], 'Withdrew resource request');
  refresh();
  return { ok: true };
}

/** "Re-request" (rejected): back to pending, sent today. */
export async function reRequestAction(id: string): Promise<RequestActionResult> {
  const o = await ownRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  if (o.r.status !== 'rejected') return { ok: false, error: STALE };
  try {
    await reRequestResourceRequest(o.r.id, o.viewer.name);
  } catch (e) {
    logError('reRequestAction', e);
    return { ok: false, error: FAILED };
  }
  await announce(o.viewer, o.r, (r) => [
    { kind: 'request', title: 'New resource request', sub: `${r.title} · ${who(r)} · ${o.viewer.name}`, screen: 'approvals', params: { dept: r.department }, projectCode: r.projectCode, to: r.departmentHead },
  ], 'Re-sent resource request');
  refresh();
  return { ok: true };
}

/** "Accept {dates}" (reschedule proposed): the request is approved on the proposed dates and the task is created. */
export async function acceptRescheduleAction(id: string): Promise<RequestActionResult> {
  const o = await ownRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  if (o.r.status !== 'reschedule') return { ok: false, error: STALE };
  let task: string;
  try {
    task = await acceptReschedule(o.r.id, o.viewer.name);
  } catch (e) {
    logError('acceptRescheduleAction', e);
    return { ok: false, error: FAILED };
  }
  await announce(o.viewer, await getResourceRequest(o.r.id), (r) => [
    { kind: 'approval', title: 'Reschedule accepted', sub: `${r.title} · ${who(r)} · ${datesText(r.start, r.due)} · ${o.viewer.name}`, screen: 'approvals', params: { dept: r.department }, projectCode: r.projectCode, to: r.departmentHead },
    { kind: 'task', title: 'New task assigned', sub: `${r.title} · Accepted by ${o.viewer.name} · due ${shortDateOfIso(r.due)}`, screen: 'mywork', params: {}, projectCode: r.projectCode, to: r.person },
  ], 'Accepted reschedule of resource request');
  refresh();
  return { ok: true, number: task };
}

// ── Drafts (chapter 4, S-7: what-if "Apply" / "Select scenario → create requests") ────────────────────────────

/**
 * Loads a DRAFT the viewer may send or discard — the rules of sending a request (`canHandleDraft`, shared with the page
 * through `draftRights`): the requester, the project's PM or the director, with Resource requests in their workspace,
 * never on a project read-only for them.
 */
async function draftRequest(id: unknown): Promise<{ viewer: Viewer; r: ResourceRequestRow } | { error: string }> {
  const viewer = await getViewer();
  if (!canSendRequests(viewer.role) || !canManageOwnRequests(viewer.role)) return { error: NOT_SENDER };
  if (!isNumber(id)) return { error: INVALID };
  const r = await getResourceRequest(id);
  if (!r) return { error: UNKNOWN };
  if (!draftRights(viewer, await getProjectScope())(r)) return { error: NOT_DRAFTER };
  if (r.status !== 'draft') return { error: NOT_DRAFT };
  return { viewer, r };
}

/** "Send" on a draft: draft → pending review, sent today; the department head is notified as for a new request. */
export async function sendDraftRequestAction(id: string): Promise<RequestActionResult> {
  const o = await draftRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  try {
    await sendDraftRequest(o.r.id, o.viewer.name);
  } catch (e) {
    logError('sendDraftRequestAction', e);
    return { ok: false, error: FAILED };
  }
  await announce(o.viewer, await getResourceRequest(o.r.id), (r) => [
    { kind: 'request', title: 'New resource request', sub: `${r.title} · ${who(r)} · ${o.viewer.name}`, screen: 'approvals', params: { dept: r.department }, projectCode: r.projectCode, to: r.departmentHead },
  ], 'Sent draft resource request');
  refresh();
  return { ok: true, number: o.r.id };
}

/** "Discard" on a draft (confirmed in a dialog): the draft is deleted — it never reached the department. */
export async function discardDraftRequestAction(id: string): Promise<RequestActionResult> {
  const o = await draftRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  try {
    await discardDraftRequest(o.r.id, o.viewer.name);
  } catch (e) {
    logError('discardDraftRequestAction', e);
    return { ok: false, error: FAILED };
  }
  // Nobody to notify (the department never saw it); the activity feed keeps the trace.
  await announce(o.viewer, o.r, () => [], 'Discarded draft resource request');
  refresh();
  return { ok: true, number: o.r.id };
}

// ── Department side (Approvals) ────────────────────────────────────────────────────────────────────────

/** Loads a pending request, checking the Approvals screen is in the viewer's workspace (any department, 08 OQ19). */
async function pendingRequest(id: unknown): Promise<{ viewer: Viewer; r: ResourceRequestRow } | { error: string }> {
  const viewer = await getViewer();
  if (!canDecideRequests(viewer.role)) return { error: NOT_DECIDER };
  if (!isNumber(id)) return { error: INVALID };
  const r = await getResourceRequest(id);
  if (!r) return { error: UNKNOWN };
  if (r.status !== 'pending') return { error: STALE };
  return { viewer, r };
}

/** "Approve & send to …": creates the task T-2341… in the person's list. */
export async function approveRequestAction(id: string): Promise<RequestActionResult> {
  const o = await pendingRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  let task: string;
  try {
    task = await approveResourceRequest(o.r.id, o.viewer.name);
  } catch (e) {
    logError('approveRequestAction', e);
    return { ok: false, error: FAILED };
  }
  await announce(o.viewer, o.r, (r) => [
    { kind: 'approval', title: 'Resource request approved', sub: `${r.title} · ${who(r)} · ${o.viewer.name}`, screen: 'requests', params: { status: 'approved' }, projectCode: r.projectCode, to: r.requestedByName },
    { kind: 'task', title: 'New task assigned', sub: `${r.title} · Approved by ${o.viewer.name} · due ${shortDateOfIso(r.due)}`, screen: 'mywork', params: {}, projectCode: r.projectCode, to: r.person },
  ], 'Approved resource request');
  refresh();
  return { ok: true, number: task };
}

/** "Send proposal": counter-proposes the dates `shift` weeks later, with an optional reason for the PM. */
export async function proposeRescheduleAction(id: string, shift: number, note: string): Promise<RequestActionResult> {
  if (!isShift(shift)) return { ok: false, error: INVALID };
  const o = await pendingRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  const reason = str(note, MAX_NOTE);
  try {
    await proposeReschedule(o.r.id, shift, reason, o.viewer.name);
  } catch (e) {
    logError('proposeRescheduleAction', e);
    return { ok: false, error: FAILED };
  }
  const to = shiftedDates(o.r.start, o.r.due, shift);
  await announce(o.viewer, o.r, (r) => [
    { kind: 'request', title: 'Resource request rescheduled', sub: `${r.title} · ${who(r)} · ${datesText(r.start, r.due)} → ${datesText(to.start, to.due)} · ${o.viewer.name}`, screen: 'requests', params: { status: 'reschedule' }, projectCode: r.projectCode, to: r.requestedByName },
  ], 'Proposed reschedule on resource request');
  refresh();
  return { ok: true };
}

/** "Confirm reject" with the reason the PM sees. */
export async function rejectRequestAction(id: string, note: string): Promise<RequestActionResult> {
  const o = await pendingRequest(id);
  if ('error' in o) return { ok: false, error: o.error };
  const reason = str(note, MAX_NOTE);
  try {
    await rejectResourceRequest(o.r.id, reason, o.viewer.name);
  } catch (e) {
    logError('rejectRequestAction', e);
    return { ok: false, error: FAILED };
  }
  await announce(o.viewer, o.r, (r) => [
    { kind: 'request', title: 'Resource request rejected', sub: `${r.title} · ${who(r)} · ${o.viewer.name}`, screen: 'requests', params: { status: 'rejected' }, projectCode: r.projectCode, to: r.requestedByName },
  ], 'Rejected resource request');
  refresh();
  return { ok: true };
}
