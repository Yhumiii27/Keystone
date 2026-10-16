// Site (chantier) — /projects/[code]/site (docs/spec/10 §3, template 2268–2309, logic 4739–4760).
// Readiness & go (Go chantier rule, client prerequisites, equipment, Cursus individual go / no go), Team & mobilisation
// (rotation plan, collisions, mission costs) and Daily execution (daily reports, the punch list — R-117: the project's single
// list, items raised on site by default, `?punch=all` for every origin, read-only —, Vigie's HSE register).
// URL state (docs/spec/00 §8.3): `?tab=ready|team|exec` (unknown → Readiness & go). Primary action "Daily report" for
// viewers who may edit the project's site (Site in their workspace, project not read-only) when the project has a site
// sheet; the readiness steps and the Cursus reminder / sync follow the same rule. Projects without a site sheet show the
// empty state. Cursus owns the individual go / no go, Vigie the HSE register: links open them. D-5: the HSE card's
// "Client communication log" opens the project's Meetings screen on the decisions taken with the client (shown when the
// viewer may see Meetings); the dedicated log of chapter 4 is retired from the screen. R-126 (X-15): photos of the daily
// reports and of the punch items are stored by Keystone (added by the editors of the screen governing the item's origin, seen
// by internal viewers). R-118 (D-3 'a'): the project's leads (PM of record, co-PM, deputy, director) prepare the site sheet
// from the empty state and fill it ("Edit site sheet", the lines' Add / Edit / Remove) from Études until Mise en service & SAT
// (not at Garantie, Clos or Annulé, nor on a read-only project).
import { PageHeader } from '@/components/app/shell/page-header';
import { canSee } from '@/config/screens';
import { siteTabOf } from '@/domain/site';
import { canFillSiteSheet } from '@/domain/site-sheet';
import { siteHref } from '@/features/site/links';
import { dailyReportFormDef, siteView } from '@/features/site/model';
import { DailyReportButton } from '@/features/site/site-buttons';
import { photoViews } from '@/features/photos/model';
import { SiteBody } from '@/features/site/site-view';
import { listProjectPhotos } from '@/server/dal/photos';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { getSite } from '@/server/dal/site';
import { siteSheetDefaults } from '@/server/dal/site-sheet';
import { vigieReportIncidentUrl } from '@/server/integrations/vigie/links';
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
  // R-119 (D-6b 'a'): who may arbitrate the team's conflicts — the director, the heads of the people's departments, the leads
  // for contractors (not the Site's edit right: a department head off the team reads the Site, R-041).
  const arbiter = data ? { role: ctx.viewer.role, headed: (await getApproverIdentity(ctx.viewer)).departments, lead: ctx.isLead } : null;
  // R-118: the leads' entry (the Site's edit right, a lead of the project, the stage window); the project's defaults for a new sheet.
  const fill = canFillSiteSheet({ lead: ctx.isLead, canEdit: ctx.canEdit('site'), stage: ctx.project.stage });
  const entry = fill ? { team: ctx.team.map((m) => m.name), defaults: data ? null : await siteSheetDefaults(projectCode) } : null;
  const view = siteView(projectCode, data, { tab: siteTabOf(first(sp.tab)), punch: first(sp.punch) === 'all' ? 'all' : 'site', arbiter, entry }, t, lang);
  const context = projectLabelText(ctx.project, lang);

  const primary = canEdit ? (
    <DailyReportButton
      code={projectCode}
      context={context}
      // NEW-SITE-2 'a' (R-122): no HSE field; incidents are declared in Vigie (prefilled with the project and the site).
      form={dailyReportFormDef(t, lang, data!.today, vigieReportIncidentUrl({ projectCode, location: data?.sheet.site }))}
      execHref={siteHref(projectCode, 'exec')}
    />
  ) : undefined;

  // R-126: photos on the Daily execution tab (internal viewers; the client never sees the site's records — P-10b).
  let photos;
  if (view.tab === 'exec' && data && ctx.viewer.role !== 'client') {
    const [reports, punch] = await Promise.all([listProjectPhotos(projectCode, 'daily_report'), listProjectPhotos(projectCode, 'punch_item')]);
    const views = (m: Map<string, Parameters<typeof photoViews>[0]>) => Object.fromEntries([...m].map(([k, v]) => [k, photoViews(v)]));
    // R-117: an item raised by an inspection (listed with "All") follows Inspections & punch list's rights.
    photos = { canEdit, canEditItp: ctx.canEdit('itp'), reports: views(reports), punch: views(punch) };
  }

  return (
    <>
      <PageHeader screen="site" projectCode={projectCode} primary={primary} />
      <SiteBody code={projectCode} view={view} canEdit={canEdit} showCommLog={canSee(ctx.viewer.role, 'meetings')} photos={photos} context={context} t={t} />
    </>
  );
}
