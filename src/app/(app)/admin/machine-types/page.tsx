// Standard machine types — /admin/machine-types (docs/spec/09 §9, template 1529–1572, logic 5083–5099). One template per
// product range (EMP, MEMU, SPUR, AUTRE, R&D, plus custom types): phases, cost categories, default calendar, ITP systems
// and the financial REX payment pattern, persisted (src/server/dal/mtypes.ts). URL state: `?type=` selected type
// (default the first). Primary "New machine type" (AF.mtype). Roles (and `mtCanEdit`): director, PM, engineering lead,
// quality; the others see the screen outside their workspace (banner, read-only fields). Writes: src/features/admin/actions.ts.
// R-153 (X-10): a machine type is not a project's — the "New machine type" dialog has no project sub-line (the prototype's
// add-forms all named the current project, `projectName`).
import { PageHeader } from '@/components/app/shell/page-header';
import { newMachineTypeForm } from '@/features/admin/forms';
import { machineTypesView } from '@/features/admin/model';
import { MachineTypesBody } from '@/features/admin/mtypes-view';
import { NewMachineTypeButton } from '@/features/admin/primary-buttons';
import { listMachineTypes } from '@/server/dal/mtypes';
import { listProjects } from '@/server/dal/projects';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MachineTypesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access, types, projects] = await Promise.all([getI18n(), getScreenAccess('mtypes'), listMachineTypes(), listProjects()]);
  const view = machineTypesView({ types, projects, selected: (first(sp.type) ?? '').slice(0, 40) || null }, t, lang);
  return (
    <>
      <PageHeader screen="mtypes" primary={<NewMachineTypeButton form={newMachineTypeForm()} />} />
      <MachineTypesBody view={view} canEdit={access.canEdit} t={t} />
    </>
  );
}
