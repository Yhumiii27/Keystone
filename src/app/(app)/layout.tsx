// App shell (docs/spec/01 §2): 232px sidebar | main, radial accent background. Owned by the shell.
import { PERSONAS } from '@/config/personas';
import { ToastProvider } from '@/components/ds/Toast';
import { Sidebar } from '@/components/app/shell/sidebar';
import { ShellProvider } from '@/components/app/shell/shell-provider';
import styles from '@/components/app/shell/shell.module.css';
import { getShellNav, zoneLabel } from '@/server/dal/shell';
import { getLastProject, getNavOpen, getViewer, getZone } from '@/server/session';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const viewer = await getViewer();
  const [navOpen, lastProject, zone, nav] = await Promise.all([getNavOpen(), getLastProject(), getZone(), getShellNav(viewer.role)]);
  const zoneName = await zoneLabel(zone);
  const codes = nav.projects.map((p) => p.code);
  return (
    <ShellProvider initialProject={codes.includes(lastProject) ? lastProject : codes[0]} projectCodes={codes}>
      {/* DS toast (docs/spec/01 §9): its live region renders after the grid, outside <main>'s flex gap. */}
      <ToastProvider>
        <div className={styles.root}>
          <Sidebar
            role={viewer.role}
            personas={PERSONAS.map(({ role, name, title, initials }) => ({ role, name, title, initials }))}
            navOpen={navOpen}
            zoneLabel={zoneName}
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
