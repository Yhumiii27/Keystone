// Lessons learned & project closure — /projects/[code]/closure (docs/spec/07 §2.7, template 921–931, logic 4997–5006).
// No URL view state (the screen has no tab, filter or drawer). Primary action "Add lesson" (AF `rex`) and the row
// actions (Validate / Mark applied, closure checklist clicks) for viewers who may edit the screen on this project;
// hidden when the screen is outside the viewer's workspace or the project is read-only for them (Server Functions
// re-check). Projects without REX data show empty lists and "—" tiles.
import { PageHeader } from '@/components/app/shell/page-header';
import { AddLessonButton } from '@/features/rexclient/buttons';
import { RexView } from '@/features/rexclient/rex-view';
import { getRexScreen } from '@/features/rexclient/screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function ClosurePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await getProjectContext(code, 'rex');
  const projectCode = ctx.project.code;
  const { t, lang } = await getI18n();
  const view = await getRexScreen(projectCode, t, lang);
  const canEdit = ctx.canEdit('rex');
  const primary = canEdit ? <AddLessonButton code={projectCode} context={projectLabelText(ctx.project, lang)} /> : undefined;
  return (
    <>
      <PageHeader screen="rex" projectCode={projectCode} primary={primary} />
      <RexView code={projectCode} view={view} canEdit={canEdit} t={t} />
    </>
  );
}
