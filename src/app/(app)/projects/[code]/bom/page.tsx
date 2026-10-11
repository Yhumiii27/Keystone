// Project BOM — equipment & parts — /projects/[code]/bom (docs/spec/09 §1, template 1167–1311, logic 4206–4266).
// URL state (src/features/bom/links.ts): `?view=tree|used|compare|spares` (default flat list), `?q=`, `?type=`, `?mfr=`,
// `?sort=` + `?dir=` (flat list), `?node=` (tree node drawer), `?used=` (where-used search), `?sys=` + `?kind=` (PU/PR
// list), `?part=` (part record drawer — the shared <PartDrawer/> of the PLM feature, over any display).
// Primary action "Add article" (AF `bom`) for viewers who may edit the project BOM: hidden outside the workspace and on
// a read-only project, and refused server-side (src/features/bom/actions.ts). "Raise ECO" opens Vigie (which owns the
// ECOs) for viewers whose workspace has the ECO screen — the part drawer's rule; ECO tags open Keystone's ECO screen,
// where progress is recorded and sent to Vigie.
import { PageHeader } from '@/components/app/shell/page-header';
import { AddArticleButton } from '@/features/bom/client-buttons';
import { BomBody } from '@/features/bom/bom-view';
import { bomFormDef, localizeBomForm } from '@/features/bom/forms';
import { bomHref, parseBomState } from '@/features/bom/links';
import { bomScreenView } from '@/features/bom/model';
import { PartDrawer } from '@/features/plm/part-drawer';
import { getBomActivityOptions, getBomScreen } from '@/server/dal/bom-screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { canSeeSupplierPrices } from '@/domain/rights';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;

export default async function BomPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'bom');
  const projectCode = ctx.project.code;
  const canEdit = ctx.canEdit('bom');
  const canRaiseEco = !ctx.isOutside('eco');
  const state = parseBomState(sp);

  const [{ t, lang }, data, activities] = await Promise.all([
    getI18n(),
    getBomScreen(projectCode, { view: state.view, used: state.used, system: state.sys }),
    canEdit ? getBomActivityOptions(projectCode) : Promise.resolve(null),
  ]);

  const primary =
    canEdit && activities ? (
      <AddArticleButton
        code={projectCode}
        context={projectLabelText(ctx.project, lang)}
        form={localizeBomForm(bomFormDef(activities), t)}
      />
    ) : undefined;

  return (
    <>
      <PageHeader screen="bom" projectCode={projectCode} primary={primary} />
      {data && <BomBody view={bomScreenView(projectCode, state, data, { canEdit, canRaiseEco, prices: canSeeSupplierPrices(ctx.viewer.role) }, t, lang)} canEdit={canEdit} />}
      {state.part && <PartDrawer key={state.part} partRef={state.part} projectCode={projectCode} closeHref={bomHref(projectCode, { ...state, part: null })} />}
    </>
  );
}
