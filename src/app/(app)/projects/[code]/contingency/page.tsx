// Contingency register — /projects/[code]/contingency (docs/spec/04 §5, template 900–909, logic 4959–4967).
// Initial provision (the budget's contingency line, else round(BAC × 3 %), when the project has no register), draw-downs,
// use vs progress and the open-risk exposure (EMV of the Risk register). Primary action "Draw-down" (AF `contingency`),
// hidden when the screen is outside the viewer's workspace or the project is read-only for them. Delivery 7 (C-4): the
// draw-down is linked to a change request, risk or NCR of the project and waits for the portfolio director's validation.
import { PageHeader } from '@/components/app/shell/page-header';
import { DrawDownButton } from '@/features/risks/add-buttons';
import { ContingencyView } from '@/features/risks/contingency-view';
import { drawDownFormDef } from '@/features/risks/forms';
import { contingencyView } from '@/features/risks/model';
import { getContingencyScreen } from '@/server/dal/risks-screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { fieldsText, projectLabelText } from '@/i18n/data-text';

export default async function ContingencyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'contingency');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getContingencyScreen(projectCode)]);

  const primary =
    ctx.canEdit('contingency') && data ? (
      <DrawDownButton
        code={projectCode}
        context={projectLabelText(ctx.project, lang)}
        // Option labels "CR-004 · Additional piling…": the record titles as typed (R-148), the form's own strings by FormDialog.
        form={drawDownFormDef(data.links.map((l) => ({ ...l, label: fieldsText(l.label, t, lang) })))}
      />
    ) : undefined;

  return (
    <>
      <PageHeader screen="contingency" projectCode={projectCode} primary={primary} />
      {data && <ContingencyView view={contingencyView(data.contingency, t, lang)} t={t} />}
    </>
  );
}
