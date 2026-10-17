// App shell (docs/spec/01 §2): 232px sidebar | main, radial accent background. Owned by the shell.
// Demo mode: the "View as" switcher at the bottom of the sidebar; Entra mode (R-038): the signed-in user's account
// menu (active role, sign out) instead.
// Tablet layout (R-146): up to 1024 px, one column with a top bar whose menu button opens the sidebar as a drawer.
import { PERSONAS } from '@/config/personas';
import { ToastProvider } from '@/components/ds/Toast';
import { ClockProvider } from '@/components/app/clock';
import { NavToggle } from '@/components/app/shell/nav-toggle';
import { Sidebar } from '@/components/app/shell/sidebar';
import { ShellProvider } from '@/components/app/shell/shell-provider';
import styles from '@/components/app/shell/shell.module.css';
import { ROLE_LABEL } from '@/domain/auth';
import { authMode } from '@/server/auth/config';
import { businessToday } from '@/server/clock';
import { getShellNav, zoneLabel } from '@/server/dal/shell';
import { getLastProject, getNavOpen, getViewer, getZone } from '@/server/session';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const viewer = await getViewer();
  const [navOpen, lastProject, zone, nav, today] = await Promise.all([getNavOpen(), getLastProject(), getZone(), getShellNav(viewer), businessToday()]);
  const zoneName = await zoneLabel(zone);
  const codes = nav.projects.map((p) => p.code);
  const entra = authMode() === 'entra';
  return (
    <ClockProvider today={today}>
      <ShellProvider initialProject={codes.includes(lastProject) ? lastProject : codes[0]} projectCodes={codes}>
        {/* DS toast (docs/spec/01 §9): its live region renders after the grid, outside <main>'s flex gap. */}
        <ToastProvider>
          <div className={styles.root}>
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
            <main className={styles.main}>
              <NavToggle />
              {children}
            </main>
          </div>
        </ToastProvider>
      </ShellProvider>
    </ClockProvider>
  );
}
