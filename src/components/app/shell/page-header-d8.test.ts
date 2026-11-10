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

import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoleKey, ScreenId } from '@/config/screens';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
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

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('D9-06 · no "View as client" entry any more (R-139 removed)', () => {
  it('the director and the PM of record get no client preview on the project screens', async () => {
    for (const role of ['director', 'pm'] as RoleKey[]) {
      as(role);
      const out = await header('plan', 'HLT-026');
      expect([role, out.includes('View as client'), out.includes('/projects/HLT-026/client')]).toEqual([role, false, false]);
    }
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
