// Site (chantier) — /projects/[code]/site (docs/spec/10 §3, template 2268–2309, logic 4739–4760).
// Readiness & go (Go chantier rule, client prerequisites, equipment, Cursus individual go / no go), Team & mobilisation
// (rotation plan, collisions, mission costs) and Daily execution (daily reports, site punch list, Vigie's HSE register).
// URL state (docs/spec/00 §8.3): `?tab=ready|team|exec` (unknown → Readiness & go). Primary action "Daily report" for
// viewers who may edit the project's site (Site in their workspace, project not read-only) when the project has a site
// sheet; the readiness steps and the Cursus reminder / sync follow the same rule. Projects without a site sheet show the
// empty state. Cursus owns the individual go / no go, Vigie the HSE register: links open them. D-5: the HSE card's
// "Client communication log" opens the project's Meetings screen on the decisions taken with the client (shown when the
// viewer may see Meetings); the dedicated log of chapter 4 is retired from the screen.
import { PageHeader } from '@/components/app/shell/page-header';
import { canSee } from '@/config/screens';
import { siteTabOf } from '@/domain/site';
import { siteHref } from '@/features/site/links';
import { dailyReportFormDef, siteView } from '@/features/site/model';
import { DailyReportButton } from '@/features/site/site-buttons';
import { SiteBody } from '@/features/site/site-view';
import { getSite } from '@/server/dal/site';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SitePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'site');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getSite(projectCode)]);
  const canEdit = ctx.canEdit('site') && !!data;
  const view = siteView(projectCode, data, { tab: siteTabOf(first(sp.tab)) }, t, lang);

  const primary = canEdit ? (
    <DailyReportButton code={projectCode} context={projectLabelText(ctx.project, lang)} form={dailyReportFormDef(t, lang)} execHref={siteHref(projectCode, 'exec')} />
  ) : undefined;

  return (
    <>
      <PageHeader screen="site" projectCode={projectCode} primary={primary} />
      <SiteBody code={projectCode} view={view} canEdit={canEdit} showCommLog={canSee(ctx.viewer.role, 'meetings')} t={t} />
    </>
  );
}
