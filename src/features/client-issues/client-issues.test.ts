// R-137 (L-6: client issues taken in charge by the project manager, answered, closed; the client is told of the answer and
// of the closure). Pure rules, then the whole cycle on the seeded in-memory database with the real project context: the
// client raises an issue in the portal → the PM is notified → Take in charge → Answer (the client is notified and sees it
// in the portal) → Close (notified); rights of the 8 personas, a PM on another project, stale rows, answers required, the
// audit trail, the card's view model and the Stakeholders page (the client is sent home, R-042).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
    getZone: async () => null,
    getNavOpen: async () => ({}),
  };
});

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import StakeholdersPage from '@/app/(app)/projects/[code]/stakeholders/page';
import { ISSUE_ACKNOWLEDGEMENT, hasRealAnswer, issueSteps, parseIssueAnswer } from '@/domain/client-issues';
import { raiseClientIssueAction } from '@/features/rexclient/actions';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getClientPortal, handleClientIssue, listClientIssuesForTeam } from '@/server/dal/client';
import { listAudit, listNotifications } from '@/server/dal/notifications';
import { answerClientIssueAction, closeClientIssueAction, takeClientIssueAction } from './actions';
import { clientIssuesView } from './model';

const HLT = 'HLT-026';
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'] as const;
const issue = async (n: string, code = HLT) => (await listClientIssuesForTeam(code)).find((i) => i.number === n)!;
const topNotification = async (role: string) => (await listNotifications(role))[0];

describe('R-137 rules', () => {
  it('steps per status and the real answer', () => {
    expect([issueSteps('open'), issueSteps('in_progress'), issueSteps('closed')]).toEqual([['take', 'answer', 'close'], ['answer', 'close'], []]);
    expect([hasRealAnswer(ISSUE_ACKNOWLEDGEMENT), hasRealAnswer(' '), hasRealAnswer(null), hasRealAnswer('Laydown moved')]).toEqual([false, false, false, true]);
  });

  it('parses the answer', () => {
    expect(parseIssueAnswer(' Photos every Friday ', true)).toEqual({ ok: true, value: 'Photos every Friday' });
    expect(parseIssueAnswer('', false)).toEqual({ ok: true, value: null });
    expect(parseIssueAnswer('', true)).toEqual({ ok: false, error: 'Write the answer to the client' });
    expect(parseIssueAnswer(ISSUE_ACKNOWLEDGEMENT, false)).toEqual({ ok: false, error: 'Write the answer to the client' });
    expect(parseIssueAnswer('x'.repeat(2001), true)).toEqual({ ok: false, error: 'The answer is too long' });
    expect(parseIssueAnswer(42, true)).toEqual({ ok: false, error: 'Write the answer to the client' });
  });
});

describe('R-137 handling', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    session.role = 'director';
    session.lang = 'en';
  });

  it('the client raises an issue: the project manager is notified with a link to the issue', async () => {
    session.role = 'client';
    expect(await raiseClientIssueAction(HLT, 'Weekly crane test schedule')).toEqual({ ok: true, number: 'CI-08' });
    const n = await topNotification('pm');
    expect([n.title, n.sub, n.screen, n.params, n.projectCode, n.read]).toEqual(['Client issue raised', 'CI-08 · Weekly crane test schedule', 'stakeholders', { issue: 'CI-08' }, HLT, false]);
    // Only the PM of the project is told (the director and the client are not).
    expect((await topNotification('director'))?.sub).not.toBe('CI-08 · Weekly crane test schedule');
    expect(await issue('CI-08')).toMatchObject({ status: 'open', response: ISSUE_ACKNOWLEDGEMENT, answered: false, handledBy: null, steps: ['take', 'answer', 'close'] });
  });

  it('rights for the 8 personas: the project’s PM and the director only; nothing written otherwise', async () => {
    const outcome: Record<string, string> = {};
    for (const role of ROLES) {
      session.role = role;
      const r = await takeClientIssueAction(HLT, 'CI-07', 'open');
      outcome[role] = r.ok ? 'ok' : r.error;
      if (r.ok) break; // the director took it: the others would see a stale row
    }
    expect(outcome).toEqual({ director: 'ok' });
    // Reset to Open for the next roles is not possible (no step back): check the others on CI-08 instead.
    const others: Record<string, string> = {};
    for (const role of ROLES.filter((r) => r !== 'director' && r !== 'pm')) {
      session.role = role;
      // R-042: the client is sent home from the Stakeholders screen (outside their workspace).
      const r = await takeClientIssueAction(HLT, 'CI-08', 'open').catch((e: Error) => ({ ok: false as const, error: e.message }));
      others[role] = r.ok ? 'ok' : r.error;
    }
    expect(others).toEqual({
      depthead: 'Client issues are read-only for you', member: 'Client issues are read-only for you', englead: 'Client issues are read-only for you',
      quality: 'Client issues are read-only for you', procurement: 'Client issues are read-only for you', client: 'REDIRECT /',
    });
    expect((await issue('CI-08')).status).toBe('open');
    // The data layer re-checks role and ownership.
    await expect(handleClientIssue(HLT, 'CI-08', { step: 'take' }, { name: 'Gabriel Comte', role: 'quality' })).rejects.toThrow(/Only the project manager/);
    await expect(handleClientIssue('NDC-031', 'CI-01', { step: 'take' }, { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow(/Only the project manager|Unknown issue/);
  });

  it('Take in charge → Answer (client notified, portal shows it) → Close (client notified); stale and empty answers refused', async () => {
    session.role = 'pm';
    // Malformed and stale requests.
    expect(await takeClientIssueAction(HLT, 'X-1', 'open')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await takeClientIssueAction(HLT, 'CI-08', 'Open')).toEqual({ ok: false, error: 'Invalid request' });
    expect(await takeClientIssueAction(HLT, 'CI-99', 'open')).toEqual({ ok: false, error: 'Unknown issue' });
    expect(await takeClientIssueAction(HLT, 'CI-08', 'in_progress')).toEqual({ ok: false, error: 'This issue has changed since you opened it' });
    // Closing an issue that was never answered needs an answer.
    expect(await closeClientIssueAction(HLT, 'CI-08', 'open', { answer: '' })).toEqual({ error: 'Write the answer to the client' });

    expect(await takeClientIssueAction(HLT, 'CI-08', 'open')).toEqual({ ok: true, toast: 'CI-08 · Issue taken in charge' });
    expect(await issue('CI-08')).toMatchObject({ status: 'in_progress', handledBy: 'Romain Aubert', takenOn: '2026-09-30', answered: false, steps: ['answer', 'close'] });
    expect(await takeClientIssueAction(HLT, 'CI-08', 'open')).toEqual({ ok: false, error: 'This issue has changed since you opened it' });

    expect(await answerClientIssueAction(HLT, 'CI-08', 'in_progress', { answer: ' ' })).toEqual({ error: 'Write the answer to the client' });
    expect(await answerClientIssueAction(HLT, 'CI-08', 'in_progress', { answer: 'Schedule sent every Friday from 2 Oct' })).toEqual({ toast: 'CI-08 · Answer sent to the client' });
    const n = await topNotification('client');
    expect([n.title, n.sub, n.screen, n.params]).toEqual(['Your issue was answered', 'CI-08 · Weekly crane test schedule', 'client', { tab: 'issues' }]);
    const portal = (await getClientPortal(HLT)).issues.find((i) => i.number === 'CI-08')!;
    expect([portal.status, portal.response, portal.answeredOn]).toEqual(['in_progress', 'Schedule sent every Friday from 2 Oct', '2026-09-30']);

    // Close without a new answer keeps the answer the client saw.
    session.lang = 'fr';
    expect(await closeClientIssueAction(HLT, 'CI-08', 'in_progress', { answer: '' })).toEqual({ toast: 'CI-08 · Point clos · le client est prévenu' });
    expect(await issue('CI-08')).toMatchObject({ status: 'closed', closedOn: '2026-09-30', response: 'Schedule sent every Friday from 2 Oct', steps: [] });
    expect((await topNotification('client')).title).toBe('Your issue was closed');
    expect(await answerClientIssueAction(HLT, 'CI-08', 'closed', { answer: 'x' })).toEqual({ error: 'Ce point a changé depuis son ouverture' });
    const [audit] = await listAudit({ projectCode: HLT, limit: 1 });
    expect([audit.who, audit.object, audit.area, audit.change]).toEqual(['Romain Aubert', 'CI-08', 'Client portal', 'closed · status: In progress → Closed']);

    // The director answers CI-07 (taken in charge earlier); answering an Open issue takes it in charge at the same time.
    session.role = 'director';
    session.lang = 'en';
    expect(await answerClientIssueAction(HLT, 'CI-07', 'in_progress', { answer: 'Photos added to the weekly report' })).toEqual({ toast: 'CI-07 · Answer sent to the client' });
    expect(await issue('CI-07')).toMatchObject({ status: 'in_progress', handledBy: 'Marie Lefebvre', response: 'Photos added to the weekly report' });
    session.role = 'client';
    expect(await raiseClientIssueAction(HLT, 'Gate pass for the crane supplier')).toEqual({ ok: true, number: 'CI-09' });
    session.role = 'pm';
    expect(await answerClientIssueAction(HLT, 'CI-09', 'open', { answer: 'Passes issued for 6 Oct' })).toEqual({ toast: 'CI-09 · Answer sent to the client' });
    expect(await issue('CI-09')).toMatchObject({ status: 'in_progress', handledBy: 'Romain Aubert', takenOn: '2026-09-30', answeredOn: '2026-09-30', answered: true });
  });

  it('a PM on another project is read-only there', async () => {
    session.role = 'pm';
    const other = (await listClientIssuesForTeam('NDC-031'))[0];
    if (other) expect(await takeClientIssueAction('NDC-031', other.number, other.status)).toEqual({ ok: false, error: 'Client issues are read-only for you' });
    expect(await takeClientIssueAction('NDC-031', 'CI-01', 'open')).toEqual({ ok: false, error: 'Client issues are read-only for you' });
  });

  it('card view model: steps for the handler only, answers and handling lines, highlight', async () => {
    const rows = await listClientIssuesForTeam(HLT);
    const v = clientIssuesView(rows, { canHandle: true, selected: 'CI-07' }, makeT('en'), 'en');
    const ci07 = v.rows.find((r) => r.number === 'CI-07')!;
    expect([ci07.selected, ci07.status, ci07.answer, ci07.answered, ci07.handling]).toEqual([true, 'In progress', 'Photos added to the weekly report', true, 'Taken in charge 30 Sep · Marie Lefebvre · Answered 30 Sep']);
    expect([ci07.actions!.take, ci07.actions!.answer!.label, ci07.actions!.close!.label, ci07.actions!.close!.form.fields[0].required]).toEqual([null, 'Answer', 'Close issue', false]);
    expect(ci07.actions!.answer!.form.fields[0].defaultValue).toBe('Photos added to the weekly report');
    const ci08 = v.rows.find((r) => r.number === 'CI-08')!;
    expect(ci08.actions).toBeNull();
    const fr = clientIssuesView(rows, { canHandle: false, selected: null }, makeT('fr'), 'fr');
    expect(fr.rows.every((r) => r.actions === null)).toBe(true);
    expect(fr.rows.find((r) => r.number === 'CI-08')!.status).toBe('Clôturée');
  });

  it('Stakeholders page: the card for internal viewers, editable for the PM and the director, none for the client', async () => {
    type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
    const card = async (role: string, code = HLT) => {
      session.role = role;
      const tree = (await StakeholdersPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve({ issue: 'ci-07' }) })) as El;
      const kids = (tree.props.children as unknown[]).filter((k): k is El => isValidElement(k) && typeof k.type === 'function' && (k.type as { name: string }).name === 'ClientIssuesCard');
      return kids[0]?.props.view as ReturnType<typeof clientIssuesView> | undefined;
    };
    const editable = async (role: string, code = HLT) => {
      const v = await card(role, code);
      return v ? v.rows.some((r) => r.actions) : null;
    };
    const out: Record<string, boolean | string | null> = {};
    for (const role of ROLES) out[role] = await editable(role).catch((e: Error) => e.message);
    // R-042: the client never reaches the Stakeholders screen (sent home).
    expect(out).toEqual({ director: true, pm: true, depthead: false, member: false, englead: false, quality: false, procurement: false, client: 'REDIRECT /' });
    expect((await card('pm'))!.rows.find((r) => r.number === 'CI-07')!.selected).toBe(true);
  });
});
