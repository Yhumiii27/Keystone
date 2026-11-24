// App shell: Norma 2.0's common shell (norma/charte/COQUE.md § 1, § 8) — the charte's AppShell: 232 px sidebar | main,
// radial accent background, skip link; up to 1024 px (tablet layout, R-146) one column with the top bar (menu button,
// tool name, bell, language / display pair) whose menu button opens the sidebar as a drawer.
// Demo mode: the "View as" switcher at the bottom of the sidebar; Entra mode (R-038): the signed-in user's account
// menu (active role, sign out) instead.
import { AppShell } from '@norma/charte/ds/AppShell';
import { PERSONAS } from '@/config/personas';
import { ToastProvider } from '@/components/ds/Toast';
import { ClockProvider } from '@/components/app/clock';
import { shellBell } from '@/components/app/shell/bell';
import { KeystonePrefs } from '@/components/app/shell/prefs';
import { Sidebar } from '@/components/app/shell/sidebar';
import { ShellProvider } from '@/components/app/shell/shell-provider';
import { KeystoneTopBar } from '@/components/app/shell/topbar';
import { ROLE_LABEL } from '@/domain/auth';
import { authMode } from '@/server/auth/config';
import { businessToday } from '@/server/clock';
import { getShellNav, zoneLabel } from '@/server/dal/shell';
import { getI18n, getLastProject, getNavOpen, getTheme, getViewer, getZone } from '@/server/session';
import { FocusKeeper } from '@/components/app/shell/focus-keeper';

/** Id of AppShell's <main> (MAIN_ID of the charte, a client module): the skip link's target and the focus keeper's fallback (R-183). */
const MAIN_ID = 'main-content';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const viewer = await getViewer();
  const [navOpen, lastProject, zone, nav, today, { lang }, theme] = await Promise.all([getNavOpen(), getLastProject(), getZone(), getShellNav(viewer), businessToday(), getI18n(), getTheme()]);
  const [zoneName, bell] = await Promise.all([zoneLabel(zone), shellBell()]);
  const codes = nav.projects.map((p) => p.code);
  const entra = authMode() === 'entra';
  return (
    <ClockProvider today={today}>
      <ShellProvider initialProject={codes.includes(lastProject) ? lastProject : codes[0]} projectCodes={codes}>
        {/* DS toast (docs/spec/01 §9): its live region renders after the grid, outside <main>'s flex gap. */}
        <ToastProvider>
          {/* R-183 (WCAG 2.4.1): the skip link (first stop of the keyboard) and <main id="main-content"> come from AppShell. */}
          <AppShell
            sidebar={
              <Sidebar
                role={viewer.role}
                personas={entra ? [] : PERSONAS.map(({ role, name, title, initials }) => ({ role, name, title, initials }))}
                account={
                  entra
                    ? { name: viewer.name, title: viewer.title, initials: viewer.initials, role: viewer.role, roles: viewer.roles.map((r) => ({ role: r, label: ROLE_LABEL[r] })) }
                    : null
                }
                navOpen={navOpen}
                zoneLabel={zoneName}
                projects={nav.projects.map(({ code, label }) => ({ code, label }))}
                globalBadges={nav.globalBadges}
                projectBadges={nav.projectBadges}
              />
            }
            topbar={
              <>
                <FocusKeeper fallbackId={MAIN_ID} />
                <KeystoneTopBar bell={bell} prefs={<KeystonePrefs lang={lang} theme={theme} />} />
              </>
            }
          >
            {children}
          </AppShell>
        </ToastProvider>
      </ShellProvider>
    </ClockProvider>
  );
}
