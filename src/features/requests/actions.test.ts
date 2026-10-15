// Resource-request Server Functions against an in-memory database: the viewer is the sender / decider (never the
// prototype's hard-wired R. Aubert or department head), permission gates per persona, input validation as the
// dialog parses it, the prototype's decision lines, task creation on approval and the notifications sent.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'pm' as RoleKey };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[state.role],
    getI18n: async () => ({ lang: 'en', t: makeT('en') }),
    getLastProject: async () => 'HLT-026',
  };
});
vi.mock('@/server/project-context', () => ({
  // projReadOnly: a PM on a project that is not theirs.
  getProjectScope: async () => ({ readOnly: (p: { pm: string }) => state.role === 'pm' && p.pm !== 'R. Aubert' }),
}));

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listNotifications } from '@/server/dal/notifications';
import { getResourceRequest, listResourceRequests } from '@/server/dal/requests';
import { getTask } from '@/server/dal/tasks';
import {
  acceptRescheduleAction, approveRequestAction, proposeRescheduleAction, reRequestAction, rejectRequestAction, sendResourceRequestAction,
  withdrawRequestAction, type SendRequestInput,
} from './actions';

const draft = (patch: Partial<SendRequestInput> = {}): SendRequestInput => ({
  projectCode: 'HLT-026', title: '', act: 'A1250', person: 'Julien Wagner', week: 5, dur: 4, hours: 'abc', prio: 'med', note: '', ...patch,
});
const top = async (role: string) => (await listNotifications(role))[0];

describe('resource-request Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    state.role = 'pm';
  });

  it('send: the viewer is the sender; defaults as nr.send (Untitled request, 8 h, w/c 28 Sep + 1 week)', async () => {
    expect(await sendResourceRequestAction(draft())).toEqual({ ok: true, number: 'RQ-045' });
    const [r] = await listResourceRequests();
    expect(r).toMatchObject({
      id: 'RQ-045', requestedBy: 'R. Aubert', person: 'Julien Wagner', department: 'Engineering', title: 'Untitled request', hours: 8,
      start: '2026-09-28', due: '2026-10-02', priority: 'med', status: 'pending', sentText: 'Fri 25 Sep', response: '', projectCode: 'HLT-026',
    });
    expect(await top('depthead')).toMatchObject({ kind: 'request', title: 'New resource request', sub: 'Untitled request · Julien Wagner · Romain Aubert', screen: 'approvals' });
    // A department head may send too (Resource requests is in their workspace): sender = Marion Kerviel.
    state.role = 'depthead';
    expect(await sendResourceRequestAction(draft({ title: ' Bolt torque audit ', person: 'Contract structural engineer', week: 15, dur: 9, hours: '24', prio: 'high' }))).toEqual({ ok: true, number: 'RQ-046' });
    expect(await getResourceRequest('RQ-046')).toMatchObject({
      requestedBy: 'M. Kerviel', person: null, contractRole: 'Contract structural engineer', department: 'Engineering', title: 'Bolt torque audit', hours: 24,
      start: '2026-10-12', due: '2026-10-23', priority: 'high',
    });
  });

  it('send: refused for roles without the dialog, read-only projects and invalid input', async () => {
    state.role = 'client';
    expect(await sendResourceRequestAction(draft())).toEqual({ ok: false, error: 'Read-only — you cannot send resource requests' });
    state.role = 'member';
    expect(await sendResourceRequestAction(draft())).toEqual({ ok: false, error: 'Read-only — you cannot send resource requests' });
    state.role = 'pm';
    expect(await sendResourceRequestAction(draft({ projectCode: 'NDC-031' }))).toEqual({ ok: false, error: 'Read-only — you cannot send resource requests' });
    expect(await sendResourceRequestAction(draft({ projectCode: 'NOPE-1' }))).toEqual({ ok: false, error: 'Invalid request' });
    expect(await sendResourceRequestAction(draft({ week: 7 }))).toEqual({ ok: false, error: 'Invalid request' });
    expect(await sendResourceRequestAction(draft({ dur: 2 }))).toEqual({ ok: false, error: 'Invalid request' });
    expect(await sendResourceRequestAction(draft({ prio: 'urgent' }))).toEqual({ ok: false, error: 'Invalid request' });
    expect(await sendResourceRequestAction(draft({ act: 'A9999' }))).toEqual({ ok: false, error: 'Invalid request' });
    expect(await sendResourceRequestAction(draft({ person: 'Nobody Here' }))).toEqual({ ok: false, error: 'Invalid request' });
    state.role = 'director';
    expect(await sendResourceRequestAction(draft({ projectCode: 'EWA-051' }))).toEqual({ ok: false, error: 'This project has no plan yet' });
    expect((await listResourceRequests()).length).toBe(12);
  });

  it('PM actions: only the sender, with Resource requests in their workspace', async () => {
    state.role = 'depthead';
    expect(await withdrawRequestAction('RQ-044')).toEqual({ ok: false, error: 'Read-only — only the sender can change this request' });
    state.role = 'quality';
    expect(await withdrawRequestAction('RQ-044')).toEqual({ ok: false, error: 'Read-only — only the sender can change this request' });
    state.role = 'pm';
    expect(await withdrawRequestAction('RQ-999')).toEqual({ ok: false, error: 'Unknown request' });
    expect(await withdrawRequestAction('DROP TABLE')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await withdrawRequestAction('RQ-044')).toEqual({ ok: true });
    expect(await getResourceRequest('RQ-044')).toMatchObject({ status: 'withdrawn', response: 'Withdrawn by PM · Fri 25 Sep' });
    expect(await withdrawRequestAction('RQ-044')).toEqual({ ok: false, error: 'This request has already been decided' });
    // P-8c a (R-090): a withdrawn request is re-sent as it was, by its sender (was 08 OQ21: only rejected → stale).
    state.role = 'depthead';
    expect(await reRequestAction('RQ-044')).toEqual({ ok: false, error: 'Read-only — only the sender can change this request' });
    state.role = 'pm';
    expect(await reRequestAction('RQ-044')).toEqual({ ok: true });
    expect(await getResourceRequest('RQ-044')).toMatchObject({ status: 'pending', response: '', sentText: 'Fri 25 Sep' });
    expect(await top('depthead')).toMatchObject({ kind: 'request', title: 'New resource request', screen: 'approvals' });
    // Pending again: a second re-request is stale.
    expect(await reRequestAction('RQ-044')).toEqual({ ok: false, error: 'This request has already been decided' });
  });

  it('R-048 (P-8a): a department head decides their own department\'s requests only (was: any department)', async () => {
    const notTheirs = { ok: false, error: 'Read-only — you decide the requests of your own department only' };
    state.role = 'depthead'; // Engineering
    expect(await approveRequestAction('RQ-042')).toEqual(notTheirs); // Quality
    expect(await rejectRequestAction('RQ-042', 'No')).toEqual(notTheirs);
    expect(await proposeRescheduleAction('RQ-042', 2, 'Later')).toEqual(notTheirs);
    state.role = 'quality'; // heads Quality
    expect(await approveRequestAction('RQ-041')).toEqual(notTheirs); // Engineering
    expect(await getResourceRequest('RQ-041')).toMatchObject({ status: 'pending' });
    expect(await getResourceRequest('RQ-042')).toMatchObject({ status: 'pending' });
  });

  it('approve: the decider is the viewer, the task T-2341 lands in the person’s list, requester and person notified', async () => {
    state.role = 'pm';
    expect(await approveRequestAction('RQ-041')).toEqual({ ok: false, error: 'Read-only — you cannot decide resource requests' });
    state.role = 'depthead';
    expect(await approveRequestAction('RQ-041')).toEqual({ ok: true, number: 'T-2341' });
    expect(await getResourceRequest('RQ-041')).toMatchObject({ status: 'approved', response: 'Approved · Marion Kerviel · Fri 25 Sep', taskId: 'T-2341' });
    expect(await getTask('T-2341')).toMatchObject({ assignee: 'Julien Wagner', status: 'todo', estimateH: 12 });
    expect(await approveRequestAction('RQ-041')).toEqual({ ok: false, error: 'This request has already been decided' });
    expect(await top('pm')).toMatchObject({ kind: 'approval', title: 'Resource request approved', screen: 'requests' });
    expect(await top('member')).toMatchObject({ kind: 'task', title: 'New task assigned', sub: 'Erection sequence review — Bay 4 rafters, second crew · Approved by Marion Kerviel · due 30 Sep', screen: 'mywork' });
  });

  it('propose reschedule (+2 weeks, reason) then the PM accepts: dates move, task created', async () => {
    state.role = 'quality';
    expect(await proposeRescheduleAction('RQ-042', 4, '')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await proposeRescheduleAction('RQ-042', 2, ' Over capacity that week ')).toEqual({ ok: true });
    expect(await getResourceRequest('RQ-042')).toMatchObject({
      status: 'reschedule', proposedStart: '2026-10-15', proposedDue: '2026-10-16', response: 'Reschedule proposed · Gabriel Comte · Fri 25 Sep — Over capacity that week',
    });
    expect(await top('pm')).toMatchObject({ title: 'Resource request rescheduled', sub: 'Weld inspection — Bay 4 rafters · Hélène Sauvage · 1 Oct – 2 Oct → 15 Oct – 16 Oct · Gabriel Comte' });
    state.role = 'pm';
    expect(await acceptRescheduleAction('RQ-042')).toEqual({ ok: true, number: 'T-2342' });
    expect(await getResourceRequest('RQ-042')).toMatchObject({
      status: 'approved', start: '2026-10-15', due: '2026-10-16', taskId: 'T-2342', response: 'Rescheduled to 15 Oct – 16 Oct · accepted by PM · assigned',
    });
    expect(await top('quality')).toMatchObject({ title: 'Reschedule accepted' });
  });

  it('reject with a reason, then re-request', async () => {
    state.role = 'director';
    expect(await rejectRequestAction('RQ-043', 'Use the CR-008 contractor')).toEqual({ ok: true });
    expect(await getResourceRequest('RQ-043')).toMatchObject({ status: 'rejected', response: 'Rejected · Marie Lefebvre · Fri 25 Sep — Use the CR-008 contractor' });
    expect(await top('pm')).toMatchObject({ title: 'Resource request rejected' });
    state.role = 'pm';
    expect(await reRequestAction('RQ-043')).toEqual({ ok: true });
    expect(await getResourceRequest('RQ-043')).toMatchObject({ status: 'pending', response: '', sentText: 'Fri 25 Sep' });
  });
});
