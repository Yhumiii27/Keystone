// App shell (docs/spec/01 §2): 232px sidebar | main, radial accent background. Owned by the shell.
// Demo mode: the "View as" switcher at the bottom of the sidebar; Entra mode (R-038): the signed-in user's account
// menu (active role, sign out) instead.
import { PERSONAS } from '@/config/personas';
import { ToastProvider } from '@/components/ds/Toast';
import { Sidebar } from '@/components/app/shell/sidebar';
import { ShellProvider } from '@/components/app/shell/shell-provider';
import styles from '@/components/app/shell/shell.module.css';
import { ROLE_LABEL } from '@/domain/auth';
import { authMode } from '@/server/auth/config';
import { getShellNav, zoneLabel } from '@/server/dal/shell';
import { getLastProject, getNavOpen, getViewer, getZone } from '@/server/session';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const viewer = await getViewer();
  const [navOpen, lastProject, zone, nav] = await Promise.all([getNavOpen(), getLastProject(), getZone(), getShellNav(viewer)]);
  const codes = nav.projects.map((p) => p.code);
  const entra = authMode() === 'entra';
  return (
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
            zoneLabel={zoneLabel(zone)}
            projects={nav.projects.map(({ code, label }) => ({ code, label }))}
            globalBadges={nav.globalBadges}
            projectBadges={nav.projectBadges}
          />
          <main className={styles.main}>{children}</main>
        </div>
      </ToastProvider>
    </ShellProvider>
  );
}
