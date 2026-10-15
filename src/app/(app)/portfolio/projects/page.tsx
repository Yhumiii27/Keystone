// Projects — list and lifecycle (docs/spec/03 §5; template 638–752 + dialogs 2972–3069; logic 3898–3969, 5183).
// Master register of every project (pipeline, execution, warranty, closed, cancelled) in the selected zone: three
// views (?view=health|progress|budget), stage slider (?status=<stage code>), search (?q=), "Move to" menus,
// stage-deliverable checklists with auto-advance, the Force stage change dialog and the New project wizard.
import { PageHeader } from '@/components/app/shell/page-header';
import { isRegisterView } from '@/domain/lifecycle';
import { NewProjectButton } from '@/features/projects/new-project-button';
import { ProjectsRegister } from '@/features/projects/register';
import { buildRegisterModel } from '@/features/projects/register-model';
import { stage } from '@/server/db/codes';
import { getRegisterData } from '@/server/dal/projects-register';
import { getScreenAccess, projectAccessResolver } from '@/server/project-context';
import { getI18n, getZone } from '@/server/session';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, { t, lang }, zone, access, data] = await Promise.all([searchParams, getI18n(), getZone(), getScreenAccess('projects'), getRegisterData()]);
  const model = buildRegisterModel(data, zone, t, lang);
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
      />
    </>
  );
}
