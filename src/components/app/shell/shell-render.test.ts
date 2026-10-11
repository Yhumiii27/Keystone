// Render smoke test of the shell client islands (static markup, mocked router and server actions).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/NDC-031/budget', useRouter: () => ({ push() {}, refresh() {} }), redirect() {}, notFound() {} }));
vi.mock('@/server/actions/preferences', () => ({ setNavOpen: async () => {}, setViewAs: async () => {}, setLanguage: async () => {}, setZone: async () => {} }));
vi.mock('./actions', () => ({ searchAction: async () => [], markNotificationReadAction: async () => {}, markAllNotificationsReadAction: async () => {} }));
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONAS } from '@/config/personas';
import { I18nProvider } from '@/i18n/client';
import { getShellNav } from '@/server/dal/shell';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { ExportButton, GlobalSearch, LangToggle, Notifications, ZoneSeg } from './header-islands';
import { NavToggle } from './nav-toggle';
import { ShellProvider } from './shell-provider';
import { Sidebar } from './sidebar';

describe('shell islands render', () => {
  // Fresh seeded in-memory database: never open the app's ./.data PGlite (it may be in use by a running server).
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('sidebar follows the URL project and translates to FR', async () => {
    const nav = await getShellNav('pm');
    const islands = [
      h(Sidebar, { key: 's', role: 'pm', personas: PERSONAS, navOpen: {}, zoneLabel: 'Africa', projects: nav.projects, globalBadges: nav.globalBadges, projectBadges: nav.projectBadges }),
      h(Notifications, { key: 'n', items: [{ id: 'n1', kind: 'approval', title: 'T', sub: 'S', when: 'W', read: false, href: '/x' }], role: 'pm' }),
      h(GlobalSearch, { key: 'g' }),
      h(LangToggle, { key: 'l', lang: 'fr' }),
      h(ExportButton, { key: 'e' }),
      h(ZoneSeg, { key: 'z', zone: null, options: [{ key: null, label: 'Toutes zones', count: 17 }, { key: 'afr', label: 'Afrique', count: 3 }] }),
    ];
    const shell = h(ShellProvider, { initialProject: 'HLT-026', projectCodes: nav.projects.map((p) => p.code), children: islands });
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: shell }));
    expect(html).toContain('#031 · Rénovation du data center Northgate');
    expect(html).toMatch(/aria-current="page" href="\/projects\/NDC-031\/budget"/);
    expect(html).toContain('href="/projects/NDC-031/documents"');
    expect(html).toContain('Aller à une page…');
    expect(html).toContain('Romain Aubert');
  });

  it('tablet layout (R-146): the menu button controls the sidebar drawer, closed on first render', async () => {
    const nav = await getShellNav('pm');
    const islands = [
      h(NavToggle, { key: 't' }),
      h(Sidebar, { key: 's', role: 'pm', personas: PERSONAS, navOpen: {}, zoneLabel: '', projects: nav.projects, globalBadges: nav.globalBadges, projectBadges: nav.projectBadges }),
    ];
    const shell = h(ShellProvider, { initialProject: 'HLT-026', projectCodes: nav.projects.map((p) => p.code), children: islands });
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'fr', children: shell }));
    expect(html).toMatch(/<button id="ks-nav-toggle" type="button" class="btn btn-secondary[^"]*" aria-controls="ks-sidebar" aria-expanded="false">/);
    expect(html).toContain('<span>Menu</span>');
    expect(html).toMatch(/<aside id="ks-sidebar" class="[^"]*" aria-label="Menu principal">/);
    expect(html).toContain('aria-label="Fermer le menu"');
    expect(html).toMatch(/<div class="[^"]*" aria-hidden="true"><\/div><aside/);
  });
});
