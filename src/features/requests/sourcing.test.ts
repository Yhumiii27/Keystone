// R-089 (P-8b): a resource request for a contract role becomes, once approved (Approvals, My approvals) or once its reschedule
// is accepted, a task for procurement to find and name the person; procurement (or the director) names an EXISTING person on
// the task sheet, which reassigns the same task and completes the request. Seeded in-memory database, real project context and
// screen access, mocked session: the 8 personas, malformed input, stale states, the writer's own role check, notifications.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'depthead' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: () => {
    throw new Error('REDIRECT');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
  };
});

import { and, eq } from 'drizzle-orm';
import { isOutside } from '@/components/app/shell/nav-model';
import { PERSONAS } from '@/config/personas';
import { canSee } from '@/config/role-screens';
import { fieldsText } from '@/i18n/data-text';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { shortDateOfIso } from '@/server/db/codes';
import { users } from '@/server/db/schema';
import { listActivity, listAudit, listNotifications } from '@/server/dal/notifications';
import { createResourceRequest, getResourceRequest, listSourcingCandidates, nameSourcedPerson, proposeReschedule } from '@/server/dal/requests';
import { getTask } from '@/server/dal/tasks';
import { decideResourceRequestAction } from '@/features/myapprovals/actions';
import { nameSourcedPersonAction } from '@/features/mywork/actions';
import { acceptRescheduleAction, approveRequestAction } from './actions';

const as = (role: string) => {
  session.role = role;
};
const sourcingNotices = async (role: string, task: string) => (await listNotifications(role)).filter((n) => n.title === `Person to find and name · ${task}`);
const newContractRequest = (title: string) =>
  createResourceRequest({ projectCode: 'HLT-026', title, activityCode: 'A1250', contractRole: 'Contract welder', priority: 'med', hours: 24 }, 'Romain Aubert');

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.lang = 'en';
});

describe('R-089 — procurement gets My work (P-8b)', () => {
  it('My work and the task sheet are in procurement’s workspace', () => {
    expect([canSee('procurement', 'mywork'), canSee('procurement', 'task'), isOutside('procurement', 'task')]).toEqual([true, true, false]);
  });

  it('candidates: existing people only — the resource pool first, never a client contact or a contract-role placeholder', async () => {
    const c = await listSourcingCandidates();
    expect(c.length).toBeGreaterThan(0);
    const firstOutside = c.findIndex((x) => !x.pool);
    expect(c.slice(0, firstOutside < 0 ? c.length : firstOutside).every((x) => x.pool)).toBe(true);
    expect(c.map((x) => x.name)).toContain('Julien Wagner');
    expect(c.map((x) => x.name)).not.toContain('Nadia Bensaïd');
    expect(c.some((x) => /^Contract /.test(x.name))).toBe(false);
  });
});

describe('R-089 — the sourcing task goes to procurement', () => {
  let task = '';
  it('Approvals: RQ-043 (contract structural engineer) → "Find and name" task for F. Bertrand, procurement told, audited', async () => {
    as('depthead');
    const r = await approveRequestAction('RQ-043');
    expect(r).toMatchObject({ ok: true, number: expect.stringMatching(/^T-\d+$/) });
    task = (r as { number: string }).number;
    const t = (await getTask(task))!;
    const rq = (await getResourceRequest('RQ-043'))!;
    expect([t.assignee, t.title, t.contractRole, t.estimateH, t.start, t.due, t.sourceRequest]).toEqual([
      'Fabien Bertrand', 'Find and name: Contract structural engineer — Steel connection checks — second crew', 'Contract structural engineer', 40, rq.start, rq.due, 'RQ-043',
    ]);
    expect(await sourcingNotices('procurement', task)).toHaveLength(1);
    const notice = (await sourcingNotices('procurement', task))[0];
    // Integration review: the due date is a field of its own (no English "due" before it), so the French bell translates it.
    expect(notice).toMatchObject({ kind: 'task', screen: 'task', params: { taskId: task }, sub: `Contract structural engineer · Steel connection checks — second crew · ${shortDateOfIso(rq.due)}` });
    const fr = fieldsText(notice.sub, makeT('fr'), 'fr');
    expect(fr.endsWith(` · ${makeT('fr')(shortDateOfIso(rq.due))}`)).toBe(true);
    expect(fr).not.toMatch(/\bdue\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
    expect((await listNotifications('pm'))[0]).toMatchObject({ title: 'Resource request approved' });
    expect((await listAudit({ limit: 20 })).find((a) => a.object === 'Request RQ-043')).toMatchObject({ change: 'approved → task created for Procurement' });
    expect((await listActivity({ limit: 20 })).find((a) => a.what.startsWith('Approved resource request RQ-043'))!.what).toMatch(/· task created for Procurement$/);
  });

  it('My approvals reaches the same path; with no procurement user the director gets the task', async () => {
    const db = await getDb();
    const rq = await newContractRequest('Welding of the gantry rails');
    await db.update(users).set({ active: false }).where(eq(users.personaRole, 'procurement'));
    as('depthead');
    const r = await decideResourceRequestAction({ number: rq, decision: 'ok' });
    await db.update(users).set({ active: true }).where(eq(users.personaRole, 'procurement'));
    expect(r.ok).toBe(true);
    const n = (await getResourceRequest(rq))!.taskId!;
    expect((await getTask(n))!.assignee).toBe('Marie Lefebvre');
    // Integration review (R-015): the director standing in for procurement is told about the task, like any assignee.
    expect((await listNotifications('director')).filter((x) => x.title === `Task assigned · ${n}`)).toMatchObject([
      { kind: 'task', screen: 'task', params: { taskId: n }, sub: 'Find and name: Contract welder — Welding of the gantry rails' },
    ]);
    expect(await sourcingNotices('procurement', n)).toHaveLength(0);
  });

  it('accept reschedule: the PM accepts → the sourcing task goes to procurement (the PM is the actor, not told)', async () => {
    const rq = await newContractRequest('Hot work supervision');
    await proposeReschedule(rq, 1, '', 'Marion Kerviel');
    as('pm');
    const pmBefore = (await listNotifications('pm')).length;
    const r = await acceptRescheduleAction(rq);
    expect(r.ok).toBe(true);
    const n = (r as { number: string }).number;
    expect((await getTask(n))!).toMatchObject({ assignee: 'Fabien Bertrand', title: 'Find and name: Contract welder — Hot work supervision', contractRole: 'Contract welder' });
    expect(await sourcingNotices('procurement', n)).toHaveLength(1);
    expect((await listNotifications('pm')).length).toBe(pmBefore);
  });

  it('"Name the person": every persona — only procurement and the director; the client never reaches the task sheet', async () => {
    for (const p of PERSONAS) {
      as(p.role);
      if (p.role === 'client') {
        await expect(nameSourcedPersonAction({ taskId: task, person: 'Julien Wagner' })).rejects.toThrow('REDIRECT');
        continue;
      }
      if (p.role === 'procurement' || p.role === 'director') continue;
      const r = await nameSourcedPersonAction({ taskId: task, person: 'Julien Wagner' });
      expect(r.ok, p.role).toBe(false);
      expect(['Read-only — outside my workspace', 'Only procurement or the portfolio director can name the person'], p.role).toContain((r as { error: string }).error);
    }
    expect((await getTask(task))!.contractRole).toBe('Contract structural engineer');
  });

  it('malformed input and unknown people refused; the writer re-checks the actor’s role', async () => {
    as('procurement');
    for (const taskId of ['', 'T-', 'nope', 42]) expect((await nameSourcedPersonAction({ taskId: taskId as string, person: 'Julien Wagner' })).ok).toBe(false);
    for (const person of ['', 'Nobody Here', 'Nadia Bensaïd', 42])
      expect(await nameSourcedPersonAction({ taskId: task, person: person as string })).toEqual({ ok: false, error: 'Choose a person known to Keystone' });
    await expect(nameSourcedPerson(task, 'Julien Wagner', 'Romain Aubert')).rejects.toThrow('Only procurement or the portfolio director can name the person');
    // A task that is not a sourcing task.
    expect(await nameSourcedPersonAction({ taskId: 'T-2314', person: 'Julien Wagner' })).toEqual({ ok: false, error: 'This task already names its person' });
  });

  it('procurement names J. Wagner: the same task goes to him, the request names him, PM and person told; a second naming is stale', async () => {
    as('procurement');
    const memberBefore = (await listNotifications('member')).length;
    expect(await nameSourcedPersonAction({ taskId: task, person: 'Julien Wagner' })).toEqual({ ok: true });
    expect((await getTask(task))!).toMatchObject({ assignee: 'Julien Wagner', contractRole: null, title: 'Steel connection checks — second crew', sourceRequest: 'RQ-043' });
    const rq = (await getResourceRequest('RQ-043'))!;
    expect([rq.person, rq.contractRole, rq.events.at(-1)!.action, rq.events.at(-1)!.note]).toEqual(['Julien Wagner', 'Contract structural engineer', 'named', 'Julien Wagner']);
    expect((await listNotifications('pm'))[0]).toMatchObject({ kind: 'request', title: 'Person named · RQ-043', sub: `Julien Wagner · ${task}` });
    expect((await listNotifications('member')).length).toBe(memberBefore + 1);
    expect((await listNotifications('member'))[0]).toMatchObject({ title: `Task assigned · ${task}` });
    expect((await listAudit({ limit: 10 })).find((a) => a.object === task)).toMatchObject({ who: 'Fabien Bertrand', change: 'named: Julien Wagner · Contract structural engineer · RQ-043' });
    expect(await nameSourcedPersonAction({ taskId: task, person: 'Hélène Sauvage' })).toEqual({ ok: false, error: 'This task already names its person' });
    // My work errors are English source strings, translated by the sheet (t).
    expect(makeT('fr')('This task already names its person')).toBe('Cette tâche nomme déjà sa personne');
  });

  it('the director names on a sourcing task too', async () => {
    const db = await getDb();
    const rq = await newContractRequest('Bolt torque audit');
    as('depthead');
    const r = await approveRequestAction(rq);
    const n = (r as { number: string }).number;
    as('director');
    expect(await nameSourcedPersonAction({ taskId: n, person: 'Hélène Sauvage' })).toEqual({ ok: true });
    expect((await getTask(n))!.assignee).toBe('Hélène Sauvage');
    expect((await db.select().from(users).where(and(eq(users.personaRole, 'procurement'), eq(users.active, true)))).length).toBe(1);
  });
});
