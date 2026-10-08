// Contingency register — /projects/[code]/contingency (docs/spec/04 §5, template 900–909, logic 4959–4967).
// Initial provision (default round(BAC × 3 %) when the project has no register), draw-downs, use vs progress and
// the open-risk exposure (EMV of the Risk register). Primary action "Draw-down" (AF `contingency`), hidden when
// the screen is outside the viewer's workspace or the project is read-only for them.
import { PageHeader } from '@/components/app/shell/page-header';
import { DrawDownButton } from '@/features/risks/add-buttons';
import { ContingencyView } from '@/features/risks/contingency-view';
import { drawDownFormDef } from '@/features/risks/forms';
import { contingencyView } from '@/features/risks/model';
import { projectLabel } from '@/server/dal/projects';
import { getContingencyScreen } from '@/server/dal/risks-screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function ContingencyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'contingency');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getContingencyScreen(projectCode)]);

  const primary =
    ctx.canEdit('contingency') && data ? (
      <DrawDownButton code={projectCode} context={t(projectLabel(ctx.project))} form={drawDownFormDef(data.approvers)} />
    ) : undefined;

  return (
    <>
      <PageHeader screen="contingency" projectCode={projectCode} primary={primary} />
      {data && <ContingencyView view={contingencyView(data.contingency, t, lang)} t={t} />}
    </>
  );
}
