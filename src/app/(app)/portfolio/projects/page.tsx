// Projects — list and lifecycle (docs/spec/03 §5; template 638–752 + dialogs 2972–3069; logic 3898–3969, 5183).
// Master register of every project (pipeline, execution, warranty, closed, cancelled) in the selected zone: three
// views (?view=health|progress|budget), stage slider (?status=<stage code>), search (?q=), "Move to" menus,
// stage-deliverable checklists with auto-advance, the Force stage change dialog and the New project wizard.
// R-196: category filter (?cat=client|rd), shown when an R&D project exists.
// R-187 (Arche K-02, K-10): under the register, the "Subsidiaries' machine needs" card (director and project managers).
// R-160 (P2, D9-32): under it, the CE conformity card (machine lines with an incomplete CE file under Regulation 2023/1230).
// S-23: the health view's "Schedule quality" column — DCMA checks that fail per live project (R-206 checks, read only).
import { PageHeader } from '@/components/app/shell/page-header';
import { canSee } from '@/config/role-screens';
import { isLiveRow, isRegisterView } from '@/domain/lifecycle';
import { isProjectCategory, type ProjectCategory } from '@/domain/project-category';
import { NeedsCard } from '@/features/capex-needs/needs-card';
import { CePortfolioCard } from '@/features/ce/portfolio-card';
import { NewProjectButton } from '@/features/projects/new-project-button';
import { ProjectsRegister } from '@/features/projects/register';
import { buildRegisterModel } from '@/features/projects/register-model';
import { stage } from '@/server/db/codes';
import { getRegisterData } from '@/server/dal/projects-register';
import { scheduleQualitySummaries } from '@/server/dal/schedule-quality';
import { getScreenAccess, projectAccessResolver } from '@/server/project-context';
import { getI18n, getZone } from '@/server/session';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, { t, lang }, zone, access, data] = await Promise.all([searchParams, getI18n(), getZone(), getScreenAccess('projects'), getRegisterData()]);
  const liveCodes = data.projects.filter((p) => (!zone || p.zone === zone) && isLiveRow(p.stage, p.health)).map((p) => p.code);
  const scheduleQuality = await scheduleQualitySummaries(liveCodes);
  const model = buildRegisterModel({ ...data, scheduleQuality, scheduleLinks: canSee(access.viewer.role, 'schedule') }, zone, t, lang);
  // Lifecycle controls only on the projects the viewer leads (L-4b: the director, the project's PMs and deputies).
  const rights = await projectAccessResolver(access.viewer);
  const editableCodes = access.canEdit ? data.projects.filter((p) => rights(p).lead).map((p) => p.code) : [];
  const view = one(sp.view);
  const status = one(sp.status);
  return (
    <>
      <PageHeader screen="projects" primary={<NewProjectButton />} />
      <ProjectsRegister
        rows={model.rows}
        stages={model.stages}
        zoneEmpty={model.zoneEmpty}
        canEdit={access.canEdit}
        editableCodes={editableCodes}
        initialView={isRegisterView(view) ? view : 'health'}
        initialStatus={status && stage.isCode(status) ? status : null}
        initialQuery={(one(sp.q) ?? '').slice(0, 100)}
        initialCategory={isProjectCategory(one(sp.cat)) ? (one(sp.cat) as ProjectCategory) : null}
      />
      <NeedsCard />
      {/* R-160 (P2, D9-32): machine lines with an incomplete CE file placed on the market from 20 Jan 2027. */}
      <CePortfolioCard codes={zone ? data.projects.filter((p) => p.zone === zone).map((p) => p.code) : null} />
    </>
  );
}
