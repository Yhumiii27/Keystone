// My projects (docs/spec/03 §2): card wall of the projects the viewer is involved in (whole portfolio as a fallback).
import { PageHeader } from '@/components/app/shell/page-header';
import { MyProjectsBody } from '@/features/portfolio/my-projects';
import { getMyProjects } from '@/server/dal/portfolio';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject, getViewer } from '@/server/session';

export default async function MyProjectsPage() {
  // R-042 (P-1): My projects is outside the client's workspace (their portal replaces it) — a client is sent home.
  await getScreenAccess('myprojects');
  const [{ t, lang }, viewer, current] = await Promise.all([getI18n(), getViewer(), getLastProject()]);
  const data = await getMyProjects(viewer, current, lang);
  return (
    <>
      <PageHeader screen="myprojects" />
      <MyProjectsBody data={data} t={t} lang={lang} />
    </>
  );
}
