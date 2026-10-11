// Home (docs/spec/03 §1): role-specific landing page — greeting, 4 KPIs, two work queues.
import { PageHeader } from '@/components/app/shell/page-header';
import { HOME_PRIMARY_ROLES } from '@/domain/home';
import { HomeScreen } from '@/features/home/home-screen';
import { NewProjectButton } from '@/features/projects/new-project-button';
import { getHomeView } from '@/server/dal/home';
import { getI18n, getLastProject, getViewer, getZone } from '@/server/session';

export default async function HomePage() {
  const [viewer, { t, lang }, projectCode, zone] = await Promise.all([getViewer(), getI18n(), getLastProject(), getZone()]);
  const view = await getHomeView({ role: viewer.role, persona: { name: viewer.name, title: viewer.title }, projectCode, zone, lang, organisation: viewer.organisation });
  return (
    <>
      <PageHeader screen="home" primary={HOME_PRIMARY_ROLES.includes(viewer.role) ? <NewProjectButton /> : undefined} />
      <HomeScreen view={view} t={t} />
    </>
  );
}
