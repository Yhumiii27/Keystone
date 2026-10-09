// Standard machine types — /admin/machine-types (docs/spec/09 §9, template 1529–1572, logic 5083–5099). One template per
// product range (EMP, MEMU, SPUR, AUTRE, R&D, plus custom types): phases, cost categories, default calendar, ITP systems
// and the financial REX payment pattern, persisted (src/server/dal/mtypes.ts). URL state: `?type=` selected type
// (default the first). Primary "New machine type" (AF.mtype). Roles (and `mtCanEdit`): director, PM, engineering lead,
// quality; the others see the screen outside their workspace (banner, read-only fields). Writes: src/features/admin/actions.ts.
import { PageHeader } from '@/components/app/shell/page-header';
import { newMachineTypeForm } from '@/features/admin/forms';
import { machineTypesView } from '@/features/admin/model';
import { MachineTypesBody } from '@/features/admin/mtypes-view';
import { NewMachineTypeButton } from '@/features/admin/primary-buttons';
import { listMachineTypes } from '@/server/dal/mtypes';
import { listProjects, projectLabel } from '@/server/dal/projects';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MachineTypesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access, types, projects, lastProject] = await Promise.all([getI18n(), getScreenAccess('mtypes'), listMachineTypes(), listProjects(), getLastProject()]);
  const view = machineTypesView({ types, projects, selected: (first(sp.type) ?? '').slice(0, 40) || null }, t, lang);
  // The add-form sub-line names the current project (the prototype's `projectName`).
  const project = projects.find((p) => p.code === lastProject);
  return (
    <>
      <PageHeader screen="mtypes" primary={<NewMachineTypeButton form={newMachineTypeForm()} context={project ? t(projectLabel(project)) : undefined} />} />
      <MachineTypesBody view={view} canEdit={access.canEdit} t={t} />
    </>
  );
}
