// Inspection & test plan · punch list — /projects/[code]/itp (docs/spec/07 §2.4, template 880–892, logic 4938–4951).
// The project's ITP built from its machine-type template (hold / witness / review / surveillance points across
// Workshop, FAT, Site and SAT) and its punch list categorised A blocking / B before SAT / C cosmetic. Results are recorded
// per line by quality, the engineering lead and the director ("Record result", R-112 / Q-6a); a failed line offers
// "Report the NCR in Vigie" and shows the Vigie NCR once Vigie reports it (internal viewers only, Q-6b, P-10b).
// URL state (docs/spec/00 §8.3): `?view=plan|punch` (default plan; unknown → plan). Primary action per view: "Add
// inspection" (AF `itp`) or "Add punch item" (AF `punch`); the punch row step Start / Close. All hidden when the screen
// is outside the viewer's workspace or the project is read-only for them, and refused server-side. Projects without a
// plan or punch items show the empty states (the sidebar badge, open category-A items, is the shell's).
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/app/shell/page-header';
import { canRecordItpResult, itpDateText } from '@/domain/itpcom';
import { ItpFormButton } from '@/features/itpcom/add-buttons';
import { inspectionFormDef, localizeForm, punchFormDef } from '@/features/itpcom/forms';
import { ItpBody } from '@/features/itpcom/itp-view';
import { photoViews } from '@/features/photos/model';
import { itpScreenView, itpViewOf } from '@/features/itpcom/model';
import { getItpPlan, listItpSystems, listPunchItems, projectMachineTypeLabel } from '@/server/dal/itp';
import { listProjectPhotos } from '@/server/dal/photos';
import { teamOwnerOptions } from '@/server/dal/team';
import { getProjectContext } from '@/server/project-context';
import { NOW_ISO } from '@/server/db/codes';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

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
    const context = projectLabelText(ctx.project, lang);
    primary =
      view === 'plan' ? (
        <ItpFormButton kind="inspection" code={projectCode} label={t('Add inspection')} context={context} form={localizeForm(inspectionFormDef(await listItpSystems(projectCode)), t, lang)} />
      ) : (
        <ItpFormButton kind="punch" code={projectCode} label={t('Add punch item')} context={context} form={localizeForm(punchFormDef(await teamOwnerOptions(projectCode)), t, lang)} />
      );
  }

  // R-126 (X-15): punch-item photos stored by Keystone; added by the screen's editors (not the client), seen by internal
  // viewers and by the client on their own project.
  let photos;
  if (view === 'punch' && (ctx.viewer.role !== 'client' || ctx.isMine)) {
    const byItem = await listProjectPhotos(projectCode, 'punch_item', 'itp');
    photos = { canEdit: canEdit && ctx.viewer.role !== 'client', punch: Object.fromEntries([...byItem].map(([k, v]) => [k, photoViews(v)])) };
  }

  return (
    <>
      <PageHeader screen="itp" projectCode={projectCode} primary={primary} />
      <ItpBody
        code={projectCode}
        view={itpScreenView(
          {
            code: projectCode, view, plan, punch, machineType,
            viewer: { canRecord: canEdit && canRecordItpResult(ctx.viewer.role), internal: ctx.viewer.role !== 'client', name: ctx.viewer.name, today: itpDateText(NOW_ISO) },
          },
          t, lang,
        )}
        canEdit={canEdit}
        photos={photos}
        t={t}
      />
    </>
  );
}
