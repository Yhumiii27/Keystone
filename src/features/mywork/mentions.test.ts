// R-149 (R-8b a): @mentions in task comments on the seeded in-memory DB — the people mentioned with an active internal
// account get one unread bell notification opening the task, after the comment is committed; never the author, a client or
// an unknown name; the audit names them; every persona's comment gate; the task sheet highlights the mentions.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const state = { role: 'member' as RoleKey, lang: 'en' as 'fr' | 'en' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/my/tasks',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error('404');
  },
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: state.lang, t: makeT(state.lang) }) };
});
vi.mock('@/server/project-context', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  const { isOutside } = await import('@/components/app/shell/nav-model');
  return {
    getScreenAccess: async (screen: 'mywork' | 'task') => {
      const outside = isOutside(state.role, screen);
      return { viewer: PERSONA_BY_ROLE[state.role], outside, canEdit: !outside };
    },
  };
});
vi.mock('@/components/app/shell/page-header', async () => {
  const { createElement } = await import('react');
  return { PageHeader: ({ primary }: { primary?: unknown }) => createElement('header', null, primary as never) };
});

import { and, eq } from 'drizzle-orm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskPage from '@/app/(app)/my/tasks/[taskId]/page';
import { isOutside } from '@/components/app/shell/nav-model';
import { PERSONAS } from '@/config/personas';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { auditEntries } from '@/server/db/schema';
import { openDatabase } from '@/server/db/open';
import { listNotifications } from '@/server/dal/notifications';
import { listMentionablePersons } from '@/server/dal/task-notices';
import { getTask } from '@/server/dal/tasks';
import { addTaskCommentAction } from './actions';

const OUTSIDE = 'Read-only — outside my workspace';
const as = (role: RoleKey) => {
  state.role = role;
};
const mentionsOf = async (role: string, taskId: string) => (await listNotifications(role)).filter((n) => n.kind === 'mention' && n.title === `@you in ${taskId}`);
const auditOf = async (taskId: string) =>
  (await (await getDb()).select().from(auditEntries).where(and(eq(auditEntries.objectRef, taskId), eq(auditEntries.area, 'Tasks')))).map((a) => [a.actorName, a.change]);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-149 — @mentions in task comments', () => {
  it('mentionable: the internal personas with an active account (never the client)', async () => {
    const names = (await listMentionablePersons()).map((p) => p.fullName);
    for (const p of PERSONAS.filter((x) => x.role !== 'client')) expect(names).toContain(p.name);
    expect(names).not.toContain('Nadia Bensaïd');
  });

  it('the person mentioned gets exactly one unread mention opening the task; author, client and unknown names get nothing', async () => {
    as('member'); // Julien Wagner, on his own task
    const before = { director: (await listNotifications('director')).length, member: (await listNotifications('member')).length, client: (await listNotifications('client')).length };
    const text = '@marie lefebvre can you confirm the crane slot? cc @J. Wagner @N. Bensaïd @Nobody Here mail x@M. Lefebvre';
    expect(await addTaskCommentAction({ taskId: 'T-2305', text })).toEqual({ ok: true });
    const m = await mentionsOf('director', 'T-2305');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      kind: 'mention', read: false, screen: 'task', params: { taskId: 'T-2305' }, projectCode: 'HLT-026',
      sub: '“@marie lefebvre can you confirm the crane slot? cc @J. Wagner @N. Bensaïd @Nobody Here mail x@M. Lefebvre” · Julien Wagner',
    });
    expect((await listNotifications('director')).length).toBe(before.director + 1);
    expect((await listNotifications('member')).length).toBe(before.member); // the author
    expect((await listNotifications('client')).length).toBe(before.client); // a client is never mentionable
    // The comment is there, as typed; one audit line names the people told.
    expect((await getTask('T-2305'))!.comments.at(-1)).toMatchObject({ author: 'Julien Wagner', text });
    expect((await auditOf('T-2305')).slice(-2)).toEqual([
      ['Julien Wagner', 'comment posted'],
      ['Julien Wagner', 'mentioned: Marie Lefebvre'],
    ]);
  });

  it('a name typed twice, short and full, tells the person once; no mention → no notification and no audit line', async () => {
    as('director');
    expect(await addTaskCommentAction({ taskId: 'T-2305', text: '@Julien Wagner and again @J. WAGNER' })).toEqual({ ok: true });
    expect(await mentionsOf('member', 'T-2305')).toHaveLength(1);
    const audits = (await auditOf('T-2305')).length;
    const notifs = (await listNotifications('member')).length;
    expect(await addTaskCommentAction({ taskId: 'T-2305', text: 'No mention here, @' })).toEqual({ ok: true });
    expect((await auditOf('T-2305')).length).toBe(audits + 1);
    expect((await listNotifications('member')).length).toBe(notifs);
  });

  it('the French title: "@vous dans T-2305"', () => {
    expect(makeT('fr')('@you in T-2305')).toBe('@vous dans T-2305');
    expect(makeT('fr')('Task assigned · T-2341')).toBe('Tâche assignée · T-2341');
  });

  it('every persona: inside the workspace the comment is posted, outside it is refused and nobody is told', async () => {
    for (const p of PERSONAS) {
      as(p.role);
      const notifs = (await listNotifications('director')).length;
      const r = await addTaskCommentAction({ taskId: 'T-2314', text: `@M. Lefebvre from ${p.role}` });
      if (isOutside(p.role, 'task')) {
        expect(r, p.role).toEqual({ ok: false, error: OUTSIDE });
        expect((await listNotifications('director')).length, p.role).toBe(notifs);
      } else {
        expect(r, p.role).toEqual({ ok: true });
        // The director never mentions themself.
        expect((await listNotifications('director')).length, p.role).toBe(notifs + (p.role === 'director' ? 0 : 1));
      }
    }
  });

  it('malformed input: unknown task, empty or non-string text', async () => {
    as('member');
    for (const taskId of ['', 'T-', 'T-99999', 42]) expect(await addTaskCommentAction({ taskId: taskId as string, text: '@M. Lefebvre' })).toMatchObject({ ok: false });
    expect(await addTaskCommentAction({ taskId: 'T-2305', text: '   ' })).toEqual({ ok: false, error: 'Write a comment first' });
    expect(await addTaskCommentAction({ taskId: 'T-2305', text: 42 as never })).toEqual({ ok: false, error: 'Write a comment first' });
  });

  it('the task sheet highlights the mentions and still renders', async () => {
    as('member');
    state.lang = 'en';
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'en', children: (await TaskPage({ params: Promise.resolve({ taskId: 'T-2305' }) })) as never }));
    expect(html).toMatch(/<span class="[^"]*mention[^"]*">@marie lefebvre<\/span>/);
    expect(html).toMatch(/<span class="[^"]*mention[^"]*">@J\. Wagner<\/span>/);
    expect(html).not.toMatch(/<span class="[^"]*mention[^"]*">@Nobody/);
    expect(html).toContain('Write a comment… @mention to notify');
  });
});
