// My projects (docs/spec/03 §2): card wall of the projects the viewer is involved in (whole portfolio as a fallback).
// S-32 (owner, 5 Nov 2026): each of the viewer's live projects shows the register's "Schedule quality" cell (S-23: DCMA checks that
// fail, linked to the Schedule screen when the viewer sees it); not on the fallback wall (those are not the viewer's projects).
import { PageHeader } from '@/components/app/shell/page-header';
import { canSee } from '@/config/role-screens';
import { isLiveRow } from '@/domain/lifecycle';
import { MyProjectsBody } from '@/features/portfolio/my-projects';
import { qualityCell } from '@/features/projects/register-model';
import { getMyProjects } from '@/server/dal/portfolio';
import { scheduleQualitySummaries } from '@/server/dal/schedule-quality';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';

export default async function MyProjectsPage() {
  // R-042 (P-1): My projects is outside the client's workspace (their portal replaces it) — a client is sent home.
  const access = await getScreenAccess('myprojects');
  const viewer = access.viewer;
  const [{ t, lang }, current] = await Promise.all([getI18n(), getLastProject()]);
  const data = await getMyProjects(viewer, current, lang);
  const mine = data.fallback ? [] : data.cards.filter((c) => isLiveRow(c.project.stage, c.project.health)).map((c) => c.project.code);
  const summaries = await scheduleQualitySummaries(mine);
  const link = canSee(viewer.role, 'schedule');
  const quality = Object.fromEntries(mine.map((code) => [code, qualityCell(summaries[code], code, link, t)]));
  return (
    <>
      <PageHeader screen="myprojects" />
      <MyProjectsBody data={data} t={t} lang={lang} quality={data.fallback ? undefined : quality} />
    </>
  );
}
