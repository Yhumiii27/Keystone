// Inspection & test plan · punch list — /projects/[code]/itp (docs/spec/07 §2.4, template 880–892, logic 4938–4951).
// The project's ITP built from its machine-type template (hold / witness / review / surveillance points across
// Workshop, FAT, Site and SAT, results read-only) and its punch list categorised A blocking / B before SAT / C cosmetic.
// URL state (docs/spec/00 §8.3): `?view=plan|punch` (default plan; unknown → plan). Primary action per view: "Add
// inspection" (AF `itp`) or "Add punch item" (AF `punch`); the punch row step Start / Close. All hidden when the screen
// is outside the viewer's workspace or the project is read-only for them, and refused server-side. Projects without a
// plan or punch items show the empty states (the sidebar badge, open category-A items, is the shell's).
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/app/shell/page-header';
import { ItpFormButton } from '@/features/itpcom/add-buttons';
import { inspectionFormDef, localizeForm, punchFormDef } from '@/features/itpcom/forms';
import { ItpBody } from '@/features/itpcom/itp-view';
import { itpScreenView, itpViewOf } from '@/features/itpcom/model';
import { getItpPlan, listItpSystems, listPunchItems, projectMachineTypeLabel } from '@/server/dal/itp';
import { projectLabel } from '@/server/dal/projects';
import { teamOwnerOptions } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ItpPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'itp');
  const projectCode = ctx.project.code;
  const view = itpViewOf(first(sp.view));
  const [{ t, lang }, plan, punch, machineType] = await Promise.all([
    getI18n(),
    getItpPlan(projectCode),
    listPunchItems(projectCode, 'itp'),
    projectMachineTypeLabel(projectCode),
  ]);
  const canEdit = ctx.canEdit('itp');

  let primary: ReactNode;
  if (canEdit) {
    const context = t(projectLabel(ctx.project));
    primary =
      view === 'plan' ? (
        <ItpFormButton kind="inspection" code={projectCode} label={t('Add inspection')} context={context} form={localizeForm(inspectionFormDef(await listItpSystems(projectCode)), t, lang)} />
      ) : (
        <ItpFormButton kind="punch" code={projectCode} label={t('Add punch item')} context={context} form={localizeForm(punchFormDef(await teamOwnerOptions(projectCode)), t, lang)} />
      );
  }

  return (
    <>
      <PageHeader screen="itp" projectCode={projectCode} primary={primary} />
      <ItpBody code={projectCode} view={itpScreenView({ code: projectCode, view, plan, punch, machineType }, t, lang)} canEdit={canEdit} t={t} />
    </>
  );
}
