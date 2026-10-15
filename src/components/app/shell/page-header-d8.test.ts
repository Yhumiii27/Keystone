// Delivery 8 (lot roles-rates-hr): the page header's rights for the Finance persona and the Contract (R-044: P-4, Finance read-only on
// Budget, Hours and Billing) and the "View as client" entry with the portal's preview banner (R-139: P-11 a). PageHeader is the
// real Server Component rendered over the seeded in-memory database; the session cookies and the client islands' actions are
// mocked.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/HLT-026/plan', useRouter: () => ({ push() {}, refresh() {} }),
  redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('@/server/actions/preferences', () => ({ setNavOpen: async () => {}, setViewAs: async () => {}, setLanguage: async () => {}, setZone: async () => {} }));
vi.mock('./actions', () => ({ searchAction: async () => [], markNotificationReadAction: async () => {}, markAllNotificationsReadAction: async () => {} }));

import { and, eq } from 'drizzle-orm';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoleKey, ScreenId } from '@/config/screens';
import { I18nProvider } from '@/i18n/client';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { persons, projectMembers, projects } from '@/server/db/schema';
import { COOKIE } from '@/server/session';
import { PageHeader } from './page-header';
import { ShellProvider } from './shell-provider';

const as = (role: RoleKey, lang: 'en' | 'fr' = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const PRIMARY = h('button', { id: 'the-primary' }, 'Primary');

async function header(screen: ScreenId, code: string, lang: 'en' | 'fr' = 'en'): Promise<string> {
  const el = (await PageHeader({ screen, projectCode: code, primary: PRIMARY })) as ReactElement;
  const shell = h(ShellProvider, { initialProject: code, projectCodes: [code], children: el });
  return renderToStaticMarkup(h(I18nProvider, { lang, children: shell }));
}
const previewLink = (code: string) => `href="/projects/${code}/client"`;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-139 · "View as client" entry (P-11 a)', () => {
  it('shown on project screens for the director and the PM of record; hidden for the client and on the portal itself', async () => {
    as('director');
    expect(await header('plan', 'HLT-026')).toContain(previewLink('HLT-026'));
    expect(await header('budget', 'NDC-031')).toContain(previewLink('NDC-031'));
    as('pm');
    const pm = await header('plan', 'HLT-026');
    expect(pm).toContain(previewLink('HLT-026'));
    expect(pm).toContain('aria-label="View as client"');
    as('client');
    expect(await header('changes', 'HLT-026')).not.toContain('View as client');
    as('director');
    expect(await header('client', 'HLT-026')).not.toContain('aria-label="View as client"');
  });

  it('hidden for a team member, a PM off the project and the other roles; shown for a deputy (member role)', async () => {
    as('member');
    expect(await header('plan', 'HLT-026')).not.toContain('View as client');
    // Romain Aubert leads HLT-026 only.
    as('pm');
    const db = await getDb();
    const [romain] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Romain Aubert'));
    const led = await db.select({ code: projects.code }).from(projects).where(eq(projects.pmPersonId, romain.id));
    const other = (await db.select({ code: projects.code }).from(projects)).map((p) => p.code).find((c) => !led.some((l) => l.code === c) && c !== 'HLT-026')!;
    expect(await header('plan', other)).not.toContain('View as client');
    for (const role of ['quality', 'englead', 'procurement', 'finance', 'depthead'] as RoleKey[]) {
      as(role);
      expect([role, (await header('plan', 'HLT-026')).includes('View as client')]).toEqual([role, false]);
    }
    // A deputy PM whose role is "member" leads the project: the entry is theirs too.
    const [julien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const where = and(eq(projectMembers.projectId, p.id), eq(projectMembers.personId, julien.id));
    const [before] = await db.select({ role: projectMembers.projectRole }).from(projectMembers).where(where);
    await db.update(projectMembers).set({ projectRole: 'deputy' }).where(where);
    try {
      as('member');
      expect(await header('plan', 'HLT-026')).toContain(previewLink('HLT-026'));
    } finally {
      await db.update(projectMembers).set({ projectRole: before.role }).where(where);
    }
  });

  it('the portal: "Client view · preview · read-only" with "Back to project" replaces the outside banner for the director and the PM', async () => {
    for (const role of ['director', 'pm'] as RoleKey[]) {
      as(role);
      const out = await header('client', 'HLT-026');
      expect(out).toContain('Client view · preview · read-only');
      expect(out).toContain('href="/projects/HLT-026/plan"');
      expect(out).toContain('Back to project');
      expect(out).not.toContain('Outside my workspace');
    }
    // The PM stays outside on the portal: no primary action (the decisions stay the client's).
    as('pm');
    expect(await header('client', 'HLT-026')).not.toContain('the-primary');
    as('director');
    expect(await header('client', 'HLT-026')).toContain('the-primary');
    // Other internal roles keep the read-only outside view (P-1 = a).
    as('quality');
    const q = await header('client', 'HLT-026');
    expect(q).toContain('Outside my workspace');
    expect(q).not.toContain('Client view · preview');
    as('pm', 'fr');
    const fr = await header('client', 'HLT-026', 'fr');
    expect(fr).toContain('Vue client · aperçu · lecture seule');
    expect(fr).toContain('Retour au projet');
  });
});

describe('R-044 · Finance and the Contract in the header (P-4)', () => {
  it('Finance edits the Contract of a project whose team it is not on (RCF-019: primary shown, no Read-only tag), reads its other screens', async () => {
    as('finance');
    const out = await header('contract', 'RCF-019');
    expect(out).toContain('the-primary');
    expect(out).not.toContain('Read-only');
    expect(out).not.toContain('Outside my workspace');
    const plan = await header('plan', 'RCF-019');
    expect([plan.includes('the-primary'), plan.includes('Read-only')]).toEqual([false, true]);
  });

  it('Finance reads Budget, Hours and Billing, even on its own teams (HLT-026, NDC-031): no primary, Read-only tag', async () => {
    as('finance');
    for (const screen of ['budget', 'hours', 'billing'] as ScreenId[])
      for (const code of ['HLT-026', 'NDC-031', 'RCF-019']) {
        const out = await header(screen, code);
        expect([screen, code, out.includes('the-primary'), out.includes('Read-only')]).toEqual([screen, code, false, true]);
      }
    // Its own work on a team project stays editable (P-9a plan pattern): Meetings on NDC-031.
    const meetings = await header('meetings', 'NDC-031');
    expect([meetings.includes('the-primary'), meetings.includes('Read-only')]).toEqual([true, false]);
  });

  it('procurement no longer has the Contract (outside, no primary); a PM-role viewer off the team reads it', async () => {
    as('procurement');
    const out = await header('contract', 'HLT-026');
    expect(out).toContain('Outside my workspace');
    expect(out).not.toContain('the-primary');
    as('pm');
    expect(await header('contract', 'HLT-026')).toContain('the-primary');
    const off = await header('contract', 'NDC-031');
    expect([off.includes('the-primary'), off.includes('Read-only')]).toEqual([false, true]);
  });
});
